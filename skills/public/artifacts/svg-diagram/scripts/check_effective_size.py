#!/usr/bin/env python3
"""Effective type size: pt at final placement width, not pixels.

references/output-spec.md sets a 12px floor for CJK labels, but pixels are
viewBox units, not physical size until page placement width is specified.

The unresolved upstream contradiction:
Placing print-a4-landscape (0 0 1120 792) across 297mm gives 0.265mm per unit.

| Role | px | mm | Effective pt |
|---|---:|---:|---:|
| CJK name floor | 12 | 3.18 | 9.02 |
| Print-ramp sublabel | 9 | 2.39 | 6.77 |
| Print-ramp arrow label | 8 | 2.12 | 6.01 |

The document prescribes both 12px CJK and 9px print sublabels; all three values
fall below the practical 10pt Korean grayscale laser-print floor. Procurement
diagrams often occupy 60–70% of HWP body width, reducing 9pt to 6pt; use
--hwp-fraction to model that placement.

This checker uses a 10pt floor. It does not replace output-spec.md's 12px floor:
measure both and report which fails separately.

Coverage:
- Reads font-size only from tag attributes, not CSS or inheritance. Unreadable
  size emits text/unmeasurable instead of silently assuming a default, matching
  verify-text-width.py's policy.
- A person supplies placement width through --media or --placed-mm because SVG
  does not store final page width. The default is A4 landscape.

Limitations:
- Measures only; does not edit diagram files.
- Trusts --media/--placed-mm/--hwp-fraction supplied by a person. Wrong placement
  values produce wrong verdicts.
- Reads font-size only from attributes, not CSS, inheritance, or em/% units;
  unreadable values emit text/unmeasurable instead of a default.
- Without viewBox, nothing can be measured: effective pt needs the ratio of page
  width to viewBox width, whose denominator would be missing.
- Does not replace the 12px floor. Passing pixels does not establish an effective-pt pass.

Usage:
    python3 scripts/check_effective_size.py assets/example-architecture.html
    python3 scripts/check_effective_size.py --media print-a4 --hwp-fraction 0.65 <file>
    python3 scripts/check_effective_size.py --all --json
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

MM_PER_INCH = 25.4
PT_PER_INCH = 72.0

# C-40: Korean grayscale laser-print floor, separate from output-spec.md's 12px.
MIN_EFFECTIVE_PT = 10.0

# Final page placement width in mm; assumes the diagram uses the entire width.
MEDIA = {
    "print-a4": 297.0,
    "print-a4-portrait": 210.0,
    "print-a3": 420.0,
    "print-letter": 279.4,
}

VIEWBOX_RE = re.compile(r'viewBox\s*=\s*["\']([^"\']+)["\']', re.I)
TEXT_RE = re.compile(r"<text\b([^>]*)>(.*?)</text>", re.I | re.S)
ATTR_RE = re.compile(r"""([a-zA-Z][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')""")
TAG_RE = re.compile(r"<[^>]+>")
NUM_RE = re.compile(r"[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?")


def attrs_of(tag: str) -> dict[str, str]:
    return {k: (dq if dq else sq) for k, dq, sq in ATTR_RE.findall(tag)}


def viewbox_width(source: str) -> float | None:
    m = VIEWBOX_RE.search(source)
    if not m:
        return None
    nums = [float(t) for t in NUM_RE.findall(m.group(1))]
    return nums[2] if len(nums) >= 4 and nums[2] > 0 else None


def effective_pt(
    px: float, viewbox_w: float, placed_mm: float, fraction: float = 1.0
) -> float:
    """Convert viewBox-unit px to point size at page placement."""
    mm_per_unit = placed_mm * fraction / viewbox_w
    return px * mm_per_unit / MM_PER_INCH * PT_PER_INCH


def diagnostic(
    code: str, message: str, subject: dict, evidence: dict, severity: str = "error"
) -> dict:
    return {
        "code": code,
        "severity": severity,
        "message": message,
        "subject": subject,
        "evidence": evidence,
        "supportedFixes": [],
    }


def check(
    path: Path, *, placed_mm: float, fraction: float, floor_pt: float = MIN_EFFECTIVE_PT
) -> tuple[list[dict], dict]:
    try:
        source = path.read_text(encoding="utf-8")
    except OSError as exc:
        return [
            diagnostic(
                "input/read",
                f"{path.name}: cannot read file - {type(exc).__name__}: {exc}",
                {"file": path.name, "path": str(path)},
                {"reason": type(exc).__name__},
            )
        ], {}
    except UnicodeDecodeError as exc:
        return [
            diagnostic(
                "input/decode",
                f"{path.name}: not valid UTF-8 - {type(exc).__name__}: {exc}",
                {"file": path.name, "path": str(path)},
                {"reason": type(exc).__name__},
            )
        ], {}

    vb = viewbox_width(source)
    if vb is None:
        return [
            diagnostic(
                "input/no-viewbox",
                f"{path.name}: no readable viewBox width - the "
                "effective point size cannot be derived from px",
                {"file": path.name},
                {},
            )
        ], {}

    findings: list[dict] = []
    texts = 0
    measured = 0
    below = 0
    smallest = None
    for m in TEXT_RE.finditer(source):
        texts += 1
        attrs = attrs_of("<text " + m.group(1) + ">")
        line_no = source.count("\n", 0, m.start()) + 1
        label = TAG_RE.sub("", m.group(2)).strip()
        raw = attrs.get("font-size")
        try:
            px = float(NUM_RE.search(raw).group(0)) if raw else None
        except (AttributeError, ValueError):
            px = None
        if px is None:
            findings.append(
                diagnostic(
                    "text/unmeasurable",
                    f"{path.name}:{line_no}: <text> {label[:24]!r} has no readable "
                    "font-size attribute - refusing to assume a default; the "
                    "effective point size is unknown",
                    {"file": path.name, "line": line_no},
                    {"attributes": sorted(attrs)},
                    severity="warning",
                )
            )
            continue
        measured += 1
        pt = effective_pt(px, vb, placed_mm, fraction)
        if smallest is None or pt < smallest:
            smallest = pt
        if pt + 1e-9 < floor_pt:
            below += 1
            findings.append(
                diagnostic(
                    "text/effective-size",
                    f"{path.name}:{line_no}: {label[:24]!r} is {px:g}px = "
                    f"{pt:.2f}pt at {placed_mm:g}mm x {fraction:g} placement - "
                    f"below the {floor_pt:g}pt floor for Korean black-and-white "
                    "print (output-spec.md 12px is a viewBox unit, not a physical "
                    "size); enlarge the type or widen the placement",
                    {"file": path.name, "line": line_no, "label": label[:60]},
                    {
                        "px": px,
                        "pt": round(pt, 4),
                        "floorPt": floor_pt,
                        "viewBoxWidth": vb,
                        "placedMm": placed_mm,
                        "fraction": fraction,
                    },
                )
            )

    summary = {
        "file": path.name,
        "viewBoxWidth": vb,
        "texts": texts,
        "measured": measured,
        "below": below,
        "smallestPt": round(smallest, 4) if smallest is not None else None,
        "mmPerUnit": round(placed_mm * fraction / vb, 6),
    }
    if measured == 0 and texts:
        findings.append(
            diagnostic(
                "input/no-measurable-text",
                f"{path.name}: {texts} <text> element(s) but none carried a "
                "readable font-size - the effective size was not measured at all",
                {"file": path.name},
                {"texts": texts},
            )
        )
    return findings, summary


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="*", type=Path)
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--media", choices=sorted(MEDIA), default="print-a4")
    ap.add_argument(
        "--placed-mm",
        type=float,
        default=None,
        help="Explicit placement width in mm (overrides --media)",
    )
    ap.add_argument(
        "--hwp-fraction",
        type=float,
        default=1.0,
        help="Fraction of HWP body width (procurement convention: 0.6–0.7)",
    )
    ap.add_argument("--floor-pt", type=float, default=MIN_EFFECTIVE_PT)
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    files = sorted((ROOT / "assets").glob("*.html")) if args.all else args.files
    if not files:
        ap.error("pass one or more files, or --all")
    placed = args.placed_mm if args.placed_mm is not None else MEDIA[args.media]

    findings: list[dict] = []
    per_file = {}
    for f in files:
        got, summary = check(
            f, placed_mm=placed, fraction=args.hwp_fraction, floor_pt=args.floor_pt
        )
        findings.extend(got)
        if summary:
            per_file[f.name] = summary

    errors = [d for d in findings if d["severity"] == "error"]
    if args.json:
        print(
            json.dumps(
                {
                    "schemaVersion": 1,
                    "ok": not errors,
                    "source": "check-effective-size",
                    "summary": {
                        "files": len(files),
                        "findings": len(findings),
                        "floorPt": args.floor_pt,
                        "placedMm": placed,
                        "fraction": args.hwp_fraction,
                        "perFile": per_file,
                    },
                    "diagnostics": findings,
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 1 if errors else 0

    for d in findings:
        print(d["message"])
    measured = sum(s["measured"] for s in per_file.values())
    total = sum(s["texts"] for s in per_file.values())
    print(
        f"Summary: {len(files)} file(s) at {placed:g}mm x {args.hwp_fraction:g}, "
        f"{len(findings)} finding(s), measured {measured} of {total} label(s)."
    )
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
