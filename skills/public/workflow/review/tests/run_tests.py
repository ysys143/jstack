#!/usr/bin/env python3
"""audit contract suite.

Run: python3 tests/run_tests.py   (from skills/audit)

## What this locks

1. **Read-only by contract** — the entire reason audit and cleanup are separate.
   If this softens, every review of an unfamiliar repository carries write risk.
2. **SSOT with zero copies** — the taxonomy lives in cleanup. A second copy here
   drifts invisibly until two reviews disagree.
3. **Default verdict is block** — the burden of proof sits with the author. A
   rubric that defaults to "looks fine" produces reviews that find nothing.
4. **Eight self-rebuttal exceptions** — attacker-equals-victim rebuttal is
   inseparable from the exception list. Removing an entry silently rebuts its true
   positives. `test_selfrebut_exceptions.py` checks counts and decider sentences.
5. **Declare the profile first** — precision and recall act oppositely on the same
   finding. Choosing after seeing findings selects whichever favors the result.
"""
import os
import re
import subprocess
import sys

sys.dont_write_bytecode = True
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
from _suite_lib import (check_no_constant_assertions, check_total, check_skill_body,
                        check_ref_contracts, split_frontmatter, check_body_deletion,
                        check_contract_coverage, check_script_contracts)  # noqa: E402
ROOT = os.path.dirname(HERE)
SKILLS = os.path.dirname(ROOT)
TAXONOMY = os.path.join(SKILLS, "cleanup", "references", "quality-taxonomy.md")

results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))


# Relative paths of missing references, collected to report as verdicts.
MISSING = []


