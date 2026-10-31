---
name: verify
description: "Verify work with fresh evidence; diagnose slow or repeat-failing checks. Triggers: 검증, PR 전 점검."
---

# Verify — is it actually done

For task requests and corrections, follow the shared [request continuity protocol](../../runtime/TASKS.md) once per session.

For a CI failure or stale run investigation, read the [CI diagnosis procedure](references/ci-diagnosis.md); it does not verify current code.

For review comments on a pull request, or for deciding whether a red CI run is a
flake, read [PR feedback](references/pr-feedback.md).

Apply the [security verification contract](references/security-verification.md) and
[pinned upstream reference](references/defending-code-upstream.md) only when the
contract includes a `보안검증` link. Preserve the existing state and execution
paths for ordinary v1/v2 tasks.

## The one rule

**No completion claim without fresh evidence.**

"It should work", "it looks right", "the change is small" are not evidence.
Evidence is observed command output bound to the inputs and environment tested.
Freshness means that this binding still holds, not that every command must run
again. Reuse a passing result only when its recorded source, tests, configuration,
dependencies, toolchain, and relevant environment still match. Include dirty and
untracked inputs; a commit SHA alone is insufficient. Recheck uncertain inputs
and external state. Required CI and task-contract checks still apply; this rule
does not add caching to the workflow runner or bypass its receipt validation.

## Follow a task contract when one exists

If `.jstack/tasks/<task-id>/task.json` exists, use the task workflow before the
generic repository scan:

```bash
node "${JSTACK_PLUGIN_ROOT}/skills/verify/scripts/workflow.js" status <task-id>
node "${JSTACK_PLUGIN_ROOT}/skills/verify/scripts/workflow.js" verify <task-id>
```

`verify` always runs the plan contract linter first. It then runs every
requirement's positive command in the repository and its RED command against
the related files copied under a fresh `{RED_ROOT}`. The RED directory is a
working-directory boundary supplied to a trusted contract command, not an OS
sandbox; the command must mutate only that copy. Missing commands, unexpected
exit codes, changed verification targets, and stale receipts remain failures.
Each command has a 120-second default limit; a timeout terminates its process
group and is recorded as a failed check rather than waiting forever.

Before delegation, run `preflight` and then `brief`. Preflight executes only
tool readiness probes and checks that verification executables resolve; it does
not mistake a pre-implementation TDD failure for a missing tool. The local brief
does not spawn an agent. The native harness owns delegation and interruption.

Choose extra self-checks from `references/self-check.md` when writing the
contract. A native reviewer returns its raw output; the trusted coordinator
records that output and reviewed-file hashes with `record-review`. That local
receipt binds bytes to the task contract, but a reviewer name or JSON flag does
not prove identity or independence. Required human or independent review that
did not actually run keeps the task incomplete. Completion also binds the
current preflight, brief, and coordinator package runtime identity, so changing
the linter or workflow invalidates an older receipt.

