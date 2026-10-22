---
name: dashboard
description: "Configure the Codex statusline or read token and rate-limit usage. Triggers: 상태줄, 토큰 사용량."
---

# Dashboard — Codex native statusline

Use the Codex CLI's built-in footer. This host-specific entry is selected by
the package builder for Codex; Claude Code receives its own dashboard entry.
The native footer selects and orders built-in items. It does not accept the
Claude dashboard's external command renderer or its widget configuration.

## Configure the current runtime

Treat a direct invocation of this skill as a request to configure the dashboard.
Inspect the installed Codex version and the active configuration before editing.
Resolve the user configuration from `$CODEX_HOME/config.toml` when CODEX_HOME is
set, otherwise `~/.codex/config.toml`. Respect any active profile or higher-priority
configuration override; do not assume that writing the base file changes the
effective configuration. Read only relevant settings and do not print credentials.

If the user specifies a layout, apply that layout using item identifiers supported
by the installed version. Otherwise preserve an existing `tui.status_line` layout
and report its items. When no layout exists, configure this small default:

```toml
[tui]
status_line = ["model", "context-remaining", "git-branch"]
```

Back up an existing configuration before writing. Merge only `tui.status_line`,
preserve other settings and comments, and never append a duplicate `[tui]` table.
Validate the resulting TOML and reread the saved value. Do not replace a
user-selected layout merely because it differs from the default. A saved value
proves configuration only; do not claim that the current footer has rendered it.

For interactive selection or immediate application in the running CLI, tell the
user to enter the native `/statusline` command. Its picker toggles and reorders
model/reasoning, context, limits, Git, token and session items, then persists the
choice to `tui.status_line`. This is a Codex UI command, not a shell command or a
jstack slash command; do not try to execute it through a terminal tool. Use the
installed picker or version-matched documentation to resolve additional item IDs
instead of inventing IDs or borrowing Claude widget names.

If this session runs in a Codex desktop app, IDE extension, or noninteractive
host, explain that this footer belongs to the terminal CLI. Do not promise a
statusline in that surface or edit a different CLI profile without a request.

## Read usage accurately

Use available live runtime evidence for context and usage questions. The native
`/status` command shows session status; `/statusline` can expose supported limit
and token fields. If these values are unavailable to the agent, explain how the
user can view them rather than fabricate numbers. Label remaining versus used
capacity, the limit window, reset time and observation time when available.
Token counters are not a dollar bill: do not infer subscription spending or
remaining paid allowance from tokens alone. Missing limits are unknown, not zero.

## Host and ownership boundaries

Do not run the Claude statusline installer, dashboard-setup, dashboard-repair,
or SessionStart hook. Do not write `~/.claude/settings.json` or
`~/.claude/claude-dashboard.local.json`, and do not require
`JSTACK_DASHBOARD_STATUSLINE=1` for the Codex footer. Claude display modes and the
vendored dashboard's emoji-free widget recipes do not configure Codex.
If emoji-free output is requested, use native textual fields and verify the
actual display when possible; do not claim an unobserved rendering was measured.

CLI usage, context and rate limits belong to dashboard. Google Workspace OAuth
token expiry belongs to workspace. Installing this skill does not grant hook
trust, execute hooks, or prove that any user setting has changed.

Official references: https://developers.openai.com/codex/cli/slash-commands and
https://developers.openai.com/codex/config-reference. Prefer installed-version
evidence when it differs from the current documentation.
