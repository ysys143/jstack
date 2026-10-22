#!/usr/bin/env python3
"""Reusable XML helpers for reference-driven HWPX redrafting."""

from __future__ import annotations

import re
from collections.abc import Iterable
from pathlib import Path

from lxml import etree


NS = {
    "hp": "http://www.hancom.co.kr/hwpml/2011/paragraph",
}

HP_P = f"{{{NS['hp']}}}p"
PREFIX_TOKEN = r"(?:\*+|-|[○□◦▪•·▶➊➋➌➍➎]|\(?\d+[.)]|[A-Za-z][.)]|[가-힣][.)])"
PREFIX_ONLY_RE = re.compile(rf"^\s*{PREFIX_TOKEN}\s*$")
PREFIX_WITH_TEXT_RE = re.compile(rf"^(\s*{PREFIX_TOKEN}\s+)(.*)$", re.S)


def parse_xml(path: Path) -> etree._ElementTree:
    return etree.parse(str(path))


def direct_text_nodes(paragraph: etree._Element) -> list[etree._Element]:
    nodes: list[etree._Element] = []
    for node in paragraph.findall(".//hp:t", NS):
        parent = node.getparent()
        while parent is not None and parent.tag != HP_P:
            parent = parent.getparent()
        if parent == paragraph:
            nodes.append(node)
    return nodes


def direct_text(paragraph: etree._Element) -> str:
    return "".join((node.text or "") for node in direct_text_nodes(paragraph))


def is_container_paragraph(paragraph: etree._Element) -> bool:
    return (
        paragraph.find(".//hp:tbl", NS) is not None
        or paragraph.find(".//hp:p", NS) is not None
    )


def iter_redraftable_paragraphs(root: etree._Element) -> list[etree._Element]:
    paragraphs: list[etree._Element] = []
    for paragraph in root.findall(".//hp:p", NS):
        if is_container_paragraph(paragraph):
            continue
        if direct_text(paragraph).strip():
            paragraphs.append(paragraph)
    return paragraphs


def set_paragraph_text_preserving_prefix(paragraph: etree._Element, text: str) -> None:
    nodes = direct_text_nodes(paragraph)
    if not nodes:
        return

    first_text = nodes[0].text or ""
    original_prefix_match = PREFIX_WITH_TEXT_RE.match(first_text)
    incoming_prefix_match = PREFIX_WITH_TEXT_RE.match(text)

    if len(nodes) > 1 and original_prefix_match:
        nodes[0].text = original_prefix_match.group(1)
        nodes[1].text = incoming_prefix_match.group(2) if incoming_prefix_match else text
        for node in nodes[2:]:
            node.text = ""
        return

    if len(nodes) > 1 and PREFIX_ONLY_RE.match(first_text):
        nodes[0].text = first_text
        nodes[1].text = incoming_prefix_match.group(2) if incoming_prefix_match else text
        for node in nodes[2:]:
            node.text = ""
        return

    nodes[0].text = text
    for node in nodes[1:]:
        node.text = ""


def owning_paragraph(node: etree._Element) -> etree._Element | None:
    """Nearest hp:p containing node; table-cell paragraphs have their own owner."""
    cur = node.getparent()
    while cur is not None and cur.tag != HP_P:
        cur = cur.getparent()
    return cur


def clear_linesegarrays(
    root: etree._Element, only: "Iterable[etree._Element] | None" = None
) -> int:
    """Remove stale line-layout caches.

    With only, remove caches only from those paragraphs. None defaults to
    removing all, preserving existing caller behavior.

    Two granularities are needed because clearing all caches destroys the
    linesegarray-count diagnostic. Raw files opening blank without warnings
    are identified by PrvText.txt containing two or three characters together
    with zero linesegarray entries (references/troubleshooting.md). If cleanup
    always removes all caches, that zero no longer distinguishes defects from
    our own edits. Modified-only cleanup retains the signal in untouched paragraphs."""
    targets = None if only is None else set(only)
    removed = 0
    for lineseg in root.findall(".//hp:linesegarray", NS):
        parent = lineseg.getparent()
        if parent is None:
            continue
        if targets is not None and owning_paragraph(lineseg) not in targets:
            continue
        parent.remove(lineseg)
        removed += 1
    return removed


def rewrite_redraftable_paragraphs(
    section_path: Path,
    replacements: dict[int, str],
    *,
    expected_count: int | None = None,
    linesegarray_scope: str = "all",
) -> int:
    tree = parse_xml(section_path)
    root = tree.getroot()
    paragraphs = iter_redraftable_paragraphs(root)

    if expected_count is not None and len(paragraphs) != expected_count:
        raise RuntimeError(
            f"Expected {expected_count} redraftable paragraphs, found {len(paragraphs)}"
        )

    if linesegarray_scope not in ("all", "modified"):
        raise ValueError(
            f"linesegarray_scope must be 'all' or 'modified', got {linesegarray_scope!r}"
        )

    touched: list[etree._Element] = []
    for idx, paragraph in enumerate(paragraphs):
        if idx in replacements:
            set_paragraph_text_preserving_prefix(paragraph, replacements[idx])
            touched.append(paragraph)

    # Default to removing all caches, preserving existing caller contracts.
    clear_linesegarrays(root, None if linesegarray_scope == "all" else touched)
    tree.write(
        str(section_path),
        encoding="UTF-8",
        xml_declaration=True,
        pretty_print=True,
    )
    return len(paragraphs)
