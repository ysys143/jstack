---
name: disk-manager
description: "Diagnose disk growth and reclaim selected files or caches. Triggers: 디스크 정리, 용량 부족."
---

# Disk manager

Measure the cause before choosing a cleanup. A large directory, old timestamp,
or unreferenced Docker object is not evidence that its data is disposable.

## Diagnose, select, act, verify

1. Identify the OS, selected filesystem and available tools. Collection and
   scheduling currently support macOS. Do not run macOS commands on another OS.
   Use the same procedure with either host and any capable model; no Claude shell
   snapshot, alias, or model family is a prerequisite.
2. Run `jst disk context` and `jst disk status` first. If `jst` is not found,
   stop: that is an installation fault. Follow [jst command on PATH](../../runtime/CLI-PATH.md)
   to name the cause and propose a fix the user approves. Do not
   substitute a Node absolute path, shell wrapper, alias or symlink. Read prior
   keep decisions, unresolved candidates and recent measurements before choosing
   what to scan. Context reads an existing legacy SQLite history in place when
   the new database is absent. It reports a legacy history not yet imported, even
   after jstack snapshots, with any legacy launchd collector, under `migration`;
   `schedule status` lists `legacyCollectors`. When a legacy
   collector or database is reported, present the migration proposal to the
   user before continuing. Do not import, disable the legacy job or enable the
   schedule without their decision; record it with `jst disk remember` and do
   not re-propose against a current decision. Recheck the likely changed branch
   first; scan home only when the available evidence does not identify a useful
   starting point.
   Include Movies, Downloads and Library when that broader scan is needed.
   Do not run a full snapshot just to initialize a first session. Use
   `jst disk snapshot CATEGORY` to record a selected measurement if useful.
   Report scan time, errors, units and stale cache status. A failed
   measurement is unknown, not zero. Never sum overlapping categories as total
   disk usage; the filesystem measurement owns the total.
3. Present candidates with exact path or object ID, measured size, live consumers,
   recovery evidence and estimated recoverable space. Separate observations
   from explanations: concurrent writes and shared blocks can change free space.
   Read the relevant reference below before proposing its cleanup.
4. Execute only the user's authorized targets. An earlier scoped authorization
   remains valid; do not repeatedly ask. If scope is missing, obtain selection
   before destructive action. Recheck identity, consumers and protection rules
   immediately before acting. Preserve databases, models, user documents,
   unsynced cloud files and active indexes unless specifically selected.
   Use the owning tool's targeted operation; never blanket-delete `~/.cache`.
   Do not bypass a hook, permission denial or Trash policy with a different tool.
5. Compare fresh filesystem and target measurements after cleanup. Distinguish
   logical deletion, guest trim and actual host space reclaimed. Report errors
   and concurrent changes instead of attributing every delta to your actions.

Record decisions, observations and unresolved hypotheses with `jst disk remember
--file NOTE.json` before finishing. The private destination is
`~/.jstack/state/disk-manager/memory.json`, shared by both hosts. Each note needs
`kind`, `scope`, `summary` and `evidence`; cite the user's decision or measured
output. Prior decisions are not permission for new deletions. Keep hypotheses
distinct from observations and use expiry or supersession when facts change.
Never append personal sessions to the packaged SKILL.md or substitute `/tmp` as
the real memory store. A shared jstack parent may be 0755; only this skill's private
state leaf must be 0700. Report a real storage failure without changing global
permissions or silently abandoning persistence.

Use a bounded scan once per relevant path. After a timeout or permission failure,
record it and continue with available evidence; do not launch overlapping broad
fallback scans. Do not finish while a diagnostic job you started is still running:
collect its result or explicitly stop it and report the remaining uncertainty.
Return a short candidate list and the next useful action, not a full inventory
unless requested. Cached and historical values must carry their measurement time.

## Commands and state

`jst disk snapshot` records a bounded configured scan; each category's du is
limited by the profile's `snapshotTimeoutSeconds` (default 300). Every category
it cannot measure is listed under `unmeasured` with its reason, stays unknown,
not zero, and keeps `complete` false. A category du reads only in part is listed
under `partial` with its readable size as a lower bound and also keeps `complete`
false; report it as at least that size, and diff never computes a delta from it.
Snapshot exits 1 for a timeout, a missing category path, du output beyond 64 MiB
(`output-overflow`), another error or a capacity failure. A `permission-denied` category (macOS privacy protection), whole
or partial, alone still allows exit 0; report it and do not bypass the protection.
An entry that vanishes or moves while du walks a category is not a failure: the
total stands, and the method notes that it may undercount. Without a profile file, a default category whose
path does not exist on this machine is listed under `notPresent`, is not measured
and does not fail the run; a missing path in a written profile still fails. Such a
category with earlier samples, such as a cleaned cache, or one named in
`snapshot CATEGORY` is recorded as 0 bytes (`path not present`) instead, so diff
shows the deletion.
`jst disk diff --hours 24` compares it with a real earlier sample; absent
baselines remain unknown, and an imported legacy value appears only as
`legacyBaseline`.
`jst disk history [CATEGORY] --days 14` displays daily latest samples and a chart;
the default is filesystem used space, not a sum of categories. Add `--json` for
machine-readable output. `jst disk config` prints the effective profile and paths.

`jst disk` runs `scripts/main.js` in this installed skill; that file is the
implementation, not a substitute command. Runtime state defaults to `~/.jstack`;
`--root DIR` selects a separate state root. Code never lives in the cache directory.

The private profile is `profiles/disk-manager.json`: categories, filesystem,
protected paths, retention days, schedule interval and snapshot timeout. SQLite
history lives in `state/disk-manager/history.sqlite3`; scan cache is disposable
and separate.
`snapshot` never cleans user files and refuses a concurrent collection. If it
measured but could not record, report the measurements under `unrecorded` in its
error output with their time; they are not in history.
`scan --fresh` bypasses cached output. Use fresh measurements for deletion decisions.

Automatic collection is opt-in: `jst disk schedule enable --cli "$(command -v jst)"`.
The stable CLI path must survive plugin upgrades. Schedule registration is shared
by both hosts, never created once per profile, and never schedules cleanup.
Check `schedule status`; use `schedule disable` to remove only jstack's registration.
See `references/installation.md` for migration, aliases and recovery.

## Conditional references

| Condition | Read |
| --- | --- |
| APFS, iCloud, app data, Trash or large media | `references/macos.md` |
| Docker, Colima, VM disks or volumes | `references/containers.md` |
| Dependencies, model files, package or browser caches | `references/development-caches.md` |
| Scheduling, legacy collector or database detected, shell commands or `jst` missing from PATH | `references/installation.md` |

Personal incident logs and machine-specific keep decisions remain private. Carry
their reusable lessons here only after checking the causal explanation.
