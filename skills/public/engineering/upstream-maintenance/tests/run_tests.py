#!/usr/bin/env python3
"""upstream contract suite.

Run: python3 tests/run_tests.py   (from skills/upstream)

## What this locks

1. **Unlicensed is not permissive** — the default assumption goes the wrong way,
   and the mistake is discovered by someone else, in public.
2. **Path, not line number** — this repository has already paid for a plan that
   cited line numbers with no paths; nothing in it could be resolved afterwards.
3. **The test travels with the verifier** — a vendored checker with no tests
   returns green without checking, which is worse than no checker.
4. **Import and edit are separate commits** — one combined commit destroys the
   only diff that answers "what did we change?".
"""
import os
import re
import sys

sys.dont_write_bytecode = True
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
from _suite_lib import (  # noqa: E402
                        check_no_constant_assertions, check_total, check_skill_body,
                        check_ref_contracts, split_frontmatter, check_body_deletion,
                        check_contract_coverage, read_ref)
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
    """Return table rows below `## head`; return an empty list when absent."""
    if head not in text:
        return []
    body = text.split(head, 1)[1].split("\n## ", 1)[0]
    out = re.findall(r"(?m)^\| (?!---)(.+?) \|", body)
    return [r for r in out if r.strip() not in ("Field", "Class")]



