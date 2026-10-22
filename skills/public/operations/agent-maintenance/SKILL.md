---
name: agent-maintenance
description: "Repair Claude or Codex profiles, sessions, project paths, stale plugin entries. Triggers: 세션 이관."
---

# Agent maintenance

Resolve the affected host, exact profile and project from the request and launcher
configuration. The executing harness does not select the storage format: Claude
can maintain Codex data and Codex can maintain Claude data. Do not choose a profile
by newest activity or assume numbered homes, personal aliases or shell helpers exist.

## Select one branch

| Request | Load only this procedure | Existing Claude command |
|---|---|---|
| Select a project's host profile | [Profile markers](references/profile.md) | `/claude-profile` |
| Consolidate Claude project history | [Claude migration](references/claude-migration.md) | `/migrate-project-sessions` |
| Consolidate Codex project history | [Codex migration](references/codex-migration.md) | `/codex-migrate-project-sessions` |
| Repair a renamed Claude project | [Project rename](references/project-rename.md) | `/claude-project-rename` |
| Diagnose stale Claude plugin enablement | [Plugin cleanup](references/plugin-cleanup.md) | `/claude-plugin-ghost-entry-cleanup` |

Claude command adapters preserve arguments and load this contract plus one branch.

## Compatibility command arguments

Accept the following legacy names as the first argument to this skill, optionally
prefixed with `/` or `$`. Use the command-to-procedure table above to select exactly
one branch, and preserve all remaining arguments as user input:

- `claude-profile`
- `migrate-project-sessions` (Claude history)
- `codex-migrate-project-sessions` (Codex history)
- `claude-project-rename`
- `claude-plugin-ghost-entry-cleanup`

For example, `$agent-maintenance claude-profile ...` or
`$jstack:agent-maintenance codex-migrate-project-sessions ...` selects that procedure.
Without a command argument, infer the operation from the request. An unknown command
must not trigger a mutation; resolve the intended operation first. These are argument
aliases within this skill, not separately registered top-level Codex commands.
Do not recreate profile-local skill adapters for these names.
Do not create five extra skills to preserve those command names; this hierarchical
skill owns their shared policy and dispatches to one procedure.

## Mutation contract

Separate observed facts, proposed changes and applied results. Back up affected bytes
under a private directory outside the repository; never package user profiles,
credentials or conversation data. Preserve unrelated settings, staging and history.
Existing authorization applies to the exact requested operation; request only missing
information that changes its target or scope. Discovery is not permission to change
all profiles. A missing parser, script or schema is an unresolved dependency.

The `recall` skill owns historical search and the migration execution engine; this
skill owns the maintenance decision and target selection.

Session migration uses the existing [recall migration engine](../recall/references/session-migration.md)
for both hosts. Plan, review, apply, verify; retain the recovery receipt and original
sources. Stop affected destination writers before applying. Never globally substitute
paths in JSONL, concatenate divergent histories, or overwrite a database wholesale.
A preserved conflict copy is evidence, not a resumable new conversation.

Report target profile, changed objects, preserved sources/conflicts, backup or receipt
path and verification limits. Filesystem verification is separate from the actual
host's resume list or plugin manager. Do not claim live host behavior from a static
check. Ordinary recall searches must not mutate native stores; migration does not
implicitly install the export pipeline, authenticate, or change the current project.
