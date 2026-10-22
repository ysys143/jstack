#!/usr/bin/env python3
"""Command contract suite.

Usage: python3 tests/test_commands.py (from the staged work package)

## What this locks

Commands must provide **flow, not routing**. Ending with "use that skill" gives
the user nothing because the description already names the skill.

1. **Can it execute?** — `doctor` and `validate` have runnable scripts.
2. **Does it decide?** — exit-code contracts exist and match behavior.
3. **Does it warn about traps first?** — `convert` states hard-to-reverse choices first.
4. **Do named targets exist?** — skills, scripts, and reference paths.
"""
import json
import os
import re
import shutil
import tempfile
import subprocess
import sys

sys.dont_write_bytecode = True
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "skills"))
from _suite_lib import (check_contract_coverage, check_no_constant_assertions,  # noqa: E402
                        check_total, split_frontmatter)  # noqa: E402
CMD = os.path.join(ROOT, "commands")
SKILLS = os.path.join(ROOT, "skills")
SCRIPTS = os.path.join(ROOT, "scripts")
WANT = (
    "check-usage", "convert", "dashboard-alias", "dashboard-repair", "dashboard-setup",
    "doctor", "gws", "report", "setup-workspace", "validate",
)

# Only commands whose intent no public skill carries have a description; the rest cost
# nothing in the model-facing listing and show their first body line in the `/` menu.
DESCRIBED = (
    "branch", "commit", "convert", "doctor", "init", "inspect", "install-skill", "log", "pr",
    "project-checks", "ship", "skills", "test-plugin", "validate", "wrap",
)
DESCRIPTION_COLUMNS = 60

results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))


