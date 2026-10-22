from __future__ import annotations

import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

from package_identity import (  # noqa: E402
    IdentityError,
    classify_change,
    compute_identity,
    verify_receipt,
)
from red_probe import invalidate_bytecode, probe, run  # noqa: E402


class RuntimeIdentityTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / "package"
        (self.root / ".claude-plugin").mkdir(parents=True)
        (self.root / "skills/demo").mkdir(parents=True)
        (self.root / "tests").mkdir()
        (self.root / "assets").mkdir()
        (self.root / ".claude-plugin/plugin.json").write_text(
            '{"name":"demo","version":"1.2.3","skills":"./skills/",'
            '"interface":{"capabilities":["Read"]},"mcpServers":{"demo":{"command":"run"}}}\n',
            encoding="utf-8")
        (self.root / "skills/demo/SKILL.md").write_text(
            "---\nname: demo\nmetadata:\n  version: 1.2.3\n---\nVersion 1.2.3 in prose.\n",
            encoding="utf-8")
        (self.root / "tests/test_demo.py").write_text("assert True\n", encoding="utf-8")
        (self.root / "assets/logo.txt").write_text("asset\n", encoding="utf-8")
        (self.root / "README.md").write_text("demo\n", encoding="utf-8")
        (self.root / "CHANGELOG.md").write_text("## [1.2.3]\n", encoding="utf-8")

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_native_root_needs_no_git_and_roles_are_separate(self) -> None:
        identity = compute_identity(self.root)
        self.assertEqual(identity["package"]["name"], "demo")
        self.assertEqual(identity["counts"]["runtime"], 1)
        self.assertEqual(identity["counts"]["test"], 1)
        self.assertEqual(identity["counts"]["assets"], 1)
        self.assertGreater(identity["counts"]["metadata"], 2)
        self.assertNotEqual(identity["digests"]["runtime"], identity["digests"]["tree"])

    def test_version_normalisation_is_frontmatter_only(self) -> None:
        before = compute_identity(self.root)
        skill = self.root / "skills/demo/SKILL.md"
        skill.write_text(skill.read_text(encoding="utf-8").replace("1.2.3", "9.9.9", 1), encoding="utf-8")
        after = compute_identity(self.root)
        self.assertEqual(before["digests"]["runtime"], after["digests"]["runtime"])
        self.assertNotEqual(before["digests"]["tree"], after["digests"]["tree"])

    def test_change_classification_distinguishes_version_and_test_only(self) -> None:
        before = compute_identity(self.root)
        manifest_path = self.root / ".claude-plugin/plugin.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest["version"] = "9.9.9"
        manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
        skill = self.root / "skills/demo/SKILL.md"
        skill.write_text(skill.read_text(encoding="utf-8").replace("1.2.3", "9.9.9", 1), encoding="utf-8")
        versioned = compute_identity(self.root)
        self.assertEqual(classify_change(before, versioned), "version-only")
        tested = json.loads(json.dumps(before))
        tested["digests"]["test"] = "sha256:changed"
        tested["digests"]["tree"] = "sha256:changed"
        self.assertEqual(classify_change(before, tested), "test-only")

    def test_manifest_routing_plus_version_is_runtime_change(self) -> None:
        before = compute_identity(self.root)
        path = self.root / ".claude-plugin/plugin.json"
        manifest = json.loads(path.read_text(encoding="utf-8"))
        manifest["version"] = "9.9.9"
        manifest["skills"] = "./other-skills/"
        path.write_text(json.dumps(manifest), encoding="utf-8")
        self.assertEqual(classify_change(before, compute_identity(self.root)), "runtime")

    def test_readme_plus_version_is_not_version_only(self) -> None:
        before = compute_identity(self.root)
        path = self.root / ".claude-plugin/plugin.json"
        manifest = json.loads(path.read_text(encoding="utf-8"))
        manifest["version"] = "9.9.9"
        path.write_text(json.dumps(manifest), encoding="utf-8")
        (self.root / "README.md").write_text("changed release notes\n", encoding="utf-8")
        self.assertEqual(classify_change(before, compute_identity(self.root)), "mixed")

    def test_runtime_mode_only_change_is_identity_change(self) -> None:
        script = self.root / "skills/demo/run.sh"
        script.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
        os.chmod(script, 0o755)
        before = compute_identity(self.root)
        os.chmod(script, 0o644)
        after = compute_identity(self.root)
        self.assertNotEqual(before["digests"]["runtime"], after["digests"]["runtime"])
        self.assertEqual(classify_change(before, after), "runtime")

    def test_codex_manifest_is_a_package_identity_source(self) -> None:
        manifest = self.root / ".claude-plugin/plugin.json"
        manifest.unlink()
        target = self.root / ".codex-plugin"
        target.mkdir()
        (target / "plugin.json").write_text(
            '{"name":"codex-demo","version":"2.0.0"}\n', encoding="utf-8")
        identity = compute_identity(self.root)
        self.assertEqual(identity["package"], {"name": "codex-demo", "version": "2.0.0"})

    def test_mtime_and_order_do_not_change_identity(self) -> None:
        before = compute_identity(self.root)
        for path in self.root.rglob("*"):
            if path.is_file():
                os.utime(path, (1, 1))
        self.assertEqual(before, compute_identity(self.root))

    def test_symlink_is_rejected(self) -> None:
        os.symlink("/etc/hosts", self.root / "skills/demo/escape.txt")
        with self.assertRaises(IdentityError):
            compute_identity(self.root)

    def test_internal_relative_symlink_is_hashed_with_target_bytes(self) -> None:
        target = self.root / "skills/demo/target.txt"
        link = self.root / "skills/demo/alias.txt"
        target.write_text("one\n", encoding="utf-8")
        os.symlink("target.txt", link)
        before = compute_identity(self.root)
        target.write_text("two\n", encoding="utf-8")
        after = compute_identity(self.root)
        self.assertNotEqual(before["digests"]["runtime"], after["digests"]["runtime"])

    def test_broken_relative_symlink_is_rejected(self) -> None:
        os.symlink("missing.txt", self.root / "skills/demo/broken.txt")
        with self.assertRaises(IdentityError):
            compute_identity(self.root)

    def test_node_modules_is_outside_inventory(self) -> None:
        ignored = self.root / "node_modules/pkg"
        ignored.mkdir(parents=True)
        (ignored / "generated.js").write_text("ignored\n", encoding="utf-8")
        before = compute_identity(self.root)
        (ignored / "generated.js").write_text("changed\n", encoding="utf-8")
        self.assertEqual(before, compute_identity(self.root))

    def test_local_agent_state_is_outside_inventory(self) -> None:
        state = self.root / ".omc/state/session.json"
        state.parent.mkdir(parents=True)
        state.write_text('{"tick":1}', encoding="utf-8")
        before = compute_identity(self.root)
        state.write_text('{"tick":2}', encoding="utf-8")
        self.assertEqual(before, compute_identity(self.root))
        (self.root / "skills/demo/SKILL.md").write_text("changed behavior\n", encoding="utf-8")
        self.assertNotEqual(before["digests"]["runtime"], compute_identity(self.root)["digests"]["runtime"])

    def test_receipt_current_bytes_and_provenance_rule(self) -> None:
        receipt = compute_identity(self.root)
        self.assertEqual(verify_receipt(self.root, receipt), (True, []))
        (self.root / "README.md").write_text("changed\n", encoding="utf-8")
        ok, problems = verify_receipt(self.root, receipt)
        self.assertFalse(ok)
        self.assertIn("receipt mismatch: digests", problems)
        receipt["provenance"] = {"source": "trusted"}
        ok, problems = verify_receipt(self.root, receipt)
        self.assertFalse(ok)
        self.assertIn("provenance", problems[0])


