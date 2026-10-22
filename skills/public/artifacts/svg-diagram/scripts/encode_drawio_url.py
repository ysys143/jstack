#!/usr/bin/env python3
"""Encode draw.io viewer URLs: first browser fallback.

Many environments lack the draw.io Electron CLI. A viewer URL is then the fastest
handoff path, carrying the entire diagram in its fragment (#).

Why this path is safe:
Browsers do not send the fragment to the server, so diagram contents do not remain
on diagrams.net servers; rendering occurs in the browser. This makes it the first
fallback. The URL itself is secret, however: pasting it in chat, issues, or email
shares the entire diagram. Not sending the fragment to the server is not access control.

Encoding (draw.io compressed format):
    XML -> UTF-8 percent-encode -> raw deflate -> base64 -> percent-encode -> append after #R

Raw deflate has no zlib header or checksum (wbits=-15). Adding a header prevents
viewer decoding. CJK labels fail with "URI malformed" without the percent-encoding
step (references/cjk-contract.md, item 1).

Usage:
    python3 scripts/encode_drawio_url.py diagram.drawio
    python3 scripts/encode_drawio_url.py --decode 'https://viewer.diagrams.net/#R...'
    python3 scripts/encode_drawio_url.py diagram.drawio --json
"""

from __future__ import annotations

import argparse
import base64
import json
import sys
import zlib
from pathlib import Path
from urllib.parse import quote, unquote

VIEWER = "https://viewer.diagrams.net/#R"

# Match the safe characters preserved by JavaScript encodeURIComponent, which
# draw.io uses, so the payload round-trips correctly.
SAFE = "-_.!~*'()"


def encode(xml: str) -> str:
    """Create the compressed draw.io payload as a base64 string."""
    percent = quote(xml, safe=SAFE)
    co = zlib.compressobj(9, zlib.DEFLATED, -15)
    raw = co.compress(percent.encode("utf-8")) + co.flush()
    return base64.b64encode(raw).decode("ascii")


def decode(payload: str) -> str:
    """Decode the compressed payload back to the original XML."""
    raw = base64.b64decode(payload)
    percent = zlib.decompress(raw, -15).decode("utf-8")
    return unquote(percent)


def viewer_url(xml: str) -> str:
    return VIEWER + quote(encode(xml), safe=SAFE)


def payload_of(url: str) -> str:
    frag = url.split("#", 1)[1] if "#" in url else url
    if frag.startswith("R"):
        frag = frag[1:]
    return unquote(frag)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("source", help="A .drawio/XML file, or a URL with --decode")
    ap.add_argument(
        "--decode", action="store_true", help="Decode a URL back to the original XML"
    )
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    if args.decode:
        try:
            xml = decode(payload_of(args.source))
        except (ValueError, zlib.error, UnicodeDecodeError) as exc:
            msg = f"cannot decode the draw.io payload - {type(exc).__name__}: {exc}"
            if args.json:
                print(
                    json.dumps(
                        {
                            "schemaVersion": 1,
                            "ok": False,
                            "source": "encode-drawio-url",
                            "diagnostics": [
                                {
                                    "code": "input/decode",
                                    "severity": "error",
                                    "message": msg,
                                    "subject": {},
                                    "evidence": {},
                                    "supportedFixes": [],
                                }
                            ],
                        },
                        ensure_ascii=False,
                        indent=2,
                    )
                )
            else:
                print(msg, file=sys.stderr)
            return 1
        print(xml)
        return 0

    p = Path(args.source)
    try:
        xml = p.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        msg = f"{p}: cannot read - {type(exc).__name__}: {exc}"
        print(msg, file=sys.stderr)
        return 1

    url = viewer_url(xml)
    # Verify the round trip. A silently corrupted payload would otherwise remain
    # undetected until the link is opened, especially with CJK labels.
    roundtrip = decode(payload_of(url))
    ok = roundtrip == xml

    if args.json:
        print(
            json.dumps(
                {
                    "schemaVersion": 1,
                    "ok": ok,
                    "source": "encode-drawio-url",
                    "summary": {
                        "xmlBytes": len(xml.encode("utf-8")),
                        "urlChars": len(url),
                        "roundTrip": ok,
                    },
                    "url": url,
                    "diagnostics": []
                    if ok
                    else [
                        {
                            "code": "encode/round-trip",
                            "severity": "error",
                            "message": (
                                f"{p.name}: the encoded payload does not decode back "
                                "to the source XML - do not hand this link out"
                            ),
                            "subject": {"file": p.name},
                            "evidence": {},
                            "supportedFixes": [],
                        }
                    ],
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0 if ok else 1

    if not ok:
        print(
            f"{p.name}: round-trip failed - do not hand this link out", file=sys.stderr
        )
        return 1
    print(url)
    return 0


if __name__ == "__main__":
    sys.exit(main())
