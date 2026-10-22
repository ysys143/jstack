#!/usr/bin/env python3
"""Research regression suite.

Run python3 tests/run_tests.py from skills/research.

Protect two independently enforced checks without external tools. A wrapper-only
plugin leaves users without upstream unable to act. Execute both checkers on
fixtures, verify complete citation coverage without sampling, enforce paired
roles and timing for the self-contained default, retain Korean primary sources
absent upstream, and compare upstream evidence when that package is installed.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
from _suite_lib import (check_no_constant_assertions, check_total, check_skill_body,
                        check_ref_contracts, split_frontmatter, check_script_contracts,
                        check_body_deletion, check_contract_coverage)  # noqa: E402
ROOT = os.path.dirname(HERE)
SCRIPTS = os.path.join(ROOT, "scripts")
CITE = os.path.join(SCRIPTS, "cite_check.py")
COV = os.path.join(SCRIPTS, "coverage_matrix.py")

results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))


def read(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


def run(script, *args):
    r = subprocess.run([sys.executable, script, *args], capture_output=True, text=True)
    return r.returncode, r.stdout + r.stderr


def main():
    skill_all = read(os.path.join(ROOT, "SKILL.md"))
    fm, skill = split_frontmatter(skill_all)
    notice = read(os.path.join(ROOT, "NOTICE"))
    cite_md = read(os.path.join(ROOT, "references", "cite-check.md"))
    kr = read(os.path.join(ROOT, "references", "kr-sources.md"))
    tier = read(os.path.join(ROOT, "references", "tier-profile.md"))

    tmp = tempfile.mkdtemp()

    # (1) Self-contained checks must produce actual judgments on fixtures;
    # a documentation claim does not demonstrate detection.
    bad = os.path.join(tmp, "bad.md")
    with open(bad, "w", encoding="utf-8") as f:
        f.write("# 보고서\n\n## 요약\n\n"
                "시장은 200조다 [1]. 비중이 늘었다 [2]. 전환이 동인이다 [7].\n\n"
                "## 출처\n\n"
                "[1] 조달청 통계 — https://pps.go.kr/x\n"
                "[2] 진흥원 보고서\n"
                "[3] 미사용 — https://example.org\n")
    rc, out = run(CITE, bad)
    check("Self-contained: cite_check rejects an invalid report", rc == 1, f"rc={rc}")
    for kind, why in (("MISSING", "Citation absent from source list"),
                      ("UNUSED", "Uncited source"),
                      ("UNRESOLVED", "Source without identifier")):
        check(f"Self-contained: cite_check detects {kind} ({why})", f"[{kind}]" in out)

    good = os.path.join(tmp, "good.md")
    # Use four citations. A single citation survives any sampling rate, so the
    # previous one-item fixture could not detect introduced sampling.
    with open(good, "w", encoding="utf-8") as f:
        f.write("# 보고서\n\n## 요약\n\n"
                "시장은 200조다 [1]. 비중이 늘었다 [2].\n\n"
                "전환이 동인이다 [3]. 규제가 변수다 [4].\n\n"
                "## 출처\n\n"
                "[1] 조달청 통계 — https://pps.go.kr/x\n"
                "[2] 진흥원 보고서 — https://nipa.kr/y\n"
                "[3] 클라우드 백서 — https://example.org/z\n"
                "[4] 법령 — https://law.go.kr/w\n")
    rc_g, _ = run(CITE, good)
    check("Self-contained: cite_check accepts a valid report (no over-detection)", rc_g == 0,
          f"rc={rc_g}")

    # Count emitted pairs to verify complete coverage rather than sampling.
    pairs_out = os.path.join(tmp, "p.jsonl")
    run(CITE, good, "--pairs", pairs_out)
    # Missing output must not kill the suite. Emptying the checker prevented
    # --pairs output, causing FileNotFoundError and erasing 88 later judgments.
    # Failure-only fails >= 4 still passed; the disappearance guard measured
    # 5 copy judgments versus 93 live. Count missing output as zero pairs so
    # this judgment fails and later judgments survive.
    _pairs_txt = read(pairs_out) if os.path.exists(pairs_out) else ""
    n_pairs = len([l for l in _pairs_txt.splitlines() if l.strip()])
    check("Self-contained: cite_check exports every citation without sampling", n_pairs == 4,
          f"{n_pairs} pairs / 4 citations; fewer pairs indicate introduced sampling")

    req = os.path.join(tmp, "req.txt")
    with open(req, "w", encoding="utf-8") as f:
        f.write("REQ-001  인증은 SSO 를 지원한다\nREQ-002  로그 1년 보관\n"
                "REQ-003  이중화\n")
    prop = os.path.join(tmp, "prop.md")
    with open(prop, "w", encoding="utf-8") as f:
        f.write("# 제안\n\nREQ-001 " + "가" * 300 + "\n\nREQ-002 짧음.\n\n"
                "REQ-009 목록에 없음.\n")
    rc2, out2 = run(COV, "--req", req, "--report", prop)
    check("Self-contained: coverage_matrix rejects an invalid deliverable", rc2 == 1, f"rc={rc2}")
    for kind, why in (("MISSING", "Missing requirement"), ("THIN", "Response too short"),
                      ("ORPHAN", "ID absent from list")):
        check(f"Self-contained: coverage_matrix detects {kind} ({why})", f"[{kind}]" in out2)

    # (2) Complete verification: no sampling code in our script.
    cite_src = read(CITE)
    for banned in ("sample_rate", "keep_every"):
        check(f"Full coverage: our script contains no {banned}", banned not in cite_src.split('"""')[2]
              if cite_src.count('"""') >= 3 else banned not in cite_src,
              "Sampling cannot establish procurement citation reliability")
    check("Full coverage: script discloses no sampling", "no sampling" in cite_src)
    check("Full coverage: SKILL.md explains why",
          "checking an unknown half cannot establish reliability of the rest" in skill)

    # (2b) Ensure tools at the point of need, without installing everything
    # beforehand. Research alone does not require gws OAuth, nor the reverse.
    ENSURE = os.path.join(SCRIPTS, "ensure_research.sh")
    check("ensure: availability script exists", os.path.exists(ENSURE))
    r = subprocess.run(["bash", ENSURE], capture_output=True, text=True)
    check("ensure: exit code is within the contract (0/1/2)", r.returncode in (0, 1, 2),
          f"rc={r.returncode}")
    check("ensure: checks both self-contained checkers",
          "cite_check.py" in r.stdout and "coverage_matrix.py" in r.stdout)
    # Disclose the self-contained default. Exit 1 means partial failure in
    # other skills but is normal here; the output must explain the distinction.
    src_en = read(ENSURE)
    check("ensure: exit 1 is disclosed as the normal default",
          "normal default" in src_en)
    check("ensure: does not install on the user's behalf", "uv tool install hyperresearch" in src_en
          and "install" not in src_en.split("uv tool install hyperresearch")[0][-200:]
          .replace("설치", ""))

    # (3) Boundaries: self-contained execution must be default and always available.
    rows = {}
    for m in re.finditer(r"(?m)^\|\s*\*{0,2}([가-힣A-Za-z][^|*]*?)\*{0,2}\s*\|"
                         r"\s*`([^`]+)`\s*\|([^|]*)\|\s*`([^`]+)`", skill):
        rows[m.group(1).strip()] = {"role": m.group(2), "needs": m.group(3).strip(),
                                    "when": m.group(4)}
    check("Boundary: path table is readable", len(rows) >= 2, f"{sorted(rows)}")
    n_default = sum(1 for r in rows.values() if r["role"] == "기본")
    check("Boundary: exactly one `기본` role", n_default == 1, f"{n_default} defaults")
    self_row = rows.get("자립", {})
    check("Boundary: self-contained path has role `기본`", self_row.get("role") == "기본",
          self_row.get("role", "Row absent"))
    check("Boundary: self-contained path timing is `상시`", self_row.get("when", "").startswith("상시"),
          self_row.get("when", "Row absent"))
    check("Boundary: self-contained path has no prerequisites", "None" in self_row.get("needs", ""),
          self_row.get("needs", "Row absent"))
    up_row = rows.get("hyperresearch", {})
    check("Boundary: upstream path has role `선택`", up_row.get("role") == "선택",
          up_row.get("role", "Row absent"))
    check("Boundary: upstream timing begins with `조건:`",
          up_row.get("when", "").startswith("조건:"), up_row.get("when", "Row absent"))

    skills_dir = os.path.dirname(ROOT)
    NAME = r"(?<![\w-])[`*]{0,2}([a-z][a-z-]{2,})[`*]{0,2}\s*skill\b"
    referred = sorted(set(re.findall(NAME, skill)))
    missing = [n for n in referred if not os.path.isdir(os.path.join(skills_dir, n))]
    check("Boundary: handoff destination population is nonempty", len(referred) >= 3, f"{referred}")
    check("Boundary: all handoff destinations exist", not missing, f"missing {missing}")

    # (4) Korean source lens: count table rows, not words anywhere in prose.
    # Deleting a row previously passed because its name remained elsewhere.
    # Extract only the first column, removing bold/link/parenthetical markup.
    listed = set()
    for line in kr.splitlines():
        if not line.lstrip().startswith("|"):
            continue
        cell = line.strip().strip("|").split("|")[0]
        cell = re.sub(r"\*{1,2}|`", "", cell)
        cell = re.sub(r"\([^)]*\)", "", cell).strip()
        if cell and cell not in ("Source", "---"):
            listed.add(cell)
    for src in ("나라장터", "조달청", "온비드", "알리오", "DART", "RISS", "KCI",
                "ScienceON", "NTIS", "KOSIS"):
        check(f"Source lens: {src} is listed in a table",
              any(src in l for l in listed), f"{len(listed)} table rows")
    check("Source lens: discloses zero upstream matches (grep 0)", "grep 0" in kr)
    check("Source lens: discloses absent automated lookup paths",
          "A person must retrieve" in kr and "do not invent" in kr)
    # A source list without tiers leaves citation priority undefined. Citing
    # tertiary reporting for the same fact is more common than using unlisted sources.
    grades = sorted(c for c in listed if re.match(r"^(?:Primary|Secondary|Tertiary)\b", c))
    check("Source lens: evidence has four tiers", len(grades) == 4, f"{grades}")
    check("Source lens: forbids substitution with lower-tier evidence",
          "Do not replace higher-tier evidence with lower-tier material" in kr)
    check("Source lens: forbids figures without reference dates",
          "Do not cite figures without a reference date" in kr)

    # (5) Upstream profile: require all three axes enabled. Turn parse errors
    # into judgments rather than exceptions erasing the remaining checks.
    raw_contract = read(os.path.join(ROOT, "wrapper_contract.json"))
    contract, parse_err = {}, ""
    try:
        contract = json.loads(raw_contract)
    except json.JSONDecodeError as e:
        parse_err = str(e)[:60]
    check("Upstream contract: wrapper_contract.json is valid JSON",
          isinstance(contract, dict) and bool(contract), parse_err or "Empty object")
    req_axes = contract.get("required_axes", {})
    check("Upstream contract: three required axes", len(req_axes) == 3, f"{sorted(req_axes)}")
    check("Upstream contract: all three axes are enabled",
          all(v.get("on") is True for v in req_axes.values()))
    check("Upstream contract: cite-check sample_rate is raised to 1.0",
          req_axes.get("step_14_5_cite_check", {}).get("sample_rate") == 1.0)
    n_tier = len(re.findall(r'"tier"', raw_contract))
    check("Upstream contract: no tier key (honors override prohibition)", n_tier == 0, f"{n_tier} keys")
    check("Upstream contract: states evidence limits (profile tuning is vibes)",
          "profile tuning is vibes" in skill)
    check("Upstream contract: requires our checks even with upstream",
          "rerun our own Phase 4 checks" in skill)

    # (5b) Cross-check the jstack-lite table and configuration. Table-only checks
    # accept contradictory configuration; configuration-only checks lose the
    # rationale. Binding both requires coordinated edits.
    prof = {}
    for line in tier.splitlines():
        if not line.lstrip().startswith("|"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) >= 3:
            key = re.sub(r"[`*]", "", cells[0]).strip()
            prof[key] = re.sub(r"[`*]", "", cells[2]).strip()
    check("tier: Profile table is readable", len(prof) >= 9, f"{len(prof)} rows")
    check("tier: discards the lite default explicitly", "Discard that default" in tier)
    CRITICS = ("instruction", "dialectic", "depth", "width")
    for c in CRITICS:
        row = prof.get(f"step 12 {c}-critic", "")
        check(f"tier: {c}-critic is retained (upstream light skips all)",
              row.startswith("Retained"), row or "Table row absent")
    models = {c: prof.get(f"step 12 {c}-critic", "").split("·")[-1].strip()
              for c in CRITICS}
    check("tier: critics do not all share one model tier",
          len(set(models.values())) >= 2, f"{models}")
    check("tier: only instruction-critic uses opus", models.get("instruction") == "opus"
          and all(models[c] == "sonnet" for c in CRITICS if c != "instruction"),
          f"{models}")
    check("tier: source_target is 20-50 (draft-orchestrator contract)",
          prof.get("step 10 source_target") == "20-50",
          prof.get("step 10 source_target", "Table row absent"))
    check("tier: inherits CJK length limits (800 / 1500)",
          prof.get("Paragraph length (CJK)") == "800 characters"
          and prof.get("Paragraph length (English)") == "1500 characters",
          f"{prof.get('Paragraph length (CJK)')} / {prof.get('Paragraph length (English)')}")
    check("tier: identifies the length unit by upstream symbol",
          "char_targets_no_word_boundary" in tier)
    check("tier: declares selection of steps rather than a tier",
          "a set of steps, not a tier" in tier)
    check("tier: SKILL.md names this document as canonical",
          "references/tier-profile.md" in skill)

    # (5c) Actually compare the declared third-column contract with configuration.
    opt = contract.get("optional_axes", {})
    for c in CRITICS:
        ax = (req_axes if c == "instruction" else opt).get(f"step_12_{c}_critic", {})
        check(f"tier: configuration enables {c}-critic (matching documentation)",
              ax.get("on") is True, f"{ax.get('on')}")
        check(f"tier: configured {c}-critic model matches documentation",
              ax.get("model") == models.get(c),
              f"configured {ax.get('model')} / documented {models.get(c)}")
    budgets = contract.get("budgets", {})
    check("tier: configured source_target matches documentation",
          budgets.get("step_10_source_target") == prof.get("step 10 source_target"),
          f"{budgets.get('step_10_source_target')}")
    check("tier: configured paragraph lengths match the CJK table",
          budgets.get("step_16_paragraph_chars_cjk") == 800
          and budgets.get("step_16_paragraph_chars_en") == 1500,
          f"{budgets.get('step_16_paragraph_chars_cjk')} / "
          f"{budgets.get('step_16_paragraph_chars_en')}")
    check("tier: triple-draft remains disabled (triple cost)",
          opt.get("step_10_triple_draft", {}).get("on") is False
          and prof.get("step 10 triple-draft") == "Disabled",
          f"configuration {opt.get('step_10_triple_draft', {}).get('on')} / "
          f"documented {prof.get('step 10 triple-draft')}")

    # (6) Compare installed upstream code when present to detect stale rationale.
    up = shutil.which("hyperresearch")
    if up:
        import glob
        hits = glob.glob(os.path.expanduser(
            "~/.local/share/uv/tools/hyperresearch/lib/python*/site-packages/"
            "hyperresearch/core/citecheck.py"))
        src = read(hits[0]) if hits else ""
        check("자기검사: upstream formula matches our document (round(1/x))",
              "round(1 / sample_rate)" in src,
              "Update cite-check.md if upstream changes its rounding rule")

    check("Provenance: NOTICE identifies MIT and the version", "MIT" in notice and "v0.10.0" in notice)

    check_skill_body(check, ROOT, needles=[
        "| **자립** | `기본` |", "checking an unknown half cannot establish reliability of the rest",
        "profile tuning is vibes", "나라장터", "deliverables/",
        "cite_check.py", "coverage_matrix.py",
        "references/tier-profile.md",
    ], floor=4076)

    check_ref_contracts(check, ROOT, [
        ("kr-sources.md", "Korean primary-source tiers and access rules",
         ["나라장터", "DART", "KCI", "grep 0", "notice or project IDs",
          "Research for Korean procurement proposals must consult 나라장터",
          "Do not replace higher-tier evidence with lower-tier material; disclose any\nsubstitution",
          "Do not cite figures without a reference date"], 2919),
        ("tier-profile.md", "jstack-lite profile and rationale for restored axes",
         ["Light skips every step 12 critic, including instruction-critic",
          "Structural blind spots shared\nby an all-opus panel can pass all four reviews",
          "Light's source_target of 15-25 falls below the draft-orchestrator contract of\n20-50",
          "Our use is exactly CJK, yet this was absent from the inheritance list",
          "char_targets_no_word_boundary", "must_read_note_ids", "HANDOFF.md:438"],
         3641),
        ("cite-check.md", "Full verification and upstream stepwise behavior",
         ["round(1 / sample_rate)", "two on/off levels", "every pair", "Machine"], 2086),
    ])

    check_contract_coverage(check, __file__, ROOT, per_file={
        "SKILL.md": 20, "NOTICE": 1, "wrapper_contract.json": 14,
        "references/kr-sources.md": 19, "references/cite-check.md": 3,
        "references/tier-profile.md": 23,
    }, live_ran=sum(1 for r in results
                    if not r[0].startswith(("자기검사:", "계약 커버리지:"))))

    check_body_deletion(check, __file__, ROOT, minimum=20,
                        live_ran=sum(1 for r in results
                                     if not r[0].startswith(("자기검사:", "계약 커버리지:"))))
    # Integrator lock (2026-09-02): two unprotected axes demonstrated by the contributor.
    _tp = read(os.path.join(ROOT, "references", "tier-profile.md"))
    _crit = [
        ln
        for ln in _tp.splitlines()
        if ln.startswith("|") and "critic" in ln and ("Skipped" in ln or "Retained" in ln)
    ]
    check("Profile: four critic rows have skipped/retained columns", len(_crit) == 4, f"{len(_crit)} rows")
    check(
        "Profile: every upstream critic value is skipped",
        bool(_crit) and all("Skipped" in ln for ln in _crit),
        str([ln[:40] for ln in _crit if "Skipped" not in ln]),
    )
    _kr2 = read(os.path.join(ROOT, "references", "kr-sources.md"))
    check("Tier: sentence directs citation of higher-tier evidence", "cite the higher tier" in _kr2)

    # Measure script contracts last. Earlier calls counted only preceding live
    # judgments while copies ran the full suite, creating unearned slack: two
    # profile checks and one tier check were exactly that gap. Exclude the
    # script-contract prefix on both sides because the helper returns early
    # in deletion copies. Identical exclusions preserve zero slack.
    _OFF = ("자기검사:", "계약 커버리지:", "스크립트 계약:")
    check_script_contracts(check, __file__, ROOT, scripts={
        # Six is measured with zero slack. Four came from a crash at the fifth
        # judgment; fixing the crash exposed two additional failures.
        "scripts/cite_check.py": 6,
        "scripts/ensure_research.sh": 3,
        "scripts/coverage_matrix.py": 4,
    }, live_ran=sum(1 for r in results if not r[0].startswith(_OFF)),
        extra_skip=("스크립트 계약:",))

    check_no_constant_assertions(check, __file__)
    check_total(check, results, 108 + int(bool(up)))

    shutil.rmtree(tmp, ignore_errors=True)
    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n{passed}/{len(results)} 통과")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
