# Explicit SDLC contract — autonomous-build revision 1

Status: candidate. Local state/fixture evidence, native discovery and model behavior
are separate claims. No general build request selects this workflow. The public
entry is `jstack:sdlc`; there is no competing command or `autopilot` alias.

## Authority and intent

The existing home Task owns request continuity, run events, approvals and effects.
The spec owns Decisions and Assumptions. Repo `.jstack/tasks/<id>/contract.yaml` and
verify receipts own executable acceptance evidence. Binding these authorities
does not copy the code contract into another mutable authority.

Requirements are an estimate refined by observations, not literal command text.
Read actual code and constraints before questions. Reopen affected decisions on
new evidence; do not rewrite clear requirements to accommodate a failing implementation.
Material ambiguity blocks dependent execution. A reversible, nonmaterial assumption
needs a revisit condition. Interview limits and stop requests return readiness,
not approval. Human final acceptance is required only for designated requirements.
The design rationale is [Requirements as latent state](https://jaesolshin.com/posts/requirements-as-latent-state/ko/).

## State and compatibility

Starting explicitly upgrades only the selected home task to schemaVersion 2.
All v1 fields/history survive; run events append to the existing history under
the same lock and atomic-write protocol. New readers/writers support both versions.
Frozen pre-SDLC writers reject v2, including their session scan when a v2 record
is encountered. They can still address unrelated v1 tasks explicitly. Do not
pretend unknown-field preservation provides semantic compatibility or downgrade
v2 on rollback. Keep the new reader for inspection and handoff.

One task owns one run, one coordinator epoch and at most one accountable owner
per active requirement. Multiple executor/assessor attempts may share that owner.
The worktree root is separate from the shared Git common-directory workspace key.
Commands reject another worktree or stale coordinator. No global latest fallback.

Request disposition remains satisfied/open/withdrawn under the existing evidence
rules. Run completion is a separate live projection: all selected Release gates,
current Prove, review, required acceptance and effects must pass. Cancellation
preserves unresolved requirements, attempts and effects. It never implies withdrawal.

## CLI

Use `jst task run start|select|event|status|resume|context`. The module fallback is
`node ${JSTACK_PLUGIN_ROOT}/runtime/sdlc_cli.js ACTION ...`.

Mutations read JSON from stdin or `--input FILE`; `--workspace DIR`, `--home DIR`
and `--session SESSION` use the existing task conventions. Status/resume/context
require an explicit task ID. Status and resume never execute work; context returns
the current basis and target hashes for a leaf. Mutations return task revision and
run identity/stage/state. Errors exit 2; unavailable resume exits 1; successful
reads/writes exit 0. A successful record is not a passed gate.

Every mutation requires `id`, `expectedRevision`, `eventId`, `reason`, and `run`.
An event additionally requires `type`, `coordinator` (ID) and `epoch`. Event IDs
are idempotent only with identical inputs; changed payloads are errors. Reconcile
revision conflicts from fresh state. Repeated ship delivery never reruns its checker.

Start also requires:

```json
{
  "id": "feature", "run": "feature-run", "expectedRevision": 1,
  "eventId": "select-1", "reason": "Explicit user selection",
  "endpoint": "local-commit", "method": "ordinary",
  "coordinator": {"id": "coordinator-1", "host": "codex", "session": "actual-session"},
  "source": {"message": "actual-message", "observation": "/private/observed-user.json"},
  "environment": "/private/observed-environment.json",
  "repoCheck": "npm test"
}
```

The source is a normalized actual host event with `role: "user"`, `host`, `session`,
`message` and original `content`. Explicit start, select and approval require an
observation whose `host` and `session` equal the current coordinator's. Start and select
require an invocation token at the start of the message: `jstack:sdlc`, `/sdlc`, `$sdlc`, `/jstack:sdlc` or `$jstack:sdlc`,
followed by whitespace, punctuation or the end of the message. A token elsewhere in the message
("Use jstack:sdlc ...", "Do not use jstack:sdlc") does not select, and the text after the token is never
judged for intent.
Starting and selecting also require the user's confirmation of the exact requirements. The agent
shows the requirements, asks the user, and passes `confirmed: true` with the `requirementsSha256`
the runtime reported; a missing or stale digest is refused and no run starts. The runtime checks
that binding only. It cannot verify that the user actually answered, so the confirmation remains
the agent's obligation. This is a trust-the-agent premise, not a verified human decision.
When a request looks like a large, multi-file or release-bound change and no token is present,
the assistant may offer once per task to continue with `jstack:sdlc`. An offer never starts a run.
Keep the native event available; copied document quotations and coordinator statements
are not human observations. Normalization and semantic interpretation are trusted
coordinator work; file hashes do not authenticate users or protect against a local
process with the same permissions. Human gates cannot be passed by capture.authorized.

Environment observations contain `host`, `session`, `version`, `profile`, `hooks`,
`capabilities` as nonempty strings and `competingCoordinator: false`. Unknown
coexistence is not false. Re-observe these facts on resume; do not disable others' hooks.
Endpoint is local-commit or pr-and-ship; method is ordinary or tdd. Revision 1 uses
Git code tasks and same-repository GitHub PRs. Scope/endpoint changes use a linked new run.

## Events

| type | Additional input and behavior |
| --- | --- |
| shape | `spec` path; `readiness.decisions` and `readiness.criteria`. Hashes the canonical spec and binds current request semantics; returns to Shape. |
| bind | `binding: {task, contractSha256, mapping:[{request, revision, requirement}]}`. Every active code request and repo requirement must be covered. Only in Shape; retains prior bindings. |
| approve | `gate`, `verdict: pass|fail`, `source`. Human observation only; binds current basis. Gates: shape, scenarios, cases, accepted:REQUEST, commit, push, pr, ship. TDD gates require `artifact` and cases requires current scenario approval first. |
| result | `output` and `observation` files from an actual leaf invocation. Preserves original result and current targets; does not create a workflow review receipt. |
| owner | `requirement`, `owner`. Refuses a missing requirement or one with a running attempt. |
| transition | `stage`: only the next of shape→execute→inspect→prove→release. Recomputes predecessor gates. |
| reconsider | `stage` shape/execute/inspect/prove and actual `observation`; only moves backwards. No fabricated success or blanket proof reset. |
| pause/cancel/handoff | Writes an immutable private envelope containing requests, run/bindings, evidence, authorized scope, dirty state, HEAD, workers and effects. Does not kill host-owned workers. |
| reenter | Requires settled workers and reconciled effects plus the selected environment; restores active state, never runs a stage. |
| invoke | `operation` commit/push/pr and exact `target`. Requires Release, current Prove and scoped human authority. Records unknown before the host tool executes. |
| readback | `operation`. Uses actual local Git, remote Git or GitHub read calls to resolve an existing effect. Allowed after cancellation for reconciliation. |
| reuse-commit | `head`. Requires a clean verified Release; records the already present commit without creating an empty commit. |
| ship | `base` and `rollback` Git refs. Requires human ship authority, clean tree, repository checks, current Prove, mergeability and rollback commit, in that order. |
| complete | Only in Release, after all live gates. No remaining workers or unknown effects. |

`select` is a separate mutation with a continuation `source`, coordinator object
and fresh `environment`. A new coordinator requires pause/handoff and receives a
new epoch. Selection remains blocked until explicit reentry. Terminal cancelled
or complete runs require a new task. Ordinary capture/observe/assess on v2 require
`run: {id, coordinator, epoch}` and the current session. SDLC external effects must
use invoke/readback, not the legacy observe external-resolved shortcut.

Each readiness decision has `id`, `status: settled|assumed|open`, `material`,
`reversible`, `source`, and `revisit` for assumptions. Each criterion has
`requirement`, `when`, `actor`, `behavior`, `observable`, `failure`, `human`.
The runtime checks completeness and provenance, not whether an answer is wise.
Shape requires current spec, complete mapping, resolved material decisions and
human agreement. An exact accepted implementation instruction can supply it.

A leaf output is JSON with `kind: implemented|review-approved`, `verdict:
pass|fail|unknown`, `requirements`, and `basis`/`targets` from context. Review also
requires `role: reviewer` and `blockingFindings`; a passing result cannot contain
blockers. Preserve the native full report alongside this envelope. The execution
observation has actual `actor`, `host`, `event`; identity strings are not independent
execution proof. An independently required assessor cannot be the coordinator.
For contract-required reviews also record verify's native review receipt. TDD's
own approval checker and full specialist procedure remain in force. Implementation
attempts and results require Execute with both current TDD approvals. Reapproving
scenarios invalidates the case approval. Changes to readiness also invalidate
approvals, even if the spec file path and bytes are unchanged.

## Release targets and freshness

Commit target: `{parent, tree}` with exact full SHAs. Require staged content to
match the verified worktree and reject staged paths outside the contract targets.
Push target: `{remote, branch, head}` with a configured remote and full current HEAD.
PR target: `{repository: "owner/repo", branch, base, head}`. Human approval for a
release operation includes the same `target`. It updates the current authorized
operation; a later capture can revoke it. Reuse authority only within this scope.

Invoke records the target before the native write; the CLI itself never commits,
pushes or creates PRs. Present effects cannot repeat. Unknown outcomes require
readback; mismatched HEADs or provider failures remain unknown. Absence must be
observed before retry. Readback logs include original target, actual observation
and HEAD. Read remote state again immediately before run completion.

Commit changes HEAD and makes the old receipt stale. Reverify before the next
write or completion. Ship runs checks outside the task lock and uses the original
revision when recording; a concurrent interruption wins. It binds HEAD, base and
input files. Ship never merges. Required CI is part of the immutable verification
contract; the CI diagnosis helper alone is never positive evidence.

Only generated exact repo task directories are appended to Git's local excludes;
existing rules are preserved. Do not ignore all of .jstack, stage another user's work,
stash it or commit to bypass a clean-tree gate. This exclusion does not remove
explicit contract/target hashes from freshness checks. Other unignored repo task
changes can still stale a receipt and must be rechecked.

Local-commit explicitly excludes remote/ship steps by recipe endpoint. These
inapplicable steps are reported with their condition, reason and start-event
revision; they are never called approved or passed. pr-and-ship requires all
three observed effects and current ship proof. All five stages remain mandatory.

## Verification and boundaries

Owning suites exercise readiness, historical v1 readers/writers, identities,
coordinator fencing, amendment, event replay, human gates, cancellation and release
response loss. Fixtures use temporary homes and repositories; no live remote writes.
Package probes verify generated explicit-call metadata and source-independent
execution. Actual host/model cases separately test routing, no generic-build trigger,
no interception of another coordinator, truthful incomplete results and native permission boundaries.
Missing native behavior evidence stays unverified.
