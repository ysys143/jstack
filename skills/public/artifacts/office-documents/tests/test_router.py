#!/usr/bin/env python3
"""Office routing contract (section 6-C).

Revision 6 redefined office from an OfficeCLI adapter into thin routing for the
three built-in docx/xlsx/pptx formats. This shifts the core obligation from
calling a backend correctly to routing requests correctly. Parse SKILL.md's
format table because a missing prose-like row is easy to overlook.

Measure exactly one destination row per built-in format, resolution of every
destination to a built-in or existing sibling skill (fail-closed), zero external
binary destinations, and explicit refusal of unsupported requests. Silent
fallback misleads the user into believing a tool handled the request.

run_tests.py calls run(check, root, skill_body). Standalone usage:
python3 tests/test_router.py.
"""
from __future__ import annotations

import os
import re
import sys

# These three built-in formats define the skill; disclose unsupported requests.
BUILTIN = ("docx", "xlsx", "pptx")
# Both headers identify the format-routing table.
HEAD_SIGNAL, HEAD_FORMAT = "Signal", "Format"
# Unsupported legacy binary formats must be named in the refusal list.
REFUSED = (".doc", ".xls", ".ppt")
# Distinguish a parsed but missing skill from None (unreadable cell).
# Otherwise sorted({None, "builtin"}) raises TypeError, killing the suite
# without a summary and making failure counters see zero. Also, including
# only existing skills in reroutes would make the existence check unfalsifiable.
MISSING_SKILL = "missing-skill"
# Lock row/value correspondence literally. Counting one row per built-in
# format failed to detect swapped signals: swapping xlsx/docx signals still
# passed 47/47. Routing is the mapping itself. Each left-hand needle
# identifies a signal; its right-hand name is the required resolved destination.
EXPECTED_ROUTES = (
    ("formulas", "xlsx"),
    ("slide", "pptx"),
    ("Report", "docx"),
    (".hwpx", "hwpx"),
)


def _cells(line):
    return [c.strip() for c in line.strip().strip("|").split("|")]


def parse_routes(text):
    """Read the routing table as [(signal, destination_cell)].

    Locate columns by header. A fixed two-cell regex misreads inserted columns
    (a demonstrated image-suite defect). Return an empty list if the table is
    absent; the caller detects this through its population guard.
    """
    lines = text.splitlines()
    out = []
    for i, line in enumerate(lines):
        if not line.lstrip().startswith("|"):
            continue
        head = _cells(line)
        if not {HEAD_SIGNAL, HEAD_FORMAT} <= set(head):
            continue
        if i + 1 >= len(lines) or not re.match(r"^\s*\|[\s:|-]+\|\s*$", lines[i + 1]):
            continue  # No separator means this is not a table.
        si, fi = head.index(HEAD_SIGNAL), head.index(HEAD_FORMAT)
        for body in lines[i + 2:]:
            if not body.lstrip().startswith("|"):
                break
            c = _cells(body)
            if len(c) <= max(si, fi):
                continue
            out.append((c[si], c[fi]))
    return out


def resolve_dest(cell, skills_dir):
    """Resolve a cell to (kind, name), or (None, original) if unknown.

    Kinds are builtin (three formats), skill (existing sibling), and
    MISSING_SKILL (parsed name without a skill). None means an unreadable cell.
    Everything else is unresolved: this allowlist fails closed for new forms.
    """
    tokens = re.findall(r"`([^`]+)`", cell)
    for t in tokens:
        name = t.strip().lstrip(".")
        if name in BUILTIN:
            return "builtin", name
    for t in tokens:
        name = t.strip().lstrip(".")
        if re.search(r"`" + re.escape(t) + r"`\s*\**\s*skill", cell) or (
            f"`{t}` skill" in cell
        ):
            if os.path.isdir(os.path.join(skills_dir, name)):
                return "skill", name
            return MISSING_SKILL, name
    return None, cell


