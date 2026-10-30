---
name: sdlc
description: "Explicit SDLC only: clarify a change through scoped release. 명시적 SDLC."
---

# SDLC — clarify, implement, inspect, prove, release

<Use_When>
- The user's message opens with an invocation token (`jstack:sdlc`, `/sdlc`, `$sdlc`, `/jstack:sdlc`,
  or `$jstack:sdlc`) followed by whitespace, punctuation, or the end of the message, and names one
  software change. Before a run starts or is selected, ask the user whether to start an SDLC
  run for this change, listing the requirements. Only a yes starts it; pass `confirmed: true`
  with the reported `requirementsSha256`. Anything else is not a yes
- A new run starts only from that message, or a continuation run is selected from a
  message with the same invocation in the current host session
</Use_When>

<Do_Not_Use_When>
- The sdlc name appears only in other text: a question about the workflow, a negated or
  hypothetical mention, a test name, a file name, or a discussion of this skill
- A general build, create, or implement request with no invocation token, even for a large change
- Installing or configuring jstack, or a standalone leaf such as plan, verify or review alone
- An `autopilot` request from another coordinator: it does not select this workflow, and
  this workflow does not intercept it
- Another coordinator is already active in the session and has not been paused or handed off
- Reviewing, explaining or auditing an existing SDLC run without asking to change code
</Do_Not_Use_When>

A general build request, installing jstack, a standalone leaf, or an `autopilot` request
from another coordinator does not select it. The recipe is `autonomous-build`, revision 1;
it promises a checked path, not unattended completion or permission to publish.
Do not intercept another coordinator.

Read [the run protocol](references/run-protocol.md) before starting. It supplies
the CLI input contract, host observations and reentry procedure. The runtime
records state and rejects invalid transitions; native host tools execute work.
If `jst` is unavailable, follow the [CLI path guide](../../runtime/CLI-PATH.md).
It does not intercept arbitrary tools or authenticate a local process.

## Shape: understand the change before implementing it

Invoke the `plan` skill and its `requirements-interview` procedure. Read the
user's documents, actual code, tests and constraints before asking. Treat the
spec as the current estimate of intent. Separate observations, user decisions
and assumptions; record decisions and assumptions in the existing spec, with
stable IDs, evidence, affected requirements and conditions for revisiting them.
Never create a competing question log or a numeric ambiguity score.

Ask about uncertainty that changes the purpose, acceptance, scope, authority or
an expensive-to-reverse decision. Resolve repository facts by inspection. For a
small reversible choice, record the assumption and its revisit condition.
Preserve the interview's question limit and stop request: neither means ready.
An accepted spec needs a conflict/freshness check, not a repeated interview.

Before leaving Shape, require observable acceptance criteria for every active
requirement; settled material decisions; a selected Release endpoint; execution
method; required reviews and human acceptance; and a current immutable code
contract mapping. Bind the user's acceptance to this spec revision. A clear
instruction to implement that exact spec suffices; do not ask again.

When the change is a migration, the spec also carries the plan's breakage
declaration: where the build or tests may be red during Execute, and which checks
each phase must pass. Accepting the spec accepts the declaration. Breakage outside
it is a defect. Whatever is released is green: allowed breakage ends before
Release, and Prove runs the full evidence set. Phase commits during Execute are
local checkpoints under the run's commit approval; a red one is never pushed.

Choose `local-commit` or `pr-and-ship` at entry, using an already explicit choice.
Use ordinary implementation by default. Select TDD only when requested or agreed;
its scenario approval then case approval remain separate human gates. Mark which
requirements need human outcome acceptance; it is not mandatory for every run.

## Execute, Inspect, Prove

Pass the optional context from `jst task run context TASK` to the selected leaf.
Keep the leaf's full procedure and raw result; do not replace specialist behavior
with this summary. Standalone and external leaf calls keep their existing inputs
and return without joining this run.

Implement the bounded change with ordinary tools or the selected execution
skill. Use the `audit` skill (public entry `jstack:review`) for Inspect, and `second-opinion` when the contract
requires an independent challenge. Preserve original verdicts, blocker IDs,
raw output and observations. An unavailable required review stays incomplete.
Use one initial review and focused correction checks under verify's existing
review-cycle rules. Advisory preferences do not reopen a passing review.

Use the `verify` skill and its current workflow receipt for Prove. A stage-end
sentence, green test alone or worker assertion is not proof. Report implemented,
checks-passed, review-approved and accepted separately from request disposition
and run completion. Prove completion alone leaves Release unfinished.

When feedback contradicts a requirement or assumption, record the evidence and
return the affected decisions to Shape. A plain implementation defect returns
to Execute. Amend the existing request for the same purpose, then initialize a
new repo contract and record the link; never edit its immutable contract.yaml.
A different purpose needs a new task/run. Recheck dependent approvals and proofs.
A dirty-tree refactor remains blocked: do not silently commit or stash to enter it.

## Decision trail

For a long or unattended run, leave a trail a reviewer can follow without the
transcript, in records the run already keeps: decisions and assumptions as lines in
the spec's Decisions and Assumptions (`source: agent`, with an evidence pointer),
and what ran in leaf results and observations. Do not add a separate decision log
file; a second log would compete with these records.

Record decision points, not every action: a fork chosen, a pivot or revert and its
trigger, a discarded worker result, a blocker. Each entry says what was chosen, why
in plain words, and carries a pointer that resolves (commit, `path:line`, receipt,
output path), never a paragraph. The trail is append-only: a wrong call gets a later
entry that supersedes it.

Before handing back, compare the trail with what happened in this session. Each
entry maps to a real decision or action, each pointer shows what the entry claims,
and a fork or abandoned approach that shaped the work but has no entry gets one.
Fix the trail, not the story. Tell the user which entries rest on weak evidence.

## Leaf skills called by a run

Leaf skills point here instead of restating these rules. When a run supplies
context, the leaf preserves its task/run, requirement revision and input hashes
with the raw result and execution observation, and returns the original verdict
and unverified scope to this coordinator. A leaf does not advance a stage or
approve a human gate. A leaf keeps its own clean-tree prerequisite and does not
commit or stash to satisfy it without authorization. A standalone or external
caller needs no SDLC run or new mandatory arguments.

## Release and leaving the workflow

Read [the Release procedure](references/release.md). Prepare the concrete change
before requesting any missing authority. Reuse explicit existing authorization
for the same scope. Commit, push and PR each have a target-bound approval; one
user answer can cover several actions. The runtime never performs these writes.

Pause, cancel or hand off without passing the remaining gates. Preserve requirements,
artifacts and hashes, current contract, dirty state, permissions, workers,
unknown effects and pending gates. Cancellation is not withdrawal or success.
Read back unknown external outcomes before retrying. Do not infer stopped workers
from a cancelled run or kill processes owned by another framework.

On compaction, restart or external handoff return, read durable run state and the
bound artifacts; recheck host/profile/hook capabilities and competing coordinator
observations. Use explicit selection and coordinator handoff. Never pick a global
latest run, downgrade the recipe, or disable another framework's hooks.
