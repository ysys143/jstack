# Request continuity

For task-oriented work, keep the current request connected to its work and evidence.
Apply this protocol once per session, including later corrections. Standalone questions
do not create tasks. A small task needs no separate plan, RED test, or status narration.

1. Capture the purpose, requirements, constraints and authorized actions from the user's
   actual messages. Preserve requirements not mentioned in a correction. Distinguish
   an amendment, a question, a withdrawal and a new objective; ask only when ambiguity
   changes what you may do. A request to design changes current authorization to design,
   without deleting earlier unfinished requirements.
2. Use `jst task capture` with a task ID, the current revision and message references.
   This is coordinator interpretation, not authenticated proof of user authorization.
   Never invent quotes or infer approval from elapsed time. Record no raw credentials.
3. Record real execution events through `observe`. Preparing a brief is not execution.
   An observation file contains the actual host/tool event or local execution record;
   a worker's assertion alone does not prove its host, identity or permissions.
4. Preserve partial output and inspect live state on resume. Unknown external outcomes
   require provider readback before retry. `resume` returns a brief, never starts work.
5. Assess each current requirement against evidence, then read `status` before claiming
   completion. Report only the observed scope. Missing, stale or unknown evidence stays
   unresolved; withdrawal and budget exhaustion are not success.

Keep the task ID in the session handoff. Use an actual host session ID when available;
otherwise always provide the task ID. Never attach to a global latest task. Hosts without
automatic message events use these explicit coordinator calls. Installation does not prove
that every message was captured or that hooks ran.

Show only purpose, actual progress, unmet requirements and next action when useful.
Keep detailed history out of ordinary prompts. Preserve exact-output deliverables: status
and verification records go through the task interface, not inside the requested artifact.

## Interface

`jst task capture|observe|assess` reads JSON from stdin or `--input FILE`.
`jst task status|resume TASK` reads state; `--json` returns structured details.
`jst task --help` and `jst task ACTION ... --help` (or `-h`) print the usage, with the
input fields of each action, on stdout and exit 0 without reading or creating task state.
If `jst` is not found, follow [jst command on PATH](CLI-PATH.md).
All commands accept `--workspace DIR` and `--session ID`; an isolated `--home DIR` is
available for tests. Mutations return the new revision. A revision conflict requires a
fresh read and reconciliation, never blindly resubmit the same mutation.

Start a research/document task (use actual message references and wording):

```json
{"id":"comparison","expectedRevision":0,"source":{"role":"user","message":"turn-12","quote":"Compare the frameworks"},"purpose":"Compare the frameworks","authorized":["analyze"],"requirements":[{"id":"LIFECYCLE","text":"Explain lifecycle strengths and limits","kind":"research"}]}
```

Capture patches requirements by ID. Omitted requirements remain active. `withdraw` is
an explicit list of IDs backed by the supplied user message. `constraints` adds constraints; `removeConstraints` explicitly removes user-withdrawn
constraints. `authorized` replaces the current allowed-action list. Requirement
text, kind or review-policy changes create a new semantic revision. Constraint changes
invalidate all prior assessments conservatively. A different purpose uses a new task ID.
Kinds are `code`, `research`, `document`; set `independent:true` only when required.
Optional `budget` contains a user-authorized `maxAttempts` and/or wall-clock `seconds`.
The recorder refuses new attempts after exhaustion; it does not kill host-owned work.

An observed attempt starts with:

```json
{"id":"comparison","expectedRevision":1,"event":"start","attempt":"a1","operation":"analyze","requirements":["LIFECYCLE"],"handle":"actual-host-handle","observation":"host-event.json"}
```

`observation` and artifact paths resolve against the task's original working directory.
The recorder hashes existing files; it never generates host events. `pid` is optional and
its liveness is advisory. Running observations older than two minutes show as unknown
until refreshed through `heartbeat`; do not poll only to maintain a green indicator.

Other observation events share `id`, `expectedRevision` and `attempt`:

| Event | Additional fields | Meaning |
|---|---|---|
| `partial` | `artifacts` | Preserve private snapshots of files, including late output; no completion |
| `heartbeat` | `observation` | Record a new actual execution observation |
| `stop`, `end` | `observation`, `reason`, optional `artifacts` | Stop or finish the attempt, independently of verification |
| `external-invoked` | `key`, `observation` | Stable action identity; outcome initially unknown |
| `external-resolved` | `key`, `outcome: present|absent`, `observation` | Provider readback; never infer absence from timeout |

The external key names one semantic action. Never change it to bypass an unknown or
already-present action. Existing provider adapters retain authority over actual writes.

Assessment input has `id`, `expectedRevision` and a nonempty `evidence` list:

```json
{"id":"comparison","expectedRevision":3,"evidence":[{"requirement":"LIFECYCLE","requirementRevision":1,"method":"review","result":"pass","rationale":"Compared transitions with the cited source and identified missing runtime enforcement","artifacts":["comparison.md"],"sources":["https://example.org/pinned-source"],"observer":"coordinator","independence":"self"}]}
```

`result` is `pass|fail|unknown`. If the requirement has execution attempts, include
`attempt` naming a finished attempt bound to its current revision. Old-attempt results
cannot satisfy a changed request. Research requires source references. Document work may
use an empty sources list. Review evidence is a recorded judgment, not machine proof;
URLs are not fetched automatically. Independence is `self|reported-independent|unknown`.
A required independent review also needs an `observation` file from the host delivery.
The runtime cannot authenticate a fabricated local file or prove cognitive independence.

Code evidence uses `method: workflow` and adds
`workflow:{cwd:"/actual/repository",task:"existing-task-id",requirement:"EXISTING-REQ-ID"}`.
A passing claim requires a currently passing v2 workflow covering that requirement.
A current failed receipt may record failure, but cannot support a passing claim.
The recorder references the original receipt and rechecks freshness on status; no copied
verification ledger is created. The coordinator must justify the semantic mapping in
`rationale`; matching names or hashes alone do not prove that the user asked for it.

## Storage and compatibility

Private state lives under `~/.jstack/workspaces/<workspace-id>/<task-id>.json` with one
revision history and current projection. Git worktrees share workspace identity through
their common Git directory, while artifact/workflow paths retain their concrete root.
Non-Git work uses its real working-directory path. Moving a workspace does not silently
rebind old evidence. No consumer Git files or native session history are changed.

Existing `.jstack/tasks/` v2 contracts and receipts remain authoritative for code checks.
Old `delegated` workflow states do not establish actual execution. Existing records without
request, approval or delivery provenance remain unconfirmed until observed; no backfill
fabricates those facts. Automatic scheduling, model routing, provider transactions and
mandatory multi-review loops are outside this interface.

Explicit `jstack:sdlc` selection may upgrade one code request to home task schema v2;
ordinary requests remain v1. See [the SDLC contract](../contracts/sdlc.md) for run
identity, coordinator epochs, gates and release readback. Older writers refuse v2.
A v2 mutation requires its current run context; status does not implicitly resume
or complete a run. The opt-in binding adds only its exact generated repo task
path to local Git excludes. It never ignores source changes or alters the index.
