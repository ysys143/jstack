#!/usr/bin/env python3
"""Verify that all 21 medium-specific CJK requirements exist and name an evaluator.

Usage: python3 tests/test_cjk_contract.py (from skills/diagram; cwd-independent)

## Why this is a separate file

Integration-4 requires a **21-item matrix**, not merely one CJK document. A matrix
fails when a row disappears while the document remains. Neither the volume floor
nor the 70% line-survival floor detects one missing row, so this checker counts
items and reads each cell.

## Fail closed

A missing file or unreadable table is a **failure**. Treating a parse failure as
zero rows would make "all 21 items exist" and "no rows were parsed" look equally
green, a recurring defect class in this repository.
"""

import os
import re
import sys

sys.dont_write_bytecode = True
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DOC = os.path.join(ROOT, "references", "cjk-contract.md")

# Requirement count from integration-4 and ledger section 11.4 (c').
EXPECTED_ITEMS = 21

# An evaluator cell must contain at least one of these tokens.
JUDGE_TOKENS = ("scripts/", "tests/", "references/", "Human", "skill")

results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))


def rows(text):
    """Return numbered rows shaped like `| 3 | Diagram | ... |`."""
    out = []
    for line in text.splitlines():
        if not line.startswith("|"):
            continue
        # `\|` is a literal pipe inside a table cell, not a delimiter.
        guarded = line.strip().replace("\\|", "\x00")
        cells = [c.strip().replace("\x00", "|") for c in guarded.strip("|").split("|")]
        if len(cells) < 5 or not re.fullmatch(r"\d+", cells[0]):
            continue
        out.append(cells)
    return out


def main():
    # **Do not write literal verdicts.** Separate `False` and `True` branches make
    # each call a constant that never inspects its target, which the constant-check
    # detector in `run_tests.py` correctly rejects. Measure once and pass the value.
    exists = os.path.isfile(DOC)
    check(
        "CJK contract: references/cjk-contract.md exists",
        exists,
        "" if exists else f"file missing — {DOC}",
    )
    if not exists:
        print(f"\n{sum(1 for _, ok, _ in results if ok)}/{len(results)} passed")
        return 1

    with open(DOC, encoding="utf-8") as f:
        text = f.read()

    table = rows(text)
    # **Zero rows is not a pass.** A parser broken by a format change must fail.
    # Measure once so both paths use the same target-derived value.
    read_rows = bool(table)
    check(
        "CJK contract: numbered requirement rows were parsed",
        read_rows,
        f"{len(table)} rows" + ("" if read_rows else " — update this parser if the table format changed"),
    )
    if not read_rows:
        print(f"\n{sum(1 for _, ok, _ in results if ok)}/{len(results)} passed")
        return 1

    check(
        f"CJK contract: contains {EXPECTED_ITEMS} requirements",
        len(table) == EXPECTED_ITEMS,
        f"{len(table)} requirements",
    )

    nums = [int(c[0]) for c in table]
    check(
        "CJK contract: numbering is contiguous from 1 through N",
        nums == list(range(1, len(table) + 1)),
        f"{nums}",
    )

    # Read every medium, requirement, and evaluator cell; row count alone permits
    # padding the table with empty cells.
    thin = [c[0] for c in table if len(c[2]) < 20]
    check("CJK contract: every requirement sentence is nonempty", not thin, f"short rows {thin}")

    no_media = [c[0] for c in table if not c[1]]
    check("CJK contract: every requirement names a medium", not no_media, f"empty rows {no_media}")

    bad_judge = [c[0] for c in table if not any(t in c[3] for t in JUDGE_TOKENS)]
    check(
        "CJK contract: every requirement names an evaluator",
        not bad_judge,
        f"rows without evaluators {bad_judge} — a rule without an evaluator is recitation",
    )

    # Require both machine and human evaluators. All-human means the matrix is
    # documentation only; all-script claims measurement for unmeasurable items.
    machine = [c[0] for c in table if "scripts/" in c[3] or "tests/" in c[3]]
    human = [c[0] for c in table if "Human" in c[3]]
    check(
        "CJK contract: some requirements have machine evaluators", len(machine) >= 5, f"{len(machine)} requirements"
    )
    check("CJK contract: some requirements have human evaluators", len(human) >= 3, f"{len(human)} requirements")

    # K-9 anchor: concrete values required by the ledger.
    check(
        "CJK contract: K-9 forbids character-width and tracking compression with concrete values",
        "90% character width" in text and "-5% tracking" in text,
    )

    # Every local script named as an evaluator must exist.
    named = sorted(set(re.findall(r"scripts/[\w.-]+\.py", text)))
    missing = [n for n in named if not os.path.isfile(os.path.join(ROOT, n))]
    check(
        "CJK contract: every script named as an evaluator exists",
        not missing,
        f"missing {missing} / named {named}",
    )
    check(
        "CJK contract: at least one evaluator script is named",
        len(named) >= 3,
        f"{len(named)} scripts",
    )

    # The document must admit that only a minority of requirements are automated.
    check(
        "CJK contract: document discloses what is not enforced",
        "## Limitations" in text and "does not enforce them all" in text,
    )

    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n{passed}/{len(results)} passed")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
