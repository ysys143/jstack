# /setup-recall — complete the missing producer wiring

The `recall` skill contains only the **consumer side** of the session-log
indexing pipeline. Producer source already exists under `skills/recall/bin/`,
but this command builds it, connects it to the `SessionEnd` hook, and points qmd
at the collection the `recall` skill searches. Until this command runs,
that collection is empty and every `recall` query returns
an empty result.

## Do not install external tools

Follow the `bridge` skill contract: 0=complete, 1=partial (reduced path), and
2=blocked. In every state, **print external installation commands without
running them**. Installing global packages on the user's machine is outside this
command's scope. The sole exception is compiling the vendored Rust source under
`skills/recall/bin/` with `cargo build --release`. This turns plugin source into
an artifact rather than installing an external tool, so run it after user
confirmation.

## Sequence

### 1. Probe tools

```
command -v qmd
command -v sqlite3
```

| Tool | Capability lost when absent | State |
|---|---|---|
| `qmd` | No corpus-search (full-text search) store is created | 1 |
| `sqlite3` (CLI) | The shell command used by `recall` for structured queries is unavailable, so the `SKILL.md` query examples cannot run | 1 |
| Both | Synchronization works, but nothing can be queried yet | 1 (continue because adding tools later is cheaper than losing data now) |

Upstream `session-search` stopped here when qmd was absent. This tree follows
the three `bridge` states and continues because either remaining half still
works. `skills/recall/SKILL.md` itself says that an empty result does not prove
the tool is uninstalled, so continuing while reporting partial loss matches
that design. **Only failure to obtain the binary in Step 4 is blocking**, because
without it no data is recorded.

Explain these commands for missing tools and continue without running them:

```
npm install -g @tobilu/qmd   # Requires Node.js 22+
brew install sqlite3         # macOS
apt install sqlite3          # Linux
```

### 2. Choose the session storage path

```
echo "${CLAUDE_SESSIONS_PATH:-}"
```

Use the configured path when present, otherwise default to
`~/Documents/Obsidian/claude-code-sessions`. Create the directory if necessary:

```
SESSIONS_PATH="${CLAUDE_SESSIONS_PATH:-$HOME/Documents/Obsidian/claude-code-sessions}"
mkdir -p "$SESSIONS_PATH/sessions"
```

Show the current path and ask whether to change it (AskUserQuestion; Enter keeps
the current path). This follows upstream because the decision does not vary by tree.

### 3. Obtain the synchronization binary

**An absolute path is required** because the binary later runs at `SessionEnd`,
independent of Claude's current working directory. A relative path such as
`scripts/doctor.js` is therefore unsafe here.

```
${CLAUDE_PLUGIN_ROOT}/skills/recall/bin/target/release/sync
```

- **When `${CLAUDE_PLUGIN_ROOT}` is set**, use it to construct the absolute path.
  This repository has repeatedly removed hard-coded `~/.claude/plugins` paths;
  this variable is their replacement.
- **When it is absent, locate a marker without guessing.** Follow the convention
  already used by `skills/author/scripts/register_local.js`: set the configuration
  root with `CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"`, then search beneath
  `plugins/` for a `skills/recall/bin/Cargo.toml` whose `package.name` is
  `sync-sessions-to-obsidian`:
  ```
  CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
  find "$CLAUDE_DIR/plugins" -path "*/skills/recall/bin/Cargo.toml" 2>/dev/null
  ```
  Use its `bin/` directory only when exactly one result exists. **Stop on zero or
  multiple candidates** rather than continuing without a definite target:
  > `CLAUDE_PLUGIN_ROOT` is unset and the candidates cannot be narrowed to one.
  > Provide this plugin's actual installation path or set `CLAUDE_PLUGIN_ROOT`,
  > then run the command again.

Use an existing binary at that path. Otherwise ask:

> **The synchronization binary has not been built.**
>
> Build it now from the Rust source vendored under `skills/recall/bin/`?
> Enter `build` or provide the absolute path to an existing binary.

