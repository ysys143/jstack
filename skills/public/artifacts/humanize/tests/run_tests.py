#!/usr/bin/env python3
"""End-to-end runtime-guarantee tests: positive and failure paths.

Auditability is established by gates actually failing on counterexamples.
Usage: python3 tests/run_tests.py from the plugin skills/humanize directory.
Exit code: 0 all pass / 1 failure.
"""

import io
import json
import hashlib
import os
import re
import shutil
import subprocess
import sys

# Do not leave __pycache__ in the plugin tree; the hygiene gate rejects it. Use the environment
# variable to cover subprocess children too.
sys.dont_write_bytecode = True
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
# E402: Set these two lines first so subprocess children inherit the setting.
import importlib  # noqa: E402
import tempfile  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
# Shared skill tools: use body-deletion regression to check document contracts.
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
# E402: Set the path before importing the library outside this skill tree.
from _suite_lib import (  # noqa: E402
    check_skill_body,
    check_no_constant_assertions,
    check_script_contracts,
    check_total,
    check_ref_contracts,
    check_body_deletion,
    check_contract_coverage,
    section,
)  # noqa: E402

ROOT = os.path.dirname(HERE)
SCRIPTS = os.path.join(ROOT, "scripts")
sys.path.insert(0, SCRIPTS)

# Do not die when scripts are empty. An import crash erases the suite’s checks instead of failing
# them (empty taxonomy_rules measured zero FAILs and immediate rc=1). Record absence as failure here
# and skip dependent sections.
_broken = []


def _need(modname, *attrs):
    try:
        mod = importlib.import_module(modname)
    except Exception as e:  # noqa: BLE001 — retain the exact failure reason
        _broken.append(f"{modname}: import failed: {type(e).__name__}: {e}")
        return None
    missing = [a for a in attrs if not hasattr(mod, a)]
    if missing:
        _broken.append(f"{modname}: missing names {missing}")
        return None
    return mod


lint_taxonomy = _need("lint_taxonomy", "lint")
prescan = _need("prescan", "build_candidates")
reconcile = _need("reconcile", "reconcile")
_tax = _need("taxonomy_rules", "parse_taxonomy", "normalize", "VALID_CLASSES")
parse_taxonomy = getattr(_tax, "parse_taxonomy", None)
normalize = getattr(_tax, "normalize", None)

TAXONOMY = os.path.join(ROOT, "references", "ai-tell-taxonomy.md")
GOLD_INPUT = os.path.join(HERE, "gold", "L_examples_input.txt")

EN_TAXONOMY = os.path.join(ROOT, "references", "en-taxonomy.md")
EN_GOLD = os.path.join(HERE, "gold", "en_examples_input.txt")

results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    mark = "PASS" if ok else "FAIL"
    print(f"[{mark}] {name}" + (f" — {detail}" if detail else ""))



def build_detection(cand, keep_ids=frozenset(), *, poison=False, bad_hash=False):
    "Create valid detection exhausting all candidates; optionally inject defects."
    candidates = list(cand["candidates"])
    findings, kept = [], []
    for i, c in enumerate(candidates):
        if poison and i == 0:
            continue  # Omit one candidate (H1)
        if c["candidate_id"] in keep_ids:
            kept.append(
                {
                    "candidate_id": c["candidate_id"],
                    "rule_id": c["rule_id"],
                    "reason": "물리적 문 손잡이",
                    "evidence": "문 손잡이",
                }
            )
        else:
            findings.append(
                {
                    "id": f"f{i:03}",
                    "candidate_id": c["candidate_id"],
                    "category": c["rule_id"],
                    "severity": c["severity"],
                    "scope": "span",
                    "text_span": c["text_span"],
                    "start": c["start"],
                    "end": c["end"],
                    "reason": "test",
                    "suggested_fix": "test",
                }
            )
    # Add document findings for triggered COMPUTED rules
    for rid, info in cand["meta"]["computed_rules"].items():
        if info["triggered"]:
            findings.append(
                {
                    "id": f"fc_{rid}",
                    "category": rid,
                    "scope": "document",
                    "reason": "computed",
                    "suggested_fix": "리듬 변주",
                }
            )
    h = cand["meta"]["taxonomy_hash"]
    return {
        "meta": {
            "taxonomy_version": cand["meta"]["taxonomy_version"],
            "taxonomy_hash": "deadbeef" if bad_hash else h,
        },
        "findings": findings,
        "kept": kept,
    }


# Read frozen repository copies. Previously this read ~/.claude/plugins/cache/<marketplace>/
# humanize/0.6.0/..., which disappears after planned plugins/humanize/ deletion, version
# upgrades, or moving machines. Missing data reduced four parity checks to one failure and broke
# check_total; a blank HOME reproduced 143/145. Frozen provenance and hashes are in
# ../UPSTREAM.sha256.
UPSTREAM = os.path.join(HERE, "upstream-0.6.0")
UPSTREAM_MANIFEST = os.path.join(ROOT, "UPSTREAM.sha256")
UPSTREAM_PARITY = (("ai-tell-taxonomy.md", 96), ("procurement-taxonomy.md", 34))


