#!/usr/bin/env python3
"""Executable schema checks for workflow contract version 2."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/contract_lint.py"
SPEC = importlib.util.spec_from_file_location("contract_lint", SCRIPT)
LINTER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(LINTER)


def valid_contract():
    return {
        "계약버전": 2, "작업ID": "bug-1", "발동": "사용자", "위임": "필요",
        "준비": [{"도구": "python3", "확인명령": "python3 --version"}],
        "산출": [{"경로": "app.py", "형식": "Python"}],
        "검증": [{
            "요구ID": "R-1", "사용자행동": "return the sum",
            "관련파일": ["app.py", "tests/test_app.py"], "등급": "기계",
            "명령": {"실행": "python3 tests/test_app.py", "기대종료": 0},
            "반증": {
                "실행": "python3 tests/red.py {RED_ROOT}", "기대종료": 0},
            "인간검토": "불필요",
            "추가검토": [
                {"종류": "사실", "적용": "생략", "생략사유": "there is no factual claim"},
            ],
        }],
    }


class ContractV2(unittest.TestCase):
    def violations(self, data):
        return LINTER.check_schema(data)

    def test_valid_v2(self):
        self.assertEqual(self.violations(valid_contract()), [])

    def test_empty_requirements(self):
        data = valid_contract()
        data["검증"] = []
        self.assertTrue(any("검증:" in x for x in self.violations(data)))

    def test_duplicate_requirement_ids(self):
        data = valid_contract()
        data["검증"].append(copy.deepcopy(data["검증"][0]))
        self.assertTrue(any("duplicated" in x for x in self.violations(data)))

    def test_prose_red_is_rejected(self):
        data = valid_contract()
        data["검증"][0]["반증"] = "break the implementation"
        self.assertTrue(any("반증" in x for x in self.violations(data)))

    def test_red_requires_temporary_copy_placeholder(self):
        data = valid_contract()
        data["검증"][0]["반증"]["실행"] = "python3 tests/red.py"
        self.assertTrue(any("RED_ROOT" in x for x in self.violations(data)))

    def test_expected_exit_code_rejects_yaml_boolean(self):
        data = valid_contract()
        data["검증"][0]["명령"]["기대종료"] = True
        self.assertTrue(any("기대종료" in x for x in self.violations(data)))

    def test_related_file_cannot_escape_repository(self):
        data = valid_contract()
        data["검증"][0]["관련파일"] = ["../secret"]
        self.assertTrue(any("관련파일" in x for x in self.violations(data)))

    def test_required_review_and_explained_skip(self):
        data = valid_contract()
        data["검증"][0]["추가검토"] = [
            {"종류": "평가독립성", "적용": "필요"},
            {"종류": "SSOT", "적용": "생략"},
        ]
        self.assertTrue(any("생략사유" in x for x in self.violations(data)))

    def test_historical_v1_still_valid(self):
        data = {
            "계약버전": 1, "발동": "사용자",
            "산출": [{"경로": "out.txt", "형식": "text"}],
            "검증": [{"등급": "기계", "명령": "python3 test.py",
                    "RED": "reject invalid input"}],
        }
        self.assertEqual(self.violations(data), [])


if __name__ == "__main__":
    unittest.main()
