#!/usr/bin/env python3
"""plan contract suite.

Run: python3 tests/run_tests.py   (from skills/plan)

## What this locks

1. **Verifiable acceptance criteria** — the whole worth of the spec. "Works well"
   passing as a criterion is the failure this skill exists to prevent.
2. **The stop instruction** — "do not proceed while ambiguous" is what separates
   grilling from a checklist. Softened, the skill still reads fine and lets
   assumptions get baked into code.
3. **Three phases in order** — grill before spec before zoom-out. Reordered, you
   write a spec for a requirement you have not interrogated.
4. **The slice-shape judgment** — `references/slice-shape.md` carries the
   horizontal-layer antipattern inherited from the legacy `zoom-out` skill. It is
   the only place that says how to *recognise* a badly cut plan; `tdd` only says
   how to cut one.
5. **The contract linter's three exit codes** — `scripts/contract_lint.py`
   folding rc 2 into rc 0 is the exact failure the plan calls out (a checker that
   did not run reading as a check that passed). Prose needles cannot see that, so
   the suite runs the script against fixtures and reads the codes.
"""
import os
import re
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
from _suite_lib import (  # noqa: E402
    check_body_deletion, check_contract_coverage, check_no_constant_assertions,
    check_ref_contracts, check_script_contracts, check_skill_body, check_total,
    split_frontmatter)
ROOT = os.path.dirname(HERE)

# Measured with _suite_lib.content_bytes; slack would hide equivalent document deletion.
SLICE_SHAPE_FLOOR = 3520

# Measured failure counts from copies with emptied files, with zero slack.
# One spare failure permits one contract to disappear silently.
SKILL_FLOOR = 49
SLICE_SHAPE_CONTRACTS = 7
SCRIPT_FLOOR = 43
TOTAL = 115

results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))


def read(p):
    """Report absence as a verdict instead of raising an exception.

    An exception stops the suite before its final summary. Tools counting
    [FAIL] lines then see only earlier output. On 2026-09-02, deleting
    references/slice-shape.md produced one FAIL and a traceback, skipping
    coverage, deletion regressions, and total counts: one deleted file
    silenced 100 checks. Returning an empty string instead fails every
    dependent needle and lets the suite complete, exposing the missing file
    through failures rather than silence.
    """
    if not os.path.isfile(p):
        check(f'Missing: {os.path.relpath(p, ROOT)} exists', False, "file missing")
        return ""
    with open(p, encoding="utf-8") as f:
        return f.read()


