#!/usr/bin/env python3
"""Cap one cleanup run at twenty findings and say what was cut.

    python3 scripts/cap_findings.py findings.json
    ... | python3 scripts/cap_findings.py          # stdin, or "-"

`cleanup` sweeps the whole codebase, so nothing bounds how much it can say. The
restraint rule — do not flood the report with nits, prefer a small number of
high-confidence findings — is the bound, and a rule that depends on remembering
it is not a bound. This script is that rule made mechanical.

Two decisions are load-bearing (see `references/wave-protocol.md`):

- **What is cut is the lower priority, not the lower confidence.** Cutting by
  confidence keeps the speculative findings and drops the certain ones, which
  inverts the rule it was meant to serve
- **The count of what was cut is stated, never implied.** A silent truncation
  turns a bounded report into a false claim of completeness

Exit codes:

    0   valid input, capped or not
    2   the input is not a findings document this can cap

There is no exit code for "truncated". Truncation is the normal case for a
whole-codebase sweep, and reporting it as a failure would push callers to raise
the cap to get a zero, which is the flood the cap exists to prevent.
"""
from __future__ import annotations

import json
import sys

CAP = 20

# Rank order for the cut. An unrecognised severity sorts last rather than being
# rejected: a findings document from a producer we do not control should still
# be capped, and dropping the unknown ones silently would be a second, hidden cut.
SEVERITY_RANK = {"high": 0, "medium": 1, "low": 2}
UNKNOWN_RANK = 3


def rank(finding):
    """Sort key. Ties keep input order, so the caller's own ordering survives."""
    severity = finding.get("severity")
    if isinstance(severity, str):
        return SEVERITY_RANK.get(severity.lower(), UNKNOWN_RANK)
    return UNKNOWN_RANK


def extract(document):
    """Pull the findings list out of either accepted shape.

    Raises ValueError with a reason the caller can act on — "invalid" without a
    reason sends the caller back to guessing.
    """
    if isinstance(document, list):
        findings = document
    elif isinstance(document, dict):
        if "findings" not in document:
            raise ValueError("object input has no 'findings' key")
        findings = document["findings"]
    else:
        raise ValueError(f"top level is {type(document).__name__}, expected list or object")
    if not isinstance(findings, list):
        raise ValueError(f"'findings' is {type(findings).__name__}, expected a list")
    for i, item in enumerate(findings):
        if not isinstance(item, dict):
            raise ValueError(f"finding {i} is {type(item).__name__}, expected an object")
    return findings


def cap(findings, limit=CAP):
    """Keep the top `limit` by severity and report the cut. Pure — testable alone."""
    ordered = sorted(findings, key=rank)
    kept = ordered[:limit]
    truncated = len(ordered) - len(kept)
    result = {
        "total": len(ordered),
        "shown": len(kept),
        "truncated": truncated,
        "note": f"Show {len(kept)} of {len(ordered)}",
        "findings": kept,
    }
    if truncated > 0:
        result["note"] += (
            f" — {truncated} lower-priority finding(s) cut to keep the report readable"
        )
    return result


def main(argv):
    source = argv[1] if len(argv) > 1 else "-"
    try:
        if source == "-":
            raw = sys.stdin.read()
        else:
            with open(source, encoding="utf-8") as handle:
                raw = handle.read()
    except OSError as exc:
        print(f"cap_findings: cannot read {source}: {exc}", file=sys.stderr)
        return 2
    try:
        findings = extract(json.loads(raw))
    except json.JSONDecodeError as exc:
        print(f"cap_findings: input is not JSON: {exc}", file=sys.stderr)
        return 2
    except ValueError as exc:
        print(f"cap_findings: {exc}", file=sys.stderr)
        return 2
    json.dump(cap(findings), sys.stdout, ensure_ascii=False, indent=1)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
