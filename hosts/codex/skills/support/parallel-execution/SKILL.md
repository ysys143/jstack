---
name: parallel-execution
description: Split parallel work when pieces can be checked separately; verify what comes back. Triggers — "병렬로", "동시에 여러", "서브에이전트", "에이전트 여러개", "팀으로", "나눠서 진행", "parallel", "fan out", "작업 분배".
---

# Team — Codex native delegation

## Split only independent work

Parallel work pays when the pieces are **independent to check**. Keep a change
and the tests that prove its intent with one owner. Never assign two writers to
the same file or generated artifact. Several read-only reviews of the same
artifact may run independently because their outputs are findings rather than
overlapping edits.

Keep sequential work whole when a later step needs the previous result. Gather
in parallel when useful, then synthesize once after all reports arrive.

When the same job repeats over many pieces, finish one piece end to end before
fanning out the rest, so a missing permission or wrong output shape surfaces
once. When workers compete on the same artifact, write the scoring rubric
(three to six gradeable criteria) before any of them starts and keep it with the
picker, not the candidates.

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

## Write a brief that survives without this conversation

Every delegated brief states:

1. the deliverable in one sentence;
2. the exact output shape;
3. what has already been established;
4. files and decisions outside the agent's ownership; and
5. how the result will be checked.

Use the field contract and failure examples in `references/briefs.md`. Give the
agent only the context needed for its assigned decision. The executing agent
must not receive another executor's reasoning or a reference answer that would
destroy independence; `references/orchestration-contract.md` defines that
information boundary.

For a version 2 task, derive this brief from its immutable contract after the
local readiness probe succeeds:

```bash
node "${JSTACK_PLUGIN_ROOT}/skills/verify/scripts/workflow.js" preflight <task-id>
node "${JSTACK_PLUGIN_ROOT}/skills/verify/scripts/workflow.js" brief <task-id>
```

The generated brief is local evidence, not an agent call. It carries requirement
IDs, user behavior, exclusive files, positive checks, temporary-copy RED checks,
and selected reviews. Use Codex native delegation only after it is ready. If the
contract says `위임: 불필요`, keep the small task local and skip the brief.

## Routing execution

Use [Runtime routing](../../runtime/ROUTING.md) for automatic model selection.
Reserve the decision with `jst route run --decision FILE` before invoking the
current native tool. If `jst` is not found, follow
[jst command on PATH](../../runtime/CLI-PATH.md). Pass only supported model,
effort and context-fork settings.
Record live verification through `jst route record`; a native receipt never
proves an agent ran by itself. If the session prohibits an override or spawn,
report that constraint instead of opening an external CLI to evade it.

## Use Codex native delegation

Use the agent tools exposed by the current Codex session. Select a model or
reasoning level only when the task contract, user, or applicable routing skill requires one; otherwise use
the inherited setting. Give each agent one exclusive file set, and do not start
dependent work before its prerequisite report arrives.

For authorized delegation, `references/briefs.md` covers fresh/forked context,
leaf restrictions, live concurrency, and peer/reviewer information boundaries.
Use `models` for effort selection within supported session and fork parameters.
Keep the coordinator available to the user.

This Codex surface does not use Claude's task-call syntax, agent-role parameter,
or agent-team templates. The following Claude-specific references remain in the
source package for Claude and are intentionally excluded here:

- `agent-design-patterns.md`
- `orchestrator-template.md`
- `team-examples.md`

Their Claude call syntax and worked examples are not counted as Codex parity.
For workload sizing, ownership handoff, follow-up routing, and recovery, use
`references/operations.md`. For QA boundaries, use
`references/qa-agent-guide.md`.

## Verify reports against live state

An agent report is a claim. Before building on it, inspect the owned files,
diff, command output, and exit status. Agreement is evidence only when reviewers
were independent. If the report conflicts with the artifact, the artifact and
fresh verification win.

Every worker you start ends as done, replaced, or absorbed into another
worker's slice. Judge a quiet worker by its side effects (files, commits,
output), not its status text. A slice with no result falls under [the missing-check rule](../verify/SKILL.md#a-missing-check-is-not-a-pass): when
a report lacks the evidence its brief asked for, respawn that worker once, and
record a second miss as a gap. Never continue with N-1 results when the review
was required. A worker that writes gets its own worktree or branch.

For contracted work, run `workflow.js verify <task-id>`. A native reviewer
result may be attached with `record-review`, which binds its raw output and
reviewed-file hashes. The receipt does not prove independence from a reviewer
name or JSON flag; the coordinator must keep native reviewer execution separate
from the executor.

For an interrupted task, the next executor first resolves the repository root
and exact ref, then reads status, diff, task artifacts, and the latest relevant
test output. It must not reconstruct current state from conversation memory.
Every recovered claim points to a file, commit, artifact, or fresh command
result; missing evidence is reported as unknown.

## Boundary

An adversarial second opinion belongs to `consult`; model-tier policy belongs to
`models`; durable state recovery belongs to `recall`. This skill owns task
splitting, briefs, exclusive ownership, handoff, and verification of delegated
results.
