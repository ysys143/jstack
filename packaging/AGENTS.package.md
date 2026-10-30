# jstack contributor guide

This directory is jstack's installed shared runtime, generated from one source checkout.
Marketplace publication is a separate operation. Historical dev/work documents
and evidence describe the pre-consolidation baseline, not current acceptance.

## Sources and ownership

- `skills/<name>/SKILL.md` is executable product instruction. Read its references,
  scripts, and owning tests before changing behavior.
- `skills/*/SKILL.codex.md` contains reviewed native host differences. Discovery
  does not prove execution or automatic hook enforcement.
- `skills/_suite_lib.js` and the contract runner are single canonical sources.
  There is no second plugin copy to synchronize.
- `commands/`, `agents/`, and `hooks/` have root contracts in `tests/test_*.py`.
- Embedded `skills/science/repos/` content keeps its own instructions, licenses,
  source pins, and internal paths. Do not edit it during ordinary plugin work.

## Verification

Run runtime commands from this payload root. The package includes its contract
checkers. For contributor validation, use the source checkout runner, which creates
a disposable Git runtime snapshot and binds evidence to the tested package:

```bash
node scripts/run_suites.js              # all skill/root contracts and meta checks
node scripts/run_suites.js setup recall # affected skill contracts only
node scripts/validate.js file.hwpx      # an artifact, not plugin contracts
node scripts/doctor.js                  # diagnostics, no dependency installation
cargo test --manifest-path skills/recall/bin/Cargo.toml # after producer changes
```

- Discover every non-underscore test file in each skill; aggregate all failures.
- Zero discovered suites and unavailable required checkers are not passing skips.
- Targeted runs do not prove global integrity. Full runs include all owning root
  tests, measured floors, and shared-library behavior checks.
- Use the owning subtree's documented environment. A missing dependency is not
  a product success or an excuse to silently skip a required test.
- Run deletion and mutation experiments in disposable copies. Never use
  `git checkout --` to restore shared user changes.
- Preserve deletion/incorrect-behavior detection when replacing incidental prose
  assertions. Do not lower a floor just to obtain green output.
- Compare actual files and process results independently of success reports.
- Keep source, test, runtime, and host evidence hashes bound to the tested input.

## Product boundaries

- `/validate` checks artifacts; `/test-plugin` checks this plugin's contracts.
- `setup` covers a project and its instructions. `/setup-recall` and
  `/setup-workspace` are explicit optional integration entrypoints.
- Preserve opt-in behavior for session autocommit and statusline configuration.
- Host-unavailable automatic hooks are not replaced by a claim of prose parity.
- Avoid changing shared user settings, publishing, or installing all optional
  dependencies as a side effect of validation.
- Preserve unrelated index and worktree changes.


## Contributor source locations

The source checkout keeps common skills and runtime at its root. Host overrides
are authored under hosts/claude and hosts/codex. Legacy-shaped commands, agents,
hooks, and SKILL.codex.md here are generated compatibility inputs, not a second
source. Rebuild with `node dist/packaging/build.js` from the compiled checkout. Do not commit edits
made directly to an installed cache. Public package entries resolve this payload
using their installed relative path; no publisher source path is required.

Core contributor contracts run with Node. The runner creates a disposable
package and installs locked dashboard build dependencies and the locked statechart
test environment only there:
`node dist/packaging/run_contracts.js`.
Other selected suites use their own documented dependency providers.
