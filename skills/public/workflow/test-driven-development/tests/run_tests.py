#!/usr/bin/env python3
"""tdd contract suite.

Run: python3 tests/run_tests.py   (from skills/tdd)

## What this locks

1. **Lazy loading is real** — six language guides exist and the detection table
   names each one. A guide that the table never points at is dead weight in the
   plugin; a table entry with no guide sends the reader nowhere.
2. **The red step is required** — "watch it fail" is the one instruction that
   separates TDD from writing tests afterwards. If it goes, the skill still
   reads fine and produces tests shaped by the implementation.
3. **Slice != layer** — the distinction is the whole point of folding incremental
   in here, and it is easy to soften into "do it in small steps".
4. **The gates are machines, not prose** — two approvals and new-line coverage were
   honour rules for as long as nothing ran. `scripts/test_gates.py` is exercised
   here against fixtures, and emptying it must turn this suite red.
5. **No single absolute coverage threshold comes back** — `--cov-fail-under` in
   `addopts` is a negative needle. Prose saying it was retired cannot be trusted
   on its own; the setting itself is what gets measured.
"""
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
from _suite_lib import (check_no_constant_assertions, check_ref_contracts, check_total, check_skill_body,
                        split_frontmatter, check_body_deletion, check_script_contracts,
                        check_contract_coverage)  # noqa: E402
ROOT = os.path.dirname(HERE)
LANGS = os.path.join(ROOT, "langs")
GATES = os.path.join(ROOT, "scripts", "test_gates.py")
FIX = os.path.join(HERE, "fixtures")

# Measured values: arbitrary increases block legitimate edits; decreases disable axes.
# A commit changing these values records what was removed and how much.
SKILL_FLOOR = 4214
C_FLOOR, GO_FLOOR, JAVA_FLOOR, JS_FLOOR = 7148, 7520, 8854, 6726
PY_FLOOR, RUST_FLOOR, TS_FLOOR, ANTI_FLOOR = 9845, 7070, 7217, 6252
PER_FILE = {
    "SKILL.md": 42,
    "langs/c.md": 7, "langs/go.md": 6, "langs/java.md": 6,
    "langs/javascript.md": 6, "langs/python.md": 8, "langs/rust.md": 6,
    "langs/typescript.md": 6,
    "references/antipatterns.md": 10,
}
BODY_MIN = 42
GATE_MIN = 28
TOTAL = 127

# --fail-under cannot be centralized because each guide embeds language-specific
# commands. A 90 -> 10 mutation escaped all 15 sites in seven files. Bind the
# sites through cross-checks instead: pin both counts and values so changing or
# removing even one site fails. Values are measured.
FAIL_UNDER = "90"
FU_SITES = {
    "SKILL.md": 1,
    "langs/c.md": 2, "langs/go.md": 2, "langs/java.md": 2,
    "langs/javascript.md": 2, "langs/python.md": 2, "langs/rust.md": 2,
    "langs/typescript.md": 3,
}
FU_RE = re.compile(r"--fail-under[= ](\d+(?:\.\d+)?)")

# Any environment variable that disables a gate is a defect. Unknown names
# require two axes: inject plausible names and confirm unchanged verdicts,
# and verify that the checker never reads the environment. Each alone has gaps.
BACKDOOR_ENV = (
    "SKIP", "SKIP_GATES", "TDD_SKIP", "TDD_SKIP_GATES", "NO_GATE", "NO_GATES",
    "DISABLE_GATES", "GATE_BYPASS", "FORCE_PASS", "COVERAGE_SKIP", "CI_SKIP",
    "ALLOW_UNMEASURED", "FAIL_UNDER", "TDD_FAIL_UNDER", "DIFF_COVERAGE_SKIP",
)

# Approval placeholders are not read from checker source: deleting a constant
# would otherwise delete its test too. Execute every placeholder independently.
PLACEHOLDER_INPUTS = ("TBD", "todo", "미정", "<name>", "-", "N/A", "없음", "undecided", "none")

