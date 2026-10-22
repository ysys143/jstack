# Skill catalog implementation evidence — 2026-09-14

Status: stage 1 implemented and discovery validated; full contract validation
has not passed. Canonical source relocation and real-profile activation remain
separate stages in [the contract](../contracts/skill-catalog.md).

Tested package source SHA-256:
`0e6765a044d70c3f745051a1641b7d274e3bfb4879fa83d4d17676192b567877`

The staged package version is still `0.8.4-staging`. This validation package is
not a replacement for any existing immutable installed release. A subsequent
activation must prepare a distinct candidate identity.

| Check | Observed result |
|---|---|
| TypeScript build | Passed |
| Catalog, builder, repack, and cost unit tests | 28 passed; 1 optional legacy oracle skipped; 0 failed |
| Reviewed membership | Five added files, no removals; explicit list updated after inventory comparison |
| Package identity, hashes, privacy, and discovery surface | Passed; 4662 files |
| Claude 2.1.270 native inventory | 27 public skills, 26 existing commands, 17 agents, 4 hook event registrations |
| Codex 0.154.0 native `skills/list` | 27 public skills, no support entries |
| Installed byte comparison | All 4662 files matched in each isolated host cache |
| Entry dependency execution | All 27 inspectors per host resolved their installed canonical sources with marketplace source hidden |
| Cost estimate | 5,658 resident description tokens / 7,566 limit; 72,184,978 bytes / 83,886,080 limit |
| Attribution, hook order, canonical library, line-reference checks | Passed; only 2 of 22 line citations locally measurable |
| Owning contract runner | Failed during preparation: missing frozen blob `bfe7dc8c7aedeb9e3791a08b432b4c21bc7e191e` for deck; requested suites did not run |
| Existing path regression | Both old installed payload and new payload: 24 entries above the recorded baseline |
| Existing payload category audit | Both old installed payload and new payload: 247 unclassified diagram vendor files |
| Source Git index | Preserved by the contract runner |
| Model inference, actual footer/hook execution, real profiles | Not exercised by this change |

Tests cover invalid ownership, unknown names, aliases, support dependencies,
hierarchical public export, preserved support resources, native Codex support
body selection, source-independent inspectors, recursive description measurement,
and rejection of an extra discoverable support skill even after receipt rehash.
Existing legacy-package tests also passed.

## Implemented ownership

- **workflow:** `review`, `second-opinion`, `record-decision`, `plan`, `test-driven-development`, `verify`.
- **engineering:** `skill-authoring`, `refactor`, `remove-capability`, `react-performance`, `credential-response`, `repository-setup`, `web-interface`, `upstream-maintenance`.
- **artifacts:** `slides`, `svg-diagram`, `humanize`, `hwpx-document`, `image-generation`, `office-documents`, `korean-proofread`.
- **research:** `research`, `scientific-tools`.
- **operations:** `agent-maintenance`, `usage-status`, `session-memory`, `google-workspace`.

Conditional support: `runtime-adaptation`, `task-delegation`, `emoji-policy`, `git-conventions`, `catalog-help`, `model-selection`, `parallel-execution`.

Old source names resolve through `jst catalog resolve`; renamed native slash IDs
are not preserved as hidden duplicate entries. Existing Claude command names are
preserved. All common source bodies, embedded resources, and owning suites remain
at their previous `skills/<owner>/` paths. Generated adapters carry the hierarchy.

## Evidence locations

Raw evidence is retained outside the source tree, not in a temporary directory:

- `../jstack-catalog-validation-20260914/summary.json`
- `../jstack-catalog-validation-20260914/hosts/summary.json`
- `../jstack-catalog-validation-20260914/baseline-comparison.json`
- `../jstack-catalog-validation-20260914/{before,after}-{paths,surface}.log`
- `../jstack-catalog-unit-results.tap`

Paths above are relative to the repository root. Their package hash binds them
to the tested inputs; source edits after this record need fresh evidence.

## Reviewed reference revisions

| Repository | Revision |
|---|---|
| LilMGenius/paperthin | `6f706e30b5ec55e87598bf3b59164c9d9d96222f` |
| corca-ai/charness | `95bc9b6ccba4bce0ce055ee0dd4337774caa4c43` |
| kyungseo/skillstead | `5d64192dbb186f30cef9e479167a2515e39e85dc` |
| cursor/plugins, cursor-team-kit subtree | `5bf2b1544db739998121a306340631963c2ff3de` |
| warpdotdev/common-skills | `b811c24365ae505bfc9646458957b886e29110b5` |

Structural lessons and rejected assumptions are recorded in the contract. No
reference repository is installed as a new runtime dependency by this work.
