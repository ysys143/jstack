#!/usr/bin/env python3
"""Check proposals, official documents, and itemized writing in rule 3.9 exceptions.

Upstream exempted only reports and technical documents. Porting that unchanged
would exclude half our main artifact types, while qualitative rule 3.9 can lower
grades without a mechanical detector catching it. Check expanded exceptions and
mandatory logging in the document.

Usage: python3 tests/test_noslop_exemptions.py [skill-root]
Exit code: 0 pass / 1 violation.
"""
import io
import os
import re
import sys

UPSTREAM = ("reports", "technical documents")
ADDED = ("proposals", "official documents", "itemized writing")
SENTENCE = "Do not apply 3.9 to proposals, official documents, or itemized writing"


def main(argv):
    root = argv[0] if argv else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    doc = os.path.join(root, "references", "ai-tell-taxonomy.md")
    if not os.path.isfile(doc):
        print(f"[FAIL] Taxonomy missing: {doc}", file=sys.stderr)
        return 1
    text = io.open(doc, encoding="utf-8").read()
    bad = []

    # Search inside the 3.9 section; a document-wide search could let another
    # rule’s exceptions satisfy this contract.
    h = re.search(r"(?m)^### .*3\.9.*$", text)
    if not h:
        print("[FAIL] 3.9 exceptions: exception section heading missing", file=sys.stderr)
        return 1
    rest = text[h.end():]
    nxt = re.search(r"(?m)^#{2,3}\s", rest)
    sect = rest[: nxt.start()] if nxt else rest
    m = re.search(r"(?m)^-\s*Exceptions:\s*(.+?)\s*$", sect)
    if not m:
        bad.append("Exception list line (`- Exceptions:`) missing")
    else:
        listed = m.group(1)
        for w in UPSTREAM:
            if w not in listed:
                bad.append(f"Upstream exception {w} disappeared; extension must not narrow the list")
        for w in ADDED:
            if w not in listed:
                bad.append(f"Added exception {w} missing")

    if SENTENCE not in sect:
        bad.append(f"Exclusion sentence missing: {SENTENCE!r}")

    if "qualitative" not in sect:
        bad.append("Missing statement that qualitative 3.9 cannot be caught mechanically")
    if "log" not in sect:
        bad.append("Missing logging duty when a 3.9 false positive lowers a grade")

    for line in bad:
        print(f"[FAIL] 3.9 exceptions: {line}", file=sys.stderr)
    if bad:
        print(f"3.9 exception contract violations: {len(bad)}", file=sys.stderr)
        return 1
    print("3.9 exception contract PASS: two upstream exceptions, three additions, exclusion sentence, and logging duty")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