def main():
    fm, skill = split_frontmatter(read(os.path.join(ROOT, "SKILL.md")))
    lic_path = os.path.join(ROOT, "references", "license-classes.md")
    lic = read_ref(lic_path)
    check("reference: references/license-classes.md exists",
          lic is not None,
          "" if lic is not None else "file missing; its entire contract disappears")
    lic = lic or ""

    # Citations must be prefixed relative paths. The shared orphan check accepts a
    # basename, but this skill explicitly requires recording paths, so it applies
    # that stricter rule to its own documentation.
    ref_dir = os.path.join(ROOT, "references")
    owned = sorted(
        os.path.relpath(os.path.join(dp, n), ROOT).replace(os.sep, "/")
        for dp, _dn, fns in os.walk(ref_dir) for n in fns
        if not n.startswith(".") and not n.endswith(".lines"))
    uncited = [r for r in owned if f"`{r}`" not in skill]
    check("citations: body uses prefixed relative paths for reference files",
          bool(owned) and not uncited,
          f"uncited {uncited}" if uncited else f"{len(owned)} entries")

    # (1) Copy by default: policy changed 2026-09-02.
    #
    # The previous contract blocked unlicensed imports too broadly, including a public
    # 62-line zip utility. A user decision reversed the default.
    #
    # Two axes remain: record the class, and pre-review classes that impose obligations
    # on our users. This distinguishes a policy change from deleting the rule.
    check("license: copy is the default",
          "**The default is to bring it in.**" in skill)
    check("license: requires recording the none class",
          "including `none`" in skill)
    check("license: recording is not asking permission",
          "not\npermission-seeking" in skill or "not permission-seeking" in skill)
    check("license: lists the narrow pre-review set",
          "strong copyleft" in skill.lower() and "non-commercial" in skill.lower()
          and "vendor-internal" in skill.lower())
    check("license: grounds the three classes in user obligations",
          "obligations on *other people*" in skill
          and "not about our risk" in skill)
    check("license: reimplementation always remains available",
          "Reimplementation is always open" in skill
          and "expression, not the idea" in skill)
    check("license: states when to reimplement; missing license is not itself a reason",
          "Not because a file was missing" in skill)
    check("license: classification table has at least six rows",
          len(rows(lic, "## The classes")) >= 6, f"{len(rows(lic, '## The classes'))} rows")
    check("table: classification table has header and separator",
          "| Class | May be vendored | Obligation carried into this repository |" in lic
          and "\n| --- | --- | --- |\n" in lic)
    check("license: no-license row exists", "No licence file" in lic)
    check("license: no-license row now allows by default",
          "| No licence file | **Yes, by default** |" in lic)
    check("license: explains what recording buys",
          "What the record buys" in lic)
    check("license: proprietary row lists prohibitions",
          "derivative works are all forbidden" in lic)
    check("license: requires recording full text rather than a name",
          "Record the **full text**" in lic and 'only "MIT" is not' in lic)
    check("license: calls this measurement rather than awareness",
          "is a recollection" in lic and "read it" in lic)
    check("license: gives a subdirectory with separate terms",
          "can contain a non-commercial dataset" in lic)
    check("license: NC use restrictions follow downstream",
          "follows every downstream" in lic)
    check("license: states the consequence of silently importing NC",
          "converts every commercial user into a violator" in lic)
    check("license: distinguishes unknown from no license",
          "are different states" in lic)
    # Reversed axis: unknown is now a reason to record, not to block.
    check("license: imports and records unknown classifications",
          "Import it and record the state" in lic)
    check("license: identifies classes that still stop",
          "obligations land on\nour users" in lic or "obligations land on our users" in lic)

    # Negative needles ensure no contradictory policy can coexist with copy-by-default.
    both = (skill + "\n" + lic).lower()
    contra = [t for t in ("never copy", "do not copy", "must not copy",
                          "never vendor anything", "written permission",
                          "obtain permission", "permission before copying",
                          "the default is not to bring it in",
                          "unlicensed is not permissive")
              if t in both]
    check("policy: no phrase contradicts copy-by-default",
          not contra, f"contradictory phrases {contra}" if contra else "0 entries")
    check("L0: description advertises copy-by-default rather than pre-review",
          "the default is to copy it in" in fm
          and "recorded at the copy" in fm
          and "decided before the copy" not in fm)

    # (2) Paths rather than line numbers
    check("records: requires recording paths", "Record the path, not the line" in skill)
    check("records: line numbers alone are unverifiable",
          "cannot be checked" in skill and "a week later" in skill)
    check("records: line numbers move while paths remain",
          "Line numbers move" in skill and "paths do not" in skill)
    fields = rows(skill, "## Record the path, not the line")
    check("records: required-fields table has at least four rows", len(fields) >= 4, f"{len(fields)} rows")
    # Require headers and separators; row counts alone accept a broken table.
    check("table: record-fields table has header and separator",
          "| Field | Why it is not optional |" in skill
          and "\n| --- | --- |\n" in skill)
    check("records: defines 'measured' license",
          "you opened the licence file" in skill)
    check("records: record lives beside files rather than in a plan",
          "not in a plan document" in skill and "Plans get archived" in skill)

    # (3) Byte identity and separate commits
    check("import: requires byte-identical copies", "byte-identical" in skill)
    check("import: requires edits in a separate commit", "**separate**" in skill)
    check("import: explains what a combined commit destroys",
          "cannot be diffed against\nupstream" in skill or "cannot be diffed against upstream" in skill)
    check("import: builds manifest from originals, not copies",
          "generated from the copy proves nothing" in skill)
    check("import: requires suite validation of the manifest",
          "check it in the suite" in skill)

    # (4) Validators arrive with tests
    check("validator: requires importing tests with tools", "Bring the test with the tool" in skill)
    check("validator: untested validators rot silently",
          "rots\nsilently" in skill or "rots silently" in skill)
    check("validator: cannot distinguish not found from not checked",
          'between "found nothing" and' in skill)
    check("validator: calls it an unearned green signal",
          "green signal you did not earn" in skill)

    # (5) Do not replace maintained CLIs
    check("CLI: does not vendor maintained CLIs",
          "Do not vendor a maintained CLI" in skill)
    check("CLI: states what reimplementation inherits",
          "inherits the bugs the upstream already fixed" in skill)
    check("CLI: defines what may be vendored",
          "when the asset is *content*" in skill)
    check("CLI: when absent, guide and stop rather than install",
          "say what to install and stop" in skill
          and "belongs to them" in skill)

    # (6) Update procedure
    steps = re.findall(r"(?m)^\d\. ", skill)
    check("updates: procedure has four steps", len(steps) >= 4, f"{len(steps)} steps")
    check("updates: diff equals upstream changes",
          "that diff is the upstream change" in skill)
    check("updates: updates version and manifest in one commit",
          "in that commit" in skill)
    # Bind each step to its number; counts and fragment needles accept reversed procedures.
    check("updates: step 2 is bound to diffing the recorded manifest",
          "2. Diff it against the recorded manifest — that diff is "
          "the upstream change." in skill)
    check("updates: step 4 binds version and manifest updates",
          "4. Update the version field and the manifest together, "
          "in that commit." in skill)
    check("updates: steps 1 and 3 bind refetching and reapplying local changes",
          "1. Re-fetch the same asset at the new version." in skill
          and "3. Re-apply the recorded local changes on top, "
              "as their own commit." in skill)
    check("updates: requires reimport when no reapplication record exists",
          "re-import from upstream rather than to guess" in skill)

    # (7) Boundaries and language
    named = set(re.findall(r"`([a-z][a-z-]{2,})`\s*skill", skill))
    missing = [n for n in named if not os.path.isdir(os.path.join(SKILLS, n))]
    check("boundary: handoff target population is nonempty", len(named) >= 2, f"{sorted(named)}")
    check("boundary: all handoff targets exist", not missing, f"missing {missing}")
    check("boundary: states skill scope in one sentence",
          "the decision,\nthe record, and the bytes" in skill
          or "the decision, the record, and the bytes" in skill)
    check("language: description contains Korean triggers",
          len(re.findall(r"[가-힣]+", fm)) >= 5)
    check("language: description also contains English triggers", "vendor" in fm and "upstream" in fm)

    check_skill_body(check, ROOT, needles=[
        "**The default is to bring it in.**",
        "Reimplementation is always open",
        "Record the path, not the line",
        "Bring the test with the tool",
        "Do not vendor a maintained CLI",
        "byte-identical",
    ], floor=2572)

    check_ref_contracts(check, ROOT, [
        ("license-classes.md", "classification table, full-text record, measurement, NC, and unknown",
         ["No licence file", "Record the **full text**", "is a recollection",
          "follows every downstream", "are different states",
          "What the record buys"], 1645),
    ])

    check_contract_coverage(check, __file__, ROOT, per_file={
        "SKILL.md": 45, "references/license-classes.md": 17,
    }, live_ran=sum(1 for r in results
                    if not r[0].startswith(("자기검사:", "계약 커버리지:"))))
    check_body_deletion(check, __file__, ROOT, minimum=45,
                        live_ran=sum(1 for r in results
                                     if not r[0].startswith(("자기검사:", "계약 커버리지:"))))
    check_no_constant_assertions(check, __file__)
    check_total(check, results, 76)

    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n{passed}/{len(results)} 통과")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
