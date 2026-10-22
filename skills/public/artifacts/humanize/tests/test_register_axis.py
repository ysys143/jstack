#!/usr/bin/env python3
"""Register-axis contract: every one of five conflicts has 적용_서법:.

Fail closed on missing documents, a case count other than five, or a missing
field/judge in any case. Measure whether the conflicts recorded as resolved in
integration-3 actually appear in the document.

Usage: python3 tests/test_register_axis.py [skill-root]
Exit code: 0 pass / 1 violation.
"""
import io
import os
import re
import sys

SERUB = ("개조식-무어미", "서술-합쇼체", "캡션-무어미")
CASES = 5
MIN_JUDGE = 20


def main(argv):
    root = argv[0] if argv else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    doc = os.path.join(root, "references", "register-axis.md")
    bad = []
    if not os.path.isfile(doc):
        print(f"[FAIL] Register-axis document missing: {doc}", file=sys.stderr)
        return 1
    text = io.open(doc, encoding="utf-8").read()

    if "적용_서법:" not in text:
        bad.append("Document lacks the `적용_서법:` field contract")

    for name in SERUB:
        if name not in text:
            bad.append(f"Document lacks register name {name}")

    blocks = re.split(r"(?m)^### Case (\d+): ", text)
    # blocks = [preamble, number, body, number, body, ...]
    cases = list(zip(blocks[1::2], blocks[2::2]))
    if len(cases) != CASES:
        bad.append(f"Found {len(cases)} case blocks; expected {CASES}")

    seen = set()
    for num, body in cases:
        seen.add(num)
        head = body.splitlines()[0].strip() if body.splitlines() else ""
        label = f"Case {num} ({head[:20]})"
        m = re.search(r"(?m)^-\s*적용_서법:\s*(.+?)\s*$", body)
        if not m:
            bad.append(f"{label}: missing `적용_서법:` line")
        elif not any(s in m.group(1) for s in SERUB):
            bad.append(f"{label}: 적용_서법 value {m.group(1)!r} is not one of the three registers")
        j = re.search(r"(?m)^-\s*판정자:\s*(.+?)\s*$", body)
        if not j:
            bad.append(f"{label}: missing `판정자:` line")
        elif len(j.group(1)) < MIN_JUDGE:
            bad.append(f"{label}: judge sentence has {len(j.group(1))} characters; fewer than {MIN_JUDGE} is insufficient")
        if "Conflict" not in body:
            bad.append(f"{label}: does not state what conflicts")

    if cases and seen != {str(i) for i in range(1, CASES + 1)}:
        bad.append(f"Case numbers are not consecutive 1–{CASES}: {sorted(seen)}")

    for line in bad:
        print(f"[FAIL] register axis: {line}", file=sys.stderr)
    if bad:
        print(f"Register-axis contract violations: {len(bad)}", file=sys.stderr)
        return 1
    print(f"Register-axis contract PASS: {len(cases)} cases, all with 적용_서법 and 판정자")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
