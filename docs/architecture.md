# jstack source and delivery architecture

jstack has one canonical source tree. Common skills live in `skills/`, shared runtime
code in `runtime/`, and host differences in `hosts/`. Claude commands, agents,
hooks, and output styles come from `hosts/claude/`; reviewed Codex skill bodies
come from `hosts/codex/skills/`.

## Build and installation

`packaging/build.js` checks the explicit `packaging/package-files.json` membership
and generates a common `payload/`, native `entries/claude/` and `entries/codex/`,
and host manifests. Generated entries resolve their installed payload by relative
path. They do not require the author's checkout. Aliased upstream directories are
excluded explicitly; their canonical content is packaged once.

Portable instructions and user-authored skills follow the `.agents` convention:
`AGENTS.md` and `.agents/skills/<skill>/SKILL.md` are canonical. A project
`CLAUDE.md` imports `@AGENTS.md`; Claude-specific commands, agents and hooks remain
host adapters. jstack itself is a plugin package rather than a skill, so the installer
must never copy the whole package into a host skill directory.

The CLI keeps immutable release inputs and a generated local marketplace under
`~/.jstack`. It registers that marketplace with both hosts. Claude Code owns the
installed copy in its native plugin cache; Codex owns its installed copy through
the `.agents/plugins` registry and cache. `CLAUDE_CONFIG_DIR` and `CODEX_HOME`
select alternate host profiles. Receipts track the jstack-managed marketplace source;
host caches remain owned by their host lifecycle.

`packaging/release.js` creates a checked local marketplace. Remote publication and
installation into an existing user home are separate actions. Organization profiles
live outside the package under `~/.jstack`.

## Verification

`packaging/run_contracts.js` builds a disposable package and Git runtime snapshot.
`scripts/run_suites.js` discovers owning skill and root suites in that snapshot,
records output, and verifies measured deletion floors and shared-library behavior.
Missing suites, missing checkers, and leaked state fail validation. Canonical-file
checks use current package membership rather than a historical migration ledger.

CI also checks built-package integrity, reference regressions, distribution cost,
line citations, hook ordering, and attribution. Host probes in `packaging/` test
installation separately. `packaging/interactive_probe.ts` drives real Claude Code
and Codex TUI sessions through tmux to observe trust dialogs, Codex hook review,
and hook execution; it needs a login and model use, so CI does not run it.
Passing static and runtime contracts does not establish
unmeasured model behavior or permission to redistribute upstream content beyond
its license terms.

Previous layouts and migration records are available in Git history. No archive
or legacy plugin tree is required to build, test, or use current jstack sources.

## Catalog-controlled skill discovery

The discovery contract is [skill-catalog](../contracts/skill-catalog.md), with
reviewed ownership in [JSON](../contracts/skill-catalog.json). Public workflows
export to `entries/<host>/<category>/<name>/`; support bodies remain conditional
payload resources. Shared lifecycle and evidence behavior stays in `runtime/`
and `contracts/`. Canonical source folders now use `skills/public/<category>/<name>/` and
`skills/support/<name>/`. Explicit membership preserves internal
`payload/skills/<owner>/` addresses without leaving source aliases. Source
relocation and real-profile activation have separate validation evidence. `jst catalog` lists public workflows
and resolves old source names without adding duplicate native skill entries.
