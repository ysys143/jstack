#!/usr/bin/env python3
"""Measure the two cause tags and two decision axes in design-slop.md.

Run python3 tests/test_slop_axes.py from skills/deck. Read actual table rows;
heading presence alone would pass empty tables.

Axis 1 is the two cause tags input/no-verify. The former four tags named three
points and an endpoint in one causal chain. median, underspec, and no-constraint
all meant insufficient input; the actionable distinction is improving instructions
versus inspecting the generated output. Four overlapping tags prevent consistent
aggregation and undermine the instruction to fix repeated causes.

Axis 2 is evaluation impact versus correction cost. Severity alone sorts items
but cannot decide what to fix before a presentation; prioritize high impact and
low cost together.

C-43 was decided by refactor/DECISIONS-hardening.md D-1. This check intentionally
remained red until the two-tag decision and matching document landed. Hiding it
with skip would remove decision status from measurement. To reverse the decision,
change its source document rather than CAUSE_TAGS.
"""

import os
import re
import sys

sys.dont_write_bytecode = True
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SLOP = os.path.join(ROOT, "references", "design-slop.md")

# Axis 1: the two canonical cause tags.
CAUSE_TAGS = ("input", "no-verify")

# Axis 2: required item-table columns; presence of both axes is the contract.
AXIS_COLUMNS = ("감점", "비용")

results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))


def read(path):
    try:
        with open(path, encoding="utf-8") as f:
            return f.read()
    except OSError:
        return ""


def cells(line):
    return [c.strip() for c in line.strip().strip("|").split("|")]


def tables(text):
    """Return (header_cells, rows), recognizing only tables with separator rows."""
    lines = text.splitlines()
    out = []
    for i, line in enumerate(lines):
        if not line.lstrip().startswith("|"):
            continue
        if i + 1 >= len(lines) or not re.match(r"^\s*\|[\s:|-]+\|\s*$", lines[i + 1]):
            continue
        head = cells(line)
        rows = []
        for row in lines[i + 2:]:
            if not row.lstrip().startswith("|"):
                break
            rows.append(cells(row))
        out.append((head, rows))
    return out


def _tag_column(head, rows, want_items):
    """Collect backticked tokens from the Tag column.

    want_items selects numbered item tables; false selects definition tables.
    Mixing them cannot distinguish a two-value definition from 21 item values.
    """
    if "Tag" not in head:
        return []
    if bool(head and head[0] == "#") != want_items:
        return []
    ix = head.index("Tag")
    out = []
    for c in rows:
        if len(c) != len(head):
            continue
        m = re.fullmatch(r"`([a-z][a-z0-9-]*)`", c[ix])
        if m:
            out.append(m.group(1))
    return out


def declared_tags(text):
    """Return values declared in the cause-tag definition table."""
    out = []
    for head, rows in tables(text):
        out += _tag_column(head, rows, want_items=False)
    return out


def used_tags(text):
    """Return values actually used by item tables."""
    out = []
    for head, rows in tables(text):
        out += _tag_column(head, rows, want_items=True)
    return out


def item_tables(text):
    """Return tables with a leading # column; these must include both axes."""
    return [(h, r) for h, r in tables(text) if h and h[0] == "#"]


def main():
    slop = read(SLOP)
    check("design-slop.md is readable", bool(slop.strip()), f"{len(slop)}B")

    # ── Axis 1: two cause tags ──────────────────────────────────────────────
    tags = declared_tags(slop)
    check("[C-43] Cause tags have exactly two values",
          sorted(set(tags)) == sorted(CAUSE_TAGS),
          f"declared {sorted(set(tags))} / canonical {sorted(CAUSE_TAGS)}")
    check("The cause-tag definition table has no duplicates",
          bool(tags) and len(tags) == len(set(tags)),
          f"{len(tags)} rows / {len(set(tags))} values")

    # Undefined item tags invalidate aggregation.
    # This axis applies regardless of how many values the decision permits.
    used = used_tags(slop)
    undefined = sorted(set(used) - set(tags))
    check("All item tags are in the definition table",
          bool(used) and not undefined,
          f"undefined {undefined}" if undefined else f"{len(used)} items / {len(set(used))} values")

    # ── Axis 2: evaluation impact x correction cost ───────────────────────────────
    items = item_tables(slop)
    check("Item tables are readable", bool(items), f"{len(items)} tables")

    tabled = []
    for head, _rows in items:
        joined = " ".join(head)
        tabled.append(all(a in joined for a in AXIS_COLUMNS))
    check("[C-43] Every item table has both impact and cost columns",
          bool(tabled) and all(tabled),
          f"{sum(tabled)}/{len(tabled)} tables" if tabled else "no item tables")

    # Empty columns do not establish two-dimensional data; inspect cells.
    filled, total = 0, 0
    for head, rows in items:
        joined = " ".join(head)
        if not all(a in joined for a in AXIS_COLUMNS):
            continue
        ix = [i for i, h in enumerate(head) if any(a in h for a in AXIS_COLUMNS)]
        for c in rows:
            if len(c) != len(head):
                continue
            total += 1
            if all(c[i] for i in ix):
                filled += 1
    check("[C-43] Every item has values for both axes",
          total > 0 and filled == total, f"{filled}/{total} items")

    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n{passed}/{len(results)} 통과")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
