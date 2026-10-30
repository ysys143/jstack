---
name: runtime-adaptation
description: Probe an external tool at the point of use, explain partial capability, or export these plugins as self-contained native Codex packages. Triggers — "외부 도구", "CLI 연동", "설치 확인", "의존성 체크", "환경 준비", "Codex 플러그인 내보내기".
---

# Bridge — capabilities and delivery

## Build the shared cross-runtime package

For the current jstack source checkout, use `node packaging/build.js build
--source SOURCE_ROOT --output NEW_DIRECTORY`. This single package contains two
native manifests, reviewed host entries, and a complete shared `payload/` tree.
`node packaging/build.js check PACKAGE` verifies its declared file membership,
content receipt, public names, and private-data boundary. Build output must be
new; source and user-home settings are not modified. Both host entries set
JSTACK_PLUGIN_ROOT to the installed payload. Check actual host discovery and run
from the installed cache with source access denied before reporting portability.

The `scripts/export.js` path below is retained only for legacy migration and
regression comparison. Do not use it as the new default or apply its outer-root
assumptions to the dual-host package. Rebuild from the source checkout, never
edit generated entries or silently rewrite one host's tools into another's.


Probe a capability when the task needs it. Use `scripts/probe.js` and read
`references/probe-recipes.md` for the actual probe. Exit 0 means fully available,
1 means partial, and 2 means blocked. Name the missing capability and its effect
on the requested result. A binary's existence does not prove authentication,
permissions, rendering, or the required operation works.

Print an actionable installation command when a dependency is missing. Do not
run it unless the user authorized that install for this task; a request to do the
task is not authorization to install what it needs. Pass through
the maintained tool's arguments and errors; a bridge is not a replacement CLI.
An expected failing TDD test is different from a missing execution capability.

For a portable Codex package, build the shared dual-host package with
`node dist/packaging/build.js build --source SOURCE_ROOT --output NEW_DIRECTORY`,
or create a checked local marketplace for both hosts with
`node dist/packaging/release.js --source . --output NEW_DIRECTORY`. The build
copies the complete plugin dependency tree, chooses native entry points, checks
reachable host-specific instructions, and generates the native manifests and
content receipt. It refuses an existing destination. No Git history, original
checkout, user-home installation, or remote marketplace entry is required by the
resulting package. `node dist/packaging/build.js check PACKAGE` detects changes;
it does not certify an external publisher. `scripts/export.js` is kept only for
legacy migration.

Run the packaged scripts from a different working directory and inspect the
host's discovery of the installed skills. Generated files are disposable; edit
the canonical source and regenerate. The source marketplace's legacy flat-skill
migration utility is not the native plugin delivery path.
For each outer entry, resolve relative `scripts/` and `references/` paths from
`<outer-root>/payload/skills/<skill-name>/`; use `JSTACK_PLUGIN_ROOT` for the
plugin-level payload root.

Codex does not gain Claude commands, agent templates, or tool hooks merely by
receiving the same files. The package receipt lists this boundary. Use native
delegation and the explicit workflow/verification commands supplied by the
skills; do not report equivalent automatic enforcement without an actual host
test. Authoring belongs to `author`; deciding whether to vendor a tool belongs
to `upstream`.
