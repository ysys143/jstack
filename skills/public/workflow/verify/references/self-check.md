# Run Only Reviews Required by the Work

For each contract-v2 `verification` entry, define `additionalReview` from risks created by the task. Do not demand every review for a simple wording edit. When a review was considered but omitted, record `applicability: skipped` with a specific `skipReason`. Commands or edits performed only to fill a checklist do not improve the result.

| Review | When required | What the reviewer checks |
|---|---|---|
| factual | External facts, figures, or quotations determine the result. | Canonical source and date, and direct support for each claim. Search summaries or model agreement are insufficient. |
| evaluation independence | A model evaluation, benchmark, or validator pass supports the claim. | Answer leakage, state shared across arms, self-scoring, an oracle copied from the implementation, and stale evidence after candidate changes. Test rejection with a real wrong answer and false PASS. |
| SSOT | The same fact, rule, or number is maintained in multiple places. | Separate authority from derivatives and verify callers consume the authority. A shared name or prose claim of authority is insufficient. |
| portability | The result claims support across harnesses, paths, or installations. | Run an installed copy from another path and inspect tools, permissions, and dependencies. Reading the source checkout does not prove the installation. |
| cold-read | Another person will use an important explanation, plan, or deliverable. | Read inputs, outputs, and acceptance criteria without the original conversation or author explanation. Report ambiguity, omissions, and unsupported inference that could change behavior. |

Run required reviews with an available review tool or an independent agent. If delegation is unauthorized or the tool is unavailable, record that fact and leave the review incomplete. Never replace a required human review with a model review.

Give the reviewer the requirements, authoritative source, and current deliverable. Do not reveal the author's judgment or other reviewers' conclusions before an independence review. Preserve a result file containing verdict, evidence locations, and unverified scope. Resolve rebuttable findings with current file or command evidence, and rerun only reviews invalidated by later edits.

## Review termination

Use one initial review and a focused follow-up for its authorized fixes. Declare
the requirement, scope, and review purpose before starting. Keep finding IDs
stable and distinguish concrete blockers from advisory improvements. Fix a blocker
only when its requirement violation or observable failure is supported by evidence;
resolve a refuted finding with evidence instead of changing working code to appease it.

The follow-up checks the reported defects and risks introduced by the correction.
Reuse unaffected review evidence, subject to the workflow's existing file-hash and
contract checks. Do not invent an exemption for a stale required receipt. A passing
follow-up with required checks satisfied closes this review. Optional style or
architecture suggestions do not reopen it or expand the authorized work.

After two broad rounds, continue only focused verification. Another broad review
needs a concrete unresolved defect spanning that scope, new regression evidence,
changed user requirements, or an explicit user request; name the evidence and the
scope it invalidates before running it. Renaming a purpose, adding an advisory
finding, or making an unrelated edit is not new evidence. If the same blocker
survives two corrections, revisit the cause and remedy before another patch.
Continue necessary diagnosis and verification of real defects; a review limit
never waives required checks or turns unresolved work into success. Report what
remains unresolved and why a review was reused, narrowed, or ended.

Version 2 `record-review` records an input/purpose counter and a broad-round
counter that survives edits. Use `--review-mode focused` for a follow-up and
optionally `--blocking-findings FILE` containing a JSON array of stable blocker
IDs. Provide `--review-id ID` from the actual review invocation or delivery when
available. Without it, identical receipt imports are idempotent and cannot prove
that a new reviewer ran. The counter's advice never alters the existing review
coverage, staleness, or completion gates.

For ordinary reviews, use the current captured request's explicit task ID:

```bash
jst review check TASK --input review-input.json
jst review record TASK --input review-result.json
```

The check input contains `purpose`, `files` (workspace-relative regular files),
and `mode` (`broad` or `focused`). Include every source, test, specification,
configuration, and local environment input relevant to the review. For example:

```json
{"purpose":"Review session expiry against AUTH-1","files":["src/session.ts","tests/session.test.ts","package-lock.json"],"mode":"broad"}
```

Before invoking the reviewer, retain the check's `context`, `scopeHash`, and
`inputHash`. The record uses the same input plus `expectedContext`,
`expectedScopeHash`, `expectedInputHash`, a unique execution/delivery `id`,
`rawOutput` (the saved nonempty review result path), `verdict` (`pass`, `fail`,
or `unknown`), and optional `blockingFindings` (stable IDs). Recording rejects
changed inputs or requirements. Re-importing the same delivery does not increase
the count. A changed result under the same ID is an error.

`reuse` means inspect the previous passing review and its input/environment
binding; `focus` means verify the findings and affected paths; `reassess` means
revisit a repeatedly unresolved blocker. These are recommendations, not hook
denials or proof of completion. Required fresh checks and user-requested reviews
still run. Only explicitly recorded reviews are observed; the CLI does not watch
native agents automatically or authenticate the supplied finding IDs. Private
history lives under the request workspace in `~/.jstack`, separate from completion
receipts. All declared files, including executable Markdown skills, are hashed.

The coordinator records trusted review results from the task repository:

```bash
node scripts/workflow.js record-review TASK REQUIREMENT cold-read \
  --raw-output reviews/cold-read.md --reviewed-file src/changed.py --verdict pass
node scripts/workflow.js verify TASK
node scripts/workflow.js status TASK
```

Repeat `--reviewed-file` for every relevant file. When omitted, the command records all files associated with the requirement. An unrelated file cannot stand in for the required scope.

`record-review` binds the contract, reviewed files, and raw result hashes. It detects omission, failure, and later file changes, but it is not a signature that authenticates an author or proves reviewer independence. Inspect the actual call boundary and raw output for independence. Preserve useful task output when a review is missing or stale and report exactly what remains unverified.

Run these commands with Node 20 or newer.
