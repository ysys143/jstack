# Installation, state and compatibility

jstack installs this as one public native skill in both hosts. The jstack CLI owns
`jst disk`; the packaged `scripts/main.js` is its implementation, not a substitute
command. Personal shell files, SQLite databases and incident logs are never package inputs.

## CLI on PATH

A native plugin installation (the marketplace route) ships a small launcher for
the packaged CLI at `payload/bin/jst`; it has no top-level `bin/`, which claude.ai
and Cowork refuse. In Claude Code, a jstack SessionStart hook adds `payload/bin` to
the Bash tool's PATH for each session through `CLAUDE_ENV_FILE`, after the user's
own entries, in sessions started after jstack is enabled; hooks and MCP servers do
not get it, and claude.ai and Cowork have no `jst` command. In Codex, a
jstack SessionStart hook links `~/.local/bin/jst` to the launcher once the user
trusts the hook in `/hooks`, and `~/.local/bin` must be on PATH.
`JSTACK_NO_PATH_LINK=1` turns both hooks off. On Windows, Claude Code's Bash tool
runs in Git Bash, which runs the launcher; the Codex hook does nothing on Windows,
so Codex there needs the CLI package. The CLI package from the same release
(README section "Alternative: manage installation with the jstack CLI", its
`npm install -g` step on the release tarball) still works and
takes precedence when it is on PATH: the Codex hook then neither creates nor
refreshes its link and removes a `~/.local/bin/jst` that is a link into a jstack
plugin cache, its own or one made by hand. Verify with `command -v jst` and `jst --version`;
the jstack doctor reports `jstack missing` until one route works. A missing `jstack` is an
installation fault to report, not to route around: never create a shell wrapper
or alias of your own, and never persist a Node invocation of a plugin path. The
only link to the launcher is the one the Codex hook makes or the user approves.
[jst command on PATH](../../../runtime/CLI-PATH.md) lists the causes and the fixes
to propose.

For scheduling, pass `--cli "$(command -v jst)"`. The npm global bin entry links
to the package's Node entrypoint and keeps its path across CLI upgrades. A shell
wrapper, a `plugins/cache` path or a versioned host cache path is not a stable CLI.
The plugin launcher is such a wrapper in a versioned plugin folder, so scheduling
needs the CLI package; `schedule enable` refuses the plugin launcher, cached or
loaded in place, and any other script whose shebang is not node.

State is shared across hosts under `~/.jstack` (or explicit `--root DIR`):

- `state/disk-manager/memory.json`: private task memory, separate from the numeric
  SQLite series. `context` reads active decisions and recent observations,
  hypotheses and lessons. `remember --file NOTE.json` appends kind, scope, summary
  and evidence, with optional expiresAt or supersedes. Do not put sessions into
  installed SKILL.md or temporary roots. Cite actual user instructions or measured
  output; old decisions are not blanket deletion permission.

- `profiles/disk-manager.json`: optional JSON profile. Run `jst disk config` to
  inspect defaults; create the profile with private permissions only when needed.
  Use absolute category paths, protectedPaths, filesystem, retentionDays,
  intervalSeconds and snapshotTimeoutSeconds (per-category du limit for
  snapshot, 1 to 3600, default 300); unknown fields are rejected. Older profiles
  without snapshotTimeoutSeconds stay valid. Without this file, snapshot lists
  default categories absent from the machine under `notPresent` instead of
  failing, or records one with earlier samples or named explicitly as 0 bytes;
  a written profile's missing category fails the run. Protected paths are reported to
  the agent's cleanup workflow; they are not an OS access control mechanism.
- `state/disk-manager/history.sqlite3`: persistent measurements and filesystem
  capacity. Errors retain null sizes. A failed scan does not become zero usage.
- `cache/disk-manager/`: timestamped directory scans. Reading a cache reports
  whether it is stale. Explicit `--fresh` replaces it after measuring; no hidden
  background scan is started by reading a cache.
  Scans have a 30-second total measurement budget and a five-second per-child
  timeout. They examine at most 256 immediate children and do not follow child symlinks;
  `truncated`, `scannedChildren` and `totalChildren` expose omissions. Narrow the
  selected directory when truncated; do not claim the largest files were found
  across an incompletely scanned directory.
- `logs/disk-manager/collector.log`: scheduler diagnostics. Treat these as private.

The DB and code survive cache deletion. Snapshots prune only their own history
older than retentionDays (default 90), never filesystem content. Repeated snapshot
timestamps or locks fail instead of silently replacing another collection. A
running snapshot holds `snapshot.lock` while du runs, up to snapshotTimeoutSeconds
per category; it refuses only another snapshot. The state lock `collection.lock`
guards writes: `remember`, import and schedule changes take it briefly. A
snapshot takes it before du to check the history and after du to record, and
waits up to a minute only while a running process on this machine holds it. A
lock whose recorded owner on this machine has exited, such as a collector killed
at logout, is recovered by the next command. A live owner, another host or an
owner that cannot be verified keeps the lock, and a snapshot then fails before
du: inspect the lock's `owner.json` under `state/disk-manager/` and confirm the
collector is gone before removing that lock. If recording still fails after du,
the error output carries the measurements under `unrecorded`. A history chart
uses UTC daily latest samples and GiB and marks a lower bound with `>=`;
filesystem totals never add overlapping category measurements.

