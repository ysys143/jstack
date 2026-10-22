#!/usr/bin/env python3
"""Trusted-local language fixtures for the optional security contract.

The fixture oracle measures subprocess output. Expected answers live in a
separate frozen table so a checker cannot make its own answer true by returning
a constant. This is a deterministic fixture check, not a general scanner claim.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve()
FIXTURES = HERE.parent / "fixtures" / "security"
sys.path.insert(0, str(HERE.parents[1] / "scripts"))
import security_contract  # noqa: E402
import workflow  # noqa: E402


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


LANGUAGES = {
    "python": {"runtime": "python3", "ext": ".py", "vulnerable": "path_access_vulnerable.py", "normal": "path_access.py", "shallow": "path_access_shallow.py"},
    "javascript": {"runtime": "node", "ext": ".js", "vulnerable": "authorize_vulnerable.js", "normal": "authorize.js", "shallow": "authorize_shallow.js"},
    "go": {"runtime": "go", "ext": ".go", "vulnerable": "range_vulnerable.go", "normal": "range.go", "shallow": "range_shallow.go"},
}


class SecurityLanguageFixtures(unittest.TestCase):
    def run_program(self, language, source, argument, root):
        if language == "go":
            command = ["go", "run", str(source), argument]
        else:
            command = [LANGUAGES[language]["runtime"], str(source), argument]
        result = subprocess.run(command, cwd=root, capture_output=True, text=True, check=True)
        return result.stdout.strip()

    def test_language_fixture_matrix_and_four_stage_contract(self):
        expected = json.loads((FIXTURES / "expected.json").read_text())
        for language, meta in LANGUAGES.items():
            with self.subTest(language=language):
                self.assertIsNotNone(shutil.which(meta["runtime"]))
                for variant in ("vulnerable", "normal", "shallow"):
                    source = FIXTURES / language / meta[variant]
                    for argument, answer in expected[language][variant].items():
                        self.assertEqual(self.run_program(language, source, argument, FIXTURES), answer)

                cases = {
                    "python": {"attack": "../canary.txt", "normal": "inside.txt", "variant": "..%2fcanary.txt"},
                    "javascript": {"attack": "guest", "normal": "admin", "variant": "visitor"},
                    "go": {"attack": "-1", "normal": "5", "variant": "-2"},
                }[language]

                # Build a task-relative security spec for the normal fixture.
                with tempfile.TemporaryDirectory(prefix=f"jstack-security-{language}-") as td:
                    task = Path(td) / "task"
                    repo = Path(td) / "repo"
                    (task / "security" / "inputs").mkdir(parents=True)
                    (repo / language).mkdir(parents=True)
                    current = repo / language / f"program{meta['ext']}"
                    baseline = task / "security" / f"baseline{meta['ext']}"
                    (task / language).mkdir(parents=True)
                    shutil.copy2(FIXTURES / language / meta["normal"], current)
                    shutil.copy2(FIXTURES / language / meta["vulnerable"], baseline)
                    shutil.copy2(baseline, task / language / f"program{meta['ext']}")
                    if language == "python":
                        (repo / language / "inside.txt").write_text("safe fixture")
                    if language == "python":
                        (task / "canary.txt").write_text("synthetic canary")
                        (task / language / "inside.txt").write_text("safe fixture")
                    input_paths = {}
                    for name, value in cases.items():
                        input_paths[name] = task / "security" / "inputs" / f"{name}.txt"
                        input_paths[name].write_text(value)
                    oracle = task / "security" / "oracle.py"
                    oracle.write_text(self._oracle_source(language))
                    (repo / "security").mkdir(parents=True)
                    repo_oracle = repo / "security" / "oracle.py"
                    shutil.copy2(oracle, repo_oracle)
                    findings = task / "security" / "findings.json"
                    findings.write_text(json.dumps({"schemaVersion": 1, "taskId": language, "findings": [{"id": "F-1", "status": "candidate", "evidenceLevel": "static", "requirementId": "SEC-1"}]}))
                    executions = []
                    stage_cases = (("reproduce", "original", "attack"), ("fix-reproduce", "current", "attack"), ("regression", "current", "normal"), ("variant", "current", "variant"))
                    for index, (stage, target_state, case_name) in enumerate(stage_cases):
                        execution_id = f"{language}-{index}"
                        expected_value = expected[language]["vulnerable" if target_state == "original" else "normal"][cases[case_name]]
                        review = task / "security" / f"oracle-review-{execution_id}.json"
                        observed_expected = [{"name": "observed", "value": expected_value}]
                        review.write_text(json.dumps({"oraclePath": "security/oracle.py", "oracleSha256": sha(repo_oracle), "expected": observed_expected, "verdict": "pass", "reviewedBy": "fixture-review"}))
                        executions.append({"id": execution_id, "findingId": "F-1", "requirementId": "SEC-1", "stage": stage, "targetState": target_state, "executionBoundary": "trusted-local", "cwd": ".", "timeoutSeconds": 30, "prerequisites": [{"name": "runtime", "argv": (["go", "version"] if language == "go" else [meta["runtime"], "--version"]), "expectedExit": 0}], "environmentRequirements": [{"name": "trustedfixture", "argv": ["true"], "expectedExit": 0}], "input": {"path": f"security/inputs/{case_name}.txt", "sha256": sha(input_paths[case_name])}, "oracle": {"path": "security/oracle.py", "sha256": sha(repo_oracle), "argv": ["--execution-id", execution_id], "runtimeArgv": ["python3"], "expected": observed_expected, "review": f"security/oracle-review-{execution_id}.json"}})
                    program_name = f"program{meta['ext']}"
                    spec = {"schemaVersion": 1, "taskId": language, "target": {"ref": "current", "files": [{"path": f"{language}/{program_name}", "sha256": sha(current)}], "baseline": {"ref": "original", "files": [{"path": f"{language}/{program_name}", "sha256": sha(task / language / program_name)}]}}, "threatModel": {"assets": ["protected resource"], "entryPoints": ["fixture argv"], "attacker": "untrusted input", "boundaries": ["root/range/role check"], "assumptions": [{"claim": "trusted local fixture", "source": "test fixture"}]}, "findingsPath": "security/findings.json", "executions": executions}
                    (task / "security" / "scope.json").write_text(json.dumps(spec))
                    contract = {"계약버전": 2, "작업ID": language, "보안검증": {"명세": "security/scope.json", "요구ID": ["SEC-1"]}, "검증": [{"요구ID": "SEC-1", "추가검토": [{"종류": "평가독립성", "적용": "필요"}]}]}
                    loaded = security_contract.load(task, repo, contract)
                    preflight = security_contract.preflight(loaded, workflow.run_command)
                    self.assertTrue(preflight["passed"], preflight)
                    result = security_contract.execute(loaded, workflow.run_command)
                    self.assertEqual(result["executionCount"], 4)
                    self.assertTrue(result["passed"], result)
                    self.assertEqual(result["findingResults"][0]["observedStatus"], "confirmed")
                    self.assertEqual(result["findingResults"][0]["evidenceLevel"], "execution")
                    (task / "security" / "raw-results.json").write_text(json.dumps(result, default=str))

                    shutil.copy2(FIXTURES / language / meta["shallow"], current)
                    spec["target"]["files"][0]["sha256"] = sha(current)
                    (task / "security" / "scope.json").write_text(json.dumps(spec))
                    shallow_loaded = security_contract.load(task, repo, contract)
                    shallow_result = security_contract.execute(shallow_loaded, workflow.run_command)
                    (task / "security" / "raw-results-shallow.json").write_text(json.dumps(shallow_result, default=str))
                    self.assertFalse(shallow_result["passed"], shallow_result)
                    print(json.dumps({"language": language, "normal": result, "shallow": shallow_result}, ensure_ascii=False))
                    self.assertTrue(any(row["stage"] == "variant" and not row["passed"] for row in shallow_result["executions"]))

    @staticmethod
    def _oracle_source(language):
        # The oracle runs the target program and reports its observed output.
        return f'''import json, subprocess, sys\ninput_value = open(sys.argv[sys.argv.index("--input") + 1]).read().strip()\ntarget = sys.argv[sys.argv.index("--target-root") + 1]\nexecution_id = sys.argv[sys.argv.index("--execution-id") + 1]\nsource = target + "/{language}/program{LANGUAGES[language]["ext"]}"\ncmd = [{LANGUAGES[language]["runtime"]!r}, source, input_value]\nif {language!r} == "go": cmd = ["go", "run", source, input_value]\nr = subprocess.run(cmd, capture_output=True, text=True, check=True)\nprint(json.dumps({{"executionId": execution_id, "status": "passed", "inputProcessed": True, "checksRun": 1, "observations": [{{"name": "observed", "value": r.stdout.strip(), "passed": True}}]}}))\n'''


if __name__ == "__main__":
    unittest.main()
