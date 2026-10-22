---
argument-hint: "[displayMode] [language] [plan] | custom \"widgets\""
allowed-tools: Read, Write, Bash(node:*), AskUserQuestion
---

# /dashboard-setup — configure the status line dashboard

Configure the vendored claude-dashboard status line (jstack `dashboard` skill)
with widget system support. Upstream: uppinote20/claude-dashboard v1.34.0 (commit f0937fe, MIT).
The configuration filename remains unchanged from upstream because the bundled
code reads that exact name.

This command is named `dashboard-setup`, not upstream's `dashboard`: the plugin
also ships a `dashboard` skill, and a command with the same name is hidden behind
it, so `/jstack:dashboard` never reached these steps. The skill routes setup requests
here.

Organization policy forbids emoji in output, and every preset mode emits some.
Offer the measured emoji-free layout (`noemoji`) first.

## Arguments

- **No arguments**: Interactive mode (asks questions)
- **With arguments**: Direct configuration mode

### Direct Mode Arguments

- `$1`: Display mode
  - `noemoji` (default): 2 lines with zero emoji (model, context, cost, rateLimit5h, rateLimit7d, rateLimit7dFable | sessionName, version); written as `custom`
  - `compact`: 1 line (model, context, cost, rateLimit5h, rateLimit7d, rateLimit7dSonnet, zaiUsage)
  - `normal`: 2 lines (+ projectInfo, sessionId, sessionDuration, burnRate, todoProgress)
  - `detailed`: 6 lines (+ sessionName, tokenSpeed, depletionTime, configCounts, toolActivity, agentStatus, cacheHit, promptCache, performance, tokenBreakdown, forecast, budget, todayCost, codexUsage, geminiUsage, antigravityUsage, linesChanged, outputStyle, version, peakHours, lastPrompt, vimMode, apiDuration, tagStatus)
  - `custom`: Custom widget configuration (requires `$4`)

- `$2`: Language preference
  - `auto` (default): Detect from system language
  - `en`: English
  - `ko`: Korean

- `$3`: Subscription plan
  - `max` (default): Shows 5h + 7d rate limits
  - `pro`: Shows 5h only

- `$4`: Custom lines (only for `custom` mode)
  - Format: `"widget1,widget2|widget3,widget4"`
  - `|` separates lines
  - Example: `"model,context,cost|projectInfo,todoProgress"`

### Available Widgets

| Widget | Description |
|--------|-------------|
| `model` | Model name and version with emoji (e.g. `Opus 5.5`), effort level (Opus/Sonnet/Fable), fast mode (Opus) |
| `context` | Progress bar, percentage, tokens |
| `contextBar` | Progress bar only (sub-widget of `context`) |
| `contextPercentage` | Percentage only (sub-widget of `context`) |
| `contextUsage` | Token count only, e.g. `42K/200K` (sub-widget of `context`) |
| `cost` | Session cost in USD |
| `rateLimit5h` | 5-hour rate limit |
| `rateLimit7d` | 7-day rate limit (Pro/Max) |
| `rateLimit7dSonnet` | 7-day Sonnet limit (Max) — deprecated ~2026-06, merged into the unified weekly bucket at Sonnet 5 launch; stays hidden while the API returns null |
| `rateLimit7dFable` | 7-day Fable limit (Max) |
| `projectInfo` | Directory name + git branch + ahead/behind (↑↓), subpath from project_dir, worktree indicator |
| `configCounts` | CLAUDE.md, AGENTS.md, rules, MCPs, hooks, +Dirs counts |
| `sessionId` | Session ID (short 8 chars) |
| `sessionIdFull` | Session ID (full UUID) |
| `sessionDuration` | Session duration |
| `toolActivity` | Running/completed tools with targets (e.g., `Read(app.ts)`) |
| `agentStatus` | Subagent progress |
| `todoProgress` | Todo completion rate |
| `burnRate` | Token consumption per minute, session average (input + cache write + output) |
| `cacheHit` | Cache hit rate percentage (last request) |
| `promptCache` | Session prompt-cache health: warm/cold text marker, time left, hit ratio, miss count (Claude Code ≥ 2.1.251) |
| `promptCacheState` | Warm/cold text marker + time left only (sub-widget of `promptCache`) |
| `promptCacheHit` | Session cache hit ratio only (sub-widget of `promptCache`) |
| `promptCacheMisses` | Miss count only (sub-widget of `promptCache`) |
| `depletionTime` | Estimated time to rate limit |
| `codexUsage` | OpenAI Codex CLI usage (auto-hide if not installed) |
| `geminiUsage` | Google Gemini CLI usage - current model (auto-hide if not installed) |
| `geminiUsageAll` | Google Gemini CLI usage - all models (auto-hide if not installed) |
| `antigravityUsage` | Google Antigravity CLI - weekly quota by model family (auto-hide if not installed) |
| `antigravityUsageAll` | Google Antigravity CLI - per-model quota (auto-hide if not installed) |
| `zaiUsage` | z.ai/ZHIPU usage (auto-hide if not using z.ai) |
| `tokenBreakdown` | Input/output/cache write/read token breakdown |
| `performance` | Composite efficiency badge (cache hit + output ratio) |
| `forecast` | Estimated hourly cost based on session rate |
| `budget` | Daily spending vs configured budget limit (requires `dailyBudget` in config) |
| `tokenSpeed` | Output token generation speed, session average (e.g., `67 tok/s`) |
| `tokenSpeedLast` | Output token generation speed of the most recent response (e.g., `last 150 tok/s`) |
| `sessionName` | Session name from /rename command |
| `todayCost` | Total spending across all sessions today |
| `linesChanged` | Uncommitted lines added/removed, including untracked files (+N -N) |
| `outputStyle` | Current output style (hidden when "default") |
| `version` | Claude Code version display |
| `vimMode` | Vim mode (NORMAL/INSERT), auto-hides when vim disabled |
| `apiDuration` | API time as % of total session time |
| `peakHours` | Peak hours indicator with countdown (weekdays 5-11 AM PT) |
| `tagStatus` | Commits ahead of matched git tags (uses `tagPatterns` config, default `["v*"]`) |
| `slashCommand` | Active slash command for the current turn (🎯); cleared by next plain-text message |
| `agentMode` | Session agent identity: 👤 custom agent (via `/agent <name>`) or 🤖 subagent type |

