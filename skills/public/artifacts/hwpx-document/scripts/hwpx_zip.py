#!/usr/bin/env python3
"""Shared HWPX ZIP reading and writing using only the standard library.

Shared by fix_borders.py, sanitize_template.py, and hooks/hwpx_guard.py. These
must work without lxml: the hook runs under the harness Python, and handoff
assessment must remain available after ensure_hwpx.sh returns 2 for missing lxml.

Enforce the mimetype invariant in one place. Independent ZIP rewrites risk
compressing mimetype or moving it later, making the document unreadable.
"""

from __future__ import annotations

import re
import shutil
import tempfile
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

MIMETYPE = "application/hwp+zip"
HEADER = "Contents/header.xml"
SECTION0 = "Contents/section0.xml"
CONTENT_HPF = "Contents/content.hpf"
PRV_IMAGE = "Preview/PrvImage.png"
PRV_TEXT = "Preview/PrvText.txt"

# Replace client previews with this transparent 1x1 PNG, not an empty file.
# Deleting the entry breaks the manifest; zero-byte PNGs appear corrupt.
NEUTRAL_PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
    "890000000a49444154789c63000100000500010d0a2db40000000049454e44ae"
    "426082"
)

_XMLNS_RE = re.compile(rb'xmlns:([A-Za-z0-9_.-]+)="([^"]+)"')


def read_entry(path: Path, name: str) -> bytes | None:
    """Read a ZIP entry; return None when absent and propagate other exceptions."""
    with zipfile.ZipFile(path) as z:
        try:
            return z.read(name)
        except KeyError:
            return None


def entry_names(path: Path) -> list[str]:
    with zipfile.ZipFile(path) as z:
        return z.namelist()


def parse(raw: bytes) -> ET.Element:
    """Parse XML while restoring original namespace prefixes.

    ElementTree otherwise rewrites prefixes as ns0. Hancom can still open the
    result, but the resulting whole-file diff becomes unreviewable. Extract
    xmlns declarations from the root and register them globally."""
    for m in _XMLNS_RE.finditer(raw[:8192]):
        ET.register_namespace(m.group(1).decode(), m.group(2).decode())
    return ET.fromstring(raw)


def serialize(root: ET.Element) -> bytes:
    return ET.tostring(root, encoding="UTF-8", xml_declaration=True)


def rewrite(path: Path, replacements: dict[str, bytes]) -> None:
    """Replace selected entries in a new ZIP and replace the original.

    mimetype is always the first uncompressed entry. Breaking either property
    prevents Hancom recognizing the file, a frequent but readily reversible
    validation failure."""
    tmp = Path(tempfile.mkstemp(suffix=".hwpx", dir=str(path.parent))[1])
    try:
        with zipfile.ZipFile(path) as src, zipfile.ZipFile(tmp, "w") as dst:
            names = src.namelist()
            if "mimetype" in names:
                data = replacements.get("mimetype", src.read("mimetype"))
                dst.writestr(
                    zipfile.ZipInfo("mimetype"), data, compress_type=zipfile.ZIP_STORED
                )
            for info in src.infolist():
                if info.filename == "mimetype":
                    continue
                data = replacements.get(info.filename)
                if data is None:
                    data = src.read(info.filename)
                dst.writestr(info, data, compress_type=zipfile.ZIP_DEFLATED)
        shutil.move(str(tmp), str(path))
    finally:
        if tmp.exists():
            tmp.unlink()
