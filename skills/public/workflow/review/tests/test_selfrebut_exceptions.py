#!/usr/bin/env python3
"""Fail closed when checking that the attacker=victim exception list is loaded.

    python3 tests/test_selfrebut_exceptions.py      (from skills/audit)

## Why this is separate

The `run_tests.py` reference contract checks needles, volume, and line survival
across the whole document. This document instead carries an item-level invariant:
all eight entries have a decider. Removing one entry barely changes volume or
line survival, so those checks cannot detect it reliably.

If one exception disappears, the true positive it protected is silently dropped
by self-rebuttal. Pin the count directly because absence does not look like failure.

## fail-closed

Return rc 1 if the file is absent, the entry count is not eight, any entry lacks
a decider, or provenance is not five upstream plus three local entries. Parsing
failure is also failure; no path skips the judgment and passes.
"""
import os
import re
import sys

sys.dont_write_bytecode = True
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DOC = os.path.join(ROOT, "references", "security-exceptions.md")

EXPECTED = 8
UPSTREAM = 5
LOCAL = 3
# Checking only for the marker would accept a bare `**Decider** —`. Require a
# minimum payload length so the marker must be followed by a sentence.
MIN_VERDICT_BYTES = 24


def fail(msg):
    print(f"[FAIL] {msg}")
    return 1


def main():
    if not os.path.isfile(DOC):
        return fail(f"exception list missing: {os.path.relpath(DOC, ROOT)}")
    text = open(DOC, encoding="utf-8").read()

    # Split entries at headings. No headings means zero blocks and therefore failure.
    heads = list(re.finditer(r"(?m)^### (E-(\d+))\.\s*(.+)$", text))
    ids = [m.group(1) for m in heads]
    if len(heads) != EXPECTED:
        return fail(f"found {len(heads)} exception entries (expected {EXPECTED}) — {ids}")
    if ids != [f"E-{i}" for i in range(1, EXPECTED + 1)]:
        return fail(f"entry IDs are not contiguous E-1..E-{EXPECTED} — {ids}")

    problems, rows = [], []
    up = loc = 0
    for i, m in enumerate(heads):
        end = heads[i + 1].start() if i + 1 < len(heads) else len(text)
        block = text[m.start():end]
        eid, title = m.group(1), m.group(3).strip()

        v = re.search(r"(?m)^\*\*Decider\*\*\s*—\s*(.+)$", block)
        if not v:
            problems.append(f"{eid} has no decider sentence")
            continue
        verdict = v.group(1).strip()
        if len(verdict.encode("utf-8")) < MIN_VERDICT_BYTES:
            problems.append(f"{eid} decider is {len(verdict.encode('utf-8'))}B, too short for a sentence")
            continue

        src = re.search(r"(?m)^Source:\s*(upstream|local context)\s*$", block)
        if not src:
            problems.append(f"{eid} has no source marker (upstream / local context)")
            continue
        if src.group(1) == "upstream":
            up += 1
        else:
            loc += 1
        rows.append((eid, title, src.group(1)))
        print(f"[OK] {eid} {title} — source {src.group(1)} · decider present")

    if problems:
        for p in problems:
            print(f"[FAIL] {p}")
        return 1
    if (up, loc) != (UPSTREAM, LOCAL):
        return fail(f"provenance is upstream {up} · local {loc}; expected {UPSTREAM}/{LOCAL}")
    if len(rows) != EXPECTED:
        return fail(f"loaded {len(rows)} entries; expected {EXPECTED}")

    print(f"confirmed {len(rows)} loaded exceptions (upstream {up} · local {loc})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
