#!/usr/bin/env python3
"""Deterministic reconcile gate: the post-LLM half of the runtime guarantee.

The detector can fake self-reported invariants by mass-keeping candidates.
Compare candidates and decisions by candidate_id and fail the pipeline if even
one remains unresolved. This code, rather than the prompt, anchors auditability.

Checks:
  1. Three-way taxonomy hash agreement: current file == candidates stamp ==
     detection echo, blocking stale prescan/cache divergence (H6).
  2. Every ANCHORED candidate is flagged or kept (H1); one unresolved case fails.
  3. Every triggered COMPUTED rule has a finding, independently verified by
     recalculating metrics from input.

Usage:
  python3 reconcile.py --candidates 02_candidates.json --detection 02_detection.json --taxonomy taxonomy.md --input 01_input.txt
Exit code: 0 pass / 1 FAIL (stop pipeline).
"""
import argparse
import json
import sys

from taxonomy_rules import parse_taxonomy, content_hash
from metrics import compute_metrics, eval_metric_expr


def _load(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def reconcile(candidates_path, detection_path, taxonomy_path, input_path):
    cand = _load(candidates_path)
    det = _load(detection_path)
    parsed = parse_taxonomy(taxonomy_path)
    failures = []

    # --- 1. Three-way hash agreement ---
    with open(input_path, "r", encoding="utf-8") as f:
        input_text = f.read()
    live_hash = parsed["content_hash"]
    cand_hash = cand.get("meta", {}).get("taxonomy_hash")
    det_hash = det.get("meta", {}).get("taxonomy_hash")
    if cand_hash != live_hash:
        failures.append(
            f"[hash] candidates stamp ({cand_hash}) != current taxonomy ({live_hash}): stale prescan"
        )
    if det_hash != cand_hash:
        failures.append(
            f"[hash] detection echo ({det_hash}) != candidates ({cand_hash}): detector used another version"
        )

    # Verify input text has not changed since prescan (offset consistency).
    cand_input_hash = cand.get("meta", {}).get("input_hash")
    if cand_input_hash and cand_input_hash != content_hash(input_text):
        failures.append(
            "[input hash] 01_input.txt changed after prescan: candidate offsets are unreliable"
        )

    # --- 2. Candidate exhaustion (core guarantee) ---
    candidate_ids = {c["candidate_id"] for c in cand.get("candidates", [])}
    adjudicated = set()
    for fnd in det.get("findings", []):
        cid = fnd.get("candidate_id")
        if cid:
            adjudicated.add(cid)
    for kept in det.get("kept", []):
        cid = kept.get("candidate_id")
        if cid:
            adjudicated.add(cid)
        # Keep requires a verifiable evidence token (H2).
        if not kept.get("evidence"):
            failures.append(f"[keep evidence] {cid}: keep without an evidence token")

    unaccounted = candidate_ids - adjudicated
    if unaccounted:
        failures.append(
            f"[unresolved candidates] {len(unaccounted)} neither flagged nor kept: "
            f"{sorted(unaccounted)[:10]}{' ...' if len(unaccounted) > 10 else ''}"
        )

    phantom = adjudicated - candidate_ids
    if phantom:
        failures.append(
            f"[phantom decisions] candidate_id absent from candidates: {sorted(phantom)[:10]}"
        )

    # --- 3. Independent COMPUTED recalculation ---
    doc_metrics = compute_metrics(input_text)
    finding_categories = {f.get("category") for f in det.get("findings", [])}
    for rid, rule in parsed["rules"].items():
        if rule["klass"] != "COMPUTED" or not rule["metric"]:
            continue
        try:
            triggered, _ = eval_metric_expr(rule["metric"], doc_metrics)
        except ValueError as e:
            failures.append(f"[COMPUTED error] {rid} metric evaluation failed: {e}")
            continue
        if triggered and rid not in finding_categories:
            failures.append(
                f"[COMPUTED missing] {rid} metric ({rule['metric']}) triggered without a finding"
            )

    return {
        "candidate_count": len(candidate_ids),
        "adjudicated": len(adjudicated & candidate_ids),
        "unaccounted": len(unaccounted),
        "failures": failures,
    }


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("--candidates", required=True)
    ap.add_argument("--detection", required=True)
    ap.add_argument("--taxonomy", required=True)
    ap.add_argument("--input", required=True)
    args = ap.parse_args(argv)

    r = reconcile(args.candidates, args.detection, args.taxonomy, args.input)
    print(
        f"reconcile: candidates {r['candidate_count']} / resolved {r['adjudicated']} / "
        f"unresolved {r['unaccounted']}"
    )
    if r["failures"]:
        print(f"\nRECONCILE FAIL: {len(r['failures'])} failures:", file=sys.stderr)
        for e in r["failures"]:
            print(f"  {e}", file=sys.stderr)
        return 1
    print("RECONCILE PASS: all candidates resolved, hashes agree, COMPUTED findings complete")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