## Tasks

### 1. Determine configuration

**If no arguments provided (interactive mode):**

Use AskUserQuestion to ask the user. Batch independent questions into a single AskUserQuestion call (max 4 per call) to minimize back-and-forth.

**Turn 1** — Ask all 4 questions in a single AskUserQuestion call:
1. Display mode — MUST include `markdown` field on each option for visual preview:
   - noemoji (recommended), markdown:
     ```
     ◆ Opus(X) │ ██░░ 80% │ $1.25 │ 5h: 42% │ 7d: 69% │ 7d-F: 61%
     v2.1.0
     ```
   - compact, markdown:
     ```
     ◆ Opus 5.5(X) │ ██░░ 80% │ $1.25 │ 5h: 42% │ 7d: 69%
     ```
   - normal, markdown:
     ```
     ◆ Opus 5.5(X) │ ██░░ 80% │ $1.25 │ 5h: 42% │ 7d: 69%
     📁 project (main ↑3) │ 🔑 abc123 │ ⏱ 45m │ 🔥 5K/m │ ✓ 3/5
     ```
   - detailed is not one of the four options (AskUserQuestion allows four). Mention
     it in the question text; the user can pick it through "Other". Preview for reference:
     ```
     ◆ Opus 5.5(X) │ ██░░ 80% │ $1.25 │ 5h: 42% │ 7d: 69%
     📁 project (main ↑3) │ 🔑 abc123 │ ⏱ 45m │ 🔥 5K/m │ ⏳ 2h │ ✓ 3/5
     CLAUDE.md: 2 │ ⚙️ 12 done │ 🤖 Agent: 1 │ 📦 85% │ 🟢 72%
     📊 In 30K · Out 8K │ 📈 ~$8/h │ 💵 $5/$15 │ 🔷 codex │ 💎 gemini │ 🪐 antigravity
     ```
   - custom, markdown:
     ```
     Choose exactly which widgets appear on each line.
     Full control over layout and ordering.
     ```
2. Language: auto (recommended), en, ko
3. Plan: max (recommended), pro
4. Theme: default (recommended), minimal, "catppuccin (mocha / latte — light)", "dracula / gruvbox / nord / tokyoNight / solarized"
   - All themes are dark except `catppuccinLatte`, which is designed for light-mode terminals
   - If multi-option selected: ask in next turn which one
   - For catppuccin, map `mocha` → config value `catppuccin`, `latte` → `catppuccinLatte`

**Turn 2** — If display mode = "custom", build the layout one line at a time using category-based multi-select.

For each line `N` (starting at 1), repeat the following sub-flow until the user declines to add another line:

**Step A — Pick categories for line `N`:**
Single AskUserQuestion call with `multiSelect: true`, max 4 options. Ask: "Line `N`: which widget categories do you want to pull from?" The 4 category options are:

