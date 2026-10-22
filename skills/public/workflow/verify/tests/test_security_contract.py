#!/usr/bin/env python3
"""Process-level negative controls for the structured security oracle."""
import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
SCRIPTS = HERE.parent / "scripts"


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


SECURITY = load_module("jstack_security_contract_test", SCRIPTS / "security_contract.py")
WORKFLOW = load_module("jstack_workflow_security_test", SCRIPTS / "workflow.py")


class SecurityOracleCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="jstack-security-oracle-")
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def loaded(self, body, *, expected=None, timeout=2.0):
        script = self.root / "oracle.py"
        script.write_text(body, encoding="utf-8")
        item = {
            "id": "EXEC-1", "findingId": "F-1", "requirementId": "REQ-1",
            "stage": "reproduce", "timeoutSeconds": timeout,
            "oracle": {"expected": expected or [{"name": "signal", "value": 7}]},
        }
        return {"findings": [{"id": "F-1", "status": "candidate",
                              "evidenceLevel": "static"}],
                "prepared": [{"spec": item, "cwd": self.root,
                              "command": f"{sys.executable} {script}"}]}

    @staticmethod
    def program(value, exit_code=0):
        return ("import json\n"
                f"print(json.dumps({value!r}))\n"
                f"raise SystemExit({exit_code})\n")

    def test_real_process_oracle_contract_rejects_each_empty_or_forged_axis(self):
        valid = {"executionId": "EXEC-1", "status": "passed",
                 "inputProcessed": True, "checksRun": 1,
                 "observations": [{"name": "signal", "value": 7, "passed": True}]}
        cases = {
            "empty-json": self.program({}),
            "zero-checks": self.program({**valid, "checksRun": 0}),
            "empty-observations": self.program({**valid, "observations": []}),
            "status-false": self.program({**valid, "status": "failed"}),
            "expected-mismatch": self.program({
                **valid, "observations": [{"name": "signal", "value": 8,
                                            "passed": True}]}),
            "wrong-execution-id": self.program({**valid, "executionId": "FORGED"}),
            "nonzero": self.program(valid, exit_code=9),
            "bool-checks": self.program({**valid, "checksRun": True}),
        }
        for name, body in cases.items():
            with self.subTest(name=name):
                result = SECURITY.execute(self.loaded(body), WORKFLOW.run_command)
                self.assertFalse(result["passed"])
                self.assertFalse(result["executions"][0]["passed"])
        timeout = SECURITY.execute(
            self.loaded("import time\ntime.sleep(5)\n", timeout=0.05),
            WORKFLOW.run_command)
        self.assertFalse(timeout["passed"])
        self.assertTrue(timeout["executions"][0]["run"]["timedOut"])

    def test_valid_real_process_is_the_positive_control(self):
        valid = {"executionId": "EXEC-1", "status": "passed",
                 "inputProcessed": True, "checksRun": 1,
                 "observations": [{"name": "signal", "value": 7, "passed": True}]}
        result = SECURITY.execute(self.loaded(self.program(valid)), WORKFLOW.run_command)
        self.assertTrue(result["passed"])
        self.assertEqual(result["executionCount"], 1)
        self.assertEqual(result["findingResults"][0]["observedStatus"], "confirmed")

    def test_forced_true_judgment_is_detected_by_the_same_negative_control(self):
        mutant_path = self.root / "security_contract_mutant.py"
        source = (SCRIPTS / "security_contract.py").read_text(encoding="utf-8")
        needle = "        ok = bool(isinstance(oracle, dict)\n"
        self.assertIn(needle, source)
        mutant_path.write_text(source.replace(
            needle, "        ok = True or bool(isinstance(oracle, dict)\n", 1),
            encoding="utf-8")
        mutant = load_module("jstack_security_contract_mutant", mutant_path)
        invalid = self.loaded(self.program({}))
        self.assertFalse(SECURITY.execute(invalid, WORKFLOW.run_command)["passed"])
        self.assertTrue(mutant.execute(invalid, WORKFLOW.run_command)["passed"],
                        "negative control must kill an always-true judgment mutant")


if __name__ == "__main__":
    unittest.main(verbosity=2)
