#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Convert a Markdown proposal draft to HWPX with real HWPX tables.

The converter copies a reference HWPX package, reuses its header.xml and first
section page setup, then replaces Contents/section0.xml with generated XML.
If the reference is a binary .hwp, it is converted to .reference.hwpx through
Hancom COM first.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import importlib.util
import math
import re
import sys
import tempfile
import zipfile
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from lxml import etree


NS = {
    "hp": "http://www.hancom.co.kr/hwpml/2011/paragraph",
    "hs": "http://www.hancom.co.kr/hwpml/2011/section",
    "hc": "http://www.hancom.co.kr/hwpml/2011/core",
    "hh": "http://www.hancom.co.kr/hwpml/2011/head",
    "opf": "http://www.idpf.org/2007/opf/",
}
XML_SPACE = "{http://www.w3.org/XML/1998/namespace}space"


@dataclass
class StyleProfile:
    nsmap: dict
    header_xml: bytes
    sec_pr: etree._Element
    col_ctrl: etree._Element
    body_width: int
    table_width: int
    first_para: str = "71"
    first_char: str = "46"
    h2_para: str = "62"
    h2_char: str = "10"
    h2_style: str = "0"
    h3_para: str = "43"
    h3_char: str = "12"
    h3_style: str = "0"
    h4_para: str = "43"
    h4_char: str = "12"
    h4_style: str = "0"
    body_para: str = "75"
    body_char: str = "12"
    body_style: str = "0"
    neutral_para: str = "0"
    neutral_char: str = "0"
    neutral_style: str = "0"
    square_para: str = "75"
    square_char: str = "12"
    square_style: str = "0"
    number_para: str = "75"
    number_char: str = "12"
    number_style: str = "0"
    code_para: str = "75"
    code_char: str = "41"
    code_style: str = "0"
    table_outer_border: str = "10"
    table_head_left_border: str = "11"
    table_head_mid_border: str = "12"
    table_head_right_border: str = "13"
    table_body_left_border: str = "14"
    table_body_mid_border: str = "15"
    table_body_right_border: str = "16"
    table_head_para: str = "44"
    table_head_char: str = "48"
    table_body_para: str = "80"
    table_body_char: str = "50"
    table_head_style: str = "0"
    table_body_style: str = "0"
    table_caption_para: str = "0"
    table_caption_char: str = "0"
    table_caption_style: str = "0"
    figure_caption_para: str = "0"
    figure_caption_char: str = "0"
    figure_caption_style: str = "0"


class IdFactory:
    def __init__(self, start: int = 500000000):
        self._value = start

    def next(self) -> str:
        self._value += 1
        return str(self._value)


def q(prefix: str, name: str) -> str:
    return f"{{{NS[prefix]}}}{name}"


def localname(el: etree._Element) -> str:
    return etree.QName(el).localname


def text_width(text: str) -> int:
    width = 0
    for ch in text:
        if ord(ch) < 128:
            width += 1
        elif "\uac00" <= ch <= "\ud7a3":
            width += 2
        else:
            width += 2
    return width


def normalize_inline_source(text: str) -> str:
    text = text.replace("&nbsp;", " ")
    text = text.replace("\\|", "|")
    return text.strip()