1. **Model & Context** — `model`, `context`, `contextBar`, `contextPercentage`, `contextUsage`
2. **Cost & Limits** — `cost`, `rateLimit5h`, `rateLimit7d`, `rateLimit7dSonnet`, `rateLimit7dFable`, `budget`, `forecast`, `todayCost`
3. **Project, Session & Activity** — `projectInfo`, `sessionId`, `sessionIdFull`, `sessionDuration`, `sessionName`, `configCounts`, `toolActivity`, `agentStatus`, `agentMode`, `todoProgress`, `outputStyle`, `vimMode`, `linesChanged`, `version`, `lastPrompt`, `slashCommand`
4. **Performance, Tokens & Other CLIs** — `burnRate`, `tokenSpeed`, `tokenSpeedLast`, `cacheHit`, `promptCache`, `promptCacheState`, `promptCacheHit`, `promptCacheMisses`, `performance`, `tokenBreakdown`, `depletionTime`, `apiDuration`, `peakHours`, `tagStatus`, `codexUsage`, `geminiUsage`, `geminiUsageAll`, `antigravityUsage`, `antigravityUsageAll`, `zaiUsage`

**Step B — Pick widgets from each selected category:**
For every category the user selected in Step A, send one AskUserQuestion call with `multiSelect: true` listing the widgets in that category. AskUserQuestion allows max 4 options per call, so if a category has more than 4 widgets, split into multiple consecutive calls (e.g. "Cost & Limits (1/2)", "Cost & Limits (2/2)") — the user can pick zero or more widgets from each page.

Each widget option's `description` should be a short version of the table at the top of this file (e.g. `cost` → "Session cost in USD").

Collect every selected widget into an ordered list for line `N`, preserving the order they were chosen.

**Step C — Add another line?**
Single AskUserQuestion call (not multi-select) asking: "Line `N` has `[widget1, widget2, ...]`. Add another line?" with options `No (finish)` and `Yes, add Line N+1`. If the user picks "No", end the loop. If "Yes", increment `N` and return to Step A. There is no hard line limit.

**Notes for the assistant running this flow:**
- If the user selects zero widgets for a line (no categories or no widgets within selected categories), warn them and re-ask Step A for that same line — empty lines are not allowed.
- Show the running layout in Step C's question text so the user always sees what they've built so far.
- Keep the multi-select widget questions free of preset/combination options — the whole point of custom mode is per-widget control.
- **Track already-placed widgets across lines.** Maintain a `placed` set of every widget chosen so far. Starting from line 2 onward:
  - In Step A, list each category's `description` using **only the widgets not yet in `placed`** (e.g. if `model` and `context` are already placed, the Model & Context description becomes "contextBar, contextPercentage, contextUsage"). Truncate with "etc." past ~6–8 names if needed.
  - If a category has zero remaining widgets, **omit the entire category option** from Step A's choices.
  - In Step B, exclude already-placed widgets from each category's multi-select options as well.
  - If every category becomes empty (all widgets placed), inform the user and end the loop after the current line — there is nothing left to add.

**Turn 3** — Ask: "Do you want to hide any widgets?"
- Options: No (recommended), Yes
- If "Yes": ask which widgets to hide (multi-select from available widgets)

**If arguments provided (direct mode):**

Use the provided arguments directly.

### 2. Create configuration file

Create `~/.claude/claude-dashboard.local.json`:

> This file intentionally stays in `~/.claude` even when `CLAUDE_CONFIG_DIR` is set — it is the dashboard's own display config, shared by every account, and the statusline always reads it from there.

**For preset modes (compact/normal/detailed):**
```json
{
  "language": "$2 or auto",
  "plan": "$3 or max",
  "displayMode": "$1 or normal",
  "theme": "selected theme or default",
  "separator": "pipe (default) | space | dot | arrow",
  "disabledWidgets": ["selected widgets to hide, omit if empty"],
  "cache": {
    "ttlSeconds": 300
  }
}
```

**For preset shorthand (quick layout):**
```json
{
  "language": "auto",
  "plan": "max",
  "preset": "MC$R|BDO",
  "theme": "default",
  "cache": {
    "ttlSeconds": 300
  }
}
```

Preset characters: `M`=model, `C`=context, `b`=contextBar, `%`=contextPercentage, `#`=contextUsage, `$`=cost, `R`=rateLimit5h, `7`=rateLimit7d, `S`=7dSonnet, `f`=7dFable, `P`=projectInfo, `I`=sessionId, `D`=sessionDuration, `T`=toolActivity, `A`=agentStatus, `g`=agentMode, `O`=todoProgress, `B`=burnRate, `E`=depletionTime, `H`=cacheHit, `c`=promptCache, `w`=promptCacheState, `h`=promptCacheHit, `x`=promptCacheMisses, `X`=codexUsage, `G`=geminiUsage, `^`=antigravityUsage, `Z`=zaiUsage, `K`=configCounts, `N`=tokenBreakdown, `F`=performance, `W`=forecast, `U`=budget, `L`=linesChanged, `Y`=outputStyle, `V`=version, `Q`=tokenSpeed, `q`=tokenSpeedLast, `J`=sessionName, `@`=todayCost, `?`=lastPrompt, `/`=slashCommand, `m`=vimMode, `a`=apiDuration, `p`=peakHours, `t`=tagStatus. Use `|` to separate lines.

