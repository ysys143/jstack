# /gws — enter Workspace tasks

## Fix the task profile first

Run `node "${CLAUDE_PLUGIN_ROOT}/runtime/profiles.js" load --profile <selected-name>`
Read the settings. Omit `--profile` for the default profile. If the profile is
missing, configure it with `/init` or `/setup-workspace` rather than substituting
another account. Actual IDs live in local `~/.jstack/profiles/<name>/workspace.json`;
the reporting file is canonical for subjects and columns. Pin the starting profile
and revision in a private snapshot and reverify the account with
`verify-account --snapshot <snapshot>` before any remote write.

## Check prerequisites first

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/workspace/scripts/ensure_gws.js"
```

- exit 0 — `gws` and account settings are available
- exit 1 — `gws` exists but is **unauthenticated** → `/setup-workspace`
- exit 2 — `gws` is missing → `brew install googleworkspace-cli`

**Check the package name when installing.** Homebrew also has an unrelated git
tool named `gws`; this plugin requires `googleworkspace-cli`.

## Always select the account

```bash
GOOGLE_WORKSPACE_CLI_CONFIG_DIR="<snapshot-configDir>" gws <command>
```

`gws` stores **one account per config directory**. Without this environment
variable, the default config is used; if it belongs to a personal account, a
company task can access documents with the wrong identity.

## Before every write

**Reread the target sheet's name column and verify the subject. Stop immediately
if it differs.**

Row numbers drift for two reasons: calculating a tab name by weekday weeks from
the start of the month can differ from reality (2026-08-27 → calculated `August
week 5` / actual `August week 4`), and row spacing **depends on team size**. Query
the actual tab list through the API and locate the target row by reading it.

**Reads are reversible; overwriting someone else's record is not.**

## Common tasks

| Task | Where to look |
|---|---|
| Weekly report | `workspace` Phases 3–4. Show the draft and obtain approval first |
| Daily Scrum record | `skills/workspace/references/scrum-cells.md` — row and tab rules |
| Drive folder IDs | `~/.jstack/profiles/<name>/workspace.json` is **canonical**; `gdrive-ids.md` documents only fields and discovery |
| Sheets API pitfalls | `skills/workspace/references/sheets-troubleshooting.md` |

The `workspace` skill contains the detailed procedure. This command handles
**entry and safety checks**.