class RedProbeCacheTests(unittest.TestCase):
    def test_mutated_source_is_run_after_bytecode_removal(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "mod.py").write_text('VALUE = "GOOD"\n', encoding="utf-8")
            (root / "check.py").write_text(
                "import mod, sys; sys.exit(0 if mod.VALUE == 'GOOD' else 1)\n",
                encoding="utf-8",
            )
            result, report = probe(str(root), "python3 check.py", ["mod.py:GOOD->BADD"], 0, 10)
            self.assertEqual(result, 0)
            self.assertEqual(report["baseline_rc"], 0)
            self.assertEqual(report["mutated_rc"], 1)
            self.assertGreaterEqual(report["bytecode_removed"], 0)

    def test_invalidate_bytecode_removes_existing_pyc_and_keeps_source(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "module.py"
            source.write_text("VALUE = 1\n", encoding="utf-8")
            cache = root / "__pycache__"
            cache.mkdir()
            (cache / "module.cpython-314.pyc").write_bytes(b"stale")
            self.assertGreaterEqual(invalidate_bytecode(str(root)), 1)
            self.assertTrue(source.exists())
            self.assertFalse(cache.exists())

    def test_same_size_and_mtime_source_change_does_not_use_old_pyc(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "mod.py"
            check = root / "check.py"
            source.write_text('VALUE = "GOOD"\n', encoding="utf-8")
            check.write_text(
                "import mod, sys; sys.exit(0 if mod.VALUE == 'GOOD' else 1)\n",
                encoding="utf-8",
            )
            baseline_env = os.environ.copy()
            baseline_env.pop("PYTHONDONTWRITEBYTECODE", None)
            baseline = subprocess.run(
                [sys.executable, "check.py"], cwd=root, env=baseline_env,
                capture_output=True, check=False,
            )
            self.assertEqual(baseline.returncode, 0)
            self.assertTrue(list((root / "__pycache__").glob("mod.*.pyc")))
            original_stat = source.stat()
            source.write_text('VALUE = "BADD"\n', encoding="utf-8")
            self.assertEqual(len('VALUE = "GOOD"\n'), len(source.read_text()))
            os.utime(source, ns=(original_stat.st_atime_ns, original_stat.st_mtime_ns))
            invalidate_bytecode(str(root))
            self.assertEqual(run("python3 check.py", str(root), 10)[0], 1)

    def test_timeout_is_unrunnable_not_red_proven(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "sleep.py").write_text("import time; time.sleep(1)\n", encoding="utf-8")
            result, detail = run("python3 sleep.py", str(root), 0.01)
            self.assertIsNone(result)
            self.assertIn("timed out", detail)


class ConsumerIntegrationTests(unittest.TestCase):
    def test_preflight_and_package_check_emit_identity_without_git(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "package"
            root.mkdir()
            (root / ".claude-plugin").mkdir()
            (root / "tests").mkdir()
            (root / ".claude-plugin/plugin.json").write_text(
                '{"name":"fixture","version":"0.1.0"}\n', encoding="utf-8")
            (root / "SKILL.md").write_text("---\nname: fixture\n---\nwork\n", encoding="utf-8")
            (root / "tests/test_fixture.py").write_text("assert True\n", encoding="utf-8")
            (root / "README.md").write_text("fixture\n", encoding="utf-8")
            (root / "CHANGELOG.md").write_text("## [0.1.0]\n", encoding="utf-8")
            (root / "scripts").mkdir()
            (root / "scripts/target.py").write_text("VALUE = 1\n", encoding="utf-8")
            os.symlink("target.py", root / "scripts/alias.py")
            preflight = subprocess.run(
                [sys.executable, str(SCRIPTS / "preflight.py"), str(root), "--json"],
                capture_output=True, text=True, check=False,
            )
            self.assertEqual(preflight.returncode, 0, preflight.stderr + preflight.stdout)
            self.assertIn('"identity"', preflight.stdout)
            self.assertNotIn('"kind": "symlink"', preflight.stdout)
            package = subprocess.run(
                [sys.executable, str(SCRIPTS / "package_check.py"), str(root), "--json"],
                capture_output=True, text=True, check=False,
            )
            self.assertEqual(package.returncode, 0, package.stderr + package.stdout)
            self.assertIn('"identity"', package.stdout)

            receipt_path = root.parent / "identity.json"
            receipt_path.write_text(json.dumps(compute_identity(root)), encoding="utf-8")
            (root / "README.md").write_text("tampered\n", encoding="utf-8")
            receipt_check = subprocess.run(
                [sys.executable, str(SCRIPTS / "package_check.py"), str(root),
                 "--identity-receipt", str(receipt_path), "--json"],
                capture_output=True, text=True, check=False,
            )
            self.assertEqual(receipt_check.returncode, 1, receipt_check.stderr + receipt_check.stdout)
            (root / "README.md").write_text("fixture\n", encoding="utf-8")

            (root / ".claude-plugin/plugin.json").unlink()
            (root / ".codex-plugin").mkdir()
            (root / ".codex-plugin/plugin.json").write_text(
                '{"name":"fixture","version":"0.1.0"}\n', encoding="utf-8")
            codex_package = subprocess.run(
                [sys.executable, str(SCRIPTS / "package_check.py"), str(root), "--json"],
                capture_output=True, text=True, check=False,
            )
            self.assertEqual(codex_package.returncode, 0, codex_package.stderr + codex_package.stdout)
            self.assertIn('"manifest": ".codex-plugin/plugin.json"', codex_package.stdout)


if __name__ == "__main__":
    unittest.main()
