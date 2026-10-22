# Claude project rename

Resolve old/new absolute project paths and the user's target profile. Renaming the
filesystem directory and repairing history are separate operations. Do not move the
current process's working directory or rename a remote repository as a side effect.

Use [Claude migration](claude-migration.md) with explicit `--old-project` and `--project`.
The engine handles native cwd metadata and project-directory bindings while preserving
historical messages and commands. Never use global sed, regular-expression replacement
or concatenation through JSONL. Inspect session IDs and native metadata instead of
assuming a slug transformation, file count or modification time proves completeness.

Back up via the plan/apply receipt, stop destination writers and verify the migration.
File conflicts or malformed records remain unresolved; keeping both bytes does not
prove both histories appear in `/resume`. Preserve the original source and receipt.

## Plugin-owned bindings

If resume loads but a plugin blocks the new path, identify the implicated plugin and
its documented state file under the target profile. For worktree state use the actual
Git directory reported by `git rev-parse --git-dir`, not an assumed `.git/` directory.
Use literal path matching to locate candidates; a historical mention is not a binding.
Update only a documented field using a format-aware parser and a private byte backup.
Stop concurrent writers, preserve unknown fields and recheck the input before atomic
replacement. Unknown formats stay unresolved. Never recursively substitute through
plugin caches, Git objects, credentials or conversation text.

Report migration and plugin repair separately. A passing receipt verifies stored data;
confirm resume discovery and the plugin's behavior in the target host independently.
