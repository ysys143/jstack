#!/usr/bin/env python3
"""Lock actual content-preservation counterexamples.

Check product-checker JSON/file verdicts, not natural-language completion reports.
Run: python3 tests/test_content_contract.py.
"""

from __future__ import annotations

import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve()
SCRIPTS = HERE.parents[3] / "scripts"
sys.path.insert(0, str(SCRIPTS))
from content_contract import evaluate, propositions  # noqa: E402


def write(path: Path, text: str) -> None:
    path.write_text(text, encoding="utf-8")


def review(path: Path, before: Path, after: Path,
           independence: str = "external-artifact") -> None:
    rows = propositions(before.read_text(encoding="utf-8"))
    out = propositions(after.read_text(encoding="utf-8"))
    path.write_text(json.dumps({
        "schemaVersion": 1,
        "beforeSha256": hashlib.sha256(before.read_bytes()).hexdigest(),
        "afterSha256": hashlib.sha256(after.read_bytes()).hexdigest(),
        "independence": independence,
        "coverage": [{
            "propositionId": row["id"],
            "status": "verified",
            "evidenceSpans": [{
                "source": row["source"],
                "output": out[index]["source"] if index < len(out) else after.read_text(encoding="utf-8"),
            }],
        } for index, row in enumerate(rows)],
    }, ensure_ascii=False), encoding="utf-8")


