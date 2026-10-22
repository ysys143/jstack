#!/usr/bin/env python3
"""secrets contract suite.

Run: python3 tests/run_tests.py   (from skills/secrets)

## What this locks

1. **Rotation before scrubbing** — the reversed order is the intuitive one and
   it leaves a live credential. Without this check the skill degrades into a
   history-rewriting recipe.
2. **A removal commit is not a removal** — the reachable-blob fact is what makes
   step 1 necessary; if it thins out, step 1 reads as superstition.
3. **False positives are named** — a detector that fires on documentation and
   fixtures is run once and then disabled, so the false-positive table is load-
   bearing, not decoration.
4. **The report must not carry the value** — the one rule that gets violated by
   a helpful-looking finding.
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


def table(text, head):
    """Return table data rows below `## head`; return an empty list when absent."""
    if head not in text:
        return []
    body = text.split(head, 1)[1].split("\n## ", 1)[0]
    return [r for r in re.findall(r"(?m)^\| (?!---)(.+?) \|", body)
            if not r.strip().startswith(("Where", "Family", "Looks like", "|"))]



def main():
    fm, skill = split_frontmatter(read(os.path.join(ROOT, "SKILL.md")))
    shapes_path = os.path.join(ROOT, "references", "secret-shapes.md")
    shapes = read_ref(shapes_path)
    check("reference: references/secret-shapes.md exists",
          shapes is not None,
          "" if shapes is not None else "file missing; its entire contract disappears")
    shapes = shapes or ""
    # Normalize whitespace for cross-line needles while retaining source comparisons.
    flat = re.sub(r"\s+", " ", skill)

    # (1) Order: revoke first
    check("order: revocation precedes history cleanup",
          "Rotate the credential before touching history" in skill)
    check("order: explains why cleanup first is not containment",
          "still authenticates" in skill and "already cloned" in skill)
    check("order: chooses revocation when only one action is possible",
          "If you can only do one of the two, rotate" in skill)
    check("order: states the asymmetry between the two states",
          "dead key is\nsafe" in skill or "dead key is safe" in skill)
    check("order: description also states this order",
          "Rotation comes before history scrubbing" in fm)

    # (2) Exposure decision table
    rows = table(skill, "## Was it exposed?")
    check("exposure: destination decision table has at least four rows", len(rows) >= 4, f"{len(rows)} rows")
    # Bind rows to decisions. The earlier suite checked row names alone, so swapping
    # the unpushed and public-remote decisions kept all four checks green.
    for row, why, verdict in (
            ("Staged or committed locally, never pushed", "not pushed",
             "Not exposed — amend or reset"),
            ("Pushed to a private remote", "private remote",
             "Exposed to every reader, every CI cache, every fork"),
            ("Pushed to a public remote", "public remote",
             "Compromised. Rotate now, then scrub"),
            ("Pasted into an issue, PR body, review comment, or chat", "issue or PR",
             "Compromised, and edits do not remove it")):
        check(f"exposure: {why} row is paired with its decision",
              f"| {row} | {verdict}" in skill)
    check("exposure: states that editing does not erase exposure",
          "edits do not remove it" in skill and "notification emails" in skill)
    check("exposure: definition follows where the value traveled, not who observed it",
          "Exposure is about where the object travelled, not about whether "
          "anyone was watching" in flat)
    check("exposure: ambiguous cases choose the lower bound",
          "Take the lower one" in skill)
    check("exposure: explains the asymmetric cost basis",
          "cost of a missed one is unbounded" in skill)

    # (3) A deletion commit does not delete history
    check("deletion: states that the old blob remains reachable",
          "still reachable" in skill)
    check("deletion: identifies forks, PR refs, and mirrors as separate copies",
          "Forks, pull-request refs, and mirrors are separate" in skill)
    check("deletion: states that force-push does not reach those copies",
          "force-push never reaches" in skill)
    steps = re.findall(r"(?m)^\d\. ", skill)
    check("deletion: three numbered steps exist", len(steps) >= 3, f"{len(steps)} steps")
    # Bind order to step numbers. Counting alone would accept cleanup as step 1 and
    # revocation as step 3, reversing the reason this skill exists.
    check("deletion: step order is bound to numbers (1=revocation, 2=history, 3=notify forks)",
          "1. Rotate at the issuer" in skill
          and "2. Rewrite the history that contains it" in skill
          and "3. Ask the forge to expire cached views" in skill)
    check("deletion: requires proving the old value fails",
          "confirm the old value now fails" in skill)

    # (4) False-positive families have names
    check("reference: entry instructions require reading the reference before reporting",
          "`references/secret-shapes.md`" in skill
          and "Read that file before reporting anything" in skill)
    fps = table(shapes, "## False-positive families")
    check("false positives: family table has at least four rows", len(fps) >= 4, f"{len(fps)} rows")
    check("false positives: states the cost of false reports",
          "nobody runs twice" in skill)
    check("false positives: high entropy alone is not a finding",
          "High-entropy alone is not a finding" in skill)
    check("false positives: defines discriminators by shape",
          "**discriminator**" in shapes and "does not have" in shapes)
    fams = table(shapes, "## Families")
    check("shapes: secret-family table has at least five rows", len(fams) >= 5, f"{len(fams)} rows")
    check("shapes: states that the public half of a key is not secret",
          "Publishing it is the point" in shapes)
    check("shapes: ambiguous candidates are not handled silently",
          "silence reads as" in shapes and "never quietly dropped" in shapes)
    check("shapes: private-key discriminator is paired with its report decision",
          "| Private key block | The PEM `BEGIN ... PRIVATE KEY` armour "
          "| The armour is unambiguous; report it without further scoring |" in shapes)
    check("false positives: row is paired with its decision",
          "| The public half of a keypair | Publishing it is the point |" in shapes
          and "| A content hash, commit SHA, or UUID | High entropy, no issuer, "
              "nothing to authenticate against |" in shapes)
    # Detect migration between the two tables. Moving a real leak family into the
    # false-positive table changes it to do-not-report without affecting counts or needles.
    fam_body = shapes.split("## Families", 1)[-1].split("\n## ", 1)[0]
    fp_body = shapes.split("## False-positive families", 1)[-1].split("\n## ", 1)[0]
    leaked = [t for t in ("PRIVATE KEY", "user:password@", "vendor prefix") if t in fp_body]
    demoted = [t for t in ("Publishing it is the point",
                           "nothing to authenticate against") if t in fam_body]
    check("tables: leak and false-positive families have not crossed tables",
          not leaked and not demoted,
          (f"false-positive table contamination {leaked} " if leaked else "")
          + (f"family table contamination {demoted}" if demoted else ""))
    check("shapes: does not invent revocation commands",
          "does not invent one" in shapes)
    check("shapes: revocation evidence is failure of the old value",
          "not the rotation call returning success" in shapes)

    # (5) .gitignore is not a gate
    check("gate: .gitignore is not a gate",
          "`.gitignore` is not a gate" in skill)
    check("gate: explains why tracked paths are unaffected",
          "already tracks" in skill)
    check("gate: provides concrete check and untrack commands",
          "git check-ignore -v" in skill and "git rm --cached" in skill)
    # Mere presence accepts swapped command roles. Bind each command to its sentence.
    check("gate: check-ignore verifies and rm --cached untracks",
          "Check with `git check-ignore -v <path>`" in skill
          and "use `git rm --cached` first" in skill)
    check("gate: directs the check before commit rather than during review",
          "pre-commit hook" in skill and "already been written to the object database" in skill)

    # (6) Three prohibitions
    nevers = re.findall(r"(?m)^- \*\*Never ", skill)
    check("prohibitions: at least three Never clauses", len(nevers) >= 3, f"{len(nevers)} clauses")
    check("prohibitions: sentence forbids committing with intent to fix later",
          "- **Never commit a secret to fix later.** "
          "There is no later that undoes it." in skill)
    check("prohibitions: forbids putting the value in a report",
          "Never put the secret in the report" in skill)
    check("prohibitions: explains that reports travel farther than files",
          "wider distribution than the file did" in skill)
    check("prohibitions: blocks the prefix-only workaround",
          "never by prefix long enough to" in skill)
    check("prohibitions: forbids silent revocation and explains why",
          "Never rotate silently" in skill and "outage you caused" in skill)

    # (7) Boundaries and language
    named = set(re.findall(r"`([a-z][a-z-]{2,})`\s*skill", skill))
    missing = [n for n in named if not os.path.isdir(os.path.join(SKILLS, n))]
    check("boundary: handoff target population is nonempty", len(named) >= 2, f"{sorted(named)}")
    check("boundary: every handoff target exists", not missing, f"missing {missing}")
    # Existence alone accepts swapped handoff reasons for audit and cleanup.
    check("boundary: handoff mapping is correct (audit=quality, cleanup=residue, gitrules=Git reachability)",
          "Judging code quality is the `audit` skill" in flat
          and "removing the dead code left behind after a rotation is the "
              "`cleanup` skill" in flat
          and "What git can and cannot reach when rewriting history — and the "
              "ignore-file mechanics — belong to the `gitrules` skill" in flat)
    check("boundary: states where this skill stops", "stops there" in skill)
    check("language: description contains Korean triggers",
          len(re.findall(r"[가-힣]+", fm)) >= 5)
    check("language: description also contains English triggers", "credential leak" in fm)
    # Removing trigger vocabulary breaks activation without affecting volume or survival.
    gone = [t for t in ("시크릿", "비밀키", "API 키", "토큰 노출", "커밋에 키가",
                        ".env 커밋", "히스토리 지워야", "키 유출") if t not in fm]
    check("L0: all Korean trigger terms remain",
          not gone, f"missing triggers {gone}" if gone else "8 triggers")

    check_skill_body(check, ROOT, needles=[
        "Rotate the credential before touching history",
        "If you can only do one of the two, rotate",
        "`.gitignore` is not a gate",
        "Never put the secret in the report",
        "Take the lower one",
    ], floor=2662)

    check_ref_contracts(check, ROOT, [
        ("secret-shapes.md", "discriminators, family tables, false positives, and revocation evidence",
         ["**discriminator**", "Publishing it is the point",
          "silence reads as", "not the rotation call returning success"], 1880),
    ])

    check_contract_coverage(check, __file__, ROOT, per_file={
        "SKILL.md": 44, "references/secret-shapes.md": 12,
    }, live_ran=sum(1 for r in results
                    if not r[0].startswith(("자기검사:", "계약 커버리지:"))))
    check_body_deletion(check, __file__, ROOT, minimum=44,
                        live_ran=sum(1 for r in results
                                     if not r[0].startswith(("자기검사:", "계약 커버리지:"))))
    check_no_constant_assertions(check, __file__)
    check_total(check, results, 71)

    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n{passed}/{len(results)} 통과")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
