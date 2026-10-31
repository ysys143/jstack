---
name: parallel-execution
description: Split parallel work when pieces can be checked separately; verify what comes back. Triggers — "병렬로", "동시에 여러", "서브에이전트", "에이전트 여러개", "팀으로", "나눠서 진행", "parallel", "fan out", "작업 분배".
---

# Team — split what can be checked separately

## When parallelism is the right shape

Parallel work pays when the pieces are **independent to check**, not merely
independent to start. Two agents editing the same module in parallel produce a
merge you have to re-derive, which costs more than doing it once.

| Split it | Keep it whole |
| --- | --- |
| The same transformation over many files | One design whose parts constrain each other |
| Independent searches over different areas | A change and the tests that lock its intent |
| Several perspectives reviewing one artefact | A sequence where each step needs the last step's result |
| Gathering from many sources | The synthesis of what was gathered |

Row three is worth naming: several agents reviewing **the same thing** from
different angles is parallelism with no merge problem, because the outputs are
findings rather than edits.

The synthesis in row four is the one people split by accident — they fan out the
gathering, then let the same fan-out write the conclusion, and get four partial
conclusions nobody reconciles. `models` covers the tier side of the same line.

## Experimental task-size comparison

Choose local work, one delegated task, or separately checkable parallel parts
from the actual task and the user's delegation permission first. When the user
or session has explicitly enabled `JSTACK_JEV=task-size`, record that **already
chosen** shape with `jst jev task-size`. Supply only the work type, impact,
constraint level, changed-file count, independent-part count, and whether
delegation is allowed. Do not supply prompt text, file names, paths, or private
profiles as task features. The workspace path is used locally to scope the
request budget; it is not sent to Jev.

For example, after choosing two independent coding tasks with authorization:

```bash
jst jev task-size --decision parallel --work-type coding --impact low \
  --constraints simple --changed-files 2 --independent-parts 2 \
  --delegation-allowed true
```

This is an off-by-default shadow comparison. Its suggestion cannot authorize
delegation, change the chosen shape, or replace the brief and verification
rules below. Do not invoke it on every prompt or tool event.

## A brief must survive without your context

A fresh-context subagent does not see this conversation. A fork may inherit
earlier decisions and instructions. State which context is inherited; repeat
essential permissions and ownership in the brief regardless. Missing constraints
can come back confidently wrong rather than confused.

Every brief states: what to produce, what shape the answer takes, what is out of
scope, and what has already been established. The last one is the one that gets
dropped, and it is why agents rediscover — sometimes differently — what you
already settled.

`references/briefs.md` has the brief template and the failure modes each field
prevents.

When a version 2 task contract exists, do not hand-write a second source of
truth. Run the local readiness check and derive the brief from the immutable
contract:

```bash
node "${JSTACK_PLUGIN_ROOT}/skills/verify/scripts/workflow.js" preflight <task-id>
node "${JSTACK_PLUGIN_ROOT}/skills/verify/scripts/workflow.js" brief <task-id>
```

Only delegate after preflight passes. The brief carries each requirement ID,
user behavior, owned files, positive command, RED command, and selected review.
It does not call a provider or prove that an agent ran. Use the current
harness's native delegation tool, keep one writer per owned file, and return
the result to the coordinator for fresh verification. A simple task whose
contract says `위임: 불필요` stays local; generating a brief would cost more than
the work.

## Run one unit before you fan out

When the same job repeats over many pieces, finish one piece end to end first,
yourself or with a single worker, and only then fan out the rest. The first run
finds the missing permission, the wrong output shape and the unstated assumption
once. Fanning out first finds each of them N times at the same moment.

## Competing candidates need a rubric first

When several workers attempt the same artefact so the best can be picked, write
the scoring rubric before any of them starts: three to six concrete, gradeable
criteria for what success looks like on this task. Keep the rubric with the
picker and give candidates only the task. A rubric written after the candidates
exist gets fitted to whichever one you already liked. Score each candidate
against the rubric criterion by criterion, then take over the strongest parts of
the losers by hand rather than averaging the candidates.

## Independent means independent

If agents are meant to give independent judgements, do not let one see another's
output. A second opinion that read the first is a rewrite of the first, and
three agreeing agents that all read the same draft are one opinion counted three
times.

Combine their outputs yourself, after all of them are done.

## Verify what comes back

An agent's report is a claim, not a result. It says what it believes it did.
Where the claim is checkable — a file exists, a test passes, a count matches —
check it before building on it.

For a contracted task, run the workflow's `verify` command rather than copying
the agent's success claim into state. Native independent or human reviews enter
through `record-review` with their raw output and reviewed-file hashes. The
receipt binds evidence but does not turn a self-reported reviewer identity into
proof of independence.

Reports that agree with each other are not thereby correct; agreement is
evidence only when the agents were actually independent.

## Account for every worker

Every worker you start ends as done, replaced, or absorbed into another
worker's slice. Do not report the task finished while one is still unaccounted
for. A worker that has gone quiet is judged by its side effects (files written,
commits pushed, output produced), not by its last status message, which says
what it meant to do.

A slice with no result falls under [the missing-check rule](../verify/SKILL.md#a-missing-check-is-not-a-pass). When a report lacks the evidence
its brief asked for, respawn that worker once. A second miss is recorded in the
final report as a gap. Never continue with N-1 results when the review was
required: a missing required review blocks the claim until it has run.

A worker that writes gets its own worktree or branch. Two workers sharing one
checkout overwrite each other's edits and leave nothing to tell whose they were.

## What does not belong in a subagent

- **A judgement you will have to re-make.** If you must understand it deeply to
  use the result, delegating it buys nothing.
- **Work whose scope you cannot state.** An unclear brief produces confident
  output that is unclear in the same way, but now it looks finished.
- **A task shorter than its brief.** Writing the brief costs more than the work.

## Reference material

- Choosing a team architecture — pipeline, fan-out/fan-in, expert pool,
  producer-reviewer, supervisor, hierarchical delegation — and deciding
  between an agent team and sub-agents: read `references/agent-design-patterns.md`.
- Writing the orchestrator skill itself, once the architecture is chosen:
  read `references/orchestrator-template.md`.
- Designing a QA or verification agent for the team, including the boundary
  bugs a lone reviewer misses: read `references/qa-agent-guide.md`.
- Worked examples of each architecture end to end: read `references/team-examples.md`.
- What an executing sub-agent must not receive alongside its carved prompt:
  read `references/orchestration-contract.md`.
- Team size against workload, the four ways agents hand data to each other,
  which branch a follow-up run takes, and what a piece of feedback actually
  changes: read `references/operations.md`.


## Task routing and completion

For authorized delegation, follow [Runtime routing](../../runtime/ROUTING.md):
plan with `jst route plan`, reserve one attempt with `jst route run`, execute, and
record checked artifacts with `jst route record`. It owns model transitions and
the rules every calling skill follows.

## Boundary

Getting an adversarial second opinion on finished work is the `consult` skill;
choosing which tier runs a piece is the `models` skill. Writing the skill and
agent files the team runs on — how to author one and how to test it — is the
`author` skill. This skill covers splitting the work.
