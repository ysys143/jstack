# Native session migration

Use this mode when the user asks to move session history after a project rename,
a profile change, or a deleted working directory. It changes native host storage;
it does not export memory or infer the current task's completion state.

The executing harness does not select the storage format. Claude Code can migrate
Codex history and Codex can migrate Claude history using the same installed CLI.

## Scope and plan

Resolve the current project root first. Never delete, rename, or recreate the
current session's working directory as part of history migration. The old project
path may be absent; the new project directory must exist.

Ask for the destination only if existing instructions do not determine it. Use
explicit source profiles. Never glob every user profile into a migration: test and
verification profiles contain synthetic sessions that are not user history.
A plan can include multiple `--source-data-dir` arguments. There is no default
profile, no profile selection by modification time, and no automatic source removal.

The migration CLI requires Node.js 20 or later.
Run from any working directory using the installed script path:

```bash
node "${JSTACK_PLUGIN_ROOT}/skills/recall/scripts/migrate_sessions.js" plan \
  --host codex \
  --source-data-dir /absolute/source-profile \
  --data-dir /absolute/destination-profile \
  --old-project /absolute/old-project \
  --project /absolute/current-project \
  --output /private/migration-plan.json
```

Use `--host claude` for Claude project directories. A profile is a host data
root, not its sessions or projects subdirectory. Both the selected old path and
the current project path are included when consolidating profiles.

`plan` changes no profile data. Its output records the exact source and target
hashes and selected database rows, including paginated conversation history.
Store plans and receipts outside the project repository: they can contain full
private conversation content. The output file
must be new. Review the selected profiles, project paths, and file counts before
applying. Existing authorization to migrate those exact profiles is sufficient.

## Apply and verify

```bash
node "${JSTACK_PLUGIN_ROOT}/skills/recall/scripts/migrate_sessions.js" apply \
  /private/migration-plan.json --receipt /private/new-migration-receipt
node "${JSTACK_PLUGIN_ROOT}/skills/recall/scripts/migrate_sessions.js" verify \
  /private/new-migration-receipt
```

Apply rechecks the plan, backs up changed destination files, and records a recovery
journal before modifying native storage. Existing destination rollouts must have
no active writer; replacing them requires `lsof`. Close affected sessions first.
Sources are retained. For an in-place path change, the receipt preserves the
original destination bytes instead of pretending the original file is untouched.

A live source copied into another profile remains a snapshot. New conversation
records continue in the original profile. If it changes after planning, make a
new plan; do not silently accept the change or repeatedly overwrite a live target.

| Object | Merge rule |
|---|---|
| Transcript | Compare complete JSON records; accept identical records or a strict prefix extension |
| Divergent same-ID history | Stop and preserve both versions |
| Ancillary files | Copy missing files; accept identical files; stop on conflicts |
| Codex identity | Prefer the rollout's own `id`; retain parent `session_id` and spawn edges |
| Working directory | Rewrite exact native metadata `cwd` matches; preserve message bodies and historical commands |
| Codex index | Append selected entries; do not rebuild unrelated index rows |
| Codex database | Validate compatible schemas and update only selected threads and dependent rows in a transaction |
| Codex paginated history | Migrate the selected turns, items, projection state, and realtime items from the separate history database |
| History byte offsets | Remap rollout cursors and turn boundaries after metadata rewrites; preserve ordinals and message bodies |

Codex requires initialized state and history databases in both profiles, with
matching versions and column layouts. Missing metadata, multiple databases for
either role, incompatible history schemas, and misaligned rollout cursors stop
before mutation. Do not copy an entire database over the destination or fabricate
missing metadata. Cross-profile imports clear source-local project and sidebar
associations; existing destination associations and subagent source types survive.
State and history writes share an attached-database transaction. The receipt can
restore their selected rows without replacing unrelated conversations.

Verification compares migrated files, metadata, directory bindings, and index
entries. Separately check the actual host's session list before claiming discovery
works. Listing is not a model invocation and does not prove every resume behavior.
Report native and exported histories separately; this mode does not update the
recall export corpus or its SQLite index.

## Recovery

```bash
node "${JSTACK_PLUGIN_ROOT}/skills/recall/scripts/migrate_sessions.js" rollback \
  /private/new-migration-receipt
```

A failure may leave an interrupted receipt because files, index, and SQLite are
separate storage systems. Keep that receipt and run rollback after stopping target
writers. Rollback checks every affected object before restoring anything. It
refuses to overwrite later changes to migrated sessions and preserves unrelated
threads and index entries. Do not blindly restore a whole profile backup.

Report the destination, imported session/file counts, verification results, receipt
path, and whether any active source can continue receiving records. A successful
copy alone is not a successful migration.
