#!/usr/bin/env python3
"""Prevent styles.md from losing all Korean font declarations.

Run python3 tests/test_style_fonts.py from skills/deck.

The 30 upstream styles named only Latin fonts (Helvetica Neue, Futura, Bebas,
Space Mono, Playfair), none declaring Korean glyph coverage. Applying them leaves
all Korean titles/body text to machine-dependent viewer fallback. This font
contract is the skill's only substantive addition to those styles and can
silently disappear on resync while the document still looks plausible.

Check correspondence, not mere existence: mentioning Pretendard once in prose
must not allow its removal from every style row. Each style needs its own Korean
font mapping.
"""

import os
import re
import sys

sys.dont_write_bytecode = True
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
STYLES = os.path.join(ROOT, "references", "styles.md")

# Font families with Korean glyphs; glyph coverage is the criterion.
KOREAN_FACE = re.compile(
    r"Pretendard|Noto Sans KR|Noto Sans Mono CJK KR|Apple SD Gothic"
    r"|Malgun|Nanum|D2Coding|본고딕|나눔",
    re.I,
)

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


def style_names(text):
    """Extract names from headings shaped like ### A. Swiss (...)."""
    out = []
    for m in re.finditer(r"(?m)^###\s+([A-Z])\.\s+([^(\n]+)", text):
        out.append(m.group(2).strip())
    return out


def font_map(text):
    """Parse the style-to-Korean-font table.

    Locate columns by header rather than assuming their order; otherwise an
    inserted column could cause a false pass by reading the wrong cells.
    """
    cells = lambda line: [c.strip() for c in line.strip().strip("|").split("|")]
    lines = text.splitlines()
    out = {}
    for i, line in enumerate(lines):
        if not line.lstrip().startswith("|"):
            continue
        head = cells(line)
        if "Style" not in head or "Korean counterpart" not in head:
            continue
        if i + 1 >= len(lines) or not re.match(r"^\s*\|[\s:|-]+\|\s*$", lines[i + 1]):
            continue
        ix_name, ix_kr = head.index("Style"), head.index("Korean counterpart")
        for row in lines[i + 2:]:
            if not row.lstrip().startswith("|"):
                break
            c = cells(row)
            if len(c) != len(head):
                continue
            name = re.sub(r"[*`]", "", c[ix_name]).strip()
            if name:
                out[name] = c[ix_kr]
    return out


def main():
    styles = read(STYLES)

    check("styles.md is readable", bool(styles.strip()),
          f"{len(styles)}B")

    # (1) Direct C-36 measurement: Korean font names must not fall to zero.
    hits = KOREAN_FACE.findall(styles)
    check("Korean font names are present", len(hits) > 0, f"{len(hits)} matches")

    # (2) Require names inside the stack declaration, not merely scattered prose.
    decl = re.search(r"font-family:\s*([^;}]+)", styles)
    stack = ([f.strip().strip('"\'') for f in decl.group(1).split(",")]
             if decl else [])
    kr_in_stack = [f for f in stack if KOREAN_FACE.search(f)]
    check("CJK fonts appear inside the font-family declaration", len(kr_in_stack) >= 2,
          f"{kr_in_stack}")
    check("The stack ends with sans-serif fallback",
          bool(stack) and "sans-serif" in stack[-1],
          stack[-1] if stack else "no declaration")

    # (3) Each style must have a Korean counterpart: the actual zero-loss guard.
    names = style_names(styles)
    mapping = font_map(styles)
    check("There are three style sections", len(names) == 3, f"{names}")
    check("The Korean font mapping table is readable", len(mapping) >= 1, f"{sorted(mapping)}")

    uncovered = [n for n in names
                 if not KOREAN_FACE.search(mapping.get(n, ""))]
    check("Every style has a Korean font counterpart", names and not uncovered,
          f"unmapped {uncovered}" if uncovered else f"{len(names)}/{len(names)}")

    # (4) A monospace style must not merely inherit a Latin monospace font.
    #     Space Mono lacks Korean glyphs, making this the first likely gap.
    mono = [n for n, kr in mapping.items()
            if re.search(r"Mono|Coding", kr, re.I)]
    check("The monospace style has a Korean monospace counterpart", bool(mono), f"{mono}")

    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n{passed}/{len(results)} 통과")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
