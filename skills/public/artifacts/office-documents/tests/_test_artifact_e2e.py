#!/usr/bin/env python3
"""Create a real DOCX with OfficeCLI and inspect it with an independent OOXML parser.

The leading underscore intentionally excludes this file from contract-runner
autodiscovery so npx --yes cannot install over the network or affect global
user state. Run this file explicitly in a unique temporary location.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as ET


HERE = Path(__file__).resolve().parent
SKILL = HERE.parent
REPO = SKILL.parents[3]
W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


def command() -> list[str] | None:
    office = shutil.which("officecli")
    if office:
        return [office]
    npx = shutil.which("npx")
    return [npx, "--yes", "@officecli/officecli@latest"] if npx else None


def run(cli: list[str], args: list[str], evidence: Path, label: str, env: dict[str, str]) -> None:
    log = evidence / f"{label}.log"
    with log.open("w", encoding="utf-8") as stream:
        result = subprocess.run(cli + args, cwd=evidence, env=env, text=True, stdout=stream, stderr=subprocess.STDOUT)
    if result.returncode:
        raise AssertionError(f"{label} failed (exit {result.returncode}); see {log}")


def main() -> int:
    cli = command()
    if cli is None:
        print("[UNMEASURED] officecli/npx unavailable: cannot measure real OfficeCLI creation")
        return 2
    evidence_value = os.environ.get("JSTACK_ARTIFACT_EVIDENCE_DIR")
    evidence = Path(evidence_value) if evidence_value else Path(tempfile.mkdtemp(prefix="jstack-office-e2e-"))
    evidence.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    env["npm_config_cache"] = str(evidence / "npm-cache")
    docx = evidence / "generated.docx"
    run(cli, ["create", str(docx)], evidence, "create", env)
    run(
        cli,
        ["add", str(docx), "/body", "--type", "paragraph", "--prop", "text=한글 고정 입력", "--prop", "font.ea=Pretendard", "--prop", "font.latin=Arial"],
        evidence,
        "add",
        env,
    )
    run(cli, ["validate", str(docx)], evidence, "office-validate", env)
    run(cli, ["close", str(docx)], evidence, "close", env)
    run([sys.executable], [str(SKILL / "scripts/check_cjk_font.py"), str(docx), "--require-font", "Pretendard"], evidence, "font-check", env)

    with ZipFile(docx) as package:
        document = ET.fromstring(package.read("word/document.xml"))
    text = "".join(node.text or "" for node in document.iter(f"{{{W_NS}}}t"))
    east_asia = [node.get(f"{{{W_NS}}}eastAsia") for node in document.iter(f"{{{W_NS}}}rFonts")]
    assert text == "한글 고정 입력"
    assert "Pretendard" in east_asia
    print(f"[PASS] OfficeCLI DOCX artifact E2E — {docx}")
    print(f"[PASS] independent parser — text={text!r} eastAsia={east_asia}")
    print(f"EVIDENCE_DIR={evidence}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
