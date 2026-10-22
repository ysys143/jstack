#!/usr/bin/env python3
"""setup contract suite.

Run: python3 tests/run_tests.py   (from skills/setup)

## What this locks

1. **Read, report, then propose** — setup that proposes first installs a second
   set of rules next to the ones the repository already had.
2. **Finding it already done differently is success** — otherwise the skill has
   an incentive to change things to justify itself.
3. **Never silently rewrite shared configuration** — this repository has already
   found an installer that rewrote a settings file other tools also write.
4. **Verify by running** — a configuration that looks right is not one that
   works, and an inherited red state must be named as inherited.
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
# E402: this import must follow the sys.path adjustment above because the suite
# library lives outside the skill tree and cannot be found until the path is set.
from _suite_lib import (  # noqa: E402
    check_no_constant_assertions,
    check_total,
    check_skill_body,
    check_ref_contracts,
    check_script_contracts,
    split_frontmatter,
    check_body_deletion,
    check_contract_coverage,
)  # noqa: E402

ROOT = os.path.dirname(HERE)
SKILLS = os.path.dirname(ROOT)
# Reference-document size floors, fixed from measured `content_bytes` values.
REF_FLOORS = {
    "convention-conflicts.md": 4436,
    "python-convention.md": 6013,
}
LOADER = os.path.join(ROOT, "scripts", "load_guidelines.py")

# Prefixes excluded from the suite's "live check" count. Self-check, coverage,
# and script-contract checks do not run on copies, so both counts must exclude them.
META = ("자기검사:", "계약 커버리지:", "스크립트 계약:")

results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))


def read(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


def load_seq(*runs, seed=None):
    """**Actually run the loader.** Apply argument groups to one target in order
    and return `(rc, output, target file content)` for each group.

    This axis measures behavior rather than prose; emptying the script breaks it.
    """
    work = tempfile.mkdtemp()
    try:
        target = os.path.join(work, "CLAUDE.md")
        if seed is not None:
            with open(target, "w", encoding="utf-8") as f:
                f.write(seed)
        out = []
        for args in runs:
            r = subprocess.run(
                [sys.executable, LOADER, "--target", target, *args],
                capture_output=True,
                text=True,
                timeout=60,
            )
            body = read(target) if os.path.exists(target) else ""
            out.append((r.returncode, r.stdout + r.stderr, body))
        return out
    finally:
        shutil.rmtree(work, ignore_errors=True)


def load_run(args, seed=None):
    return load_seq(args, seed=seed)[0]


def datarows(text, head, header_cell):
    """Return **data rows** in the table below `## head`, excluding its named header."""
    return [r for r in rows(text, head) if not r.strip().startswith(header_cell)]


def rows(text, head):
    """Return table rows below `## head`, or an empty list when the section is absent."""
    if head not in text:
        return []
    body = text.split(head, 1)[1].split("\n## ", 1)[0]
    return [
        r
        for r in re.findall(r"(?m)^\| (?!---)(.+?) \|", body)
        if r.strip() not in ("Do", "Read")
    ]


def main():
    fm, skill = split_frontmatter(read(os.path.join(ROOT, "SKILL.md")))
    cl = read(os.path.join(ROOT, "references", "checklist.md"))

    # (1) Read, report, then propose
    check('Order: locks the three stages in sequence', "**read, report, then propose.**" in skill)
    check(
        'Order: explains that ignoring existing guidance creates a second rule set',
        "installs a second set of rules" in skill,
    )
    check(
        'Order: explains that the result becomes a guess for the next contributor',
        "has to guess which one applies" in skill,
    )
    check(
        'Order: names at least four concrete sources to read',
        "conventions file" in skill
        and "test layout" in skill
        and "commit history" in skill
        and "lint configuration" in skill,
    )
    check('Order: treats internal contradictions as reportable findings', "contradicts itself" in skill)
    check(
        'Order: says that discovering the repository already works differently is success',
        "a\nsuccessful outcome of this skill" in skill
        or "successful outcome of this skill" in skill,
    )

    # (2) Make the smallest change
    tbl = rows(skill, "## Change the fewest things")
    expected_choices = {
        ("Add what is missing and needed now", "Add configuration for a tool nobody uses yet"),
        ("Adopt the existing style even where you would choose another", "Reformat the tree to a preferred style"),
        ("Write down a convention already followed in practice", "Invent a convention the code does not follow"),
        ("Leave a working setup alone", "Replace a working tool with an equivalent one"),
    }
    section = (skill.split("## Change the fewest things", 1)[1].split("\n## ", 1)[0]
               if "## Change the fewest things" in skill else "")
    actual_choices = {tuple(cell.strip() for cell in row.split("|"))
                      for row in re.findall(r"(?m)^\| (.+) \|$", section)
                      if "---" not in row and not row.startswith("Do |")}
    check('Restraint: pairs each of four preservation decisions with the correct prohibition',
          expected_choices <= actual_choices,
          f"missing {sorted(expected_choices - actual_choices)}")
    check(
        'Restraint: requires following the existing style',
        "even where you would choose another" in skill,
    )
    check('Restraint: applies each table row as an evidence-based preservation decision',
          "every row as a preservation decision" in skill
          and "require current evidence" in skill)
    check(
        'Restraint: states the value of a consistent house style',
        "one consistent style is worth" in skill,
    )
    check('Restraint: forbids adding configuration for tools nobody uses', "nobody uses yet" in skill)
    check(
        'Restraint: forbids replacing a working tool with an equivalent',
        "Replace a working tool" in skill,
    )

    # (3) Do not silently change shared settings
    check(
        'Configuration: forbids silently rewriting shared settings',
        "Never silently rewrite shared configuration" in skill,
    )
    check(
        "Configuration: explains how that path destroys someone else's state",
        "destroys\nsomeone else's state" in skill
        or "destroys someone else's state" in skill,
    )
    check(
        'Configuration: instructs the agent to show the exact change for the user to apply',
        "let the user apply it" in skill,
    )
    check(
        'Configuration: notes that other contributors are not present in this conversation',
        "not in this\nconversation" in skill or "not in this conversation" in skill,
    )
    check(
        'Configuration: forbids writes outside the repository without advance notice',
        "without saying so first" in skill,
    )
    check(
        'Configuration: explains that home-directory settings affect other projects',
        "every other project on that machine" in skill,
    )

    # (4) Report what was not done
    check(
        'Reporting: requires reporting preserved items and passing checks',
        "deliberately left\nalone" in skill or "deliberately left alone" in skill,
    )
    check(
        'Reporting: explains that listing only changes makes everything else look absent',
        "everything else was" in skill,
    )
    check('Reporting: explains that omission forces the next person to repeat the reading', "redoes the reading" in skill)

    # (5) Run it to verify
    check(
        'Verification: states that plausible-looking configuration is not necessarily working configuration',
        "is not a configuration that works" in skill,
    )
    check(
        'Verification: requires running one real command',
        "Run the test" in skill and "the build — once, after the change" in skill,
    )
    check(
        'Verification: requires disclosing pre-existing failures with their output',
        "say so\nwith the output" in skill or "say so with the output" in skill,
    )
    check('Verification: explains that silence makes an existing failure look newly introduced', "look like yours" in skill)

    # (6) Reading-order checklist
    rd = rows(cl, "## The reading order")
    check('Checklist: the reading-order table has five rows', len(rd) == 5, f"{len(rd)} rows")
    check('Checklist: every row says what to do when its target is absent', "If absent" in cl)
    check(
        'Checklist: explains why convention files come first and CI last',
        "what it actually enforces" in cl,
    )
    check(
        'Checklist: reports disagreement between sources instead of choosing a side',
        "rather than picking a side" in cl,
    )
    check(
        "Checklist: says that choosing the test framework is outside this skill's authority",
        "the choice is not yours" in cl,
    )

    # (7) Findings to report even when nothing changes
    fnd = re.findall(r"(?m)^- \*\*(.+?)\*\*", cl)
    check('Findings: the no-change report has four items', len(fnd) == 4, f"{len(fnd)} items")
    check(
        'Findings: explains the impact of test failures in a clean checkout',
        "unverifiable until this is settled" in cl,
    )
    check('Findings: explains that formatter conflict creates endless diff churn', "churns forever" in cl)
    check(
        'Findings: hands credentials to secrets and forbids fixing them here',
        "hand it to the `secrets`" in cl,
    )
    check(
        'Findings: explicitly keeps that case out of the setup pass',
        "not fix it as part of a setup pass" in cl,
    )

    # (8) Work outside setup's scope
    check(
        'Scope: places installation, home-directory state, and remote state out of scope',
        "changing remote state" in cl and "home directory" in cl,
    )
    check(
        'Scope: says that helpful actions can still be out of scope',
        "even when they would obviously help" in cl,
    )
    check(
        'Scope: explains that out-of-checkout changes cannot be restored with git checkout',
        "undone by a `git checkout`" in cl,
    )

    # (9) Boundaries and language
    named = set(re.findall(r"`([a-z][a-z-]{2,})`\s*skill", skill))
    missing = [n for n in named if not os.path.isdir(os.path.join(SKILLS, n))]
    check(
        'Boundary: the handoff-target population is nonempty', len(named) >= 2, f"{sorted(named)}"
    )
    check('Boundary: every handoff target exists', not missing, f"absent {missing}")
    check(
        'Language: the description contains Korean triggers',
        len(re.findall(r"[가-힣]+", fm)) >= 5,
    )
    check('Language: the description also contains an English trigger', "setup" in fm)
    check(
        'L0: the description carries both read-first and minimal-change contracts',
        "read what is already there" in fm and "fewest things" in fm,
    )

    # Registering the PR policy is the only item this skill cannot leave unchanged.
    # Absence is indistinguishable from "no policy"; if that rationale disappears,
    # the next maintainer may delete this clause as a minimal-change violation.
    check(
        'Convention: explains why a missing PR policy cannot simply be left alone',
        "indistinguishable" in skill and ".claude/pr-policy.json" in skill,
    )
    check('Convention: says that an empty policy file can be the real answer', "real answer, not a fallback" in skill)
    check('Convention: forbids inventing labels that do not exist', "Do not invent labels" in skill)

    # (10) The skill body carries the preset loader
    maintenance = read(os.path.join(ROOT, "references", "instruction-maintenance.md"))
    check(
        'Guidance: the separate mode reaches maintenance instructions and its executor without leaking into initial setup',
        "references/instruction-maintenance.md" in skill
        and "scripts/instruction_inventory.py" in skill
        and "do not\ncontinue into PR policy registration" in skill,
    )
    check(
        'Guidance: review is read-only and an already authorized fix does not require renewed approval',
        "Review requests are read-only" in skill
        and "do not ask for the same approval again" in skill,
    )
    check(
        'Guidance: allows valid no-change, modification, deletion, and move outcomes',
        "Correct, remove, or relocate stale rules" in skill
        and "Healthy guidance may need no change" in skill,
    )
    check(
        'Guidance: requires conflicts to show scope and a failure case, and treats unrun commands as unverified',
        "Both clauses, overlapping scope" in maintenance
        and "unexecuted commands as unverified" in maintenance,
    )
    comment = read(os.path.join(ROOT, "references", "comment-convention-governance.md"))
    check(
        'Comment lint: activation is conditional and reaches its reference',
        "When the request concerns comment style" in skill
        and "references/comment-convention-governance.md" in skill
        and "Do not load it for ordinary setup" in skill,
    )
    check(
        'Comment lint: starts from repository evidence and separates three comment classes',
        "Read the repository before choosing a rule" in comment
        and "General line or block comment" in comment
        and "JSDoc" in comment
        and "ESLint directive comment" in comment,
    )
    check(
        'Comment lint: evaluates maintained ESLint choices before a local rule',
        "capitalized-comments" in comment
        and "eslint-plugin-jsdoc" in comment
        and "@eslint-community/eslint-plugin-eslint-comments" in comment
        and "only then a project-local rule" in comment,
    )
    check(
        'Comment lint: canonical rule pack owns source, fixtures, RuleTester, rationale, and owner',
        "one canonical project rule pack" in comment
        and "good, bad, and exception fixtures" in comment
        and "`RuleTester`" in comment
        and "rationale" in comment
        and "accountable owner" in comment,
    )
    check(
        'Comment lint: subjective prose advances from shadow through hook to CI',
        "warning or shadow report" in comment
        and "Staged-file hook" in comment
        and "CI enforcement" in comment
        and "final authority" in comment,
    )
    check(
        'Comment lint: handles no-verify, closest-config isolation, and inherited violations',
        "git commit --no-verify" in comment
        and "closest configuration owns a staged file" in comment
        and "configurations\nare isolated rather than merged" in comment
        and "old,\nunrelated comments" in comment,
    )
    check(
        'Comment lint: prepares an exact review packet with trigger boundaries and rollback',
        "Observed convention:" in comment
        and "Trigger examples:" in comment
        and "Non-trigger examples:" in comment
        and "Exceptions:" in comment
        and "Affected files and packages:" in comment
        and "Reviewer or accountable owner:" in comment
        and "Rollback command or diff:" in comment,
    )
    check(
        'Comment lint: external review and shared mutations remain behind authorization',
        "prepare the exact CODEOWNERS line" in comment
        and "must not create or ready a pull request" in comment
        and "without the user's authorization" in comment,
    )
    inventory_tests = subprocess.run(
        [sys.executable, os.path.join(HERE, "test_instruction_inventory.py")],
        capture_output=True, text=True, timeout=60,
    )
    check(
        'Guidance: live executor boundary counterexamples pass, including failure when the checker is absent',
        inventory_tests.returncode == 0
        and bool(re.search(r"Ran [1-9][0-9]* tests?", inventory_tests.stderr)),
        inventory_tests.stderr[-600:],
    )

    check(
        'Preset: explains that the loader only appends and never edits existing content',
        "It appends; it never" in skill,
    )
    check(
        'Preset: directs conflict resolution to the reference document',
        "references/convention-conflicts.md" in skill
        and "applied at random" in skill,
    )
    check(
        'Python: says the six keys are the entire negotiation surface and links the reference',
        "the whole negotiating surface" in skill
        and "references/python-convention.md" in skill,
    )

    # (12) Conflict precedence — F-3 · F-4 · F-5
    cc = read(os.path.join(ROOT, "references", "convention-conflicts.md"))
    cl_map = datarows(cc, "## Name the clauses, never the numbers", "Clause")
    check('Conflict: the clause-to-number mapping has eight rows', len(cl_map) == 8, f"{len(cl_map)} rows")
    check(
        'Conflict: requires clause names because numbering drifts between versions',
        "Write the clause name." in cc,
    )
    aut = datarows(
        cc,
        "## Fix Bugs Autonomously vs Think Before Coding and Surgical Changes",
        "Situation",
    )
    check('Conflict: the autonomous-fix decision table has four rows', len(aut) == 4, f"{len(aut)} rows")
    check(
        'Conflict: limits autonomous fixes to teams with a reviewer',
        "scope creep under a better name" in cc and "No reviewer" in cc,
    )
    ele = datarows(
        cc, "## Demand Elegance vs Minimal Impact and Simplicity First", "Moment"
    )
    check('Conflict: the elegance-versus-minimal-change table has four rows', len(ele) == 4, f"{len(ele)} rows")
    check(
        'Conflict: states that elegance is a design-time question',
        "not a licence to rewrite working code afterwards" in cc,
    )
    own = datarows(
        cc, "## Plan Before You Build was transferred, not lost", "Clause cut from"
    )
    check('Conflict: the ownership-handoff table has three rows', len(own) == 3, f"{len(own)} rows")
    check(
        'Conflict: explains that an unrecorded handoff is indistinguishable from an omission',
        "indistinguishable from an omission" in cc,
    )

    # (13) Six [tool.claude-hooks] keys
    pc = read(os.path.join(ROOT, "references", "python-convention.md"))
    KEYS = (
        "enforce_uv",
        "enforce_venv_check",
        "ruff_check",
        "pre_commit_check",
        "auto_format",
        "pyright_check",
    )
    sw = datarows(pc, "## The six switches", "Key")
    check('Python: the switch table has six rows', len(sw) == 6, f"{len(sw)} rows")
    # **Measure the row-to-value mapping literally.** Row count and "names all six
    # keys" do not move when a key **inside** the table changes: `enforce_venv_check`
    # also appears in the quoting decision table below, so name presence remains
    # true and the row count remains six. Replacing it with `show_fixable` was caught
    # only by a six-byte size difference; a same-length replacement passed all four
    # axes (name presence, row count, 6173B >= 6013, and 99% line survival). Compare
    # order too, because a set-only check would miss swapping two rows.
    sw_keys = tuple(r.strip().strip("`") for r in sw)
    check(
        'Python: switch-table keys match all six keys in order',
        sw_keys == KEYS,
        f"{list(sw_keys)}",
    )
    unnamed = [k for k in KEYS if f"`{k}`" not in pc]
    check('Python: names all six keys', not unnamed, f"missing {unnamed}")
    check('Python: explicitly states there is no seventh key', "There is no seventh." in pc)
    check(
        'Python: says enforce_uv is the only escape hatch for legacy pip',
        "only escape hatch" in pc and "uninstall" in pc,
    )
    trap = datarows(
        pc,
        "## The table is matched by substring, not parsed as TOML",
        "What the code does",
    )
    check('Python: the string-comparison trap table has four rows', len(trap) == 4, f"{len(trap)} rows")
    quoted = datarows(
        pc, "## The quoted form works for three keys and half of a fourth", "Key"
    )
    check('Python: the quoting decision table has seven rows', len(quoted) == 7, f"{len(quoted)} rows")
    check(
        'Python: notes that quoted forms are ignored by the commit gate',
        'pyright_check = "true"' in pc and "vanish from the gate" in pc,
    )
    check(
        'Python: explains that the commit hook reads a different pyproject.toml',
        "git rev-parse --show-toplevel" in pc and "monorepo" in pc,
    )
    check(
        'Python: assigns the two model keys to another skill',
        "models/references/exceptions.md" in pc
        and "approved_legacy_models" in pc,
    )

    # (11) Loader — measure **behavior**, not prose
    rc_desc, out_desc, _ = load_run(["--describe"])
    check(
        'Loader: --describe prints useful output and exits successfully',
        rc_desc == 0 and bool(out_desc.strip()),
        f"rc={rc_desc} / {len(out_desc)} chars",
    )
    presets = ("karpathy", "kentbeck", "cherny", "fowler",
               "cleancode", "osi", "feathers", "owasp")
    absent = [k for k in presets if f"--{k}" not in out_desc]
    check('Loader: --describe lists all eight presets', not absent, f"missing {absent}")
    check(
        'Loader: --describe uses paths rooted at the plugin root',
        "${CLAUDE_PLUGIN_ROOT}/skills/setup/scripts/load_guidelines.py" in out_desc,
    )

    rc_none, out_none, _ = load_run([])
    check('Loader: invocation without a flag fails', rc_none == 2, f"rc={rc_none}")
    check(
        'Loader: that failure explains what is required',
        "guideline flag is required" in out_none,
    )

    seed = "# Project\n\nhouse rules already written here\n"
    rc_k, out_k, body_k = load_run(["--karpathy"], seed=seed)
    check(
        'Loader: injects the selected preset',
        rc_k == 0 and "## Karpathy Coding Guidelines" in body_k,
        f"rc={rc_k}",
    )
    check(
        'Loader: appends without overwriting existing content',
        body_k.startswith(seed) and body_k != seed,
    )
    check(
        'Loader: does not inject unselected presets',
        "## OWASP Security Guidelines" not in body_k
        and "## Karpathy Coding Guidelines" in body_k,
    )
    check(
        'Loader: does not reference the removed git-plugin skill',
        "git:branch-name-convention" not in body_k and "`gitrules` skill" in body_k,
    )

    twice = load_seq(["--karpathy"], ["--karpathy"], seed=seed)
    check(
        'Loader: does not inject a preset that is already present',
        twice[0][2] == twice[1][2]
        and "## Karpathy Coding Guidelines" in twice[1][2],
    )
    check('Loader: reports the skipped injection', "Already present" in twice[1][1])

    _, _, body_c = load_run(["--cherny"])
    _, _, body_cf = load_run(["--cherny-full"])
    n_c = len(re.findall(r"(?m)^### \d+\. ", body_c))
    n_cf = len(re.findall(r"(?m)^### \d+\. ", body_cf))
    check('Loader: --cherny contains the abbreviated five principles', n_c == 5, f"{n_c} principles")
    check('Loader: --cherny-full contains the full eight principles', n_cf == 8, f"{n_cf} principles")
    # F-1 — prevent orchestration rules from landing in CLAUDE.md as code rules.
    check(
        'F-1: the abbreviated injection identifies itself as orchestration guidance',
        "Agent Orchestration Practices" in body_c,
    )
    check(
        'F-1: the full version identifies one code-specific clause separately',
        "Agent Orchestration Practices" in body_cf
        and "### 7. Core Principles" in body_cf,
    )

    check_skill_body(
        check,
        ROOT,
        needles=[
            "**read, report, then propose.**",
            "Never silently rewrite shared configuration",
            "is not a configuration that works",
            "Treat every row as a preservation decision: require current evidence before",
            "everything else was",
            "real answer, not a fallback",
        ],
        floor=5402,
    )

    check_ref_contracts(
        check,
        ROOT,
        [
            (
                "instruction-maintenance.md",
                "host scope · evidence-based correction · approval boundary",
                [
                    "Separate discovery, applicability, and actual loading",
                    "No defect is a valid no-change result.",
                    "never as mentally verified passes",
                ],
                5205,  # content_bytes measured with the needles above.
            ),
            (
                "checklist.md",
                "reading order · no-change report · out of scope",
                [
                    "what it actually enforces",
                    "unverifiable until this is settled",
                    "churns forever",
                    "undone by a `git checkout`",
                ],
                1416,
            ),
            (
                "convention-conflicts.md",
                "preset conflict precedence · ownership handoff",
                [
                    "Without a reviewer, \"fix it without asking\" is scope creep "
                    "under a better name.",
                    "Elegance is a question asked at design time, not a licence to "
                    "rewrite working code afterwards.",
                    "But an unrecorded transfer is indistinguishable from an omission.",
                ],
                REF_FLOORS["convention-conflicts.md"],
            ),
            (
                "python-convention.md",
                "six [tool.claude-hooks] keys · string-comparison trap",
                [
                    "`enforce_uv = false` is the only escape hatch a repository that "
                    "cannot move to uv has.",
                    "It is the only switch whose default is off, and the only one two "
                    "hooks read.",
                    "None of the three hooks parses TOML.",
                ],
                REF_FLOORS["python-convention.md"],
            ),
        ],
        population=[
            "instruction-maintenance.md",
            "checklist.md",
            "convention-conflicts.md",
            "python-convention.md",
        ],
    )

    # **All three axes use the same baseline count.** Count before
    # `check_script_contracts`, which also checks deletion, so its own result cannot
    # enter the baseline and skew the copy comparison. META excludes the prefix and
    # would keep the value equal, but this ordering makes the invariant explicit.
    live_ran = sum(1 for r in results if not r[0].startswith(META))
    check_script_contracts(
        check, __file__, ROOT, scripts={"scripts/load_guidelines.py": 15,
                                      "scripts/instruction_inventory.py": 1},
        live_ran=live_ran,
    )
    # **Reference floors were remeasured (2026-09-02).** Previous values were one
    # too high per reference: the line-survival axis moved under the `self-check:`
    # prefix and left the copy-failure count, but the floors were not lowered. A
    # `return` in `_suite_lib`'s reference loop (fixed in e55fe98) kept the deletion
    # guard red, so **floor checks were skipped** and hid the mismatch. No contract
    # disappeared; each file was copied and its failure list enumerated and compared.
    check_contract_coverage(
        check,
        __file__,
        ROOT,
        per_file={
            "SKILL.md": 44,
            "references/instruction-maintenance.md": 5,
            "references/checklist.md": 16,
            "references/comment-convention-governance.md": 7,
            "references/convention-conflicts.md": 11,
            "references/python-convention.md": 13,
            "scripts/load_guidelines.py": 15,
            "scripts/instruction_inventory.py": 1,
        },
        live_ran=live_ran,
    )
    check_body_deletion(
        check,
        __file__,
        ROOT,
        minimum=43,
        live_ran=live_ran,
    )
    check_no_constant_assertions(check, __file__)
    check_total(check, results, 128)

    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n{passed}/{len(results)} 통과")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
