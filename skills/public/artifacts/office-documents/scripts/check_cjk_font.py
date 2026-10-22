#!/usr/bin/env python3
"""Check East Asian font assignments (<a:ea>) in OOXML artifacts.

OfficeCLI query reports only the Latin family in effective.font. Even after
--prop font.ea=..., that value can remain the theme's Calibri, misleading a
reader into thinking the assignment failed (measured). Unzip the file and
inspect <a:ea typeface="..."> to verify the actual assignment.

Korean without ea uses viewer fallback fonts. Appearance and line breaks vary
across machines, potentially overflowing procurement document pages.

Usage: python3 check_cjk_font.py <file.pptx|docx|xlsx> [--require-font NAME]
Exit 0: no Korean, or Korean with ea assigned.
     1: Korean without ea, or required font mismatch.
     2: file cannot be opened.
"""
import argparse
import re
import sys
import zipfile

HANGUL = re.compile(r"[가-힣]")
EA = re.compile(r'<a:ea[^>]*typeface="([^"]*)"')
# DOCX uses the eastAsia attribute of w:rFonts in a different namespace.
W_EA = re.compile(r'w:eastAsia="([^"]*)"')
# Body text.
A_T = re.compile(r"<a:t>(.*?)</a:t>", re.S)
W_T = re.compile(r"<w:t[^>]*>(.*?)</w:t>", re.S)


def parts(zf):
    for n in zf.namelist():
        if n.endswith(".xml") and (
            n.startswith(("ppt/slides/", "word/", "xl/"))
        ):
            yield n, zf.read(n).decode("utf-8", "replace")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("file")
    ap.add_argument("--require-font", default=None,
                    help="Require this font (substring match)")
    a = ap.parse_args()

    try:
        zf = zipfile.ZipFile(a.file)
    except (OSError, zipfile.BadZipFile) as e:
        print(f"[ERROR] Cannot open: {e}", file=sys.stderr)
        return 2

    hangul_parts, ea_fonts = [], set()
    for name, xml in parts(zf):
        texts = A_T.findall(xml) + W_T.findall(xml)
        if any(HANGUL.search(t) for t in texts):
            hangul_parts.append(name)
        ea_fonts.update(EA.findall(xml))
        ea_fonts.update(W_EA.findall(xml))
    ea_fonts.discard("")

    if not hangul_parts:
        print("No Korean text: CJK font contract does not apply")
        return 0

    print(f"Parts containing Korean: {len(hangul_parts)}: {', '.join(hangul_parts[:3])}"
          + (" …" if len(hangul_parts) > 3 else ""))
    if not ea_fonts:
        print("[FAIL] East Asian font assignments (<a:ea> / w:eastAsia): 0")
        print("       Korean uses viewer fallback fonts and differs across machines")
        print('       Fix: officecli set <file> "<path>" --prop font.ea="Pretendard"')
        return 1

    print(f"Assigned East Asian fonts: {', '.join(sorted(ea_fonts))}")
    if a.require_font:
        ok = any(a.require_font.lower() in f.lower() for f in ea_fonts)
        if not ok:
            print(f"[FAIL] Required font '{a.require_font}' is absent")
            return 1
        print(f"[OK] Required font '{a.require_font}' confirmed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