# Bind table rows to literal column values. Rotating cells or swapping headers
# preserves byte counts and line sets, escaping volume, hashes, and needle sets.
# Only a check for this value in this row detects these demonstrated mutations.
DETECT_ROWS = (
    "| `tsconfig.json` | `langs/typescript.md` |",
    "| `package.json` (no tsconfig) | `langs/javascript.md` |",
    "| `pyproject.toml` · `setup.py` · `requirements.txt` | `langs/python.md` |",
    "| `Cargo.toml` | `langs/rust.md` |",
    "| `go.mod` | `langs/go.md` |",
    "| `pom.xml` · `build.gradle` | `langs/java.md` |",
    "| `CMakeLists.txt` · `configure.ac` · `meson.build` · `Makefile` "
    "**with `*.c`** | `langs/c.md` |",
)
SLICE_ROWS = (
    "| A slice | Not a slice |",
    '| "Log in with email and land on the dashboard" | "Build the User model" |',
    "| Runs end to end and **demonstrates behaviour** | "
    "Does nothing until other layers exist |",
)
BOUNDARY_ROWS = (
    "| Task | Owner |",
    "| Completion judgment, requirement coverage | `verify` skill |",
    "| Deciding what to build | `plan` skill |",
    "| Judging existing code quality | `audit` skill |",
)
LEVEL_ROWS = (
    "| Level | May be replaced by test doubles | Must be real |",
    "| unit | All out-of-process dependencies | SUT and its value objects |",
    "| integration | External SaaS · Payment providers | DB · Queue · ORM mappings · Migrations |",
    "| e2e | None (or payment sandbox) | Entire path |",
    "| smoke | None | Deployed artifact |",
)
COST_ROWS = (
    "| Anti-pattern | What collapses |",
    "| Flaky tests | Trust in the entire CI.",
    "| Order dependency | Locality of failure.",
    "| Excessive mock | The subject of verification. What passes is not the code but the mock |",
)
# Swapping every [X] (do not) and [O] (do this) reverses instructions without
# changing byte count. Literal pairs expose the swap.
XO_PAIRS = (
    "[X] wait for asynchronous completion with sleep",
    "[O] wait for a completion signal or inject a clock",
    "[X] base a verdict on unseeded randomness, UUIDs, or hash iteration order",
    "[O] fix the seed (seed=42) or inject the generator",
    "[X] use a real HTTP endpoint, real DNS, a shared development DB, or fixed port (:8080)",
    "[O] use an in-process test server (httptest.NewServer, msw, responses)",
    "[X] accumulate state in module globals, singletons, or class variables",
    "[O] have each test create and undo its own fixture",
    "[X] mock the SUT itself; this is a meaningless test",
    "[O] replace only boundaries: network, clock, filesystem, and randomness",
)
# Swapped-column headers are negative needles. Positive needles alone report
# one missing header; checking the swapped form also identifies what happened.
SWAPPED_HEADERS = (
    "| Not a slice | A slice |",
    "| Owner | Task |",
    "| Level | Must be real | May be replaced by test doubles |",
    "| What collapses | Anti-pattern |",
    "| Load | Detected |",
)
DIFF_SECTION_HEAD = "## diff coverage — gate only for new code"

results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))


