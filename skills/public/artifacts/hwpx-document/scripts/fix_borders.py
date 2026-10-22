#!/usr/bin/env python3
"""Repair charPr borderFillIDRef wiring that boxes every character.

Some .hwp-to-.hwpx converters link hh:charPr/@borderFillIDRef to a bordered
hh:borderFill. Character borders surround each character, unlike paragraph
borders. The document resembles a grid, but XML remains valid, so ordinary
validators do not flag it before visual review.

borderFill and charPr have independent ID spaces (references/xml-structure.md
section 1). Equal IDs do not establish correct wiring.

A borderFill is bordered when any leftBorder/rightBorder/topBorder/bottomBorder
has type other than NONE. Ignore hh:diagonal: clean template border fills also
have diagonal type="SOLID", so counting it falsely flags normal files, including
both IDs 1 and 2 in templates/base.

Usage:
    python3 scripts/fix_borders.py output.hwpx --check
    python3 scripts/fix_borders.py output.hwpx --fix
    python3 scripts/fix_borders.py output.hwpx --check --json

Exit codes: 0 clean or repaired; 1 findings in --check; 2 input error.
"""

from __future__ import annotations

import argparse
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hwpx_zip import HEADER, parse, read_entry, rewrite, serialize  # noqa: E402

HH = "{http://www.hancom.co.kr/hwpml/2011/head}"
SIDES = ("leftBorder", "rightBorder", "topBorder", "bottomBorder")


def bordered_fill_ids(header: "object") -> set[str]:
    """IDs of borderFill definitions with enabled borders."""
    out = set()
    for bf in header.iter(f"{HH}borderFill"):
        bid = bf.get("id")
        if bid is None:
            continue
        for side in SIDES:
            el = bf.find(f"{HH}{side}")
            if el is not None and (el.get("type") or "NONE") != "NONE":
                out.add(bid)
                break
    return out


def clean_fill_id(header: "object") -> str | None:
    """Smallest borderFill ID whose four sides are NONE, or None."""
    ok = []
    for bf in header.iter(f"{HH}borderFill"):
        bid = bf.get("id")
        if bid is None or bid in bordered_fill_ids(header):
            continue
        ok.append(bid)
    if not ok:
        return None
    return sorted(ok, key=lambda x: (len(x), x))[0]


def offenders(header: "object") -> list[tuple[str, str]]:
    """List of (charPr ID, referenced borderFill ID)."""
    bad = bordered_fill_ids(header)
    out = []
    for cp in header.iter(f"{HH}charPr"):
        ref = cp.get("borderFillIDRef")
        if ref in bad:
            out.append((cp.get("id") or "?", ref))
    return out


def inspect(path: Path):
    raw = read_entry(path, HEADER)
    if raw is None:
        raise KeyError(HEADER)
    header = parse(raw)
    return header, offenders(header)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("hwpx")
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true", default=True,
                      help="Inspect only (default)")
    mode.add_argument("--fix", action="store_true",
                      help="Rewire to a borderless borderFill")
    a = ap.parse_args()

    path = Path(a.hwpx)
    if not path.is_file():
        print(f"File not found: {path}", file=sys.stderr)
        return 2
    try:
        header, bad = inspect(path)
    except zipfile.BadZipFile:
        print(f"Not a valid ZIP archive: {path}", file=sys.stderr)
        return 2
    except KeyError:
        print(f"Missing required file: {HEADER}", file=sys.stderr)
        return 2

    if not bad:
        print("OK: no charPr points at a bordered borderFill")
        return 0

    for cid, ref in bad:
        print(f"charPr id={cid} -> borderFill id={ref} (borders on)")

    if not a.fix:
        print(f"FOUND: {len(bad)} charPr would draw a box around every character",
              file=sys.stderr)
        return 1

    target = clean_fill_id(header)
    if target is None:
        # Do not invent a clean borderFill. Creating one also requires editing
        # itemCnt and references; mistakes can make the file unreadable.
        # A person should obtain a clean definition from a reference document.
        print("No border-free borderFill exists in this header; "
              "copy one from the reference document first", file=sys.stderr)
        return 1

    fixed = 0
    bad_ids = {ref for _, ref in bad}
    for cp in header.iter(f"{HH}charPr"):
        if cp.get("borderFillIDRef") in bad_ids:
            cp.set("borderFillIDRef", target)
            fixed += 1
    rewrite(path, {HEADER: serialize(header)})
    print(f"FIXED: repointed {fixed} charPr to borderFill id={target}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
