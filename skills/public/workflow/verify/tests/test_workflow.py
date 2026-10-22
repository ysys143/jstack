#!/usr/bin/env python3
"""End-to-end checks for the one-task workflow runner."""
import copy
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import unittest

HERE = Path(__file__).resolve().parent
WORKFLOW = HERE.parent / "scripts/workflow.py"


class WorkflowCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix="jstack-workflow-test-")
        self.repo = Path(self.tmp)
        self.call("git", "init", "-q")
        (self.repo / "app.py").write_text(
            "def add(a, b):\n    return a - b\n", encoding="utf-8")
        (self.repo / "test_app.py").write_text(
            "from app import add\nassert add(2, 3) == 5\n", encoding="utf-8")
        (self.repo / "red_check.py").write_text(
            "import pathlib, subprocess, sys\n"
            "root = pathlib.Path(sys.argv[1])\n"
            "(root / 'app.py').write_text('def add(a, b):\\n    return 0\\n')\n"
            "run = subprocess.run([sys.executable, str(root / 'test_app.py')], cwd=root)\n"
            "raise SystemExit(0 if run.returncode != 0 else 1)\n",
            encoding="utf-8")
        self.contract = {
            "계약버전": 2, "작업ID": "bug-1", "발동": "사용자", "위임": "필요",
            "준비": [{"도구": "python3", "확인명령": "python3 --version"}],
            "산출": [{"경로": "app.py", "형식": "Python"}],
            "검증": [{
                "요구ID": "ADD-1", "사용자행동": "return the sum of two numbers",
                "관련파일": ["app.py", "test_app.py", "red_check.py"],
                "등급": "기계",
                "명령": {"실행": "python3 test_app.py", "기대종료": 0},
                "반증": {
                    "실행": "python3 red_check.py {RED_ROOT}", "기대종료": 0},
                "인간검토": "불필요",
                "추가검토": [{"종류": "cold-read", "적용": "필요"}],
            }],
        }
        self.write_contract()
        self.call("git", "add", "app.py", "test_app.py", "red_check.py",
                  "contract.yaml")
        self.call("git", "-c", "user.name=test", "-c",
                  "user.email=test@example.invalid", "commit", "-qm", "base")

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def call(self, *args, expect=0):
        run = subprocess.run(args, cwd=self.repo, capture_output=True, text=True)
        self.assertEqual(run.returncode, expect, run.stdout + run.stderr)
        return run

    def workflow(self, action, *args, expect=0):
        return self.call(sys.executable, str(WORKFLOW), action, "bug-1",
                         *args, expect=expect)

    def write_contract(self):
        (self.repo / "contract.yaml").write_text(
            json.dumps(self.contract, ensure_ascii=False), encoding="utf-8")

    def init_ready(self, brief=True):
        self.workflow("init", "contract.yaml")
        self.workflow("preflight")
        if brief:
            self.workflow("brief")

    def fix(self):
        (self.repo / "app.py").write_text(
            "def add(a, b):\n    return a + b\n", encoding="utf-8")

    def configure_security(self):
        security = self.repo / "security"
        (security / "baseline").mkdir(parents=True)
        (security / "inputs/F-1").mkdir(parents=True)
        shutil.copy2(self.repo / "app.py", security / "baseline/app.py")
        (security / "inputs/F-1/poc.txt").write_text("2,3\n", encoding="utf-8")
        (security / "inputs/F-1/variant.txt").write_text("4,5\n", encoding="utf-8")
        oracle = self.repo / "security_oracle.py"
        oracle.write_text(
            "import argparse,json,pathlib,subprocess,sys\n"
            "p=argparse.ArgumentParser();p.add_argument('--execution-id');"
            "p.add_argument('--expected-vulnerable');p.add_argument('--input');"
            "p.add_argument('--target-root');a=p.parse_args()\n"
            "values=[int(x) for x in pathlib.Path(a.input).read_text().strip().split(',')]\n"
            "code='from app import add; print(add(%d,%d))'%tuple(values)\n"
            "r=subprocess.run([sys.executable,'-c',code],cwd=a.target_root,capture_output=True,text=True)\n"
            "actual=int(r.stdout.strip()) if r.returncode==0 else None\n"
            "expected=int(a.expected_vulnerable)\n"
            "print(json.dumps({'executionId':a.execution_id,'status':'passed' if actual==expected else 'failed',"
            "'inputProcessed':len(values)==2,'checksRun':1,"
            "'observations':[{'name':'result','value':actual,'passed':actual==expected}]}))\n",
            encoding="utf-8")
        oracle_hash = hashlib.sha256(oracle.read_bytes()).hexdigest()
        expected_by_stage = {"reproduce": -1, "fix-reproduce": 5,
                             "regression": 5, "variant": 9}
        review = {"oraclePath": "security_oracle.py", "oracleSha256": oracle_hash,
                  "expected": [{"name": "result", "value": -1}],
                  "verdict": "pass", "reviewedBy": "test-reviewer"}
        (security / "oracle-review.json").write_text(
            json.dumps(review), encoding="utf-8")
        executions = []
        for stage, expected in expected_by_stage.items():
            review_path = security / f"oracle-review-{stage}.json"
            one_review = dict(review)
            one_review["expected"] = [{"name": "result", "value": expected}]
            review_path.write_text(json.dumps(one_review), encoding="utf-8")
            executions.append({
                "id": f"F-1-{stage}", "findingId": "F-1", "requirementId": "ADD-1",
                "stage": stage, "targetState": "original" if stage == "reproduce" else "current",
                "executionBoundary": "trusted-local",
                "cwd": "security/baseline" if stage == "reproduce" else ".",
                "timeoutSeconds": 5,
                "prerequisites": [{"name": "python", "argv": [sys.executable, "--version"],
                                   "expectedExit": 0}],
                "environmentRequirements": [{"name": "fixture", "argv": [sys.executable, "-c", "pass"],
                                             "expectedExit": 0}],
                "input": {"path": ("security/inputs/F-1/variant.txt" if stage == "variant"
                                    else "security/inputs/F-1/poc.txt"),
                          "sha256": hashlib.sha256((security / "inputs/F-1" /
                              ("variant.txt" if stage == "variant" else "poc.txt")).read_bytes()).hexdigest()},
                "oracle": {"path": "security_oracle.py", "sha256": oracle_hash,
                           "runtimeArgv": [sys.executable],
                           "argv": ["--execution-id", f"F-1-{stage}",
                                    "--expected-vulnerable", str(expected)],
                           "expected": [{"name": "result", "value": expected}],
                           "review": f"security/oracle-review-{stage}.json"},
            })
        scope = {
            "schemaVersion": 1, "taskId": "bug-1",
            "target": {"ref": "working-tree",
                       "files": [{"path": "app.py", "sha256": hashlib.sha256(
                           (self.repo / "app.py").read_bytes()).hexdigest()}],
                       "baseline": {"ref": "fixture-vulnerable",
                           "files": [{"path": "security/baseline/app.py", "sha256": hashlib.sha256(
                               (security / "baseline/app.py").read_bytes()).hexdigest()}]}},
            "threatModel": {"assets": ["calculation"], "entryPoints": ["add"],
                            "attacker": ["caller"], "boundaries": ["function"],
                            "assumptions": [{"claim": "trusted fixture", "source": "test"}]},
            "findingsPath": "security/findings.json", "executions": executions,
        }
        (security / "scope.json").write_text(json.dumps(scope), encoding="utf-8")
        (security / "findings.json").write_text(json.dumps({
            "schemaVersion": 1, "taskId": "bug-1", "findings": [{
                "id": "F-1", "status": "candidate", "evidenceLevel": "static",
                "requirementId": "ADD-1"}]}), encoding="utf-8")
        self.contract["보안검증"] = {"명세": "security/scope.json", "요구ID": ["ADD-1"]}
        self.contract["검증"][0]["추가검토"].append(
            {"종류": "평가독립성", "적용": "필요"})
        self.contract["검증"][0]["관련파일"].append("security_oracle.py")
        self.write_contract()

    def add_review(self):
        (self.repo / "review.txt").write_text(
            "Cold read checked ADD-1 against app.py.\n", encoding="utf-8")
        self.workflow("record-review", "ADD-1", "cold-read",
                      "--raw-output", "review.txt",
                      "--verdict", "pass")

    def complete(self):
        self.init_ready()
        self.fix()
        self.add_review()
        self.workflow("verify")
        return self.workflow("status")

    def test_full_plan_delegate_interrupt_resume_verify(self):
        self.init_ready()
        self.fix()
        (self.repo / "cursor.txt").write_text("app.py\n", encoding="utf-8")
        self.workflow("interrupt", "--cursor-file", "cursor.txt",
                      "--evidence", "app.py")
        resumed = json.loads(self.workflow("resume").stdout)
        self.assertTrue(resumed["resumed"])
        self.assertEqual(resumed["cursor"]["path"], "cursor.txt")
        before = hashlib.sha256((self.repo / "app.py").read_bytes()).hexdigest()
        self.add_review()
        result = json.loads(self.workflow("verify").stdout)
        self.assertTrue(result["verified"])
        self.assertEqual(
            before, hashlib.sha256((self.repo / "app.py").read_bytes()).hexdigest())
        self.assertTrue(json.loads(self.workflow("status").stdout)["complete"])

    def test_simple_task_skips_delegation_brief(self):
        self.contract["위임"] = "불필요"
        self.contract["검증"][0]["추가검토"] = []
        self.write_contract()
        self.call("git", "add", "contract.yaml")
        self.call("git", "-c", "user.name=test", "-c",
                  "user.email=test@example.invalid", "commit", "-qm", "simple")
        self.init_ready(brief=False)
        self.fix()
        self.workflow("verify")
        self.workflow("status")

    def test_missing_review_blocks_completion(self):
        self.init_ready()
        self.fix()
        result = json.loads(self.workflow("verify", expect=1).stdout)
        self.assertEqual(result["missingReviews"], ["ADD-1:cold-read"])
        self.workflow("status", expect=1)

    def test_preflight_checks_readiness_without_running_tests(self):
        marker = self.repo / "marker"
        self.contract["검증"][0]["명령"]["실행"] = (
            "python3 -c \"open('marker','w').write('positive')\"")
        self.contract["검증"][0]["반증"]["실행"] = (
            "python3 -c \"open('{RED_ROOT}/marker','w').write('red')\"")
        self.write_contract()
        self.call("git", "add", "contract.yaml")
        self.call("git", "-c", "user.name=test", "-c",
                  "user.email=test@example.invalid", "commit", "-qm", "commands")
        self.workflow("init", "contract.yaml")
        self.workflow("preflight")
        self.assertFalse(marker.exists())

    def test_missing_tool_blocks_preflight(self):
        self.contract["준비"][0]["도구"] = "jstack-tool-that-does-not-exist"
        self.write_contract()
        self.call("git", "add", "contract.yaml")
        self.call("git", "-c", "user.name=test", "-c",
                  "user.email=test@example.invalid", "commit", "-qm", "missing")
        self.workflow("init", "contract.yaml")
        self.workflow("preflight", expect=1)

    def test_positive_failure_blocks_completion(self):
        self.init_ready()
        self.add_review()
        self.workflow("verify", expect=1)
        self.workflow("status", expect=1)

    def test_empty_requirements_are_rejected_at_init(self):
        self.contract["검증"] = []
        self.write_contract()
        self.workflow("init", "contract.yaml", expect=1)
        self.assertFalse((self.repo / ".jstack/tasks/bug-1").exists())

    def test_contract_change_invalidates_all_receipts(self):
        self.complete()
        task_contract = self.repo / ".jstack/tasks/bug-1/contract.yaml"
        task_contract.write_text(task_contract.read_text() + "\n", encoding="utf-8")
        result = json.loads(self.workflow("status", expect=1).stdout)
        self.assertIn("contract changed after initialization", result["problems"][0])

    def test_file_change_makes_receipt_stale(self):
        self.complete()
        (self.repo / "app.py").write_text(
            "def add(a, b):\n    return a + b + 1\n", encoding="utf-8")
        result = json.loads(self.workflow("status", expect=1).stdout)
        self.assertIn("target-stale", result["problems"])

    def test_receipt_edit_is_detected(self):
        self.complete()
        state = json.loads((self.repo / ".jstack/tasks/bug-1/state.json").read_text())
        receipt = self.repo / ".jstack/tasks/bug-1" / state["latestReceipt"]
        receipt.write_text(receipt.read_text() + "\n", encoding="utf-8")
        result = json.loads(self.workflow("status", expect=1).stdout)
        self.assertIn("receipt-digest", result["problems"])

    def test_stale_interrupt_evidence_refuses_resume(self):
        self.init_ready()
        self.fix()
        (self.repo / "cursor.txt").write_text("app.py\n", encoding="utf-8")
        self.workflow("interrupt", "--cursor-file", "cursor.txt",
                      "--evidence", "app.py")
        (self.repo / "app.py").write_text("changed after interruption\n",
                                          encoding="utf-8")
        result = json.loads(self.workflow("resume", expect=1).stdout)
        self.assertFalse(result["resumed"])
        self.assertIn("app.py", result["staleEvidence"])

    def test_verify_runs_linter_before_task_metadata(self):
        self.init_ready()
        task_contract = self.repo / ".jstack/tasks/bug-1/contract.yaml"
        task_contract.write_text(": invalid: [", encoding="utf-8")
        result = json.loads(self.workflow("verify", expect=1).stdout)
        self.assertEqual(result["reason"], "contract-lint")

    def test_review_bytes_and_reviewed_file_are_bound(self):
        self.complete()
        (self.repo / "review.txt").write_text("changed review\n", encoding="utf-8")
        result = json.loads(self.workflow("status", expect=1).stdout)
        self.assertIn("review-stale:ADD-1:cold-read", result["problems"])

    def test_review_cannot_omit_a_requirement_file(self):
        self.init_ready()
        (self.repo / "review.txt").write_text("partial\n", encoding="utf-8")
        self.workflow("record-review", "ADD-1", "cold-read",
                      "--raw-output", "review.txt", "--reviewed-file", "app.py",
                      "--verdict", "pass", expect=2)

    def test_preflight_and_brief_bytes_remain_bound(self):
        self.complete()
        preflight = self.repo / ".jstack/tasks/bug-1/preflight.json"
        original = preflight.read_bytes()
        preflight.write_bytes(original + b"\n")
        result = json.loads(self.workflow("status", expect=1).stdout)
        self.assertIn("preflight-stale", result["problems"])
        preflight.write_bytes(original)
        brief = self.repo / ".jstack/tasks/bug-1/brief.json"
        brief.write_bytes(brief.read_bytes() + b"\n")
        result = json.loads(self.workflow("status", expect=1).stdout)
        self.assertIn("brief-stale", result["problems"])

    def test_coordinator_runtime_identity_remains_bound(self):
        self.complete()
        root = self.repo / ".jstack/tasks/bug-1"
        state_path = root / "state.json"
        state = json.loads(state_path.read_text())
        receipt_path = root / state["latestReceipt"]
        receipt = json.loads(receipt_path.read_text())
        receipt["coordinatorPackage"]["runtimeDigest"] = "sha256:stale"
        receipt_path.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n")
        state["latestReceiptSha256"] = hashlib.sha256(receipt_path.read_bytes()).hexdigest()
        state_path.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n")
        result = json.loads(self.workflow("status", expect=1).stdout)
        self.assertIn("coordinator-package-stale", result["problems"])

    def test_timeout_kills_the_command_process_group(self):
        (self.repo / "hang.py").write_text(
            "import subprocess, sys, time\n"
            "subprocess.Popen([sys.executable, '-c', \"import pathlib,time;"
            "time.sleep(.5);pathlib.Path('child-marker').write_text('late')\"])\n"
            "time.sleep(10)\n", encoding="utf-8")
        self.contract["위임"] = "불필요"
        self.contract["검증"][0]["추가검토"] = []
        self.contract["검증"][0]["관련파일"].append("hang.py")
        self.contract["검증"][0]["명령"]["실행"] = "python3 hang.py"
        self.write_contract()
        self.call("git", "add", "contract.yaml", "hang.py")
        self.call("git", "-c", "user.name=test", "-c",
                  "user.email=test@example.invalid", "commit", "-qm", "timeout")
        self.init_ready(brief=False)
        self.fix()
        result = json.loads(self.workflow(
            "verify", "--timeout-seconds", "0.1", expect=1).stdout)
        receipt = json.loads((self.repo / result["receipt"]).read_text())
        positive = receipt["requirements"][0]["positive"]
        self.assertTrue(positive["timedOut"])
        self.assertEqual(positive["exitCode"], 124)
        time.sleep(0.7)
        self.assertFalse((self.repo / "child-marker").exists())

    def test_security_original_fix_variant_and_live_invalidation(self):
        self.configure_security()
        self.call("git", "add", "contract.yaml", "security_oracle.py", "security")
        self.call("git", "-c", "user.name=test", "-c",
                  "user.email=test@example.invalid", "commit", "-qm", "security")
        self.init_ready()
        self.fix()
        self.add_review()
        (self.repo / "security-review.txt").write_text(
            "Independent security oracle and expected values reviewed.\n", encoding="utf-8")
        self.workflow("record-review", "ADD-1", "평가독립성",
                      "--raw-output", "security-review.txt", "--verdict", "pass")
        result = json.loads(self.workflow("verify").stdout)
        receipt = json.loads((self.repo / result["receipt"]).read_text())
        self.assertTrue(receipt["security"]["passed"])
        self.assertEqual(receipt["security"]["executionCount"], 4)
        self.assertEqual(receipt["security"]["findingResults"], [{
            "findingId": "F-1", "inputStatus": "candidate",
            "inputEvidenceLevel": "static", "observedStatus": "confirmed",
            "evidenceLevel": "execution", "evidenceExecutionId": "F-1-reproduce",
            "fixed": True}])
        self.assertTrue(json.loads(self.workflow("status").stdout)["complete"])
        (self.repo / ".jstack/tasks/bug-1/security/inputs/F-1/poc.txt").write_text(
            "forged\n", encoding="utf-8")
        stale = json.loads(self.workflow("status", expect=1).stdout)
        self.assertIn("security-stale", stale["problems"])

    def test_security_rejects_preattested_confirmed_finding(self):
        self.configure_security()
        findings = self.repo / "security/findings.json"
        value = json.loads(findings.read_text())
        value["findings"][0].update({"status": "confirmed",
                                      "evidenceLevel": "execution"})
        findings.write_text(json.dumps(value), encoding="utf-8")
        self.workflow("init", "contract.yaml", expect=2)
        self.assertFalse((self.repo / ".jstack/tasks/bug-1").exists())

    def test_security_execution_requirement_must_match_its_finding(self):
        self.configure_security()
        second = copy.deepcopy(self.contract["검증"][0])
        second["요구ID"] = "ADD-2"
        self.contract["검증"].append(second)
        self.contract["보안검증"]["요구ID"].append("ADD-2")
        self.write_contract()
        scope_path = self.repo / "security/scope.json"
        scope = json.loads(scope_path.read_text())
        scope["executions"][0]["requirementId"] = "ADD-2"
        scope_path.write_text(json.dumps(scope), encoding="utf-8")
        self.workflow("init", "contract.yaml", expect=2)
        self.assertFalse((self.repo / ".jstack/tasks/bug-1").exists())

    def test_security_execution_cwd_must_contain_a_bound_target(self):
        self.configure_security()
        (self.repo / "unrelated").mkdir()
        scope_path = self.repo / "security/scope.json"
        scope = json.loads(scope_path.read_text())
        current = next(x for x in scope["executions"]
                       if x["targetState"] == "current")
        current["cwd"] = "unrelated"
        scope_path.write_text(json.dumps(scope), encoding="utf-8")
        self.workflow("init", "contract.yaml", expect=2)
        self.assertFalse((self.repo / ".jstack/tasks/bug-1").exists())

    def test_failed_original_reproduction_is_inconclusive_and_not_complete(self):
        self.configure_security()
        scope_path = self.repo / "security/scope.json"
        scope = json.loads(scope_path.read_text())
        reproduce = next(x for x in scope["executions"] if x["stage"] == "reproduce")
        reproduce["oracle"]["expected"] = [{"name": "result", "value": 999}]
        review_path = self.repo / reproduce["oracle"]["review"]
        review = json.loads(review_path.read_text())
        review["expected"] = reproduce["oracle"]["expected"]
        review_path.write_text(json.dumps(review), encoding="utf-8")
        scope_path.write_text(json.dumps(scope), encoding="utf-8")
        self.call("git", "add", "contract.yaml", "security_oracle.py", "security")
        self.call("git", "-c", "user.name=test", "-c",
                  "user.email=test@example.invalid", "commit", "-qm", "security-fail")
        self.init_ready()
        self.fix()
        self.add_review()
        (self.repo / "security-review.txt").write_text("Independent review.\n")
        self.workflow("record-review", "ADD-1", "평가독립성",
                      "--raw-output", "security-review.txt", "--verdict", "pass")
        result = json.loads(self.workflow("verify", expect=1).stdout)
        receipt = json.loads((self.repo / result["receipt"]).read_text())
        finding = receipt["security"]["findingResults"][0]
        self.assertEqual(finding["observedStatus"], "inconclusive")
        self.assertEqual(finding["evidenceLevel"], "execution")
        self.assertEqual(finding["evidenceExecutionId"], "F-1-reproduce")
        self.assertFalse(finding["fixed"])
        self.workflow("status", expect=1)


if __name__ == "__main__":
    unittest.main()
