# Contract validation performance

The contract runner preserves owning suites, deletion controls, measured floors,
and independent workspaces while reducing repeated setup. Scheduling data never
serves as evidence that a test passed.

| Change | Rollout |
| --- | --- |
| Separate setup, execution, and cleanup timings | Enabled; evidence is retained per run |
| Reuse audited deletion workspaces | Enabled; fresh-copy comparison and regression checks passed |
| Reuse identical deletion results | Experimental, explicit opt-in; disabled in CI |
| Select affected quick contracts | Select owner and host consumers; unknown changes run all quick contracts |
| Start long suites first | Applied when compatible timing history is available |

The separate Node compatibility matrix runs weekly and on manual dispatches. Pull requests retain contract validation without triggering that
27-job matrix.

## Observed baseline

The successful contract run [36450904747](https://github.com/ysys143/jstack/actions/runs/36450904747)
validated source commit `5cd754beb41d824d8b91d21e1b74f7d0eb0b769b`.
The owning-contract step took 1,845 seconds; the runner reported 1,826 seconds
for 53 suites with four isolated workers. The artifact contains 497 measured
deletion records: 365 document controls, 99 script controls, and 33 body controls.
The old implementation copied a filtered package tree for every deletion call,
in addition to the outer suite copies.

These measurements identify repeated work; they do not establish the speedup of
any proposed replacement. Compare the same package inputs on the same machine,
Node version, and worker count before claiming a reduction.

## Deletion controls are opt-in (2026-09-30)

`packaging/run_contracts.js` omits deletion controls unless `--deletion` is
passed. Without it, every suite runs its ordinary assertions once, deletion floor
parity is deferred, and `summary.json` records `validationMode: full-no-deletion`
with `deletionSkipped: true`. `--deletion` cannot be combined with `--quick`.

Reasons:

- The owning-contract step is most of the wall time of a run (1,187-1,269 seconds
  of a 23-35 minute run in the runs inspected on 2026-09-30). Measured test
  execution across the retained suite outputs was about 144 seconds; the rest is
  attributed to per-suite workspace copies and repeated deletion executions. That
  split is inferred from the code and timings, not measured per phase.
- A deletion control answers one question: does a suite still fail when the
  instructions it covers are removed? That property changes when a suite or its
  covered files are restructured, not on every edit, so re-proving it on every
  pull-request push repeats mostly unchanged work.
- Pull-request feedback should be fast. The controls still guard the merge
  target: the weekly schedule and manual runs pass `--deletion`.

Cost accepted: a suite that has become vacuous is detected after merge, not on
the pull request. A pull request that restructures a suite or its covered
instructions should run `node dist/packaging/run_contracts.js --deletion` locally
(or dispatch the workflow) before merge. Evidence with `full-no-deletion` is never
a full contract pass, is not accepted for follow-up reuse, and does not feed
scheduling history. A manual dispatch can set `skip_deletion` to omit the controls.

## Minimal lane for pull requests and master pushes (2026-09-30)

A pull request or master push runs build and lint, and runs contracts only when
its selection plan names the suites to run (`execution: selected`). That covers
an edit confined to one or a few owners, such as an owner's instructions or suite
assertions. A plan that needs every suite (`execution: full`) skips the Node
tests, the specialist setup, the contract run and the delivery checks, and the
job summary says so. The weekly schedule and manual dispatch run everything,
including deletion controls, and release validation uses the same full run.

Pull requests in either lane also run `dist/scripts/test_budget.js` on added or
changed Node test files. In the minimal lane it is the only step that executes a
changed test file for its own sake. It costs nothing when no test file changed;
a PR that changes a fast test adds up to 15 seconds per file (3-second budget,
five runs) and an integration test up to 60 seconds per file (30-second budget,
two runs). The gate prepares the support `rules.json` and the locked native
SQLite archive itself, because the minimal lane skips the steps that provide
them.

Pull requests and pushes in either lane also run the `host-audit` suite on its
own (`run_contracts.js host-audit`, without deletion controls), because it
carries the skill listing size gate and neither lane would run it otherwise.
Most changes that can move the listing, a skill or command description or the
catalog, yield a full plan, which the minimal lane leaves to the weekly run; a
scoped plan (only `react-performance` has scoped source roots today) runs that
owner's suite alone. The gate fails when jstack's share of Claude Code's
model-facing skill listing exceeds 5,000 characters, when a listed skill
description exceeds 100 display columns, or when a described command exceeds 60
columns. It also fails when a public catalog skill is missing from the measured
listing or a package entry has unreadable frontmatter. The step needs nothing
beyond `npm run build` and took 15, 16 and 19 seconds in three local runs (Apple
M3 Max, macOS arm64, Node 20.0.0, a machine under load), of which 4 to 7 seconds
is the suite runner and the rest the disposable package build and its checks;
eight runs beside a full suite run on the same machine took 23 to 70 seconds. It
does not run the other contracts, so the "Cost accepted"
paragraph below still applies to everything else. Its summary and suite output
are uploaded as the `jstack-listing-gate-evidence` artifact, separate from the
contract evidence.

Reasons:

- Feedback from a push or pull request should take about a minute. Build and lint
  take about 10 seconds; one selected suite without deletion controls took 2
  seconds locally (the fast Node lane alone took 98 seconds in CI).
- Code, workflow, packaging and root-document changes select every suite, so the
  only useful check for them is the full contract run this lane defers.
- The first master pushes after the deletion-control change started full runs of
  about 20 minutes, which is what this lane removes.

Cost accepted: a change that needs every suite is validated at the next weekly
run or manual dispatch, not before or right after merge. A break can therefore
reach master and stay there for up to a week. The repository has no branch
protection or rulesets, so no required check depends on the skipped steps. Run
`node dist/packaging/run_contracts.js --deletion` locally, or dispatch the
workflow, for any change that can break contracts, and before every release. A
run in the minimal lane has no `selection-plan.json` evidence. If the selection
mode is `shadow`, every plan is `execution: full`, so every run takes the minimal
lane.

## Execution and evidence

`packaging/run_contracts.ts` builds a checked disposable package and binds runner
timings to its source fingerprint. Suite evidence includes copy, execution, and
cleanup durations. Deletion evidence separately identifies fingerprinting,
workspace preparation, subprocess execution, restoration, and cache reuse.
Record failed runs as failures; missing checkers, measurements, and zero suites
must remain visible.

Passing selected suites still require their measured-floor population and the
shared harness/canonical checks. Internal isolated workers leave aggregation to
the outer runner so the same global checks are not repeated for every suite.

## Deletion workspace and result reuse

Normal owning-suite snapshots and deletion workspaces remain separate. Deletion
workspaces must stay outside Git and retain the marker and recursion guard.
Reuse applies only when input identity and workspace eligibility match. Restore
the stripped files after each execution, inspect other changes, and discard a
contaminated workspace. Never share mutable file contents through hard links.
Runners must wait for their subprocesses to finish and must not leave background
writers. The reviewed bridge/workflow fixtures wait or terminate process groups;
arbitrary daemonizing tools are outside this reuse contract and should use fresh
copies (`JSTACK_DELETION_OPTIMIZE=0`).

Every logical deletion measurement executes a fresh child by default. A regular
copy tree alone does not establish hermetic execution: external tool binaries,
home configuration, and service state can change without changing that tree.

`JSTACK_DELETION_RESULT_CACHE=1` is an explicit experiment for suites whose inputs
and external dependencies have been reviewed. CI does not enable it. It caches
raw execution results within the process, using exact mutation and input identity,
and applies each consumer's measurement rules again. An expected deletion exit
code of 1 is a measured control; crashes, interrupted executions, and infrastructure
exit codes are not reusable. Equivalent failure counts alone never establish
equivalent mutations. Each declared floor retains its own measurement record,
with telemetry distinguishing logical measurements from physical executions.

Use `JSTACK_DELETION_OPTIMIZE=0` for a comparable run with the original fresh-copy
behavior. Before enabling an optimization for an owner, exercise source edits,
multiple stripped files, unexpected writes, deletion, cleanup failure, and
permuted execution order. Compare verdicts, measured floors, and source/index
preservation between modes.

## Scheduling

`--timing-history FILE` accepts previous suite timings as ordering hints. Validate
the schema and environment, then start longer known suites first using the same
four workers. New suites and unavailable or invalid history still run. A source
fingerprint change does not invalidate a scheduling hint; it always invalidates
passing test evidence. Historical results never suppress a check.

CI restores a small timing-history file and saves a new one only after a successful
full master run. Cache failures are optional scheduling misses. Preserve timing
provenance in the evidence. Assess both wall time and total runner work; adding
jobs can shorten the former while increasing the latter.

## PR selection rollout

The selector compares the PR base with the checked-out merge commit, using both
base and head membership. It emits the changed paths, reasons, candidate suites,
and resolved commit/tree identities. Unclassified paths, missing bindings, and
shared infrastructure changes request full coverage. Catalog ownership does not
by itself capture every cross-skill consumer.

`contracts/contract-suite-dependencies.json` records reviewed consumer edges and
the source roots eligible for scoped execution. The initial eligible root is
`skills/public/engineering/react-performance`; other owners remain full coverage.
Both revisions must carry complete dependency data, and the planner follows the
union of their edges transitively. Missing data never means no consumers.

PRs default to `enforce` for the reviewed selection graph. The Node runner has
separate `fast` and `integration` groups; all discovered tests still run in the
full lane. The Node runner executes each test file once; dedicated early Node
test steps no longer duplicate files in the fast group. Full runs enable the
localhost HTTP case in that same pass. Instruction and suite
assertion edits use quick owning contracts:
each selected suite executes its ordinary assertions once, while deletion
mutation controls and their floor parity are explicitly deferred. The heavy
workflow lifecycle cases in `verify` run only in the integration lane.
Changes to executable code, shared configuration, packaging, workflows, or
unclassified paths retain full integration contracts on the PR. The optional
localhost HTTP integration check also runs only on full PRs, scheduled runs,
and manual runs. The reachability and package-surface checks inspect the package
already built by the contract runner. `summary.json` records
`validationMode: quick` and `deletionSkipped: true`; this is never evidence of a
full contract pass. A scoped, validated plan must match the clean checkout to
select suites. Quick plans map changed owner instructions through the reviewed
consumer graph and changed host agents or commands to their root suites. If no
selected suite needs deck, diagram, image, or hwpx tools, specialist
setup is skipped. Otherwise quick runs prepare only the environments required
by the selected deck, diagram, image, or hwpx suites. The office suite does not
use a specialist Python environment. An unknown path, missing dependency data,
or changed checkout falls back to all
quick suites or fails visibly. Only the React owner source root is currently
eligible for a narrower *full integration* selection. A repository Actions
variable may set `JSTACK_CONTRACT_SELECTION_MODE=shadow` to force the complete
candidate population while auditing selection.

Master pushes no longer reuse pull-request evidence: they take the same lane as
pull requests. The earlier follow-up gate remains in `run_contracts` (`--followup`)
but the workflow does not call it.
Pull requests that touch the plugin launcher (`hosts/claude/bin/`), the Claude
PATH hook (`hosts/claude/hooks/jst-path*`, `hooks.json`), the Codex link hook
(`hosts/codex/hooks/`) or their packaging also start the separate
`windows-launcher.yml` job: it runs those Node tests on Windows, the launcher and
the Claude env-file line in Git Bash, and the packaged Codex hook through
`cmd.exe`. A weekly
scheduled run and manual `workflow_dispatch` run all Node tests, all owning
contracts, deletion controls, floor parity, and the optional HTTP integration
check. Release candidates require that full workflow.

Review selections against known failures, deleted/renamed inputs, new owners,
cross-owner consumers, and global checks before adding eligible roots. Malformed
plans must fail visibly. Explicit local selectors remain available:

```sh
node dist/packaging/run_contracts.js author tests/test_dev_commands.py --output /tmp/jstack-contracts-new
node dist/scripts/select_contract_suites.js --base BASE_COMMIT --head HEAD --mode shadow
node dist/packaging/run_contracts.js --quick author --output /tmp/jstack-quick-new
```

## Acceptance

Focused harness tests must cover measurement failures, state leakage, cache
invalidation, ordering without omissions, and plan binding. Compare optimized
and fresh-copy runs against the same input and retain both logs. Then run the
complete owning-contract population once on the integrated source, including
specialist test dependencies in an isolated test home, and compare all declared
floor records. Broad reruns require new changes or an unresolved failure.

## Local comparison (2026-09-29)

The `author` suite was run sequentially on macOS arm64, Node v24.19.0, using
package source SHA-256
`3f941371c2dbe1178df350ecd3da403ff8c2a55f0c4d82ac5aef43586e19c603`.
Result caching was disabled in both runs. Both returned 0, passed 429/429
assertions, preserved the source index, and produced the same 58 floor records
from 58 physical deletion executions.

| Measurement | Fresh copies | Audited reuse |
| --- | ---: | ---: |
| Runner wall time, including aggregation | 187.3 s | 157.2 s |
| Deletion copy time | 49.9 s | 11.2 s |
| Deletion subprocess time | 107.7 s | 98.8 s |
| Input fingerprinting | 0 s | 11.4 s |
| Post-execution audit | 0 s | 15.7 s |
| Per-case cleanup | 21.3 s | 5.4 s |

These rows are selected phases, not an additive breakdown of wall time. Reuse
occurred 51 times; six contaminated workspaces were discarded. Wall time fell
16.1% in this single comparison. The differing subprocess times show ordinary
measurement variability, so this is local evidence, not a predicted CI speedup.

An earlier fresh run failed 427/429 because the new dependency JSON was absent
from the package-surface classification. The standalone classifier reproduced
and verified that fix before the comparable passing runs above. Its failed
timing is excluded from the performance comparison.

Local evidence: `/tmp/jstack-ci-author-comparison.json`,
`/tmp/jstack-ci-author-fresh-final/`, and `/tmp/jstack-ci-author-reuse/`.

## CI optimization snapshot verification (2026-09-29)

The package source SHA-256 for this earlier CI optimization snapshot is
`059ef0282ff3ba5e0c515366dbd8f4776668ac1e6fe6836aed909e3c2538f14f`.
Verification used macOS arm64 and Node v24.19.0. Specialist dependencies were
installed only in `/tmp/jstack-specialist-validation`. No remote CI was triggered.

| Gate | Result |
| --- | --- |
| Complete owning contracts, four isolated workers | 53 suites passed; 0 failures; 578.7 seconds |
| Declared deletion floors | All 497 checked; no errors |
| Physical deletion executions | 510 executions for 510 logical calls; 0 result cache hits |
| Shared harness and canonical library checks | Passed |
| Node tests on the final frozen source | 406 passed; 41 optional tests skipped; 0 failures |
| Package membership, paths, cost, references, attribution, hook order | Passed |
| Package-surface classification | 4,572 files; 19 categories; 0 unclassified |
| Source Git index | Preserved |

The final run applied compatible timing history and started long suites first.
The previous integrated run took 768 seconds and failed two suites. It had
different inputs, so its duration is not a controlled performance comparison.
Likewise, the historical Linux CI duration cannot be compared directly with this
local macOS run. The controlled `author` comparison above remains the evidence
for the measured 16.1% local reduction; it predates the final boundary and CLI
fixture corrections.

### Failures found and resolved locally

- The first complete run rejected legitimate `../../commands/...` and
  `../../evals/...` deletion targets in `workspace`. Targets are now bounded by
  the copied plugin root. Escaping that root and traversing symlinks remain
  rejected; focused regression tests cover restoration and boundary rejection.
- The development-command smoke test suppressed deletion measurements while
  expecting the selected runner to pass. Selected runs now correctly require
  their measured floors. Its positive smoke uses the real public CLI with a
  small independent fixture and verifies that all three meta checks are reached.
  The complete run still exercises the real packaging wrapper and real owning
  suites. This avoids repeatedly running an unrelated `help` deletion suite.
- One earlier Node test failed while reporting workflow verification as stale.
  Documentation was edited during that run; a separate reproduction showed
  that such an edit changes the workflow runtime identity. The original failure
  did not log its detailed status problems, so this is a plausible explanation,
  not a proven diagnosis. The isolated test and subsequent complete runs passed
  after source edits stopped. Freeze inputs during identity-sensitive tests.

After the two owning-suite fixes, focused `workspace` and development-command
checks passed 252/252 and 238/238, with all 37 associated floors. The final full
run above then passed without relaxing any declared floor.

### Remaining bottlenecks and rollout limits

The final slowest suites were `verify` (464.1 seconds) and `diagram` (451.6
seconds). `verify/tests/run_tests.ts` invokes `workflow_checks()` again in each
deletion child, including real full-task and timeout workflow tests. Reducing
that repeated work requires a separate review of which mutation each behavior
check protects; these checks were retained here.

PR selection remains shadow-only by default, with only the reviewed React source
root eligible for eventual scoped enforcement. Result caching remains an
explicit experiment. Neither feature is counted as realized CI savings.
Windows-specific test latency remains a separate problem; moving compatibility
validation after merge reduces duplicate PR execution but does not fix it.

Snapshot evidence: `/tmp/jstack-ci-final-evidence.json`,
`/tmp/jstack-ci-contracts-final/`, `/tmp/jstack-ci-contracts-final.log`,
`/tmp/jstack-ci-node-final-current.log`, and `/tmp/jstack-ci-package-final.log`.
Temporary evidence is local; CI artifact retention is configured for future runs.

## Project lint configuration and identity follow-up (2026-09-29)

The project had recorded a `configured` hook decision and a TypeScript typecheck
script, but no JavaScript/TypeScript lint script or Python Ruff configuration.
The resulting lint gap was an incomplete setup step. The follow-up pins Biome
2.5.14 in the npm lockfile and Ruff 0.16.8 in `lint:python`. Biome covers authored
JavaScript and TypeScript through `npm run lint`; Ruff covers jstack-authored Python
through `npm run lint:python` and the existing path-scoped project hook. Embedded
upstream repositories retain their own rules. Both checks run in CI. The local
machine's PATH now includes a user-tool installation of Ruff 0.16.8, so Python
hook calls can execute here. Formatting remains disabled by project policy.

Biome checked 416 files in about 0.2 seconds; Ruff passed on the authored Python
tree. Separate negative probes confirmed that Biome reports `noDebugger` and
Ruff reports `F821`. A mixed TypeScript/Python path selection produced lint and
typecheck actions with no gaps. Typecheck, workflow YAML parsing, and package
build passed. The final package source SHA-256 after the identity follow-up is
`413c92f3e467c965d752f702642421d35b6b249fb2eb102969fe8fe19898504e`.

Focused workflow verification initially found intermittent
`coordinator-package-stale` results. The identity scanner had included live
`.omc/state` session files, which changed during the test. The TypeScript and
Python scanners now exclude ephemeral local agent state. The identity and
workflow Node tests passed 15, skipped one optional oracle, and failed zero;
the Python identity tests passed 19. An isolated repeat of the previously
failing workflow cases passed two of two.

One intermediate `verify` owning-suite run passed 198 of 199 assertions. Its sole
failure came from changing `references/digest-contract.md` without updating its
frozen reference. Reverting that unnecessary document edit restored the exact
blob declared by the frozen reference; all seven focused freeze checks then
passed. The final `verify` owning-suite run passed 200/200 assertions, all 20
deletion floors, and the three shared meta checks in 452.9 seconds. Its package
source SHA-256 is the later hash recorded above, and it preserved the source
Git index. The earlier 53-suite/497-floor pass belongs to the CI optimization
snapshot above, not this later source SHA.

Follow-up evidence: `/tmp/jstack-lint-identity-node-final.log`,
`/tmp/jstack-lint-identity-python-final.log`, `/tmp/jstack-lint-verify-final.log`,
`/tmp/jstack-lint-verify-green/`, `/tmp/jstack-lint-verify-green.log`,
`/tmp/jstack-lint-package-final.log`, `/tmp/jstack-lint-first.log`, and
`/tmp/jstack-python-lint-configured.log`.
## Waits and repeated work inside suites (2026-09-30)

A profile of the full CI run for commit `d8c67953` showed that the owning-contract
step took 2,152 of about 2,340 seconds. Its 53 suites summed to 7,821 seconds of
serial work on four workers, and one suite bounded the whole step: `diagram` took
1,839 seconds, 1,698 of them in 25 deletion copies of about 82 seconds each.
Deletion copies accounted for 6,142 seconds of the serial total.

Measuring wall time against CPU time per step found two different problems:

- `diagram` spent about 17 of each copy's 21 local seconds in nine pinned upstream
  Python gates. They are CPU-bound, and their only inputs are the upstream tree and
  the pinned interpreter; deletion copies change jstack documents and never those
  inputs. The live run now records each gate's verdict with a digest of the
  interpreter path and every upstream file hash. A deletion copy reuses a verdict
  only when its own recomputed digest matches, and otherwise runs every gate.
- `verify` ran a workflow timeout test that slept 12.2 seconds to show that a
  killed descendant never wrote its delayed file: 18.8 seconds of wall time for
  1.7 seconds of CPU. The descendant now records its pid, and the test waits until
  that process no longer exists (10-second deadline, shorter than the 12-second
  write) before checking the file. The five-second workflow timeout it verifies is
  unchanged.
- `verify` also repeated its script checks (preflight, package check, red probe,
  package identity, and the workflow integration tests) in every deletion copy.
  Those checks build their own fixture trees and never read the skill's documents.
  The live run records their results with a digest of the Node version and
  executable, the skill's `scripts/` and `tests/` (frozen snapshots excluded), and
  the shared `runtime/` and `scripts/`. A copy that strips only a document replays
  them; a copy that strips a script has a different digest and runs them again.
  The `author` suite already caches `run_fixtures` this way.

Same machine, same command (`run_contracts.js diagram verify`, deletion controls
included, four workers):

| Suite | Before | After |
| --- | ---: | ---: |
| `diagram` | 400 s | 115 s |
| `verify`, timeout wait removed | 602 s | 251 s |
| `verify`, script checks replayed as well | 602 s | 108 s |
| `diagram` and `verify` together, before script replay (wall) | 615 s | 261 s |

Every run passed the same checks (439 and 200) with no failures, and the deletion
floor records were identical to master.

The remaining suites were profiled the same way. Their deletion copies cost 2 to
11 seconds each and spend it on checks that read the documents being removed, such
as the `humanize` taxonomy and requirement scripts, so those results must be
recomputed. About 16 percent of a `humanize` copy is the `git rev-parse` call
behind the deletion-copy guard; that guard stays as it is because it protects real
checkouts and its own tests create repositories mid-process.

Rules for new or changed contracts:

- Do not wait on the clock. Wait for the condition with a deadline, or make the
  interval a parameter and shorten it in the test.
- Before adding an expensive step, check whether deletion copies would repeat it
  with unchanged inputs. Reuse is allowed only for a result whose complete inputs
  are hashed in the copy itself; anything read from a document or script that a
  deletion can strip must run again.
- Profile a slow suite with wall time against CPU time before changing workers or
  selection. Low CPU with high wall time is waiting; high CPU repeated across
  deletion copies is repeated work.