**For `noemoji` mode** (measured zero emoji). `projectInfo` is excluded because it
prints a folder emoji whenever a workspace directory is present. The limit widgets
are included: a local change renders an unreadable limit as `5h: --` rather than a
warning emoji, and `7d`/`7d-F` hide themselves in that state:
```json
{
  "language": "$2 or auto",
  "plan": "$3 or max",
  "displayMode": "custom",
  "lines": [
    ["model", "context", "cost", "rateLimit5h", "rateLimit7d", "rateLimit7dFable"],
    ["sessionName", "version"]
  ],
  "cache": {
    "ttlSeconds": 300
  }
}
```

**For custom mode:**
```json
{
  "language": "$2 or auto",
  "plan": "$3 or max",
  "displayMode": "custom",
  "lines": [
    ["widget1", "widget2"],
    ["widget3", "widget4"]
  ],
  "theme": "selected theme or default",
  "separator": "pipe",
  "disabledWidgets": ["selected widgets to hide, omit if empty"],
  "cache": {
    "ttlSeconds": 300
  }
}
```

**For budget tracking** (add to any config):
```json
{
  "dailyBudget": 15
}
```

**For tagStatus patterns** (add to any config, default is `["v*"]`):
```json
{
  "tagPatterns": ["v*", "release-*"]
}
```

**Note**: Omit `"disabledWidgets"` field entirely if user chose not to hide any widgets. Omit `"dailyBudget"` if not using budget tracking. Omit `"tagPatterns"` to use the default `["v*"]`. Omit `"separator"` if using default pipe style.

### 3. Install the status line

Point `statusLine` in the session's Claude config dir (`$CLAUDE_CONFIG_DIR` if set,
`~/.claude` otherwise) at the version-agnostic shim. Multi-account setups run this
once per account. Do not edit `settings.json` by hand; the script verifies the
installed build first and writes nothing when verification fails.

Before running it, ask one question with AskUserQuestion: "Restore the status line
automatically at session start if it disappears?" Options: `No (recommended)` and
`Yes`. Add `--auto-repair on` only when the user chose `Yes`. Automatic recovery is
off unless the user turns it on here or through `/jstack:dashboard-repair`.
```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/dashboard/scripts/install-statusline.mjs" install
```

The script prints one JSON object and:
1. Finds the installed package from the host's installation metadata
   (the selected profile's installation registry), not from a fixed marketplace or plugin name,
   and locates the dashboard build beneath it (`installation`, `version`)
2. Copies the shim into that installation's plugin data directory
   (`plugins/data/<plugin>-<marketplace>/statusline.mjs`), which survives plugin updates
3. Confirms, through the installed shim, which build a render will load (`renders`)
4. Writes `statusLine` only when it differs, keeping other `statusLine` keys, the
   file mode, and the indentation, and saves a backup first (`backup`)

Handle its exit status:
- `0`: done. Report `action`, `installation`, `version`, `backup`, and whether
  automatic recovery is on (`optin.autoRepair`).
- `3`: the user or another tool already owns `statusLine` (`owner`, `identity`, and
  `command` show it). Nothing was written. Show the command and ask whether to replace
  it; only after they agree, rerun `install` with `--replace` (and the same
  `--auto-repair` choice).
- `1`: no installed jstack build was found in this config dir. Tell the user to install
  or update the jstack plugin there first. Do not work around it with a pinned path or a
  compatibility link.
- `2`: `settings.json` could not be parsed. Report the error; do not rewrite the file.

This command configures Claude Code only. Codex keeps its native status line in
`tui.status_line`; the Claude renderer is never installed as a Codex footer, and an
existing Codex layout is left unchanged.

**Note**: After `/plugin update jstack`, the status line picks up the new version
automatically; no follow-up command is needed. Run `/jstack:dashboard-repair` if the
status line disappears or stops updating.

## Examples

```bash
# Interactive mode
/jstack:dashboard-setup

# Preset modes
/jstack:dashboard-setup noemoji ko
/jstack:dashboard-setup normal
/jstack:dashboard-setup compact en pro
/jstack:dashboard-setup detailed ko max

# Custom mode
/jstack:dashboard-setup custom auto max "model,context,cost|projectInfo,todoProgress"
```

## Notes

- The status line will update on the next message
- To change settings later, run this command again
- Custom mode allows full control over which widgets appear on each line
