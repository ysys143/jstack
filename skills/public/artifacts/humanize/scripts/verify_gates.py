#!/usr/bin/env python3
"""Tier 1 structural gates: four-axis deterministic post-validation, zero LLM calls.

Extends verify_change_rate.py. Character diffs miss structural edits: a measured
2.77% change rate concealed 29.7% sentence touch, -86% ending commas, and -75%
C-8 antithesis. Add three deterministic axes (target attainment, annihilation,
golden/numeric checks) to cover these blind spots. Keep verify_change_rate.py
for backward compatibility; this file owns the new gates.

Four axes plus reporting:
    P0 Character rate: change_rate() vs WARN 30% / ABORT 50%, unchanged decisions.
    P1 Attainment: lexical S1 metrics with before z > +2.0 should reach after
       z <= +1.0. Missed targets (> +2.0) / overcorrection (< -1.5) warn.
    P2 Annihilation: C-8 before >= 5 AND after == 0 fails.
    P3 Golden: failures from tests/golden/checks.run_checks(), including injected numbers.
    P4 Touch: original sentences absent verbatim afterward, plus lost-number
       observations. Report only: merging/notation normalization can legitimately
       lose numeric tokens, so these observations do not affect exit status.

Exit code (same meaning as verify_change_rate.py):
    0: converged; all axes pass
    1: warning; character rate 30–50%, missed/overcorrected targets,
       annihilation, or golden FAIL
    2: abort; character rate >= 50%. Do not adopt the rewrite; highest priority.
    3: execution error, such as missing input; cannot judge gates.

CLI:
    python3 scripts/verify_gates.py --before _workspace/{run_id}/01_input.txt --after _workspace/{run_id}/final.md --genre essay
    Options: --json (also emit structured output), --ignore-markup (character-rate axis only).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

# [local vendoring] Ported from im-not-ai v2.3 (MIT, epoko77-ai/im-not-ai).
# Paths adapted to skills/humanize/{scripts,tests/golden}; logic unchanged.
_HERE = os.path.dirname(os.path.abspath(__file__))
_SKILL_ROOT = os.path.abspath(os.path.join(_HERE, ".."))
_REFS = _HERE  # metrics_v2.py and baselines share this scripts/ directory
_WORK_SCRIPTS = os.path.abspath(os.path.join(_HERE, "../../../scripts"))
_GOLDEN = os.path.join(_SKILL_ROOT, "tests", "golden")
for _p in (_REFS, _GOLDEN, _WORK_SCRIPTS):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import checks as _checks  # noqa: E402  (sys.path mutation is intentional)
import metrics_v2 as _m  # noqa: E402
from content_contract import evaluate as _content_contract  # noqa: E402

# Metadata comment block at the end of final.md, from opening marker to EOF.
_SUMMARY_BLOCK_RE = re.compile(r"<!--\s*HUMANIZE-SUMMARY\b.*", re.DOTALL)

# Lexical S1 candidates for P1 attainment. Exclude lexical_diversity:
# higher values indicate human writing, so reduction is not the target.
S1_CANDIDATE_METRICS = (
    "comma_inclusion_rate",
    "comma_usage_rate",
    "ending_comma_rate",
    "comma_segment_length",
    "hanja_nominalizer_density",
)

# P1 thresholds
S1_SELECT_Z = 2.0      # Select S1 when before z exceeds this
S1_ACHIEVED_Z = 1.0    # Achieved when after z is at most this
S1_MISSED_Z = 2.0      # Missed when after z exceeds this (silent failure)
S1_OVERCORRECT_Z = -1.5  # Overcorrected when after z is below this

# P2 minimum original antithesis count for meaningful annihilation checks.
ANNIHILATION_MIN_BEFORE = 5

_WS_RE = re.compile(r"\s+")


def strip_summary_block(text: str) -> str:
    """Remove the <!-- HUMANIZE-SUMMARY --> metadata block from final.md."""
    return _SUMMARY_BLOCK_RE.sub("", text).strip()


def _read(path: str) -> str:
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def _norm_sentence(s: str) -> str:
    return _WS_RE.sub(" ", s).strip()


def sentence_touch_rate(before: str, after: str) -> tuple[float, int, int]:
    """Fraction of original sentences absent verbatim after whitespace normalization.

    Report only, not a gate. Reveals widespread structural edits even with low
    character change rates. Return (rate, touched, total).
    """
    before_sents = [_norm_sentence(s) for s in _m._split_sentences(before)]
    before_sents = [s for s in before_sents if s]
    if not before_sents:
        return 0.0, 0, 0
    after_set = {_norm_sentence(s) for s in _m._split_sentences(after)}
    touched = sum(1 for s in before_sents if s not in after_set)
    return touched / len(before_sents), touched, len(before_sents)


def judge_s1_targets(
    z_before: dict, z_after: dict
) -> tuple[list[dict], bool]:
    """Judge P1 attainment; return (per-metric decisions, warning flag).

    Select S1_CANDIDATE_METRICS with before z > +2.0. For each, after z <= +1.0
    is achieved, > +2.0 missed (WARN), < -1.5 overcorrected (WARN), and the interval
    between is partial improvement (pass). after z=None is unjudgeable (report only).
    """
    results: list[dict] = []
    warn = False
    for key in S1_CANDIDATE_METRICS:
        zb = z_before.get(key)
        if zb is None or zb <= S1_SELECT_Z:
            continue
        za = z_after.get(key)
        if za is None:
            verdict = "판정불가 (after z 없음)"
        elif za <= S1_OVERCORRECT_Z:
            verdict, warn = "과교정", True
        elif za <= S1_ACHIEVED_Z:
            verdict = "달성"
        elif za > S1_MISSED_Z:
            verdict, warn = "미달", True
        else:
            verdict = "부분 개선"
        results.append({
            "metric": key,
            "z_before": round(zb, 2),
            "z_after": round(za, 2) if za is not None else None,
            "verdict": verdict,
        })
    return results, warn


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Tier 1 structural gates (four integrated axes)")
    p.add_argument("--before", required=True, help="Original text path (01_input.txt)")
    p.add_argument("--after", required=True, help="Rewritten text path (final.md)")
    p.add_argument("--genre", default="essay", help="essay/column/report/blog/abstract")
    p.add_argument("--json", action="store_true", help="Also emit structured JSON")
    p.add_argument("--content-mode", choices=("general", "procurement"), default="general",
                   help="Input mode for the content-preservation contract")
    p.add_argument("--review", help="Independent semantic review JSON path")
    p.add_argument(
        "--ignore-markup",
        action="store_true",
        help="Compare body only for character rate, excluding markup-only lines and leading decoration",
    )
    args = p.parse_args(argv)

    for path in (args.before, args.after):
        if not os.path.exists(path):
            print(f"error: file missing: {path}", file=sys.stderr)
            return 3

    try:
        before = strip_summary_block(_read(args.before))
        after = strip_summary_block(_read(args.after))
    except OSError as e:
        print(f"error: cannot read file: {e}", file=sys.stderr)
        return 3

    report: dict = {"genre": args.genre}
    warn = False

    # Content preservation is separate from golden/change-rate contracts. Changed
    # natural language stays provisional without independent review; mechanical
    # counterexamples block adoption immediately. Do not accept executor self-reports.
    contract = _content_contract(
        Path(args.before), Path(args.after), args.content_mode,
        Path(args.review) if args.review else None,
    )
    report["content_contract"] = contract
    contract_abort = bool(contract["machine"]["failures"])
    if contract["provisional"]:
        warn = True
    print(f"[content-contract] {contract['status']} · "
          f"failures={len(contract['failures'])} · provisional={contract['provisional']}")

    # --- P0 character rate (same decisions as verify_change_rate.py) ---
    rate = _m.change_rate(before, after, ignore_markup=args.ignore_markup)
    abort = rate >= _m.CHANGE_RATE_ABORT or contract_abort
    if _m.CHANGE_RATE_WARN <= rate < _m.CHANGE_RATE_ABORT:
        warn = True
    scope = "본문만 (마크업 제외)" if args.ignore_markup else "전문"
    if abort:
        p0_verdict = "ABORT — 강제 중단. 윤문본 채택 금지"
    elif rate >= _m.CHANGE_RATE_WARN:
        p0_verdict = "WARN — 과윤문 경고"
    else:
        p0_verdict = "OK"
    report["change_rate"] = {
        "rate": round(rate, 4), "scope": scope, "verdict": p0_verdict,
    }
    print(f"[P0 character rate] {rate * 100:.1f}% [{scope}] — {p0_verdict} "
          f"(warn {_m.CHANGE_RATE_WARN * 100:.0f}% / abort {_m.CHANGE_RATE_ABORT * 100:.0f}%)")

    # --- P1 attainment (lexical S1 metrics with before z > +2.0) ---
    try:
        z_before = _m.compute_all_v2(before, genre=args.genre)["z_scores"]
        z_after = _m.compute_all_v2(after, genre=args.genre)["z_scores"]
    except Exception as e:  # Graceful degradation: only this axis becomes unjudgeable
        z_before, z_after = {}, {}
        print(f"[P1 attainment] cannot judge (metrics error: {e})", file=sys.stderr)
    s1_results, s1_warn = judge_s1_targets(z_before, z_after)
    warn = warn or s1_warn
    report["s1_targets"] = s1_results
    if not s1_results:
        print("[P1 attainment] N/A: structural diagnosis (no lexical S1 anchors)")
    else:
        for r in s1_results:
            za = f"{r['z_after']:+.2f}" if r["z_after"] is not None else "?"
            print(f"[P1 attainment] {r['metric']}: z {r['z_before']:+.2f} → {za}"
                  f"  {r['verdict']}")

    # --- P2 annihilation (C-8 antithesis) ---
    anti_before = _m.antithesis_count(before)
    anti_after = _m.antithesis_count(after)
    annihilated = anti_before >= ANNIHILATION_MIN_BEFORE and anti_after == 0
    warn = warn or annihilated
    report["antithesis"] = {
        "before": anti_before, "after": anti_after,
        "verdict": "FAIL — 전멸" if annihilated else (
            "OK" if anti_before >= ANNIHILATION_MIN_BEFORE
            else "스킵 (원문 대구 < 5)"),
    }
    print(f"[P2 annihilation] C-8 antithesis {anti_before} → {anti_after} — "
          f"{report['antithesis']['verdict']}")

    # --- P2b annihilation (L abstract metaphors; local extension) ---
    # Warn when core category-L surfaces fall from 5+ original occurrences to zero.
    # L targets metaphor removal, but this pattern may also erase physical usages
    # (door handles, wood grain), so require human confirmation.
    _L_LEXEME_RE = re.compile(
        r"무너진다|무너졌|맞물|가른다|갈린다|손잡이|셈이다|사실상|"
        r"(?:^|[\s(])축(?:을|이|은|의|으로)|(?:^|\s)결(?:이|의|을)"
    )
    l_before = len(_L_LEXEME_RE.findall(before))
    l_after = len(_L_LEXEME_RE.findall(after))
    l_annihilated = l_before >= ANNIHILATION_MIN_BEFORE and l_after == 0
    warn = warn or l_annihilated
    report["l_metaphor"] = {
        "before": l_before, "after": l_after,
        "verdict": "WARN — 전멸(물리적 용법 오삭제 의심)" if l_annihilated else (
            "OK" if l_before >= ANNIHILATION_MIN_BEFORE else "스킵 (원문 은유 < 5)"),
    }
    print(f"[P2b annihilation] L metaphors {l_before} → {l_after} — "
          f"{report['l_metaphor']['verdict']}")

    # --- P3 golden + numbers ---
    failures = _checks.run_checks(before, after)
    warn = warn or bool(failures)
    report["golden"] = [{"code": f.code, "message": f.message} for f in failures]
    if failures:
        print(f"[P3 golden] FAIL: {len(failures)} failures:")
        for f in failures:
            print(f"    FAIL {f}")
    else:
        print("[P3 golden] PASS (no numeric injection, footnote, quotation, or register defects)")

    # --- P4 sentence touch + lost numbers (report only, not a gate) ---
    touch_rate, touched, total = sentence_touch_rate(before, after)
    report["sentence_touch"] = {
        "rate": round(touch_rate, 4), "touched": touched, "total": total,
    }
    print(f"[P4 sentence touch] {touch_rate * 100:.1f}% ({touched}/{total} sentences): report only")
    dropped = _checks.dropped_numbers(before, after)
    report["numbers_dropped"] = dropped
    if dropped:
        print(f"[P4 lost numbers] observed: {dropped} "
              f"(may be normal after sentence merging/notation normalization; does not affect exit status; review needed)")

    # --- Combined verdict ---
    if abort:
        verdict, code = "ABORT — 강제 중단. 윤문본 채택 금지", 2
    elif warn:
        verdict, code = "WARN — 경고. 사용자 고지 + finalize 승급", 1
    else:
        verdict, code = "OK — 수렴", 0
    report["gate"] = {"verdict": verdict, "exit_code": code}
    print(f"gate: {verdict}")

    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    return code


if __name__ == "__main__":
    sys.exit(main())