def read(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


def gate(*args):
    """Execute the gate and inspect both exit code and output.
    An empty Python file returns 0, so return-code-only checks can falsely pass."""
    r = subprocess.run([sys.executable, GATES, *args],
                       capture_output=True, text=True, cwd=ROOT)
    return r.returncode, r.stdout + r.stderr


def last_line(out):
    """Return the last output line; never put newlines in diagnostic detail.
    Extra fake [FAIL] lines would inflate deletion-copy failure counts."""
    lines = [ln for ln in out.strip().splitlines() if ln.strip()]
    return lines[-1][:70] if lines else "no output"


def gate_env(env_extra, *args):
    """Run the gate with a polluted environment for the environment-backdoor axis."""
    r = subprocess.run([sys.executable, GATES, *args], capture_output=True,
                       text=True, cwd=ROOT, env=dict(os.environ, **env_extra))
    return r.returncode, r.stdout + r.stderr


def fx(name):
    return os.path.join(FIX, name)


def main():
    fm, skill = split_frontmatter(read(os.path.join(ROOT, "SKILL.md")))

    # (1) lazy loading — table and files must match both ways
    on_disk = {f for f in os.listdir(LANGS) if f.endswith(".md")}
    check('lazy: seven language guides exist', len(on_disk) == 7, f"{sorted(on_disk)}")
    in_table = set(re.findall(r"`langs/([a-z]+\.md)`", skill))
    check('lazy: detection table points to all seven guides', in_table == on_disk,
          f"table only {sorted(in_table - on_disk)} / files only {sorted(on_disk - in_table)}")
    check('lazy: explicitly forbids reading the remaining guides',
          "Do not read the others" in skill)
    check('lazy: asks when detection fails (no guessing)',
          "If detection fails, ask" in skill and "Guessing the framework wrong" in skill)
    # C detection overlaps other languages. Makefile alone would route Go/Rust
    # projects to C, so the table must disclose that ambiguity.
    check('lazy: discloses ambiguous C detection',
          "`Makefile` alone decides nothing" in skill
          and "mixed C/C++ tree is a question for the" in skill)
    # Keep one document independent of language detection. Flakiness, order
    # dependence, and excessive mocking recur across languages; hiding them in
    # language guides made visibility conditional, which F-18 rated most costly.
    check('Always read: cites the language-independent anti-pattern document',
          "`references/antipatterns.md`" in skill
          and "visible or invisible depending on what the project was written in" in skill)

    def rows(label, text, wanted):
        """Measure literal rows to expose rotations and header swaps."""
        lost = [r for r in wanted if r not in text]
        check(label, not lost, f"mismatched rows {[r[:44] for r in lost]}")

    def polarity(label, text, present, forbidden):
        """Measure complete directional sentences. Positive needles catch rewrites;
        negative needles catch inserted negation that reverses the meaning."""
        miss = [n for n in present if n not in text]
        bad = [n for n in forbidden if n in text]
        check(label, not miss and not bad,
              f"missing {[n[:36] for n in miss]} · reversed {[n[:36] for n in bad]}")

    rows('Phase 0: seven detection rows preserve their values (rotation and row deletion)',
         skill, DETECT_ROWS)
    rows('Phase 1: slice-comparison rows preserve their values', skill, SLICE_ROWS)
    rows('Boundary: redirection-table rows preserve their values', skill, BOUNDARY_ROWS)
    swapped = [h for h in SWAPPED_HEADERS if h in skill]
    check('Table: SKILL.md contains no swapped-column header', not swapped, f"{swapped}")

    # A named but empty guide makes lazy loading equivalent to loading nothing.
    thin = [f for f in sorted(on_disk)
            if len(read(os.path.join(LANGS, f)).strip()) < 400]
    check('lazy: guides contain substantive text (>= 400 characters)', not thin, f"thin {thin}")

    # (2) The red step is this skill's core value.
    check('red: requires watching the failure', "watch it fail" in skill)
    check('red: a test whose failure was not observed is not a test',
          "A test whose failure you never saw is not a test" in skill)
    check("red: names what a green-only harness costs",
          "round\nafter round of review unnoticed" in skill,
          "A green-only harness carries a defect through repeated review")

    # (3) Slices are not layers.
    check('Slice: defines a vertical slice',
          "thin vertical slice" in skill and "end to end" in skill)
    check('Slice: prohibits splitting work by layer',
          "Do not slice by layer" in skill and "is not a slice" in skill)
    check('Slice: supplies a criterion (one more working behavior)',
          "must add one thing that runs" in skill)
    check('Slice: contrasts good and bad examples',
          "| A slice | Not a slice |" in skill)

    # (4) Automatic approval lets scenario errors contaminate every later step.
    check('Gate: scenario approval is required',
          "[approval required]" in fm + skill
          or "approval required" in skill)
    check('Gate: prohibits proceeding without approval',
          "Do not proceed without the user's approval" in skill)
    check('Gate: limitations identify approval as a human step',
          "human step" in skill and "never automatic" in skill)
    # Rules without enforcement are honor systems. Two approvals used to be
    # prose-only and violations never failed anything. Require a checker reference.
    check('Gate: cites a mechanism for checking both approvals',
          "test_gates.py approvals" in skill
          and "a rule with no enforcement" in skill)
    check('Gate: cites diff coverage instead of an absolute threshold',
          "test_gates.py diff-coverage" in skill
          and "take legacy debt hostage" in skill
          and "lines this change added" in skill)

    # Volume and needle sets cannot protect polarity: changing one word can
    # reverse an instruction while every contract still passes.
    polarity('Polarity: prohibition on proceeding without approval has not reversed', skill,
             ["**Do not proceed without the user's approval.**",
              "**Scenario approval is a human step.** It is never automatic"],
             ["may proceed without the user", "Proceed without",
              "approval is optional", "approval is automatic",
              "proceed without waiting", "It is automatic",
              "approval when the scenarios are obvious"])
    n_all = skill.count("proceed without the user's approval")
    n_neg = skill.count("Do not proceed without the user's approval")
    check('Polarity: every phrase about proceeding without approval occurs under negation',
          n_all == n_neg and n_neg >= 1, f"total {n_all} · negated {n_neg}")
    polarity('Polarity: requirement to observe red has not reversed', skill,
             ["**watch it fail**",
              "**A test whose failure you never saw is not a test.**"],
             ["watch it pass", "is still a test", "you never saw is a test",
              "Skipping the red step is acceptable", "seeing red is optional"])
    check('Polarity: every occurrence of watch it is watch it fail',
          skill.count("watch it") == skill.count("watch it fail"),
          f"total {skill.count('watch it')} / fail {skill.count('watch it fail')}")
    polarity('Polarity: diff-gate reference has not reversed into absolute-threshold advocacy', skill,
             ["Absolute coverage thresholds take legacy debt hostage",
              "**lines this change added** instead"],
             ["Absolute coverage thresholds are the",
              "Gate the whole repository", "absolute threshold instead",
              "Absolute coverage thresholds do not"])

    # (5) Failure examples preserve the rationale behind the procedure.
    for needle, why in (("Batching tests afterwards", "batching tests afterwards"),
                        ("Several scenarios in one test", "multiple scenarios in one test"),
                        ("Mock overuse", "mock overuse"),
                        ("Skipping the red step", "skipping red")):
        check(f'Failure example: documents {why}', needle in skill)

    # (6) Boundaries.
    skills_dir = os.path.dirname(ROOT)
    # A (not built yet) notice declares absence and does not require existence.
    named = set(re.findall(r"`([a-z][a-z-]{2,})`\s*skill(?!\s*\*\*\(not built yet\)\*\*)",
                           skill))
    unbuilt = set(re.findall(r"`([a-z][a-z-]{2,})`\s*skill\s*\*\*\(not built yet\)\*\*",
                             skill))
    named -= unbuilt
    missing = [n for n in named if not os.path.isdir(os.path.join(skills_dir, n))]
    check('Boundary: redirection target population is nonempty', len(named) >= 2, f"{sorted(named)}")
    # Absence notices must be true. Checking that audit was described as
    # unimplemented forced a false claim after audit was built; correcting the
    # document then failed the suite. Verify actual absence of anything marked
    # not built yet instead (demonstrated by external review).
    wrong = [n for n in unbuilt if os.path.isdir(os.path.join(skills_dir, n))]
    check('Boundary: not-built-yet notices identify actual missing skills', not wrong,
          f"exists but marked not built {wrong}")
    check('Boundary: every redirection target exists', not missing, f"missing {missing}")
    check('Boundary: delegates completion judgment to verify',
          "Completion is judged by the `verify` skill" in skill)
    check('Boundary: distinguishes tests passing from requirements being satisfied',
          "are different questions" in skill)

    # (7) Language policy: preserve Korean triggers.
    ko_triggers = re.findall(r"[가-힣]+", fm)
    check('Language: description includes Korean triggers', len(ko_triggers) >= 5,
          f"{len(ko_triggers)} tokens; route regardless of the language the user speaks")
    check('Language: description also includes English triggers',
          all(t in fm.lower() for t in ("tdd", "test-first", "refactor")))

    # (8) Execute the gate. Prose-only checks let the unenforced rule identified
    # by F-21 return through one sentence; verify actual verdicts.
    rc, out = gate("diff-coverage", "--diff", fx("diff_py.patch"),
                   "--coverage", fx("lcov_full.info"))
    check('Gate: passes fully covered new lines',
          rc == 0 and "100.0%" in out, f"rc={rc}")
    rc, out = gate("diff-coverage", "--diff", fx("diff_py.patch"),
                   "--coverage", fx("lcov_partial.info"))
    check('Gate: insufficient new-line coverage returns rc 1',
          rc == 1 and "50.0%" in out, f"rc={rc}")
    # A src/ prefix makes check_plugin_paths mistake fixture paths for missing
    # repository references. Check filenames and line ranges only.
    check('Gate: identifies uncovered line numbers as ranges',
          "[MISS] " in out and "calc.py: 12-13" in out,
          out.strip()[:60] or "no output")
    rc, out = gate("diff-coverage", "--diff", fx("diff_py.patch"),
                   "--coverage", fx("lcov_partial.info"), "--fail-under", "40")
    check('Gate: lowering the floor passes the same input (return code is not constant)',
          rc == 0 and "[PASS] diff coverage" in out, f"rc={rc}")
    rc, out = gate("diff-coverage", "--diff", fx("diff_go.patch"),
                   "--coverage", fx("cover.out"))
    check('Gate: reads Go coverprofile (matches module-path prefixes by suffix)',
          rc == 0 and "format: go" in out, f"rc={rc}")
    rc, out = gate("diff-coverage", "--diff", fx("diff_py.patch"),
                   "--coverage", fx("cobertura.xml"))
    check('Gate: reads Cobertura XML',
          rc == 1 and "format: cobertura" in out and "25.0%" in out, f"rc={rc}")
    rc, out = gate("diff-coverage", "--diff", fx("diff_java.patch"),
                   "--coverage", fx("jacoco.xml"))
    check('Gate: maps JaCoCo package paths to file paths',
          rc == 1 and "format: jacoco" in out and "Calc.java" in out, f"rc={rc}")
    rc, out = gate("diff-coverage", "--diff", fx("diff_docs.patch"),
                   "--coverage", fx("lcov_full.info"))
    # Pass changes with no executable new lines. Rejecting comment/config-only
    # PRs as 0% would quickly make the gate ignored and unenforced.
    check('Gate: passes when there are no executable new lines',
          rc == 0 and "no executable new lines" in out, f"rc={rc}")
    rc, out = gate("diff-coverage", "--diff", fx("diff_newfile.patch"),
                   "--coverage", fx("lcov_full.info"))
    check('Gate: detects new source completely absent from the report',
          rc == 1 and "untested.py" in out and "it was never measured" in out,
          f"rc={rc}")
    rc, out = gate("diff-coverage", "--diff", fx("diff_newfile.patch"),
                   "--coverage", fx("lcov_full.info"), "--allow-unmeasured")
    check('Gate: --allow-unmeasured downgrades that verdict to a warning',
          rc == 0 and "[WARN]" in out, f"rc={rc}")
    rc, out = gate("diff-coverage", "--diff", fx("diff_py.patch"),
                   "--coverage", fx("plan_ok.md"))
    check('Gate: unrecognized coverage format returns rc 2 instead of passing',
          rc == 2 and "cannot detect coverage format" in out, f"rc={rc}")
    rc, out = gate("diff-coverage", "--diff", fx("diff_py.patch"),
                   "--coverage", fx("missing-file.info"))
    check('Gate: missing input also returns rc 2 instead of silently passing',
          rc == 2 and "file not found" in out, f"rc={rc}")

    rc, out = gate("approvals", "--plan", fx("plan_ok.md"))
    check('Approval: passes a plan recording both approvals',
          rc == 0 and "two approvals are recorded" in out, f"rc={rc}")
    rc, out = gate("approvals", "--plan", fx("plan_no_case_approval.md"))
    check('Approval: missing case approval returns rc 1',
          rc == 1 and "no case approval record" in out, f"rc={rc}")
    rc, out = gate("approvals", "--plan", fx("plan_placeholder.md"))
    check('Approval: detects a placeholder approval (TBD)',
          rc == 1 and "placeholder" in out, f"rc={rc}")
    rc, out = gate("approvals", "--plan", fx("plan_out_of_order.md"))
    check('Approval: detects case approval preceding scenario approval',
          rc == 1 and "order is a gate" in out, f"rc={rc}")

    # (8b) Execute numeric and boundary controls. Earlier tests used only floors
    # of 90 and 40. Lowering the default to 60 still failed the 50% fixture;
    # changing >= to > also escaped. Both mutations stayed green.
    rc, out = gate("diff-coverage", "--diff", fx("diff_py.patch"),
                   "--coverage", fx("lcov_partial.info"))
    check(f'Gate: omitted arguments use floor {FAIL_UNDER}.0% (verified from output)',
          rc == 1 and f"floor {FAIL_UNDER}.0%" in out, f"rc={rc} · {last_line(out)}")
    rc, out = gate("diff-coverage", "--diff", fx("diff_py.patch"),
                   "--coverage", fx("lcov_partial.info"), "--fail-under", "50")
    check('Gate: a value exactly equal to the floor passes (>= boundary)',
          rc == 0 and "[PASS] diff coverage 50.0%" in out, f"rc={rc}")
    rc, out = gate("diff-coverage", "--diff", fx("diff_py.patch"),
                   "--coverage", fx("lcov_partial.info"), "--fail-under", "50.1")
    check('Gate: a value 0.1 below the floor fails (opposite boundary)',
          rc == 1 and "[FAIL] diff coverage 50.0%" in out, f"rc={rc}")

    # Mixed context/deletion/addition hunks. Addition-only @@ -n,0 +m,k @@
    # fixtures never exercised new-line arithmetic: skipping context increments
    # or incrementing on deletions both escaped.
    rc, out = gate("diff-coverage", "--diff", fx("diff_mixed.patch"),
                   "--coverage", fx("lcov_mixed.info"))
    check('Gate: mixed context/deletion/addition hunks yield correct new-line numbers',
          rc == 1 and "50.0% (1/2 new lines" in out and "mix.py: 10\n" in out,
          f"rc={rc} · {last_line(out)}")

    # Multi-file diff: single-file fixtures let stopping at the first file pass.
    rc, out = gate("diff-coverage", "--diff", fx("diff_multi.patch"),
                   "--coverage", fx("lcov_multi.info"))
    check('Gate: sums new lines across two files instead of stopping at the first',
          rc == 1 and "changed files 2" in out and "50.0% (2/4 new lines" in out
          and "two.py: 5-6" in out, f"rc={rc}")

    # Identify both unmeasured new files. A one-file fixture cannot detect
    # unmeasured[:1] or a gate changed to len(unmeasured) > 1.
    rc, out = gate("diff-coverage", "--diff", fx("diff_two_new.patch"),
                   "--coverage", fx("lcov_full.info"))
    check('Gate: identifies both unmeasured new files',
          rc == 1 and "alpha.py" in out and "beta.py" in out
          and out.count("it was never measured") == 2, f"rc={rc}")

    # Go coverprofile assigns execution counts to every line from block start
    # through end. Format/return-code checks missed dropping block end lines,
    # shrinking four new lines to one. Measure the denominator too.
    rc, out = gate("diff-coverage", "--diff", fx("diff_go.patch"),
                   "--coverage", fx("cover.out"))
    check('Gate: counts every line from start through end of a Go block (4/4)',
          rc == 0 and "100.0% (4/4 new lines" in out, f"rc={rc} · {last_line(out)}")

    # JaCoCo supplies filenames; package prefixes distinguish identical names.
    # Removing prefixes merges keys and lets uncovered source inherit counts
    # from covered source. A single-package fixture missed that mutation.
    rc, out = gate("diff-coverage", "--diff", fx("diff_jacoco_dup.patch"),
                   "--coverage", fx("jacoco_ambiguous.xml"))
    check('Gate: distinguishes identical filenames by package',
          rc == 1 and "0.0% (0/2 new lines" in out, f"rc={rc} · {last_line(out)}")

    # (8c) Environment backdoors.
    hostile = {k: "1" for k in BACKDOOR_ENV}
    rc, out = gate_env(hostile, "diff-coverage", "--diff", fx("diff_py.patch"),
                       "--coverage", fx("lcov_partial.info"))
    rc2, out2 = gate_env(hostile, "approvals", "--plan", fx("plan_placeholder.md"))
    check('Backdoor: disabling environment variables leave both verdicts at rc 1',
          rc == 1 and "50.0%" in out and rc2 == 1 and "placeholder" in out2,
          f"diff rc={rc} · approvals rc={rc2}")
    gsrc = read(GATES)
    check('Backdoor: checker never reads the environment (zero environ/getenv occurrences)',
          "environ" not in gsrc and "getenv" not in gsrc,
          f"environ {gsrc.count('environ')} · getenv {gsrc.count('getenv')}")

    # (8d) Every placeholder and missing-row cases.
    plan_body = read(fx("plan_ok.md"))
    survived, tmpd = [], tempfile.mkdtemp(prefix="tdd-plan-")
    try:
        for i, ph in enumerate(PLACEHOLDER_INPUTS):
            pp = os.path.join(tmpd, f"plan_{i}.md")
            with open(pp, "w", encoding="utf-8") as f:
                f.write(plan_body.replace("Case-Approved-By: Test Approver 2026-09-02",
                                          f"Case-Approved-By: {ph}"))
            prc, pout = gate("approvals", "--plan", pp)
            if not (prc == 1 and "placeholder" in pout):
                survived.append(ph)
        norows = os.path.join(tmpd, "plan_no_rows.md")
        with open(norows, "w", encoding="utf-8") as f:
            f.write("# TEST_PLAN\n\nScenario-Approved-By: Test Approver 2026-09-02\n\n"
                    "Case-Approved-By: Test Approver 2026-09-03\n")
        rc3, out3 = gate("approvals", "--plan", norows)
    finally:
        shutil.rmtree(tmpd, ignore_errors=True)
    check('Approval: rejects every placeholder (zero slack)',
          not survived, f"surviving placeholders {survived}")
    check('Approval: rejects approval-only plans without TS/TC rows',
          rc3 == 1 and "no scenario row (TS-NNN)" in out3
          and "no test-case row (TC-NNN)" in out3, f"rc={rc3}")

    # (8e) Cross-check fail-under values.
    off = []
    for rel, want_n in sorted(FU_SITES.items()):
        vals = FU_RE.findall(read(os.path.join(ROOT, rel)))
        if len(vals) != want_n or set(vals) != {FAIL_UNDER}:
            off.append(f"{rel} -> {vals}")
    check(f'Single value: all {sum(FU_SITES.values())} --fail-under sites in {len(FU_SITES)} files equal {FAIL_UNDER} (zero slack)',
          not off, f"mismatches {off}")
    stray = []
    for dirpath, _dirs, files in os.walk(ROOT):
        if "tests" in os.path.relpath(dirpath, ROOT).split(os.sep):
            continue
        for fname in files:
            if not fname.endswith(".md"):
                continue
            relp = os.path.relpath(os.path.join(dirpath, fname), ROOT)
            if relp not in FU_SITES and FU_RE.search(read(os.path.join(dirpath, fname))):
                stray.append(relp)
    check('Single value: no unlisted document contains --fail-under', not stray,
          f"unlisted {stray}")
    check('Single value: checker default equals the documented value',
          f'"--fail-under", type=float, default={FAIL_UNDER}.0' in gsrc,
          "declared default diverges from documentation")

    # (9) Anti-pattern contracts must survive an empty SKILL.md. A citation-only
    # check passes even when the referenced document is replaced by an empty shell.
    anti = read(os.path.join(ROOT, "references", "antipatterns.md"))
    check('Anti-pattern: provides alternatives for all three nondeterminism axes',
          all(x in anti for x in ("vi.useFakeTimers()", "freezegun",
                                  "tokio::time::advance()", "seed=42",
                                  "httptest.NewServer", "port 0"))
          and "sleep" in anti)
    check('Anti-pattern: supplies commands to reproduce order dependence',
          "go test -shuffle=on" in anti and "pytest -p randomly" in anti
          and "Passing once in shuffled order is not evidence" in anti)
    check('Anti-pattern: table fixes permitted test doubles by level',
          "| unit | All out-of-process dependencies |" in anti
          and "/generate-test --level" in anti
          and "produces a unit test" in anti)
    check('Anti-pattern: each item explains what it breaks',
          "What collapses" in anti and "Trust in the entire CI" in anti
          and "What passes is not the code but the mock" in anti)
    rows('Anti-pattern: permitted-double table rows preserve their values',
         anti, LEVEL_ROWS)
    rows('Anti-pattern: cost table rows preserve their values', anti, COST_ROWS)
    lost_xo = [x for x in XO_PAIRS if x not in anti]
    check('Anti-pattern: all ten [X]/[O] pairs survive (detects swapping)',
          not lost_xo, f"mismatched pairs {[x[:36] for x in lost_xo]}")
    swapped_anti = [h for h in SWAPPED_HEADERS if h in anti]
    check('Table: antipatterns.md contains no swapped-column header', not swapped_anti,
          f"{swapped_anti}")

    # (10) F-9/F-11: upstream once failed CI using a misquoted source.
    # Negative needles inspect the actual addopts line; a presence needle
    # cannot distinguish a retirement notice from restored configuration.
    py = read(os.path.join(LANGS, "python.md"))
    addopts = [ln for ln in py.splitlines() if ln.strip().startswith("addopts")]
    check('F-9: addopts contains no absolute coverage threshold',
          all("cov-fail-under" not in ln for ln in addopts), f"{addopts}")
    check('F-11: corrects the Google citation to three bands and explains retirement',
          "60%" in py and "75%" in py and "90%" in py
          and "explicitly cautions" in py and "Python-only tax" in py)

    # addopts alone leaves revival paths through [tool.coverage.report] or
    # separate pytest examples. Require absence from all code blocks and
    # presence only in prose describing retirement.
    def split_fence(text):
        inside, fenced, prose = False, [], []
        for ln in text.splitlines():
            if ln.lstrip().startswith("```"):
                inside = not inside
                continue
            (fenced if inside else prose).append(ln)
        return fenced, prose

    cov_off = []
    for rel in ["SKILL.md", "references/antipatterns.md"] + [
            f"langs/{f}" for f in sorted(on_disk)]:
        fenced, prose = split_fence(read(os.path.join(ROOT, rel)))
        got = (sum(1 for ln in fenced if "cov-fail-under" in ln),
               sum(1 for ln in prose if "cov-fail-under" in ln))
        want = (0, 3) if rel == "langs/python.md" else (0, 0)
        if got != want:
            cov_off.append(f"{rel} code blocks {got[0]} · prose {got[1]}")
    check('F-9: --cov-fail-under occurs only in three python.md prose locations and no code block',
          not cov_off, f"mismatches {cov_off}")

    # Zero-slack volume floors catch whole-section deletion, but a heading
    # check identifies which section vanished. Inserted retirement statements
    # require a negative axis; positive presence needles cannot detect them.
    sect = []
    for f in sorted(on_disk):
        body = read(os.path.join(LANGS, f))
        if DIFF_SECTION_HEAD not in body:
            sect.append(f"{f}: diff coverage section heading missing")
        for ln in body.splitlines():
            if "diff coverage" in ln and ("폐기" in ln or "더 이상" in ln
                                          or "discarded" in ln.lower() or "no longer" in ln.lower()
                                          or "deprecated" in ln.lower()):
                sect.append(f"{f}: retirement declaration — {ln.strip()[:40]}")
    check('Section presence: all seven guides retain diff coverage without retirement notices',
          not sect, f"{sect}")

    cmd = read(os.path.join(LANGS, "c.md"))
    check('Section presence: c.md preserves the MC/DC section and DO-178C level mapping',
          "## Safety Related Code — MC/DC" in cmd
          and "MC/DC is required for **Level A** (catastrophic failure) software according to DO-178C, while Level B"
          in cmd
          and "requires decision coverage and Level C requires statement coverage" in cmd
          and "-fcoverage-mcdc" in cmd,
          "MC/DC section was rotated or deleted")

    # State measurement limits: coverage is not correctness.
    check('Limits: diff gate does not measure correctness',
          "measures coverage, not correctness" in skill
          and "tautological assertion still counts as covered" in skill)
    check('Limits: states that there are seven language guides',
          "cover **seven** languages" in skill)

    check_skill_body(check, ROOT, needles=[
        "watch it fail", "Do not slice by layer", "Do not read the others",
        "must add one thing that runs", "human step",
        "test_gates.py diff-coverage", "`references/antipatterns.md`",
    ], floor=SKILL_FLOOR)

    # langs/ contains 1672 lines authored here, not imported material. While
    # excluded from coverage, its only contract was >=400 characters; replacing
    # all six guides with dummy text still passed 36/36. SKILL.md promises
    # frameworks, layouts, mock patterns, and commands for every later phase,
    # so empty guides make the skill empty too (external review evidence).
    check_ref_contracts(check, ROOT, [
        # Shared diff-coverage needles in all seven guides prevent returning
        # to a Python-only gate through --cov-fail-under.
        ("c.md", "Unity/gtest, linker seams, gcov branches, MC/DC",
         ["Unity", "`--wrap`", "gcov -b", "MC/DC", "DO-178C", "diff coverage"],
         C_FLOOR),
        ("go.md", "table-driven tests, interface mocking, stdlib vs testify, diff gate",
         ["Table-Driven Tests", "Interface-Based Mocking", "testify",
          "diff coverage"], GO_FLOOR),
        ("java.md", "JUnit 5, Mockito annotation distinctions, AssertJ, diff gate",
         ["@Mock vs @InjectMocks vs @Spy", "AssertJ", "AAA Pattern",
          "diff coverage"], JAVA_FLOOR),
        ("javascript.md", "framework selection, mock strategy, async testing, diff gate",
         ["Mock Strategy", "Asynchronous Testing", "AAA Pattern", "diff coverage"], JS_FLOOR),
        ("python.md", "three-step design protocol, scenarios, threshold retirement, diff gate",
         ["Three-step test design protocol", "Test Scenarios", "AAA Pattern",
          "diff coverage"], PY_FLOOR),
        ("rust.md", "cfg(test) philosophy, unit/integration distinction, mockall, diff gate",
         ["`#[cfg(test)]` Philosophy", "Unit Testing vs Integration Testing", "mockall",
          "diff coverage"], RUST_FLOOR),
        ("typescript.md", "type-safe mocks, three tsconfig files, NestJS, diff gate",
         ["Type-safe Mock Pattern", "tsconfig 3File Structure", "NestJS",
          "diff coverage"], TS_FLOOR),
    ], label_prefix="Language guide", subdir="langs")

    # Always visible regardless of language detection: clock/randomness/network,
    # order dependence, and permitted doubles by level. Moving these back into
    # language guides would make visibility depend on detection again.
    check_ref_contracts(check, ROOT, [
        ("antipatterns.md", "three flakiness axes, order dependence, permitted mocks by level",
         ["Axis 1 — clock", "Axis 2 — randomness", "Axis 3 — network and shared resources",
          "go test -shuffle=on", "/generate-test --level",
          "integration in name only"], ANTI_FLOOR),
    ])

    # Run the three copy-control axes last: live_ran counts accumulated results.
    # Earlier execution would omit later guide/anti-pattern contracts from the
    # baseline, creating free slack that lets missing copy checks satisfy
    # copy >= baseline. Exclude early-returning meta prefixes on both sides.
    META = ("자기검사:", "계약 커버리지:", "스크립트 계약:")
    live_ran = sum(1 for r in results if not r[0].startswith(META))

    check_contract_coverage(check, __file__, ROOT, per_file=PER_FILE,
                            live_ran=live_ran)
    check_body_deletion(check, __file__, ROOT, minimum=BODY_MIN,
                        live_ran=live_ran)
    # scripts/ is outside document-contract coverage. Separately empty the
    # script and measure failures; otherwise an empty gate checker stays green.
    check_script_contracts(check, __file__, ROOT,
                           scripts={"scripts/test_gates.py": GATE_MIN},
                           live_ran=live_ran)

    check_no_constant_assertions(check, __file__)
    check_total(check, results, TOTAL)

    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n{passed}/{len(results)} 통과")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
