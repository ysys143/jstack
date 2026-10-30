# TypeScript migration closure (2026-10-30)

The move of jstack's runtime, hooks, scripts and contract suites from Python and
shell to TypeScript is closed. Every suite, hook and script now runs from the
compiled `dist/*.js`. The suite labels keep their historical `.py` names (for
example `tests/test_work_agents.py`) only as identifiers; the runner discovers the
`.js` files.

## What was removed

The maintainer decided to delete the pre-migration twins from the repository
rather than only excluding them from the package. Git history keeps them.

- 143 `.py` files that had a `.ts` sibling: hook twins, script twins, the Python
  copies of every owning suite, and the root `tests/test_*.py` copies.
- 29 `.sh` files that had a `.ts` sibling, among them
  `second-opinion/scripts/council-bridge.sh`, which sourced the user's API key
  file and called the unsupported `agy` with a permission-bypass flag.

## What stays in Python, and why

Files with no TypeScript sibling are real implementations, not twins. They
include the optional specialist tools listed in
[`contracts/ts-migration/specialists.json`](../contracts/ts-migration/specialists.json)
(HWPX, deck, diagram and image), plus a few fixtures and generators that tests
read as data. They stay. They run only in the isolated environments described in
[optional integrations](optional-integrations.md).

## Records that mention the old files

`contracts/ts-migration/` keeps the floor and crosswalk records written during
the migration. They describe how the native suites replaced the Python ones and
are historical; they are not a list of files that must exist.
