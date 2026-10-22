---
name: record-decision
description: "Record an architecture decision (ADR) with alternatives and costs. Triggers: ADR, 기술 결정."
---

# Decide — leave the decision behind

## Why record

**Six months on, somebody will ask "why was it done this way?"** By then the code
shows the outcome and not the reason, and the rejected alternatives leave no
trace at all.

Without the record two things happen: alternatives already examined and rejected
get examined again, or something that must not change gets changed by someone who
did not know.

## When to write one

Record **only decisions that are expensive to reverse**. Record everything and
nobody reads any of it.

| Record | Do not |
|---|---|
| Datastore, framework choice | Variable names |
| Data formats, API contracts | Function extraction |
| Taking on an external dependency | Code style |
| Security and permission model | Temporary workarounds |

## Format — MADR

Write `docs/adr/NNNN-title.md`. Numbers are sequential and never reused.

```markdown
# NNNN. Title (ends with a verb)

## Status
Proposed | Accepted | Deprecated | Superseded by NNNN

## Context
What the problem was. **Only what was known at decision time** — mixing in what
you learned later makes that judgment look foolish.

## Decision
What was decided, in one sentence.

## Alternatives
What was considered and **rejected**, and why. This section is what makes the
document worth keeping.

| Alternative | Why rejected |
|---|---|
| Approach B | At our scale the operational cost exceeds the gain |

## Consequences
What this decision **costs**. Do not write "none" — a decision without a cost is
not a decision.

## Reversing it
What it would take, and how expensive that is.
```

## Changing status

**Never edit the old document.** Write a new ADR and set the old one's status to
`Superseded by NNNN`. The trail of changed judgment is itself the record.

## Commonly omitted

- **An empty alternatives section** — that records "this was the only thing considered"
- **Consequences: "none"** — then it was not a choice but the only road, and an
  ADR is not needed
- **Hindsight in the context** — writing what you did not know as if you did
  misleads the next reader about the basis for the call

## Boundaries

| Task | Owner |
|---|---|
| Deciding what to build | `plan` skill |
| Implementation | `tdd` skill |

## Limits (stated)

- This skill supplies **a format**. The decision is the user's
- It does not verify the decision is right — only that the alternatives and
  consequences sections are filled
