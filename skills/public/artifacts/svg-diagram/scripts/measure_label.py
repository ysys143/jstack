#!/usr/bin/env python3
"""Arrow-label width caps measured in em, not character counts.

Upstream up:diagram-design section 6 requires <=14 characters, all-caps. Both
parts fail for this use case.

1. A character-count cap produces a 1.8x width difference for Korean: 14 Korean
   characters occupy 14em, versus about 7.7em for 14 Latin characters. The same
   count therefore invalidates fixed mask widths such as width="36" for one script.
2. Uppercase is undefined for Korean. This checker does not pretend to measure it:
   treating every Korean label as either passing or failing would add no information.

Mixed-script weights (references/cjk-contract.md, item 19):

| Character class | Weight | Rationale |
|---|---|---|
| Full-width Korean, Han, kana, symbols | 1.00em | Noto Sans KR, Apple SD Gothic Neo, and Malgun Gothic use 1000/1000 upm advances |
| Whitespace | 0.25em | Counting a space as 1em incorrectly gives it a Korean character's width |
| ASCII Latin, digits, symbols | 0.55em | Reproduces 14 Latin characters = 7.7em |
| Other characters | 0.55em | Treat non-wide Latin extensions and Cyrillic as narrow |

Applying one em per full-width character to an entire string is the defect.
It is valid for one Korean syllable but overestimates mixed strings by 20–25%,
creating oversized masks that can violate rule 6. This is a case where a
conservative overestimate is not safer.

Default cap: 14em, interpreting upstream's 14-character limit in Korean em.
Exactly 14 Korean characters reach the cap; 14 Latin characters use just over
half. Override with --cap.

Limitations:
- Does not edit or open diagram files or discover labels. A person selects the
  string; the script measures em width and compares it with the cap.
- Coefficients are a model, not measured font data. EM_WIDE/EM_NARROW/EM_SPACE
  were not verified by reading advances from Noto Sans KR or Apple SD Gothic Neo
  font files. Small overruns may be missed.
- Does not account for letter-spacing or word-spacing set through SVG attributes.
  verify-text-width.py handles the broader SVG width model.
- Cannot measure vertical writing (cjk-contract.md). verify-connectors.py
  --strict-rules emits taste/writing-mode for that condition.

Usage:
    python3 scripts/measure_label.py "인증 서비스 게이트웨이"
    python3 scripts/measure_label.py --json "READ MDX" "인증 서비스"
    python3 scripts/measure_label.py --cap 10 --font-size 8 "QUERY"
"""

from __future__ import annotations

import argparse
import json
import sys
import unicodedata

# Default cap: interpret upstream's 14 characters as Korean em.
DEFAULT_CAP_EM = 14.0

WIDE_CATEGORIES = ("W", "F")

EM_SPACE = 0.25
EM_WIDE = 1.00
EM_NARROW = 0.55


def char_em(ch: str) -> float:
    """Width of one character in em; east_asian_width identifies wide characters."""
    if ch.isspace():
        return EM_SPACE
    if unicodedata.east_asian_width(ch) in WIDE_CATEGORIES:
        return EM_WIDE
    if unicodedata.combining(ch):
        # Combining marks have zero width, matching output-spec.md.
        return 0.0
    return EM_NARROW


def measure_em(text: str) -> float:
    """String width in em, not a character count."""
    return sum(char_em(ch) for ch in text)


def breakdown(text: str) -> dict:
    """Counts by character class for manual reproduction of the verdict."""
    wide = sum(
        1
        for ch in text
        if not ch.isspace() and unicodedata.east_asian_width(ch) in WIDE_CATEGORIES
    )
    space = sum(1 for ch in text if ch.isspace())
    combining = sum(1 for ch in text if unicodedata.combining(ch))
    return {
        "wide": wide,
        "space": space,
        "combining": combining,
        "narrow": len(text) - wide - space - combining,
    }


def measure(
    text: str, *, cap: float = DEFAULT_CAP_EM, font_size: float | None = None
) -> dict:
    em = measure_em(text)
    rec = {
        "text": text,
        "chars": len(text),
        "em": round(em, 4),
        "cap": cap,
        "over": em > cap,
        "breakdown": breakdown(text),
    }
    if font_size is not None:
        rec["fontSize"] = font_size
        rec["px"] = round(em * font_size, 3)
    return rec


def diagnostic(rec: dict) -> dict:
    return {
        "code": "label/em-cap",
        "severity": "error",
        "message": (
            f"{rec['text']!r}: {rec['em']:g}em exceeds the {rec['cap']:g}em "
            f"arrow-label cap ({rec['chars']} chars; "
            f"wide={rec['breakdown']['wide']} "
            f"narrow={rec['breakdown']['narrow']} "
            f"space={rec['breakdown']['space']}) - "
            "shorten the label or widen the mask; do not shrink the type"
        ),
        "subject": {"label": rec["text"]},
        "evidence": {"em": rec["em"], "cap": rec["cap"], "breakdown": rec["breakdown"]},
        "supportedFixes": [],
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("labels", nargs="+")
    ap.add_argument(
        "--cap",
        type=float,
        default=DEFAULT_CAP_EM,
        help=f"em cap (default {DEFAULT_CAP_EM:g}em)",
    )
    ap.add_argument(
        "--font-size", type=float, default=None, help="Also report pixel width when supplied"
    )
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    recs = [measure(t, cap=args.cap, font_size=args.font_size) for t in args.labels]
    over = [r for r in recs if r["over"]]

    if args.json:
        print(
            json.dumps(
                {
                    "schemaVersion": 1,
                    "ok": not over,
                    "source": "measure-label",
                    "summary": {
                        "labels": len(recs),
                        "over": len(over),
                        "cap": args.cap,
                    },
                    "measurements": recs,
                    "diagnostics": [diagnostic(r) for r in over],
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 1 if over else 0

    for r in recs:
        px = f" = {r['px']:g}px" if "px" in r else ""
        flag = "OVER" if r["over"] else "ok"
        print(
            f"[{flag}] {r['text']!r}: {r['em']:g}em{px} "
            f"(chars {r['chars']}, cap {r['cap']:g}em)"
        )
    print(f"Summary: {len(recs)} label(s) measured, {len(over)} over cap.")
    return 1 if over else 0


if __name__ == "__main__":
    sys.exit(main())
