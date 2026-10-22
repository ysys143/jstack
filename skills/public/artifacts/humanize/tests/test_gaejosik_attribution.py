#!/usr/bin/env python3
"""Fragment-style ownership: thresholds have one source, referenced by procurement.

If style editing and fragment-style guidance live in separate plugins, their
contradictions first meet at runtime on a user's document. Measure (1) thresholds
in the canonical file, (2) no copies elsewhere, and (3) the procurement pointer.

Usage: python3 tests/test_gaejosik_attribution.py [skill-root]
Exit code: 0 pass / 1 violation.
"""
import io
import os
import sys

THRESHOLDS = ("22 characters", "31 characters", "48 characters")
CANON_REL = "references/gaejosik.md"
MIN_SCANNED = 20


def main(argv):
    root = argv[0] if argv else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    canon = os.path.join(root, "references", "gaejosik.md")
    bad = []

    if not os.path.isfile(canon):
        print(f"[FAIL] Canonical fragment-style document missing: {canon}", file=sys.stderr)
        return 1
    ctext = io.open(canon, encoding="utf-8").read()

    missing = [v for v in THRESHOLDS if v not in ctext]
    if missing:
        bad.append(f"Canonical document lacks level thresholds: {missing}")
    if "practice" not in ctext:
        bad.append("Canonical document lacks the qualification that thresholds describe practice rather than regulation")
    if "Ministry of\nthe Interior and Safety ordinance" not in ctext:
        bad.append("Canonical document lacks the enforcement-rule hierarchy correction (Ministry ordinance)")
    if "기안문" not in ctext or "시행문" not in ctext:
        bad.append("Canonical document lacks the 기안문/시행문 scope exclusions")

    # Prohibit copies: another document containing all three values creates divergence.
    skills_dir = os.path.dirname(root)
    scanned, copies = 0, []
    for dirpath, dirnames, filenames in os.walk(skills_dir):
        dirnames[:] = [d for d in dirnames if d not in ("__pycache__", ".git", "repos")]
        for n in filenames:
            if not n.endswith(".md"):
                continue
            fp = os.path.join(dirpath, n)
            scanned += 1
            if os.path.abspath(fp) == os.path.abspath(canon):
                continue
            t = io.open(fp, encoding="utf-8", errors="replace").read()
            if all(v in t for v in THRESHOLDS):
                copies.append(os.path.relpath(fp, skills_dir))
    if scanned < MIN_SCANNED:
        bad.append(f"Only {scanned} documents scanned; population too small for a valid duplicate check")
    if copies:
        bad.append(f"Threshold copies outside the canonical document: {copies}; use pointers only")

    proc = os.path.join(root, "references", "procurement-taxonomy.md")
    if not os.path.isfile(proc):
        bad.append("Procurement taxonomy missing")
    else:
        ptext = io.open(proc, encoding="utf-8").read()
        if CANON_REL not in ptext:
            bad.append(f"Procurement taxonomy does not reference {CANON_REL}")
        if "itemized" not in ptext:
            bad.append("Procurement taxonomy lacks itemized-style guidance; the pipeline is unaware of it")

    for line in bad:
        print(f"[FAIL] fragment-style ownership: {line}", file=sys.stderr)
    if bad:
        print(f"Fragment-style ownership contract violations: {len(bad)}", file=sys.stderr)
        return 1
    print(f"Fragment-style ownership contract PASS: one canonical source, zero copies ({scanned} documents checked), procurement pointer verified")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
