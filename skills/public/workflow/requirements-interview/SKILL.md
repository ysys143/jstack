---
name: requirements-interview
description: "Interview about a request or work in progress, or grill assumptions. Triggers: 인터뷰, 가정 공격."
---

# Requirements interview — ask before and while building

This skill supplies evidence-first questions and a place to record the answers.
The answers are the user's. It runs before a spec exists, in the middle of an
implementation, or on one decision the user names; it never writes code.

## Modes

| Mode | Use when | Stance | Default limit |
|---|---|---|---|
| **interview** | "인터뷰", "요구사항 인터뷰", "interview me", `/interview` | Cooperative discovery: find what is not yet settled | 5 questions per pass |
| **grill** | "grill me", "파고들어", "내 가정 공격해줘", `/grill-me` | Adversarial: attack each assumption and ask what breaks it | 8 challenges per pass |

A batched call (see Question discipline) counts each question in it toward the
limit. In grill mode, read [the grill-mode reference](references/grill-mode.md)
before the first challenge. Hosts without slash commands select the mode from the
phrase; "이어서 인터뷰" or "resume the interview" means resume.

## Read the evidence before asking anything

**Never ask what the code already answers.** Before the first question, read in
this order and stop at what exists:

1. The topic, paths, or documents the user named.
2. The spec: the path the user names, else `spec.md` beside the task's contract
   source, else `spec.md` or `docs/**/spec*.md` at the repository root. Read its
   User stories, Acceptance criteria, Edge cases, Constraints, Decisions, and
   Assumptions.
3. The task contract `.jstack/tasks/<id>/contract.yaml`. Use the task the user named,
   else the only task directory, else ask which one. Its `검증` requirements are
   behavior already settled. When `.jstack/tasks/<id>/task.json` exists, run
   `node "${JSTACK_PLUGIN_ROOT}/skills/verify/scripts/workflow.js" status <id>`.
4. `git status --short`, `git diff --stat`, the diffs of the files the contract
   names under `관련파일`, and `git log --oneline -20`.
5. `AGENTS.md` and `CLAUDE.md` constraints.

**Never edit `contract.yaml`.** It is immutable; changing it invalidates the task's
evidence. If an answer changes a requirement, say so and hand the user to the
`plan` skill to initialize a new task contract.

**Run what a run can answer.** When an open item is about behaviour, timing,
output or performance, run the smallest throwaway probe in a scratch directory and
record the result as evidence instead of asking. Ask only about product or
preference calls that no run can settle. The probe states its question and method
first, stays local and reversible, installs nothing, touches no shared state and
keeps none of its code. If it would need more than that, ask for that one decision.

Before the first question, show what is already settled in at most three lines,
each with its source.

Then say in your own words what you think the user wants and what problem it
solves, in a sentence or two, and let them correct it before any question builds
on a misreading. It is a statement, not a question, and it does not count toward
the limit. In a named-topic interview, restate the topic only.

## Three entry contexts

| Context | How to recognize it | Do not ask | Ask |
|---|---|---|---|
| **No spec yet** | No spec, no task root, a new request | Facts the repository answers: stack, modules, conventions (cite the path) | The five questions below |
| **Mid-implementation** | A spec or contract exists, or the diff touches the files the request is about | What the spec or contract states; what the diff already implements | Acceptance criteria that are not verifiable sentences; diff hunks that change behavior the spec does not mention; spec assumptions the code now contradicts; the topic the user named |
| **Named topic** | The user named a decision ("interview me about X") | Everything outside X | The five questions applied to X only; in grill mode, each assumption about X |

A diff in unrelated files does not make the work mid-implementation. In the middle
of an implementation every question cites the evidence that raised it, for
example: "`spec.md` AC-3 says 'fast'; `src/x.ts:40` scans every row. What is the
limit?"

## The five questions

| Ask | Why |
|---|---|
| **Who uses it, and when** | Usage context changes the design |
| **What happens without it** | Reveals whether it is actually needed |
| **What are the boundaries** | Empty input, maximum, concurrent access |
| **What if it fails** | Recoverable? Partial failure? |
| **Who decides** | What the system settles vs. what a person settles |

## Question discipline

- **One question per turn.** Batched open questions get shallow answers. The one
  exception: up to three independent questions in one call when each has two to
  four concrete options.
- When `AskUserQuestion` is available, use it for every question with concrete
  options: put the recommended option first, mark it `(recommended)`, and give a
  one-line reason. Use prose for open questions (names, who uses it), and when the
  tool is not available; then number the options in the message.
- After the mode's limit, give the readiness report instead of another question.
  The user extends with "continue" or "더".
- Stop when the user says stop ("그만", "enough", "stop"). Give the readiness
  report and end.

## Stop condition

The interview ends when every open item has an answer or a recorded assumption
and every acceptance criterion is a verifiable sentence. In grill mode it also
needs an outcome for every listed assumption: held, changed, or dropped.

Do not compute or display a numeric ambiguity score. A score hides which item is
open; the readiness report lists the items so the user can dispute each line:

```
settled  | <item> | by user, <YYYY-MM-DD>            (or: by evidence src/x.ts:40)
assumed  | <item> | revisit when <condition>
open     | <item> | <the question that is still unanswered>
```

In grill mode, add one row per listed assumption with its outcome: `held`,
`changed`, or `dropped`.

End by offering the next step: the `plan` skill to write or update the spec
(unless the interview is already running inside it), the `tdd` skill to build, or
the `verify` skill to judge completion.

## Record

Append to `## Decisions` and `## Assumptions` in the spec; do not create a second
log. Add a section the spec lacks. Questions and their answers go under
`## Decisions`; assumptions go under `## Assumptions`. One line per item, with one
status from this vocabulary: `settled`, `open`, `assumed`, `held`, `changed`,
`dropped`.

```
- <YYYY-MM-DD> | Q: <question> | A: <answer> | status: settled | source: user | evidence: <path:line>
- <YYYY-MM-DD> | Q: <question> | status: open
- <YYYY-MM-DD> | <assumption> | status: assumed | revisit when: <condition>
```

Record an unanswered question as `open` before ending, so a later pass can find
it. When an item's status changes, edit its status field and add the date; for
`held`, also add `reason:`. Never delete a line.

When no spec exists, do not invent a path. End with the Decisions and Assumptions
block in the reply; the `plan` skill carries it into the spec it writes.

## Resume

To resume, re-read `## Decisions` and `## Assumptions`, then the diff since the
latest recorded date, and continue from the first line whose status is `open`.
The spec is the state; there is no separate state file.

## Boundaries

| Task | Owner |
|---|---|
| Writing the spec and the task contract | `plan` skill |
| Whether the slices still fit, mid-course | `plan` skill (its slice-shape check) |
| Building what was decided | `tdd` skill |
| Recording an expensive decision with alternatives | `decide` skill |
| An independent attempt to refute a finished proposal or result | `consult` skill |
| Judging whether it is done | `verify` skill |

## Limits (stated)

- This skill supplies **questions and a record**. It does not verify the answers.
- It does not judge whether the decision is right — only whether it is written
  down and checkable.
- The user can end the interview at any time.

## Optional SDLC caller

When an explicitly selected `sdlc` run calls this skill, follow
[the leaf rules in sdlc](../sdlc/SKILL.md#leaf-skills-called-by-a-run). A standalone
call needs no run context.
