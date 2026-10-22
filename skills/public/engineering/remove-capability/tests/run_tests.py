#!/usr/bin/env python3
"""prune contract suite.

Run: python3 tests/run_tests.py   (from skills/prune)

## What this locks

1. **Cost, not usage** — "nobody used it lately" is the reason people actually
   give, and it is the wrong one. The skill has to say so where it is read.
2. **Overlap resolves by merge** — deleting and assuming the neighbour covers it
   is how a capability disappears with nothing announcing the loss.
3. **A vanished check is not a passing check** — the failure mode this whole
   repository has been built to catch, restated for removals.
4. **Delete the directory last** — the ordering rule that makes every other
   trace findable, and the one that is not obvious.
5. **prune.py exit-code contract**: clean (0), issues (1), and unscannable (2).
   The previous version always returned zero, so automation could not compose it.
   Run it against isolated trees with seeded defects.
6. **--json and the table report the same counts** through one aggregation.
"""
import json
import os
import re
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
from _suite_lib import (check_no_constant_assertions, check_total, check_skill_body,
                        check_ref_contracts, split_frontmatter, check_body_deletion,
                        check_contract_coverage, check_script_contracts)  # noqa: E402
ROOT = os.path.dirname(HERE)
SKILLS = os.path.dirname(ROOT)
PRUNE = os.path.join(ROOT, "scripts", "prune.py")

FM = "---\nname: {n}\ndescription: {d}\n---\n\nBody\n"

results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))


