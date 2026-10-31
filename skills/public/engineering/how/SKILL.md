---
name: how
description: "Explain how code works and where things live. Triggers: 어떻게 동작, 구조 설명, 어디에 둬야."
---

# how — explain the code so the reader can work in it

Answer "how does X work?", "walk me through this before I change it", and
placement questions such as "where should this live?", "which package owns
this?", or "is this the right layer?". The result is the explanation a senior
engineer would give someone new to the subsystem: enough to build a working
mental model, not a tour of annotated source. This skill reads and explains. It
changes no file.

## 1. Size the question

If the scope is ambiguous, state your reading of it and go on; the user can
redirect.

- **Small** (one module, a utility, a narrow question such as "how does function
  X work"): read the code yourself and explain it. No delegation.
- **Large** (a subsystem across files or services, a cross-cutting feature, an
  architecture overview): split the reading, as in step 2.

When in doubt, take the small path. Delegating a question shorter than its brief
costs more than answering it.

## 2. Read in parallel (large questions only)

Break the question into two to four angles, each a distinct slice of the
subsystem. Reading different areas is independent work whose outputs are
findings, not edits, so it fits `parallel-execution`.

- Give each reader one angle and a brief that survives without this
  conversation. `references/explorer-brief.md` has the template and the report
  shape.
- Readers are read-only. They never edit. After they return, run `git status`;
  a reader that changed a file is a defect to report.
- Choose the tier by `model-selection` and say why. Tracing a call path that you
  will spot-check is cheap work. Do not pin a model name here.
- Account for every reader. A slice with no result falls under [the missing-check rule](../verify/SKILL.md#a-missing-check-is-not-a-pass): ask once
  more, then say what stays unexplained.

## 3. Combine the findings yourself

Writing the explanation is one judgment, so one context holds all of it. Do not
split the writing across several workers. The readers' findings overlap and can
disagree. Merge the overlaps and settle each disagreement by reading the code
yourself. Carry their open questions into the answer instead of hiding them.

For a placement question, answer from evidence: name the layer or package that
already owns the neighbors of this code, and cite them. If the repository shows
no convention, say so; do not invent one.

## 4. Order the explanation

The order is the part that makes an explanation land.

- **Give the smallest complete answer first.** One or two sentences that stand
  alone, then stop. Add layers only when the reader asks. When there is no live
  reader (a one-shot run), deliver the full account in one pass and put the offer
  to go deeper at the end.
- **Define terms before using them.** Name the thing and say what it is in
  general terms, with its common name if it has one. Then tie it to this code
  ("in X, this is what handles ..."), and build from there: how it works, why it
  works that way, the edge cases.
- **Say concrete things.** "`UserService` calls `AuthClient.refresh()`", not "the
  service delegates to the client". When something is complicated, say why it is
  complicated. When it is simple, do not pad it. Use an analogy only if one
  actually helps.
- **Stack diagrams for three or more parts.** Do not draw every part in one
  picture. Draw the first two and their link, redraw with the third added, then
  the next, so the reader watches the system assemble. A single all-at-once
  diagram is a reference, not an explanation. Use Mermaid for flow and structure
  where labels carry the meaning, and plain text for a simple relationship. If
  prose already covers the flow, draw nothing.
- **No quizzes and no theater.** Do not ask the reader to repeat anything back, do
  not announce a pause, and do not flag a part as important, tricky, or
  interesting. Say the part and move on.

`references/explanation-format.md` has the section layout for a full answer.

## 5. Present it

Reply with the explanation itself, not a report about the work you did. Lead with
the main point. End with the threads worth following next, if there are any.
Write in the user's language; keep code names and paths as they appear in the
repository.

## Boundaries

| Task | Owner |
|---|---|
| Why a design was chosen, and its history | `research` skill, or the recorded decision (`decide` skill) |
| Planning a change after understanding the code | `plan` skill |
| Judging the quality of existing code | `audit` skill |
| Draw a finished architecture as SVG | `diagram` skill |

## Limits (stated)

- The explanation is true of the revision you read. Say which one when it
  matters
- Intent is not in the code. State a reason only where a commit, a decision
  record, or a comment states it; otherwise say the reason is unknown
- A path you could not trace is listed as untraced, not guessed
