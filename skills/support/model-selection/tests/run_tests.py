#!/usr/bin/env python3
"""models contract suite.

Run: python3 tests/run_tests.py   (from skills/models)

## What this locks

1. **Tolerance, not size** — "big task, big model" is the intuition this skill
   exists to replace, so the replacement axis must be stated, not implied.
2. **The reason travels with the tier** — a tier chosen for a stated reason gets
   corrected later; one that just happened does not.
3. **Do not shard a judgement** — the money-saving move that buys several
   partial answers nobody reconciles.
4. **A model name is not a contract** — pinned names age into claims nobody
   re-measured, which is the failure this repository keeps rediscovering.
"""
import os
import re
import sys

sys.dont_write_bytecode = True
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
from _suite_lib import (check_no_constant_assertions, check_total, check_skill_body,
                        check_ref_contracts, split_frontmatter, check_body_deletion,
                        check_contract_coverage)  # noqa: E402
ROOT = os.path.dirname(HERE)
SKILLS = os.path.dirname(ROOT)

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
            if r.strip() not in ("The task", "Split", "Case",
                                 "Switch", "What the regex does", "Scenario")]


def main():
    fm, skill = split_frontmatter(read(os.path.join(ROOT, "SKILL.md")))
    tiers = read(os.path.join(ROOT, "references", "tiers.md"))
    exc = read(os.path.join(ROOT, "references", "exceptions.md"))

    # (1) Tolerance rather than size
    check("axis: states and rejects the big-task/big-model intuition",
          '"Big task, big model"' in skill and "it is wrong twice" in skill)
    check("axis: provides two counterexamples: long mechanical work and a short locking protocol",
          "forty files" in skill and "locking protocol" in skill)
    check("axis: states the replacement axis in one sentence",
          "what the task can tolerate being wrong about" in skill)
    # L0 also makes a claim. Checking only the body allowed the description to reverse
    # the axis undetected, even though this always-on layer is read first.
    check("L0: description declares the tolerance axis",
          "what the task can tolerate being wrong about" in fm)
    check("L0: description explicitly excludes size",
          "not about how big the task looks" in fm)
    check("L0: description requires recording the reason too",
          "say why in the delegation itself" in fm)
    tbl = rows(skill, "## The wrong axis")
    check("axis: tier decision table has three rows", len(tbl) == 3, f"{len(tbl)} rows")
    check("axis: third row is the point", "the whole point" in skill)
    check("axis: spends capability where downstream checks cannot catch errors",
          "the model is the last check" in skill)
    check("axis: tests are the safety net for the middle tier",
          "does not have to be the safety net" in skill)

    # (2) Record tier and reason together
    check("notation: omitted model is inherited invisibly",
          "inherits one" in skill and "invisible" in skill)
    check("notation: requires the reason beside the model",
          "name why in the same breath" in skill)
    check("notation: provides a concrete example section",
          "mechanical rename across the tree" in skill)
    check("notation: without a reason, selection is indistinguishable from default",
          "cannot tell a deliberate choice from a" in skill)
    check("notation: reasoned misselection is correctable rather than accidental",
          "just happened does not" in skill)

    # (3) Do not save cost by sharding judgment
    check("sharding: forbids sharding judgment", "Do not shard a judgement" in skill)
    check("sharding: partial answers are not coordinated",
          "nobody reconciles" in skill)
    check("sharding: the real cost is not tokens",
          "never the tokens" in skill)
    check("sharding: task decomposition differs and is usually correct",
          "Splitting **work** is different" in skill)
    check("sharding: gives a one-sentence sharding test",
          "whether the pieces\ncan be checked separately" in skill
          or "whether the pieces can be checked separately" in skill)
    sp = rows(tiers, "## The split test")
    check("sharding: sharding test table has four rows", len(sp) == 4, f"{len(sp)} rows")
    check("sharding: identifies the common half-correct pattern",
          "they split\nthe gathering" in tiers or "they split the gathering" in tiers)

    # (4) Model names are not capability contracts
    check("names: model names are not capability contracts",
          "The model name is not a capability contract" in skill)
    check("names: pinned names age into unmeasured claims",
          "nobody re-measured" in skill)
    check("names: centralizes concrete names",
          "one file changes" in skill)
    check("names: records measured differences rather than impressions",
          "record the measurement next to the name" in skill)
    check("remeasurement: 'X cannot do Y' is a dated measurement",
          "is a measurement with a date on" in tiers)
    check("remeasurement: two runs cost less than a year of overspending",
          "cheaper than a year of routing" in tiers)
    check("remeasurement: one success is not a rate",
          "One success is not a rate" in tiers)

    # (5) Low-tier failures are specific
    check("failure: does not degrade uniformly",
          "expected not to degrade uniformly" in skill)
    check("failure: lists three failure points",
          "held instructions" in skill and "multi-step" in skill
          and "contradicts itself" in skill)
    check("failure: changes task structure rather than tier in those cases",
          "restructure the task instead" in skill)
    check("failure: states the goal of reducing state held per step",
          "each step holds less" in skill)

    # (6) Practical case table
    cs = rows(tiers, "## Worked cases")
    check("cases: case table has five rows", len(cs) == 5, f"{len(cs)} rows")
    check("cases: each row explains why not the adjacent tier",
          "Why not the neighbouring tier" in tiers)
    check("cases: concurrency strategy is based on what tests cannot see",
          "where no test looks" in tiers)
    check("cases: exception propagation depends on invariants outside local tests",
          "no local test states" in tiers)

    # (7) Names in code: hooks, exceptions, and paths
    #
    # This section locks the failure mode that killed the legacy model-version-checker:
    # `find` returned empty output with exit 0 for a renamed path, so synchronization
    # reported completion after its source disappeared.
    check("name axis: defines a separate axis for IDs written in files",
          "the name written in the code" in skill)
    check("name axis: states that provider schedules age this axis",
          "ages on the provider's schedule" in skill)
    check("name axis: lists three tools intercepted by the hook",
          "`Write`, `Edit`, and\n`Bash`" in skill
          or "`Write`, `Edit`, and `Bash`" in skill)
    check("name axis: states the two-stage block/pass structure",
          "blocks the operation" in skill and "lets it through" in skill)
    check("exceptions: project declares exceptions once in pyproject.toml",
          "`pyproject.toml`" in skill and "stops arguing" in skill)
    check("paths: does not locate the database by plugin name",
          "Never locate that database by plugin name" in skill)
    check("paths: states that failure is silent", "dies silently" in skill)
    check("paths: uses ${JSTACK_PLUGIN_ROOT} as the alternative",
          "${JSTACK_PLUGIN_ROOT}" in skill)

    sw = rows(exc, "## The two switches")
    check("exceptions: switch table has two rows", len(sw) == 2, f"{len(sw)} rows")
    check("exceptions: names both switch keys",
          "approved_legacy_models" in exc and "check_model_versions" in exc)
    check("exceptions: prefers a list before a global bypass",
          "Reach for the list first" in exc)
    check("exceptions: requires a reason beside each item",
          "Write the reason next to the entry" in exc)
    check("exceptions: unreasoned exceptions accumulate",
          "the list only grows" in exc)
    check("exceptions: gives two valid reasons: API-only and reproduction",
          "API-only models" in exc and "Reproduction" in exc)

    check("parsing: uses regex rather than a TOML parser",
          "not by a TOML parser" in exc)
    pz = rows(exc, "## The file is read by regex")
    check("parsing: result table has four rows", len(pz) == 4, f"{len(pz)} rows")
    check("parsing: keys are not bound to tables",
          "not scoped to `[tool.claude-hooks]`" in exc)
    check("parsing: first pyproject masks the root",
          "shadows the repository root" in exc)
    check("parsing: none of the failures is loud",
          "None of these fail loudly" in exc)

    check("fail-open: lists paths that fall through to allow",
          "fails to import" in exc and "any unexpected exception" in exc)
    check("fail-open: states the cost: broken checker and clean tree are indistinguishable",
          "indistinguishable from a clean tree" in exc)

    check("paths: resolves the database relative to the hook", "relative to itself" in exc)
    check("paths: shows the dead legacy find command",
          "plugins/cache/<marketplace>/<plugin>" in exc)
    check("paths: find returns exit 0 with empty output",
          "prints nothing and exits 0" in exc)
    check("paths: hard-coded Glob paths have the same defect",
          "wearing a different hat" in exc)

    eg = rows(exc, "## Edge cases")
    check("edge cases: table has ten rows", len(eg) == 10, f"{len(eg)} rows")
    check("edge cases: unregistered IDs pass",
          "more likely private or new than retired" in exc)
    check("edge cases: IDs in documentation are also warnings",
          "documentation ages the same way" in exc)

    # (8) Boundaries and language
    named = set(re.findall(r"`([a-z][a-z-]{2,})`\s*skill", skill))
    missing = [n for n in named if not os.path.isdir(os.path.join(SKILLS, n))]
    check("boundary: handoff target population is nonempty", len(named) >= 2, f"{sorted(named)}")
    check("boundary: all handoff targets exist", not missing, f"missing {missing}")
    check("language: description contains Korean triggers",
          len(re.findall(r"[가-힣]+", fm)) >= 5)
    check("language: description also contains English triggers", "tier" in fm)

    check_skill_body(check, ROOT, needles=[
        "what the task can tolerate being wrong about",
        "name why in the same breath",
        "Do not shard a judgement",
        "The model name is not a capability contract",
        "restructure the task instead",
        "Never locate that database by plugin name",
    ], floor=2173)

    check_ref_contracts(check, ROOT, [
        ("tiers.md", "sharding test, case table, and remeasurement contract",
         ["can each piece be", "Why not the neighbouring tier",
          "is a measurement with a date on", "One success is not a rate",
          "Effort and model identity are separate choices", "These roles do not",
          "authorize spawning agents", "current availability or universal Astra policy"], 1399),
        ("exceptions.md", "two switches, regex parsing outcomes, fail-open behavior, and database paths",
         ["Reach for the list first", "not by a TOML parser",
          "indistinguishable from a clean tree",
          "Never locate it by plugin name"], 3500),
    ])

    check_contract_coverage(check, __file__, ROOT, per_file={
        "SKILL.md": 42, "references/tiers.md": 12,
        "references/exceptions.md": 23,
    }, live_ran=sum(1 for r in results
                    if not r[0].startswith(("자기검사:", "계약 커버리지:"))))
    check_body_deletion(check, __file__, ROOT, minimum=42,
                        live_ran=sum(1 for r in results
                                     if not r[0].startswith(("자기검사:", "계약 커버리지:"))))
    check_no_constant_assertions(check, __file__)
    check_total(check, results, 91)

    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n{passed}/{len(results)} 통과")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