## Import an existing installation

Start with `jst disk context`: it can read the existing `~/.disk_cache/disk_history.db`
in place when the new DB is absent, without forcing an import or a fresh scan.
`context` reports a legacy database or launchd collector under `migration`, and
`schedule status` lists `legacyCollectors`; either one is a lead to propose the
steps below to the user, not permission to run them. `diff` and `history` read
only the new DB and name a legacy database that it has not imported. A jstack
history created by earlier snapshots does not hide an unimported legacy database.
Shared jstack parent directories may remain 0755; only disk-manager's private leaf
and files require 0700/0600. Never chmod the shared home or switch to temporary
state as a workaround. Retain personal decisions in memory.json before moving
or removing a legacy skill; preserve the original as evidence.

1. Back up the original skill, external shell utility, refresh script, scheduler
   plist and SQLite database using a consistent SQLite backup while writers run,
   or after stopping the known writer. Preserve personal keep decisions separately.
2. Run `jst disk import-legacy --source /absolute/backup/disk_history.db`.
   The source opens read-only. Supported tables are snapshots and disk_free;
   integer MiB values become bytes. Unknown schemas fail. A jstack history that
   snapshots created before the import receives it in one transaction; a sample
   at the same time and category as an existing one aborts the import unchanged.
   The import is recorded in the history, so a second import is refused. A
   history imported by an earlier release receives that record the next time
   jstack writes it, before retention prunes the imported rows.
   Legacy paths were not stored, so imported category paths remain unknown;
   a new path is not compared against an assumed historical identity. `diff`
   shows the latest earlier imported value of a category as `legacyBaseline`
   beside the current one, never as a delta.
3. Compare historical values and take a new snapshot before switching scheduling.
   A new DB import does not silently remove old samples based on today's retention.
4. Back up and explicitly disable the original launchd collector, then run
   `jst disk schedule enable --cli "$(command -v jst)"` (see CLI on PATH). A
   detected legacy refresh job blocks duplicate registration. jstack never disables
   it automatically.
   The CLI must be a Node jstack entrypoint; do not pass a shell wrapper or plugin
   cache path. The plist records Node's absolute path; re-register if Node moves.
   Under launchd, macOS privacy protection can deny du access to folders such as
   Movies, Pictures or parts of Library. A wholly unreadable category is listed
   as `permission-denied` under `unmeasured` with unknown size. A category with
   some unreadable entries, such as the Library caches or home, is listed under
   `partial` with its readable size as a lower bound, recorded with a
   `partial-permission-denied` error and excluded from diff deltas. If du also
   reports another error there, the category is unmeasured as `error` instead.
   Snapshot exits 0 if nothing else failed. Granting Full Disk Access to that Node binary
   is the user's decision in System Settings; jstack never requests or escalates it.
5. Verify `schedule status` and its next collection. On failure disable jstack's job
   and restore the previous scheduler; keep both old data and the new DB for review.

No schedule is enabled by plugin installation. One user-level launchd label serves
both hosts. The registration calls a stable CLI location rather than a versioned
plugin payload. Removal preserves history; a failed bootstrap removes only the
new plist. Collection does not invoke cleanup or install external dependencies.

## Shell compatibility

`templates/aliases.zsh` is an optional, explicitly sourced set of functions that
calls the jstack CLI. Preserve and remove conflicting old aliases before sourcing;
never append a second implementation or overwrite a user's shell automatically.

| Previous surface | Packaged replacement |
| --- | --- |
| disks numbered TUI | status plus structured scan; skill conversation selects the next scope |
| dh/dgh/dicl/das/dlc/dct/dl/dd/dm/dss | selected category scans; no whole-home implicit recursion |
| dcol/dol | allocated directory scan; use Docker/Ollama native inspection per references |
| ddt/dml | individual development/model categories |
| dref | fresh home scan; does not erase history or executable scripts |
| dsnap/ddiff/dhist | snapshot/diff/history with SQLite and chart output |
| dcache/dnpm | candidate inspection; destructive blanket helpers intentionally removed |
| stale-while-revalidate | explicit timestamp/stale flag and fresh scan, no untracked background writer |
| six-hour launchd refresh | opt-in shared collector, interval configured in private profile |

These preserve task coverage, not byte-for-byte TUI output. Cleanup remains
available through the skill's selected-target workflow using the owning tool.
