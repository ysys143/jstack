#!/usr/bin/env python3
"""Sanitize client templates so outputs do not carry another document's residue.

md_to_hwpx.py --reference reuses a client's format by inheriting all reference
ZIP entries. That also inherits non-format content:
- Preview/PrvImage.png exposes the client's original thumbnail before opening,
  even when body text contains the new proposal.
- creator/lastsaveby in Contents/content.hpf retain author names.
- hh:trackChange* retains client review history and authors.
These do not violate XML consistency and escape ordinary validation.

Four dimensions:
| Dimension | --check | --fix |
|---|---|---|
| preview | Detect retained client thumbnail | Replace with neutral 1x1 PNG |
| metadata | Detect personal or organization identifiers | Clear values |
| trackchange | Detect tracked-change elements | Remove elements |
| unused-style | Detect unreferenced styles | Remove only with --prune-styles |

Unused styles may be needed by a later section, so pruning is not a default.
Sanitation and optimization remain separate operations.

Usage:
    python3 scripts/sanitize_template.py output.hwpx --check
    python3 scripts/sanitize_template.py output.hwpx --fix
    python3 scripts/sanitize_template.py output.hwpx --fix --prune-styles

Exit codes: 0 clean or repaired; 1 findings in --check; 2 input error.
"""

from __future__ import annotations

import argparse
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hwpx_zip import (CONTENT_HPF, HEADER, NEUTRAL_PNG,  # noqa: E402
                      PRV_IMAGE, entry_names, parse, read_entry, rewrite,
                      serialize)

HH = "{http://www.hancom.co.kr/hwpml/2011/head}"
HP = "{http://www.hancom.co.kr/hwpml/2011/paragraph}"
OPF = "{http://www.idpf.org/2007/opf/}"

# Placeholders treated as empty; the template actually uses content="text".
PLACEHOLDERS = {"", "text", "-", "none"}
# Metadata keys identifying people or organizations.
IDENTIFYING = ("creator", "lastsaveby", "subject", "description", "keyword")


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def find_preview(path: Path) -> list[str]:
    if PRV_IMAGE not in entry_names(path):
        return []
    raw = read_entry(path, PRV_IMAGE)
    if raw == NEUTRAL_PNG:
        return []
    return [f"preview: {PRV_IMAGE} carries the reference document's thumbnail "
            f"({len(raw)} bytes)"]


def find_metadata(root) -> list[str]:
    out = []
    title = root.find(f".//{OPF}title")
    if title is not None and (title.text or "").strip().lower() not in PLACEHOLDERS:
        out.append(f"metadata: opf:title = {title.text.strip()!r}")
    for meta in root.iter(f"{OPF}meta"):
        name = meta.get("name")
        val = (meta.get("content") or "").strip()
        if name in IDENTIFYING and val.lower() not in PLACEHOLDERS:
            out.append(f"metadata: {name} = {val!r}")
    return out


def find_trackchange(root, where: str) -> list[str]:
    out = []
    for el in root.iter():
        if _local(el.tag).startswith("trackChange"):
            out.append(f"trackchange: <{_local(el.tag)}> in {where}")
    return out


def unused_styles(header, sections: list) -> list[str]:
    used = set()
    for sec in sections:
        for p in sec.iter(f"{HP}p"):
            sid = p.get("styleIDRef")
            if sid:
                used.add(sid)
    # References through another style's nextStyleIDRef also count as use.
    for st in header.iter(f"{HH}style"):
        nxt = st.get("nextStyleIDRef")
        if nxt:
            used.add(nxt)
    out = []
    for st in header.iter(f"{HH}style"):
        sid = st.get("id")
        if sid and sid not in used:
            out.append(f"unused-style: id={sid} name={st.get('name')!r}")
    return out


def _sections(path: Path) -> list[str]:
    return sorted(n for n in entry_names(path)
                  if n.startswith("Contents/section") and n.endswith(".xml"))


def scan(path: Path):
    """(findings, parsed trees); --fix reuses the same trees."""
    header = parse(read_entry(path, HEADER))
    hpf_raw = read_entry(path, CONTENT_HPF)
    hpf = parse(hpf_raw) if hpf_raw else None
    secs = {n: parse(read_entry(path, n)) for n in _sections(path)}

    findings = find_preview(path)
    if hpf is not None:
        findings += find_metadata(hpf)
    findings += find_trackchange(header, HEADER)
    for name, sec in secs.items():
        findings += find_trackchange(sec, name)
    findings += unused_styles(header, list(secs.values()))
    return findings, header, hpf, secs


def _drop_trackchange(root) -> int:
    dropped = 0
    for parent in list(root.iter()):
        for child in list(parent):
            if _local(child.tag).startswith("trackChange"):
                parent.remove(child)
                dropped += 1
    return dropped


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("hwpx")
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true", default=True,
                      help="Inspect only (default)")
    mode.add_argument("--fix", action="store_true", help="Remove detected residue")
    ap.add_argument("--prune-styles", action="store_true",
                    help="Remove unused styles only when combined with --fix")
    a = ap.parse_args()

    path = Path(a.hwpx)
    if not path.is_file():
        print(f"File not found: {path}", file=sys.stderr)
        return 2
    try:
        findings, header, hpf, secs = scan(path)
    except zipfile.BadZipFile:
        print(f"Not a valid ZIP archive: {path}", file=sys.stderr)
        return 2
    except (KeyError, TypeError):
        print(f"Missing required file: {HEADER}", file=sys.stderr)
        return 2

    for f in findings:
        print(f)

    if not a.fix:
        if not findings:
            print("OK: no reference-document residue")
            return 0
        print(f"FOUND: {len(findings)} residue item(s)", file=sys.stderr)
        return 1

    repl: dict[str, bytes] = {}
    if find_preview(path):
        repl[PRV_IMAGE] = NEUTRAL_PNG
    if hpf is not None and find_metadata(hpf):
        t = hpf.find(f".//{OPF}title")
        if t is not None:
            t.text = ""
        for meta in hpf.iter(f"{OPF}meta"):
            if meta.get("name") in IDENTIFYING:
                meta.set("content", "")
        repl[CONTENT_HPF] = serialize(hpf)
    if _drop_trackchange(header):
        repl[HEADER] = serialize(header)
    for name, sec in secs.items():
        if _drop_trackchange(sec):
            repl[name] = serialize(sec)

    pruned = 0
    if a.prune_styles:
        stale = {f.split("id=")[1].split(" ")[0]
                 for f in unused_styles(header, list(secs.values()))}
        for parent in header.iter(f"{HH}styles"):
            for st in list(parent):
                if st.get("id") in stale:
                    parent.remove(st)
                    pruned += 1
            parent.set("itemCnt", str(len(list(parent))))
        if pruned:
            repl[HEADER] = serialize(header)

    if not repl:
        print("OK: nothing to rewrite")
        return 0
    rewrite(path, repl)
    print(f"SANITIZED: rewrote {len(repl)} entr(ies)"
          + (f", pruned {pruned} style(s)" if pruned else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
