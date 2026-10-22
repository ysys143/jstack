# Slop criteria — the closed list under *excess*, and who settles each row

Axis 8 of `quality-taxonomy.md` is one face of the property **excess**: something
is here that carries no decision. This file is the adjudication layer for that
axis. The taxonomy says *what* the closed list holds; this file says *who or what
settles a candidate*, and why the list is closed at all.

**Without a closed list the axis degrades into a euphemism for taste.** Of the
three symptoms that first suggested themselves as "AI slop", two turned out to be
restatements of another axis. An open list would have counted the same defect
twice under two names and called the second count a new finding.

## The rule

> **No adjudicator, no finding.**

A symptom belongs on this list only if someone can name the observation that
settles it — a command, a file position, or a question with one answer. A
symptom that can only be settled by "it feels generated" is not admitted, no
matter how confident the reader is.

## The closed list

Five rows. Each carries its adjudicator and the axis it is most often confused
with. **Nothing outside this table is reported under axis 8.**

| # | Symptom | Adjudicator — what settles it | Confused with |
|---|---|---|---|
| S1 | A comment that restates the line below it | Delete the comment and read the line. If nothing was lost, the comment restated it | Axis 7 — magic that genuinely needs explaining |
| S2 | A test that asserts the mock, not the behaviour | Break the implementation and leave the mock. If the test still passes, it asserts the mock | Axis 5 — a thin wrapper being tested |
| S3 | Defensive branches for states the type system already excludes | Name the value that reaches the branch. If the type cannot hold it, the branch is unreachable by construction | Axis 2 — branch complexity a change actually added |
| S4 | Names that describe the implementation, not the caller's intent | Ask what the caller wants. If the name answers "how it works" instead, it names the implementation | — |
| S5 | A wrapper introduced for a single call site | Count the call sites. One means the indirection carries no decision | Axis 5 — **report as 5, not 8** |

S5 is on the list and is simultaneously routed away from it. That is
deliberate: the symptom is recognisable here, so it must be named here, but the
finding is filed under axis 5 so the same wrapper is never counted twice.

## Candidates that were rejected, and why

The rejections are part of the closed list. Without them the list reopens every
time someone rediscovers one of these.

| Rejected candidate | Why it is not admitted |
|---|---|
| Repetitive prose in comments or docstrings | **Restatement of another axis** — S1 already covers the case where the repetition carries no information, and prose style is not a code property |
| Over-long identifiers | Style, not excess. No adjudicator exists that separates a long precise name from a long vague one |
| "Looks machine-written" as a whole-file impression | No adjudicator. The reader cannot name the observation that settles it, so it cannot be argued with, only asserted |
| Boilerplate that a framework requires | Not excess — the decision it carries belongs to the framework, and removing it breaks the build. The adjudicator is the build |
| Duplicated blocks across files | **Restatement of another axis** — this is the *duplication* property, and the canonical-layer question (axis 9) has a higher signal-to-noise ratio than hunting duplicates |

## Excess against the other five properties

Six properties carry the taxonomy: duplication, unused, cycles, swallowed
failure, dead path, **excess**. Excess is the only one of the six with no
detector in any language (see `lang-matrix.md`), which is exactly why it needs
this file. The other five are settled by running something; excess is settled by
the five adjudicators above, and by nothing else.

| Property | How a finding is settled |
|---|---|
| duplication · unused · cycles · swallowed failure · dead path | A detector, or a stated reading when the language has none |
| **excess** | One of S1–S5 and its adjudicator. There is no sixth route |

## Reporting

A finding under axis 8 states three things: which row (S1–S5), the observation
the adjudicator produced, and the file position. A finding that cannot state all
three is not reported. **A symptom you can see but cannot settle is a note to
yourself, not a finding.**