For a `build` response:
- If `command -v cargo` fails, **stop here** and only show
  `curl https://sh.rustup.rs -sSf | sh`. This is state 2 because a required tool is absent.
- Otherwise run `cargo build --release` in `.../skills/recall/bin`.

After building or locating it, verify that it is executable:

```
test -x "$SYNC_BINARY" && echo OK
```

Upstream tried `--help` here and, if it failed, ran the binary again to inspect
its first three lines. This binary accepts no arguments and immediately performs
a real synchronization (`main.rs:548-`; there is no `--help` branch). That test
would run synchronization once before the intended initial run in Step 8.
Therefore, check only the executable bit here and verify execution through the
single initial synchronization in Step 8.

### 4. Wire the qmd collection when qmd is available

If qmd was absent in Step 1, skip this step and record `corpus search: qmd
absent` in the summary.

```
cat ~/.config/qmd/index.yml 2>/dev/null || echo MISSING
```

Add the `claude-sessions` collection if it is absent:

```yaml
collections:
  claude-sessions:
    path: <SESSIONS_PATH>/sessions
    pattern: "**/*.md"
    context:
      "/": "Claude Code session logs - conversations, tool calls, and outputs from past coding sessions"
```

Read the file first and **merge without deleting other collections**. Create a
new file only when none exists.

### 5. Wire the `SessionEnd` hook

Read `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json`. This differs from
`~/.claude/plugins`: it is the user's global configuration, and this repository's
`hooks/hooks.json` already updates it through `register_local.sh`. Follow the same
convention: read first, preserve existing entries, and add only missing ones.

Skip the change when `hooks.SessionEnd[0].hooks` already contains this binary
path. Otherwise add:

```json
{
  "type": "command",
  "command": "<absolute SYNC_BINARY path>",
  "async": true,
  "timeout": 120
}
```

If qmd was found in Step 1, also add:

```json
{
  "type": "command",
  "command": "qmd update",
  "async": true,
  "timeout": 120
}
```

Upstream used `nohup ... &` to prevent hook cancellation. Use `async: true`
instead, expressing the same intent with a native harness field rather than a
shell trick. This plugin's `Stop` hook in `hooks/hooks.json` already uses it.

### 6. Save `CLAUDE_SESSIONS_PATH` only for a non-default path

If the user selected a non-default path in Step 2, add
`"CLAUDE_SESSIONS_PATH": "<SESSIONS_PATH>"` to `env` in the same `settings.json`.
Write nothing for the default path; persisting an unused value leaves later
maintainers to reconstruct why it exists.

### 7. Initial synchronization

```
CLAUDE_SESSIONS_PATH="$SESSIONS_PATH" "$SYNC_BINARY"
command -v qmd >/dev/null 2>&1 && qmd update
```

### 8. Verify

Only when sqlite3 was found in Step 1:

```
sqlite3 "$SESSIONS_PATH/.metadata.db" \
  "SELECT session_datetime, project, summary FROM sessions WHERE session_datetime <> '' ORDER BY session_datetime DESC LIMIT 5;"
```

Returned rows prove that the pipeline writes data. If sqlite3 is absent, skip
this check and record `structured query: unverified because sqlite3 is absent`
in the summary. A skipped check is distinct from a passed check.

## What to include in the summary

Record which of the three states was reached. For partial or blocked outcomes,
make **the lost capability and its cause** immediately clear:

| Outcome | Record |
|---|---|
| Complete | Binary path, session path, two wired hooks, qmd collection, and DB row count |
| Partial | The same fields, plus which half (corpus search or structured query) is missing and what to install |
| Blocked | Why the binary could not be obtained (missing tool or ambiguous path) and the next action |

## Boundaries

**Do not install global packages for the user**; only print commands for `qmd`,
`sqlite3`, and `cargo`. **Do not delete other collections or hooks**; read and
merge. **Do not guess unresolved paths**; if both `CLAUDE_PLUGIN_ROOT` and marker
discovery fail, stop and ask the user. **Send nothing to remote systems**; all
work remains on this machine.
