#!/usr/bin/env python3
"""Agent contract suite.

Usage: python3 tests/test_agents.py (from the staged developer package).

## What this locks

Agents are **roles** running in a separate context, so their contracts matter
more than their skills: a bad role may be invisible here and only fail in its report.

1. **Separate roles** — auditors do not fix, executors do not judge, and verifiers do neither
2. **Report when nothing exists** — fabricated output is the common failure
3. **Attach evidence** — a report without paths or counts cannot be accepted or rejected
4. **Use canonical sources and create no copies**
"""
import os
import re
import sys

sys.dont_write_bytecode = True
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "skills"))
from _suite_lib import (check_no_constant_assertions, check_total,
                        check_ref_contracts, check_contract_coverage,
                        split_frontmatter)  # noqa: E402
AG = os.path.join(ROOT, "agents")
SKILLS = os.path.join(ROOT, "skills")

WANT = ("quality-auditor", "quality-executor", "quality-verifier",
        "sag-automation-scout", "sag-doc-updater", "sag-duplicate-checker",
        "sag-followup-suggester", "sag-learning-extractor")

results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))


def read(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


def main():
    all_names = sorted(f[:-3] for f in os.listdir(AG) if f.endswith(".md"))
    check("Inventory: the unified agent count is 17", len(all_names) == 17, f"{all_names}")
    names = sorted(WANT)
    for w in WANT:
        check(f"Inventory: {w} is present", w in names)

    fms, bodies = {}, {}
    for n in names:
        fm, body = split_frontmatter(read(os.path.join(AG, n + ".md")))
        fms[n], bodies[n] = fm, body
        check(f"Format: {n} name matches its filename",
              bool(re.search(rf"(?m)^name:\s*{re.escape(n)}\s*$", fm)))
        check(f"Format: {n} has a description",
              bool(re.search(r"(?m)^description:\s*\S", fm)))
        check(f"Format: {n} declares a model (no hidden inheritance)",
              bool(re.search(r"(?m)^model:\s*(haiku|sonnet|opus)\s*$", fm)))
        check(f"Body: {n} contains procedure or judgment", len(body.strip()) > 500,
              f"{len(body.strip())}B")
        # **Does it report when nothing exists?** Fabricated output is this agent
        # family's most common failure.
        check(f"Restraint: {n} accepts no output as a valid result",
              ("Report no findings when there are none" in bodies[n]
               or "Report none when appropriate" in bodies[n]
               or "Report none if nothing remains" in bodies[n]
               or "yield no learning" in bodies[n]
               or "report that without editing" in bodies[n]
               or "label unverified claims as\nunverified" in bodies[n]
               or "**Report none**" in bodies[n]
               or "zero is correct" in bodies[n]))

    # (1) Role separation — quality agents do not do one another's work.
    check("Separation: auditor does not fix", "Do not fix anything" in bodies["quality-auditor"])
    check("Separation: auditor explains why edits go unjudged", "nobody judges that edit" in bodies["quality-auditor"])
    check("Separation: executor stays within reported scope", "Fix only reported issues" in bodies["quality-executor"])
    check("Separation: executor rejects rewriting a module for one finding", "one-line finding" in bodies["quality-executor"])
    check("Separation: verifier does not fix", "Do not fix issues" in bodies["quality-verifier"])
    check("Separation: verifier rejects unverified passing signals", "passing signal without verification" in bodies["quality-verifier"])
    check("Separation: duplicate-checker creates no suggestions", "Do not create new suggestions" in bodies["sag-duplicate-checker"])
    check("Separation: duplicate suggestions have no verifier", "no verifier" in bodies["sag-duplicate-checker"])

    # (2) Canonical references — do not create copies.
    check("Canonical: auditor names quality-taxonomy", 
          "skills/cleanup/references/quality-taxonomy.md" in bodies["quality-auditor"])
    check("Canonical: auditor forbids copies",
          "Do not create a copy" in bodies["quality-auditor"])
    tax = os.path.join(SKILLS, "cleanup", "references", "quality-taxonomy.md")
    check("Canonical: the source exists", os.path.isfile(tax))

    # (3) Judgment principles and evidence.
    check("Judgment: auditor's default verdict is blocked",
          "The default verdict is **blocked**" in bodies["quality-auditor"])
    check("Judgment: reversing the burden resembles inspecting nothing",
          "indistinguishable from inspecting\nnothing" in bodies["quality-auditor"])
    check("Judgment: auditor reports unchecked scope",
          "Say what you did not inspect" in bodies["quality-auditor"])
    check("Review termination: auditor keeps stable IDs and focuses correction follow-ups",
          "Keep finding IDs stable" in bodies["quality-auditor"] and
          "reported defects" in bodies["quality-auditor"] and
          "evidence before reopening" in bodies["quality-auditor"])
    check("Judgment: silence does not mean checked and fine",
          "checked and fine" in bodies["quality-auditor"])

    # (4) Verifier core — vanished checks.
    check("Verification: fewer checks are not a pass",
          "fewer checks is not a pass" in bodies["quality-verifier"])
    check("Verification: vanished checks do not fail",
          "target disappears" in bodies["quality-verifier"])
    check("Verification: zero passing checks are not a pass",
          "Zero passing checks is not a pass" in bodies["quality-verifier"])
    check("Verification: the procedure has four steps",
          len(re.findall(r"(?m)^\d\. \*\*", bodies["quality-verifier"])) == 4)
    check("Verification: it reuses only evidence bound to matching inputs and environment",
          "inputs" in bodies["quality-verifier"] and "relevant environment still match" in bodies["quality-verifier"])
    check("Verification: it requires reading more than the exit code",
          "do not inspect only the exit code" in bodies["quality-verifier"])

    # (5) Executor lock.
    check("Lock: executor gives three preconditions",
          "directly observed tests passing" in bodies["quality-executor"])
    check("Lock: executor stops when the lock is unavailable", "stop" in bodies["quality-executor"])
    check("Lock: axis order puts swallowed exceptions first",
          "before" in bodies["quality-executor"])
    check("Lock: executor reverts a failed pass instead of patching forward",
          "revert that pass" in bodies["quality-executor"])
    check("Lock: deleting tests is not a fix",
          "Deleting tests to make them green is not a fix" in bodies["quality-executor"])

    # (6) Nontrivial judgment in the SAG agents.
    check("Judgment: doc-updater selects only what code cannot state",
          "what code cannot explain itself" in bodies["sag-doc-updater"])
    check("Judgment: doc-updater requires a file and section",
          "target file and section" in bodies["sag-doc-updater"])
    check("Judgment: automation-scout compares identical decisions, not counts",
          "same decision each time" in bodies["sag-automation-scout"])
    check("Judgment: automation-scout gives four forms",
          all(w in bodies["sag-automation-scout"]
              for w in ("Script", "Command", "Skill", "No automation")))
    check("Judgment: learning-extractor learns only from mismatches",
          "a mismatch between expectation and reality" in bodies["sag-learning-extractor"])
    check("Judgment: learning-extractor forbids general maxims",
          "Do not generalize into maxims" in bodies["sag-learning-extractor"])
    check("Judgment: followup-suggester distinguishes three cases",
          all(w in bodies["sag-followup-suggester"]
              for w in ("Deliberately omitted", "Out of scope", "Time or sequence prevented completion")))
    check("Judgment: followup-suggester orders by propagated blocking",
          "propagated blocking" in bodies["sag-followup-suggester"])
    check("Judgment: duplicate-checker requires an inspected location",
          "inspected location" in bodies["sag-duplicate-checker"])
    check("Judgment: duplicate-checker calls pathless existing claims impressions",
          "impression" in bodies["sag-duplicate-checker"])

    # (7) Named skill paths exist.
    on_disk = {d for d in os.listdir(SKILLS)
               if os.path.isdir(os.path.join(SKILLS, d))
               and os.path.exists(os.path.join(SKILLS, d, "SKILL.md"))}
    named = set()
    for b in bodies.values():
        named |= set(re.findall(r"skills/([a-z][a-z0-9-]+)/", b))
    check("References: named skill paths are nonempty", len(named) >= 1, f"{sorted(named)}")
    check("References: every named skill exists",
          all(m in on_disk for m in named),
          f"missing {[m for m in named if m not in on_disk]}")


    # **Lock three axes of each agent body.** The former suite's docstring said
    # contracts matter more than skills but checked only "500 characters or more";
    # replacing the body with filler still produced 89/89 (external review:
    # sag-followup-suggester).
    check_ref_contracts(check, ROOT, [
        ("quality-auditor.md", "read-only · blocked by default · unchecked scope",
         ["Do not fix anything", "default verdict is **blocked**",
          "Say what you did not inspect", "Do not create a copy"], 1073),
        ("quality-executor.md", "three lock conditions · axis order · scope",
         ["directly observed tests passing", "revert that pass", "Fix only reported issues",
          "one-line finding"], 1068),
        ("quality-verifier.md", "four steps · vanished checks · unverified state",
         ["identifying and running", "target disappears", "Zero passing checks is not a pass",
          "unverified"], 955),
        ("sag-automation-scout.md", "identical decisions · four forms",
         ["same decision each time", "No automation", "cost of being wrong"], 1012),
        ("sag-doc-updater.md", "code-inferability · file and section",
         ["cannot infer from code", "not yet a concrete proposal", "Do not edit documentation directly"], 1033),
        ("sag-duplicate-checker.md", "inspected location · no new suggestions",
         ["inspected location", "Do not create new suggestions", "no verifier"], 904),
        ("sag-followup-suggester.md", "three distinctions · blocking order",
         ["Deliberately omitted", "Out of scope", "could not be completed", "propagated blocking"], 843),
        ("sag-learning-extractor.md", "mismatch-only learning · reproduction · no maxims",
         ["newly established session learning", "reproduction path", "Do not generalize into maxims"], 1128),
    ], label_prefix="Agent contract", subdir="agents", population=WANT)

    # **Deletion-regression axis.** The three axes protect document *content*, but
    # nobody checked whether the suite **read that content**. Replacing all 53
    # judgments with tautologies still passed (review 4); every floor is measured.
    _ran = sum(1 for r in results
               # **Do not keep dead prefixes.** This suite has no judgment starting
               # with `References: /`; it was copied from test_commands.py. Such a
               # prefix would reduce live_ran without reducing the copy count when
               # a judgment is added later, creating free slack (review 5 lost six).
               if not r[0].startswith(("자기검사:", "계약 커버리지:")))
    check_contract_coverage(check, __file__, ROOT, per_file={
        "agents/quality-auditor.md": 17,
        "agents/quality-executor.md": 15,
        "agents/quality-verifier.md": 16,
        "agents/sag-automation-scout.md": 10,
        "agents/sag-doc-updater.md": 10,
        "agents/sag-duplicate-checker.md": 12,
        "agents/sag-followup-suggester.md": 10,
        "agents/sag-learning-extractor.md": 10,
    }, live_ran=_ran, completeness=False)

    check_no_constant_assertions(check, __file__)
    check_total(check, results, 115)

    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n{passed}/{len(results)} 통과")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