Apply [review termination](references/self-check.md#review-termination) when a
review leads to corrections. `record-review` reports repeated reviews and broad
review cycles; use `--review-mode focused` for correction verification. This
advice does not waive a required review or change completion evidence. For reviews
outside a version 2 workflow, use `jst review check|record` as documented there.

| Claim | Required evidence |
|---|---|
| "Fixed" | A test that fails before and passes now |
| "Implemented" | Build passes, diagnostics clean |
| "Refactored" | The existing tests still pass |
| "Debugged" | Root cause named at `file:line` |

## Phase 1: select the affected checks

Choose the smallest available check that answers the current correctness
question, preferably locally. Expand from that check to its owning package and
consumers, then required integration and CI checks. Use the actual target OS for
OS-dependent behavior; cross-compilation is not runtime evidence.

For a failure, repeated patch-and-rerun loop, or uncertain reproduction, read
[local feedback](references/local-feedback.md). For slow checks or test suites,
repeated setup, cache decisions, or runner contention, read
[validation cost](references/validation-cost.md). Ordinary verification does not
need both references. These procedures use existing tools; they do not authorize
CI dispatch, infrastructure changes, or a new scheduler. When the claim is about
an interactive terminal program, such as a prompt, dialog, TUI, or agent CLI
session, read [interactive CLI checks](references/interactive-cli.md); output
from a non-interactive mode does not cover it.

Start from the changed paths, their callers, and the acceptance claim. Find the
checks that exercise those surfaces; these affected checks are the default
scope. Do not run unrelated suites merely because the repository owns them, and
do not assume a command exists. To choose affected tests with a tool, read
[test selection](references/test-selection.md).

```bash
ls Makefile package.json pyproject.toml Cargo.toml go.mod 2>/dev/null
```

| Found | Usual checks |
|---|---|
| `package.json` | `npm test` · `npm run build` · `npm run lint` |
| `pyproject.toml` | `pytest` · `ruff check` · `mypy` |
| `Cargo.toml` | `cargo test` · `cargo clippy` |
| `go.mod` | `go test ./...` · `go vet ./...` |
| `Makefile` | `make test` — read the targets first |

Expand beyond the affected checks when the change crosses a shared contract.
A shared runner, schema, hook, catalog, generated surface, or package identity
requires every consumer suite named by that contract. A release, publication,
or whole-package portability claim requires the full package and release gates.
Record which scope applied and why; “affected” cannot be used to omit a known
consumer, and “full” cannot be claimed from a local suite.

### A missing check is not a pass

**A check that does not exist is not a passing check.** If the repository has no
test command, say so; do not report silence as success. The same holds for a check
that could not run, an empty run, a check that vanished with its subject, and a
worker or reader that returned no result. Report each one as a gap or as blocked,
with the reason, never as a pass.

## Phase 2: run and read

Run each selected check without valid reusable evidence and **read the output**.
Record reused evidence and its input/environment match explicitly. Once affected
and required checks pass, continue toward completion; repeat or broaden only for
new changes, failures, stale evidence, or unresolved correctness concerns.
A zero exit code with zero
tests collected is not a pass.

Each check ends **VERIFIED**, **NOT VERIFIED**, or **INCONCLUSIVE**. INCONCLUSIVE
means the check could not answer the question: it did not run, it observed a
different surface than the one that failed, or its result looks the same whether
the change works or not. It is not a pass. Put it in the Result column and under
Open in the report. When a check passes too easily, such as green on the first
run or green with and without the change, test the observation method before
trusting the result: confirm the command can fail (`scripts/red_probe.js`) and
that it reads the artifact itself, not a report about the artifact.

**A pipe hides the exit code.** `cmd | head` reports head's status, not cmd's.
Write `cmd > out.txt 2>&1; rc=$?` instead.

## Bulk edit safety

A mechanical or bulk edit needs an explicit boundary before the first write.
Enumerate every match, assert both the exact match count and the intended scope
(paths, sections, syntax nodes, or caller contract), and stop if any match falls
outside it. After the edit, inspect the diff and confirm that only those scoped
occurrences changed.

One explicit occurrence does not need this bulk-edit ceremony. Edit it directly,
then inspect the diff.

| Situation | Required action |
|---|---|
| One explicit occurrence | Edit it directly, then inspect the diff |
| Mechanical or bulk edit | Enumerate every match, assert the exact count and intended scope before writing, then inspect the diff |

## Conditional workflow completion

When a workflow has conditional steps, account for every step before claiming
completion. A useful change produces a diff and fresh verification. If the
artifact was already correct and a step needed no change, keep the fresh
verification evidence and state why that step was skipped. A zero diff with an
unexplained skipped step is incomplete.

| Result | Completion evidence |
|---|---|
| The step changed the artifact | Show the diff and fresh verification |
| It was already satisfied and no change was needed | Show fresh verification and state why that step was skipped |
| There is no diff and a skipped step has no reason | Incomplete |

## The diff coverage gate

An absolute coverage threshold — 80% of the whole repository — is the gate that
gets switched off. It holds every author hostage to inherited debt, so the first
person blocked by it lowers the number, and after two lowerings it stops
catching anything.

Gate the **diff** instead. At least 90% of the lines this change adds or
modifies must be executed by a test, the threshold the TDD gate script uses by
default; untouched legacy files are outside the rule entirely. The
enforcement survives because it is proportionate: a new untested branch fails on
its first run, and nobody is punished for code they did not write. Tests that
already went red cover those lines, so 90% is not a harsh figure. The number
measures whether this change came without tests, not the repository's report card.

| Language | Diff coverage command |
|---|---|
| Python | `coverage xml && uvx diff-cover coverage.xml --compare-branch=origin/main --fail-under=90` |
| JS/TS | `jest --coverage --coverageReporters=lcov && uvx diff-cover coverage/lcov.info --compare-branch=origin/main --fail-under=90` (vitest: `--coverage.reporter=lcov`) |
| Go | `go test -coverprofile=c.out ./...`, convert to cobertura, then `uvx diff-cover` |
| Rust | `cargo llvm-cov --lcov --output-path lcov.info && uvx diff-cover lcov.info` |

The per-language recipe lives in the matching section of `tdd`'s language
guides; this skill owns the gate and the reason for it. A `--changedSince` or
`related` run only narrows what executes. It does not measure coverage, so it
is a fast loop and never this gate.

**Diff coverage is a floor, not a proof.** A line executed by a test that
asserts nothing is covered and unverified — which is exactly the state
`scripts/red_probe.js` exists to detect. Run the probe on the checks that the
diff coverage number is standing on: if breaking the implementation does not
turn the command red, the coverage number was measuring execution, not
verification.

## Phase 3: separate machine from human

| Settled by machine | Settled by a person |
|---|---|
| Tests pass, build succeeds, lint clean | Does this meet the requirement |
| Types check, no diagnostics | Is the design sound |
| Coverage numbers | Are the tests testing the right thing |

**Do not pretend to measure the right column.** Report it as open and say who
must decide.

## Phase 4: report

```
## Verification

| Check | Command | Result |
|---|---|---|
| Tests | `npm test` | 142 passed, 0 failed |
| Build | `npm run build` | ok |
| Lint | `npm run lint` | 2 warnings |

## Open (needs a person)
- Whether the retry policy matches what operations expects
```

**If something did not run, say it did not run.** An omitted row reads as a pass.

Each row also carries a **claim label** — what the evidence covers, which is a
different question from who settled it. The four labels, the rules that keep
`verified` honest, and the decision tree are in `references/claim-labels.md`.
When the check compares package digests rather than behaviour, read
`references/digest-contract.md` first: three digests, never one, and the
canonicalization clauses that keep them comparable across machines.

Retain the command, tested input identity, relevant environment, result, and log
location when available. Distinguish checks executed now, valid results reused,
and checks not executed. Do not claim time or cost savings without measurements.

## Merging a worktree back

Merging is not part of verifying. Squash-merge a worktree only when the user
asked for the merge, and only after they approve the specific squash. A squash
makes the individual commits unreachable and puts a commit on the target
branch, which is hard to take back once anyone pulls it. A finished worktree, a
green check, or a request to verify is not a request to merge.

1. **Confirm you are in a worktree** — `git rev-parse --git-dir` contains `/worktrees/`
2. **Verify first.** Phases 1–3 above, before the merge, not after
3. **Ask for approval.** Show the target branch, the commits the squash will
   hide, the diff summary, and the drafted message. Wait for the user's yes
4. Squash-merge into the target branch only after that approval
5. The message follows `gitrules`, which owns the subject length and the body
   format: why first, then how

**Do not merge on a red check.** A squash makes the individual commits
unreachable; the failure becomes harder to bisect.

The full six-phase procedure — validation, research, target preparation, the
squash itself, the message, and post-merge verification — is in
`references/merge.md`. Its approval gate sits before the squash and no other
instruction in that file overrides it.

## What this skill owns

| File | Read or run it when |
|---|---|
| `references/claim-labels.md` | Writing a verification report — label what the evidence covers |
| `references/digest-contract.md` | A check compares package digests, or a cache did not invalidate |
| `references/merge.md` | Squash-merging a worktree back |
| `references/self-check.md` | Selecting only the cold-read, fact, eval-independence, SSOT, or portability review this task needs |
| `references/local-feedback.md` | Diagnosing failures and choosing a focused reproduction before broader execution |
| `references/validation-cost.md` | Investigating slow validation or test suites, setup duplication, cache value, or resource contention |
| `references/test-waits.md` | A test unit waits instead of working: sleeps, real intervals, retry backoff, open handles, network, or startup |
| `references/test-parallelism.md` | Running tests in parallel: isolation checklist, workers per runner, long pole, and sharding |
| `references/test-selection.md` | Choosing affected tests with a tool or judging a selector |
| `references/flaky-tests.md` | A test passes and fails on the same code; retries and quarantine |
| `references/test-evidence.md` | Explaining a test speed or flakiness rule with its cited source |
| `references/interactive-cli.md` | Checking a prompt, dialog, TUI, or agent CLI session in a real terminal with tmux or another PTY driver |
| `references/pr-feedback.md` | Responding to pull request review comments, bot comments, or a failing CI run before any reply, push, or rerun |
| `references/ci-diagnosis.md` | Diagnosing a CI failure against exact repository, head, run, job, and attempt evidence |
| `scripts/preflight.js` | Before a package is installed — mode is detected, symlinks are refused |
| `scripts/package_check.js` | Before release — CHANGELOG top must equal the manifest `version` |
| `scripts/package_identity.js` | Binding runtime, test, asset, metadata, and raw-tree identities without relying on Git |
| `scripts/red_probe.js` | Proving a verification command can actually fail |
| `scripts/test_profile.js` | Measuring wall against CPU time per test unit, the long pole, and budgets for new or changed tests |
| `scripts/test_smells.js` | Finding sleeps, fixed ports and paths, real network calls, retries, serial settings, and focused tests |
| `scripts/security_contract.js` | Validating optional security scope and observed oracle results; workflow owns execution |
| `scripts/workflow.js` | Connecting one version 2 task contract to readiness, delegation, interruption recovery, reviews, and fresh receipts |
| `scripts/ci_diagnosis.js` | Read-only cross-check of a captured CI failure against the current checkout |

## Boundaries

| Task | Owner |
|---|---|
| Writing the tests | `tdd` skill |
| Deciding what "done" means | `plan` skill (acceptance criteria) |
| Commit and PR format | `gitrules` skill |
| Judging code quality rather than completeness | `audit` skill |

## Limits (stated)

- This skill runs **what the repository already has**. It does not add checks
- Coverage numbers measure lines, not correctness
- The human column stays human. Reporting it as settled is the failure this
  skill exists to prevent

## Task routing and completion

For authorized delegation, follow [Runtime routing](../../runtime/ROUTING.md):
plan with `jst route plan`, reserve one attempt with `jst route run`, execute, and
record checked artifacts with `jst route record`. It owns model transitions and
the rules every calling skill follows.

For a selected SDLC Release or the ship command, read [shared ship gates](references/ship-gates.md).

## Optional SDLC caller

When an explicitly selected `sdlc` run calls this skill, follow
[the leaf rules in sdlc](../sdlc/SKILL.md#leaf-skills-called-by-a-run). A standalone
call needs no run context.
