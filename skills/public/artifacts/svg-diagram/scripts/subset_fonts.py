#!/usr/bin/env python3
"""Font subsetting: tool pins, runtime comparison, and two fail-closed policies.

This script enforces references/font-delivery.md.

Three mandatory requirements:
1. Tool pins and runtime comparison: fontTools 4.53.1 / brotli 1.1.0. Read actual
   versions at runtime, not merely declarations. Mismatches require
   --allow-version-drift. Subset bytes differ by version; without pins, arbitrary
   executables could produce accepted artifacts.
2. OFL alias: a subset is a Modified Version, so retaining a Reserved Font Name
   violates its license. Do not produce output without --alias. Preserve copyright,
   license, and licenseURL records.
3. Fail closed both ways: missing tools stop with rc 2, without falling back to
   embedding the whole original. Missing required glyphs stop with rc 1 rather
   than emitting missing-glyph boxes.

Fallback would make subsetting and embedding an entire original indistinguishable
by exit code. Original Korean fonts can be 4–16MB and exceed submission size limits.

Exit codes:
| rc | Meaning |
|---|---|
| 0 | Subset succeeded, or --probe confirmed tool readiness |
| 1 | Input, glyph, or license issue: input/read, glyph/missing, license/alias-required |
| 2 | Missing tool: on_tool_missing, with installation guidance |
| 3 | Version drift: tool/version-drift; only --allow-version-drift bypasses it |

Limitations:
- Does not verify embedding. Produces a subset file, not proof of its inclusion
  in SVG or HWPX.
- The contract suite does not execute actual subsetting without a real font file.
  It checks discovery, pins, OFL alias enforcement, and fail-closed glyph policy.
  SKILL.md discloses the same limitation.
- Does not determine licensing. It enforces an OFL alias; a person assesses whether
  a font uses OFL and permits redistribution through references/font-delivery.md.
- Does not inspect rendered output. Glyph presence does not establish legibility.

Usage:
    python3 scripts/subset_fonts.py --probe --json
    python3 scripts/subset_fonts.py --font NotoSansKR.ttf --text-file labels.txt         --alias "jstack Sans KR" -o build/jstack-sans-kr.subset.ttf
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

PINS = {"fonttools": "4.53.1", "brotli": "1.1.0"}

# Both conditions stop execution. This dict is included in the --probe envelope,
# so removing a policy from code also removes it from the envelope.
POLICY = {"on_tool_missing": "stop", "on_glyph_missing": "stop"}

INSTALL_HINT = (
    "pip install 'fonttools==4.53.1' 'brotli==1.1.0'  "
    "(uv: uv run --with 'fonttools==4.53.1' --with 'brotli==1.1.0' python ...)"
)


def probe_tool() -> dict:
    """Check whether fontTools exists and its version matches the pin."""
    rec = {
        "name": "fonttools",
        "pinned": PINS["fonttools"],
        "available": False,
        "version": None,
        "drift": None,
    }
    try:
        import fontTools  # noqa: PLC0415
    except ImportError:
        return rec
    rec["available"] = True
    rec["version"] = getattr(fontTools, "version", None)
    rec["drift"] = rec["version"] != rec["pinned"]
    return rec


def probe_brotli() -> dict:
    rec = {
        "name": "brotli",
        "pinned": PINS["brotli"],
        "available": False,
        "version": None,
        "drift": None,
    }
    try:
        import brotli  # noqa: PLC0415
    except ImportError:
        return rec
    rec["available"] = True
    rec["version"] = getattr(brotli, "__version__", None)
    rec["drift"] = rec["version"] != rec["pinned"]
    return rec


def diagnostic(
    code: str, message: str, subject=None, evidence=None, severity: str = "error"
) -> dict:
    return {
        "code": code,
        "severity": severity,
        "message": message,
        "subject": subject or {},
        "evidence": evidence or {},
        "supportedFixes": [],
    }


def envelope(ok: bool, summary: dict, diagnostics: list[dict]) -> str:
    return json.dumps(
        {
            "schemaVersion": 1,
            "ok": ok,
            "source": "subset-fonts",
            "summary": summary,
            "diagnostics": diagnostics,
        },
        ensure_ascii=False,
        indent=2,
    )


def emit(
    as_json: bool, ok: bool, summary: dict, diagnostics: list[dict], rc: int
) -> int:
    if as_json:
        print(envelope(ok, summary, diagnostics))
    else:
        for d in diagnostics:
            print(d["message"], file=sys.stderr if not ok else sys.stdout)
        if ok:
            print(f"Summary: {summary}")
    return rc


def run_subset(
    font: Path, text: str, alias: str, out: Path
) -> tuple[bool, dict, list[dict]]:
    from fontTools import subset  # noqa: PLC0415
    from fontTools.ttLib import TTFont  # noqa: PLC0415

    tt = TTFont(str(font))
    cmap = set()
    for table in tt["cmap"].tables:
        cmap |= set(table.cmap)
    wanted = {ord(c) for c in text if not c.isspace()}
    missing = sorted(wanted - cmap)
    if missing:
        return (
            False,
            {},
            [
                diagnostic(
                    "glyph/missing",
                    f"{font.name}: {len(missing)} requested codepoint(s) are absent "
                    f"({' '.join('U+%04X' % c for c in missing[:8])}"
                    f"{' ...' if len(missing) > 8 else ''}) - refusing to ship a subset "
                    "that renders tofu (font-delivery.md on_glyph_missing)",
                    {"font": font.name},
                    {"missing": missing[:64]},
                )
            ],
        )

    opts = subset.Options()
    opts.name_IDs = ["*"]
    opts.name_legacy = True
    opts.notdef_outline = True
    subsetter = subset.Subsetter(options=opts)
    subsetter.populate(unicodes=wanted)
    subsetter.subset(tt)

    # RFN: change names while preserving notices. Rewrite only family(1),
    # subfamily(2), full(4), postscript(6), and typographic family(16).
    original = {}
    for rec in tt["name"].names:
        if rec.nameID in (1, 4, 6, 16):
            original.setdefault(rec.nameID, rec.toUnicode())
            rec.string = (alias if rec.nameID != 6 else alias.replace(" ", "")).encode(
                "utf-16-be" if rec.platformID == 3 else "latin-1"
            )

    out.parent.mkdir(parents=True, exist_ok=True)
    tt.save(str(out))
    manifest = out.with_name("fonts.manifest.json")
    entry = {
        "source": font.name,
        "output": out.name,
        "alias": alias,
        "identity_rewrite": {str(k): v for k, v in sorted(original.items())},
        "codepoints": len(wanted),
    }
    manifest.write_text(
        json.dumps(entry, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return (
        True,
        {
            "out": str(out),
            "manifest": str(manifest),
            "codepoints": len(wanted),
            "alias": alias,
            "identityRewrite": entry["identity_rewrite"],
        },
        [],
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--font", type=Path)
    ap.add_argument("--text", default="")
    ap.add_argument("--text-file", type=Path)
    ap.add_argument("--alias", help="Alias avoiding OFL RFN reuse; required for output")
    ap.add_argument("-o", "--out", type=Path)
    ap.add_argument("--probe", action="store_true", help="Report tool readiness only")
    ap.add_argument("--allow-version-drift", action="store_true")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    tool = probe_tool()
    brotli = probe_brotli()
    summary = {"tool": tool, "brotli": brotli, "policy": POLICY, "pins": PINS}

    if args.probe:
        return emit(
            args.json,
            tool["available"],
            summary,
            []
            if tool["available"]
            else [
                diagnostic(
                    "tool/missing",
                    f"fontTools is not importable - {INSTALL_HINT}",
                    {},
                    {"pinned": PINS["fonttools"]},
                )
            ],
            0 if tool["available"] else 2,
        )

    if not tool["available"]:
        return emit(
            args.json,
            False,
            summary,
            [
                diagnostic(
                    "tool/missing",
                    f"fontTools is not importable, so no subset was produced. "
                    f"There is no fallback: shipping the unsubsetted original would "
                    f"make 'subset ran' indistinguishable from 'the 16MB original went "
                    f"in'. Install the pinned tools - {INSTALL_HINT}",
                    {},
                    {"pinned": PINS["fonttools"]},
                )
            ],
            2,
        )

    if tool["drift"] and not args.allow_version_drift:
        return emit(
            args.json,
            False,
            summary,
            [
                diagnostic(
                    "tool/version-drift",
                    f"fontTools {tool['version']} != pinned {tool['pinned']} - subset "
                    "bytes differ between releases, so an unpinned run cannot produce "
                    "an approval artefact. Pin the version, or pass "
                    "--allow-version-drift and record the drift in the report",
                    {},
                    {"found": tool["version"], "pinned": tool["pinned"]},
                )
            ],
            3,
        )

    if args.font is None or args.out is None:
        return emit(
            args.json,
            False,
            summary,
            [
                diagnostic(
                    "input/arguments",
                    "--font and --out are both required outside --probe",
                    {},
                    {},
                )
            ],
            1,
        )

    if not args.alias:
        return emit(
            args.json,
            False,
            summary,
            [
                diagnostic(
                    "license/alias-required",
                    "a subset is a Modified Version under OFL 1.1, so it may not keep "
                    "the Reserved Font Name - pass --alias with the name this package "
                    "owns (font-delivery.md OFL section)",
                    {"font": args.font.name},
                    {},
                )
            ],
            1,
        )

    text = args.text
    if args.text_file is not None:
        try:
            text += args.text_file.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as exc:
            return emit(
                args.json,
                False,
                summary,
                [
                    diagnostic(
                        "input/read",
                        f"{args.text_file}: cannot read - {type(exc).__name__}: {exc}",
                        {"path": str(args.text_file)},
                        {},
                    )
                ],
                1,
            )
    if not text.strip():
        return emit(
            args.json,
            False,
            summary,
            [
                diagnostic(
                    "input/arguments",
                    "no glyphs requested - pass --text or --text-file",
                    {},
                    {},
                )
            ],
            1,
        )

    if not args.font.is_file():
        return emit(
            args.json,
            False,
            summary,
            [
                diagnostic(
                    "input/read",
                    f"{args.font}: no such font file",
                    {"path": str(args.font)},
                    {},
                )
            ],
            1,
        )

    try:
        ok, extra, diags = run_subset(args.font, text, args.alias, args.out)
    except Exception as exc:  # noqa: BLE001
        return emit(
            args.json,
            False,
            summary,
            [
                diagnostic(
                    "input/read",
                    f"{args.font.name}: fontTools could not open or subset this font - "
                    f"{type(exc).__name__}: {exc}",
                    {"path": str(args.font)},
                    {},
                )
            ],
            1,
        )
    summary.update(extra)
    return emit(args.json, ok, summary, diags, 0 if ok else 1)


if __name__ == "__main__":
    sys.exit(main())
