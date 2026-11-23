# Linux collection and optional scheduling

`jst disk status` reads filesystem capacity with statfs; it does not walk `/` or
home. Linux defaults select only `uv_cache` and `pip` below an absolute
`XDG_CACHE_HOME` (otherwise `~/.cache`), plus npm's `~/.npm`. They never select
home, `/`, the entire cache root, container volumes, models, system logs or user
documents. Overlapping defaults and aliases resolving to home or `/` are omitted.
Application-specific cache overrides are not auto-discovered: inspect `disk config`
and explicitly configure a selected path when needed. Private jstack profiles,
history and memory stay under `~/.jstack`, shared with existing hosts; `--root DIR`
selects another state root. This preserves the jstack/native plugin state interface.

Choose `jst disk scan CATEGORY --fresh` explicitly. There is no implicit home scan
on Linux. To diagnose another branch, add a narrow absolute category to the
private profile after selecting it with the user. Categories in custom profiles
may overlap; never sum their measurements. `protectedPaths` informs the agent's
cleanup decisions; it does not exclude paths from measurement or impose OS access
controls. Collection never deletes data or asks for sudo.

## Bounds and uncertainty

Linux uses sequential `du -skx -- PATH`: allocated KiB converted to bytes, without
following symlinks or crossing filesystem devices within a walk. Each scan also
skips immediate children on another device. This does not detect every bind mount
on the same device. If present, `/usr/bin/nice -n 10` and `/usr/bin/ionice -c 3`
request modest CPU and idle I/O scheduling priority; no helper is installed.
Unsupported helpers or command errors remain measurement failures; there is no
broad fallback traversal. Locale is forced to C for GNU/BSD diagnostic parsing.
Missing, malformed, overflowing or timed-out totals remain unknown. Permission
failures may retain a labelled lower bound. On Linux, vanished entries also retain
only a lower bound (`partial-vanished`) and prevent diff deltas and `complete`.
Caches that change while du walks them, such as an active npm or uv cache, can
therefore make snapshots exit 1 often; expect frequent failed collector runs.
du runs from the first existing fixed path, `/usr/bin/du` then `/bin/du`, never
from PATH; when neither exists each category fails with an `error` reason. GNU du
prefixes its diagnostics with that path (`/usr/bin/du: ...`), uutils and BSD with
`du: ...`; both forms are parsed, and no other prefix is.
macOS retains its existing vanished-entry note and `du -sk` behavior.
Shared safety changes add strict single-target total parsing, C locale, termination
requests and the overlap lock. The total collection deadline is a Linux default
(120 seconds); on macOS it applies only when the profile sets `runTimeoutSeconds`.
The internal scan function now returns a Promise so it can release that lock
reliably. macOS command names are unchanged, but `scan` output fields, cache schema
and locking changed as listed in the CHANGELOG. Scan cache schema 2 invalidates
older cache entries once to expose streamed enumeration and skipped paths accurately.

Scheduled runs use a fixed systemd `TimeoutStartSec` of 3720 seconds (the 3600-second
profile maximum plus state-write headroom), so a collector blocked in the kernel by
du can hold one timer run for up to about an hour; the total deadline cannot interrupt
a process stuck in uninterruptible I/O.

`scan` and `snapshot` share `snapshot.lock` under the selected jstack state root.
They refuse another live walk instead of queuing expensive work. Scan streams at
most 256 immediate children plus one lookahead; it measures each for at most five
seconds, within a 30-second total collection deadline. `totalChildren` is null
when enumeration is incomplete; `skipped` names enumerated symlinks, other devices
and targets not started before the deadline. `truncated` and `complete` expose
those omissions. An empty sample list with incomplete enumeration is not zero
usage. A cached result retains its capture time, errors and completeness.

