#!/usr/bin/env python3
"""Compare RFP requirement IDs against proposal text: deterministic coverage gate, zero LLM calls.

Missing requirement IDs can disqualify Korean public procurement proposals.
Existing humanize checks (such as category L) correct syntax such as ID-as-subject
usage; they cannot detect an ID that is absent, because absent strings do not match.
This script counts each listed ID in proposal text and reports zero-count IDs as missing.

ID boundaries:
    Python re treats Korean syllables as Unicode word characters, so a simple
    word boundary misses IDs followed directly by particles, such as "SFR-001은".
    Check boundaries against ASCII alphanumerics ([A-Za-z0-9]) only: reject
    SFR-001 as a prefix of SFR-0011, while matching "SFR-001은" correctly.

Search inside code fences too, since proposal tables may be fenced.

CLI:
    python3 req_coverage.py --requirements reqs.txt --proposal body.md [--proposal body2.md ...] [--json]

Exit code:
    0: all covered
    1: at least one missing requirement
    2: input file error (e.g. missing file)
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


def parse_requirements(path: str) -> tuple[list[str], list[str]]:
    """Read one requirement ID per line.

    Ignore blank lines and everything from # to the line end (full/inline comments).
    Return (deduplicated IDs in first-seen order, unique duplicated IDs in first-seen order).
    """
    try:
        raw = Path(path).read_text(encoding="utf-8")
    except OSError as e:
        print(f"error: cannot read requirements file: {path} ({e})", file=sys.stderr)
        raise SystemExit(2)

    ordered: list[str] = []
    counts: dict[str, int] = {}
    for line in raw.splitlines():
        body = line.split("#", 1)[0].strip()
        if not body:
            continue
        if body not in counts:
            ordered.append(body)
        counts[body] = counts.get(body, 0) + 1

    dup_ids = [rid for rid in ordered if counts[rid] > 1]
    return ordered, dup_ids


def read_proposal(paths: list[str]) -> str:
    """Read proposal body files and join them into one string."""
    chunks = []
    for p in paths:
        try:
            chunks.append(Path(p).read_text(encoding="utf-8"))
        except OSError as e:
            print(f"error: cannot read proposal file: {p} ({e})", file=sys.stderr)
            raise SystemExit(2)
    return "\n".join(chunks)


def count_occurrences(req_id: str, text: str) -> int:
    """Count case-sensitive req_id occurrences in text.

    ASCII alphanumeric boundaries prevent SFR-001 matching the prefix of SFR-0011.
    See the module docstring for boundary rules.
    """
    pattern = re.compile(r"(?<![A-Za-z0-9])" + re.escape(req_id) + r"(?![A-Za-z0-9])")
    return len(pattern.findall(text))


def check_coverage(req_ids: list[str], proposal_text: str) -> dict[str, int]:
    """Return a mapping from each requirement ID to its proposal occurrence count."""
    return {rid: count_occurrences(rid, proposal_text) for rid in req_ids}


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        description="Check whether RFP requirement IDs actually occur in proposal text"
    )
    p.add_argument("--requirements", required=True, help="Requirement ID file (one per line)")
    p.add_argument(
        "--proposal",
        required=True,
        action="append",
        help="Proposal body file; may be supplied multiple times",
    )
    p.add_argument("--json", action="store_true", help="Print JSON results to stdout")
    args = p.parse_args(argv)

    req_ids, dup_ids = parse_requirements(args.requirements)
    if dup_ids:
        print(
            f"Warning: {len(dup_ids)} duplicate requirement IDs; continuing after deduplication: "
            + ", ".join(dup_ids),
            file=sys.stderr,
        )

    proposal_text = read_proposal(args.proposal)

    counts = check_coverage(req_ids, proposal_text)
    missing = [rid for rid in req_ids if counts[rid] == 0]
    total = len(req_ids)
    covered = total - len(missing)
    coverage_ratio = (covered / total) if total else 1.0

    if args.json:
        report = {
            "total": total,
            "covered": covered,
            "missing": len(missing),
            "coverage": coverage_ratio,
            "missing_ids": missing,
            "counts": counts,
            "duplicate_ids": dup_ids,
        }
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print(
            f"Requirements {total} / covered {covered} / missing {len(missing)} / "
            f"coverage {coverage_ratio * 100:.1f}%"
        )
        print()
        if missing:
            print("Missing:")
            for rid in missing:
                print(f"  {rid}")
        else:
            print("No missing requirements")

    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main())
