#!/usr/bin/env python3
"""Deterministic candidates: extract every ANCHORED occurrence before the LLM.

Every matching surface occurrence is a candidate regardless of detector attention.
This is the first half of the runtime guarantee; reconcile.py provides the second.
Run lint_taxonomy first and stop without creating candidates if it fails.

Usage: python3 prescan.py --input 01_input.txt --taxonomy taxonomy.md --out 02_candidates.json
"""
import argparse
import json
import re
import sys

from taxonomy_rules import normalize, parse_taxonomy, content_hash
from metrics import compute_metrics, eval_metric_expr
import lint_taxonomy


def build_candidates(input_path, taxonomy_path):
    parsed = parse_taxonomy(taxonomy_path)
    with open(input_path, "r", encoding="utf-8") as f:
        text = normalize(f.read())

    candidates = []
    for rid, rule in parsed["rules"].items():
        if rule["klass"] != "ANCHORED" or not rule["surface"]:
            continue
        pattern = re.compile(rule["surface"])
        for m in pattern.finditer(text):
            if m.start() == m.end():
                continue  # Prevent empty matches
            candidates.append({
                "candidate_id": f"{rid}:{m.start()}",
                "rule_id": rid,
                "severity": rule["severity"],
                "text_span": m.group(0),
                "start": m.start(),   # Character offset in NFC text
                "end": m.end(),
            })

    # COMPUTED rules: calculate metrics and evaluate triggers
    doc_metrics = compute_metrics(text)
    computed_rules = {}
    for rid, rule in parsed["rules"].items():
        if rule["klass"] != "COMPUTED" or not rule["metric"]:
            continue
        triggered, actual = eval_metric_expr(rule["metric"], doc_metrics)
        computed_rules[rid] = {
            "expr": rule["metric"],
            "actual": actual,
            "triggered": triggered,
        }

    out = {
        "meta": {
            "taxonomy_version": parsed["version"],
            "taxonomy_hash": parsed["content_hash"],
            "input_hash": content_hash(text),
            "input_length": len(text),
            "candidate_count": len(candidates),
            "metrics": doc_metrics,
            "computed_rules": computed_rules,
        },
        "candidates": candidates,
    }
    return out


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--taxonomy", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args(argv)

    # Pre-LLM gate: do not create candidates from a corrupt SSOT.
    _, lint_errors = lint_taxonomy.lint(args.taxonomy)
    if lint_errors:
        print("prescan stopped: taxonomy lint failed:", file=sys.stderr)
        for e in lint_errors:
            print(f"  {e}", file=sys.stderr)
        return 1

    out = build_candidates(args.input, args.taxonomy)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    meta = out["meta"]
    triggered = [rid for rid, c in meta["computed_rules"].items() if c["triggered"]]
    print(
        f"prescan complete: {meta['candidate_count']} candidates, "
        f"COMPUTED triggers {triggered or 'none'} -> {args.out}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
