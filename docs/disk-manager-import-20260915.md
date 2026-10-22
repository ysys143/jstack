# Disk manager incorporation and dashboard naming

The common source adds `skills/public/operations/disk-manager` and restores
`skills/public/operations/dashboard` plus its mirrored Codex body. The catalog
retains `usage-status` as a lookup alias, not an additional native entry. There
are 28 public workflows and seven conditional support procedures.

Candidate version: `0.9.2-staging`. Source SHA-256:
`1883bf6146ea95cee86e684ab08ebaa027124dcbe00274bc4b970317460b8d87`.

## Scope and source preservation

The original personal skill contained an older 249-line shell utility. Its live
implementation had expanded in an external 472-line `disk_utils.zsh`, a separate
`~/.disk_cache/refresh.sh`, and a launchd plist. SQLite history was outside the
skill too. This incorporation accounts for those external functions; it does
not copy personal incident logs into a public plugin.

The new owning engine reuses jstack's Node and SQLite runtime. It implements bounded
directory scans, filesystem capacity, snapshots, differences, daily history
charts, read-only legacy database import and opt-in launchd registration.
`jst disk` and the installed `scripts/main.js` share one implementation.
The bundled shell functions are optional command adapters, not a second engine.

The original personal skill, shell functions, collector, scheduler and database
remain untouched. No user filesystem cleanup, data migration, scheduler switch,
shell modification or global npm CLI installation was performed by this change.
Installing the native plugin does not enable collection. A stable jstack CLI install
is needed for the documented launchd integration; direct Node invocation supports
manual use from a resolved installed skill path.

## Behavioral corrections

- Private state separates profile, history, disposable cache and logs. No executable
  code or SQLite history lives in the scan cache directory.
- Failed samples and missing baselines remain unknown. Total usage comes from
  filesystem measurements, not an overlapping directory sum. Historical legacy
  paths are unknown because the old schema never recorded them.
- Scans preserve literal paths, cap child count, expose truncation and skip child
  symlinks. Cached results identify stale observations; refresh is explicit.
- Cleanup requires selected targets, current consumers and recovery evidence.
  Broad cache deletion and policy bypass instructions were not retained.
- Docker dates, restart policies, volume ownership, sparse allocation and cloud
  storage observations are separated from unverified causal explanations.
- Automatic collection is shared between hosts and never deletes user files.
  Legacy scheduler detection blocks accidental duplicate collection.

See the owning installation reference for a command-by-command compatibility
table, state paths, import behavior and manual scheduler transition procedure.
macOS collection support is explicit; model family and agent host are not
prerequisites. Other OSes are not advertised as collection-supported.

## Packaging and validation

The reviewed inventory adds 13 disk-manager files. Dashboard source paths move
while stable payload addresses remain `skills/dashboard`. The checked package
contains 4,679 files with no privacy findings. Resident descriptions estimate
5,740 tokens against 7,566; distribution bytes are 72,369,577 against 83,886,080.

Behavior fixtures cover isolated CLI snapshots, incomplete collection exit codes,
SQLite transactions and retention, missing baselines, migration preservation,
path handling, locks and scheduler rollback. The owning suite also measures
deletion regressions for the skill, four references and NOTICE; its six floor
records are registered without changing existing floor declarations.

The first full Node run passed 315 tests with 39 optional skips before the extra
snapshot fixture and owning-suite integration. Final-input results and native
activation are recorded below after completion.

The standard contract preparation still encounters the pre-existing missing
frozen Git blob `bfe7dc8c7aedeb9e3791a08b432b4c21bc7e191e`, even when selecting
disk-manager/dashboard. No frozen references were regenerated or weakened. A
standalone installed disk owning-suite pass does not establish full release
acceptance. Model behavior and live launchd execution need separate evidence.

Raw evidence is kept beside the repository in `jstack-0.9.2-*` artifacts. Private
settings/registration backups remain under `~/.jstack/backups/`. The earlier
0.9.1 staging artifacts were intermediate local checks, not published releases.

## Final-input results

- TypeScript build passed.
- Full discovered Node run: 316 passed, zero failed, 39 optional tests skipped
  (355 total). This includes 13 disk execution/contract fixtures.
- Installed disk owning suite: 14/14 passed, six measured deletion floor records,
  zero failures and zero temporary-directory leaks in the owning runner.
- Claude Code 2.1.271: 28 public skills plus 26 commands, 17 agents and four hook
  registration events. Codex CLI 0.154.0: 28 public skills. Both probes matched all
  4,679 files and executed every entry's installed-path inspector.
- Native installation updated two Claude profiles, one `.agents` home and one
  Codex home through jstack CLI to `jstack@jstack` 0.9.2-staging. Existing sessions need to restart.
- Settings in all four profiles semantically match the pre-update backup; the
  source Git index is unchanged. Existing unrelated working changes were retained.

The local Node CLI was used for activation; this does not claim that a global
`jst` executable was installed. Native discovery does not prove model execution,
live launchd collection, hook trust or complete release acceptance.
