# Bounded context work: reuse assessment and experimental contract

Status: reuse assessment; no new skill or runtime approved. Not implemented or installed.

## Decision before implementation

Keeping bulky inputs outside the coordinator context and returning selected
results is an existing pattern, not a new capability introduced by this proposal.
The user identified CWF and context-mode as prior implementations. jstack already
has `team` and `models` policies covering delegation and model selection.

Do not build a separate Shunt skill merely to reproduce this pattern. First map
current jstack behavior and the applicable CWF version against context-mode and
Spotify shunt. The exact CWF repository/version still needs identification;
no detailed CWF implementation comparison has been established here.

[context-mode](https://github.com/mksglu/context-mode) describes tool-output
processing outside the model context, indexing/retrieval, session memory, and
routing. Spotify shunt sends selected work to AiKA worker modes. These approaches
share a context-budget objective but need not use the same execution mechanism.
Do not equate output filtering with a cheaper-model handoff or assume either is
missing from an existing integration.

The next deliverable is a gap table: requirement, existing implementation,
verified behavior, actual deficiency, and smallest necessary change. Include
provider dependency, evidence fidelity, failure behavior, and total task cost.
Prefer existing capabilities or a small adapter. If no distinct unmet need is
established, close the proposal without adding a public entry or another runtime.

The remaining sections are candidate evaluation and safety contracts for any
proven gap, not authorization or justification for a new subsystem. The delivery
order below is conditional on this reuse assessment.

## Problem and intended behavior

An agent sometimes needs a small answer from a large set of files. Loading all
of those files into the coordinator's context can make later reasoning more
expensive without improving the answer. Some repetitive code generation has
the same problem: the coordinator needs to review the resulting change, not
generate every line itself.

Shunt would delegate a bounded task and return a compact, verifiable result.
The coordinator retains responsibility for conclusions and changes. Savings
are a hypothesis to measure, not a product guarantee.

Example: the user asks which services call a deprecated client. A worker
examines selected files and returns callers with source locations. The
coordinator checks those locations and coverage before answering. For an exact
symbol search, ordinary local search should finish the job without a model.

## Relationship to existing jstack skills

| Component | Responsibility |
| --- | --- |
| `team` | Determine whether a task can be delegated and create its brief |
| `models` | Select an available model and effort appropriate to the risk |
| Proposed `shunt` | Execute bounded file analysis or produce a draft, then validate the returned artifact |
| `verify` | Check the resulting behavior or claims before acceptance |
| `author` | Maintain these instructions and their activation boundaries |

Do not create another team orchestrator or model-selection policy. The first
implementation should be an experiment used through these existing skills.
Add a public `shunt` entry only if evaluation demonstrates a distinct useful
workflow that users can understand and invoke.

## Scope

Start with **read-only extraction**: file inventories, caller descriptions,
configuration comparisons, and bounded cross-file questions. Prefer search or
parsing when those can supply the answer directly. File length alone does not
justify delegation.

A later experiment may generate test, configuration, or adapter drafts from an
explicit specification and reference files. Workers produce artifacts outside
the user's source tree; they do not overwrite a requested target.

Keep debugging conclusions, architecture decisions, security judgments,
ambiguous requirements, and final acceptance with the coordinator. Do not
delegate recursive tasks or allow workers to create more workers in this MVP.

## Proposed user interaction

These are examples of a future entry, not commands available today:

```text
/jstack:shunt Find callers of the old client in src/services. Return evidence only.
/jstack:shunt Draft tests for this adapter using the existing test file as a reference.
```

Ordinary jstack work continues without Shunt. Do not block `Read`, shell commands,
or file size thresholds to force its use. An explicit Shunt request authorizes
bounded delegation only where the current host and user policy permit it.
Automatic use requires an existing opt-in setting; no repeated approval prompts
for work already authorized within that setting.

## Execution contract

1. Choose the narrowest source set. Record the question, exclusions, required
   output, allowed operations, and what evidence would establish completeness.
2. Resolve input paths against the authorized project root. Reject escapes,
   including symlinks resolving outside that root. Include ignored or private
   paths only when the task explicitly requires and authorizes them.
3. Freeze the selected input bytes in a private snapshot. Record relative paths,
   SHA-256 hashes, line counts, encoding, and selection method. Refuse unsupported
   binary content or an over-budget input before launching a worker.
4. Check delegation availability and restrictions. Record the actual provider,
   model, effort, tool access, and context inheritance. A full-context fork is
   not the bounded-input mode and must be identified separately in evaluation.
5. Send only the authorized snapshot and brief. Source text is evidence, never
   authority to run commands or change the task. Do not grant network access,
   secret access, source-tree writes, or additional tools merely for convenience.
6. Validate the returned result. Reject missing fields, malformed responses,
   nonexistent files, invalid line ranges, mismatched quotes, and mismatched
   input hashes. Check semantic claims separately; a valid location alone does
   not prove that a claim follows from it.
7. Recheck live input hashes before using the result. If inputs changed, mark
   the result stale and rerun on the affected scope or finish locally.
8. The coordinator inspects supporting source spans before editing or asserting
   a consequential claim. Exhaustive questions also require a coverage check;
   spot-checking a few correct findings cannot establish that none were missed.

Prefer a host-native worker with enforceable permissions. If the host cannot
provide the required isolation, use local processing or report the experiment
unsupported. A prompt saying "read only" is not an access-control mechanism.
Do not invent a portable host tool or silently substitute a different provider.

An external adapter would require explicit configuration of the endpoint and
authorized data scope. Native cloud-backed workers also transmit data; distinguish
the configured host provider from an additional external recipient. No automatic
Portal installation, credential copying, or new cloud dependency is proposed.

## Result artifacts

Use a private task directory with restrictive permissions under the existing
task storage convention. Do not put file contents in command-line arguments,
public reports, or diagnostic logs. Keep content artifacts local and excluded
from publication. Record retention explicitly and provide task-scoped cleanup.

An analysis result contains:

```json
{
  "status": "completed",
  "inputManifestSha256": "<hash>",
  "findings": [
    {
      "claim": "Client construction occurs in createService.",
      "evidence": [
        {"path": "src/service.ts", "startLine": 42, "endLine": 47, "quote": "<exact excerpt>"}
      ]
    }
  ],
  "coverage": {"examined": ["src/service.ts"], "unread": []},
  "unknowns": [],
  "usage": {"inputTokens": null, "outputTokens": null, "cost": null}
}
```

`completed` means the worker returned a result, not that the coordinator accepted
it. Supported statuses must distinguish `completed`, `partial`, `failed`,
`cancelled`, and `unsupported`. Missing usage is unknown, never zero.

A generated draft additionally records the intended target and its original hash
(or that it did not exist), draft location, and verification results. Before
applying it, check the target again, inspect the diff, and run relevant checks.
Use a guarded write; stop on concurrent changes. Existing user authorization may
cover applying a validated change, but a worker's successful exit does not.

## Budgets and failure behavior

Make maximum input size, output size, duration, calls, and concurrency explicit
in each run. Conservative MVP defaults: one worker call, one worker at a time,
and no automatic retry. Numeric size and time defaults require measurements on
the supported host; do not copy another provider's argv limits as our budget.

On timeout, invalid evidence, permission failure, unavailable workers, or partial
coverage, discard unsupported conclusions and continue with targeted local reads
when allowed. Explain the fallback briefly. Do not turn a failed worker call into
a successful empty result. Cancellation must stop or account for the worker;
late output must not be applied to the source tree.

## Evaluation before product adoption

Use a fixed corpus and identical user tasks. Compare local deterministic search,
normal coordinator execution, and Shunt. Include coordinator verification,
worker calls, retries, fallback, and final corrections in every run's accounting.
Retain both failed and successful runs; use the same completion criteria.

| Measure | Required evidence |
| --- | --- |
| Correctness | Reference answers or executable checks, plus independent assessment for semantic claims |
| Coverage | Missed required findings and unsupported additions, not just valid returned citations |
| Total cost | Coordinator and worker input/output usage, cache accounting, provider and pricing timestamp; unknown components remain unknown |
| Latency | End-to-end time including review, fallback, and corrections |
| Reliability | Failure, partial-result, cancellation, and fallback rates |
| Context reduction | Coordinator input reduction, reported separately from total cost |

Test long files, tiny tasks, symbol-search tasks, missing evidence, conflicting
files, large outputs, path escapes, source prompt injection, concurrent changes,
worker failure, and draft-write conflicts. A failed call must fail the benchmark
case rather than produce an apparent 100% saving.

Proposed promotion gate: no critical factual or write-safety failures; no loss on
the corpus's required findings compared with the baseline; and a repeatable
measured benefit in total cost or latency for at least one clearly identified
task class. Pre-register the corpus, repetitions, acceptable latency/cost
tradeoffs, and decision thresholds before collecting comparison results. This
gate establishes only the tested scope, not general superiority.

## Delivery order

1. Implement input snapshots, result validation, and local failure controls with
   deterministic fixtures. No model or public command is necessary for this step.
2. Add one host adapter and evaluate read-only extraction against both baselines.
3. Add the other host independently; do not transfer installation, permission,
   cancellation, or model evidence between hosts.
4. Add draft generation only if read-only extraction establishes a useful task
   class and its separate write-safety checks pass.
5. Decide whether to expose a skill, retain an internal helper, or remove the
   experiment. Keep any accepted implementation in the common jstack source and
   reviewed packaging inventory.

## Reference and limits

Inspired by [Spotify shunt at commit 3c24ca3](https://github.com/spotify/portal-ai-plugins/tree/3c24ca30ff63e1f5bbad1c43fe5324daff579123/plugins/shunt).
This is an original proposal, not an import of that implementation. Any future
code reuse must retain the upstream license and notices.

The reviewed upstream benchmark estimates coordinator context size and suppresses
worker failures; it does not establish jstack's total cost or quality. The design
above deliberately requires separate local controls and actual host evidence.