class ContentContractTests(unittest.TestCase):
    def test_codex_native_entry_documents_review_loop(self):
        entry = HERE.parents[1] / "SKILL.codex.md"
        if not entry.exists():
            entry = HERE.parents[5] / "hosts/codex/skills/public/artifacts/humanize/SKILL.md"
        text = entry.read_text(encoding="utf-8")
        for needle in (
            "prescan.py", "reconcile.py", "02_candidates.json", "02_detection.json",
            "content_contract.py", "req_coverage.py", "--requirements", "[미작성]",
            "--review", "provisional", "evidenceSpans",
        ):
            self.assertIn(needle, text)

    def test_direct_path_is_the_default_on_both_hosts(self):
        skill = HERE.parents[1]
        codex = skill / "SKILL.codex.md"
        if not codex.exists():
            codex = HERE.parents[5] / "hosts/codex/skills/public/artifacts/humanize/SKILL.md"
        common_text = (skill / "SKILL.md").read_text(encoding="utf-8")
        codex_text = codex.read_text(encoding="utf-8")
        direct_text = (skill / "references/direct.md").read_text(encoding="utf-8")
        for text in (common_text, codex_text):
            self.assertIn("## Default direct execution", text)
            self.assertIn("Select `direct`", text)
            self.assertIn("references/direct.md", text)
            self.assertIn("return only the", text)
            self.assertIn("Select from the user's request", text)
        self.assertIn("## One-pass boundary", direct_text)
        self.assertIn("Do not create a workspace", direct_text)
        self.assertIn("Return only the edited artifact", direct_text)

    def test_changed_text_without_review_stays_provisional(self):
        with tempfile.TemporaryDirectory(prefix="humanize-contract-") as raw:
            root = Path(raw)
            before, after = root / "before.txt", root / "after.txt"
            write(before, "2026년 SERVO 결과는 탐색적이다.\n")
            write(after, "2026년 SERVO 결과는 신뢰할 수 있다.\n")
            result = evaluate(before, after)
            self.assertFalse(result["accepted"])
            self.assertEqual(result["status"], "provisional")
            self.assertIn("review-missing", result["failures"])

    def test_polarity_and_number_mutations_are_rejected(self):
        with tempfile.TemporaryDirectory(prefix="humanize-contract-") as raw:
            root = Path(raw)
            before, after, record = root / "before.txt", root / "after.txt", root / "review.json"
            write(before, "2026년 SERVO 실험에서 42%를 관찰했다.\n")
            write(after, "2026년 SERVO 실험에서 41%를 관찰하지 못했다.\n")
            result = evaluate(before, after)
            self.assertFalse(result["accepted"])
            self.assertTrue(any("numbers-changed" in item for item in result["failures"]))
            self.assertIn("negation-changed", result["failures"])

    def test_verified_review_can_clear_semantic_flag(self):
        with tempfile.TemporaryDirectory(prefix="humanize-contract-") as raw:
            root = Path(raw)
            before, after, record = root / "before.txt", root / "after.txt", root / "review.json"
            write(before, "SERVO 결과는 실패하지 않았다.\n")
            write(after, "SERVO 결과는 성공했다.\n")
            review(record, before, after)
            result = evaluate(before, after, review_path=record)
            self.assertTrue(result["accepted"])
            self.assertIn("negation-changed", result["reviewFlags"])
            self.assertIn("do not authenticate", result["review"]["trustBoundary"])

    def test_unverified_review_stays_provisional(self):
        with tempfile.TemporaryDirectory(prefix="humanize-contract-") as raw:
            root = Path(raw)
            before, after, record = root / "before.txt", root / "after.txt", root / "review.json"
            write(before, "SERVO 결과는 실패하지 않았다.\n")
            write(after, "SERVO 결과는 성공했다.\n")
            review(record, before, after, "unverified")
            result = evaluate(before, after, review_path=record)
            self.assertFalse(result["accepted"])
            self.assertEqual(result["status"], "provisional")
            self.assertIn("review-independence-unverified", result["failures"])

    def test_uncertain_review_cannot_promote_output(self):
        with tempfile.TemporaryDirectory(prefix="humanize-contract-") as raw:
            root = Path(raw)
            before, after, record = root / "before.txt", root / "after.txt", root / "review.json"
            write(before, "SERVO 결과는 탐색적이다.\n")
            write(after, "SERVO 결과는 제한적으로 탐색적이다.\n")
            review(record, before, after)
            value = json.loads(record.read_text(encoding="utf-8"))
            value["coverage"][0]["status"] = "uncertain"
            record.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
            result = evaluate(before, after, review_path=record)
            self.assertFalse(result["accepted"])
            self.assertIn("review-uncertain:p-001", result["failures"])

    def test_duplicate_review_proposition_is_rejected(self):
        with tempfile.TemporaryDirectory(prefix="humanize-contract-") as raw:
            root = Path(raw)
            before, after, record = root / "before.txt", root / "after.txt", root / "review.json"
            write(before, "첫 명제다. 둘째 명제다.\n")
            write(after, "첫 명제다. 둘째 명제다.\n")
            review(record, before, after)
            value = json.loads(record.read_text(encoding="utf-8"))
            value["coverage"].append(dict(value["coverage"][0]))
            record.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
            result = evaluate(before, after, review_path=record)
            self.assertFalse(result["accepted"])
            self.assertIn("review-proposition-coverage", result["failures"])

    def test_review_schema_and_spans_fail_closed(self):
        with tempfile.TemporaryDirectory(prefix="humanize-contract-") as raw:
            root = Path(raw)
            before, after, record = root / "before.txt", root / "after.txt", root / "review.json"
            write(before, "첫 명제다. 둘째 명제다.\n")
            write(after, "첫 명제다. 둘째 명제다.\n")
            record.write_text("[]", encoding="utf-8")
            self.assertIn("review-schema", evaluate(before, after, review_path=record)["failures"])
            review(record, before, after)
            value = json.loads(record.read_text(encoding="utf-8"))
            value["coverage"][0]["evidenceSpans"][0]["source"] = ""
            record.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
            result = evaluate(before, after, review_path=record)
            self.assertIn("review-evidence-mismatch:p-001", result["failures"])

    def test_procurement_accepts_reordering_but_rejects_same_id_drift(self):
        with tempfile.TemporaryDirectory(prefix="humanize-contract-") as raw:
            root = Path(raw)
            before, after, record = root / "before.json", root / "after.json", root / "review.json"
            source = {"requirements": [
                {"id": "RFP-02", "response": "응답 4시간"},
                {"id": "RFP-03", "condition": "저장 데이터 암호화"},
            ], "commitments": ["응답 4시간", "저장 데이터 암호화"],
                "evidence": ["OP-7"], "unknowns": ["확인 필요: 보존 기간"]}
            reordered = {**source, "requirements": list(reversed(source["requirements"])),
                         "evidence": ["OP-7"]}
            write(before, json.dumps(source, ensure_ascii=False))
            write(after, json.dumps(reordered, ensure_ascii=False))
            review(record, before, after)
            self.assertTrue(evaluate(before, after, "procurement", record)["accepted"])
            drift = {**reordered, "requirements": [
                {"id": "RFP-02", "response": "응답 40시간"},
                reordered["requirements"][0],
            ]}
            write(after, json.dumps(drift, ensure_ascii=False))
            self.assertFalse(evaluate(before, after, "procurement")["accepted"])

    def test_general_json_still_uses_text_anchors(self):
        with tempfile.TemporaryDirectory(prefix="humanize-contract-") as raw:
            root = Path(raw)
            before, after = root / "before.json", root / "after.json"
            write(before, json.dumps({"text": "SERVO 기준은 2026년이다."}, ensure_ascii=False))
            write(after, json.dumps({"text": "SERVO 기준은 2027년이다."}, ensure_ascii=False))
            result = evaluate(before, after, "general")
            self.assertEqual(result["status"], "rejected")
            self.assertTrue(any("numbers-changed" in item for item in result["failures"]))

    def test_procurement_schema_rejects_missing_and_malformed_requirements(self):
        with tempfile.TemporaryDirectory(prefix="humanize-contract-") as raw:
            root = Path(raw)
            before, after = root / "before.json", root / "after.json"
            write(before, json.dumps({"commitments": []}))
            write(after, json.dumps({"commitments": []}))
            result = evaluate(before, after, "procurement")
            self.assertIn("source-schema:requirements-missing-or-empty", result["failures"])
            self.assertIn("output-schema:requirements-missing-or-empty", result["failures"])
            write(before, json.dumps({"requirements": {"RFP-01": {"response": "4시간"}}}))
            write(after, json.dumps([{"id": "RFP-01"}]))
            result = evaluate(before, after, "procurement")
            self.assertFalse(result["accepted"])
            self.assertIn("source-schema:requirements-missing-or-empty", result["failures"])
            self.assertIn("output-schema:not-object", result["failures"])


if __name__ == "__main__":
    unittest.main()
