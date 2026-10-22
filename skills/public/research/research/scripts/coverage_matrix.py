#!/usr/bin/env python3
"""Map requirements to responses and count missing items mechanically.

The most valuable procurement check is whether the response covers every RFP
requirement. Upstream has step 1 coverage-matrix and step 12 instruction-critic,
but light tier discards the latter. Depending on upstream leaves users without
it unable to measure coverage, so we own this check against omission deductions.

Given --req and --report, check each requirement ID's presence in the deliverable.
MISSING: the ID never appears. ORPHAN: the report uses an ID absent from the list.
THIN: an ID appears but its paragraph is shorter than --min-chars.

Whether the response fulfills the requirement is a reading-comprehension judgment.
Export every requirement/response-paragraph pair for that assessment.

Requirement file: one entry per line, ID<tab or two spaces>description.
Example: REQ-001  사용자 인증은 SSO 를 지원한다

Usage:
    python3 coverage_matrix.py --req rfp.txt --report proposal.md [--pairs out.jsonl]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

REQ_LINE = re.compile(r"^\s*([A-Z][A-Z0-9-]{1,15}\d)\s{1,}(.+?)\s*$")


def parse_requirements(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        m = REQ_LINE.match(line)
        if m:
            out[m.group(1)] = m.group(2)
    return out


def paragraphs(text: str) -> list[str]:
    return [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]


def check(reqs: dict[str, str], report: str, min_chars: int):
    findings: list[dict] = []
    pairs: list[dict] = []
    paras = paragraphs(report)

    for rid, desc in reqs.items():
        hits = [p for p in paras if rid in p]
        if not hits:
            findings.append({"kind": "MISSING", "req": rid,
                             "detail": f"{rid} is absent from the deliverable", "requirement": desc})
            continue
        body = max(hits, key=len)
        if len(body) < min_chars:
            findings.append({"kind": "THIN", "req": rid,
                             "detail": f"{rid} response has {len(body)} characters "
                                       f"(minimum {min_chars} characters)",
                             "requirement": desc})
        pairs.append({"req": rid, "requirement": desc, "response": body})

    # IDs used in the deliverable but absent from the requirements list.
    seen = set(re.findall(r"\b([A-Z][A-Z0-9-]{1,15}\d)\b", report))
    for rid in sorted(seen - set(reqs)):
        # Reduce version/standard-number false positives by requiring a listed prefix.
        prefixes = {r.rsplit("-", 1)[0] for r in reqs}
        if any(rid.startswith(p) for p in prefixes):
            findings.append({"kind": "ORPHAN", "req": rid,
                             "detail": f"{rid} is used in the deliverable but absent from the requirements list"})
    return findings, pairs


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--req", type=Path, required=True)
    ap.add_argument("--report", type=Path, required=True)
    ap.add_argument("--min-chars", type=int, default=200,
                    help="Minimum response paragraph length; default 200 characters")
    ap.add_argument("--pairs", type=Path)
    ap.add_argument("--format", choices=("text", "json"), default="text")
    a = ap.parse_args(argv)

    for p in (a.req, a.report):
        if not p.exists():
            print(f"[중단] File does not exist: {p}", file=sys.stderr)
            return 2

    reqs = parse_requirements(a.req)
    if not reqs:
        print(f"[중단] No requirements parsed from {a.req}: "
              "use ID<two spaces>description", file=sys.stderr)
        return 2

    findings, pairs = check(reqs, a.report.read_text(encoding="utf-8"), a.min_chars)
    if a.pairs:
        a.pairs.write_text(
            "\n".join(json.dumps(x, ensure_ascii=False) for x in pairs) + "\n",
            encoding="utf-8")

    covered = len(reqs) - sum(1 for f in findings if f["kind"] == "MISSING")
    if a.format == "json":
        print(json.dumps({"findings": findings, "total": len(reqs),
                          "covered": covered, "pairs": len(pairs)},
                         ensure_ascii=False, indent=2))
    else:
        for f in findings:
            print(f"[{f['kind']}] {f['detail']}")
        print(f"\nRequirements mentioned: {covered}/{len(reqs)} / findings: {len(findings)}")
        print("  Human or LLM reading assesses fulfillment; export with --pairs")
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main())