def main():
    fm, skill = split_frontmatter(read(os.path.join(ROOT, "SKILL.md")))

    # (1) Verifiable acceptance criteria are this skill's core value.
    check('Criteria: requires verifiable statements',
          "In verifiable sentences" in skill)
    check('Criteria: rejects works well as an acceptance criterion',
          '"Works well" is not a criterion' in skill)
    check('Criteria: pairs bad and good examples',
          "p95 under 200 ms" in skill and "401" in skill)
    check('Criteria: explains why this gives the document value',
          "is what makes this document\nworth writing" in skill
          or "worth writing" in skill)

    # (2) Instructions to stop.
    check('Stop: requires stopping when about to start coding',
          "Stop when the urge is to start coding" in skill)
    check('Stop: distinguishes seeming clear from being clear',
          "looks clear and one\nthat is clear" in skill or "that is clear" in skill)
    check('Stop: prohibits proceeding with ambiguity',
          "Do not proceed while ambiguous" in skill)
    check('Stop: requires recording assumptions in the spec',
          "state the\nassumption" in skill or "state the" in skill)
    check('Stop: requires returning when a question cannot be answered',
          "that you cannot answer" in skill and "bakes that assumption into the code" in skill)

    # (3) Three phases and their order.
    phases = re.findall(r"(?m)^## Phase (\d)", skill)
    check('Order: three phases occur in order', phases == ["1", "2", "3"], f"{phases}")
    for n, what in (("1", "grill"), ("2", "spec"), ("3", "zoom-out")):
        check(f'Order: Phase {n} is {what}',
              re.search(rf"(?m)^## Phase {n}[^\n]*{what}", skill) is not None)
    check('Order: explains why the three phases are combined',
          "form one ordered task" in skill and "three always-on descriptions" in skill)

    # (4) Four spec sections.
    for sec in ("User stories", "Acceptance criteria", "Edge cases", "Constraints"):
        check(f'Spec: includes the {sec} section', sec in skill)

    # (5) Three zoom-out axes.
    check('Zoom-out: numbers all three axes',
          all(f"{i}. **" in skill for i in (1, 2, 3)))
    check('Zoom-out: requires simplification of excessive complexity and explains why',
          "If it is more than needed, cut it" in skill
          and "costs less than" in skill)

    # (6) Boundaries.
    skills_dir = os.path.dirname(ROOT)
    named = set(re.findall(r"`([a-z][a-z-]{2,})`\s*skill", skill))
    missing = [n for n in named if not os.path.isdir(os.path.join(skills_dir, n))]
    check('Boundary: redirection target population is nonempty', len(named) >= 3, f"{sorted(named)}")
    check('Boundary: all redirection targets exist', not missing, f"missing {missing}")

    # (7) Limits: what is measured and what is not.
    check('Limits: identifies answers as belonging to the user', "The answers are the user's" in skill)
    check('Limits: does not verify whether the spec is correct',
          "does not check whether the spec is correct" in skill)

    # (8) Language policy.
    check('Language: description includes Korean triggers',
          len(re.findall(r"[가-힣]+", fm)) >= 5)
    check('Language: description also includes English triggers', "spec" in fm and "grill" in fm)

    # (9) SKILL.md must point to both lower layers, preventing orphans.
    # References and scripts run only when named; an uncited file can exist
    # without anyone opening it, which volume checks cannot detect.
    check('References: SKILL.md names the slice-shape reference path',
          "references/slice-shape.md" in skill)
    check('References: SKILL.md names the contract_lint path',
          "scripts/contract_lint.py" in skill)
    check('References: SKILL.md fixes the contract file path',
          ".jstack/tasks/<task-id>/contract.yaml" in skill)
    check('References: SKILL.md distinguishes rc 2 from rc 0',
          "It\nexits 2 — not 0 —" in skill or "exits 2 — not 0 —" in skill)
    check('References: SKILL.md requires verify to run the linter first',
          "verify command\nruns this linter before" in skill
          and "before reading earlier task claims" in skill)   # Require both halves: OR lets one survive while the other reverses (K2).
    check('v2: specifies one task-state root and immutable contract path',
          ".jstack/tasks/<task-id>/contract.yaml" in skill
          and "immutable copy" in skill)
    check('v2: links requirements to IDs, user behavior, and related files',
          all(x in skill for x in ("stable ID", "user-observable behavior",
                                   "files that implement it")))
    check('v2: positive and RED commands require expected exit codes',
          "positive command with its expected exit code" in skill
          and "RED command with its expected exit code" in skill)
    check('v2: RED uses the temporary related-file copy placeholder',
          "temporary\ncopy through `{RED_ROOT}`" in skill
          and "list every fixture, configuration file, and dependency" in skill)
    check('v2: selects only review types needed by the task',
          all(x in skill for x in ("`cold-read`", "`사실`", "`평가독립성`",
                                   "`SSOT`", "`이식성`")))
    check('v2: skipped reviews require a reason',
          "Mark an inapplicable review `생략` and\nstate why" in skill)
    check('v2: simple tasks skip delegation procedures but retain verification',
          "may set `위임: 불필요`" in skill
          and "still gets fresh verification" in skill)
    check('References: SKILL.md includes the discriminating question in its body',
          "Ask what runs at the end of step one" in skill)

    # (10) Execute script behavior. Prose needles stay green for empty scripts.
    # Distinct fixtures require rc 0, 1, and 2. Collapsing 2 into 0 is the
    # failure this script prevents, and an rc-1 fixture cannot expose it.
    lint_py = os.path.join(ROOT, "scripts", "contract_lint.py")
    check('Script: contract_lint.py exists', os.path.isfile(lint_py))

    def lint(*args):
        return subprocess.run([sys.executable, lint_py, *args],
                              capture_output=True, text=True, cwd=ROOT)

    surface = os.path.join(os.path.dirname(ROOT), "author", "references",
                           "package-surface.yaml")
    check('Script: package-surface.yaml is the default judge',
          os.path.isfile(surface), surface)

    OK_CONTRACT = (
        "계약버전: 1\n"
        "발동: 사용자\n"
        "선행:\n"
        "  - 조건: gws-jstack auth is oauth2\n"
        "    유형: 동적\n"
        "    확인: gws-jstack auth status\n"
        "    실패시: 불가역\n"
        "산출:\n"
        "  - 경로: src/api/login.py\n"
        "    형식: py\n"
        "검증:\n"
        "  - 등급: 기계\n"
        "    명령: pytest tests/\n"
        "    RED: reversing one login branch fails the newly added test\n"
        "  - 등급: 인간\n"
        "    명령: 없음\n"
        "    승인기록: .jstack/plan/login/approval.md\n"
        "후행: [verify]\n"
        "출처: skills/plan/references/slice-shape.md\n"
    )

    with tempfile.TemporaryDirectory() as td:
        def fixture(name, text):
            p = os.path.join(td, name)
            with open(p, "w", encoding="utf-8") as f:
                f.write(text)
            return p

        templates = re.findall(r"```yaml\n(.*?)\n```", skill, re.S)
        check('v2 example: exactly one executable YAML template exists',
              len(templates) == 1, f"{len(templates)} templates")
        template = fixture("template-v2.yaml", templates[0] if templates else "")
        rendered = lint(template)
        check('v2 example: documented one-requirement, no-delegation template returns linter rc 0',
              rendered.returncode == 0,
              (rendered.stderr.strip().splitlines() or
               [f"rc={rendered.returncode}"])[-1][:120])

        good = fixture("ok.yaml", OK_CONTRACT)
        r = lint(good)
        check('Behavior: schema-conforming contract returns rc 0', r.returncode == 0,
              (r.stderr.strip().splitlines() or [f"rc={r.returncode}"])[-1][:120])
        check('Behavior: pass output reports numeric zero violations and zero external paths',
              "violations: 0" in r.stdout and "package-external path references 0" in r.stdout,
              (r.stdout.strip().splitlines() or ["(no output)"])[-1][:100])

        # rc 1: distinct fixtures for v1 required fields and valid values.
        for i, (label, text, needle) in enumerate((
            ("missing schema version", OK_CONTRACT.replace("계약버전: 1\n", ""), "`계약버전:`"),
            ("invalid trigger value", OK_CONTRACT.replace("발동: 사용자", "발동: 자동"),
             "`발동:` has an invalid value"),
            ("invalid grade value", OK_CONTRACT.replace("등급: 인간", "등급: 반자동"),
             "`검증[1].등급` has an invalid value"),
            ("missing RED for machine grade",
             OK_CONTRACT.replace("    RED: reversing one login branch fails "
                                 "the newly added test\n", ""),
             "RED"),
            ("missing approval record for human grade",
             OK_CONTRACT.replace("    승인기록: .jstack/plan/login/approval.md\n", ""),
             "승인기록"),
            ("missing probe for dynamic prerequisite",
             OK_CONTRACT.replace("    확인: gws-jstack auth status\n", ""), "확인"),
            ("missing output format", OK_CONTRACT.replace("    형식: py\n", ""), "형식"),
        )):
            r = lint(fixture(f"bad{i}.yaml", text))
            check(f'Behavior: {label} returns rc 1', r.returncode == 1,
                  f"rc={r.returncode}")
            check(f'Behavior: {label} identifies the violated requirement',
                  needle in r.stderr,
                  (r.stderr.strip().splitlines() or ["(no stderr)"])[-1][:100])

        # Unbaked conditional tables (§4.13.6) must fail even inside block scalars.
        baked = fixture("table.yaml", OK_CONTRACT.replace(
            "    명령: pytest tests/\n",
            "    명령: |\n"
            "      | marp | marp -o out.pdf |\n"
            "      | office | officecli build |\n"))
        r = lint(baked)
        check('Behavior: an unbaked conditional table returns rc 1', r.returncode == 1,
              f"rc={r.returncode}")
        check('Behavior: identifies remaining table syntax', "table syntax" in r.stderr,
              (r.stderr.strip().splitlines() or ["(no stderr)"])[0][:100])

        # Numeric external-path counts (§4.14.5 integration-5 self-containment).
        outside = fixture("outside.yaml", OK_CONTRACT.replace(
            "출처: skills/plan/references/slice-shape.md",
            "출처: ../../other-plugin/skills/x/SKILL.md"))
        r = lint(outside)
        check('Behavior: a package-external path returns rc 1', r.returncode == 1,
              f"rc={r.returncode}")
        check('Behavior: reports a numeric package-external path count',
              "package-external path references 1" in r.stdout,
              (r.stdout.strip().splitlines() or ["(no output)"])[-1][:100])
        check('Behavior: identifies the value pointing outside',
              "other-plugin" in r.stderr,
              (r.stderr.strip().splitlines() or ["(no stderr)"])[0][:100])

        # ../ inside a value. Narrowing detection to startswith('../') excludes
        # docs/../../ escapes from the population entirely, yielding rc 0.
        # Earlier fixtures all began with ../ and missed that boundary
        # (adversarial R3: 105/105 green).
        embed = fixture("embed.yaml", OK_CONTRACT.replace(
            "출처: skills/plan/references/slice-shape.md",
            "출처: docs/../../../etc/passwd"))
        r = lint(embed)
        check('Behavior: an internal ../ segment also escapes the package', r.returncode == 1,
              f"rc={r.returncode}")
        check('Behavior: counts an internal ../ segment as an external path',
              "package-external path references 1" in r.stdout,
              (r.stdout.strip().splitlines() or ["(no output)"])[-1][:100])

        # Two-cell tables distinguish source-line checks from parsed-value
        # checks, which stop at each value's first line and cannot locate rows.
        # Three-cell fixtures missed changing count('|') >= 2 to >= 3; rc and
        # messages stayed unchanged (R4: 105/105). Two cells expose lost row reports.
        t2 = fixture("table2.yaml", OK_CONTRACT.replace(
            "    명령: pytest tests/\n",
            "    명령: |\n"
            "      | marp |\n"
            "      | office |\n"))
        r = lint(t2)
        check('Behavior: a two-cell conditional table also returns rc 1', r.returncode == 1, f"rc={r.returncode}")
        check('Behavior: identifies the row of a two-cell table (source-line check survives)',
              "contains table syntax" in r.stderr,
              (r.stderr.strip().splitlines() or ["(no stderr)"])[-1][:100])

        # Execute fallback judgments. Merely excluding '**' from its list lets
        # '**/*' match everything (R1: 105/105). Detect a meaningless fallback
        # by requiring external paths to remain violations under that judge.
        r = lint("--surface", os.path.join(td, "no-surface.yaml"), outside)
        check('Behavior: fallback judge still rejects external paths', r.returncode == 1,
              f"rc={r.returncode}")
        check('Behavior: fallback does not cover everything (count remains nonzero)',
              "package-external path references 1" in r.stdout,
              (r.stdout.strip().splitlines() or ["(no output)"])[-1][:100])

        # Batch exit composition: 2 dominates 1. Single-contract fixtures
        # never exercised this rule, so removing and rc != 2 escaped (R6:
        # 105/105). A batch with unexecutable checks then reports violations,
        # implying that execution occurred. Ordering distinguishes this:
        # put rc 2 first to expose a later rc 1 overwriting it.
        gone = os.path.join(td, "does-not-exist.yaml")
        v1 = fixture("batch-v1.yaml", OK_CONTRACT.replace("발동: 사용자", "발동: 자동"))
        r = lint(gone, v1)
        check('Behavior: batch rc 2 dominates rc 1 with the unexecutable contract first',
              r.returncode == 2, f"rc={r.returncode}")
        r = lint(v1, gone)
        check('Behavior: batch rc 2 dominates rc 1 with the violating contract first',
              r.returncode == 2, f"rc={r.returncode}")
        r = lint(good, v1)
        check('Behavior: batch rc 1 dominates rc 0', r.returncode == 1,
              f"rc={r.returncode}")

        # rc 2 means checking could not run; collapsing it into 0 hides broken environments.
        r = lint(os.path.join(td, "does-not-exist.yaml"))
        # Compare documented exit codes with this observed rc so changing only
        # documentation or only code creates a mismatch.
        rc_unexecutable = r.returncode
        check('Behavior: missing contract file returns rc 2 rather than rc 0', r.returncode == 2,
              f"rc={r.returncode}")
        r = lint(fixture("broken.yaml", "a: [1,\n"))
        check('Behavior: YAML parse failure returns rc 2', r.returncode == 2,
              f"rc={r.returncode}")
        r = lint(fixture("scalar.yaml", "just one sentence\n"))
        check('Behavior: a non-mapping root returns rc 2', r.returncode == 2,
              f"rc={r.returncode}")
        r = lint()
        check('Behavior: zero contract arguments return rc 2 (zero checks cannot pass)',
              r.returncode == 2, f"rc={r.returncode}")

        # Missing judges must not trigger a silent fallback.
        r = lint("--surface", os.path.join(td, "no-surface.yaml"), good)
        check('Behavior: missing judge reports fallback use',
              "fallback" in r.stderr,
              (r.stderr.strip().splitlines() or ["(no stderr)"])[0][:100])
        check('Behavior: fallback completes with rc 0', r.returncode == 0,
              f"rc={r.returncode}")

    check_ref_contracts(check, ROOT, [
        ("slice-shape.md", "horizontal-layer versus vertical-slice discrimination (inherited from zoom-out)",
         ["A horizontal layer finishes a level; a vertical slice finishes a behaviour.",
          "The horizontal plan is not caught by looking at it, because it looks like order.",
          "Ask what runs at the end of step one.",
         "Recutting is cheaper than it looks, and it gets more expensive every slice."],
         SLICE_SHAPE_FLOOR),
        ("security-scope.md", "security request scope, threat model, optional task link",
         ["# Security-task scope contract", "schemaVersion: 1", "assets, entry points, attacker's existing privileges",
         "보안검증:", "Ordinary v1 and v2 tasks follow the existing"], 1903),
    ])

    # Adversarial lock (2026-09-02): fixture-only value coverage let 18 value-set,
    # rc, and fallback reversals pass. Cross-check canonical SKILL.md with code.
    _lint = read(os.path.join(ROOT, "scripts", "contract_lint.py"))
    for _name, _vals in (("VALID_TRIGGERS", ("모델", "사용자")),
                         ("VALID_GRADES", ("기계", "인간", "불가", "미상")),
                         ("VALID_KINDS", ("정적", "동적"))):
        _m = re.search(_name + r" = \(([^)]*)\)", _lint)
        _got = tuple(re.findall(r'"([^"]+)"', _m.group(1))) if _m else ()
        check(f'Linter: {_name} equals the canonical value list', _got == _vals, f"{_got}")
    # Require equality, not inclusion. Appending a new grade kept every old
    # value present and passed all volume/survival/freeze checks (M9: 101/101).
    # Extract the canonical list and compare it with code constants in order;
    # both widening and narrowing then fail.
    _m = re.search(r"`((?:기계|인간|불가|미상|[가-힣]+)(?:\s*\|\s*[가-힣]+)+)`", skill)
    _doc_grades = tuple(g.strip() for g in _m.group(1).split("|")) if _m else ()
    _m2 = re.search(r"VALID_GRADES = \(([^)]*)\)", _lint)
    _code_grades = tuple(re.findall(r'"([^"]+)"', _m2.group(1))) if _m2 else ()
    check('Cross-check: SKILL.md grade list exactly equals code constants',
          bool(_doc_grades) and _doc_grades == _code_grades,
          f"document {_doc_grades} / code {_code_grades}")
    check('Linter: grade list matches SKILL.md prose',
          all(g in skill for g in ("기계", "인간", "불가", "미상")))

    # Triangulate exit codes across SKILL.md, the linter's docstring table,
    # and actual execution. Prose needles missed changing the table to claim
    # rc 0 means checking could not start (M11: 101/101). A one-sided reversal
    # must disagree with another source.
    _rc_rows = re.findall(r"(?m)^\| (\d) \| ([^|]+)\|", _lint)
    check('Cross-check: linter docstring declares rc 0, 1, and 2 in order',
          [n for n, _ in _rc_rows] == ["0", "1", "2"], f"{[n for n, _ in _rc_rows]}")
    _unexecutable_rows = [n for n, t in _rc_rows if "Checking could not start" in t]
    check("Cross-check: docstring's unable-to-run code equals observed rc",
          _unexecutable_rows == [str(rc_unexecutable)],
          f"docstring {_unexecutable_rows} / observed rc={rc_unexecutable}")
    _m3 = re.search(r"exits (\d) — not (\d) —", skill)
    check("Cross-check: SKILL.md's unable-to-run code equals observed rc",
          _m3 is not None and int(_m3.group(1)) == rc_unexecutable
          and int(_m3.group(2)) != rc_unexecutable,
          f"SKILL.md {_m3.groups() if _m3 else None} / observed rc={rc_unexecutable}")
    check('Linter: --quiet changes output only, not exit codes',
          "if args.quiet:\n        return 0" not in _lint
          and "return 0  # quiet" not in _lint)
    check('Linter: batches inspect every supplied contract rather than only the first',
          "for path in args.contracts:" in _lint and "args.contracts[:1]" not in _lint)
    _fb = re.search(r"FALLBACK_SURFACE_PATTERNS = \(([^)]*)\)", _lint)
    _fbv = re.findall(r'"([^"]+)"', _fb.group(1)) if _fb else []
    check('Linter: fallback surface cannot match everything and nullify judgment',
          bool(_fbv) and "**" not in _fbv, str(_fbv))
    # Document polarity: equal-length substitutions evade volume and survival (D1/D3/D6).
    _slice = read(os.path.join(ROOT, "references", "slice-shape.md"))
    check('Slice: comparison headers run horizontal then vertical',
          re.search(r"\|\s*\|\s*Horizontal layer\s*\|\s*Vertical slice\s*\|", _slice)
          is not None)
    check('Slice: anti-pattern uses [X] and recommended example uses [O]',
          "[X] Phase 1: define every model" in _slice and "[O] Slice 1:" in _slice)
    check('Slice: recutting is triggered by finishing a level',
          "Step one finishes a level rather than a behaviour" in _slice)
    check('Slice: discriminating conclusion contains no inserted negation',
          "horizontal no matter how it is labelled." in _slice
          and "not horizontal no matter how" not in _slice)

    check_skill_body(check, ROOT, needles=[
        "In verifiable sentences", "Do not proceed while ambiguous",
        "Stop when the urge is to start coding",
        "If it is more than needed, cut it",
    ], floor=4514)

    # All three early-returning copy axes use the same meta-prefix population.
    # Excluding a prefix on only one side creates slack and hides disappeared
    # checks. Omitting script-contracts counted one extra live check, leaving
    # copies one short and falsely triggering survival failures that skipped
    # every floor verdict. Include it to remove dependence on call order.
    META = ("자기검사:", "계약 커버리지:", "스크립트 계약:")
    live_ran = sum(1 for r in results if not r[0].startswith(META))

    check_contract_coverage(check, __file__, ROOT, per_file={
        "SKILL.md": SKILL_FLOOR,
        "references/slice-shape.md": SLICE_SHAPE_CONTRACTS,
        "references/security-scope.md": 3,
        "scripts/contract_lint.py": SCRIPT_FLOOR,
    }, live_ran=live_ran)
    check_body_deletion(check, __file__, ROOT, minimum=SKILL_FLOOR,
                        live_ran=live_ran)
    check_script_contracts(check, __file__, ROOT, scripts={
        "scripts/contract_lint.py": SCRIPT_FLOOR,
    }, live_ran=live_ran)
    check_no_constant_assertions(check, __file__)
    check_total(check, results, TOTAL + 3)

    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n{passed}/{len(results)} 통과")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