def read(p):
    """Read references defensively: absence is a verdict, not an exception.

    The old direct `open()` died with FileNotFoundError and printed neither a summary
    nor a `[FAIL]` line. A counter that scans failures therefore saw zero. Return an
    empty string instead: every needle for that file fails and the existence check
    separately names the missing file, so suite death cannot look like silence.
    """
    try:
        with open(p, encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        MISSING.append(os.path.relpath(p, ROOT).replace(os.sep, "/"))
        return ""


def section(text, head):
    """Return the section below `## head`, or an empty string when absent.

    Indexing `split()[1]` crashes on an emptied reference and erases all later checks;
    deletion must appear as failures rather than a disappearing suite.
    """
    if head not in text:
        return ""
    tail = text.split(head, 1)[1]
    return tail.split("\n## ", 1)[0]


def main():
    fm, skill = split_frontmatter(read(os.path.join(ROOT, "SKILL.md")))
    rubric = read(os.path.join(ROOT, "references", "rubric.md"))
    excs = read(os.path.join(ROOT, "references", "security-exceptions.md"))
    profiles = read(os.path.join(ROOT, "references", "evidence-profiles.md"))

    # (0) Existence: a missing file is a verdict, not an exception
    check('Existence: every contract file exists', not MISSING,
          f"missing {MISSING}; mark every contract for these files as failed")

    # (1) Read-only: the reason this skill exists
    check('Safety: says never edit',
          "This skill never edits" in skill)
    check('Safety: table distinguishes its safety property from cleanup',
          "| | `audit` | `cleanup` |" in skill and "**never**" in skill)
    check('Safety: explains that merging would expose every review to write risk',
          "every review carries write risk" in skill)
    check('Safety: prescribes and stops even when the fix is obvious',
          "name the remedy and stop" in skill)
    check('Limits: repeats that read-only is a contract',
          "Read-only by contract" in skill)

    # (2) SSOT: zero copies
    check('SSOT: taxonomy canonical source lives in cleanup', os.path.exists(TAXONOMY))
    check('SSOT: audit references that file',
          "cleanup/references/quality-taxonomy.md" in skill)
    check('SSOT: says it keeps no copy',
          "keeps no copy" in skill)
    check('SSOT: explains why a copy is dangerous',
          "drifts" in skill and "two reviews disagree" in skill)
    # **Verify the copy is actually absent.** A declaration alongside a copy is false.
    refs_dir = os.path.join(ROOT, "references")
    own_refs = os.listdir(refs_dir) if os.path.isdir(refs_dir) else []
    check('SSOT: audit/references has no taxonomy copy',
          not any("taxonomy" in f for f in own_refs), f"{own_refs}")

    # (3) Default verdict is block
    check('Rubric: default verdict is block and the author bears the burden of proof',
          "default is block" in skill and "burden of proof" in skill)
    # **The rubric itself must agree.** Checking only SKILL.md let deletion of
    # `default` from the rubric stay green in a negative control.
    check('Rubric: rubric body declares block as the default verdict',
          "**The default verdict is block" in rubric
          and "burden of proof is on the author" in rubric)
    # **L0 is the only always-active layer.** Weakening it changes invocation and the
    # promise itself. Substring checks accept `mostly read-only`, so reject hedges.
    check('L0: description declares read-only without conditions',
          "read-only review" in fm)
    hedges = [h for h in ("mostly", "generally", "usually", "when possible",
                          "가급적", "대체로", "되도록")
              if h + " read-only" in fm or h in fm.split("read-only")[0][-24:]]
    check('L0: read-only declaration has no weakening qualifier', not hedges, f"{hedges}")
    check('L0: description contains the default verdict',
          "default verdict of block" in fm)
    # **L0 is always active; other layers are discoverable only when L0 advertises
    # them.** The old description named none of the three supporting layers. When a
    # harness reads only L0, an unadvertised rubric, profile, or list effectively does
    # not exist.
    for layer, needle in (("rubric", "rubric"),
                          ("evidence profile", "evidence profile"),
                          ("exception list", "security-exception list")):
        check(f"L0: description advertises supporting layer {layer}", needle in fm)
    check('Rubric: has six presumptive blockers',
          len(re.findall(r"(?m)^\d\. ", section(rubric, "## Presumptive blockers"))) == 6)
    check('Rubric: has nine tone rules',
          len(re.findall(r"(?m)^\d\. ",
                         section(rubric, "Nine standing phrasings"))) == 9)
    check('Rubric: has seven output-priority steps',
          len(re.findall(r"(?m)^\d\. \*\*|^\d\. [A-Z]",
                         section(rubric, "## Output priority"))) == 7)
    check('Rubric: forbids nit flooding', "No nit-flooding" in rubric)
    check('Rubric: explains that many nits read as finding nothing',
          "nothing serious was found" in rubric)

    # (3b) Entry instruction: **without a pointer the file is never loaded**. No test
    # once covered the load instruction for the largest reference, rubric.md; deleting
    # it stayed green. Its 21 contracts matter only if sessions actually load it.
    cited = set(re.findall(r"`(references/[a-z-]+\.md)`", skill))
    want_refs = {"references/rubric.md", "references/security-exceptions.md",
                 "references/evidence-profiles.md"}
    check('Entry: SKILL.md cites all three reference types by path',
          want_refs <= cited, f"missing {sorted(want_refs - cited)}")
    check('Entry: instructs loading the rubric rather than merely mentioning it',
          "Load `references/rubric.md`" in skill)
    dead = sorted(c for c in cited if not os.path.exists(os.path.join(ROOT, c)))
    check('Entry: every cited reference path is live', not dead, f"dead pointers {dead}")

    # (4) Remedies: classification alone leaves the reader in place
    check('Remedies: Preferred remedies table exists', "## Preferred remedies" in rubric)
    # **Measure each remedy cell, not just row count.** `>= 16` stayed green after
    # every remedy became `TBD`. Count data rows only, excluding header and separator.
    # The old `[A-Z(]` pattern counted the header but missed a backtick-leading row,
    # producing the right count by accident.
    rem_rows = [
        (a, b) for a, b in re.findall(
            r"(?m)^\| ([^|]+?) \| ([^|]+?) \|$",
            section(rubric, "## Preferred remedies"))
        if a.strip() != "Finding" and not set(a.strip()) <= set("- ")
    ]
    thin_rem = [r[0].strip() for r in rem_rows if len(r[1].strip()) < 6]
    check('Remedies: table has 16 entries and every row contains a remedy sentence',
          len(rem_rows) == 16 and not thin_rem,
          f"{len(rem_rows)} entries" + (f" · thin {thin_rem}" if thin_rem else ""))
    check('Remedies: explains why classification alone is insufficient',
          "leaves the reader where they started" in rubric)

    # (5) Collection contract: absent input cannot be judged
    check('Collection: explains why full file contents are needed',
          "not the hunk" in skill or "not just the hunks" in rubric)
    check('Collection: says a missing input silently removes an axis',
          "silently drops two axes" in skill)
    check('Collection: explicitly requires the parent to inject inputs',
          "must** inject" in rubric or "must inject" in rubric)

    # (6) scope=all degeneration
    check('Degeneration: says --scope=all invalidates two axes',
          "degrades two axes" in skill)
    check('Degeneration: forbids reporting low counts as clean',
          "do not report the smaller count" in skill)

    # (7) State what was not inspected
    check('Honesty: requires naming uninspected areas',
          "Say what you did not check" in skill)
    check('Honesty: explains that omitted areas are read as clean',
          "reads as a clean area" in skill)
    check('Honesty: requires separating verified facts from beliefs',
          "Separate what you verified from what you believe" in skill)

    # (10) Self-rebuttal exceptions: rebuttal without the list hides true positives
    check('Exceptions: SKILL.md cites the exception list',
          "references/security-exceptions.md" in skill)
    check('Exceptions: says rebuttal and exception list are inseparable',
          "inseparable" in skill and "inseparable" in rubric)
    check('Exceptions: says the list is closed at eight entries',
          "closed at eight" in skill and "closed at eight" in excs)
    check('Exceptions: explains that rebuttal lowers counts and is read as clean',
          "reads as a cleaner codebase" in skill)
    n_exc = len(re.findall(r"(?m)^### E-\d+\. ", excs))
    check('Exceptions: list has eight entries', n_exc == 8, f"{n_exc} entries")
    n_verdict = len(re.findall(r"(?m)^\*\*Decider\*\* — ", excs))
    check('Exceptions: every entry has an adjudicator sentence', n_verdict == n_exc == 8,
          f"deciders {n_verdict} / entries {n_exc}")
    check('Exceptions: sources split into five upstream and three local',
          len(re.findall(r"(?m)^Source: upstream$", excs)) == 5
          and len(re.findall(r"(?m)^Source: local context$", excs)) == 3)
    # Five upstream entries: the exact list C-42 identified as vulnerable to wholesale deletion.
    up5 = [k for k in ("SSRF", "capability gates", "CWE-200", "CWE-359", "CWE-532",
                       "`.claude/settings`", "`.vscode`", "/proc/<pid>")
           if k not in excs]
    check('Exceptions: all five upstream targets remain named', not up5, f"missing {up5}")
    # Three local-context entries: M-6, M-7, and M-8.
    check('Exceptions: archive author differs from releaser for M-6 Zip-slip',
          "Zip-slip" in excs and "archive's author and extractor are different principals" in excs)
    check('Exceptions: identifies skill and contract files as agent instruction surfaces',
          "agent instruction surface" in excs and "SKILL.md" in excs)
    check('Exceptions: says the victim is procurement review disqualification, not the author',
          "disqualification" in excs and "the author is only hurting their own document" in excs)
    check('Exceptions: records the trap where domain-neutral enforcement deletes the list',
          "domain-neutral" in excs and "removes this file" in excs)
    check('Exceptions: requires recording that rebuttal was applied when no exception matches',
          "leaves no line" in excs)
    # The rubric must also contain all three as full entries.
    check('Rubric: cites the exception-list path',
          "references/security-exceptions.md" in rubric)
    check('Rubric: archive, instruction-surface, and disqualification entries appear as sentences',
          "Archive author != extractor" in rubric and "Agent instruction surface" in rubric
          and "Disqualification" in rubric)

    # (11) PRE-EXISTING / DIFF-ANCHOR: soft tags, unused in survey mode
    check('Tags: defines PRE-EXISTING and DIFF-ANCHOR as soft tags',
          "PRE-EXISTING" in rubric and "DIFF-ANCHOR" in rubric
          and "they do not drop" in rubric)
    check('Tags: states they do not apply in survey mode',
          "In survey mode they are not applied at all" in rubric)
    check('Tags: explains that no baseline would rebut everything',
          "rate of 100%" in rubric)
    check('Tags: records that upstream withdrew first and why',
          "review_api.py:285" in rubric and "hard-dropping" in rubric)
    check('Tags: says inheriting only the rule rebuilds the trap after omitting the correction',
          "the documentation was the part left behind" in rubric)

    # (12) Evidence profiles: two loss functions acting oppositely on one finding
    check('Profiles: SKILL.md cites the profile document',
          "references/evidence-profiles.md" in skill)
    check('Profiles: requires declaring a profile before seeing findings',
          "declare the profile before the findings" in skill.lower()
          or "Declared before the review" in profiles)
    check('Profiles: names precision and recall profiles separately',
          "## Precision profile" in profiles and "## Recall profile" in profiles)
    check('Profiles: comparison table distinguishes the two loss functions',
          "| Inherited from | security guidance, pm-skills | contract-work, thermo |"
          in profiles)
    check('Profiles: explains that false positives cause gates to be disabled',
          "gets disabled" in profiles and "recall zero" in profiles)
    check('Profiles: says the recall profile still forbids fabricated findings',
          "Never fabricate intent to manufacture a gap" in profiles)
    check('Profiles: has a situation-to-profile mapping table',
          "| Situation | Profile |" in profiles)
    # **A bare name provides no reachability.** Earlier tests passed with both filenames
    # outside their section, while authoring-contract.yaml was a dead pointer. Require
    # a path to the real carrier and an explicit statement that the other is absent.
    PLUGIN = os.path.dirname(SKILLS)
    carrier = os.path.join(PLUGIN, "contracts", "portable-contract.yaml")
    check('Profiles: names a carrier path outside the skill tree',
          "`contracts/portable-contract.yaml` (plugin root" in profiles)
    check('Profiles: that carrier exists and is reachable', os.path.exists(carrier),
          f"missing {os.path.relpath(carrier, PLUGIN)}")
    check('Profiles: explicitly says the missing half is absent',
          "There is no `authoring-contract.yaml`" in profiles)
    check('Profiles: says the carrier transports axes rather than a file pair',
          "What carries over is the **axis**, not the file pair" in profiles)
    check('Profiles: says profiles do not change the axis inventory',
          "never the axis list" in profiles)
    check('Profiles: says post-hoc choice selects the favorable result',
          "flatters the result" in profiles)

    # (13) Actually run the exception loader and inspect its result.
    tp = os.path.join(ROOT, "tests", "test_selfrebut_exceptions.py")
    check('Load check: SKILL.md cites the checker',
          "tests/test_selfrebut_exceptions.py" in skill)
    proc = subprocess.run([sys.executable, tp], capture_output=True, text=True,
                          cwd=ROOT)
    out = proc.stdout
    check('Load check: exits with rc 0', proc.returncode == 0,
          f'rc={proc.returncode} {(proc.stderr or out).strip().splitlines()[-1][:70] if (proc.stderr or out).strip() else ""}')
    n_ok = len(re.findall(r"(?m)^\[OK\] E-\d+ ", out))
    check('Load check: reports all eight entries as loaded', n_ok == 8, f"{n_ok} entries")
    check('Load check: reports counts of five upstream and three local',
          "confirmed 8 loaded exceptions (upstream 5 · local 3)" in out,
          out.strip().splitlines()[-1][:70] if out.strip() else "no output")

    # (8) Boundary
    named = set(re.findall(r"`([a-z][a-z-]{2,})`\s*skill", skill))
    missing = [n for n in named if not os.path.isdir(os.path.join(SKILLS, n))]
    check('Boundary: handoff population is nonempty', len(named) >= 3, f"{sorted(named)}")
    check('Boundary: every handoff target exists', not missing, f"missing {missing}")

    # (9) Language policy
    check('Language: description has Korean triggers',
          len(re.findall(r"[가-힣]+", fm)) >= 5)
    check('Language: description has English triggers', "code review" in fm and "verdict" in fm)

    check_skill_body(check, ROOT, needles=[
        "This skill never edits", "keeps no copy", "default is block",
        "silently drops two axes", "Say what you did not check",
    ], floor=3042)

    REF_CONTRACTS = [
        ("rubric.md", "nine tone rules, seven priorities, six blockers, 16 remedies, exceptions, tags, profiles",
         ["Nine standing phrasings", "No nit-flooding", "Presumptive blockers",
          "Preferred remedies", "Collection contract",
          "**The default verdict is block",
          "PRE-EXISTING", "hard-dropping",
          "references/security-exceptions.md",
          "references/evidence-profiles.md"], 5745),
        ("security-exceptions.md", "eight exceptions (five upstream, three local) with per-entry deciders",
         ["Zip-slip", "agent instruction surface", "disqualification", "SSRF",
          "capability gates", "CWE-532", "/proc/<pid>",
          "**Decider**", "closed at eight"], 6006),
        ("evidence-profiles.md", "separate precision and recall profiles plus carrier",
         ["## Precision profile", "## Recall profile",
          "Never fabricate intent to manufacture a gap",
          "portable-contract.yaml", "authoring-contract.yaml",
          "never the axis list"], 3927),
        ("security-discovery.md", "security candidates, reachability, static/runtime evidence, read-only boundary",
         ["# Security discovery contract", "stable ID, `file:line`", "`candidate`, `confirmed`,",
          "Do not execute target code in static mode",
          "Audit records only the defect\nand the expected minimum fix"], 1746),
    ]
    check_ref_contracts(check, ROOT, REF_CONTRACTS)
    # **Measure the contract list structurally.** check_ref_contracts catches only
    # undeclared reference files, not declared entries with empty needles or zero
    # floors. Require a one-to-one file mapping and nonempty entries. This check runs
    # identically in live and deleted copies, preserving deletion-guard counts.
    n_disk = len([n for n in own_refs if n.endswith(".md")])
    thin = sorted(c[0] for c in REF_CONTRACTS if not c[2] or c[3] < 1)
    check('Reference map: contract entries map one-to-one to nonempty reference files',
          len(REF_CONTRACTS) == n_disk and not thin,
          f"declared {len(REF_CONTRACTS)} / on disk {n_disk}"
          + (f" · empty contracts {thin}" if thin else ""))

    # Keep `reference contract:` in both counts. A former `_suite_lib` return dropped
    # everything after the first entry in deleted copies, so a prefix exclusion hid
    # the mismatch. The cause is fixed; retaining the workaround would now move
    # reference checks outside the deletion guard. Only `script contract:` remains
    # excluded because check_script_contracts returns early in deleted runs.
    SELF = ("자기검사:", "계약 커버리지:", "스크립트 계약:")
    check_contract_coverage(check, __file__, ROOT, per_file={
        "SKILL.md": 32, "references/rubric.md": 21,
        "references/security-exceptions.md": 16,
        "references/evidence-profiles.md": 13,
        "references/security-discovery.md": 3,
        "tests/test_selfrebut_exceptions.py": 2,
    }, live_ran=sum(1 for r in results if not r[0].startswith(SELF)))
    check_body_deletion(check, __file__, ROOT, minimum=32,
                        live_ran=sum(1 for r in results
                                     if not r[0].startswith(SELF)))
    check_script_contracts(check, __file__, ROOT, scripts={
        "tests/test_selfrebut_exceptions.py": 2,
    }, live_ran=sum(1 for r in results if not r[0].startswith(SELF)))
    check_no_constant_assertions(check, __file__)
    check_total(check, results, 110)

    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n{passed}/{len(results)} 통과")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
