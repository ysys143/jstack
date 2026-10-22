# Disk-manager context repair (2026-09-15)

## Evidence and limits

The supplied plugin transcript lost persistent history after rejecting a shared
0755 jstack directory. It fell back to temporary state, repeated broad inspection,
and finished while one diagnostic job was still running. The personal skill
reused previous keep decisions and recurring storage observations, but mixed
those with unverified causal explanations and unsafe cleanup shortcuts.

Wall-clock times are not comparable: the personal transcript includes selected
cleanup operations, while the plugin transcript largely contains diagnosis.
This change repairs observable failure paths; it does not establish a model-wide
speedup. No new model inference evaluation was run.

## Implemented contract

- Shared jstack parent directories may remain owned 0755 directories. Private
  disk-manager state, cache and logs use 0700 leaves and 0600 files. Reject shared
  writable or symlinked state directories; never chmod unrelated jstack state.
- `disk context` starts with private decisions and recent observations, then the
  latest per-category SQLite measurements. With no new history DB, it reads the
  legacy database in place. It neither migrates history nor launches a scan.
- `disk remember --file NOTE.json` stores provenance-bearing decisions,
  observations, hypotheses and lessons in `state/disk-manager/memory.json`.
  Expiry and explicit supersession retain provenance without silently rewriting
  old decisions. This state is shared between hosts and outside installed code.
- Diagnosis inspects the relevant branch first. Directory scans have a 30-second
  measurement budget and five-second child timeouts; selected-category snapshots
  avoid a full initial collection. Errors remain unknown measurements.
- Past permission does not authorize a new deletion. Broad overlapping fallback
  scans and abandoned background diagnostics are explicitly prohibited.

Four selected private notes were recovered from the preserved personal skill:
one keep decision and three observations. Unsupported causal claims and old
cleanup authorizations were not promoted into current instructions. The original
backup, database and scheduler remain in place. Personal contents are not shipped.

## Verification

Tested package input SHA-256:
`1e8c3544f0010e48f63718d8f538597c5fcd5a58613b78471c7359f5e1689551`.

- Catalog tests: 5 passed, including portable native author compatibility.
- Disk owning suite: 14/14 passed, no leaked fixture resources; its child tests
  cover memory recovery across CLI processes, 0755 parents, permission rejection,
  supersession, and byte-preserving legacy reads.
- Both native host discovery probes passed: 29 skill entries, including the
  short `author` compatibility entry for the canonical `skill-creator` workflow.
- Real-home context loaded four notes and nine legacy categories in 0.051 seconds.
  The legacy DB hash was unchanged; root remained 0755 and memory was 0600.
  This measures context loading only, not the entire diagnostic workflow.
- Package privacy check passed. Description cost 5,764 / 7,566 estimated tokens;
  package size 72,394,509 / 83,886,080 bytes.

The full Node run initially reported 317 passes, two workflow subprocess timeout
failures and 39 skips. The isolated workflow retry passed all five tests
without changing production or test code (97.49 seconds). Both runs are retained
alongside the build logs. The unrelated missing frozen-reference Git object still prevents claiming
an unrestricted complete release validation. Host discovery does not prove model
behavior or hook trust.

## Mole assessment

[Mole](https://github.com/tw93/mole) is a useful potential external macOS adapter,
not a replacement for jstack's durable decisions and time-series storage history.
Its documented `mo analyze --json` and `mo status --json` can provide structured
inspection; cleanup history records operations rather than the same numeric
history contract. An interactive analysis screen must not be assumed read-only
because it also offers file removal.

Prefer an explicitly selected, version/capability-checked external executable.
Before any cleanup adapter, map dry-run output to exact authorized targets and
preserve consumer checks. Do not install Mole or execute cleanup automatically.

The [GPLv3 license](https://github.com/tw93/mole/blob/main/LICENSE) adds distribution
and source obligations if its implementation is bundled. Separate aggregation
does not automatically relicense jstack; the decision still requires an explicit
redistribution design. No Mole implementation or binary is bundled in this change.

## Activation

Version 0.9.3-staging was installed through the jstack CLI into seven existing jstack
homes (five Claude profiles, one `.agents` home and one Codex home). All seven
installed package checks matched the tested source hash.
Claude and Codex installed disk CLIs recovered the same four private note IDs.
Restart existing host sessions to refresh discovery; hook trust remains unverified.

Profile registries and settings were backed up before installation. Existing
settings and the Git index were preserved. One additional Codex project trust
entry appeared during the operation; it was retained rather than rolling back
an unrelated addition. No disk cleanup, legacy collector migration, or Mole
installation was performed. Changes remain uncommitted.