def check_upstream_parity(check):
    """Check that no upstream taxonomy categories were lost.

    humanize was absorbed while consolidating 19 plugins into two. The original
    general-vs-upstream eval was an ablation whose without arm had no plugin,
    not upstream; measured deltas fluctuated +0.33/-0.33 in noise. Category
    preservation can instead be answered deterministically by comparing source
    files without LLM grading. On missing-upstream machines, record the skip as
    a verdict rather than counting absence as a pass.
    """
    if not os.path.isdir(UPSTREAM):
        check(
            "Upstream parity: frozen copy exists",
            False,
            f"{UPSTREAM} missing; it must exist in the repository. Restore if deleted.",
        )
        return

    # Bind the frozen copy to manifest bytes. Otherwise replacing it with our own file reduces
    # parity to ours >= ours.
    declared = {}
    if os.path.isfile(UPSTREAM_MANIFEST):
        with open(UPSTREAM_MANIFEST, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                digest, _, rel = line.partition("  ")
                declared[os.path.basename(rel)] = digest
    check(
        "Upstream parity: manifest declares both files",
        len(declared) == 2,
        f"{sorted(declared)}",
    )
    # Iterate a fixed list, not declarations. Iterating declared lets an empty manifest erase checks
    # instead of failing them, as measured by the coverage guard (copy 86 vs actual 88).
    # Disappearing checks do not even remain in a diff.
    for name, _floor in UPSTREAM_PARITY:
        digest = declared.get(name)
        path = os.path.join(UPSTREAM, name)
        actual = (
            hashlib.sha256(open(path, "rb").read()).hexdigest()
            if os.path.isfile(path)
            else None
        )
        check(
            f"Upstream parity: {name} matches its manifest hash",
            digest is not None and actual == digest,
            f"measured {actual[:12] if actual else 'file missing'} / "
            f"declared {digest[:12] if digest else 'none'}",
        )
    for name, floor in UPSTREAM_PARITY:
        up = os.path.join(UPSTREAM, name)
        ours = os.path.join(ROOT, "references", name)
        if not (os.path.isfile(up) and os.path.isfile(ours)):
            check(f"Upstream parity: {name} exists on both sides", False, f"{up} / {ours}")
            continue
        pat = r"^#{2,3} ([A-Z]~?[A-Z]?-?\d*)\."
        with open(up, encoding="utf-8") as f:
            a = set(re.findall(pat, f.read(), re.M))
        with open(ours, encoding="utf-8") as f:
            b = set(re.findall(pat, f.read(), re.M))
        check(
            f"Upstream parity: {name} has at least {floor} categories",
            len(a) >= floor,
            f"upstream {len(a)} (floor {floor})",
        )
        check(
            f"Upstream parity: {name} loses no categories",
            not (a - b),
            f"missing {sorted(a - b)}",
        )


def main():
    # Record missing measured scripts as failures and continue. The previous return 1 ended
    # execution before check_total, despite comments claiming that total-count checks would catch
    # disappearing tests. Empty lint_taxonomy yielded one copy result vs 127 actual results; old
    # script floors measured gate-message counts, not contracts. _Section now records dependent
    # check names as failures and every path reaches check_total.
    for why in _broken:
        check("Missing script", False, why)

    tmp = tempfile.mkdtemp()
    cand_path = os.path.join(tmp, "02_candidates.json")
    det_path = os.path.join(tmp, "02_detection.json")

    # KR measurement section: these names remain as verdicts even when scripts are missing.
    with section(check, results, 
        'lint: valid taxonomy passes',
        'lint: missing surface taxonomy FAIL',
        "prescan: L-6 '축에서' recall restored",
        'prescan: no false positives on compounds 결과/구축',
        'prescan: identify physical L-8 (문 손잡이) candidate by content',
        'reconcile: passes when all candidates are resolved',
        'reconcile: poison (unresolved candidate) FAIL',
        'reconcile: hash mismatch FAIL',
        'reconcile: keep without evidence FAIL',
        'prescan: seven new v3.0 rules trigger',
        'COMPUTED: C-12 comma inclusion rate triggers',
    ):
        # 1. Valid taxonomy lint PASS.
        _, errs = lint_taxonomy.lint(TAXONOMY)
        check("lint: valid taxonomy passes", not errs, f"{len(errs)} errors")

        # 2. Corrupted taxonomy (ANCHORED without a surface field) lint FAIL.
        corrupt = os.path.join(tmp, "corrupt.md")
        with open(TAXONOMY, encoding="utf-8") as f:
            txt = f.read()
        # Remove L-8 surface line, leaving ANCHORED without a surface.
        corrupt_txt = re.sub(r"- 표층형: `손잡이`\n", "", txt, count=1)
        with open(corrupt, "w", encoding="utf-8") as f:
            f.write(corrupt_txt)
        _, cerrs = lint_taxonomy.lint(corrupt)
        check("lint: missing surface taxonomy FAIL", bool(cerrs), f"{len(cerrs)} errors detected")

        # 3. prescan candidates include 축에서, verifying restored recall.
        cand = prescan.build_candidates(GOLD_INPUT, TAXONOMY)
        with open(cand_path, "w", encoding="utf-8") as f:
            json.dump(cand, f, ensure_ascii=False)
        spans = {c["text_span"].strip() for c in cand["candidates"]}
        check(
            "prescan: L-6 '축에서' recall restored",
            any("축" in s for s in spans),
            f"{cand['meta']['candidate_count']} candidates",
        )
        check(
            "prescan: no false positives on compounds 결과/구축",
            not any(s in ("결과", "구축") for s in spans),
        )

        # Identify physical 문 손잡이 by content, not a hardcoded offset, to survive gold edits.
        gold_text = normalize(open(GOLD_INPUT, encoding="utf-8").read())
        phys = gold_text.index("문 손잡이") + len("문 ")
        keep_ids = frozenset(
            c["candidate_id"]
            for c in cand["candidates"]
            if c["rule_id"] == "L-8" and c["start"] == phys
        )
        check(
            "prescan: identify physical L-8 (문 손잡이) candidate by content",
            bool(keep_ids),
            "" if keep_ids else "gold '문 손잡이' match failed; cannot verify keep path",
        )

        # 4. Valid detection -> reconcile PASS.
        det = build_detection(cand, keep_ids)
        with open(det_path, "w", encoding="utf-8") as f:
            json.dump(det, f, ensure_ascii=False)
        r = reconcile.reconcile(cand_path, det_path, TAXONOMY, GOLD_INPUT)
        check("reconcile: passes when all candidates are resolved", not r["failures"], str(r["failures"][:1]))

        # 5. Poison: omit one candidate -> reconcile FAIL.
        det_poison = build_detection(cand, keep_ids, poison=True)
        with open(det_path, "w", encoding="utf-8") as f:
            json.dump(det_poison, f, ensure_ascii=False)
        r = reconcile.reconcile(cand_path, det_path, TAXONOMY, GOLD_INPUT)
        check(
            "reconcile: poison (unresolved candidate) FAIL",
            any("unresolved" in x for x in r["failures"]),
            f"{len(r['failures'])} failures",
        )

        # 6. version divergence → reconcile FAIL
        det_bad = build_detection(cand, keep_ids, bad_hash=True)
        with open(det_path, "w", encoding="utf-8") as f:
            json.dump(det_bad, f, ensure_ascii=False)
        r = reconcile.reconcile(cand_path, det_path, TAXONOMY, GOLD_INPUT)
        check(
            "reconcile: hash mismatch FAIL",
            any("hash" in x for x in r["failures"]),
            f"{len(r['failures'])} failures",
        )

        # 7. Keep without evidence -> reconcile FAIL; require kept candidates to avoid vacuous
        # passes.
        det_noev = build_detection(cand, keep_ids)
        for k in det_noev["kept"]:
            k.pop("evidence", None)
        with open(det_path, "w", encoding="utf-8") as f:
            json.dump(det_noev, f, ensure_ascii=False)
        r = reconcile.reconcile(cand_path, det_path, TAXONOMY, GOLD_INPUT)
        check(
            "reconcile: keep without evidence FAIL",
            bool(det_noev["kept"]) and any("keep evidence" in x for x in r["failures"]),
        )

        # 8. prescan triggers new v3.0 rules absorbed from upstream.
        v3inp = os.path.join(tmp, "v3.txt")
        with open(v3inp, "w", encoding="utf-8") as f:
            f.write(
                "긴장으로부터의 해방. 데이터를 정제하고, 검증한다. "
                "단순히 도구가 아니라 파트너다. 속도라기보다 방향이다. "
                "1) 하나 2) 둘 3) 셋이다. 양쪽 모두 일리가 있고 신중하게 본다. "
                "'규모'를 넘어 '전략'으로 간다. seamless하고 robust한 경험.\n"
            )
        v3c = prescan.build_candidates(v3inp, TAXONOMY)
        v3hit = {c["rule_id"] for c in v3c["candidates"]}
        v3want = {"A-19", "C-8", "C-9", "C-11", "G-3", "D-7", "B-2"}
        check(
            "prescan: seven new v3.0 rules trigger",
            v3want <= v3hit,
            f"missing {sorted(v3want - v3hit)}",
        )

        # 9. C-12 COMPUTED triggers on a comma-heavy document.
        c12inp = os.path.join(tmp, "c12.txt")
        with open(c12inp, "w", encoding="utf-8") as f:
            f.write(
                "기술이 발전하면서, 시장이 커졌다. 비용이 내리자, 수요가 늘었다. "
                "규제가 풀리며, 진입이 쉬워졌다. 인재가 모이고, 자본이 몰렸다. "
                "경쟁이 붙으면서, 품질이 올랐다. 요약하면, 선순환이다.\n"
            )
        c12c = prescan.build_candidates(c12inp, TAXONOMY)
        check(
            "COMPUTED: C-12 comma inclusion rate triggers",
            c12c["meta"]["computed_rules"].get("C-12", {}).get("triggered", False),
        )

    # 10. verify_gates integration: identical input exits 0; detect C-8 annihilation and warn on L
    # annihilation.
    import subprocess

    vg = os.path.join(SCRIPTS, "verify_gates.py")

    def run_gate(before, after):
        b, a = os.path.join(tmp, "gb.txt"), os.path.join(tmp, "ga.txt")
        open(b, "w", encoding="utf-8").write(before)
        open(a, "w", encoding="utf-8").write(after)
        r = subprocess.run(
            ["python3", vg, "--before", b, "--after", a, "--genre", "essay"],
            capture_output=True,
            text=True,
        )
        return r.returncode, r.stdout

    rc, _ = run_gate("문장이 하나 있다. 그대로 둔다.", "문장이 하나 있다. 그대로 둔다.")
    check("verify_gates: identical text converges with exit 0", rc == 0, f"exit={rc}")
    _, out = run_gate("이것은 단순히 A가 아니라 B다. " * 5, "B가 핵심이다. " * 5)
    check("verify_gates: detects C-8 antithesis annihilation", "전멸" in out and "5 → 0" in out)
    _, out = run_gate(
        "성능의 손잡이다. 축을 본다. 셈이다. 사실상 표준. 결이 다르다. 맞물린다.",
        "성능을 조절한다. 기준을 본다. 그렇다. 표준. 방향이 다르다. 연동된다.",
    )
    check("verify_gates: L metaphor annihilation WARN (P2b)", "P2b" in out and "전멸(물리적" in out)
    # The rc=2 ABORT path was unmeasured. Checking only 0/1 would miss a downgrade from abort to
    # warning, although that code is central to the gate.
    rc, out = run_gate(
        "첫째 문장이다. 둘째 문장이다. 셋째 문장이다. 넷째 문장이다.",
        "전혀 다른 하나. 완전히 바뀐 둘. 새로 쓴 셋. 갈아엎은 넷.",
    )
    check("verify_gates: excessive change rate ABORT exit 2", rc == 2 and "ABORT" in out,
          f"exit={rc} / ABORT {'present' if 'ABORT' in out else 'absent'}")

    # golden/checks.py: 432 lines were outside contracts. P3 calls run_checks, but the suite stayed
    # green even if it returned an empty list. Supply a minimal pair for every failure code and a
    # legitimate-rewrite control so an always-fail stub cannot satisfy the detection axis.
    sys.path.insert(0, os.path.join(HERE, "golden"))
    _golden = _need("checks", "run_checks")
    check("golden: tests/golden/checks.py provides run_checks",
          _golden is not None,
          "" if _golden else "; ".join(_broken[-1:]))
    # Keep checks when the module is absent. Nesting cases under if _golden is not None erased seven
    # checks after clearing checks.py. Disappearing tests do not count as failures; emit absence
    # verdicts.
    if True:
        GOLDEN_CASES = [
            ("legitimate rewriting passes (control)",
             "## 머리말\n\n연구를 진행하였다. 결과는 명확하다.\n",
             "## 머리말\n\n연구를 진행했다. 결과는 분명하다.\n", None),
            ("hayeot_injection", "연구를 했다. 결과는 명확하다.\n",
             "연구를 하였다. 결과는 명확하였다.\n", "hayeot_injection"),
            ("heading_lost", "## 머리말\n\n본문이다.\n", "본문이다.\n", "heading_lost"),
            ("footnote_count", "본문이다1).\n\n1) 각주 내용.\n",
             "본문이다.\n\n1) 각주 내용.\n", "footnote_count"),
            ("footnote_def", "본문이다1).\n\n1) 각주 내용.\n",
             "본문이다1).\n\n1) 전혀 다른 내용.\n", "footnote_def"),
            ("quote_altered", '그는 "정확한 인용문이 여기 있다"라고 말했다.\n',
             '그는 "부정확한 인용문이 저기 있다"라고 말했다.\n', "quote_altered"),
            ("number_injected", "매출이 늘었다.\n", "매출이 42% 늘었다.\n",
             "number_injected"),
        ]
        for _label, _before, _after, _want in GOLDEN_CASES:
            if _golden is None:
                check(f"golden: {_label}", False,
                      "tests/golden/checks.py does not provide run_checks")
                continue
            _codes = [f.code for f in _golden.run_checks(_before, _after)]
            _ok = (not _codes) if _want is None else (_want in _codes)
            check(f"golden: {_label}", _ok, f"codes={_codes}")

    # 11. req_coverage: RFP requirement-ID gate (Phase 1.5).
    rq = os.path.join(SCRIPTS, "req_coverage.py")

    def run_req(req_ids, proposal):
        rp, pp = os.path.join(tmp, "req.txt"), os.path.join(tmp, "prop.txt")
        open(rp, "w", encoding="utf-8").write(req_ids)
        open(pp, "w", encoding="utf-8").write(proposal)
        r = subprocess.run(
            ["python3", rq, "--requirements", rp, "--proposal", pp],
            capture_output=True,
            text=True,
        )
        return r.returncode, r.stdout

    rc, out = run_req("SFR-001\nSFR-002", "SFR-001은 대응한다. SFR-002도 대응한다.")
    check("req_coverage: full coverage exits 0", rc == 0, f"exit={rc}")
    rc, out = run_req("SFR-001\nSFR-002", "SFR-001만 대응한다.")
    check(
        "req_coverage: missing coverage exits 1",
        rc == 1 and "SFR-002" in out,
        f"exit={rc}",
    )
    rc, _ = run_req("SFR-001", "SFR-0011 은 다른 ID 다.")
    check(
        "req_coverage: no prefix false positive (SFR-0011 != SFR-001)", rc == 1, f"exit={rc}"
    )
    rc, _ = (
        subprocess.run(
            [
                "python3",
                rq,
                "--requirements",
                "/nonexistent",
                "--proposal",
                "/nonexistent",
            ],
            capture_output=True,
            text=True,
        ).returncode,
        None,
    )
    check("req_coverage: file errors exit 2", rc == 2, f"exit={rc}")

    # Close the KR temporary directory before reassignment.
    shutil.rmtree(tmp, ignore_errors=True)

    # 12. English validation inherited from upstream humanize-en (file ledger :215), proving the
    # English side of the taxonomy_rules.py superset replacement.
    tmp = tempfile.mkdtemp()
    cand_path = os.path.join(tmp, "c.json")
    det_path = os.path.join(tmp, "d.json")

    # EN measurement section: names remain as verdicts even if scripts are missing.
    with section(check, results, 
        '[en] lint: valid EN taxonomy passes',
        '[en] lint: missing surface FAIL',
        '[en] prescan: all metaphors EN-25–31 trigger',
        '[en] prescan: physical EN-25 (anvil) candidate identified by content',
        "[en] prescan: \\b boundary prevents heavyset false positives",
        '[en] reconcile: all candidates resolved passes',
        '[en] reconcile: poison (unresolved) FAIL',
        '[en] reconcile: hash mismatch FAIL',
        '[en] reconcile: keep without evidence FAIL',
        '[en] parser: surface/metric aliases and Korean surface fields recognized together',
        '[en] COMPUTED: EN-13 triggers and missing finding FAIL',
        '[en] prescan: EN-17 detects runtime-generated emoji',
    ):
        # 1. lint PASS / 2. lint FAIL after removing a surface.
        _, errs = lint_taxonomy.lint(EN_TAXONOMY)
        check("[en] lint: valid EN taxonomy passes", not errs, f"{len(errs)} errors")
        with open(EN_TAXONOMY, encoding="utf-8") as f:
            txt = f.read()
        corrupt = os.path.join(tmp, "corrupt.md")
        with open(corrupt, "w", encoding="utf-8") as f:
            f.write(
                re.sub(
                    r"- surface: `\(\?i\)\\b\(heavy\|heavyweight\|lightweight\)\\b`\n",
                    "",
                    txt,
                    count=1,
                )
            )
        _, cerrs = lint_taxonomy.lint(corrupt)
        check("[en] lint: missing surface FAIL", bool(cerrs), f"{len(cerrs)} detected")

        # 3. prescan metaphor-lexicon coverage.
        cand = prescan.build_candidates(EN_GOLD, EN_TAXONOMY)
        with open(cand_path, "w", encoding="utf-8") as f:
            json.dump(cand, f, ensure_ascii=False)
        rules_hit = {c["rule_id"] for c in cand["candidates"]}
        metaphor = {f"EN-{n}" for n in range(25, 32)}
        check(
            "[en] prescan: all metaphors EN-25–31 trigger",
            metaphor <= rules_hit,
            f"missing {sorted(metaphor - rules_hit)}",
        )

        # Identify physical heavy/anvil by content rather than offsets, remaining robust to gold
        # edits.
        gold_text = normalize(open(EN_GOLD, encoding="utf-8").read())
        phys = gold_text.index("heavy anvil")
        keep_ids = frozenset(
            c["candidate_id"]
            for c in cand["candidates"]
            if c["rule_id"] == "EN-25" and c["start"] == phys
        )
        check(
            "[en] prescan: physical EN-25 (anvil) candidate identified by content",
            bool(keep_ids),
            "" if keep_ids else "gold 'heavy anvil' match failed; cannot verify keep path",
        )

        # 4. No word-boundary false positives.
        binp = os.path.join(tmp, "b.txt")
        with open(binp, "w", encoding="utf-8") as f:
            f.write(
                "A monkey with heavyset build crucially delved."
            )  # Attempt heavy/crucial substring matches
        bcand = prescan.build_candidates(binp, EN_TAXONOMY)
        bad = [c["text_span"] for c in bcand["candidates"] if c["rule_id"] in ("EN-25",)]
        check("[en] prescan: \\b boundary prevents heavyset false positives", not bad, f"false positives {bad}")

        # 5. reconcile PASS
        det = build_detection(cand, keep_ids)
        with open(det_path, "w", encoding="utf-8") as f:
            json.dump(det, f, ensure_ascii=False)
        r = reconcile.reconcile(cand_path, det_path, EN_TAXONOMY, EN_GOLD)
        check(
            "[en] reconcile: all candidates resolved passes", not r["failures"], str(r["failures"][:1])
        )

        # 6/7. poison, hash
        for flag, key, label in [
            ("poison", "unresolved", "poison (unresolved) FAIL"),
            ("bad_hash", "hash", "hash mismatch FAIL"),
        ]:
            det2 = build_detection(cand, keep_ids, **{flag: True})
            with open(det_path, "w", encoding="utf-8") as f:
                json.dump(det2, f, ensure_ascii=False)
            r = reconcile.reconcile(cand_path, det_path, EN_TAXONOMY, EN_GOLD)
            check(f"[en] reconcile: {label}", any(key in x for x in r["failures"]))

        # 8. Keep without evidence FAIL; require an actual kept candidate to prevent vacuous passes.
        det3 = build_detection(cand, keep_ids)
        for k in det3["kept"]:
            k.pop("evidence", None)
        with open(det_path, "w", encoding="utf-8") as f:
            json.dump(det3, f, ensure_ascii=False)
        r = reconcile.reconcile(cand_path, det_path, EN_TAXONOMY, EN_GOLD)
        check(
            "[en] reconcile: keep without evidence FAIL",
            bool(det3["kept"]) and any("keep evidence" in x for x in r["failures"]),
        )

        # 9. Parse both surface/metric aliases and Korean 표층형/지표 fields.
        alias = os.path.join(tmp, "alias.md")
        with open(alias, "w", encoding="utf-8") as f:
            f.write(
                "# alias v1.0\n\n### AA-1. x [S2]\n- class: ANCHORED\n- surface: `foo`\n\n"
                "### AA-2. y [S2]\n- class: ANCHORED\n- 표층형: `bar`\n\n"
                "### AA-3. z [S2]\n- class: COMPUTED\n- metric: em_dash_count > 3\n"
            )
        p = parse_taxonomy(alias)
        ok = (
            p["rules"]["AA-1"]["surface"] == "foo"
            and p["rules"]["AA-2"]["surface"] == "bar"
            and p["rules"]["AA-3"]["metric"] == "em_dash_count > 3"
        )
        check("[en] parser: surface/metric aliases and Korean surface fields recognized together", ok)

        # 10. Four em dashes trigger COMPUTED; reconcile requires a corresponding finding.
        cinp = os.path.join(tmp, "emdash.txt")
        with open(cinp, "w", encoding="utf-8") as f:
            f.write("A" + " — x" * 4 + ".")  # Four em dashes trigger EN-13
        ccand = prescan.build_candidates(cinp, EN_TAXONOMY)
        # An empty taxonomy has no rules. A KeyError would erase the next 14 checks from
        # measurement; report failure instead of crashing.
        _rules = ccand["meta"].get("computed_rules", {})
        if "EN-13" not in _rules:
            check(
                "[en] taxonomy contains COMPUTED rule EN-13",
                False,
                f"computed_rules {len(_rules)}",
            )
        triggered = _rules.get("EN-13", {}).get("triggered", False)
        ccand_path = os.path.join(tmp, "cc.json")
        with open(ccand_path, "w", encoding="utf-8") as f:
            json.dump(ccand, f, ensure_ascii=False)
        # Detection without a corresponding finding -> reconcile FAIL.
        bad_det = {
            "meta": {
                "taxonomy_version": ccand["meta"]["taxonomy_version"],
                "taxonomy_hash": ccand["meta"]["taxonomy_hash"],
            },
            "findings": [],
            "kept": [],
        }
        with open(det_path, "w", encoding="utf-8") as f:
            json.dump(bad_det, f, ensure_ascii=False)
        r = reconcile.reconcile(ccand_path, det_path, EN_TAXONOMY, cinp)
        check(
            "[en] COMPUTED: EN-13 triggers and missing finding FAIL",
            triggered and any("COMPUTED" in x for x in r["failures"]),
        )

        # 11. Generate EN-17 emoji by runtime code point instead of committing emoji fixtures.
        einp = os.path.join(tmp, "emoji.txt")
        with open(einp, "w", encoding="utf-8") as f:
            f.write("The product launches in Q3 " + chr(0x1F680) + " and users love it.")
        ecand = prescan.build_candidates(einp, EN_TAXONOMY)
        check(
            "[en] prescan: EN-17 detects runtime-generated emoji",
            any(c["rule_id"] == "EN-17" for c in ecand["candidates"]),
        )

    # Close the EN temporary directory here.
    shutil.rmtree(tmp, ignore_errors=True)

    # 13. Structural contracts: SKILL.md mode branches and pipeline stop gates. Script-only tests
    # can stay green when routing is broken.
    with open(os.path.join(ROOT, "SKILL.md"), encoding="utf-8") as _f:
        sk = _f.read()
    modes = re.findall(r"(?m)^- \*\*(general|procurement|proposal|english|technical-clarity)\*\*:", sk)
    check(
        "SKILL.md: all five mode branches exist",
        len(set(modes)) == 5,
        str(sorted(set(modes))),
    )
    for mode, ref in [
        ("general", "pipeline-general.md"),
        ("procurement", "pipeline-procurement.md"),
        ("proposal", "pipeline-proposal.md"),
        ("english", "en-body.md"),
        ("technical-clarity", "asd-ste100.md"),
    ]:
        m = re.search(rf"(?m)^- \*\*{mode}\*\*:.*$", sk)
        check(f"SKILL.md: {mode} points to {ref}", bool(m) and ref in m.group(0))
        # Check the pointed-to file exists. Mere mentions allowed deletion of three references while
        # passing with three of four modes broken (reviewer reproduction).
        check(
            f"SKILL.md: {ref} exists",
            os.path.exists(os.path.join(ROOT, "references", ref)),
        )
    check("technical clarity: former skill triggers route to Humanize", all(token in sk for token in ["ASD-STE100", "Simplified Technical English", "STE로 써줘", "STE 준수 검사", "controlled technical English"]))
    check("technical clarity: all former submodes survive", all(f"`{mode}`" in sk for mode in ["strict", "rule-aligned", "principles", "audit"]))
    check("technical clarity: strict status requires official rules and dictionary", "official Issue 9 rules and controlled dictionary available" in sk)
    check("technical clarity: unverified dictionary status survives", "ASD-STE100 rule-aligned; vocabulary unverified" in sk)
    check("technical clarity: non-English compliance boundary survives", "STE-informed rewrite; not ASD-STE100 compliant" in sk)
    check("technical clarity: audit remains findings-only", "Findings only; do not rewrite" in sk)
    check("technical clarity: immutable logic and safety fields survive", all(token in sk for token in ["modality", "negation", "conditions", "safety consequence"]))
    check("technical clarity: unknown actors are not invented", "Never invent an actor" in sk)
    check("technical clarity: candidate comparison repairs semantic drift", all(token in sk for token in ["Compare the candidate", "logical scope", "safety consequence"]))
    check("technical clarity: body-only output has no appended status", "do not append a status label" in sk)
    check("technical clarity: model recollection cannot establish compliance", "A model's recollection" in sk and "cannot establish full compliance" in sk)
    check("technical clarity: certification and copyright boundaries survive", "Never describe output as certified by ASD" in sk and "Do not package, republish" in sk)
    check("technical clarity: obsolete standalone skill is absent", not os.path.exists(os.path.join(os.path.dirname(ROOT), "asd-ste100")))
    with open(
        os.path.join(ROOT, "references", "pipeline-procurement.md"), encoding="utf-8"
    ) as _f:
        pp = _f.read()
    # Treat headings structurally. Searching for words alone lets a changed heading pass from body
    # text even after losing its stop-gate identity.
    m15 = re.search(r"(?m)^## Phase 1\.5:.*stop gate.*$", pp)
    check(
        "procurement: Phase 1.5 declared as a stop gate",
        m15 is not None,
        m15.group(0)[:50] if m15 else "heading missing",
    )

    # Bind native Codex entry and actual product-checker invocation together. Execute the checker
    # battery in a subprocess so deleting SKILL.codex.md or content_contract.py fails the owning
    # suite.
    _content_test = os.path.join(HERE, "test_content_contract.py")
    _content_run = subprocess.run(
        [sys.executable, _content_test], cwd=ROOT, capture_output=True, text=True,
    )
    check(
        "native: SKILL.codex.md and actual content-contract battery",
        _content_run.returncode == 0,
        (_content_run.stdout + _content_run.stderr).strip().splitlines()[-1]
        if (_content_run.stdout + _content_run.stderr).strip() else f"exit={_content_run.returncode}",
    )
    # Search inside the Phase 1.5 body, not globally. A global search passed after changing the gate
    # to continue and leaving keywords in comments.
    sect = ""
    if m15:
        rest = pp[pp.index(m15.group(0)) :]
        nxt = re.search(r"(?m)^## ", rest[3:])
        sect = rest[: nxt.start() + 3] if nxt else rest
    check(
        "procurement: stop-gate section invokes req_coverage",
        "req_coverage.py" in sect,
        f"section of {len(sect)} characters",
    )
    check(
        "procurement: stop-gate section requires stopping on missing coverage",
        "Stop" in sect and "Exit 1" in sect,
    )

    # Auxiliary contract suites. Check each document’s owning test on two axes: passes on actual
    # source and exits nonzero with a missing target root. Without the latter, missing documents can
    # erase checks rather than fail them.
    SUBTESTS = [
        ("test_register_axis.py", "references/register-axis.md", "Register-axis contract PASS"),
        ("test_e2_exemption.py", "references/ai-tell-taxonomy.md", "E-2 exemption contract PASS"),
        ("test_noslop_exemptions.py", "references/ai-tell-taxonomy.md", "3.9 exception contract PASS"),
        ("test_gaejosik_attribution.py", "references/gaejosik.md", "Fragment-style ownership contract PASS"),
        ("test_outcomes_schema.py", "outcomes.jsonl", "Field-outcome contract PASS"),
    ]
    empty_root = tempfile.mkdtemp()
    try:
        for _name, _subject, _token in SUBTESTS:
            _path = os.path.join(HERE, _name)
            _r = subprocess.run(
                [sys.executable, _path, ROOT], capture_output=True, text=True
            )
            _tail = (_r.stderr or _r.stdout).strip().splitlines()
            check(
                f"Auxiliary contract: {_name} passes on actual source ({_subject})",
                _r.returncode == 0 and _token in _r.stdout,
                f"rc={_r.returncode} " + (_tail[-1][:90] if _tail else "no output"),
            )
            _n = subprocess.run(
                [sys.executable, _path, empty_root], capture_output=True, text=True
            )
            check(
                f"Auxiliary contract: {_name} fails closed with a missing target",
                _n.returncode != 0,
                f"rc={_n.returncode} — passing without a target is not fail-closed",
            )

        # Do auxiliary suites actually measure their targets? Presence-only stubs passed all five
        # tests by printing success for existing files and nonzero for missing ones. Require nonzero
        # on damaged document copies and passing unmodified controls to distinguish real detection
        # from broken copies. Mutations match the RED cases; the cases define the contracts.
        MUTATIONS = [
            ("test_register_axis.py", "references/register-axis.md",
             "lit", "### Case 5: ", "### Case5: ", "damage case 5 heading"),
            ("test_e2_exemption.py", "references/ai-tell-taxonomy.md",
             "re", r"(?m)^(\|\s*Itemized body[^|]*\|\s*)Exempt(\s*\|)", r"\1Applies\2",
             "change itemized-body table row from Exempt to Applies"),
            ("test_noslop_exemptions.py", "references/ai-tell-taxonomy.md",
             "lit", "proposals, official documents, or itemized writing", "official documents, or itemized writing", "remove proposals from 3.9 exclusion"),
            ("test_gaejosik_attribution.py", "references/gaejosik.md",
             "lit", "Ministry of\nthe Interior and Safety ordinance", "presidential decree", "legal hierarchy regression"),
            ("test_outcomes_schema.py", "outcomes.jsonl",
             "append", '{"run_id":"zz","사업":"x","결과":"보류","cat":{}}\n', "",
             "add outcome outside three allowed values"),
        ]
        _mwork = tempfile.mkdtemp()
        try:
            _mdst = os.path.join(_mwork, "humanize")
            shutil.copytree(
                ROOT, _mdst,
                ignore=shutil.ignore_patterns("__pycache__", "*.pyc", ".git"),
            )
            for _nm, _rel, _kind, _a, _b, _desc in MUTATIONS:
                _tp = os.path.join(_mdst, _rel)
                _sub = os.path.join(HERE, _nm)
                _orig = io.open(_tp, encoding="utf-8").read()
                _ctl = subprocess.run(
                    [sys.executable, _sub, _mdst], capture_output=True, text=True
                )
                if _kind == "lit":
                    _mut = _orig.replace(_a, _b)
                elif _kind == "re":
                    _mut = re.sub(_a, _b, _orig)
                else:
                    _mut = _orig.rstrip("\n") + "\n" + _a
                _applied = _mut != _orig
                io.open(_tp, "w", encoding="utf-8").write(_mut)
                try:
                    _rm = subprocess.run(
                        [sys.executable, _sub, _mdst], capture_output=True, text=True
                    )
                finally:
                    io.open(_tp, "w", encoding="utf-8").write(_orig)
                check(
                    f"Auxiliary contract: {_nm} detects target damage ({_desc})",
                    _ctl.returncode == 0 and _applied and _rm.returncode != 0,
                    f"control_rc={_ctl.returncode} mutation_applied={_applied} mutation_rc={_rm.returncode}",
                )
        finally:
            shutil.rmtree(_mwork, ignore_errors=True)

        # Reaudit all measurement code after discovering a surface-matching defect. Verify the
        # auditor with corrupted copies; zero findings on actual data cannot distinguish a working
        # detector from a dead one.
        AUDIT = os.path.join(SCRIPTS, "audit_measures.py")
        TAX = os.path.join(ROOT, "references", "ai-tell-taxonomy.md")
        _ra = subprocess.run(
            [sys.executable, AUDIT, "--taxonomy", TAX], capture_output=True, text=True
        )
        check(
            "Measurement reaudit: no mismatches in actual taxonomy",
            _ra.returncode == 0 and "Mismatches: 0" in _ra.stdout,
            f"rc={_ra.returncode} " + _ra.stdout.strip().replace("\n", " / ")[-90:],
        )
        _rj = subprocess.run(
            [sys.executable, AUDIT, "--taxonomy", TAX, "--json"],
            capture_output=True,
            text=True,
        )
        try:
            _rep = json.loads(_rj.stdout)
        except ValueError:
            _rep = None
        _declared = len(
            re.findall(
                r"(?m)^-\s*class:\s*ANCHORED\s*$",
                io.open(TAX, encoding="utf-8").read(),
            )
        )
        check(
            "Measurement reaudit: declared count matches taxonomy ANCHORED annotations",
            _declared > 0
            and _rep is not None
            and _rep["measurable"]["ANCHORED"] == _declared,
            f"annotations {_declared} / reported "
            + str(_rep["measurable"]["ANCHORED"] if _rep else "none"),
        )

        _dead = os.path.join(empty_root, "dead_pattern.md")
        with io.open(_dead, "w", encoding="utf-8") as f:
            f.write(
                "# 시험 분류 v9.9\n\n### Z-1. 시험 규칙\n"
                "- 예: 이 절의 어느 예문도 아래 표층형을 담지 않는다\n"
                "- class: ANCHORED\n- 표층형: `절대로나타나지않을문자열`\n"
            )
        _rd = subprocess.run(
            [sys.executable, AUDIT, "--taxonomy", _dead, "--json"],
            capture_output=True,
            text=True,
        )
        try:
            _kinds = [f["kind"] for f in json.loads(_rd.stdout)["findings"]]
        except (ValueError, KeyError):
            _kinds = []
        check(
            "Measurement reaudit: detects dead surfaces in corrupted copies",
            _rd.returncode == 1 and "죽은표층형" in _kinds,
            f"rc={_rd.returncode} kinds={_kinds}",
        )

        _ov = os.path.join(empty_root, "overlap.md")
        with io.open(_ov, "w", encoding="utf-8") as f:
            f.write(
                "# 시험 분류 v9.9\n\n### Z-1. 시험 규칙 하나\n"
                "- 예: 그런 것이다 라고 끝난다\n- class: ANCHORED\n- 표층형: `것이다`\n"
                "\n### Z-2. 시험 규칙 둘\n"
                "- 예: 그런 것이다 라고 끝난다\n- class: ANCHORED\n- 표층형: `그런 것이다`\n"
            )
        _rv = subprocess.run(
            [sys.executable, AUDIT, "--taxonomy", _ov, "--json"],
            capture_output=True,
            text=True,
        )
        try:
            _kinds2 = [f["kind"] for f in json.loads(_rv.stdout)["findings"]]
        except (ValueError, KeyError):
            _kinds2 = []
        check(
            "Measurement reaudit: detects surface overlaps between rules",
            "표층형겹침" in _kinds2,
            f"kinds={_kinds2}",
        )

        # Only one of five FAIL_KINDS axes was measured (dead surface). The other four could
        # disappear, FIELD_RE could be removed, or branches folded to constants while staying green.
        # Create a corrupted copy triggering each axis alone.
        AUDIT_AXES = [
            ("계측밖필드",
             "### Z-1. 시험 규칙\n- 예: 그런 것이다 라고 끝난다\n"
             "- class: HOLISTIC\n- 표층형: `것이다`\n"),
            ("도달불가대안",
             "### Z-1. 시험 규칙\n- 예: 그런 것이다 라고 끝난다\n"
             "- class: ANCHORED\n- 표층형: `것이|것이다`\n"),
            ("면제사유부실",
             "### Z-1. 시험 규칙\n- 예: 아무 예문도 아니다\n"
             "- class: ANCHORED\n- 표층형: `절대로나타나지않을문자열`\n"
             "- 재감사: 짧음\n"),
            ("미측정지표",
             "### Z-1. 시험 규칙\n- 예: 아무 예문\n"
             "- class: COMPUTED\n- 지표: 없는지표 > 0.5\n"),
        ]
        for _axis, _bodytxt in AUDIT_AXES:
            _fp = os.path.join(empty_root, f"axis_{_axis}.md")
            with io.open(_fp, "w", encoding="utf-8") as f:
                f.write("# 시험 분류 v9.9\n\n" + _bodytxt)
            _ax = subprocess.run(
                [sys.executable, AUDIT, "--taxonomy", _fp, "--json"],
                capture_output=True, text=True,
            )
            try:
                _ak = [f["kind"] for f in json.loads(_ax.stdout)["findings"]]
            except (ValueError, KeyError):
                _ak = []
            check(
                f"Measurement reaudit: detects {_axis} in a corrupted copy",
                _ax.returncode == 1 and _axis in _ak,
                f"rc={_ax.returncode} kinds={_ak}",
            )
    finally:
        shutil.rmtree(empty_root, ignore_errors=True)

    # Self-check the defect class directly: run this suite on body-deleted copies and require
    # failures. Regex lint could not prevent semantic bypasses. Minimums are measured; setting one
    # would pass after four contracts died. Update counts for legitimate contract changes. Give
    # every reference its own contract and nonzero per-file floor; nine references previously lacked
    # measurement. Choose needles not inferable from filenames: asking for a caption word in
    # caption-headnouns.md was tautological. Bind values the document must retain: thresholds, set
    # members, sources, and gate conditions.
    REF_CONTRACTS = [
        ("asd-ste100.md", "Adaptable STE baseline and Korean boundary", ['not as a mandatory style filter.', 'Do not apply the 20-word and 25-word English limits', 'controlled dictionary'], 7215),
        (
            "ai-tell-taxonomy.md",
            "A–J categories, rule classes, and severity criteria",
            ["Rule classes", "Severity", "A-1", "Translationese", "S1", "S2"],
            45805,
        ),
        (
            "pipeline-procurement.md",
            "Phase 1.5 requirement-traceability stop gate",
            ["Phase 1.5", "stop gate", "traceability", "Phase 3"],
            5324,
        ),
        (
            "caption-headnouns.md",
            "Closed head-noun set and forbidden endings",
            ["매트릭스", "로드맵", "내역", "차별점", "Disallowed endings outside the set"],
            4012,
        ),
        (
            "empirical-validation.md",
            "Log-likelihood test design and corpus cutoff date",
            ["로그우도", "3.84", "2022-01-01", "Dunning"],
            7120,
        ),
        (
            "direct.md",
            "Default one-pass editing contract",
            ["Selection", "One-pass boundary", "Never invent a fact", "Return only the edited artifact"],
            7000,
        ),
        (
            "clean-rewrite.md",
            "Bounded inventory and exact-target conditional-write gate",
            [
                "Use two independently evidenced\nsearches",
                "Commit a verified candidate only through a trusted conditional-write adapter",
                "do not write, merge, or roll back",
            ],
            2700,
        ),
        (
            "debloat.md",
            "Claim-preserving compression and cross-artifact boundary",
            [
                "load-bearing claims and rules",
                "cross-artifact duplication as a separate source-of-truth task",
                "A lower word count\ndoes not prove improvement.",
            ],
            1400,
        ),
        (
            "reorder.md",
            "Byte-exact move-only permutation and multiplicity checks",
            [
                "multiset of unit identities",
                "Apply one stable permutation",
                "Move the whole\nunit byte-for-byte",
            ],
            1800,
        ),
        (
            "en-body.md",
            "English-mode pattern body",
            ["Undue Emphasis", "Promotional", "soulless"],
            27154,
        ),
        ("en-taxonomy.md", "EN rule definitions", ["EN-1", "surface"], 9887),
        (
            "pipeline-general.md",
            "Phase 3.5 structural convergence gate and abort threshold",
            ["Phase 3.5", "over_polish_warning", "Exit 2", "50%"],
            7322,
        ),
        (
            "pipeline-proposal.md",
            "Przeworski framework and review modes",
            ["Przeworski", "full-review", "section-review", "targeted"],
            5730,
        ),
        (
            "procurement-playbook.md",
            "Change-rate thresholds and replacement recipe format",
            ["25%", "40%", "[전]", "[후]", "K-1"],
            6931,
        ),
        (
            "procurement-taxonomy.md",
            "All K–O categories and severity",
            ["K-1", "K-5", "L.", "S1", "S2"],
            14603,
        ),
        (
            "rewriting-playbook.md",
            "Prime directives and change-rate SSOT",
            ["verify_gates.py", "change_rate", "50%", "Remove only; no new tells"],
            10070,
        ),
        # Use whole-sentence needles for the next six references. Single words survive added
        # negation and cannot detect reversed contracts.
        (
            "register-axis.md",
            "Three registers, classifiers, and falsification conditions",
            [
                "Different verdicts on identical text in different registers are expected.",
                "If\nautomatic register classification falls below 90% accuracy on a paragraph sample,\nthis axis is impractical.",
                "Exemption does not delete the rules.",
            ],
            4321,
        ),
        (
            "register-invariants.md",
            "Mutable/immutable boundary and four-step delta audit",
            [
                "A statement alone\ncannot enforce that principle; it needs an audit procedure.",
                "If a delta touches any immutable item, roll back that edit.",
                "Neither discard nor pass them; passing an unassignable\n   change would defeat the audit.",
            ],
            2740,
        ),
        (
            "gaejosik.md",
            "Level thresholds, scope limits, and legal hierarchy",
            [
                "These medians describe practice in the 15-report sample, not regulations.",
                "The enforcement rule is a **Ministry of\nthe Interior and Safety ordinance**, not a presidential decree.",
                "This file alone owns the fragment-style thresholds.",
            ],
            3115,
        ),
        (
            "improvement-protocol.md",
            "Blind pair comparisons and promotion procedure",
            [
                "Exclude pairs with broken blinding and retain the reason.",
                "Make no judgment with fewer than 5 valid pairs.",
                "The re-audit measures gaps between declarations and observations. It is not a\nrule-passing tool.",
            ],
            3873,
        ),
        (
            "code-space.md",
            "Code-namespace separation and provisional status",
            [
                "**Unprefixed `[A-Z]-\\d+` codes have an unresolved namespace.**",
                "A code absent from the allocation table has not been issued.",
                "Prefixes resolve identifier collisions. Rules can still issue opposite decisions\non the same paragraph: giving them different names does not resolve that conflict.",
            ],
            2002,
        ),
        (
            "taxonomy-codespace.md",
            "Namespace allocations and counting criteria",
            [
                "A code absent from the\nallocation table has not been issued.",
                "Count rule headings, not body citations,",
                "The density ledger's `C-14` and the taxonomy's `C-14` refer to different things.",
            ],
            1866,
        ),
    ]
    check_ref_contracts(check, ROOT, REF_CONTRACTS)

    # Measured per-file floors prevent aggregate cancellation (A loses contracts while B gains them)
    # and masking of unmeasured files. Zero is prohibited; declaring a reference without contracts
    # fails immediately.

    # Reject constant verdicts. Review seven exposed ... if cond else True checks, invisible to
    # casual review and silent at runtime. Scan the AST.
    # Check eval answers against actual taxonomy. Fixed K–O item counts become silently wrong after
    # taxonomy edits, causing a correct with-skill answer to fail.
    crit_path = os.path.join(
        os.path.dirname(os.path.dirname(ROOT)),
        "evals",
        "regression",
        "humanize-taxonomy-recall",
        "graders",
        "criteria.md",
    )
    check("eval: discrimination-case criteria exist", os.path.isfile(crit_path))
    if os.path.isfile(crit_path):
        crit = io.open(crit_path, encoding="utf-8").read()
        tax_p = io.open(
            os.path.join(ROOT, "references", "procurement-taxonomy.md"),
            encoding="utf-8",
        ).read()
        real = {
            L: len({i for i in re.findall(rf"\b({L}-\d+)\b", tax_p)}) for L in "KLMNO"
        }
        # The final table cell is the count. Fail here on format changes so expected answers cannot
        # become silently stale.
        declared = dict(re.findall(r"(?m)^\| ([K-O]) \|.*\| (\d+) \|\s*$", crit))
        check(
            "eval: criteria item counts match actual taxonomy",
            {k: int(v) for k, v in declared.items()} == real,
            f"criteria {declared} / actual {real}",
        )

    # Needle-only skeletons passed after deleting 67–85% of body text. Line survival, volume, and
    # blob binding catch this.
    check_skill_body(
        check,
        ROOT,
        needles=[
            "## Default direct execution",
            "return only the\nedited artifact",
            "Semantic preservation takes precedence.",
            "Warn or stop when the edit-rate threshold is exceeded;",
            "Identify language\nbefore genre:",
            "Preserve genre;",
        ],
        floor=3017,
    )

    check_upstream_parity(check)

    check_no_constant_assertions(check, __file__)

    # Measure once for all three axes; scattered copies can drift and create slack.
    live_ran = sum(
        1
        for r in results
        if not r[0].startswith(("자기검사:", "계약 커버리지:", "스크립트 계약:"))
    )

    check_contract_coverage(
        check,
        __file__,
        ROOT,
        per_file={
            # Upstream frozen-byte manifest: clearing it would permit replacing the frozen copy with
            # ours and reducing parity to ours >= ours.
            "UPSTREAM.sha256": 3,
            "SKILL.md": 27,
            "SKILL.codex.md": 1,
            "references/asd-ste100.md": 3,
            "references/ai-tell-taxonomy.md": 17,
            "references/direct.md": 4,
            "references/clean-rewrite.md": 3,
            "references/debloat.md": 3,
            "references/reorder.md": 3,
            "references/caption-headnouns.md": 3,
            "references/empirical-validation.md": 3,
            "references/en-body.md": 3,
            "references/en-taxonomy.md": 11,
            "references/pipeline-general.md": 3,
            "references/pipeline-procurement.md": 7,
            "references/pipeline-proposal.md": 3,
            "references/procurement-playbook.md": 3,
            "references/procurement-taxonomy.md": 9,
            "references/rewriting-playbook.md": 3,
            "references/register-axis.md": 5,
            "references/register-invariants.md": 3,
            "references/gaejosik.md": 5,
            "references/improvement-protocol.md": 3,
            "references/code-space.md": 3,
            "references/taxonomy-codespace.md": 3,
        },
        live_ran=live_ran,
    )

    check_body_deletion(
        check,
        __file__,
        ROOT,
        minimum=51,
        extra_strip=[
            "references/clean-rewrite.md",
            "references/debloat.md",
            "references/pipeline-general.md",
            "references/pipeline-procurement.md",
            "references/pipeline-proposal.md",
            "references/en-body.md",
            "references/reorder.md",
        ],
        live_ran=live_ran,
    )

    # Script contract axis: actual checks broken by clearing each script, with measured zero-slack
    # floors. The previous seven values (1/3/3/3/1/1/4) counted missing-script gate messages because
    # main returned early. Recording missing checks via _Section yielded 24/34/38/39/20/14/35.
    check_script_contracts(
        check,
        __file__,
        ROOT,
        scripts={
            "scripts/lint_taxonomy.py": 24,
            "scripts/metrics_v1.py": 38,
            "scripts/metrics_v2.py": 39,
            "scripts/metrics.py": 34,
            "scripts/prescan.py": 20,
            "scripts/reconcile.py": 14,
            "scripts/audit_measures.py": 8,
            "scripts/req_coverage.py": 3,
            "scripts/taxonomy_rules.py": 35,
            "scripts/verify_gates.py": 4,
            # Include five auxiliary tests and the golden checker in the population. These six
            # previously lacked a verdict-count axis when emptied; clearing one must fail every
            # verdict it owns.
            "tests/test_register_axis.py": 3,
            "tests/test_e2_exemption.py": 3,
            "tests/test_noslop_exemptions.py": 3,
            "tests/test_gaejosik_attribution.py": 3,
            "tests/test_outcomes_schema.py": 3,
            "tests/golden/checks.py": 10,
            # Data consumed by contracted scripts: measured floors. Empty baseline.json adds four
            # failures and baseline_v2.json adds two (13/11 vs nine from an empty SKILL.md
            # baseline). Before these axes, both added zero despite removing 6KB/13KB of decision
            # thresholds.
            "scripts/baseline.json": 4,
            "scripts/baseline_v2.json": 2,
        },
        live_ran=live_ran,
    )

    # Calibration baseline axis: metrics_v1.py reads baseline.json and metrics_v2.py reads
    # baseline_v2.json. Scripts had contracts (38/39 above) but their data did not. Clearing all of
    # baseline.json added zero failures over the empty-SKILL baseline of nine, silently removing 6KB
    # of decision thresholds. A contracted script reading uncontracted data is only half covered.
    _bl_dir = os.path.join(ROOT, "scripts")
    try:
        _bl = json.loads(
            open(os.path.join(_bl_dir, "baseline.json"), encoding="utf-8").read()
        )
    except (OSError, ValueError):
        _bl = {}
    check("Baseline: baseline.json parses as JSON", bool(_bl))
    check(
        "Baseline: version exists to identify measurement provenance",
        bool(_bl.get("version")) and bool(_bl.get("source")),
        f"version={_bl.get('version')}",
    )
    # Genre values are decision inputs; removing a genre silently removes its decisions.
    _genres = _bl.get("genres") or {}
    check(
        "Baseline: six genres exist (essay/poetry/abstract/news/qa/blog)",
        len(_genres) == 6 and "essay" in _genres and "blog" in _genres,
        f"{sorted(_genres)}",
    )
    check(
        "Baseline: z-score decision thresholds declared",
        bool((_bl.get("z_score_thresholds") or {}).get("high_risk")),
    )
    try:
        _bl2 = json.loads(
            open(os.path.join(_bl_dir, "baseline_v2.json"), encoding="utf-8").read()
        )
    except (OSError, ValueError):
        _bl2 = {}
    check("Baseline: baseline_v2.json parses as JSON", bool(_bl2))
    # Check the file’s declared invariant: all cells carry _placeholder: true; the Phase 6
    # integrator must retain flags except on calibrated cells. No check previously enforced that
    # promise.
    check(
        "Baseline: v2 placeholder flags preserved (declared invariant)",
        json.dumps(_bl2, ensure_ascii=False).count('"_placeholder": true') >= 70,
        f"{json.dumps(_bl2, ensure_ascii=False).count('\"_placeholder\": true')}개",
    )

    # Lock the total count. Review 10 deleted a reference together with its
    # contracts, floors, and frozen copy, losing four checks without failure.
    check_total(check, results, 208)
    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n{passed}/{len(results)} 통과")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
