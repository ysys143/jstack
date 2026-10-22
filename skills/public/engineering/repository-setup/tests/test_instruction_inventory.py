#!/usr/bin/env python3
"""Behavior tests for the read-only instruction inventory CLI."""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).parents[1] / "scripts" / "instruction_inventory.py"


class InventoryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / "repo"
        self.root.mkdir()

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, relative, text="# guidance\nKeep this repository rule exactly as written.\n"):
        path = self.root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")
        return path

    def run_cli(self, host="claude", target=None):
        command = [sys.executable, str(SCRIPT), "--root", str(self.root), "--host", host]
        if target is not None:
            command += ["--target", str(target)]
        result = subprocess.run(command, text=True, capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_minimal_clean_inventory_and_hash(self):
        source = self.write("CLAUDE.md")
        before = source.read_bytes()
        data = self.run_cli()
        self.assertEqual(data["schema_version"], 1)
        self.assertEqual([f["path"] for f in data["files"]], ["CLAUDE.md"])
        self.assertEqual(len(data["files"][0]["sha256"]), 64)
        self.assertEqual(data["findings"], [])
        self.assertEqual(source.read_bytes(), before)

    def test_discovers_more_than_fifty_without_truncation(self):
        for number in range(61):
            self.write(f"p{number}/CLAUDE.md", f"# {number}\n")
        self.assertEqual(len(self.run_cli()["files"]), 61)

    def test_target_scope_separates_ancestor_descendant_and_sibling(self):
        self.write("CLAUDE.md")
        self.write("app/CLAUDE.md")
        self.write("app/pkg/CLAUDE.md")
        self.write("sibling/CLAUDE.md")
        files = {f["path"]: f for f in self.run_cli(target="app")["files"]}
        self.assertEqual(files["CLAUDE.md"]["scope"], "ancestor")
        self.assertEqual(files["app/pkg/CLAUDE.md"]["scope"], "target_descendant")
        self.assertFalse(files["app/pkg/CLAUDE.md"]["active"])
        self.assertEqual(files["app/pkg/CLAUDE.md"]["inactive_reason"], "on_demand_or_other_target")
        self.assertFalse(files["sibling/CLAUDE.md"]["active"])

    def test_root_dot_claude_file_uses_repository_as_application_base(self):
        self.write(".claude/CLAUDE.md")
        (self.root / "app").mkdir()
        record = self.run_cli(target="app")["files"][0]
        self.assertEqual(record["scope"], "ancestor")
        self.assertTrue(record["active"])

    def test_codex_override_shadows_same_directory_agents(self):
        self.write("AGENTS.md")
        self.write("AGENTS.override.md")
        files = {f["path"]: f for f in self.run_cli("codex")["files"]}
        self.assertFalse(files["AGENTS.md"]["active"])
        self.assertEqual(files["AGENTS.md"]["inactive_reason"], "shadowed_by_AGENTS.override.md")
        self.assertTrue(files["AGENTS.override.md"]["active"])

    def test_empty_codex_override_falls_through_to_agents(self):
        self.write("AGENTS.md")
        self.write("AGENTS.override.md", "\n")
        files = {f["path"]: f for f in self.run_cli("codex")["files"]}
        self.assertTrue(files["AGENTS.md"]["active"])
        self.assertFalse(files["AGENTS.override.md"]["active"])
        self.assertEqual(files["AGENTS.override.md"]["inactive_reason"], "empty_override_falls_through")

    def test_claude_local_proper_name_is_discovered(self):
        self.write("CLAUDE.local.md")
        self.write("CLAUDE.md.local")
        paths = [f["path"] for f in self.run_cli()["files"]]
        self.assertIn("CLAUDE.local.md", paths)
        self.assertNotIn("CLAUDE.md.local", paths)

    def test_rules_are_reported_as_requiring_host_confirmation(self):
        self.write(".claude/rules/python/style.md")
        (self.root / "app").mkdir()
        record = self.run_cli(target="app")["files"][0]
        self.assertEqual(record["kind"], "claude_rule")
        self.assertEqual(record["scope"], "ancestor")
        self.assertFalse(record["active"])
        self.assertEqual(record["inactive_reason"], "host_scope_confirmation_required")

    def test_imports_load_relative_markdown_and_report_missing(self):
        self.write("CLAUDE.md", "@docs/guide.md\n@missing.md\n")
        self.write("docs/guide.md", "Imported substantive repository guidance here.\n")
        data = self.run_cli()
        statuses = {item["target"]: item["status"] for item in data["imports"]}
        self.assertEqual(statuses, {"docs/guide.md": "loaded", "missing.md": "missing"})
        self.assertIn("docs/guide.md", [f["path"] for f in data["files"]])

    def test_import_promotes_already_discovered_sibling_with_provenance(self):
        self.write("CLAUDE.md", "@sibling/CLAUDE.md\n")
        self.write("sibling/CLAUDE.md")
        files = {item["path"]: item for item in self.run_cli()["files"]}
        sibling = files["sibling/CLAUDE.md"]
        self.assertEqual(sibling["scope"], "target_descendant")
        self.assertTrue(sibling["active"])
        self.assertIsNone(sibling["inactive_reason"])
        self.assertEqual(sibling["imported_by"], ["CLAUDE.md"])

    def test_codex_does_not_interpret_at_paths_as_claude_imports(self):
        self.write("AGENTS.md", "@missing.md\n")
        data = self.run_cli("codex")
        self.assertEqual(data["imports"], [])
        self.assertNotIn("missing_import", {finding["kind"] for finding in data["findings"]})

    def test_import_cycle_and_outside_root_are_reported_without_opening(self):
        outside = Path(self.tmp.name) / "secret.md"
        outside.write_text("secret", encoding="utf-8")
        self.write("CLAUDE.md", "@a.md\n@../secret.md\n")
        self.write("a.md", "@CLAUDE.md\n")
        data = self.run_cli()
        kinds = {finding["kind"] for finding in data["findings"]}
        self.assertIn("cyclic_import", kinds)
        self.assertIn("import_outside_root", kinds)
        self.assertNotIn("secret.md", [f["path"] for f in data["files"]])

    def test_non_utf8_import_is_unreadable_not_loaded(self):
        self.write("CLAUDE.md", "@bad.md\n")
        (self.root / "bad.md").write_bytes(b"\xff\xfe")
        data = self.run_cli()
        self.assertEqual(data["imports"][0]["status"], "unreadable")
        self.assertNotIn("bad.md", [f["path"] for f in data["files"]])

    @unittest.skipUnless(hasattr(os, "symlink"), "symlinks unavailable")
    def test_import_cycle_uses_resolved_symlink_identity(self):
        source = self.write("CLAUDE.md", "@alias.md\n")
        os.symlink(source, self.root / "alias.md")
        data = self.run_cli()
        self.assertEqual(data["imports"][0]["status"], "cycle")

    @unittest.skipUnless(hasattr(os, "symlink"), "symlinks unavailable")
    def test_symlink_escape_and_directory_cycle_are_excluded(self):
        outside = Path(self.tmp.name) / "outside"
        outside.mkdir()
        (outside / "CLAUDE.md").write_text("outside", encoding="utf-8")
        os.symlink(outside / "CLAUDE.md", self.root / "CLAUDE.md")
        sub = self.root / "sub"
        sub.mkdir()
        os.symlink(self.root, sub / "loop")
        data = self.run_cli()
        reasons = {item["reason"] for item in data["exclusions"]}
        self.assertIn("symlink_cycle", reasons)
        self.assertIn("symlink_escape", {f["kind"] for f in data["findings"]})
        self.assertEqual(data["files"], [])

    @unittest.skipUnless(hasattr(os, "mkfifo"), "FIFO unavailable")
    def test_fifo_instruction_is_reported_without_being_opened(self):
        os.mkfifo(self.root / "CLAUDE.md")
        data = self.run_cli()
        self.assertEqual(data["files"], [])
        self.assertIn("non_regular_instruction", {item["kind"] for item in data["findings"]})

    def test_broken_links_detected_but_urls_anchors_and_code_ignored(self):
        self.write(
            "CLAUDE.md",
            "[bad](missing.md) [empty]() [web](https://example.com) [section](#ok)\n"
            "[phone](tel:+123) [data](data:text/plain,x)\n"
            "`[inline](inline-missing.md)`\n```md\n[fenced](fenced-missing.md)\n```\n",
        )
        data = self.run_cli()
        self.assertEqual([link["target"] for link in data["links"]], ["missing.md"])
        self.assertEqual(data["links"][0]["status"], "missing")
        self.assertEqual(data["status"], "findings")

    def test_fence_closes_only_with_same_marker_and_sufficient_length(self):
        self.write(
            "CLAUDE.md",
            "````md\n[hidden](one.md)\n```\n[still-hidden](two.md)\n~~~~\n"
            "[also-hidden](three.md)\n````\n[visible](visible-missing.md)\n",
        )
        links = self.run_cli()["links"]
        self.assertEqual([item["target"] for item in links], ["visible-missing.md"])

    def test_skips_dependencies_and_reports_each_exclusion(self):
        self.write("node_modules/pkg/CLAUDE.md")
        self.write("vendor/lib/CLAUDE.md")
        data = self.run_cli()
        self.assertEqual(data["files"], [])
        self.assertEqual({e["path"] for e in data["exclusions"]}, {"node_modules", "vendor"})

    @unittest.skipIf(hasattr(os, "geteuid") and os.geteuid() == 0, "root bypasses mode permissions")
    def test_directory_walk_error_becomes_finding(self):
        blocked = self.root / "blocked"
        blocked.mkdir()
        blocked.chmod(0)
        try:
            data = self.run_cli()
        finally:
            blocked.chmod(0o700)
        self.assertIn("directory_walk_error", {item["kind"] for item in data["findings"]})

    def test_exact_duplicates_only_across_active_relevant_files(self):
        line = "Use the exact repository formatter before submitting changes."
        self.write("CLAUDE.md", line + "\n")
        self.write("app/CLAUDE.md", line + "\n")
        self.write("sibling/CLAUDE.md", line + "\n")
        data = self.run_cli(target="app")
        self.assertEqual(len(data["duplicates"]), 1)
        self.assertEqual(data["duplicates"][0]["files"], ["CLAUDE.md", "app/CLAUDE.md"])
        self.assertEqual(data["duplicates"][0]["classification"], "candidate_exact_duplicate")

    def test_root_target_does_not_duplicate_independent_descendants(self):
        line = "Use the exact repository formatter before submitting changes."
        self.write("app/CLAUDE.md", line + "\n")
        self.write("docs/CLAUDE.md", line + "\n")
        data = self.run_cli()
        self.assertEqual(data["duplicates"], [])
        self.assertTrue(all(not item["active"] for item in data["files"]))

    def test_global_and_fallback_policy_are_explicitly_unknown(self):
        self.write("AGENTS.md")
        policy = self.run_cli("codex")["host_policy"]
        self.assertEqual(policy["fallback_instruction_names"], "unknown")
        self.assertEqual(policy["user_global_configuration"], "unknown_and_not_read")

    def test_target_outside_root_exits_two_without_json(self):
        outside = Path(self.tmp.name) / "outside"
        outside.mkdir()
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "--root", str(self.root), "--target", str(outside), "--host", "claude"],
            text=True, capture_output=True, timeout=10,
        )
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, "")
        self.assertIn("target must be under root", result.stderr)


if __name__ == "__main__":
    unittest.main()
