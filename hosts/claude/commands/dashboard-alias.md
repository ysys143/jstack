---
argument-hint: ""
allowed-tools: Bash(node:*), Bash(cat:*), Bash(grep:*), Bash(uname:*), Bash(powershell*), Read
---

# /dashboard-alias — add the check-ai shell function

Add `check-ai` to the user's shell profile when requested. It uses the effective
Claude `statusLine.command` to find this dashboard's installed shim. That shim
resolves the actual installed package at each call, so the function contains no
marketplace name, plugin ID, cache version, or host-specific installation path.

The function requires an installed dashboard status line. If one is not configured,
run `/jstack:dashboard-setup` first. Preserve any existing `check-ai` function unless
the user asks to replace it.

## Shared resolver

Both shell variants below run this same Node program. It reads the selected
`CLAUDE_CONFIG_DIR` (or the current user's default Claude directory), accepts
only a `node ".../statusline.mjs"` status-line command, verifies this dashboard's
ownership marker in the shim, and delegates usage mode to that shim. A user-owned
status line or an unreadable config fails with a diagnostic; it is never executed.

```javascript
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const cp = require("node:child_process");
const cfg = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
let command = "";
try { command = JSON.parse(fs.readFileSync(path.join(cfg, "settings.json"), "utf8")).statusLine?.command || ""; }
catch { console.error("jstack dashboard is not configured in " + cfg); process.exit(1); }
const match = /^node\s+"([^"\n]+\/statusline\.mjs)"$/.exec(command.replaceAll("\\", "/"));
if (!match) { console.error("jstack dashboard does not own the active status line in " + cfg); process.exit(1); }
const shim = command.match(/^node\s+"([^"\n]+)"$/)?.[1];
if (!shim || !fs.existsSync(shim) || !fs.readFileSync(shim, "utf8").includes("JSTACK-DASHBOARD-SHIM")) {
  console.error("jstack dashboard shim is unavailable in " + cfg); process.exit(1);
}
const result = cp.spawnSync(process.execPath, [shim, "--check-usage", ...process.argv.slice(1)], { stdio: "inherit", env: process.env, windowsHide: true });
process.exit(result.status ?? 1);
```

## Bash or zsh

Check the current shell and whether a function already exists. Append the
following to `~/.bashrc` or `~/.zshrc` only after choosing the correct file. The
Node body is the shared resolver above, copied byte for byte inside the quotes.

```bash
check-ai() {
  node -e '
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const cp = require("node:child_process");
const cfg = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
let command = "";
try { command = JSON.parse(fs.readFileSync(path.join(cfg, "settings.json"), "utf8")).statusLine?.command || ""; }
catch { console.error("jstack dashboard is not configured in " + cfg); process.exit(1); }
const match = /^node\s+"([^"\n]+\/statusline\.mjs)"$/.exec(command.replaceAll("\\", "/"));
if (!match) { console.error("jstack dashboard does not own the active status line in " + cfg); process.exit(1); }
const shim = command.match(/^node\s+"([^"\n]+)"$/)?.[1];
if (!shim || !fs.existsSync(shim) || !fs.readFileSync(shim, "utf8").includes("JSTACK-DASHBOARD-SHIM")) {
  console.error("jstack dashboard shim is unavailable in " + cfg); process.exit(1);
}
const result = cp.spawnSync(process.execPath, [shim, "--check-usage", ...process.argv.slice(1)], { stdio: "inherit", env: process.env, windowsHide: true });
process.exit(result.status ?? 1);
' -- "$@"
}
```

## PowerShell

Add the following function to the selected PowerShell profile. The program
inside the single-quoted here-string is the shared resolver above. The here-string
ends before the function's closing brace.

```powershell
function check-ai {
  $program = @'
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const cp = require("node:child_process");
const cfg = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
let command = "";
try { command = JSON.parse(fs.readFileSync(path.join(cfg, "settings.json"), "utf8")).statusLine?.command || ""; }
catch { console.error("jstack dashboard is not configured in " + cfg); process.exit(1); }
const match = /^node\s+"([^"\n]+\/statusline\.mjs)"$/.exec(command.replaceAll("\\", "/"));
if (!match) { console.error("jstack dashboard does not own the active status line in " + cfg); process.exit(1); }
const shim = command.match(/^node\s+"([^"\n]+)"$/)?.[1];
if (!shim || !fs.existsSync(shim) || !fs.readFileSync(shim, "utf8").includes("JSTACK-DASHBOARD-SHIM")) {
  console.error("jstack dashboard shim is unavailable in " + cfg); process.exit(1);
}
const result = cp.spawnSync(process.execPath, [shim, "--check-usage", ...process.argv.slice(1)], { stdio: "inherit", env: process.env, windowsHide: true });
process.exit(result.status ?? 1);
'@
  node -e $program -- @args
}
```

After adding the function, load the profile in a new shell and run `check-ai`
and `check-ai --json`. If the dashboard installation changes, no profile edit is
needed: the installed shim resolves the current package each time.
