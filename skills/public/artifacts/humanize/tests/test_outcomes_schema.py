#!/usr/bin/env python3
"""Validate field-outcome records and overdue reassessment at ten records.

The 27 procurement patterns cited only practical induction, without project counts
or outcomes. outcomes.jsonl provides that validation path. Check record format;
return nonzero if the highest severity stays provisional at ten records, or lacks
that label below ten records and therefore asserts unsupported finality.

Usage: python3 tests/test_outcomes_schema.py [skill-root]
Exit code: 0 pass / 1 violation.
"""
import io
import json
import os
import sys

REQUIRED = ("run_id", "사업", "결과", "cat")
OPTIONAL = ("순위",)
RESULTS = ("수주", "탈락", "미정")
REJUDGE_AT = 10
PROVISIONAL = "provisional"


def main(argv):
    root = argv[0] if argv else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    path = os.path.join(root, "outcomes.jsonl")
    bad = []
    if not os.path.isfile(path):
        print(f"[FAIL] Field-outcome ledger missing: {path}", file=sys.stderr)
        return 1
    lines = io.open(path, encoding="utf-8").read().splitlines()

    header = "\n".join(ln for ln in lines if ln.startswith("#"))
    if not header:
        bad.append("Missing schema comment header: an empty file differs from zero records")
    for field in REQUIRED + OPTIONAL:
        if field not in header:
            bad.append(f"Header does not declare field {field}")
    for r in RESULTS:
        if r not in header:
            bad.append(f"Header does not declare outcome value {r}")

    records = []
    for i, ln in enumerate(lines, start=1):
        s = ln.strip()
        if not s or s.startswith("#"):
            continue
        try:
            rec = json.loads(s)
        except ValueError as e:
            bad.append(f"Line {i}: JSON parse failed: {e}")
            continue
        if not isinstance(rec, dict):
            bad.append(f"Line {i} is not an object")
            continue
        records.append(rec)
        for field in REQUIRED:
            if field not in rec:
                bad.append(f"Line {i} lacks required field {field}")
        if rec.get("결과") not in RESULTS:
            bad.append(f"Line {i}: outcome {rec.get('결과')!r} is outside {RESULTS}")
        if "cat" in rec and not isinstance(rec["cat"], dict):
            bad.append(f"Line {i}: cat is not an object")
        extra = set(rec) - set(REQUIRED) - set(OPTIONAL)
        if extra:
            bad.append(f"Line {i}: undeclared fields {sorted(extra)}")

    proc = os.path.join(root, "references", "procurement-taxonomy.md")
    if not os.path.isfile(proc):
        bad.append("Procurement taxonomy missing: cannot check severity labels")
    else:
        ptext = io.open(proc, encoding="utf-8").read()
        has = PROVISIONAL in ptext
        if len(records) >= REJUDGE_AT and has:
            bad.append(
                f"At {len(records)} records the {PROVISIONAL} label remains: reassessment overdue"
            )
        if len(records) < REJUDGE_AT and not has:
            bad.append(
                f"At {len(records)} records the {PROVISIONAL} label is absent: unsupported finality"
            )
        if str(REJUDGE_AT) not in ptext:
            bad.append(f"Procurement taxonomy does not state reassessment threshold {REJUDGE_AT}")

    for line in bad:
        print(f"[FAIL] field outcomes: {line}", file=sys.stderr)
    if bad:
        print(f"Field-outcome contract violations: {len(bad)}", file=sys.stderr)
        return 1
    print(f"Field-outcome contract PASS: {len(records)} records; header schema and severity labels agree")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
