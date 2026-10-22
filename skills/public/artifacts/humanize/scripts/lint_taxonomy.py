#!/usr/bin/env python3
"""Taxonomy linter: fail loudly on SSOT corruption before the LLM (H5).

Checks:
  1. Unique rule IDs (duplicates break reference stability).
  2. ANCHORED requires a nonblank, compilable surface regex; missing ones hide
     behind a misleading zero-candidate result.
  3. COMPUTED requires a valid metric expression with known names and syntax.
  4. No unknown class values.

Usage: python3 lint_taxonomy.py <taxonomy.md>
Exit code: 0 pass / 1 violation (stop the pipeline).
"""
import re
import sys

from taxonomy_rules import VALID_CLASSES, parse_taxonomy
from metrics import KNOWN_METRICS, parse_metric_expr


def lint(path):
    parsed = parse_taxonomy(path)
    errors = []

    for rid in parsed["duplicates"]:
        errors.append(f"[duplicate ID] {rid}: rule ID defined more than once (append-only violation)")

    if not parsed["version"]:
        errors.append("[version] no 'vX.Y' version marker on the first line")

    for rid, rule in parsed["rules"].items():
        klass = rule["klass"]
        if klass is not None and klass not in VALID_CLASSES:
            errors.append(f"[class] {rid}: unknown class {klass!r}")

        if klass == "ANCHORED":
            surface = rule["surface"]
            if not surface:
                errors.append(f"[missing surface] {rid}: ANCHORED without a surface regex would disguise itself as zero prescan candidates")
                continue
            try:
                re.compile(surface)
            except re.error as e:
                errors.append(f"[surface regex] {rid}: cannot compile {surface!r} ({e})")

        if klass == "COMPUTED":
            metric = rule["metric"]
            if not metric:
                errors.append(f"[missing metric] {rid}: COMPUTED without a metric expression")
                continue
            try:
                clauses = parse_metric_expr(metric)
            except ValueError as e:
                errors.append(f"[metric syntax] {rid}: {e}")
                continue
            for name, _op, _num in clauses:
                if name not in KNOWN_METRICS:
                    errors.append(
                        f"[metric name] {rid}: unknown metric {name!r} "
                        f"(available: {sorted(KNOWN_METRICS)})"
                    )

    return parsed, errors


def main(argv):
    if len(argv) != 2:
        print("usage: lint_taxonomy.py <taxonomy.md>", file=sys.stderr)
        return 2
    parsed, errors = lint(argv[1])
    anchored = sum(1 for r in parsed["rules"].values() if r["klass"] == "ANCHORED")
    computed = sum(1 for r in parsed["rules"].values() if r["klass"] == "COMPUTED")
    total = len(parsed["rules"])
    print(
        f"taxonomy v{parsed['version']} hash={parsed['content_hash']} "
        f"{total} rules (ANCHORED {anchored} / COMPUTED {computed} / remaining HOLISTIC)"
    )
    if errors:
        print(f"\nLINT failed: {len(errors)} violations:", file=sys.stderr)
        for e in errors:
            print(f"  {e}", file=sys.stderr)
        return 1
    print("LINT PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