def strip_inline_markdown(text: str) -> str:
    text = normalize_inline_source(text)
    text = re.sub(r"`([^`]*)`", r"\1", text)
    text = re.sub(r"\*\*\*([^*]+)\*\*\*", r"\1", text)
    text = re.sub(r"___([^_]+)___", r"\1", text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"\1", text)
    text = re.sub(r"__([^_]+)__", r"\1", text)
    text = re.sub(r"(?<!\*)\*([^*\n]+)\*(?!\*)", r"\1", text)
    text = re.sub(r"(?<!_)_([^_\n]+)_(?!_)", r"\1", text)
    text = re.sub(r"!\[([^\]]*)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    return text.strip()


UNICODE_ROMAN = {
    "Ⅰ": 1,
    "Ⅱ": 2,
    "Ⅲ": 3,
    "Ⅳ": 4,
    "Ⅴ": 5,
    "Ⅵ": 6,
    "Ⅶ": 7,
    "Ⅷ": 8,
    "Ⅸ": 9,
    "Ⅹ": 10,
}
LATIN_ROMAN = {
    "I": 1,
    "II": 2,
    "III": 3,
    "IV": 4,
    "V": 5,
    "VI": 6,
    "VII": 7,
    "VIII": 8,
    "IX": 9,
    "X": 10,
}


def roman_to_arabic_text(text: str) -> str:
    def unicode_dash(match: re.Match[str]) -> str:
        return f"{UNICODE_ROMAN[match.group(1)]}.{match.group(2)}"

    def unicode_single(match: re.Match[str]) -> str:
        return str(UNICODE_ROMAN[match.group(1)])

    def latin_dash(match: re.Match[str]) -> str:
        return f"{LATIN_ROMAN[match.group(1)]}.{match.group(2)}"

    text = re.sub(r"([ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ])-([0-9]+(?:\.[0-9]+)*)", unicode_dash, text)
    text = re.sub(r"([ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ])", unicode_single, text)
    text = re.sub(r"\b(I|II|III|IV|V|VI|VII|VIII|IX|X)-([0-9]+(?:\.[0-9]+)*)\b", latin_dash, text)
    return text


def apply_roman_to_arabic_outside_code(text: str) -> str:
    out: list[str] = []
    in_code = False
    for line in text.splitlines(keepends=True):
        if line.lstrip().startswith("```"):
            in_code = not in_code
            out.append(line)
        elif in_code:
            out.append(line)
        else:
            out.append(roman_to_arabic_text(line))
    return "".join(out)


def split_pipe_row(line: str) -> list[str]:
    s = line.strip()
    if s.startswith("|"):
        s = s[1:]
    if s.endswith("|"):
        s = s[:-1]

    cells: list[str] = []
    cur: list[str] = []
    escaped = False
    in_code = False
    for ch in s:
        if escaped:
            cur.append(ch)
            escaped = False
            continue
        if ch == "\\":
            escaped = True
            continue
        if ch == "`":
            in_code = not in_code
            cur.append(ch)
            continue
        if ch == "|" and not in_code:
            cells.append(normalize_inline_source("".join(cur)))
            cur = []
        else:
            cur.append(ch)
    cells.append(normalize_inline_source("".join(cur)))
    return cells


def is_separator_row(line: str) -> bool:
    cells = split_pipe_row(line)
    if not cells:
        return False
    return all(re.fullmatch(r":?-+:?", cell.strip()) for cell in cells)


def normalize_table(rows: list[list[str]]) -> list[list[str]]:
    if not rows:
        return rows
    cols = max(len(row) for row in rows)
    return [row + [""] * (cols - len(row)) for row in rows]


def is_grid_separator(line: str) -> bool:
    s = line.strip()
    return "|" in s and "-" in s and bool(re.fullmatch(r"[-|\s]+", s))


def code_block_as_table(lines: list[str]) -> dict | None:
    meaningful = [line.rstrip() for line in lines if line.strip()]
    if not meaningful:
        return None
    if not any(is_grid_separator(line) for line in meaningful):
        return None
    if not all("|" in line for line in meaningful):
        return None

    rows: list[list[str]] = []
    for line in meaningful:
        if is_grid_separator(line):
            continue
        row_text = line.rstrip()
        if row_text.endswith("|"):
            row_text = row_text[:-1]
        rows.append([normalize_inline_source(cell) for cell in row_text.split("|")])
    if len(rows) < 2:
        return None
    return {"type": "table", "rows": normalize_table(rows)}


def parse_markdown(text: str, number_subheadings: bool = True) -> list[dict]:
    blocks: list[dict] = []
    paragraph: list[str] = []
    lines = text.splitlines()
    i = 0
    in_code = False
    code_lines: list[str] = []
    subheading_counter = 0

    def flush_paragraph() -> None:
        nonlocal paragraph
        if paragraph:
            blocks.append({"type": "paragraph", "text": normalize_inline_source(" ".join(paragraph))})
            paragraph = []

    def flush_code() -> None:
        nonlocal code_lines
        table = code_block_as_table(code_lines)
        if table is not None:
            blocks.append(table)
        else:
            blocks.append({"type": "code", "lines": code_lines})
        code_lines = []

    while i < len(lines):
        raw = lines[i]
        line = raw.rstrip("\n")
        stripped = line.strip()

        if stripped.startswith("```"):
            if in_code:
                flush_code()
                in_code = False
            else:
                flush_paragraph()
                in_code = True
                code_lines = []
            i += 1
            continue

        if in_code:
            code_lines.append(line)
            i += 1
            continue

        if not stripped:
            flush_paragraph()
            i += 1
            continue

        if stripped == "---":
            flush_paragraph()
            blocks.append({"type": "blank"})
            i += 1
            continue

        heading = re.match(r"^(#{1,6})\s+(.+)$", stripped)
        if heading:
            flush_paragraph()
            level = len(heading.group(1))
            heading_text = normalize_inline_source(heading.group(2))
            if level == 2:
                subheading_counter = 0
            elif level >= 3 and number_subheadings:
                subheading_counter += 1
                heading_text = re.sub(r"^\d+\.\s*", "", heading_text)
                heading_text = f"({subheading_counter}) {heading_text}"
            blocks.append(
                {
                    "type": "heading",
                    "level": level,
                    "text": heading_text,
                }
            )
            i += 1
            continue

        if stripped.startswith("|") and i + 1 < len(lines) and is_separator_row(lines[i + 1]):
            flush_paragraph()
            table_lines = [line, lines[i + 1]]
            i += 2
            while i < len(lines) and lines[i].strip().startswith("|"):
                table_lines.append(lines[i])
                i += 1
            rows = [split_pipe_row(table_lines[0])]
            rows.extend(split_pipe_row(row) for row in table_lines[2:])
            blocks.append({"type": "table", "rows": normalize_table(rows)})
            continue

        if stripped.startswith(">"):
            flush_paragraph()
            quote = stripped.lstrip(">").strip()
            if quote:
                if re.match(r"^[-*+]\s+", quote):
                    blocks.append({"type": "list_item", "text": normalize_inline_source(quote[2:].strip())})
                else:
                    blocks.append({"type": "paragraph", "text": normalize_inline_source(quote)})
            else:
                blocks.append({"type": "blank"})
            i += 1
            continue

        if re.match(r"^[-*+]\s+", stripped):
            flush_paragraph()
            blocks.append({"type": "list_item", "text": normalize_inline_source(stripped[2:].strip())})
            i += 1
            continue

        ordered = re.match(r"^(\d+)[.)]\s+(.+)$", stripped)
        if ordered:
            flush_paragraph()
            blocks.append({"type": "numbered_item", "text": normalize_inline_source(f"({ordered.group(1)}) {ordered.group(2).strip()}")})
            i += 1
            continue

        paragraph.append(stripped)
        i += 1

    if in_code and code_lines:
        flush_code()
    flush_paragraph()
    return blocks


def convert_hwp_to_hwpx(reference: Path, cache_dir: Path | None = None) -> Path:
    if cache_dir is None:
        cache_dir = Path(tempfile.gettempdir()) / "proposal_hwpx_reference_cache"
    cache_dir.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha1(str(reference.resolve()).encode("utf-8")).hexdigest()[:12]
    out = cache_dir / f"{reference.stem}.{digest}.reference.hwpx"
    if out.exists() and out.stat().st_mtime >= reference.stat().st_mtime:
        return out
    try:
        import win32com.client as win32
    except ImportError as exc:
        raise SystemExit("pywin32 is required to convert .hwp references to .hwpx") from exc

    hwp = None
    try:
        if out.exists():
            out.unlink()
        hwp = win32.gencache.EnsureDispatch("HWPFrame.HwpObject")
        hwp.RegisterModule("FilePathCheckDLL", "SecurityModule")
        try:
            hwp.XHwpWindows.Item(0).Visible = False
        except Exception:
            pass
        if not hwp.Open(str(reference)):
            raise RuntimeError(f"HWP Open returned false: {reference}")
        if not hwp.SaveAs(str(out), "HWPX", ""):
            raise RuntimeError(f"HWP SaveAs HWPX returned false: {out}")
    finally:
        if hwp is not None:
            try:
                hwp.Quit()
            except Exception:
                pass
    return out


def resolve_reference(reference: Path, cache_dir: Path | None = None) -> Path:
    if not reference.is_file():
        raise SystemExit(f"Reference not found: {reference}")
    suffix = reference.suffix.lower()
    if suffix == ".hwpx":
        return reference
    if suffix == ".hwp":
        return convert_hwp_to_hwpx(reference, cache_dir=cache_dir)
    raise SystemExit(f"Unsupported reference format: {reference.suffix}")


def infer_reference_table_borders(root: etree._Element, profile: StyleProfile) -> None:
    """Reuse table colors/borders from real tables in the reference section."""
    tbl_outer: Counter[str] = Counter()
    head: dict[str, Counter[str]] = {"left": Counter(), "mid": Counter(), "right": Counter()}
    body: dict[str, Counter[str]] = {"left": Counter(), "mid": Counter(), "right": Counter()}

    for tbl in root.findall(".//hp:tbl", namespaces=NS):
        if tbl.get("borderFillIDRef"):
            tbl_outer[tbl.get("borderFillIDRef")] += 1

        cells = []
        for tc in tbl.findall(".//hp:tc", namespaces=NS):
            addr = tc.find("hp:cellAddr", namespaces=NS)
            span = tc.find("hp:cellSpan", namespaces=NS)
            border = tc.get("borderFillIDRef")
            if addr is None or border is None:
                continue
            col = int(addr.get("colAddr", "0"))
            row = int(addr.get("rowAddr", "0"))
            col_span = int(span.get("colSpan", "1")) if span is not None else 1
            cells.append((row, col, col + col_span - 1, border))

        if not cells:
            continue

        max_col = max(end for _, _, end, _ in cells)
        for row, col, end, border in cells:
            if max_col <= 0:
                bucket = "mid"
            elif col == 0:
                bucket = "left"
            elif end >= max_col:
                bucket = "right"
            else:
                bucket = "mid"

            target = head if row == 0 else body
            target[bucket][border] += 1

    def most(counter: Counter[str], fallback: str) -> str:
        return counter.most_common(1)[0][0] if counter else fallback

    if tbl_outer:
        profile.table_outer_border = most(tbl_outer, profile.table_outer_border)

    if any(head.values()):
        profile.table_head_left_border = most(head["left"], profile.table_head_left_border)
        profile.table_head_mid_border = most(head["mid"], profile.table_head_left_border)
        profile.table_head_right_border = most(head["right"], profile.table_head_mid_border)

    if any(body.values()):
        profile.table_body_left_border = most(body["left"], profile.table_body_left_border)
        profile.table_body_mid_border = most(body["mid"], profile.table_body_left_border)
        profile.table_body_right_border = most(body["right"], profile.table_body_mid_border)


def load_profile(reference_hwpx: Path) -> StyleProfile:
    with zipfile.ZipFile(reference_hwpx) as zf:
        header_xml = zf.read("Contents/header.xml")
        section_xml = zf.read("Contents/section0.xml")

    root = etree.fromstring(section_xml)
    nsmap = {k: v for k, v in root.nsmap.items() if k}
    nsmap.update({k: v for k, v in NS.items() if k not in nsmap})

    first_para = root.find(".//hp:p", namespaces=NS)
    if first_para is None:
        raise SystemExit("Reference section0.xml has no paragraph")
    sec_pr = first_para.find(".//hp:secPr", namespaces=NS)
    col_pr = first_para.find(".//hp:colPr", namespaces=NS)
    if sec_pr is None or col_pr is None:
        raise SystemExit("Reference first paragraph must contain secPr and colPr")

    page_pr = sec_pr.find(".//hp:pagePr", namespaces=NS)
    body_width = 48190
    if page_pr is not None:
        margin = page_pr.find(".//hp:margin", namespaces=NS)
        if margin is not None:
            body_width = int(page_pr.get("width", "59528")) - int(margin.get("left", "5669")) - int(margin.get("right", "5669"))

    table_width = body_width
    table_widths: list[int] = []
    for tbl in root.findall(".//hp:tbl", namespaces=NS):
        sz = tbl.find("hp:sz", namespaces=NS)
        if sz is not None and sz.get("width"):
            table_widths.append(int(sz.get("width")))
    if table_widths:
        table_width = max(set(table_widths), key=table_widths.count)
    table_width = min(table_width, body_width)

    col_ctrl = etree.Element(q("hp", "ctrl"))
    col_ctrl.append(copy.deepcopy(col_pr))

    header_root = etree.fromstring(header_xml)

    def has_para(pid: str) -> bool:
        return header_root.find(f'.//hh:paraPr[@id="{pid}"]', namespaces=NS) is not None

    def has_char(cid: str) -> bool:
        return header_root.find(f'.//hh:charPr[@id="{cid}"]', namespaces=NS) is not None

    def is_bullet_para(pid: str) -> bool:
        para = header_root.find(f'.//hh:paraPr[@id="{pid}"]', namespaces=NS)
        if para is None:
            return False
        heading = para.find("hh:heading", namespaces=NS)
        return heading is not None and heading.get("type", "NONE") != "NONE"

    def style_by_name(name: str) -> etree._Element | None:
        style = header_root.find(f'.//hh:style[@name="{name}"]', namespaces=NS)
        if style is not None:
            return style
        wanted = re.sub(r"\s+", "", name)
        for candidate in header_root.findall(".//hh:style", namespaces=NS):
            candidate_name = candidate.get("name", "")
            if re.sub(r"\s+", "", candidate_name) == wanted:
                return candidate
        return None

    profile = StyleProfile(
        nsmap=nsmap,
        header_xml=header_xml,
        sec_pr=copy.deepcopy(sec_pr),
        col_ctrl=col_ctrl,
        body_width=body_width,
        table_width=table_width,
        first_para=first_para.get("paraPrIDRef", "71"),
        first_char=(first_para.find(".//hp:run", namespaces=NS).get("charPrIDRef", "46") if first_para.find(".//hp:run", namespaces=NS) is not None else "46"),
    )
    if has_para("24") and has_para("23") and has_para("33") and has_char("20"):
        profile.h2_para = "24"
        profile.h2_char = "20"
        profile.h3_para = "24"
        profile.h3_char = "14" if has_char("14") else "12"
        profile.body_para = "23"
        profile.body_char = "13" if has_char("13") else "12"
        profile.neutral_para = "24"
        profile.neutral_char = "13" if has_char("13") else profile.body_char
        profile.square_para = "33"
        profile.square_char = "28" if has_char("28") else profile.body_char
        profile.code_para = profile.neutral_para
        profile.code_char = "16" if has_char("16") else profile.body_char
        profile.table_outer_border = "5"
        profile.table_head_left_border = "6"
        profile.table_head_mid_border = "7"
        profile.table_head_right_border = "8"
        profile.table_body_left_border = "9"
        profile.table_body_mid_border = "10"
        profile.table_body_right_border = "11"
        profile.table_head_para = "31" if has_para("31") else profile.h3_para
        profile.table_head_char = "26" if has_char("26") else profile.h3_char
        profile.table_body_para = "32" if has_para("32") else profile.body_para
        profile.table_body_char = "25" if has_char("25") else profile.body_char

    table_caption_style = style_by_name("표 캡션")
    if table_caption_style is not None:
        profile.table_caption_style = table_caption_style.get("id", profile.table_caption_style)
        profile.table_caption_para = table_caption_style.get("paraPrIDRef", profile.table_caption_para)
        profile.table_caption_char = table_caption_style.get("charPrIDRef", profile.table_caption_char)

    table_content_style = style_by_name("표 내용")
    if table_content_style is not None:
        profile.table_head_style = table_content_style.get("id", profile.table_head_style)
        profile.table_head_para = table_content_style.get("paraPrIDRef", profile.table_head_para)
        profile.table_head_char = table_content_style.get("charPrIDRef", profile.table_head_char)
        profile.table_body_style = table_content_style.get("id", profile.table_body_style)
        profile.table_body_para = table_content_style.get("paraPrIDRef", profile.table_body_para)
        profile.table_body_char = table_content_style.get("charPrIDRef", profile.table_body_char)

    numbered_style_map = [
        ("2.", "h2"),
        ("2.1", "h3"),
        ("2.1.1", "h4"),
        ("내용 위계 1", "body"),
        ("내용 위계 2", "square"),
        ("(1)", "number"),
        ("Code", "code"),
    ]
    for style_name, role in numbered_style_map:
        style = style_by_name(style_name)
        if style is None:
            continue
        setattr(profile, f"{role}_style", style.get("id", getattr(profile, f"{role}_style")))
        setattr(profile, f"{role}_para", style.get("paraPrIDRef", getattr(profile, f"{role}_para")))
        setattr(profile, f"{role}_char", style.get("charPrIDRef", getattr(profile, f"{role}_char")))

    if profile.body_style != "0" and not is_bullet_para(profile.body_para):
        profile.neutral_style = profile.body_style
        profile.neutral_para = profile.body_para
        profile.neutral_char = profile.body_char

    if is_bullet_para(profile.neutral_para):
        for candidate in (profile.first_para, "24", "59", "0"):
            if has_para(candidate) and not is_bullet_para(candidate):
                profile.neutral_style = "0"
                profile.neutral_para = candidate
                break

    figure_caption_style = style_by_name("그림 캡션")
    if figure_caption_style is not None:
        profile.figure_caption_style = figure_caption_style.get("id", profile.figure_caption_style)
        profile.figure_caption_para = figure_caption_style.get("paraPrIDRef", profile.figure_caption_para)
        profile.figure_caption_char = figure_caption_style.get("charPrIDRef", profile.figure_caption_char)

    if profile.square_style == "0":
        square_fallback_style = style_by_name("■")
        if square_fallback_style is not None:
            profile.square_style = square_fallback_style.get("id", profile.square_style)
            profile.square_para = square_fallback_style.get("paraPrIDRef", profile.square_para)
            profile.square_char = square_fallback_style.get("charPrIDRef", profile.square_char)

    infer_reference_table_borders(root, profile)

    return profile


def make_p(pid: str, para: str, style: str = "0", page_break: str = "0") -> etree._Element:
    return etree.Element(
        q("hp", "p"),
        id=pid,
        paraPrIDRef=para,
        styleIDRef=style,
        pageBreak=page_break,
        columnBreak="0",
        merged="0",
    )


def make_text_run(text: str, char: str, preserve: bool = False) -> etree._Element:
    run = etree.Element(q("hp", "run"), charPrIDRef=char)
    t = etree.SubElement(run, q("hp", "t"))
    if text:
        t.text = text
    if preserve or text.startswith(" ") or text.endswith(" "):
        t.set(XML_SPACE, "preserve")
    return run


def append_inline_runs(p: etree._Element, text: str, base_char: str, profile: StyleProfile) -> None:
    plain = strip_inline_markdown(text).replace("\\*", "*").replace("\\_", "_")
    p.append(make_text_run(plain, base_char))


def add_paragraph(
    root: etree._Element,
    ids: IdFactory,
    text: str,
    para: str,
    char: str,
    profile: StyleProfile | None = None,
    style: str = "0",
    preserve: bool = False,
) -> None:
    p = make_p(ids.next(), para, style=style)
    if profile is not None and not preserve:
        append_inline_runs(p, text, char, profile)
    else:
        p.append(make_text_run(strip_inline_markdown(text) if not preserve else text, char, preserve=preserve))
    root.append(p)


def add_blank(root: etree._Element, ids: IdFactory, profile: StyleProfile) -> None:
    add_paragraph(root, ids, "", profile.neutral_para, profile.neutral_char, profile)


def paragraph_style_for_text(text: str, default_para: str, default_char: str, default_style: str, profile: StyleProfile) -> tuple[str, str, str]:
    plain = strip_inline_markdown(text).strip()
    if plain.startswith("[표 ") and profile.table_caption_style != "0":
        return profile.table_caption_para, profile.table_caption_char, profile.table_caption_style
    if plain.startswith("[그림 ") and profile.figure_caption_style != "0":
        return profile.figure_caption_para, profile.figure_caption_char, profile.figure_caption_style
    return default_para, default_char, default_style


def estimate_col_widths(rows: list[list[str]], total_width: int) -> list[int]:
    cols = max(len(row) for row in rows)
    weights: list[int] = []
    for c in range(cols):
        values = [text_width(strip_inline_markdown(row[c])) for row in rows if c < len(row)]
        weights.append(max(5, min(max(values or [5]), 42)))

    preferred_min_width = 2600 if cols >= 7 else 3600
    min_width = min(preferred_min_width, max(1, total_width // cols))
    available = total_width
    raw_sum = sum(weights) or cols
    widths = [max(min_width, int(available * w / raw_sum)) for w in weights]

    if sum(widths) > total_width:
        scale = total_width / sum(widths)
        scaled_min = min(min_width, max(1, total_width // cols))
        widths = [max(scaled_min, int(w * scale)) for w in widths]
    while sum(widths) > total_width:
        i = max(range(len(widths)), key=lambda idx: widths[idx])
        if widths[i] <= 1:
            break
        widths[i] -= 1
    widths[-1] += total_width - sum(widths)
    return widths


def estimate_row_heights(rows: list[list[str]], widths: list[int], header: bool = True) -> list[int]:
    heights: list[int] = []
    for r, row in enumerate(rows):
        max_lines = 1
        for c, cell in enumerate(row):
            col_width = widths[min(c, len(widths) - 1)]
            chars_per_line = max(5, int(col_width / 430))
            logical_lines = strip_inline_markdown(str(cell)).splitlines() or [""]
            needed = sum(max(1, math.ceil(text_width(line) / chars_per_line)) for line in logical_lines)
            max_lines = max(max_lines, needed)
        base = 1600 if r == 0 and header else 1450
        heights.append(min(9500, base + (max_lines - 1) * 720))
    return heights


def border_for(profile: StyleProfile, col: int, cols: int, header: bool) -> str:
    if header:
        if cols == 1:
            return profile.table_head_mid_border
        return profile.table_head_left_border if col == 0 else profile.table_head_right_border if col == cols - 1 else profile.table_head_mid_border
    if cols == 1:
        return profile.table_body_mid_border
    return profile.table_body_left_border if col == 0 else profile.table_body_right_border if col == cols - 1 else profile.table_body_mid_border


def add_cell_text(sublist: etree._Element, ids: IdFactory, text: str, para: str, char: str, profile: StyleProfile, style: str = "0") -> None:
    parts = str(text).replace("<br>", "\n").splitlines() or [""]
    for part in parts:
        p = make_p(ids.next(), para, style=style)
        append_inline_runs(p, part, char, profile)
        sublist.append(p)


def numbered_heading_depth(text: str) -> int | None:
    plain = strip_inline_markdown(text)
    match = re.match(r"^\s*(\d+(?:\.\d+)*)(?:[.)]|\s)", plain)
    if not match:
        return None
    return match.group(1).count(".") + 1


def sentence_like_heading(text: str) -> bool:
    plain = strip_inline_markdown(text).strip()
    if re.match(r"^\s*(?:\d+(?:\.\d+)*|부록-\d+|[IVX]+[.)-]|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ])", plain):
        return False
    return bool(re.search(r"(?:함|임|됨|음|있음|없음|했음|한다|이다|된다|다)\.?$", plain))


def add_heading(root: etree._Element, ids: IdFactory, level: int, text: str, profile: StyleProfile) -> None:
    plain = strip_inline_markdown(text)
    numbered = re.match(r"^\s*\((\d+)\)\s+(.+)$", plain)
    if numbered:
        add_paragraph(root, ids, f"({numbered.group(1)}) {numbered.group(2)}", profile.number_para, profile.number_char, profile, style=profile.number_style)
        return
    if level >= 3:
        ordered = re.match(r"^\s*(\d+)[.)]\s+(.+)$", plain)
        if ordered:
            add_paragraph(root, ids, f"({ordered.group(1)}) {ordered.group(2)}", profile.number_para, profile.number_char, profile, style=profile.number_style)
            return
    if sentence_like_heading(plain):
        add_paragraph(root, ids, plain, profile.body_para, profile.body_char, profile, style=profile.body_style)
        return

    depth = numbered_heading_depth(text)
    if depth == 1:
        add_paragraph(root, ids, text, profile.h2_para, profile.h2_char, profile, style=profile.h2_style)
    elif depth == 2:
        add_paragraph(root, ids, text, profile.h3_para, profile.h3_char, profile, style=profile.h3_style)
    elif depth is not None and depth >= 3:
        add_paragraph(root, ids, text, profile.h4_para, profile.h4_char, profile, style=profile.h4_style)
    elif level <= 2:
        add_paragraph(root, ids, text, profile.h2_para, profile.h2_char, profile, style=profile.h2_style)
    elif level == 3:
        add_paragraph(root, ids, text, profile.h3_para, profile.h3_char, profile, style=profile.h3_style)
    else:
        add_paragraph(root, ids, text, profile.h4_para, profile.h4_char, profile, style=profile.h4_style)


def add_table(root: etree._Element, ids: IdFactory, rows: list[list[str]], profile: StyleProfile) -> None:
    rows = normalize_table(rows)
    if not rows:
        return
    row_count = len(rows)
    col_count = max(len(row) for row in rows)
    widths = estimate_col_widths(rows, profile.table_width)
    heights = estimate_row_heights(rows, widths)
    table_height = sum(heights)

    p = make_p(ids.next(), profile.neutral_para)
    run = etree.SubElement(p, q("hp", "run"), charPrIDRef=profile.neutral_char)
    tbl = etree.SubElement(
        run,
        q("hp", "tbl"),
        id=ids.next(),
        zOrder="0",
        numberingType="TABLE",
        textWrap="TOP_AND_BOTTOM",
        textFlow="BOTH_SIDES",
        lock="0",
        dropcapstyle="None",
        pageBreak="CELL",
        repeatHeader="1",
        rowCnt=str(row_count),
        colCnt=str(col_count),
        cellSpacing="0",
        borderFillIDRef=profile.table_outer_border,
        noAdjust="0",
    )
    etree.SubElement(tbl, q("hp", "sz"), width=str(profile.table_width), widthRelTo="ABSOLUTE", height=str(table_height), heightRelTo="ABSOLUTE", protect="0")
    etree.SubElement(
        tbl,
        q("hp", "pos"),
        treatAsChar="1",
        affectLSpacing="0",
        flowWithText="1",
        allowOverlap="0",
        holdAnchorAndSO="0",
        vertRelTo="PARA",
        horzRelTo="COLUMN",
        vertAlign="TOP",
        horzAlign="LEFT",
        vertOffset="0",
        horzOffset="0",
    )
    etree.SubElement(tbl, q("hp", "outMargin"), left="0", right="0", top="0", bottom="0")
    etree.SubElement(tbl, q("hp", "inMargin"), left="0", right="0", top="0", bottom="0")

    for r, row in enumerate(rows):
        tr = etree.SubElement(tbl, q("hp", "tr"))
        for c in range(col_count):
            header = r == 0
            tc = etree.SubElement(
                tr,
                q("hp", "tc"),
                name="",
                header="0",
                hasMargin="0",
                protect="0",
                editable="0",
                dirty="1",
                borderFillIDRef=border_for(profile, c, col_count, header),
            )
            sublist = etree.SubElement(
                tc,
                q("hp", "subList"),
                id="",
                textDirection="HORIZONTAL",
                lineWrap="BREAK",
                vertAlign="CENTER",
                linkListIDRef="0",
                linkListNextIDRef="0",
                textWidth="0",
                textHeight="0",
                hasTextRef="0",
                hasNumRef="0",
            )
            add_cell_text(
                sublist,
                ids,
                row[c] if c < len(row) else "",
                profile.table_head_para if header else profile.table_body_para,
                profile.table_head_char if header else profile.table_body_char,
                profile,
                profile.table_head_style if header else profile.table_body_style,
            )
            etree.SubElement(tc, q("hp", "cellAddr"), colAddr=str(c), rowAddr=str(r))
            etree.SubElement(tc, q("hp", "cellSpan"), colSpan="1", rowSpan="1")
            etree.SubElement(tc, q("hp", "cellSz"), width=str(widths[c]), height=str(heights[r]))
            etree.SubElement(tc, q("hp", "cellMargin"), left="180", right="180", top="120", bottom="120")

    root.append(p)


def build_section(blocks: list[dict], profile: StyleProfile) -> bytes:
    ids = IdFactory()
    root = etree.Element(q("hs", "sec"), nsmap=profile.nsmap)

    first = make_p(ids.next(), profile.first_para)
    run = etree.SubElement(first, q("hp", "run"), charPrIDRef=profile.first_char)
    run.append(copy.deepcopy(profile.sec_pr))
    run.append(copy.deepcopy(profile.col_ctrl))
    first.append(make_text_run("", profile.first_char))
    root.append(first)

    for idx, block in enumerate(blocks):
        kind = block["type"]
        if kind == "heading":
            level = int(block.get("level", 2))
            add_heading(root, ids, level, block["text"], profile)
        elif kind == "paragraph":
            text = block.get("text", "")
            if text:
                para, char, style = paragraph_style_for_text(text, profile.body_para, profile.body_char, profile.body_style, profile)
                add_paragraph(root, ids, text, para, char, profile, style=style)
        elif kind == "list_item":
            text = block.get("text", "")
            if text:
                add_paragraph(root, ids, text, profile.square_para, profile.square_char, profile, style=profile.square_style)
        elif kind == "numbered_item":
            text = block.get("text", "")
            if text:
                add_paragraph(root, ids, text, profile.number_para, profile.number_char, profile, style=profile.number_style)
        elif kind == "table":
            add_table(root, ids, block["rows"], profile)
            add_blank(root, ids, profile)
        elif kind == "code":
            for line in block.get("lines", []):
                add_paragraph(root, ids, line, profile.code_para, profile.code_char, style=profile.code_style, preserve=True)
            add_blank(root, ids, profile)
        elif kind == "blank":
            add_blank(root, ids, profile)

    return etree.tostring(root, encoding="UTF-8", xml_declaration=True, pretty_print=True)


def update_content_hpf(data: bytes, title: str | None) -> bytes:
    if not title:
        return data
    try:
        root = etree.fromstring(data)
    except etree.XMLSyntaxError:
        return data
    for el in root.iter():
        if localname(el).lower() == "title":
            el.text = title
            break
    return etree.tostring(root, encoding="UTF-8", xml_declaration=True, pretty_print=True)


def plain_text(blocks: Iterable[dict]) -> str:
    lines: list[str] = []
    for block in blocks:
        kind = block["type"]
        if kind == "heading":
            lines.append(strip_inline_markdown(block["text"]))
        elif kind == "paragraph":
            lines.append(strip_inline_markdown(block["text"]))
        elif kind == "list_item":
            lines.append(strip_inline_markdown(block["text"]))
        elif kind == "numbered_item":
            lines.append(strip_inline_markdown(block["text"]))
        elif kind == "table":
            for row in block["rows"]:
                lines.append("\t".join(strip_inline_markdown(cell) for cell in row))
        elif kind == "code":
            lines.extend(block.get("lines", []))
    return "\n".join(lines)


def write_hwpx(reference_hwpx: Path, output: Path, section_xml: bytes, header_xml: bytes, blocks: list[dict], title: str | None) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(reference_hwpx, "r") as zin:
        names = zin.namelist()
        replacements = {
            "Contents/header.xml": header_xml,
            "Contents/section0.xml": section_xml,
            "Preview/PrvText.txt": plain_text(blocks).encode("utf-8"),
        }
        # References often contain the client's original document. Copying all
        # unreplaced entries also carries its first-page thumbnail into output,
        # exposing original visual content at handoff. Reuse only the format,
        # replacing the preview with a neutral image.
        neutral_preview = (Path(__file__).resolve().parent.parent
                           / "templates" / "base" / "Preview" / "PrvImage.png")
        if "Preview/PrvImage.png" in names and neutral_preview.exists():
            replacements["Preview/PrvImage.png"] = neutral_preview.read_bytes()
        if "Contents/content.hpf" in names:
            replacements["Contents/content.hpf"] = update_content_hpf(zin.read("Contents/content.hpf"), title)

        with tempfile.NamedTemporaryFile(delete=False, suffix=".hwpx") as tmp:
            tmp_path = Path(tmp.name)

        try:
            with zipfile.ZipFile(tmp_path, "w") as zout:
                if "mimetype" in names:
                    zout.writestr("mimetype", zin.read("mimetype"), compress_type=zipfile.ZIP_STORED)
                for name in names:
                    if name == "mimetype":
                        continue
                    data = replacements.get(name, zin.read(name))
                    zout.writestr(name, data, compress_type=zipfile.ZIP_DEFLATED)
            tmp_path.replace(output)
        finally:
            if tmp_path.exists():
                try:
                    tmp_path.unlink()
                except OSError:
                    pass


def validate_output(output: Path, semantic: bool = False) -> None:
    validator_path = Path(__file__).resolve().with_name("validate_hwpx.py")
    if not validator_path.is_file():
        raise SystemExit(f"Local validator not found: {validator_path}")
    spec = importlib.util.spec_from_file_location("proposal_hwpx_validate", validator_path)
    if spec is None or spec.loader is None:
        raise SystemExit(f"Unable to load validator: {validator_path}")
    validator = importlib.util.module_from_spec(spec)
    sys.modules["proposal_hwpx_validate"] = validator
    spec.loader.exec_module(validator)
    errors = validator.validate(str(output))
    if semantic and hasattr(validator, "validate_semantic"):
        errors.extend(validator.validate_semantic(str(output)))
    if errors:
        for error in errors:
            print(f"VALIDATION ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
    print(f"VALID: {output}")
    print("  All structural checks passed.")
    if semantic:
        print("  Semantic proposal checks passed.")


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description="Convert Markdown proposal text to HWPX with real tables")
    parser.add_argument("input", type=Path, help="Input Markdown file")
    parser.add_argument("output", type=Path, help="Output HWPX file")
    parser.add_argument("--reference", type=Path, required=True, help="Reference .hwp or .hwpx file")
    parser.add_argument("--title", help="Document title metadata")
    parser.add_argument("--roman-to-arabic", action="store_true", help="Convert visible Roman numerals such as Ⅲ-1 to 3.1")
    parser.add_argument("--preserve-heading-numbers", action="store_true", help="Keep Markdown heading numbering instead of rewriting h3+ headings to (1), (2)")
    parser.add_argument("--reference-cache-dir", type=Path, help="Directory for converted .hwp reference cache files")
    parser.add_argument("--validate", action="store_true", help="Run the bundled HWPX structural validator after writing")
    parser.add_argument("--semantic-validate", action="store_true", help="Also validate style/paragraph/char/border references")
    args = parser.parse_args()

    if not args.input.is_file():
        raise SystemExit(f"Input not found: {args.input}")

    reference_hwpx = resolve_reference(args.reference, cache_dir=args.reference_cache_dir)
    profile = load_profile(reference_hwpx)
    markdown = args.input.read_text(encoding="utf-8-sig")
    if args.roman_to_arabic:
        markdown = apply_roman_to_arabic_outside_code(markdown)
    blocks = parse_markdown(markdown, number_subheadings=not args.preserve_heading_numbers)
    section_xml = build_section(blocks, profile)
    write_hwpx(reference_hwpx, args.output, section_xml, profile.header_xml, blocks, args.title)
    if args.validate or args.semantic_validate:
        validate_output(args.output, semantic=args.semantic_validate)

    table_count = sum(1 for block in blocks if block["type"] == "table")
    paragraph_count = sum(1 for block in blocks if block["type"] in {"paragraph", "heading", "list_item", "numbered_item"})
    print(f"Created: {args.output}")
    print(f"Reference: {reference_hwpx}")
    print(f"Blocks: {len(blocks)} total, {paragraph_count} text/heading, {table_count} tables")


if __name__ == "__main__":
    main()
