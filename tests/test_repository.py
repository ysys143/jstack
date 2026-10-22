#!/usr/bin/env python3
"""Independent deletion and duplicate-source controls for repository integrity."""

import importlib.util
import json
from pathlib import Path
import tempfile
import contextlib
import io
import subprocess
import sys
from unittest.mock import patch
import unittest

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location(
    "canonical", ROOT / "scripts/check_suite_lib_parity.py"
)
canonical = importlib.util.module_from_spec(spec)
spec.loader.exec_module(canonical)


class CanonicalTests(unittest.TestCase):
    def fixture(self, root, source=True):
        rows = [
            {"source": "skills/_suite_lib.py", "target": "skills/_suite_lib.py"},
            {"source": "scripts/run_suites.sh", "target": "scripts/run_suites.sh"},
            {
                "source": "hosts/claude/hooks/block_emoji.py",
                "target": "hooks/block_emoji.py",
            },
        ]
        for row in rows:
            path = root / row["source" if source else "target"]
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("fixture\n")
        (root / "packaging").mkdir()
        (root / "packaging/package-files.json").write_text(json.dumps({"files": rows}))

    def test_valid_source_and_payload(self):
        for source in (True, False):
            with tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                self.fixture(root, source)
                self.assertEqual(canonical.check(root), [])

    def test_missing_and_empty_canonical_file(self):
        for empty in (True, False):
            with tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                self.fixture(root)
                path = root / "skills/_suite_lib.py"
                path.write_text("") if empty else path.unlink()
                self.assertTrue(
                    any("missing or empty" in p for p in canonical.check(root))
                )

    def test_duplicate_library(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.fixture(root)
            path = root / "skills/other/_suite_lib.py"
            path.parent.mkdir()
            path.write_text("duplicate")
            self.assertTrue(
                any("duplicate suite library" in p for p in canonical.check(root))
            )

    def test_membership_binding_drift(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.fixture(root)
            path = root / "packaging/package-files.json"
            doc = json.loads(path.read_text())
            doc["files"][0]["source"] = "skills/elsewhere.py"
            path.write_text(json.dumps(doc))
            self.assertTrue(any("not unique" in p for p in canonical.check(root)))

    def test_retired_tree(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.fixture(root)
            (root / "staging").mkdir()
            self.assertTrue(
                any("retired source tree" in p for p in canonical.check(root))
            )


class MigratedGateTests(unittest.TestCase):
    def load(self, filename):
        spec = importlib.util.spec_from_file_location(
            filename[:-3], ROOT / "scripts" / filename
        )
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_reference_checker_rejects_crash_empty_and_hygiene(self):
        gate = self.load("check_paths_regression.py")
        samples = [
            (0, "", ""),
            (1, "[FAIL] did not measure", ""),
            (1, "참조 1건 / 실재 1건 / MISS 0건\n위생 위반 1건", ""),
            (1, "", "Traceback (most recent call last)"),
        ]
        for rc, stdout, stderr in samples:
            with (
                patch.object(
                    gate.subprocess,
                    "run",
                    return_value=subprocess.CompletedProcess([], rc, stdout, stderr),
                ),
                contextlib.redirect_stdout(io.StringIO()),
            ):
                self.assertEqual(gate.main(), 2)

    def test_reference_checker_accepts_measurement_and_rejects_new_reference(self):
        gate = self.load("check_paths_regression.py")
        for rc, output, expected in (
            (0, "참조 1건 / 실재 1건 / MISS 0건", 0),
            (
                1,
                "참조 1건 / 실재 0건 / MISS 1건\n  missing/new.py\n    <- skills/sample/SKILL.md",
                1,
            ),
        ):
            with (
                patch.object(
                    gate.subprocess,
                    "run",
                    return_value=subprocess.CompletedProcess([], rc, output, ""),
                ),
                contextlib.redirect_stdout(io.StringIO()),
            ):
                self.assertEqual(gate.main(), expected)

    def test_attribution_discovers_rules_and_rejects_empty_population(self):
        gate = self.load("check_attribution.py")
        text = (ROOT / gate.TAXONOMY).read_text()
        self.assertEqual(
            set(gate.PORTED_HEAD.findall(text)), {"A-20", "A-21", "F-6", "F-7"}
        )
        original = gate.read
        with (
            patch.object(sys, "argv", ["check_attribution.py", str(ROOT)]),
            contextlib.redirect_stdout(io.StringIO()),
        ):
            self.assertEqual(gate.main(), 0)
            with patch.object(
                gate,
                "read",
                side_effect=lambda root, rel: "# No adapted rules\n"
                if rel == gate.TAXONOMY
                else original(root, rel),
            ):
                self.assertEqual(gate.main(), 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)
