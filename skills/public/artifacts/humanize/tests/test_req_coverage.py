#!/usr/bin/env python3
"""RED tests for deterministic RFP requirement-ID coverage.

Run standalone with python3 test_req_coverage.py using standard-library unittest;
pytest is not required. Exit code: 0 all pass / 1 failure.
"""
import os
import subprocess
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SCRIPT = os.path.join(ROOT, "scripts", "req_coverage.py")
FIXTURES = os.path.join(HERE, "fixtures", "req_coverage")

REQS = os.path.join(FIXTURES, "reqs.txt")
PROPOSAL_FULL = os.path.join(FIXTURES, "proposal_full.md")
PROPOSAL_MISSING = os.path.join(FIXTURES, "proposal_missing.md")
PROPOSAL_BOUNDARY = os.path.join(FIXTURES, "proposal_boundary.md")


def run(*args):
    proc = subprocess.run(
        [sys.executable, SCRIPT, *args],
        capture_output=True,
        text=True,
    )
    return proc.returncode, proc.stdout, proc.stderr


class ReqCoverageTest(unittest.TestCase):
    def test_full_coverage_exit_0(self):
        code, out, err = run(
            "--requirements", REQS, "--proposal", PROPOSAL_FULL, "--json"
        )
        self.assertEqual(code, 0, msg=f"stdout={out!r} stderr={err!r}")
        self.assertIn('"coverage": 1.0', out)
        self.assertIn('"missing": 0', out)

    def test_missing_requirement_exit_1(self):
        code, out, err = run(
            "--requirements", REQS, "--proposal", PROPOSAL_MISSING, "--json"
        )
        self.assertEqual(code, 1, msg=f"stdout={out!r} stderr={err!r}")
        self.assertIn("SFR-003", out)

    def test_boundary_no_false_positive(self):
        """SFR-001 must be missing when only SFR-0011 appears.
        Do not incorrectly match it as a prefix of SFR-0011."""
        code, out, err = run(
            "--requirements", REQS, "--proposal", PROPOSAL_BOUNDARY, "--json"
        )
        self.assertEqual(code, 1, msg=f"stdout={out!r} stderr={err!r}")
        self.assertIn("SFR-001", out)
        # SFR-001 must count zero; do not match SFR-0011.
        self.assertIn('"SFR-001": 0', out)

    def test_missing_requirements_file_exit_2(self):
        code, out, err = run(
            "--requirements",
            os.path.join(FIXTURES, "does_not_exist.txt"),
            "--proposal",
            PROPOSAL_FULL,
        )
        self.assertEqual(code, 2, msg=f"stdout={out!r} stderr={err!r}")

    def test_missing_proposal_file_exit_2(self):
        code, out, err = run(
            "--requirements",
            REQS,
            "--proposal",
            os.path.join(FIXTURES, "does_not_exist.md"),
        )
        self.assertEqual(code, 2, msg=f"stdout={out!r} stderr={err!r}")

    def test_human_readable_output_full(self):
        code, out, err = run("--requirements", REQS, "--proposal", PROPOSAL_FULL)
        self.assertEqual(code, 0, msg=f"stdout={out!r} stderr={err!r}")
        self.assertIn("Requirements 5", out)
        self.assertIn("covered 5", out)
        self.assertIn("missing 0", out)
        self.assertIn("coverage 100.0%", out)
        self.assertIn("No missing requirements", out)

    def test_human_readable_output_missing(self):
        code, out, err = run("--requirements", REQS, "--proposal", PROPOSAL_MISSING)
        self.assertEqual(code, 1, msg=f"stdout={out!r} stderr={err!r}")
        self.assertIn("Missing:", out)
        self.assertIn("SFR-003", out)


if __name__ == "__main__":
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(unittest.TestLoader().loadTestsFromTestCase(ReqCoverageTest))
    sys.exit(0 if result.wasSuccessful() else 1)
