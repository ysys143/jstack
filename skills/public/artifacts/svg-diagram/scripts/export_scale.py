#!/usr/bin/env python3
"""Calculate export scaling and clamp verdicts, including A3-or-larger exceptions.

Enforces scale = target_width / viewBox_width and the 1–4 clamp in
references/export.md. Upstream justifies the upper limit with an aesthetic
statement about a smaller canvas; this fails for Korean procurement A3 foldouts.

Measurements requiring an exception:
| Page | Target width at 300dpi | Scale from viewBox 1120 | Verdict |
|---|---:|---:|---|
| A4 landscape, 297mm | 3508px | 3.13 | Within clamp |
| A4 landscape at 4x | 4480px | 4.00 | Boundary gives 383dpi, with margin |
| A3 landscape, 420mm | 4961px | 4.43 | Clamp lowers output to 271dpi |

A3 foldouts are a procurement convention; A1 boards are outside this calculation's
scope. An unchanged clamp silently prevents A3 appendix diagrams reaching 300dpi.

Exceptions require font outlining. Either condition lifts the upper limit:
1. A3 or larger (--paper a3 or above).
2. Vector delivery is unavailable (--no-vector). HWP/HWPX effectively blocks SVG
   embedding, forcing raster output; the preferred print route of SVG-to-PDF is
   unavailable in this use case.

Above 4x, hinted text can have inconsistent weight and spacing. Outlining glyphs
removes that inconsistency but also removes translation, search, and editing.
Use outlined output only for final submissions and retain the source SVG.

Limitations:
- Does not open or edit diagrams; only calculates scale and evaluates numeric inputs.
- Does not export or invoke a renderer. repair_png.py separately checks exported
  PNG structure.
- Does not enforce outlining. requiresOutlinedFonts records the requirement, but
  a person must verify compliance.
- Only PAPERS lists known page sizes. Supply other formats with --target-width.

Usage:
    python3 scripts/export_scale.py --viewbox-width 1120 --target-width 4480
    python3 scripts/export_scale.py --viewbox-width 1120 --paper a3 --dpi 300
    python3 scripts/export_scale.py --viewbox-width 1120 --paper a3 --dpi 300 --json
"""

from __future__ import annotations

import argparse
import json
import sys

MIN_SCALE = 1.0
MAX_SCALE = 4.0
MM_PER_INCH = 25.4

# Landscape page long edge in mm; supply portrait width with --paper-width-mm.
PAPERS = {
    "letter": (279.4, 0),
    "a4": (297.0, 1),
    "a3": (420.0, 2),
    "a2": (594.0, 3),
    "a1": (841.0, 4),
    "a0": (1189.0, 5),
}

# Lift the upper limit at this rank or higher; A3 is the boundary.
UNLOCK_RANK = PAPERS["a3"][1]


def target_px(paper: str, dpi: float) -> float:
    mm, _ = PAPERS[paper]
    return mm / MM_PER_INCH * dpi


def effective_dpi(target_width: float, paper: str) -> float:
    mm, _ = PAPERS[paper]
    return target_width / (mm / MM_PER_INCH)


def evaluate(
    viewbox_width: float,
    target_width: float,
    *,
    paper: str | None = None,
    vector: bool = True,
) -> dict:
    """Calculate scale and evaluate the clamp and exceptions."""
    if viewbox_width <= 0:
        raise ValueError("viewBox width must be positive")
    scale = target_width / viewbox_width
    rank = PAPERS[paper][1] if paper else None
    large_paper = rank is not None and rank >= UNLOCK_RANK
    unlocked = large_paper or not vector
    reasons = []
    if large_paper:
        reasons.append(f"paper {paper} is A3 or larger")
    if not vector:
        reasons.append("vector delivery is unavailable (raster path forced)")

    rec = {
        "scale": round(scale, 4),
        "viewBoxWidth": viewbox_width,
        "targetWidth": target_width,
        "paper": paper,
        "clamp": [MIN_SCALE, MAX_SCALE],
        "unlocked": unlocked,
        "unlockReasons": reasons,
        "requiresOutlinedFonts": unlocked and scale > MAX_SCALE,
    }
    if paper:
        rec["effectiveDpi"] = round(effective_dpi(target_width, paper), 1)

    if scale < MIN_SCALE:
        rec["ok"] = False
        rec["verdict"] = "below-clamp"
        rec["message"] = (
            f"scale {scale:g} is below the 1x floor - the type would be crushed; "
            "redraw at a smaller preset instead of shrinking the export "
            "(export.md clamp)"
        )
    elif scale <= MAX_SCALE:
        rec["ok"] = True
        rec["verdict"] = "within-clamp"
        rec["message"] = f"scale {scale:g} is within the 1..4 clamp"
    elif unlocked:
        rec["ok"] = True
        rec["verdict"] = "unlocked"
        rec["message"] = (
            f"scale {scale:g} exceeds the 4x ceiling but the ceiling is lifted "
            f"({'; '.join(reasons)}) - outline the fonts before export and keep "
            "the source SVG (export.md A3 exception)"
        )
    else:
        rec["ok"] = False
        rec["verdict"] = "above-clamp"
        rec["message"] = (
            f"scale {scale:g} exceeds the 4x ceiling on {paper or 'an unstated paper'} "
            "with vector delivery available - the ceiling lifts only for A3+ or "
            "when vector delivery is impossible; pick a larger size dial instead "
            "(export.md clamp)"
        )
    return rec


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--viewbox-width", type=float, required=True)
    ap.add_argument(
        "--target-width",
        type=float,
        help="Target width in pixels; optional with --paper/--dpi",
    )
    ap.add_argument(
        "--paper", choices=sorted(PAPERS), help="Landscape page; a3 or larger lifts the upper limit"
    )
    ap.add_argument(
        "--dpi",
        type=float,
        default=300.0,
        help="Used with --paper when --target-width is absent (default 300)",
    )
    ap.add_argument(
        "--no-vector",
        action="store_true",
        help="Vector delivery unavailable (HWP/HWPX destination); lift the upper limit",
    )
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    if args.target_width is None:
        if not args.paper:
            ap.error("pass --target-width, or --paper (with --dpi)")
        target = target_px(args.paper, args.dpi)
    else:
        target = args.target_width

    rec = evaluate(
        args.viewbox_width, target, paper=args.paper, vector=not args.no_vector
    )

    if args.json:
        print(
            json.dumps(
                {
                    "schemaVersion": 1,
                    "ok": rec["ok"],
                    "source": "export-scale",
                    "summary": {
                        "scale": rec["scale"],
                        "verdict": rec["verdict"],
                        "requiresOutlinedFonts": rec["requiresOutlinedFonts"],
                    },
                    "result": rec,
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0 if rec["ok"] else 1

    print(f"[{'ok' if rec['ok'] else 'FAIL'}] {rec['message']}")
    if rec.get("effectiveDpi") is not None:
        print(f"  effective {rec['effectiveDpi']:g} dpi on {rec['paper']}")
    if rec["requiresOutlinedFonts"]:
        print("  REQUIRED: outline the fonts (glyphs -> paths) before export")
    return 0 if rec["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
