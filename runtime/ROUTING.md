# Task routing across models and hosts

jstack selects a model for authorized delegated work. It does not replace the
coordinator, grant permission to spawn, or infer capability from a model name.
Luna, Terra, Sol, Astra, Haiku, Sonnet, Opus and Fable are possible identifiers,
not a fixed ranking. Discover actual IDs and availability in the active host.

## Plan, reserve, execute, verify

Use `jst route plan --request request.json` and save its JSON decision. The
planner is deterministic and makes no inference call. Use
`jst route run --decision decision.json` exactly once to reserve the attempt.
CLI decisions execute there. A `native-required` result supplies the brief and
settings for the current session's native delegation tool. The coordinator must
enforce the returned timeout and stop the native agent when it expires. Do not
substitute a CLI to evade a session restriction. Native tool receipts, not the
decision file, establish that an agent actually ran.

Inspect the output and owned artifacts, run the authorized verification, and
save its output outside the owned worktree. Use
`jst route record --decision decision.json --result result.json`. The result
binds absolute evidence paths to SHA-256 hashes; it does not certify reviewer
identity or turn an assertion of correctness into proof. `actualModel` is
`unknown` unless the host supplies authoritative metadata. CLI text output is
not treated as that metadata. Keep the execution result and checks together.

Only `verification-failed` can produce a second decision, for a different model.
There are at most two executions per task ID and one shared wall-time budget.
Environment failures, unavailable credentials, interruption and scope conflicts
return incomplete. Explicit model choices allow transitions only to explicitly
listed fallback models. Never reset files to make a transition possible. Inspect
the first attempt's diff, output and check evidence and include those artifacts
in the second brief. Independent reviewers receive artifacts and facts, not the
executor's conclusions. A review task has read-only access.

The ledger lives in `~/.jstack/routing/`. The shared `~/.jstack` parent may be 0755 (the
installer creates it with the default umask) but must be owned by you and not
group- or other-writable; `routing/` and the ledger files must stay 0700/0600.
Nothing repairs existing permissions. `run` and `record` accept `--home` for an
existing isolated home. An interrupted CLI reservation remains blocked until
its process is known to have stopped; do not delete a ledger to evade the limit.
Use a new task ID only for genuinely new work, not to reset an exhausted task.

## Request and result shapes

This example uses a placeholder ID deliberately: replace the candidate with
settings observed in the current session. Candidate `available`, tools, access,
context size, efforts and context modes must be established by the host or a
reviewed adapter, not guessed from the example or a model name.

```json
{
  "schemaVersion": 1,
  "taskId": "count-fixture",
  "kind": "extract",
  "prompt": "Count the listed records and return the integer.",
  "deliverable": "The exact record count",
  "verification": "Compare against the fixture's independently computed count",
  "cwd": "/absolute/worktree",
  "ownedFiles": [],
  "access": "read-only",
  "tools": ["Read"],
  "contextTokens": 1000,
  "contextMode": "fresh",
  "impact": "low",
  "constraints": "simple",
  "delegationAllowed": true,
  "allowedTransports": ["native"],
  "candidates": [{
    "id": "session-default",
    "model": "ACTUAL_SESSION_MODEL_ID",
    "host": "codex",
    "transport": "native",
    "available": true,
    "tools": ["Read"],
    "access": ["read-only"],
    "contextTokens": 32000,
    "efforts": ["low", "medium", "high"],
    "contextModes": ["fresh"]
  }],
  "inheritedCandidate": "session-default",
  "priority": ["session-default"],
  "timeoutSeconds": 300
}
```

Task kinds are `extract`, `implement`, `design`, `review`. Writes require exact
relative `ownedFiles` and a Git worktree root. File hashing detects changes
outside ownership after execution; it is not a per-file OS sandbox. Git-ignored
build outputs are outside this comparison. The host sandbox still limits writes.
Preserve all user changes and inspect ambiguous ownership before proceeding.

```json
{
  "decisionId": "SHA256_FROM_DECISION",
  "status": "passed",
  "actualModel": "unknown",
  "evidence": [{"path": "/absolute/check-output.txt", "sha256": "SHA256_OF_FILE_BYTES"}]
}
```

Statuses are `passed`, `verification-failed`, `environment-failed`, `interrupted`.
The first two require evidence. `passed` requires independently checked completion
criteria, not merely a successful process exit. Reuse an already valid check
instead of rerunning it without a changed input or unresolved concern.

## Selection and optional settings

Explicit `requestedModel` is a hard constraint. `allowedFallbackModels` permits
alternatives only on the second attempt. `effort` is independent of identity;
omit it to inherit. Unsupported effort/fork/tool/access requirements exclude a
candidate. Eligible native candidates precede CLI alternatives. A task with
`delegationAllowed: false` stays local and produces no reservation.

Only measurements with a known candidate `runtimeVersion` and matching verification
criteria are comparable. Within the selected transport, comparable reviewed measurements rank by success
rate, then known cost, then latency. Measurements carry `reviewed: true`, a
`contextKey` produced by `contextKey(request, candidate)`, `samples` (at least 2),
`successes`, and optional `cost` and `latencyMs`. The coordinator must review
their provenance; a JSON flag is not proof of a valid experiment. Incomparable
measurements are ignored. No observations automatically update policy.

Without comparable measurements, retain the eligible inherited candidate or
use the explicit `priority` list. An explicit requested model may be selected
without a priority list. Otherwise report unavailable instead of inventing a
ranking. Keep organization choices and comparison tables in private profiles,
not in this package. `maxCost`, when specified, blocks execution because these
CLI/native adapters cannot enforce a hard monetary limit. Missing cost is unknown,
not zero. Time and attempt budgets are enforced separately.

Complex constraints add a checklist; a failed verification adds failure evidence.
The core brief always preserves deliverable, permissions and verification. These
guidance choices depend on the task, never on whether the name contains Astra.

## Adapter boundaries

`jst route probe` reports installed CLI versions and help-advertised flags without
installing or authenticating anything. This is not inference or permission proof.
Codex CLI uses its named sandbox and literal model arguments. Claude CLI supports
only supplied-context/Read-only work here, with an explicit tool list, `dontAsk`
and empty strict MCP configuration. Writing uses an authorized native path or
Codex's workspace sandbox. No adapter uses a permission-bypass flag.

agy consultation remains unsupported until a reviewed read-only adapter exists.
Its presence is insufficient. The legacy single bridge returns the limitation;
the council reports that participant as unavailable while preserving a successful
Codex response. No successful participant means a nonzero exit.

## Evaluation evidence

The initial evaluation is exploratory: at most 48 model invocations or 60 minutes,
including access failures and retries. Cover extraction, implementation, design,
read-only review, recovery and unnecessary-skill avoidance. Use synthetic inputs
and disposable fixtures. Record requested/observed model, host, effort, context,
input and source hashes, verdict, latency and available usage. Unavailable or
unattempted combinations remain unverified. One successful run never changes
the shipped default. Do not package credentials, raw private conversations or
organization comparison lists with the report.
