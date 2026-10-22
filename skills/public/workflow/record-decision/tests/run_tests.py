#!/usr/bin/env python3
"""decide contract suite.

Run: python3 tests/run_tests.py   (from skills/decide)

## What this locks

1. **The alternatives section is the point** — an ADR without rejected options
   records only the outcome, which the code already shows.
2. **Consequences must not be "none"** — a decision with no cost was not a
   decision, and the template must say so where the author will read it.
3. **Supersede, never edit** — editing the old document destroys the trail of
   changed judgment, which is the thing being kept.
4. **Only expensive-to-reverse decisions** — the record-everything failure mode
   is what makes ADR directories unread.
"""
import os
import re
import sys

sys.dont_write_bytecode = True
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
from _suite_lib import (check_no_constant_assertions, check_total, check_skill_body,
                        split_frontmatter, check_body_deletion,
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


def template(text):
    """Return the MADR template inside the markdown fence, or an empty string."""
    m = re.search(r"```markdown\n(.*?)```", text, re.S)
    return m.group(1) if m else ""


def main():
    fm, skill = split_frontmatter(read(os.path.join(ROOT, "SKILL.md")))
    tpl = template(skill)

    # (1) The template exists
    check("template: MADR template exists inside a markdown fence", len(tpl) > 200, f"{len(tpl)}B")
    heads = re.findall(r"(?m)^## (.+)$", tpl)
    check("template: has at least five sections", len(heads) >= 5, f"{heads}")
    for h, why in (("Status", "status"), ("Context", "context"), ("Decision", "decision"),
                   ("Alternatives", "alternatives"), ("Consequences", "consequences"),
                   ("Reversing it", "reversal")):
        check(f"template: {why} section exists", h in heads)
    check("template: file path convention exists", "docs/adr/NNNN-title.md" in skill)
    check("template: numbers are never reused", "never reused" in skill)
    check("template: all four status values are listed",
          all(v in tpl for v in ("Proposed", "Accepted", "Deprecated", "Superseded")))

    # (2) Alternatives are essential
    check("alternatives: requires recording rejected options", "**rejected**" in tpl)
    check("alternatives: states why this section makes the document worth keeping",
          "what makes the\ndocument worth keeping" in tpl
          or "what makes the document worth keeping" in tpl)
    check("alternatives: provides a table and example row",
          "| Alternative | Why rejected |" in tpl and "Approach B" in tpl)
    check("alternatives: explains what an empty section records",
          "this was the only thing considered" in skill)

    # (3) Consequences cannot be none
    check("consequences: requires recording costs", "**costs**" in tpl)
    check("consequences: forbids 'none' inside the template", 'Do not write "none"' in tpl)
    check("consequences: a decision without cost is not a decision",
          "a decision without a cost is\nnot a decision" in tpl
          or "a decision without a cost is not a decision" in tpl)
    check("consequences: states that 'none' means no ADR is needed",
          "an\nADR is not needed" in skill or "ADR is not needed" in skill)

    # (4) Supersede rather than overwrite
    check("supersession: forbids editing the old document",
          "**Never edit the old document.**" in skill)
    check("supersession: directs writing a new ADR and updating status",
          "Superseded by NNNN" in skill)
    check("supersession: the trail of changed judgment is the record",
          "trail of changed judgment is itself the record" in skill)

    # (5) Select what to record
    check("selection: records only decisions expensive to reverse",
          "**only decisions that are expensive to reverse**" in skill)
    check("selection: states the consequence of recording everything",
          "nobody reads any of it" in skill)
    keep = re.findall(r"(?m)^\| (?!---)(?!Record\b)(.+?) \| (.+?) \|$", skill)
    check("selection: record/do-not-record table has at least four rows", len(keep) >= 4, f"{len(keep)} rows")
    for word, why in (("Datastore", "datastore choice"), ("Variable names", "variable names"),
                      ("Security and permission model", "security model"),
                      ("Temporary workarounds", "temporary workaround")):
        check(f"selection: {why} appears in the table", word in skill)

    # (6) Common omission: hindsight
    check("omissions: forbids mixing hindsight into context",
          "**Only what was known at decision time**" in tpl)
    check("omissions: explains what hindsight damages",
          "look foolish" in tpl)
    check("omissions: states that it misleads the next reader",
          "misleads the next reader" in skill)
    omits = re.findall(r"(?m)^- \*\*(.+?)\*\*", skill)
    check("omissions: at least three commonly omitted items", len(omits) >= 3, f"{len(omits)} items")

    # (7) Limits and boundaries
    check("limits: supplies a format while the decision belongs to the user",
          "**a format**" in skill and "decision is the user's" in skill)
    check("limits: does not verify that the decision is correct",
          "does not verify the decision is right" in skill)
    named = set(re.findall(r"`([a-z][a-z-]{2,})`\s*skill", skill))
    missing = [n for n in named if not os.path.isdir(os.path.join(SKILLS, n))]
    check("boundary: handoff target population is nonempty", len(named) >= 2, f"{sorted(named)}")
    check("boundary: all handoff targets exist", not missing, f"missing {missing}")
    check("language: description contains Korean triggers",
          len(re.findall(r"[가-힣]+", fm)) >= 5)
    check("language: description also contains English triggers", "adr" in fm and "architecture decision" in fm)

    # (8) Sentence-level contracts. Most needles above are noun phrases or fragments, so
    # inserting a negation leaves them intact. `**only decisions that are
    # expensive to reverse**` also occurs in "Do not record **only decisions that are
    # expensive to reverse**". Adversarial validation rewrote the document to the opposite
    # instruction without changing this judgment (Z-1).
    # Bind the entire sentence containing the judgment. Normalize line breaks so
    # reflowing does not break the contract.
    flat = re.sub(r"\s+", " ", skill)
    ftpl = re.sub(r"\s+", " ", tpl)
    for label, sent in (
        ("selection rule", "Record **only decisions that are expensive to reverse**. "
                      "Record everything and nobody reads any of it."),
        ("forbid 'none'", 'What this decision **costs**. Do not write "none" '
                        "\u2014 a decision without a cost is not a decision."),
        ("why alternatives exist", "What was considered and **rejected**, and why. "
                                "This section is what makes the document worth keeping."),
        ("meaning of empty alternatives", "- **An empty alternatives section** \u2014 that records "
                              '"this was the only thing considered"'),
        ("do not edit old documents", "**Never edit the old document.** Write a new ADR and "
                              "set the old one's status to `Superseded by NNNN`."),
        ("the trail is the record", "The trail of changed judgment is itself the record."),
        ("decision correctness is not verified",
         "It does not verify the decision is right \u2014 only that the alternatives "
         "and consequences sections are filled"),
        ("numbers are never reused", "Numbers are sequential and never reused."),
        ("none means no ADR",
         '- **Consequences: "none"** \u2014 then it was not a choice but the only '
         "road, and an\nADR is not needed".replace("\n", " ")),
        ("forbid hindsight", "**Only what was known at decision time** \u2014 mixing in "
                           "what you learned later makes that judgment look foolish."),
        ("hindsight misleads readers",
         "- **Hindsight in the context** \u2014 writing what you did not know as if "
         "you did misleads the next reader about the basis for the call"),
        ("format-only limit",
         "This skill supplies **a format**. The decision is the user's"),
        ("reason to record",
         '**Six months on, somebody will ask "why was it done this way?"**'),
    ):
        check(f"sentence: {label} exists verbatim", sent in flat,
              "" if sent in flat else f"missing: {sent[:48]}...")

    # (9) Bind each boundary row to its owner. Set membership alone allows
    # swapping plan and tdd ownership without detection (two adversarial cases).
    bound = re.findall(r"(?m)^\| (.+?) \| `([a-z][a-z-]+)` skill \|$", skill)
    check("boundary: plan owns deciding what to build",
          ("Deciding what to build", "plan") in bound, f"{bound}")
    check("boundary: tdd owns implementation",
          ("Implementation", "tdd") in bound, f"{bound}")
    check("boundary: boundary table has exactly two rows", len(bound) == 2, f"{len(bound)} rows")

    # (10) Bind selection-table rows verbatim. Swapping record/do-not-record columns
    # preserves every word-membership check above.
    for row in ("| Datastore, framework choice | Variable names |",
                "| Data formats, API contracts | Function extraction |",
                "| Taking on an external dependency | Code style |",
                "| Security and permission model | Temporary workarounds |"):
        check(f"selection: row '{row.split(' | ')[0][2:]}' preserves both columns", row in skill)
    # Count within the section so alternatives and boundary tables are excluded.
    sect = re.search(r"(?ms)^## When to write one$(.*?)^## ", skill)
    sel = re.findall(r"(?m)^\| (?!-)(?!Record \|)(.+?) \| (.+?) \|$",
                     sect.group(1) if sect else "")
    check("selection: record/do-not-record table has exactly four rows", len(sel) == 4, f"{len(sel)} rows {sel}")

    # (11) Counts and format. Status order and `by NNNN` are meaningful.
    check("template: status line lists four values in order",
          "Proposed | Accepted | Deprecated | Superseded by NNNN" in ftpl)
    check("template: rejection table header is verbatim",
          "| Alternative | Why rejected |" in ftpl)
    check("template: rejection example row is verbatim",
          "| Approach B | At our scale the operational cost exceeds the gain |" in ftpl)

    # (12) Minimum section skeleton. Unique filler can bypass a volume floor
    # because content_bytes removes only duplicate lines. Binding heading order
    # prevents padding from restoring structure; set membership accepts reverse order.
    doc_body = re.sub(r"```markdown\n.*?```", "", skill, flags=re.S)
    doc_heads = re.findall(r"(?m)^## (.+)$", doc_body)
    check("skeleton: document section headings preserve order",
          doc_heads == ["Why record", "When to write one", "Format \u2014 MADR",
                        "Changing status", "Commonly omitted", "Boundaries",
                        "Limits (stated)"], f"{doc_heads}")
    check("skeleton: template section headings preserve order",
          heads == ["Status", "Context", "Decision", "Alternatives",
                    "Consequences", "Reversing it"], f"{heads}")
    check("skeleton: exactly one markdown fence",
          len(re.findall(r"(?m)^```markdown$", skill)) == 1,
          f"{len(re.findall(r'(?m)^```markdown$', skill))} entries")

    check_skill_body(check, ROOT, needles=[
        "**only decisions that are expensive to reverse**",
        "**Never edit the old document.**",
        'Do not write "none"',
        "**Only what was known at decision time**",
        "docs/adr/NNNN-title.md",
    ], floor=1715)

    check_contract_coverage(check, __file__, ROOT, per_file={"SKILL.md": 71},
                            live_ran=sum(1 for r in results
                                         if not r[0].startswith(("자기검사:", "계약 커버리지:"))))
    check_body_deletion(check, __file__, ROOT, minimum=71,
                        live_ran=sum(1 for r in results
                                     if not r[0].startswith(("자기검사:", "계약 커버리지:"))))
    check_no_constant_assertions(check, __file__)
    check_total(check, results, 81)

    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n{passed}/{len(results)} 통과")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
