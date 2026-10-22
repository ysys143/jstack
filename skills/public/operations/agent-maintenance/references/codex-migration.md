# Codex project migration

Codex migration includes rollout files, selected index entries and state/history
database rows. Both profiles need compatible initialized schemas; copying JSONL alone
does not establish resume discovery. Preserve subagent identity and parent edges.

Use the [shared engine contract](../../recall/references/session-migration.md).
Resolve explicit source profiles and destination from the user request; do not scan
all profiles into an implicit import. The new project directory must exist; the old
path may be absent. Never recreate or rename the running session's working directory.

```bash
node "${JSTACK_PLUGIN_ROOT}/skills/recall/scripts/migrate_sessions.js" plan \
  --host codex \
  --source-data-dir /absolute/source-profile \
  --data-dir /absolute/destination-profile \
  --old-project /absolute/old-project \
  --project /absolute/current-project \
  --output /private/new-migration-plan.json
```

Omit `--old-project` when consolidating the same project path. Repeat only explicitly
selected `--source-data-dir` values. Review source/target hashes, selected objects and
conflicts before applying. Keep plans private because they may contain conversation data.

```bash
node "${JSTACK_PLUGIN_ROOT}/skills/recall/scripts/migrate_sessions.js" apply \
  /private/new-migration-plan.json --receipt /private/new-migration-receipt
node "${JSTACK_PLUGIN_ROOT}/skills/recall/scripts/migrate_sessions.js" verify \
  /private/new-migration-receipt
```

Stop destination writers first; required writer checks and schema checks must pass.
Changed input requires a new plan. Sources remain intact. Divergent same-ID histories
stop migration; preserve each original and optionally keep a separate postfix evidence
copy outside active stores. Do not relabel its internal ID or claim that it is resumable.
The packaged engine does not implement the personal Python helper's `--conflict-dir`.

On failure retain the receipt and follow its checked rollback procedure. Do not restore
whole homes over newer data. Verify the target host's session list separately and report
unresolved conflicts or discovery limits. This command does not set up memory exports.
