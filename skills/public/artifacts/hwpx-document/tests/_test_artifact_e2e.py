#!/usr/bin/env python3
"""Small end-to-end validation of a real HWPX artifact.

This test does not read contract prose. It builds a reference package, converts
fixed Markdown, then reads the package envelope, body, tables, and ID references
with a stdlib ZIP/XML parser independent of the project validator.

Run:
    python3 tests/_test_artifact_e2e.py

The leading underscore is intentional. ``scripts/run_suites.sh`` automatically
runs ``tests/*.py`` files without a leading underscore as contract suites, while
this artifact smoke test is run directly because it may acquire a network package.

It acquires ``lxml`` only in an isolated ``uv`` run and never installs it in the
user environment. Artifacts and logs are retained, and their reproduction path
is printed.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
from copy import deepcopy
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZIP_STORED, ZipFile
from xml.etree import ElementTree as ET


HERE = Path(__file__).resolve().parent
SKILL = HERE.parent
REPO = SKILL.parents[3]
NS_HH = "http://www.hancom.co.kr/hwpml/2011/head"
NS_HP = "http://www.hancom.co.kr/hwpml/2011/paragraph"
NS_OPF = "http://www.idpf.org/2007/opf/"


def run(cmd: list[str], evidence: Path, name: str, *, env: dict[str, str]) -> None:
    log = evidence / f"{name}.log"
    with log.open("w", encoding="utf-8") as stream:
        result = subprocess.run(cmd, cwd=evidence, env=env, text=True, stdout=stream, stderr=subprocess.STDOUT)
    if result.returncode:
        raise AssertionError(f"{name} failed (exit {result.returncode}); see {log}")


def run_expected_failure(cmd: list[str], evidence: Path, name: str, *, env: dict[str, str]) -> None:
    log = evidence / f"{name}.log"
    with log.open("w", encoding="utf-8") as stream:
        result = subprocess.run(cmd, cwd=evidence, env=env, text=True, stdout=stream, stderr=subprocess.STDOUT)
    if result.returncode == 0:
        raise AssertionError(f"{name} unexpectedly passed; see {log}")


def make_style_reference(raw: Path, output: Path) -> None:
    """Make a deterministic reference with the IDs used by the converter.

    The shipped report overlay is a structural fallback fixture.  Its section
    uses a small ID set, while the converter's normal profile branch expects
    the richer set found in a real reference document.  Adding copies here
    keeps this E2E test about conversion and leaves the product templates
    untouched.
    """

    with ZipFile(raw) as source:
        entries = {name: source.read(name) for name in source.namelist()}

    ET.register_namespace("hh", NS_HH)
    ET.register_namespace("hp", NS_HP)
    root = ET.fromstring(entries["Contents/header.xml"])
    para_parent = root.find(f".//{{{NS_HH}}}paraProperties")
    char_parent = root.find(f".//{{{NS_HH}}}charProperties")
    border_parent = root.find(f".//{{{NS_HH}}}borderFills")
    assert para_parent is not None and char_parent is not None and border_parent is not None

    for parent, local, ids in (
        (para_parent, "paraPr", ("23", "24", "33")),
        (char_parent, "charPr", ("20",)),
        (border_parent, "borderFill", ("7", "8", "9", "10", "11")),
    ):
        existing = {element.get("id") for element in parent}
        template = next(element for element in parent if element.tag.rsplit("}", 1)[-1] == local)
        for ident in ids:
            if ident not in existing:
                copy = deepcopy(template)
                copy.set("id", ident)
                parent.append(copy)
        parent.set("itemCnt", str(len(parent)))

    entries["Contents/header.xml"] = ET.tostring(root, encoding="utf-8", xml_declaration=True)
    with ZipFile(output, "w", ZIP_DEFLATED) as target:
        target.writestr("mimetype", entries.pop("mimetype"), compress_type=ZIP_STORED)
        for name in sorted(entries):
            target.writestr(name, entries[name], compress_type=ZIP_DEFLATED)


def independent_parse(path: Path) -> dict[str, object]:
    with ZipFile(path) as package:
        names = package.namelist()
        assert names[0] == "mimetype"
        assert package.getinfo("mimetype").compress_type == ZIP_STORED
        assert package.read("mimetype") == b"application/hwp+zip"
        header = ET.fromstring(package.read("Contents/header.xml"))
        section = ET.fromstring(package.read("Contents/section0.xml"))
        metadata = ET.fromstring(package.read("Contents/content.hpf"))

    para_ids = {e.get("id") for e in header.findall(f".//{{{NS_HH}}}paraPr")}
    char_ids = {e.get("id") for e in header.findall(f".//{{{NS_HH}}}charPr")}
    border_ids = {e.get("id") for e in header.findall(f".//{{{NS_HH}}}borderFill")}
    para_refs = {e.get("paraPrIDRef") for e in section.findall(f".//{{{NS_HP}}}p")}
    char_refs = {e.get("charPrIDRef") for e in section.findall(f".//{{{NS_HP}}}run")}
    border_refs = {e.get("borderFillIDRef") for e in section.iter() if e.get("borderFillIDRef")}
    assert para_refs <= para_ids, sorted(para_refs - para_ids)
    assert char_refs <= char_ids, sorted(char_refs - char_ids)
    assert border_refs <= border_ids, sorted(border_refs - border_ids)

    text = "".join(element.text or "" for element in section.iter(f"{{{NS_HP}}}t"))
    paragraphs = section.findall(f".//{{{NS_HP}}}p")
    tables = section.findall(f".//{{{NS_HP}}}tbl")
    title = metadata.find(f".//{{{NS_OPF}}}title")
    assert "고정 HWPX 스모크" in text
    assert "한글" in text and len(paragraphs) >= 3 and tables
    assert title is not None and title.text == "고정 HWPX 스모크"
    return {"paragraphs": len(paragraphs), "tables": len(tables), "text": text}


def main() -> int:
    uv = shutil.which("uv")
    if uv is None:
        print("[UNMEASURED] uv unavailable — cannot run with isolated lxml")
        return 2

    evidence_value = os.environ.get("JSTACK_ARTIFACT_EVIDENCE_DIR")
    evidence = Path(evidence_value) if evidence_value else Path(tempfile.mkdtemp(prefix="jstack-hwpx-e2e-"))
    evidence.mkdir(parents=True, exist_ok=True)
    cache = evidence / "uv-cache"
    env = os.environ.copy()
    env["UV_CACHE_DIR"] = str(cache)
    py = [uv, "run", "--isolated", "--no-project", "--quiet", "--with", "lxml", "python"]
    source = evidence / "input.md"
    source.write_text(
        "# 고정 HWPX 스모크\n\n본문 **한글**과 `코드`입니다.\n\n"
        "## 표·목록\n\n- 첫 항목\n- 둘째 항목\n\n"
        "| 이름 | 값 |\n| --- | --- |\n| 항목 A | 42 |\n",
        encoding="utf-8",
    )
    raw_reference = evidence / "reference-raw.hwpx"
    reference = evidence / "reference.hwpx"
    raw_output = evidence / "raw-reference-output.hwpx"
    output = evidence / "generated.hwpx"
    run(py + [str(SKILL / "scripts/build_hwpx.py"), "--template", "report", "--output", str(raw_reference)], evidence, "build-reference", env=env)
    run_expected_failure(
        py
        + [
            str(SKILL / "scripts/md_to_hwpx.py"),
            str(source),
            str(raw_output),
            "--reference",
            str(raw_reference),
            "--title",
            "고정 HWPX 스모크",
            "--validate",
            "--semantic-validate",
        ],
        evidence,
        "raw-reference-negative",
        env=env,
    )
    print("[PASS] raw fallback reference negative control — semantic rejection is preserved")
    make_style_reference(raw_reference, reference)
    run(
        py
        + [
            str(SKILL / "scripts/md_to_hwpx.py"),
            str(source),
            str(output),
            "--reference",
            str(reference),
            "--title",
            "고정 HWPX 스모크",
            "--validate",
            "--semantic-validate",
        ],
        evidence,
        "convert",
        env=env,
    )
    run(py + [str(SKILL / "scripts/validate_hwpx.py"), str(output), "--semantic"], evidence, "validate", env=env)
    parsed = independent_parse(output)
    print(f"[PASS] HWPX artifact E2E — {output}")
    print(f"[PASS] independent parser — paragraphs={parsed['paragraphs']} tables={parsed['tables']}")
    print(f"EVIDENCE_DIR={evidence}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
