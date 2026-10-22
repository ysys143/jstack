---
allowed-tools: Read, Bash(node:*), AskUserQuestion
---

# /dashboard-repair — check or repair the status line

Check that the effective `statusLine`, the installed shim, and the dashboard build
it resolves agree, and repair only what this plugin owns. A healthy run writes
nothing. Invoking this command is the user's explicit request to repair this config
directory; it does not enable automatic recovery.

## Task

1. Inspect without changing anything. The script reads
   `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json`, host installation metadata
   (the selected profile's installation registry, then a bounded cache scan), the installed shim,
   and the Codex `tui.status_line`, and prints one JSON object:
```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/dashboard/scripts/install-statusline.mjs" status
```

   Read these fields:
   - `healthy`: `true` means stop here and report that nothing needed changing.
   - `owner`: `ours`, `empty`, `known-managed-by-another-tool` (with `identity`),
     or `user`.
   - `causes`: observed cause types with evidence. Report the type and evidence; do
     not guess which external tool or machine caused it. The meaning and recovery of
     each type are in `${CLAUDE_PLUGIN_ROOT}/skills/dashboard/references/recovery.md`.
   - `resolves` and `installation`: the build a render loads and the installed
     package it came from. `null` means no build is installed in this config dir.
   - `optin`: whether automatic recovery is enabled for this config directory.

   To check several Claude homes, pass each one with `--config-dir DIR`. A setting in
   one home does not show that another home is configured.

2. Repair unless step 1 reported `healthy: true`:
```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/dashboard/scripts/install-statusline.mjs" repair
```

   Handle the exit status:
   - `0`: `action` is `repaired` or `unchanged`.
   - `1`: no resolvable build. Tell the user to install or update the jstack plugin in
     this config directory. Do not work around it with a pinned path or a link.
   - `2`: a configuration file could not be parsed or changed during repair. Nothing
     was overwritten; report the error and suggest retrying after the file is fixed.
   - `3`: `action: preserved`. A `user` value is never replaced by repair. For a
     `known-managed-by-another-tool` value, show the command and `identity`, and ask
     whether to allow replacing that identity. Only after the user agrees:
```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/dashboard/scripts/install-statusline.mjs" optin --allow-replace "<identity>"
```
     then rerun `repair`. To replace a `user` value, the user reruns
     `/jstack:dashboard-setup` and agrees to replacement there.

3. Codex keeps its own native status line. Add `--codex` to step 2 only when the user
   asks to restore it. Repair adds `tui.status_line` only when the key is missing,
   inside the existing `[tui]` table or as one new table; it never changes an
   existing layout, including one chosen through Codex `/statusline`. Exit `4` means
   the file layout was not edited automatically; report it without editing by hand.

4. Optional, only when the user asks for it: automatic recovery at session start
   (`optin --auto-repair on`), syncing named restore sources (`optin --sync-glob`),
   or a foreground `watch` between sessions. `recovery.md` describes each setting and
   how to keep a watcher running without an operating-system service.

5. Tell the user:
   - Whether `statusLine.command` changed (`previousCommand` against `command`), or
     was already correct (`action: unchanged`)
   - Which installation and version the shim resolves to, and the backup path, if any
   - That no restart is needed; settings.json changes take effect at the next interaction

## Example Output

```
statusLine already points at the shim; no change needed.
Shim: ~/.claude/plugins/data/<plugin>-<marketplace>/statusline.mjs
Resolves to: jstack@<marketplace> 0.9.7
Automatic recovery: off
```
