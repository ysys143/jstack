# Run protocol

Use the installed `jst task run` interface; if PATH is unavailable, use
`node ${JSTACK_PLUGIN_ROOT}/runtime/sdlc_cli.js` only through the CLI entry documented
in [the shared contract](../../../contracts/sdlc.md). `jst task run --help`
shows the stable entry. All JSON examples in the shared contract use actual
message/observation paths supplied by the host, never invented user quotes.

1. Capture a code request with `jst task capture`. Use the Git worktree root as
   workspace and keep the explicit task ID. Capturing a request grants no run gate.
2. Start with `jst task run start --input FILE --session SESSION --workspace ROOT`.
   The run upgrades only this request to schema v2. Older jstack versions refuse
   it; use the new runtime to inspect it. Ordinary v1 requests remain supported.
3. Record Shape's spec and readiness, then initialize the v2 code contract using
   plan/verify. Bind every active request requirement to its repo requirement(s).
   The binding records the immutable contract SHA-256 and exact task identity.
   Runtime ignores only this task's generated directory in local Git excludes.
4. Record the observed human Shape approval and advance with a `transition`
   event. Events require the current revision, run, coordinator and epoch. On
   conflicts, read and reconcile; do not blindly retry with a newer revision.
5. Before each leaf, obtain `context`: basis, target hashes, contract and stage.
   Bind its result to that context. Preserve original output and real execution
   observation. For required workflow reviews also use verify's `record-review`;
   a run result does not substitute for that receipt.
6. Record the ordinary task assessment with the current workflow receipt, mapped
   requirement and current run identity. Refresh it after commit or reverification;
   run projections never silently write a satisfied request disposition.
7. After the appropriate gates, transition in order. The stage transition itself
   does not produce evidence. Status reports current problems and projections.

Human observations are normalized records of an actual host user message or
question-tool response: host, session, message ID, user role and original content.
Keep the native record available and cite its origin; a document's quoted text,
a model's answer, capture.authorized or elapsed time cannot substitute for it.
The coordinator records this provenance; the local CLI does not authenticate it.

The spec alone owns Decisions and Assumptions. Runtime readiness indexes and
hashes that artifact; it does not maintain a second authoritative interpretation.
Open items remain open. For material uncertainty, stop dependent work and ask;
independent authorized work can continue. Do not restart interviews to evade
the leaf's question limit. Await the user's continuation when the limit is reached.

`status` and `resume` are read-only, including when a run has code evidence but
still needs Release. Supply the explicit task ID. To transfer coordinator ownership,
first pause or hand off. `select` checks an invocation token (`jstack:sdlc`, `/sdlc`, `$sdlc`, `/jstack:sdlc`, `$jstack:sdlc`) at the start of the actual continuation message, that the message is from the incoming coordinator's host and session, and a fresh host environment observation; it increments the coordinator epoch when the owner changes, and restores context only. The agent's premise that the user confirmed the run (`confirmed: true` with the reported `requirementsSha256`) is checked only for the digest. `reenter` requires settled workers
and reconciled effects; it never executes the next stage by itself.

Amending requirements invalidates the old contract mapping. Return to Shape,
initialize a new immutable repo task, bind it and obtain acceptance for changed
meaning. Retain prior binding and evidence history. Old approvals do not authorize
new scope. To change the Release endpoint or recipe, create a new task/run linked
by the handoff; revision 1 does not silently mutate these choices.