def read(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


def command_description(fm):
    """Return the frontmatter description, or None when the key is absent."""
    m = re.search(r"(?m)^description:[ \t]*(.*)$", fm)
    if not m:
        return None
    raw = m.group(1).strip()
    if raw.startswith('"'):
        try:
            return json.loads(raw)
        except ValueError:
            return raw
    return raw


def menu_contract(name, text):
    """A described command has a short ASCII description; any other command has none
    and opens with `# /<name> — `."""
    fm, body = split_frontmatter(text)
    description = command_description(fm)
    if name in DESCRIBED:
        return bool(description
                    and len(description) <= DESCRIPTION_COLUMNS
                    and re.fullmatch(r"[\x20-\x7e]+", description))
    first = next((line for line in body.splitlines() if line.strip()), "")
    return description is None and first.startswith(f"# /{name} \u2014 ")


def run(script, *args):
    """Run a runner or checker script.

    **Disable deletion regression.** This suite measures a script's **contract**
    (exit code, output shape, and population), not skill-suite binding. Calling the
    runner invokes skill suites that copy the tree for each reference file, then
    repeats inside this suite's own deletion copy. One `test_commands` run exceeded
    30 minutes (a nested form of category O).

    Omitting it preserves the runner's exit code and summary because totals remain
    intact. Each skill suite measures its own binding during the full runner pass.
    """
    nested_env = dict(os.environ, JSTACK_SKIP_DELETION="1")
    nested_env.pop("JSTACK_SUITE_EVIDENCE_DIR", None)
    r = subprocess.run(["bash", os.path.join(SCRIPTS, script), *args],
                       capture_output=True, text=True, cwd=ROOT,
                       env=nested_env)
    return r.returncode, r.stdout + r.stderr


def main():
    all_names = sorted(f[:-3] for f in os.listdir(CMD) if f.endswith(".md"))
    check("Inventory: the unified command count is 35", len(all_names) == 35, f"{all_names}")
    names = sorted(WANT)
    for want in WANT:
        check(f"Inventory: /{want} is present", want in all_names)

    bodies = {}
    for n in names:
        raw = read(os.path.join(CMD, n + ".md"))
        fm, body = split_frontmatter(raw)
        bodies[n] = body
        check(f"Format: /{n} has a description of at most 60 columns" if n in DESCRIBED
              else f"Format: /{n} has no description and opens with its `/` menu line",
              menu_contract(n, raw))

    # (1) Executability — doctor and validate have scripts.
    for cmd, script in (("doctor", "doctor.sh"), ("validate", "validate.sh")):
        path = os.path.join(SCRIPTS, script)
        check(f"Execution: /{cmd}'s script exists", os.path.exists(path))
        check(f"Execution: /{cmd} documentation points to its script",
              f"scripts/{script}" in bodies[cmd])

    # (2) Decision — doctor runs and counts according to its contract.
    r = subprocess.run(["bash", os.path.join(SCRIPTS, "doctor.sh")],
                       capture_output=True, text=True)
    check("Decision: doctor completes", r.returncode in (0, 1), f"rc={r.returncode}")
    for label in ("[ready]", "[self-contained]", "[blocked]"):
        check(f"Decision: doctor output defines the {label} class",
              label in bodies["doctor"])
    check("Decision: doctor scans all 10 skills",
          len(re.findall(r"(?m)^\s+\[(?:ready|self-contained|partial|blocked)\]", r.stdout)) == 10,
          f"{len(re.findall(r'(?m)^\s+\[(?:ready|self-contained|partial|blocked)\]', r.stdout))} rows")
    # **Do not count self-contained as blocked.** Exit 1 is normal for research.
    check("Decision: research is counted as self-contained (exit 1 is not a defect)",
          re.search(r"\[self-contained\]\s+research|\[ready\]\s+research", r.stdout) is not None,
          [_ln for _ln in r.stdout.splitlines() if "research" in _ln][:1])

    # validate stops with rc=2 when called without a file.
    r2 = subprocess.run(["bash", os.path.join(SCRIPTS, "validate.sh")],
                        capture_output=True, text=True)
    check("Decision: validate stops with rc=2 without arguments", r2.returncode == 2,
          f"rc={r2.returncode}")

    # (3) Traps — convert states hard-to-reverse choices first.
    conv = bodies["convert"]
    check("Trap: convert has a section on hard-to-reverse choices",
          "Choices that are hard to reverse" in conv)
    for trap in ("Text inside an image", "image slides", "typesetting"):
        check(f"Trap: convert warns about `{trap}`", trap in conv)
    check("Trap: convert fixes the chain order",
          "Keep this order" in conv and "humanize" in conv and "proof" in conv)

    # (4) Do named targets exist?
    skills_dir = os.path.join(ROOT, "skills")
    known = {d for d in os.listdir(skills_dir)
             if os.path.isdir(os.path.join(skills_dir, d)) and not d.startswith(("_", "."))}
    # **Narrow the table rule.** `| `x` |` assumes the first cell names a skill,
    # but the dashboard import broke that assumption by listing 38 widgets in the
    # same table shape (`| `model` | ...`). Treating those as skills reports seven
    # missing skills, a **false positive** that makes a checker worse than none.
    #
    # Keep the rule and exclude **only that command with a reason**. The explicit
    # `` `x` skill `` form still applies to that document, so the axis remains live.
    TABLE_RULE_OFF = {
        "dashboard-setup": "It lists 38 widgets in the same table shape; they are not skill names",
    }
    for _c, _why in sorted(TABLE_RULE_OFF.items()):
        check(f"Reference: /{_c} has a reason for excluding the table rule", bool(_why.strip()))
        check(f"Reference: table-rule exception /{_c} is a real command", _c in bodies)
    for n, body in bodies.items():
        named = set(re.findall(r"`([a-z][a-z0-9-]{2,})`\s*skill", body))
        # Also recognize names given only in backticks within tables.
        if n not in TABLE_RULE_OFF:
            named |= {m for m in re.findall(r"\|\s*`([a-z][a-z0-9-]{2,})`\s*\|", body)}
        ghost = sorted(named - known)
        check(f"Reference: every skill named by /{n} exists", not ghost, f"missing {ghost}")

    # Script paths named by the documentation must exist.
    for n, body in bodies.items():
        refs = re.findall(r"skills/([a-z-]+)/scripts/([\w.-]+)", body)
        miss = [f"{s}/{f}" for s, f in refs
                if not os.path.exists(os.path.join(skills_dir, s, "scripts", f))]
        check(f"Reference: every script named by /{n} exists", not miss, f"missing {miss}")

    # Public /help was removed. The unified help skill and CAPABILITIES.md provide the index.
    help_skill = read(os.path.join(SKILLS, "help", "SKILL.md"))
    check("Index: the help skill points to the capability catalog",
          "CAPABILITIES.md" in help_skill)

    # **Does every skill have a contract suite?** Matching the runner glob to the
    # checker prevents a *differently named* suite, while this prevents a skill
    # *without any suite*. They guard different failures (review 9). A skill with
    # no suite would otherwise be skipped and silently remain green.
    _nosuite = []
    for _sk in sorted(os.listdir(SKILLS)):
        _d = os.path.join(SKILLS, _sk)
        if not os.path.isfile(os.path.join(_d, "SKILL.md")):
            continue
        _td = os.path.join(_d, "tests")
        _has = os.path.isdir(_td) and any(
            f.endswith(".py") and not f.startswith("_")
            for f in os.listdir(_td))
        if not _has:
            _nosuite.append(_sk)
    check("Reachability: every skill has a contract suite", not _nosuite, f"{_nosuite}")

    # **Are the runner's meta-check calls alive?** Review 7 H-3 made missing checker
    # files fail closed, but left call sites unguarded. Truncating both runners at
    # `PARITY=` removed 28%% while still producing `suite 20 / failures 0, rc=0`;
    # pair parity passes when **both copies shrink identically** (review 12).
    # This matches the review 6 defect where both `_suite_lib.py` floors were lowered.
    #
    # A full run here would recurse because the runner invokes this suite. Measure
    # two things instead: verify the **selected-run notice** in a live run (removing
    # the meta block also removes its `else` branch), and verify all three checker
    # **calls** in source (which catches deletion of only the `if` branch).
    _rc, _o = run("run_suites.sh", "office")
    check("Runner: selected execution reports that it skips meta checks",
          "지정 실행" in _o and "건너뛴다" in _o, _o.strip()[-80:])
    _src = read(os.path.join(SCRIPTS, "run_suites.sh"))
    check("Runner: missing contract checkers fail closed",
          'contract checker is missing' in _src and 'exit 2' in _src)

    # **Does the full-run branch avoid early exits?** Behavioral checks use a
    # temporary tree, so they cannot see a branch that differs **only in the real
    # tree**. Adding `[ -d "$ROOT/../../.git" ] && exit 0` made the real tree run
    # zero meta checks while locks stayed green (review 16). Replacing the source
    # check with a behavioral check opened this gap.
    #
    # This is incomplete because an inverted condition could still evade it, but it
    # blocks the cheapest "skip only in the real tree" form. **Source and behavioral
    # checks cover each other's blind spots.** Replacing source grep with behavior in
    # review 14 was a mistake: a shell runner with filesystem access can identify a
    # synthetic fixture. Branching on `.git` could swallow failures only in the real
    # tree; all behavioral checks passed and parity printed one mismatch, yet rc=0
    # (review 17). Source checks can be rephrased around, and behavior can detect the
    # fixture, so both remain.
    #
    # Lock the meta block's **shape**: exactly three failure propagations and one
    # branch (`$# -eq 0` itself). This distinguishes both bypasses:
    #   `|| true` -> two propagations; `.git` branch -> two branches.
    _meta = _src[_src.index('PARITY='):]
    _meta = _meta[:_meta.index('[ $fail -eq 0 ]')]
    _prop = _meta.count("fail=$((fail + 1))")
    check("Runner: the meta block has three failure propagations", _prop == 3,
          "" if _prop == 3 else
          f"{_prop} found; one checker's failure is being swallowed")
    _brs = _meta.count("if ") + _meta.count("elif ")
    check("Runner: the meta block has exactly one conditional branch", _brs == 1,
          "" if _brs == 1 else
          f"{_brs} found; a branch may distinguish the real tree from fixtures")
    for _var, _why in (("$PARITY", "floor parity"), ("$BEHAV", "harness behavior"),
                       ("$LIBPAR", "copy-pair parity")):
        check(f"Runner: source invokes the {_why} checker",
              f'python3 "{_var}"' in _meta, _var)



    # **Measure effects, not only source.** The previous version only checked for
    # `python3 "$PARITY"`; keeping the call while appending `|| true` swallowed its
    # failure. Parity printed one mismatch but the runner returned rc=0 (review 14).
    # That discards visible evidence and is worse than silence. The same bypass used
    # `false && python3 "$PARITY"`.
    #
    # A full run would recurse, so create a **temporary tree** with one minimal skill
    # and three deliberately failing checkers under `refactor/`, then inspect runner
    # rc. Fail **one checker at a time**; if all fail together, the others preserve a
    # nonzero rc and hide one swallowed failure (measured when PARITY and LIBPAR used
    # `|| true` but BEHAV still propagated).
    _CHECKERS = (("check_floor_parity.py", "floor parity"),
                 ("check_suite_lib_behaviour.py", "harness behavior"),
                 ("check_suite_lib_parity.py", "copy-pair parity"))
    for _target, _why in _CHECKERS:
        with tempfile.TemporaryDirectory() as _tmp:
            _pt = os.path.join(_tmp, "jstack")
            os.makedirs(os.path.join(_pt, "scripts"))
            os.makedirs(os.path.join(_pt, "skills", "only", "tests"))
            shutil.copy(os.path.join(SCRIPTS, "run_suites.sh"),
                        os.path.join(_pt, "scripts", "run_suites.sh"))
            with open(os.path.join(_pt, "skills", "only", "SKILL.md"), "w") as _f:
                _f.write("---\nname: only\ndescription: x\n---\n\nx\n")
            with open(os.path.join(_pt, "skills", "only", "tests",
                                   "run_tests.py"), "w") as _f:
                _f.write("print('1/1 통과')\n")        # Required suite summary protocol.
            for _n, _ in _CHECKERS:
                with open(os.path.join(_pt, "scripts", _n), "w") as _f:
                    _f.write("import sys\nprint('[ok]')\n"
                             + ("sys.exit(1)\n" if _n == _target else ""))
            _nested_env = os.environ.copy()
            _nested_env.pop("JSTACK_SUITE_EVIDENCE_DIR", None)
            _r = subprocess.run(["bash", os.path.join(_pt, "scripts", "run_suites.sh")],
                                capture_output=True, text=True, cwd=_pt,
                                env=_nested_env)
            check(f"Runner: propagates {_why} checker failure in its exit code",
                  _r.returncode != 0,
                  "" if _r.returncode != 0 else
                  f"rc={_r.returncode}; suite passed and only this checker failed, "
                  "but the runner returned zero and swallowed the failure")

    # **Is the contract-suite runner reachable from documentation?** If no document
    # points to `run_suites.sh`, H-6 is only half fixed. Its name resembles
    # `validate.sh`, so users may run the artifact checker and think contracts were
    # verified (review 8).
    _vd = read(os.path.join(CMD, "test-plugin.md"))
    check("Reachability: /test-plugin points to the contract-suite runner",
          "run_suites.sh" in _vd)
    check("Reachability: that runner exists",
          os.path.isfile(os.path.join(SCRIPTS, "run_suites.sh")))
    check("Reachability: /test-plugin explains the difference between validations",
          "format and content of user-created deliverables" in _vd and "contract suite" in _vd)

    # **Was an output style deleted wholesale?** Token matching becomes arbitrary
    # for style guidance, so minimize the needle to one **identity-defining name**
    # and pair it with measured size and committed-copy checks. Together these ask
    # whether the file was gutted, rather than prescribing its wording (review 11).
    # The previous existence-only check missed even a **zero-byte file**.
    for _f, _floor, _need in (
            ("ATTRIBUTION.md", 1847, "adapted"),
            ("fluent-korean.md", 4899, "name: fluent-korean"),
            ("fluent-korean-not-coding.md", 4667, "name: fluent-korean-not-coding")):
        _p = os.path.join(ROOT, "output-styles", _f)
        _t = read(_p) if os.path.isfile(_p) else ""
        check(f"Output style: {_f} preserves its measured volume",
              len(_t.encode()) >= _floor, f"{len(_t.encode())}B (floor {_floor}B)")
        check(f"Output style: {_f} declares its identity", _need in _t, _need)
        _r = subprocess.run(["git", "diff", "--quiet", "HEAD", "--", _p],
                            cwd=ROOT, capture_output=True)
        check(f"Output style: {_f} matches the committed copy", _r.returncode in (0, 128),
              "" if _r.returncode in (0, 128) else
              "modified in the working tree; editing an imported copy can invalidate attribution")

    # **Plugin-root population guard.** The work layer had none. Each skill suite sees
    # only its directory, leaving all of `agents/`, `commands/`, `output-styles/`,
    # and `evals/` outside every population. In particular, **all evaluation answer
    # keys** (`prompt.md`, `graders/*.md`, and `case.yaml`) were outside. Removing
    # `.yaml` from `NON_CONTRACT_SUFFIX` had no effect without this guard (review 8).
    #
    # `measure=False`: floor 1 is a placeholder. Separate axes measure binding:
    # checks above cover command bodies, owner suites compare answer-key tokens,
    # and the set/git contract in `tests/test_evals.py` covers classification tags.
    # This call only detects whether **files silently appear or disappear**.
    check_contract_coverage(check, __file__, ROOT, per_file={
        # The hook contract (§4.13.2) and AGENTS.md are root documents outside the
        # skill tree, so only this population guard sees them.
        "hooks/CONTRACT.md": 1,
        "AGENTS.md": 1,
        # Three contracts plus migration/version documents. All are root documents
        # outside the skill tree; `tests/test_contracts.py` measures actual binding.
        "contracts/portable-contract.yaml": 1,
        "contracts/claims.yaml": 1,
        "contracts/change-impact.yaml": 1,
        "CHANGELOG.md": 1,
        # `CLAUDE.md` requires README in its required structure, but both plugins
        # lacked it. The root-document loop in `tests/test_contracts.py` measures
        # binding; README was missing there too, so absence previously stayed green.
        "README.md": 1,
        "agents/ai-tell-detector.md": 1,
        "agents/content-fidelity-auditor.md": 1,
        "agents/korean-ai-tell-taxonomist.md": 1,
        "agents/korean-procurement-detector.md": 1,
        "agents/korean-procurement-fidelity-auditor.md": 1,
        "agents/korean-procurement-naturalness-reviewer.md": 1,
        "agents/korean-procurement-rewriter.md": 1,
        "agents/korean-style-rewriter.md": 1,
        "agents/naturalness-reviewer.md": 1,
        # Four dashboard imports (2026-09-05), including one renamed after a `setup` collision.
        "commands/check-usage.md": 1,
        "commands/dashboard.md": 1,
        "commands/dashboard-alias.md": 1,
        "commands/dashboard-repair.md": 1,
        "commands/convert.md": 1,
        "commands/doctor.md": 1,
        "commands/gws.md": 1,
        "commands/setup-workspace.md": 1,
        "commands/validate.md": 1,
        "evals/discriminating/deck-design-slop/case.yaml": 1,
        "evals/discriminating/deck-design-slop/graders/criteria.md": 1,
        "evals/discriminating/deck-design-slop/graders/counts.md": 1,
        "evals/discriminating/deck-design-slop/graders/tag_median.md": 1,
        "evals/discriminating/deck-design-slop/graders/tag_no_constraint.md": 1,
        "evals/discriminating/deck-design-slop/graders/tag_no_verify.md": 1,
        "evals/discriminating/deck-design-slop/graders/tag_underspec.md": 1,
        "evals/discriminating/deck-design-slop/graders/skill_fired.md": 1,
        "evals/discriminating/deck-design-slop/prompt.md": 1,
        "evals/discriminating/diagram-connector-rules/case.yaml": 1,
        "evals/discriminating/diagram-connector-rules/graders/criteria.md": 1,
        "evals/discriminating/diagram-connector-rules/graders/rule0.md": 1,
        "evals/discriminating/diagram-connector-rules/graders/gap.md": 1,
        "evals/discriminating/diagram-connector-rules/graders/rule2.md": 1,
        "evals/discriminating/diagram-connector-rules/graders/skill_fired.md": 1,
        "evals/discriminating/diagram-connector-rules/prompt.md": 1,
        "evals/discriminating/hwpx-format-units/case.yaml": 1,
        "evals/discriminating/hwpx-format-units/graders/criteria.md": 1,
        "evals/discriminating/hwpx-format-units/graders/a4h.md": 1,
        "evals/discriminating/hwpx-format-units/graders/skill_fired.md": 1,
        "evals/discriminating/hwpx-format-units/prompt.md": 1,
        "evals/discriminating/workspace-scrum-rows/case.yaml": 1,
        "evals/discriminating/workspace-scrum-rows/graders/criteria.md": 1,
        "evals/discriminating/workspace-scrum-rows/graders/tab_ok.md": 1,
        "evals/discriminating/workspace-scrum-rows/graders/tab_ng.md": 1,
        "evals/discriminating/workspace-scrum-rows/graders/date.md": 1,
        "evals/discriminating/workspace-scrum-rows/graders/rows.md": 1,
        "evals/discriminating/workspace-scrum-rows/graders/skill_fired.md": 1,
        "evals/discriminating/workspace-scrum-rows/prompt.md": 1,
        "evals/parity/general-vs-upstream/case.yaml": 1,
        "evals/parity/general-vs-upstream/graders/criteria.md": 1,
        "evals/parity/general-vs-upstream/graders/skill_fired.md": 1,
        "evals/parity/general-vs-upstream/prompt.md": 1,
        "evals/regression/humanize-general/case.yaml": 1,
        "evals/regression/humanize-general/graders/block.md": 1,
        "evals/regression/humanize-general/graders/criteria.md": 1,
        "evals/regression/humanize-general/graders/fix_antithesis.md": 1,
        "evals/regression/humanize-general/graders/fix_cliche.md": 1,
        "evals/regression/humanize-general/graders/fix_means.md": 1,
        "evals/regression/humanize-general/graders/fix_metaphor.md": 1,
        "evals/regression/humanize-general/graders/keep_count.md": 1,
        "evals/regression/humanize-general/graders/keep_period.md": 1,
        "evals/regression/humanize-general/graders/skill_fired.md": 1,
        "evals/regression/humanize-general/prompt.md": 1,
        "evals/regression/humanize-procurement/case.yaml": 1,
        "evals/regression/humanize-procurement/graders/criteria.md": 1,
        "evals/regression/humanize-procurement/graders/skill_fired.md": 1,
        "evals/regression/humanize-procurement/prompt.md": 1,
        "evals/regression/humanize-taxonomy-recall/case.yaml": 1,
        "evals/regression/humanize-taxonomy-recall/graders/criteria.md": 1,
        "evals/regression/humanize-taxonomy-recall/graders/count_K.md": 1,
        "evals/regression/humanize-taxonomy-recall/graders/count_L.md": 1,
        "evals/regression/humanize-taxonomy-recall/graders/count_M.md": 1,
        "evals/regression/humanize-taxonomy-recall/graders/count_N.md": 1,
        "evals/regression/humanize-taxonomy-recall/graders/count_O.md": 1,
        "evals/regression/humanize-taxonomy-recall/graders/skill_fired.md": 1,
        "evals/regression/humanize-taxonomy-recall/prompt.md": 1,
        "output-styles/ATTRIBUTION.md": 1,
        "output-styles/fluent-korean-not-coding.md": 1,
        "output-styles/fluent-korean.md": 1,
    }, measure=False, completeness=False)

    check_no_constant_assertions(check, __file__)
    check_total(check, results, 81)

    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n{passed}/{len(results)} 통과")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