def run(check, root, skill_body):
    """Nine routing contracts; run_tests.py declares this population."""
    skills_dir = os.path.dirname(root)
    routes = parse_routes(skill_body)
    dests = [d for _, d in routes]

    # An empty population is not a verdict. Enforce a floor first to prevent
    # vacuous truth in the counts below.
    check("Router: format table is readable", len(routes) >= len(BUILTIN),
          f"{len(routes)} rows")

    resolved = [resolve_dest(d, skills_dir) for d in dests]
    counts = {b: sum(1 for k, n in resolved if k == "builtin" and n == b)
              for b in BUILTIN}
    off = {b: c for b, c in counts.items() if c != 1}
    check("Router: each of three built-ins is the destination of exactly one row", not off,
          f"mismatched formats {off}" if off else str(counts))

    unresolved = [n for (k, n), d in zip(resolved, dests) if k is None]
    check("Router: every destination resolves (fail-closed)", not unresolved,
          f"unresolved {unresolved}")

    # Include missing named destinations too. Previously only k == "skill"
    # entries were included after already passing isdir, making missing always
    # empty. Even changing the destination to hwpxZZZ passed the existence check.
    named = [n for k, n in resolved if k in ("skill", MISSING_SKILL)]
    reroutes = sorted(set(named))
    check("Router: at least one handoff destination exists", bool(reroutes), str(reroutes))
    missing = sorted({n for k, n in resolved if k == MISSING_SKILL})
    check("Router: handoff destination skills exist", not missing,
          f"missing {missing}" if missing else str(reroutes))

    # No external binaries: destinations restricted to built-ins and sibling
    # skills cannot route outside the tree at this stage.
    kinds = {k for k, _ in resolved}
    # Sorting kinds containing None raises TypeError and kills the suite.
    # Without a summary, failure counters see zero. Detail formatting must
    # survive missing destinations so they become judgments.
    check("Router: destination kinds are restricted to built-ins and sibling skills",
          bool(kinds) and kinds <= {"builtin", "skill"},
          f"kinds {sorted(kinds, key=str)}")

    # A blank signal omits which input goes there; destinations alone form a
    # list, not a routing table.
    blank = [d for s, d in routes if not re.sub(r"[\s*`|-]+", "", s)]
    check("Router: every row has a signal", not blank, f"rows without signals {blank}")

    # Column-wise counts and resolution cannot detect rotation. Read each
    # signal/destination pair together to enforce correspondence.
    pairs = []
    for sig_needle, want in EXPECTED_ROUTES:
        hit = [d for sg, d in routes if sig_needle in sg]
        if len(hit) != 1:
            pairs.append(f"{sig_needle}->{len(hit)} rows")
            continue
        got = resolve_dest(hit[0], skills_dir)[1]
        if got != want:
            pairs.append(f"{sig_needle}->{got} (expected {want})")
    check("Router: signal/destination mapping matches the declaration", not pairs,
          f"mismatches {pairs}" if pairs else f"{len(EXPECTED_ROUTES)} pairs")

    # Disclose unsupported formats and forbid silent fallback.
    refused_missing = [t for t in REFUSED if t not in skill_body]
    silent_ok = "Do not claim the backend is available when it is not" in skill_body
    check("Router: unsupported formats are refused by name",
          not refused_missing and silent_ok,
          f"missing refusals {refused_missing}" if refused_missing
          else ("silent-fallback prohibition is absent" if not silent_ok
                else f"refused {list(REFUSED)}"))


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.dirname(here)
    sys.path.insert(0, os.path.dirname(root))
    from _suite_lib import split_frontmatter

    with open(os.path.join(root, "SKILL.md"), encoding="utf-8") as f:
        _fm, body = split_frontmatter(f.read())

    res = []

    def check(name, ok, detail=""):
        res.append(ok)
        print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))

    run(check, root, body)
    print(f"\n{sum(res)}/{len(res)} passed")
    return 0 if all(res) else 1


if __name__ == "__main__":
    sys.exit(main())
