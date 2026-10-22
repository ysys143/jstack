#!/usr/bin/env python3
"""Check that the taxonomy retains E-2 list/itemized-style exemptions.

Upstream fluent-korean sentence-level rule 2 exempts headers/lists. That sentence
was lost during absorption. It resolves most nominal-ending conflicts, so fail
closed if it disappears again.

Usage: python3 tests/test_e2_exemption.py [skill-root]
Exit code: 0 pass / 1 violation.
"""
import io
import os
import re
import sys

SENTENCE = "E-2 is not mandatory for headers or lists"
EXEMPT_ROWS = ("Header row", "List item", "Itemized body", "Table cell", "Caption row")


def rule_section(text, rid):
    m = re.search(r"(?m)^### %s\.\s.*$" % re.escape(rid), text)
    if not m:
        return None
    rest = text[m.end():]
    nxt = re.search(r"(?m)^#{2,3}\s", rest)
    return rest[: nxt.start()] if nxt else rest


def main(argv):
    root = argv[0] if argv else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    doc = os.path.join(root, "references", "ai-tell-taxonomy.md")
    if not os.path.isfile(doc):
        print(f"[FAIL] Taxonomy missing: {doc}", file=sys.stderr)
        return 1
    text = io.open(doc, encoding="utf-8").read()
    bad = []

    if SENTENCE not in text:
        bad.append(f"Exemption sentence missing: {SENTENCE!r}")

    sect = rule_section(text, "E-2")
    if sect is None:
        bad.append("E-2 rule section missing")
    else:
        if "exemption" not in sect:
            bad.append("E-2 rule section lacks an exemption clause")
        for word in ("list", "itemized"):
            if word not in sect:
                bad.append(f"E-2 rule section does not list {word} as exempt")
        if not re.search(r"(?m)^-\s*적용_서법:\s*\S", sect):
            bad.append("E-2 rule section lacks an `적용_서법:` line")

    for row in EXEMPT_ROWS:
        if not re.search(r"(?m)^\|\s*%s.*\|\s*Exempt\s*\|" % re.escape(row), text):
            bad.append(f"Exemption table does not mark {row} as exempt")
    if not re.search(r"(?m)^\|\s*Prose paragraph\s*\|\s*Applies\s*\|", text):
        bad.append("Table does not mark prose paragraphs as subject to the rule; universal exemption removes the rule")

    for line in bad:
        print(f"[FAIL] E-2 exemption: {line}", file=sys.stderr)
    if bad:
        print(f"E-2 exemption contract violations: {len(bad)}", file=sys.stderr)
        return 1
    print("E-2 exemption contract PASS: exemption sentence, rule clause, and six table rows verified")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