Snapshots limit each category by `snapshotTimeoutSeconds` (default 300), capped
by the remaining `runTimeoutSeconds` budget (default 120; valid 1–3600). This total
collection deadline starts before history preflight and is shared across targets;
unstarted targets are recorded as unknown with a timeout reason. The state lock
wait before du is capped by the remaining budget, up to 60 seconds; the wait to
record after du is up to 60 seconds regardless of the budget, so a run whose du
spent the deadline still records its results. When every default category is
absent, a snapshot measures none, records filesystem capacity only and reports
`complete` true with exit 0: nothing failed, but no category was measured. Final history writes,
filesystem metadata operations and kernel I/O can outlast a collection deadline;
the CLI does not promise a hard wall-clock bound for blocked OS calls. Child
timeouts request SIGKILL, without a shell. Deadlines and nice/ionice are bounds and
priority requests, not guarantees of resource utilization or responsiveness.
Narrow the scope after a timeout; do not repeatedly scan broader branches.

## systemd user timer: explicit opt-in only

Inspect `jst disk schedule status`. Without a reachable systemd user manager,
status reports `supported: false`; use manual snapshots. jstack does not install
systemd, enable linger, use cron, or create a root service. Installation never
registers a schedule. Only after the user selects automatic collection, run
`jst disk schedule enable --cli "$(command -v jst)"` with the stable Node CLI
package described in [installation](./installation.md). Native plugin launchers
and versioned cache paths are refused, as on macOS.

The two private units are `jstack-disk-manager.service` and `.timer` under absolute
`XDG_CONFIG_HOME/systemd/user` (otherwise `~/.config/systemd/user`). The timer's
first run is one full interval after activation (`OnActiveSec`), and later runs
wait one interval after the service finishes (`OnUnitInactiveSec`). There is no
boot/startup/calendar trigger, missed-run catch-up, wakeup or immediate snapshot.
Enabling starts only the timer. The unit records the effective XDG cache root,
Node path, CLI path and explicit jstack state root; re-register if Node moves.

The oneshot service uses `TimeoutStartSec=3720s` (the 3600-second maximum
`runTimeoutSeconds` plus 120 seconds for state/SQLite work). It does not depend on
the profile at registration; each run's deadline comes from the profile it reads,
so raising `runTimeoutSeconds` later needs no re-registration. `TimeoutStopSec=5s`, control-group termination, Nice 10, idle
I/O scheduling, CPUWeight 10, CPUQuota 20%, IOWeight 10, MemoryHigh 256M and
MemoryMax 512M. Cgroup controls depend on user-manager delegation, kernel and I/O
scheduler support; inspect the user's manager/journal rather than claiming they
are enforced on every host. Resource termination can leave a recoverable owner
lock and a partial run with no history record. The next collector recovers only a
verified dead local owner. Logs go to the user journal:
`journalctl --user -u jstack-disk-manager.service`.

`jst disk schedule disable` stops jstack's timer and any active collector, disables
only its timer and removes only the marked jstack unit files. History is preserved.
Both timer and service must be in the expected directory without external
fragment paths or drop-in overrides; conflicting units are left for inspection.
After daemon-reload, enable checks that the user manager loaded both units from
the files it just wrote (`FragmentPath`). If not, usually because this shell's
`XDG_CONFIG_HOME` differs from the manager's environment, it removes its files and
stops with that reason. Status reports a masked or broken unit's `LoadState` under
`attention`; enable and disable refuse it. Failed registration rolls back its own
files; it calls `disable` only after an enable was attempted. A failed
rollback retains the files and reports manual recovery information. Unit and
command fixtures do not prove real user-bus registration or cgroup enforcement.

## Reference basis

The implementation was checked once, on a single Linux reference host, against
installed `du(1)`/`nice(1)` (uutils coreutils 0.10.0), `ionice(1)`, and the systemd
259.9 `systemd.timer(5)`, `systemd.service(5)`, `systemd.exec(5)` and
`systemd.resource-control(5)` manuals. That host did not use GNU coreutils. The
systemd tests drive a fake runner, and the Linux-only native tests run only on a
Linux host, so macOS runs skip them. GNU diagnostic forms have fixture coverage;
native tests must identify the actual installed du.

- [GNU du manual](https://www.gnu.org/software/coreutils/manual/html_node/du-invocation.html)
- [systemd timer semantics](https://www.freedesktop.org/software/systemd/man/latest/systemd.timer.html)
- [systemd service timeouts](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html)
- [XDG base directory specification](https://specifications.freedesktop.org/basedir/latest/)
