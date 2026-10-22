#!/usr/bin/env python3
"""Postprocess PNG: restore truncated IEND and set DPI through pHYs.

Why this is required:
Some draw.io CLI -e (embed) versions drop the final eight bytes of the IEND chunk.
The file is unreadable despite exit code 0: vision APIs return 400, Hangul viewers
show an empty box, and users waste time diagnosing missing output. This script
addresses the gap between successful exit status and a broken artifact.

Why DPI is handled here:
PNG stores pixels per meter in pHYs, not DPI directly. Without that chunk, Hangul
and Word assume 96dpi and can place an A4 diagram at twice the page size. Exporting
at 300dpi through export_scale.py without writing pHYs discards that calculation.

Excluded operations:
- Does not repair pixels, truncated scanlines, or corrupted IDAT. Checks only
  structure: chunk boundaries, CRC, and IEND.
- Does not overwrite the original unless --in-place is supplied.

Limitations:
- Does not repair pixels. This repeats the exclusion because SKILL.md links here.
- Cannot recover corrupt IDAT compression. Structural repair may still leave the
  image unreadable; re-export is then the only solution.
- No special handling for APNG or interlacing. Chunk checks can report intact
  structure despite broken APNG frame relationships.
- Only adjusts pHYs metadata, leaving iCCP color profiles and gAMA untouched.

Usage:
    python3 scripts/repair_png.py out.png --dpi 300 -o fixed.png
    python3 scripts/repair_png.py out.png --check --json
"""

from __future__ import annotations

import argparse
import binascii
import json
import struct
import sys
from pathlib import Path

SIG = b"\x89PNG\r\n\x1a\n"
IEND = b"\x00\x00\x00\x00IEND\xaeB`\x82"
METERS_PER_INCH = 39.3701


def chunks(data: bytes):
    """Yield (type, payload, crc_ok) in order; stop at a truncated tail."""
    i = len(SIG)
    while i + 8 <= len(data):
        (length,) = struct.unpack(">I", data[i : i + 4])
        ctype = data[i + 4 : i + 8]
        end = i + 8 + length + 4
        if end > len(data):
            return
        payload = data[i + 8 : i + 8 + length]
        (crc,) = struct.unpack(">I", data[i + 8 + length : end])
        yield ctype, payload, crc == binascii.crc32(ctype + payload) & 0xFFFFFFFF
        i = end


def make_chunk(ctype: bytes, payload: bytes) -> bytes:
    return (
        struct.pack(">I", len(payload))
        + ctype
        + payload
        + struct.pack(">I", binascii.crc32(ctype + payload) & 0xFFFFFFFF)
    )


def phys_chunk(dpi: float) -> bytes:
    ppm = int(round(dpi * METERS_PER_INCH))
    return make_chunk(b"pHYs", struct.pack(">IIB", ppm, ppm, 1))


def inspect(data: bytes) -> dict:
    rec = {
        "signature": data.startswith(SIG),
        "chunks": [],
        "badCrc": [],
        "hasIend": False,
        "hasPhys": False,
        "dpi": None,
        "trailingBytes": 0,
    }
    if not rec["signature"]:
        return rec
    consumed = len(SIG)
    for ctype, payload, ok in chunks(data):
        name = ctype.decode("latin-1")
        rec["chunks"].append(name)
        if not ok:
            rec["badCrc"].append(name)
        if ctype == b"IEND":
            rec["hasIend"] = True
        if ctype == b"pHYs" and len(payload) == 9:
            x, _y, unit = struct.unpack(">IIB", payload)
            rec["hasPhys"] = True
            if unit == 1 and x:
                rec["dpi"] = round(x / METERS_PER_INCH, 2)
        consumed += 12 + len(payload)
    rec["trailingBytes"] = len(data) - consumed
    return rec


def repair(data: bytes, *, dpi: float | None) -> tuple[bytes, list[str]]:
    """Return structurally repaired bytes and the list of actions performed."""
    actions: list[str] = []
    if not data.startswith(SIG):
        raise ValueError("not a PNG (signature mismatch)")

    kept = bytearray(SIG)
    saw_iend = False
    for ctype, payload, ok in chunks(data):
        if ctype == b"IEND":
            saw_iend = True
            break
        if not ok:
            actions.append(f"recomputed CRC for {ctype.decode('latin-1')}")
        if ctype == b"pHYs" and dpi is not None:
            actions.append("replaced pHYs")
            continue
        kept += make_chunk(ctype, payload)
    if dpi is not None:
        kept += phys_chunk(dpi)
        actions.append(f"wrote pHYs for {dpi:g} dpi")
    kept += IEND
    if not saw_iend:
        actions.append("appended the missing IEND chunk")
    return bytes(kept), actions


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("png", type=Path)
    ap.add_argument("-o", "--out", type=Path)
    ap.add_argument("--in-place", action="store_true")
    ap.add_argument(
        "--dpi", type=float, default=None, help="DPI to write into pHYs (300 for procurement print)"
    )
    ap.add_argument(
        "--check", action="store_true", help="Diagnose without repair; return rc=1 for broken files"
    )
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    try:
        data = args.png.read_bytes()
    except OSError as exc:
        print(f"{args.png}: cannot read - {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1

    before = inspect(data)
    broken = not before["signature"] or not before["hasIend"] or bool(before["badCrc"])

    if args.check:
        if args.json:
            print(
                json.dumps(
                    {
                        "schemaVersion": 1,
                        "ok": not broken,
                        "source": "repair-png",
                        "summary": before,
                    },
                    ensure_ascii=False,
                    indent=2,
                )
            )
        else:
            state = "broken" if broken else "ok"
            print(
                f"[{state}] {args.png.name}: {len(before['chunks'])} chunk(s), "
                f"IEND {'present' if before['hasIend'] else 'MISSING'}, "
                f"bad CRC {before['badCrc'] or 'none'}, "
                f"dpi {before['dpi']}"
            )
        return 1 if broken else 0

    try:
        fixed, actions = repair(data, dpi=args.dpi)
    except ValueError as exc:
        print(f"{args.png}: {exc}", file=sys.stderr)
        return 1

    dest = (
        args.png if args.in_place else (args.out or args.png.with_suffix(".fixed.png"))
    )
    dest.write_bytes(fixed)
    after = inspect(fixed)

    if args.json:
        print(
            json.dumps(
                {
                    "schemaVersion": 1,
                    "ok": after["hasIend"],
                    "source": "repair-png",
                    "summary": {
                        "out": str(dest),
                        "actions": actions,
                        "before": before,
                        "after": after,
                    },
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0 if after["hasIend"] else 1

    for a in actions:
        print(a)
    print(
        f"Summary: wrote {dest} ({len(fixed)} bytes), "
        f"IEND {'present' if after['hasIend'] else 'MISSING'}, "
        f"dpi {after['dpi']}"
    )
    return 0 if after["hasIend"] else 1


if __name__ == "__main__":
    sys.exit(main())
