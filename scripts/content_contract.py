#!/usr/bin/env python3
"""Deterministic content-fidelity contract for humanize outputs.

The checker separates machine-observable anchors from the independent semantic
review record.  A passing anchor check is still ``provisional`` until a review
record binds the original/output hashes, every source proposition, and the
reviewer's evidence spans. ``external-artifact`` is the trusted coordinator's
record that a separate review ran; neither that label nor the hashes authenticate
the reviewer.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Any


NUMBER_RE = re.compile(r"(?<![A-Za-z0-9])\d+(?:[,.]\d+)?(?:%|년|월|일|시간|개|건|명|회)?")
NAME_RE = re.compile(r"(?<![A-Za-z0-9])[A-Z][A-Za-z0-9_-]{2,}(?![A-Za-z0-9])")
REQ_ID_RE = re.compile(r"\b(?:RFP|REQ|SFR|CNR|PER)-?[A-Z0-9-]*\d[A-Z0-9-]*\b")
QUOTE_RE = re.compile(r"(?:\"([^\"]+)\"|“([^”]+)”|「([^」]+)」|『([^』]+)』)")
NEGATION_RE = re.compile(r"않|못|없|아니|불가|실패|미확인|미정|입증하지|단정할 수 없|불가능|미지원|미충족|미검증")
STRONG_RE = re.compile(r"항상|모든 환경|전부|100%|무조건|보장|입증했다|증명했다|확정적|무제한|업계 최고|완벽|확실히|명백히|완전히|전적으로|예외 없이|문제없이|성공적으로|검증됐다|검증됨|확인됐다|완료됐다|완료됨|정상 작동")
CONTRADICTIONS = (
    ("암호화", "평문"), ("관찰했다", "관찰하지 못했다"),
    ("성공", "실패"), ("가능", "불가능"), ("보존", "삭제"),
    ("확정", "탐색적"), ("증가", "감소"), ("개선", "악화"),
    ("허용", "차단"), ("포함", "제외"), ("지원", "미지원"),
    ("유지", "변경"), ("일치", "불일치"), ("검증", "미검증"),
    ("필수", "선택"), ("충족", "미충족"), ("승인", "거부"),
    ("공개", "비공개"),
)
STOPWORDS = {"및", "있는", "있다", "한다", "하는", "대한", "대해", "에서", "으로", "것을", "것은"}
FREEFORM_REQUIREMENT_KEYS = {"description", "details", "rationale", "notes", "explanation"}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def norm(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value)).strip()


def anchors(text: str) -> dict[str, list[str]]:
    quotes = [next(x for x in match.groups() if x is not None) for match in QUOTE_RE.finditer(text)]
    return {
        "numbers": NUMBER_RE.findall(text),
        "names": sorted(set(NAME_RE.findall(text) + REQ_ID_RE.findall(text))),
        "quotes": quotes,
    }


def _counter_missing(before: list[str], after: list[str]) -> list[str]:
    return list((Counter(before) - Counter(after)).elements())


def machine_text_check(before: str, after: str) -> dict[str, Any]:
    left, right = anchors(before), anchors(after)
    failures: list[str] = []
    review_flags: list[str] = []
    for key in ("numbers", "names", "quotes"):
        missing = _counter_missing(left[key], right[key])
        if missing:
            failures.append(f"{key}-changed:{missing}")
    before_neg, after_neg = len(NEGATION_RE.findall(before)), len(NEGATION_RE.findall(after))
    if before_neg != after_neg:
        review_flags.append("negation-changed")
    before_strong = Counter(STRONG_RE.findall(before))
    after_strong = Counter(STRONG_RE.findall(after))
    added_strong = list((after_strong - before_strong).elements())
    if added_strong:
        review_flags.append(f"claim-strength-added:{added_strong}")
    for positive, negative in CONTRADICTIONS:
        if negative in after and negative not in before:
            review_flags.append(f"semantic-polarity-added:{negative}")
        if positive in after and positive not in before and negative in before:
            review_flags.append(f"semantic-polarity-reversed:{positive}")
    return {
        "before": left,
        "after": right,
        "failures": failures,
        "review_flags": sorted(set(review_flags)),
        "review_required": bool(failures or review_flags) or before != after,
    }


def _field_anchors(value: Any) -> list[str]:
    text = norm(value)
    return NUMBER_RE.findall(text) + sorted(set(NAME_RE.findall(text)))


def _semantic_terms(value: Any) -> list[str]:
    return [token for token in re.findall(r"[A-Za-z0-9]+|[가-힣]{2,}", norm(value))
            if token not in STOPWORDS]


def _procurement_schema(value: Any, label: str) -> list[str]:
    if not isinstance(value, dict):
        return [f"{label}-schema:not-object"]
    failures: list[str] = []
    requirements = value.get("requirements")
    if not isinstance(requirements, list) or not requirements:
        failures.append(f"{label}-schema:requirements-missing-or-empty")
    else:
        for index, item in enumerate(requirements):
            if not isinstance(item, dict):
                failures.append(f"{label}-schema:requirement-{index}-not-object")
            elif not isinstance(item.get("id"), str) or not item["id"].strip():
                failures.append(f"{label}-schema:requirement-{index}-id-missing")
    for key in ("commitments", "evidence", "unknowns"):
        if key in value and not isinstance(value[key], list):
            failures.append(f"{label}-schema:{key}-not-list")
    return failures


def procurement_check(before: Any, after: Any) -> dict[str, Any]:
    failures = _procurement_schema(before, "source") + _procurement_schema(after, "output")
    review_flags: list[str] = []
    if failures:
        return {"failures": sorted(set(failures)), "review_flags": [],
                "review_required": True}
    source_reqs = before.get("requirements", [])
    result_reqs = after.get("requirements", [])
    source_ids = [norm(item.get("id")) for item in source_reqs]
    result_ids = [norm(item.get("id")) for item in result_reqs]
    if len(source_ids) != len(set(source_ids)):
        failures.append("source-duplicate-requirement-id")
    if len(result_ids) != len(set(result_ids)):
        failures.append("output-duplicate-requirement-id")
    if set(source_ids) != set(result_ids):
        failures.append("requirement-id-set-changed")
    by_id = {norm(item.get("id")): item for item in result_reqs}
    for item in source_reqs:
        rid = norm(item.get("id"))
        got = by_id.get(rid)
        if got is None:
            continue
        if set(got) != set(item):
            failures.append(f"requirement-fields-changed:{rid}")
        for key, source_value in item.items():
            if key == "id":
                continue
            got_value = got.get(key)
            if key not in FREEFORM_REQUIREMENT_KEYS and norm(source_value) != norm(got_value):
                failures.append(f"requirement-value-changed:{rid}:{key}")
            elif _counter_missing(_field_anchors(source_value), _field_anchors(got_value)):
                failures.append(f"requirement-value-changed:{rid}:{key}")
            if _counter_missing(_semantic_terms(source_value), _semantic_terms(got_value)):
                review_flags.append(f"requirement-content-changed:{rid}:{key}")
            source_text, got_text = norm(source_value), norm(got_value)
            for positive, negative in CONTRADICTIONS:
                if positive in source_text and negative in got_text:
                    review_flags.append(f"requirement-strength-changed:{rid}:{key}")
                if negative in source_text and positive in got_text:
                    review_flags.append(f"requirement-strength-changed:{rid}:{key}")
    for key in ("commitments", "evidence", "unknowns"):
        source = [norm(value) for value in before.get(key, [])]
        result = [norm(value) for value in after.get(key, [])]
        if key in {"evidence", "commitments"} and Counter(source) != Counter(result):
            failures.append("evidence-set-changed")
        elif key == "unknowns" and _counter_missing(source, result):
            failures.append("unknown-removed")
    return {"failures": sorted(set(failures)), "review_flags": sorted(set(review_flags)), "review_required": True}


def propositions(text: str) -> list[dict[str, Any]]:
    rows = []
    for index, sentence in enumerate((s.strip() for s in re.split(r"(?<=[.!?。！？])\s*", text) if s.strip()), 1):
        rows.append({"id": f"p-{index:03d}", "source": sentence})
    return rows


def review_check(review_path: Path | None, before_path: Path, after_path: Path, source_text: str, after_text: str) -> dict[str, Any]:
    if review_path is None:
        if before_path.read_bytes() == after_path.read_bytes():
            return {"status": "unchanged", "review_required": False, "failures": []}
        return {"status": "provisional", "review_required": True, "failures": ["review-missing"]}
    try:
        review = json.loads(review_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        return {"status": "provisional", "review_required": True, "failures": [f"review-unreadable:{exc}"]}
    if not isinstance(review, dict):
        return {"status": "provisional", "review_required": True, "failures": ["review-schema"]}
    failures: list[str] = []
    if review.get("beforeSha256") != sha256(before_path):
        failures.append("review-before-hash")
    if review.get("afterSha256") != sha256(after_path):
        failures.append("review-after-hash")
    expected = {row["id"]: row["source"] for row in propositions(source_text)}
    coverage = review.get("coverage")
    rows = coverage if isinstance(coverage, list) else []
    ids = [row.get("propositionId") for row in rows if isinstance(row, dict)]
    got = {row.get("propositionId"): row for row in rows if isinstance(row, dict)}
    if len(ids) != len(set(ids)) or set(got) != set(expected):
        failures.append("review-proposition-coverage")
    for proposition_id, row in got.items():
        status = row.get("status")
        if status not in {"verified", "changed", "uncertain"}:
            failures.append(f"review-status:{proposition_id}")
        elif status != "verified":
            failures.append(f"review-{status}:{proposition_id}")
        spans = row.get("evidenceSpans")
        if not isinstance(spans, list) or not spans or any(not isinstance(span, dict) for span in spans):
            failures.append(f"review-evidence-spans:{proposition_id}")
        else:
            for span in spans:
                if not isinstance(span.get("source"), str) or not isinstance(span.get("output"), str):
                    failures.append(f"review-evidence-shape:{proposition_id}")
                elif (not span["source"].strip() or not span["output"].strip() or
                      span["source"] not in expected.get(proposition_id, "") or
                      span["output"] not in after_text):
                    failures.append(f"review-evidence-mismatch:{proposition_id}")
    independence = review.get("independence")
    if independence not in {"external-artifact", "unverified"}:
        failures.append("review-independence-field")
    elif independence == "unverified":
        failures.append("review-independence-unverified")
    if failures:
        return {"status": "provisional", "review_required": True, "failures": sorted(set(failures))}
    return {
        "status": "reviewed", "review_required": False, "failures": [],
        "independence": independence,
        "trustBoundary": (
            "external-artifact records the trusted coordinator's observation of "
            "a separate review; hashes and this field do not authenticate a reviewer"
        ),
    }


def evaluate(before_path: Path, after_path: Path, mode: str = "general", review_path: Path | None = None) -> dict[str, Any]:
    before_raw, after_raw = before_path.read_text(encoding="utf-8"), after_path.read_text(encoding="utf-8")
    if mode == "procurement":
        try:
            machine = procurement_check(json.loads(before_raw), json.loads(after_raw))
        except (ValueError, TypeError) as exc:
            machine = {"failures": [f"json-invalid:{exc}"], "review_required": True}
    else:
        machine = machine_text_check(before_raw, after_raw)
    review = review_check(review_path, before_path, after_path, before_raw, after_raw)
    text_flags = []
    if mode == "procurement":
        text_flags = machine_text_check(before_raw, after_raw).get("review_flags", [])
    review_flags = sorted(set(machine.get("review_flags", []) + text_flags))
    failures = sorted(set(machine["failures"] + review["failures"]))
    if review_flags:
        review["flags"] = review_flags
        if review["status"] != "reviewed":
            review["review_required"] = True
            review["status"] = "provisional"
            review["failures"] = sorted(set(review["failures"] + review_flags))
            failures = sorted(set(failures + review_flags))
    return {
        "schemaVersion": 1,
        "status": "rejected" if machine["failures"] else review["status"],
        "accepted": not failures and review["status"] in {"reviewed", "unchanged"},
        "provisional": bool(review["review_required"]),
        "beforeSha256": sha256(before_path),
        "afterSha256": sha256(after_path),
        "mode": mode,
        "machine": machine,
        "reviewFlags": review_flags,
        "review": review,
        "failures": failures,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Verifiable content-preservation contract")
    parser.add_argument("--before", required=True, type=Path)
    parser.add_argument("--after", required=True, type=Path)
    parser.add_argument("--mode", choices=("general", "procurement"), default="general")
    parser.add_argument("--review", type=Path)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)
    try:
        result = evaluate(args.before, args.after, args.mode, args.review)
    except (OSError, UnicodeError) as exc:
        result = {"schemaVersion": 1, "status": "unmeasured", "accepted": False, "provisional": True, "failures": [str(exc)]}
    print(json.dumps(result, ensure_ascii=False, indent=2) if args.json else result)
    return 0 if result.get("accepted") else (1 if result.get("status") == "rejected" else 2)


if __name__ == "__main__":
    raise SystemExit(main())
