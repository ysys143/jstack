# Source hierarchy and local activation — 2026-09-14

Canonical source relocation and local candidate activation are complete.
The candidate is `jstack@jstack` version `0.9.0-staging`; it is not a remotely published
or fully accepted release. Inherited full-contract failures remain explicit.

Tested and installed source SHA-256:
`46a19cdcabf08ab16e79fe389808a76c062ce880b37b399f7d8ae5ea51a77b7b`

## Source and delivery

```text
skills/
  public/
    workflow/       # 6 user workflows
    engineering/    # 8 user workflows
    artifacts/      # 7 user workflows
    research/       # 2 user workflows
    operations/     # 4 user workflows
  support/          # 7 conditional procedures
  _suite_lib*       # suite infrastructure, not public skills
hosts/codex/skills/
  public/           # matching reviewed native bodies
  support/
```

All 34 source owners moved. Their source `name` values match their new directory
names. There are no old-path `SKILL.md` files, compatibility source links, or
second canonical trees. Embedded upstream paths and bytes were preserved.
The obsolete empty `skills/jstack` directory was removed.

The reviewed membership changed 3,993 source bindings and removed no delivery
targets. Its explicit `source -> target` mappings preserve internal
`payload/skills/<owner>/` addresses. Public host discovery remains hierarchical;
that internal payload address space is not registered as a public skill root.
The compiler remaps imports and static resource URLs to those delivery addresses.
Contributor resource lookup resolves logical owner addresses to the new source.

See [the move inventory](skill-source-migration.json) and
[the governing contract](../contracts/skill-catalog.md).

## Observed checks

| Check | Result |
|---|---|
| TypeScript build | Passed |
| Complete discovered Node test run | 303 passed, 0 failed, 39 skipped optional tests |
| Targeted migration/register controls | 5 passed, 0 failed |
| Explicit package inventory | 4,647 reviewed source members; no unreviewed drift |
| Checked package | 4,662 delivered files; privacy and file-hash checks passed |
| Isolated Claude 2.1.270 | 27 public skills + 26 commands; 17 agents; 4 hook registration events |
| Isolated Codex 0.154.0 | Exactly 27 public native skills; no support entries |
| Installed-path execution | All 27 inspectors per isolated host resolved their source inside the cache |
| Old/new payload comparison | No missing skill files; common bodies, references, and assets preserved |
| Resident description estimate | 5,658 tokens against the unchanged 7,566 limit |
| Distribution bytes | 72,294,022 against the unchanged 83,886,080 limit |
| User settings | All four profiles semantically match the pre-update settings backup |
| Source index | Original SHA-256 preserved |

The source hierarchy fixture deletes the source after building and executes a
module that imports support code and reads a resource. It also checks the source
and payload identities, hidden support boundary, and native export names.

A requirement-register unit test previously assumed the mutable real register
was unimplemented. The test now constructs that state in memory; real progress
and acceptance evidence were not changed to make the test pass. Source file
pointers in the mutable register were relocated, without promoting its status.

## Actual profiles

- Two Claude profiles, one `.agents` home and one Codex home: `jstack@jstack`
  `0.9.0-staging`, 27 public skills, all 4662 package files checked in each.

Both Claude profiles retain the 26 existing commands, including the maintenance
compatibility commands. Actual Codex `skills/list` returned the declared public
IDs from each selected profile's 0.9.0 cache. Model inference and automatic hook
execution are separate from this discovery evidence and were not claimed.
Existing sessions need to restart to load the updated catalog.

Updates ran through the jstack CLI with explicit `CLAUDE_CONFIG_DIR` and `CODEX_HOME`.
No hand-written registry replacement or installation beneath a `skills/jstack`
directory was used. Older cache versions and CLI-retained rollback packages were
kept. The shared CLI receipt still has one deployment record per host kind; this
work aligns the selected profiles to the same version and does not claim support
for independent per-profile version histories.

During native updating, Codex -3's `model_reasoning_effort` changed from `high` to
`low`. Its origin was not established; a minimal isolated reproduction retained
`high`. To preserve the pre-update personal setting, only that field was restored
after verifying that every other parsed setting was unchanged. The observed
post-update configuration was retained privately before restoration. No model
preference was added to the skill catalog or package defaults.

## Remaining failures

The complete owning-contract runner was attempted and failed before running
suites because its frozen-reference Git blob
`bfe7dc8c7aedeb9e3791a08b432b4c21bc7e191e` is unavailable. The corresponding deck
reference was moved unchanged. Frozen references were neither regenerated nor
weakened to label this failure as success.

The earlier before/after checks also found the same 24 path-baseline findings
and 247 unclassified diagram-vendor files. Those are unresolved inherited audit
findings. The real TS-migration acceptance register has stale evidence; the green
Node unit test is not a release-acceptance result. These limitations remain even
though the new hierarchy, local package, and selected host installations passed
their specific checks.

## Evidence and backups

Raw evidence is outside the repository source tree, under its parent directory:

- `jstack-source-hierarchy-unit-final.log`
- `jstack-source-hierarchy-final-targeted.log`
- `jstack-0.9.0-staging-build.log`
- `jstack-0.9.0-staging-contracts.log`
- `jstack-0.9.0-staging-hosts/summary.json`
- `jstack-0.9.0-staging-real-hosts.json`
- `jstack-0.9.0-staging-install-primary.json`
- `jstack-0.9.0-staging-install-secondary.json`
- `jstack-0.9.0-staging-user-settings-check.json`

The source backup is `../jstack-before-source-hierarchy-20260914-143449.tar.gz`.
Private settings and registration backups are under `~/.jstack/backups/`:
`before-0.9.0-20260914-144737.tar.gz` and
`codex-3-after-native-update-0.9.0.toml` (mode 0600).
Those files are private recovery data and are not package members.
