#!/usr/bin/env python3
"""Compare citations with sentences; verify every pair without sampling.

Upstream hyperresearch uses sample_rate=0.6, checking one pair in two because
round(1/0.6) = 2. One citation can disqualify a procurement proposal; an unknown
unchecked half prevents establishing reliability. Depending on upstream would
also leave users without it unable to verify anything, so we own this checker.

Only mechanically verifiable findings are produced:
MISSING: a cited source is absent from the source list.
UNUSED: a listed source is never cited in the body.
MALFORMED: citation structure is invalid.
UNRESOLVED: a source has no URL or identifier.

Whether the source actually supports the sentence requires human or LLM reading.
Export every pair needing that judgment through --pairs, without sampling.

Usage:
    python3 cite_check.py <report.md> [--pairs out.jsonl] [--format json]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

# Numbered citations such as [1] and [12].
CITE = re.compile(r"\[(\d{1,3})\]")
# Source entry: [1] Title - https://... or [1] Title (identifier).
SOURCE_LINE = re.compile(r"^\s*\[(\d{1,3})\]\s+(.+?)\s*$")
URLISH = re.compile(r"https?://\S+|doi:\S+|ISBN\s*[\d-]+|공고번호\s*\S+")

SOURCE_HEADS = ("## 출처", "## 참고문헌", "## References", "## 참고 자료")


def split_report(text: str) -> tuple[str, list[str]]:
    """Split body and sources; without a sources section, return (full_text, [])."""
    lines = text.splitlines()
    for i, line in enumerate(lines):
        if line.strip() in SOURCE_HEADS:
            return "\n".join(lines[:i]), lines[i + 1:]
    return text, []


def parse_sources(lines: list[str]) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in lines:
        m = SOURCE_LINE.match(line)
        if m:
            out[m.group(1)] = m.group(2)
    return out


def sentences(body: str) -> list[str]:
    """Split sentences using Korean endings and punctuation."""
    parts = re.split(r"(?<=[.!?])\s+|(?<=[다요]\.)\s+|\n\n+", body)
    return [p.strip() for p in parts if p.strip()]


def check(path: Path) -> tuple[list[dict], list[dict]]:
    """Return findings and all sentence/source pairs for human or LLM review."""
    text = path.read_text(encoding="utf-8")
    body, src_lines = split_report(text)
    sources = parse_sources(src_lines)

    findings: list[dict] = []
    if not src_lines:
        findings.append({"kind": "MALFORMED", "detail":
                         f"Sources section absent: require one of {' or '.join(SOURCE_HEADS)}"})

    used: set[str] = set()
    pairs: list[dict] = []
    for sent in sentences(body):
        for num in CITE.findall(sent):
            used.add(num)
            if num not in sources:
                findings.append({"kind": "MISSING", "cite": num,
                                 "detail": f"[{num}] is absent from the source list",
                                 "sentence": sent[:120]})
                continue
            # Export every pair without sampling.
            pairs.append({"cite": num, "source": sources[num], "sentence": sent})

    for num, desc in sorted(sources.items(), key=lambda kv: int(kv[0])):
        if num not in used:
            findings.append({"kind": "UNUSED", "cite": num,
                             "detail": f"[{num}] is never cited in the body", "source": desc})
        if not URLISH.search(desc):
            findings.append({"kind": "UNRESOLVED", "cite": num,
                             "detail": f"[{num}] lacks an identifier such as a URL, DOI, or notice ID",
                             "source": desc})
    return findings, pairs


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("report", type=Path)
    ap.add_argument("--pairs", type=Path,
                    help="Export every sentence/source pair as JSONL for human or LLM review")
    ap.add_argument("--format", choices=("text", "json"), default="text")
    a = ap.parse_args(argv)

    if not a.report.exists():
        print(f"[중단] File does not exist: {a.report}", file=sys.stderr)
        return 2

    findings, pairs = check(a.report)
    if a.pairs:
        a.pairs.write_text(
            "\n".join(json.dumps(p, ensure_ascii=False) for p in pairs) + "\n",
            encoding="utf-8")

    if a.format == "json":
        print(json.dumps({"findings": findings, "pairs": len(pairs),
                          "coverage": "100% (no sampling)"},
                         ensure_ascii=False, indent=2))
    else:
        for f in findings:
            print(f"[{f['kind']}] {f['detail']}")
        print(f"\nMachine findings: {len(findings)} / pairs requiring reading: {len(pairs)} "
              f"(all pairs; no sampling)")
        if pairs and not a.pairs:
            print("  Export with --pairs for human or LLM review")
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