def read(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


def rows(text, head):
    """Return table data rows below `## head`; return an empty list when absent."""
    if head not in text:
        return []
    body = text.split(head, 1)[1].split("\n## ", 1)[0]
    return [r for r in re.findall(r"(?m)^\| (?!---)(.+?) \|", body)
            if r.strip() not in ("Remove when", "Trace", "Exit")]


def skillfolder(tmp, name, skills):
    """Create one isolated config directory; `skills` maps names to SKILL.md bodies."""
    cfg = os.path.join(tmp, name)
    root = os.path.join(cfg, "skills")
    os.makedirs(root, exist_ok=True)
    for sk, body in skills.items():
        d = os.path.join(root, sk)
        os.makedirs(d, exist_ok=True)
        if body is not None:
            with open(os.path.join(d, "SKILL.md"), "w", encoding="utf-8") as f:
                f.write(body)
    return cfg


def prune(*args, env=None):
    """Run prune.py and return (rc, stdout)."""
    r = subprocess.run([sys.executable, PRUNE, *args], capture_output=True,
                       text=True, env=env)
    return r.returncode, r.stdout


def main():
    fm, skill = split_frontmatter(read(os.path.join(ROOT, "SKILL.md")))
    lst = read(os.path.join(ROOT, "references", "removal-checklist.md"))

    # (1) Cost rather than usage frequency
    check("decision: persistent cost is the criterion",
          "every turn of every session" in skill)
    check("decision: 'not used recently' is excluded as a criterion",
          "not \"has anyone used it lately\"" in skill
          or 'not "has anyone used it lately"' in skill)
    check("decision: states the criterion in one sentence",
          "still earn the space it occupies" in skill)
    keep = rows(skill, "## What justifies removal")
    check("decision: remove/keep comparison has at least four rows", len(keep) >= 4, f"{len(keep)} rows")
    check("decision: being short is not a reason",
          "length is not the cost" in skill)
    check("decision: rewriting later is replacement, not removal",
          "that is a rewrite, not a removal" in skill)
    check("decision: requires learning the reason first",
          "find out first" in skill)
    check("decision: identifies the most ignored item",
          "the one that gets ignored" in skill)
    check("decision: explains that rationale cannot be recovered after deletion",
          "not recoverable afterwards" in skill)

    # (2) Resolve duplication through merging
    check("duplication: merge before deleting",
          "resolved by merge, not by deletion" in skill)
    check("duplication: requires verifying that the neighbor carries the content",
          "neighbour actually says what the removed one said" in skill)
    check("duplication: states that homeless content disappears silently",
          "nothing announces the loss of" in skill)

    # (3) Every trace in one commit
    steps = re.findall(r"(?m)^\d\. ", skill)
    check("traces: four deletion targets are listed", len(steps) >= 4, f"{len(steps)} items")
    check("traces: partial removal is worse than none",
          "worse than none" in skill)
    check("traces: neighbor boundary sentences are checked",
          "a suite that is not the one you were editing" in skill)
    check("traces: requires removing the red case set too",
          "red-suite case set" in skill)
    check("traces: explains the one-commit bisect reason",
          "bisected through looks like" in skill)

    # (4) A vanished check is not a pass
    check("verification: requires neighbor suites and path gates",
          "run the suites of every skill that named" in skill
          and "path gate" in skill)
    check("verification: states that the gate finds stale references",
          "nothing else reads those paths" in skill)
    check("verification: green caused by a vanished subject is not a pass",
          "A check that disappears is not a check that succeeded" in skill)

    # (5) Checklist
    inner = rows(lst, "## In the plugin tree")
    outer = rows(lst, "## Outside the plugin tree")
    check("checklist: at least five in-tree traces", len(inner) >= 5, f"{len(inner)} rows")
    check("checklist: at least three outside-tree traces", len(outer) >= 3, f"{len(outer)} rows")
    check("checklist: calls out directory deletion as the only commonly performed step",
          "the only one people do" in lst)
    check("checklist: states that detection counts over a vanished tree are false",
          "is a false number, not zero" in lst)
    check("checklist: calls out inventory as mistaken for automatic refresh",
          "assume it regenerates" in lst)
    check("checklist: states that the catalog lives elsewhere",
          "different file from everything else" in lst)

    # (6) Order: delete the directory last
    check("order: delete the directory last",
          "Delete the directory last" in lst)
    check("order: the live subject makes traces easier to find",
          "while the thing still exists" in lst)
    check("order: deleting first turns each trace into a separate search",
          "separate search" in lst)

    # (7) Outside removal scope
    check("scope: neighbor rewrites use a separate commit", "**separate**" in lst)
    check("scope: combining them makes both questions unanswerable",
          "cannot answer\neither question" in lst or "cannot answer either question" in lst)
    check("scope: requires recording when neighbor changes are unnecessary",
          "say so in the commit message" in lst)
    check("scope: silence reads as not reviewed",
          'reads as "not considered"' in lst)

    # (8) Boundaries and language
    named = set(re.findall(r"`([a-z][a-z-]{2,})`\s*skill", skill))
    missing = [n for n in named if not os.path.isdir(os.path.join(SKILLS, n))]
    check("boundary: handoff target population is nonempty", len(named) >= 3, f"{sorted(named)}")
    check("boundary: all handoff targets exist", not missing, f"missing {missing}")
    check("language: description contains Korean triggers",
          len(re.findall(r"[가-힣]+", fm)) >= 5)
    check("language: description also contains English triggers", "prune" in fm)
    check("language: description states the persistent-cost criterion",
          "always-on cost" in fm)

    # (9) Diagnostic script: exit code is its only machine-readable signal
    check("diagnostic: SKILL.md references the script", "`scripts/prune.py`" in skill)
    check("diagnostic: states that it changes nothing",
          "It changes nothing and deletes nothing" in skill)
    exits = rows(skill, "## Measure the folder before you argue about it")
    check("diagnostic: exit-code table has three rows", len(exits) == 3, f"{len(exits)} rows")
    check("diagnostic: unscannable differs from clean",
          "a scan that never happened are different facts" in skill)
    check("diagnostic: collapsing them counts a vanished check as pass",
          "the same defect as counting a" in skill)
    check("diagnostic: an always-success diagnostic cannot be composed",
          "cannot be aggregated by anything" in skill)
    check("diagnostic: --json uses the same function as the table",
          "produced by the same" in skill)

    with tempfile.TemporaryDirectory() as tmp:
        clean = skillfolder(tmp, "clean", {
            "good": FM.format(n="good", d="short description")})
        rc, out = prune("--config-dir", clean)
        check("runtime: clean directory returns rc 0", rc == 0, f"rc={rc}")
        check("runtime: rc 0 still prints a measured result", "Total issues: 0" in out, out.strip()[-40:])

        broken = skillfolder(tmp, "broken", {})
        os.symlink(os.path.join(tmp, "nowhere"),
                   os.path.join(broken, "skills", "dangling"))
        rc, out = prune("--config-dir", broken)
        check("runtime: broken link returns rc 1, not 0", rc == 1, f"rc={rc}")
        check("runtime: reports the defect by name", "broken link" in out)

        mism = skillfolder(tmp, "mismatch", {
            "dirname": FM.format(n="othername", d="description")})
        rc, out = prune("--config-dir", mism)
        check("runtime: directory/name mismatch returns rc 1", rc == 1, f"rc={rc}")

        fat = skillfolder(tmp, "fat", {"fat": FM.format(n="fat", d="x" * 2000)})
        rc, out = prune("--config-dir", fat)
        check("runtime: exceeding 1536 characters returns rc 1", rc == 1, f"rc={rc}")

        # --json and the table must use the same aggregation.
        rc_t, out_t = prune("--config-dir", broken, "--config-dir", fat)
        rc_j, out_j = prune("--config-dir", broken, "--config-dir", fat, "--json")
        try:
            doc = json.loads(out_j)
        except ValueError:
            doc = {}
        summary = doc.get("summary", {})
        check("runtime: --json is valid JSON", bool(doc), out_j.strip()[:60])
        check("runtime: --json includes summary.total",
              isinstance(summary.get("total"), int) and summary.get("total", 0) >= 2,
              f"{summary.get('total')}")
        check("runtime: --json exit code matches table mode",
              rc_j == rc_t == 1, f"json={rc_j} table={rc_t}")
        check("runtime: --json total matches the table total",
              f"Total issues: {summary.get('total')}" in out_t, out_t.strip()[-30:])
        check("runtime: --json declared exit matches the process rc",
              summary.get("exit") == rc_j, f"{summary.get('exit')} vs {rc_j}")
        check("runtime: --json includes per-directory details",
              set(doc.get("dirs", {})) == {broken, fat}, f"{sorted(doc.get('dirs', {}))}")

        # Unscannable must differ from clean.
        rc, _out = prune(env=dict(os.environ, HOME=os.path.join(tmp, "empty-home")))
        check("runtime: no config directories returns rc 2, distinct from 0",
              rc == 2, f"rc={rc}")

        # Verify read-only behavior; mutation would contaminate the evidence.
        before = sorted(os.walk(os.path.join(broken, "skills")).__next__()[1:])
        prune("--config-dir", broken)
        after = sorted(os.walk(os.path.join(broken, "skills")).__next__()[1:])
        check("runtime: changes nothing", before == after, f"{before} vs {after}")

    check_skill_body(check, ROOT, needles=[
        "still earn the space it occupies",
        "resolved by merge, not by deletion",
        "A check that disappears is not a check that succeeded",
        "worse than none",
        "path gate",
        "a scan that never happened are different facts",
        "cannot be aggregated by anything",
    ], floor=2892)

    check_ref_contracts(check, ROOT, [
        ("removal-checklist.md", "inside/outside traces, order, and exclusions",
         ["the only one people do", "is a false number, not zero",
          "Delete the directory last", 'reads as "not considered"'], 1232),
    ])

    # Prefixes for axes that return early in copies. All three use the same list and
    # count so one omitted axis cannot create free slack. Count before script contracts.
    META = ("자기검사:", "계약 커버리지:", "스크립트 계약:")
    live_ran = sum(1 for r in results if not r[0].startswith(META))

    # The floor is measured from checks that fail when prune.py is emptied.
    check_script_contracts(check, __file__, ROOT,
                           scripts={"scripts/prune.py": 12},
                           live_ran=live_ran)
    check_contract_coverage(check, __file__, ROOT, per_file={
        "SKILL.md": 36, "references/removal-checklist.md": 16,
        "scripts/prune.py": 12,
    }, live_ran=live_ran)
    check_body_deletion(check, __file__, ROOT, minimum=36,
                        live_ran=live_ran)
    check_no_constant_assertions(check, __file__)
    check_total(check, results, 80)

    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n{passed}/{len(results)} 통과")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
