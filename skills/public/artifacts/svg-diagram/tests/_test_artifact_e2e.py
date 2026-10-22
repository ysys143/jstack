#!/usr/bin/env python3
"""Render a fixed SVG to a real PNG and cross-check diagram validators.

The leading underscore is intentional. It keeps this test out of the contract
runner's automatic discovery so the real renderer runs only in a unique temp path.
"""

from __future__ import annotations

import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile
from pathlib import Path
from xml.etree import ElementTree as ET


HERE = Path(__file__).resolve().parent
SKILL = HERE.parent
REPO = SKILL.parents[3]
SVG_NS = "http://www.w3.org/2000/svg"


def run(cmd: list[str], evidence: Path, label: str) -> None:
    log = evidence / f"{label}.log"
    with log.open("w", encoding="utf-8") as stream:
        result = subprocess.run(cmd, cwd=evidence, text=True, stdout=stream, stderr=subprocess.STDOUT)
    if result.returncode:
        raise AssertionError(f"{label} failed (exit {result.returncode}); see {log}")


def json_run(cmd: list[str], evidence: Path, label: str) -> dict:
    output = evidence / f"{label}.json"
    with output.open("w", encoding="utf-8") as stream:
        result = subprocess.run(cmd, cwd=evidence, text=True, stdout=stream, stderr=subprocess.STDOUT)
    if result.returncode:
        raise AssertionError(f"{label} failed (exit {result.returncode}); see {output}")
    return json.loads(output.read_text(encoding="utf-8"))


def main() -> int:
    if shutil.which("rsvg-convert") is None:
        print("[UNMEASURED] rsvg-convert missing — cannot measure the real SVG-to-PNG render path")
        return 2
    evidence_value = os.environ.get("JSTACK_ARTIFACT_EVIDENCE_DIR")
    evidence = Path(evidence_value) if evidence_value else Path(tempfile.mkdtemp(prefix="jstack-diagram-e2e-"))
    evidence.mkdir(parents=True, exist_ok=True)
    svg = evidence / "generated.svg"
    drawio = evidence / "generated.drawio"
    png = evidence / "generated.png"
    svg.write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300" viewBox="0 0 600 300" role="img" aria-labelledby="title">\n'
        '  <title id="title">한글 흐름도</title>\n'
        '  <defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 Z"/></marker></defs>\n'
        '  <rect x="0" y="0" width="600" height="300" fill="#fff"/>\n'
        '  <rect x="40" y="100" width="160" height="80" fill="#eef4ff" stroke="#234"/>\n'
        '  <rect x="400" y="100" width="160" height="80" fill="#eef4ff" stroke="#234"/>\n'
        '  <path d="M200,140 H400" fill="none" stroke="#234" stroke-width="3" marker-end="url(#arrow)"/>\n'
        '  <text x="120" y="135" text-anchor="middle" dominant-baseline="central" font-size="24">입력</text>\n'
        '  <text x="480" y="135" text-anchor="middle" dominant-baseline="central" font-size="24">결과</text>\n'
        '  <text x="300" y="115" text-anchor="middle" dominant-baseline="central" font-size="20">처리</text>\n'
        '</svg>\n',
        encoding="utf-8",
    )
    drawio.write_text('<mxfile><diagram name="한글"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" value="한글 입력"/></root></mxGraphModel></diagram></mxfile>', encoding="utf-8")
    scripts = SKILL / "scripts"
    run([sys.executable, str(scripts / "verify-geometry.py"), str(svg)], evidence, "geometry")
    connectors = json_run([sys.executable, str(scripts / "verify-connectors.py"), str(svg), "--json"], evidence, "connectors")
    widths = json_run([sys.executable, str(scripts / "verify-text-width.py"), str(svg), "--json"], evidence, "text-width")
    size = json_run([sys.executable, str(scripts / "check_effective_size.py"), str(svg), "--media", "print-a4", "--json"], evidence, "effective-size")
    scale = json_run([sys.executable, str(scripts / "export_scale.py"), "--viewbox-width", "600", "--paper", "a3", "--json"], evidence, "export-scale")
    encoded = json_run([sys.executable, str(scripts / "encode_drawio_url.py"), str(drawio), "--json"], evidence, "encode-drawio")
    run(["rsvg-convert", str(svg), "-o", str(png)], evidence, "render-png")
    repaired = json_run([sys.executable, str(scripts / "repair_png.py"), str(png), "--check", "--json"], evidence, "png-check")
    assert connectors["ok"] and connectors["summary"]["connectors"] == 1
    assert widths["ok"] and widths["summary"]["texts"] == 3 and widths["summary"]["labels"] >= 2
    per_file_size = size["summary"]["perFile"][svg.name]
    assert size["ok"] and per_file_size["below"] == 0
    assert scale["ok"] and scale["summary"]["verdict"] == "unlocked"
    assert encoded["ok"] and encoded["summary"]["roundTrip"]
    assert repaired["ok"] and repaired["summary"]["hasIend"] and repaired["summary"]["trailingBytes"] == 0

    root = ET.fromstring(svg.read_bytes())
    texts = ["".join(node.itertext()) for node in root.findall(f".//{{{SVG_NS}}}text")]
    assert {"입력", "처리", "결과"} <= set(texts)
    png_header = png.read_bytes()[:24]
    assert png_header[:8] == b"\x89PNG\r\n\x1a\n"
    assert struct.unpack(">II", png_header[16:24]) == (600, 300)
    print(f"[PASS] diagram SVG-to-PNG artifact E2E — {svg} / {png}")
    print(f"[PASS] independent parser — texts={texts} png=600x300")
    print(f"EVIDENCE_DIR={evidence}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
