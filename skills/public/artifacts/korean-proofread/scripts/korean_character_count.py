#!/usr/bin/env python3
"""Character and byte counting fallback without Node.

The original uses Node Intl.Segmenter. This standard-library Python fallback
keeps the skill usable without Node. Although the external regex module's \\X
is the standard grapheme tool, this implementation directly covers Korean,
combining marks, and emoji ZWJ sequences without another dependency.

Tests compare identical inputs across both implementations when Node is present;
otherwise Python runs alone.

Usage:
    python3 korean_character_count.py --text "한글" --profile neis --format json
"""
from __future__ import annotations

import argparse
import json
import sys
import re
import unicodedata
from pathlib import Path

# One canonical line-break list. The previous three copies (this constant,
# count_lines, neis_bytes) diverged, and the constant was unused dead code.
# Longest first: CRLF must match before CR to count as one break and grapheme,
# as required by references/character-count.md.
LINE_BREAKS = ("\r\n", "\n", "\r", "\u2028", "\u2029")


def line_break_at(text: str, i: int) -> str:
    """Return the line-break sequence at i, or an empty string."""
    for br in LINE_BREAKS:
        if text.startswith(br, i):
            return br
    return ""

# Combining marks and ZWJ attach to the previous character, not a new grapheme.
ZWJ = "‍"
VARIATION = range(0xFE00, 0xFE10)
# Hangul syllables, conjoining jamo, and compatibility jamo; trailing marks allowed.
HANGUL = re.compile(r"^[\uac00-\ud7a3\u1100-\u11ff\u3130-\u318f][̀-ͯ︀-️]*$")


def _combining(ch: str) -> bool:
    return unicodedata.category(ch).startswith("M") or ch == ZWJ \
        or ord(ch) in VARIATION


def graphemes(text: str) -> list[str]:
    """Match Intl.Segmenter's Korean-related grapheme behavior.

    Join Hangul initial/medial/final jamo and combining marks; count ZWJ-linked
    emoji as a single cluster.
    """
    out: list[str] = []
    i = 0
    n = len(text)
    while i < n:
        ch = text[i]
        # Each line-break sequence is one grapheme (UAX #29 GB3 CR x LF;
        # GB4 break after Control). The document and Intl.Segmenter agree.
        # Splitting CR/LF previously gave Python 4 characters/10B versus Node
        # 3 characters/8B for a Korean character, CRLF, and another character;
        # it also made the CRLF branch in neis_bytes unreachable.
        br = line_break_at(text, i)
        if br:
            out.append(br)
            i += len(br)
            continue
        cluster = ch
        i += 1
        # Conjoining Hangul jamo absorb subsequent medial/final jamo.
        while i < n:
            nxt = text[i]
            if _combining(nxt):
                cluster += nxt
                i += 1
                # The character after ZWJ joins the same cluster.
                if nxt == ZWJ and i < n:
                    cluster += text[i]
                    i += 1
                continue
            if 0x1160 <= ord(nxt) <= 0x11FF and 0x1100 <= ord(cluster[-1]) <= 0x11FF:
                cluster += nxt
                i += 1
                continue
            break
        out.append(cluster)
    return out


def count_lines(text: str) -> int:
    """Empty text has zero lines; otherwise line-break count plus one."""
    if not text:
        return 0
    n = 1
    i = 0
    while i < len(text):
        br = line_break_at(text, i)
        if br:
            n += 1
            i += len(br)
            continue
        i += 1
    return n


def neis_bytes(text: str) -> int:
    """Count NEIS bytes by grapheme.

    Upstream korean_character_count.js:83 specifies Hangul=3B, ASCII=1B,
    line break=2B, and UTF-8 fallback for everything else. Code-point counting
    diverges on ZWJ emoji: a family sequence can be one grapheme with five points.
    """
    total = 0
    for g in graphemes(text):
        if g in LINE_BREAKS:
            total += 2
        elif len(g) == 1 and ord(g) < 128:
            total += 1
        elif HANGUL.match(g):
            total += 3
        else:
            total += len(g.encode("utf-8"))
    return total


def measure(text: str, profile: str) -> dict:
    g = graphemes(text)
    counts = {
        "characters": len(g),
        "characters_without_whitespace": len([c for c in g if not c.isspace()]),
        "code_points": len(text),
        "utf16_code_units": sum(2 if ord(c) > 0xFFFF else 1 for c in text),
        "lines": count_lines(text),
        "bytes": neis_bytes(text) if profile == "neis"
        else len(text.encode("utf-8")),
        # Node emits both counts for comparison without changing profiles.
        # Keep output shapes aligned; tests detect divergence.
        "bytes_utf8": len(text.encode("utf-8")),
        "bytes_neis": neis_bytes(text),
    }
    return {
        "profile": profile,
        "engine": "python-fallback",
        "contract": {
            "characters": "Grapheme clusters (Hangul jamo + combining marks + ZWJ)",
            "bytes": ("NEIS: Hangul=3B, ASCII=1B, linebreak=2B" if profile == "neis"
                      else "Actual UTF-8 encoded byte length"),
            "lines": ("Empty string => 0 lines; otherwise count CRLF, LF, CR, "
                      "U+2028, U+2029 as one line break each and add 1"),
        },
        "counts": counts,
    }


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--text")
    src.add_argument("--file", type=Path)
    src.add_argument("--stdin", action="store_true")
    ap.add_argument("--profile", choices=("default", "neis"), default="default")
    ap.add_argument("--format", choices=("json", "text"), default="json")
    a = ap.parse_args(argv)

    if a.text is not None:
        text = a.text
    elif a.file:
        if not a.file.exists():
            print(f"[STOP] File not found: {a.file}", file=sys.stderr)
            return 2
        text = a.file.read_text(encoding="utf-8")
    else:
        text = sys.stdin.read()

    r = measure(text, a.profile)
    if a.format == "json":
        print(json.dumps(r, ensure_ascii=False, indent=2))
    else:
        c = r["counts"]
        print(f"characters {c['characters']} / without whitespace {c['characters_without_whitespace']} "
              f"/ lines {c['lines']} / bytes {c['bytes']} ({a.profile})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
