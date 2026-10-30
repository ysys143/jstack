# jstack contributor instructions

jstack is authored at the repository root and built for Claude Code and Codex from
one common source. Markdown skill bodies are executable product behavior.

## Source layout

- `skills/public/<category>/<name>/`: user workflows and owning contract suites.
- `skills/support/<name>/`: conditional internal procedures and owning suites.
- `runtime/`: shared runtime support.
- `hosts/claude/`: Claude commands, agents, hooks, and output styles.
- `hosts/codex/skills/`: reviewed Codex-specific skill bodies.
- `packaging/`: explicit file membership, build, release, and host probes.
- `scripts/`, `tests/`: current validation tools and root suites.
- `contracts/`, `evals/`: shared behavior contracts and evaluation cases.
- `docs/`: current architecture documentation.

Public workflows and conditional support are classified by
`contracts/skill-catalog.json`; its behavior contract is `contracts/skill-catalog.md`.
The build derives hierarchical host discovery from that catalog. Canonical source
folders use the public/support hierarchy. Explicit membership maps these sources
to stable internal payload addresses `skills/<owner>/`; those generated payloads
are not authoring copies. Use `sourcePath` for contributor reads of logical owner
addresses. Never add old-path source links or a competing canonical copy.

Do not create a second canonical tree or edit generated `entries/` files.

## Editing and validation

Read the nearest nested AGENTS.md. Embedded upstream trees own their guidance;
preserve their licenses, notices, and internal paths.

`packaging/package-files.json` is an explicit reviewed inclusion list. Inspect
changes with `node dist/packaging/build.js inventory --source . --output NEW_MANIFEST`.
Builds fail on drift and never refresh the list automatically.

`node dist/scripts/run_suites.js` builds a disposable package and runs every discovered
suite, deletion regression, measured floor, shared-library behavior, and canonical
source check. `node dist/scripts/run_suites.js setup workspace` selects affected suites.
Tests use a temporary Git snapshot; preserve the user's index and unrelated edits.
Only the disposable snapshot may install locked dashboard build dependencies and the
locked statechart test environment.
Do not install optional user integrations during tests. Missing checkers and zero
suites are failures. Bind validation evidence to the tested input hash.

`node dist/packaging/release.js --source . --output NEW_DIRECTORY` creates a checked
local marketplace for both hosts. It does not publish remotely or alter user homes.
Actual host installation and model behavior need separate host evidence.
`.github/workflows/validate.yml` defines the complete automated CI checks.
`windows-launcher.yml` adds a small Windows job for the plugin launcher and the
Claude and Codex PATH hooks when their paths change; `node-compatibility.yml` is the weekly
Node and OS matrix.

Tests do not wait on the clock: wait for a condition with a deadline, or make an
interval a parameter and shorten it in the test. Use port 0 and temp dirs, never
fixed ports or paths. New or changed Node tests must pass
`node dist/scripts/test_budget.js --base origin/master` (time budget, no waiting,
repeated runs; budgets in `scripts/node-test-groups.json`); CI runs it on pull
requests. Fix a violation in the test or its timers instead of raising the budget.

## Scope and conventions

Keep organization profiles under `~/.jstack`; never package private profiles or
comparison lists. Preserve user instructions, user-authored skills, and unrelated
index changes. jstack's staging version is a candidate, not a published release.

Use `feat/`, `fix/`, `refactor/`, `docs/`, or `test/` branch names and Conventional
Commits. PRs need one category and one position label. Commit with the
repository's configured author identity. Never add AI generation footers or AI co-author trailers.

Explain work to the user in Korean unless they request another language. Maintain
English technical content except intentional Korean language rules and protocols.
