# Hook Architecture

Comprehensive guide to Claude Code hooks: lifecycle, configuration, implementation patterns, and best practices.

---

## Table of Contents

1. [Hook Types & Lifecycle](#hook-types--lifecycle)
2. [hooks.json Structure](#hooksjson-structure)
3. [Matcher Patterns](#matcher-patterns)
4. [Hook Script Contracts](#hook-script-contracts)
5. [Common Hook Patterns](#common-hook-patterns)
6. [Multi-Hook Ordering](#multi-hook-ordering)
7. [Performance Considerations](#performance-considerations)
8. [Testing & Debugging](#testing--debugging)

---

## Hook Types & Lifecycle

### PreToolUse Hooks
**Execute BEFORE tool runs** - can BLOCK execution.

**Use Cases**:
- Validation (e.g., "Don't commit if tests fail")
- Authorization checks (e.g., "Require approval for production commands")
- Pre-flight checks (e.g., "Verify file exists before editing")
- Policy enforcement (e.g., "Block direct writes to certain paths")

**Lifecycle**:
```
1. User/Claude requests tool execution
2. PreToolUse hooks run (in order)
3. If ANY hook exits non-zero -> BLOCK tool execution
4. If ALL hooks exit 0 -> Proceed with tool
```

**Critical**: PreToolUse hooks can **prevent** tool execution entirely.

---

### PostToolUse Hooks
**Execute AFTER tool runs** - cannot block, but can trigger side effects.

**Use Cases**:
- Notifications (e.g., "Slack notify on deploy")
- Logging/audit trails (e.g., "Log all Bash commands")
- Auto-formatting (e.g., "Run prettier after Edit")
- Sync operations (e.g., "Update docs after code changes")

**Lifecycle**:
```
1. Tool executes successfully
2. PostToolUse hooks run (in order)
3. If hooks fail -> Log warning, don't block
4. Continue conversation
```

**Critical**: PostToolUse hooks **cannot prevent** actions, only react to them.

---

## hooks.json Structure

### Basic Structure

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "python3 ${JSTACK_PLUGIN_ROOT}/hooks/validate_before_commit.py"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "python3 ${JSTACK_PLUGIN_ROOT}/hooks/notify_deployment.py"
          }
        ]
      }
    ]
  }
}
```

There is no field for "only when the Bash command is `git commit`" — `matcher`
only ever matches the **tool name**. `validate_before_commit.py` still only
acts on commits because the script itself reads `tool_input.command` from
stdin and tests it against a regex before doing anything. The JSON says which
tool calls reach the script; the script decides which of those calls matter.

### Field Reference

| Field | Level | Required | Description |
|-------|-------|----------|-------------|
| `matcher` | Hook group | Yes | Regex matched against the tool name (`Bash`, `Edit`, `Write`, `Edit\|Write`, `.*` for every tool, `""` for event types that have no tool, e.g. `Stop`) |
| `hooks` | Hook group | Yes | Array of commands to run when `matcher` matches |
| `type` | Command entry | Yes | Always `"command"` |
| `command` | Command entry | Yes | Shell command to execute; `${JSTACK_PLUGIN_ROOT}` expands to the plugin's own directory so the command works regardless of where the plugin is installed |
| `async` | Command entry | No | Run without waiting for the command to finish |
| `timeout` | Command entry | No | Seconds to wait before killing the command |

---

## Matcher Patterns

### Single Tool Matching

Match one specific tool:

```json
{
  "matcher": "Bash"
}
```

Triggers on: ALL Bash tool calls.

---

### Multiple Tool Matching

Match several tools with pipe separator (the value is a regex, so `|` is
alternation, not a list):

```json
{
  "matcher": "Edit|Write"
}
```

Triggers on: Any Edit OR Write tool call.

---

### Content Refinement Happens in the Script, Not in `matcher`

`matcher` only ever tests the **tool name**. There is no second JSON field
that filters by the tool's arguments — a hook that should fire only for
`git commit`, only for a specific file extension, or only above some size has
to say so in the script, by reading `tool_input` from stdin and testing it
there. The JSON decides which tool calls the script sees; the script decides
which of those calls it cares about.

```python
# matcher was "Bash" — every Bash call reaches this script.
# The script itself narrows to git commit / git push:
import json, re, sys

tool_input = json.load(sys.stdin).get("tool_input", {})
command = tool_input.get("command", "")

if not re.search(r"git (commit|push)", command):
    sys.exit(0)  # not a match — nothing to do

# ... validation for the matching commands ...
```

**Regex Tips** (for the `matcher` value, and for whatever pattern the script
tests `tool_input` against):
- Escape special chars: `\\.`, `\\[`, `\\(`
- Use alternation: `(commit|push|pull)`
- Be specific to avoid false positives

---

### Common Matcher Examples

| Use Case | `matcher` (tool name) | Content check (inside the script) |
|----------|---------|-------|
| Any file modification | `Edit\|Write` | none |
| Git commits only | `Bash` | `tool_input.command` matches `git commit` |
| Production deploys | `Bash` | `tool_input.command` matches `deploy.*production` |
| TypeScript files | `Edit\|Write` | `tool_input.file_path` matches `\\.tsx?$` |
| Test commands | `Bash` | `tool_input.command` matches `(npm\|yarn) test` |

---

## Hook Script Contracts

### Input: Tool Call Context (stdin)

Hooks receive **JSON object via stdin** with tool call details:

```json
{
  "tool_name": "Bash",
  "tool_input": {
    "command": "git commit -m 'Fix bug'",
    "description": "Create git commit"
  }
}
```

`tool_input`'s shape depends on `tool_name` — `Write` carries `content`,
`Edit` carries `new_string`, `MultiEdit` carries an `edits` array, Bash
carries `command`. A script that only branches on `tool_name` and stops
reading fails silently on the tools it did not special-case.

**Access in Python**:
```python
import sys
import json

hook_input = json.load(sys.stdin)
tool_name = hook_input['tool_name']
command = hook_input['tool_input']['command']
```

**Access in Bash**:
```bash
#!/bin/bash
read -r hook_input
echo "$hook_input" | jq -r '.tool_input.command'
```

---

### Output: Exit Codes

| Exit Code | Meaning | Effect |
|-----------|---------|--------|
| `0` | Success | PreToolUse: Allow tool execution. PostToolUse: Continue. |
| `1-255` | Failure | PreToolUse: **BLOCK** tool execution. PostToolUse: Log warning. |

**PreToolUse Example** (Python):
```python
import sys
import json

hook_input = json.load(sys.stdin)
command = hook_input['tool_input']['command']

if 'git commit' in command:
    # Check if tests pass
    result = subprocess.run(['npm', 'test'], capture_output=True)
    if result.returncode != 0:
        print("ERROR: Tests failed. Cannot commit.")
        sys.exit(1)  # BLOCK commit

sys.exit(0)  # Allow commit
```

---

### Environment Variables

Hooks have access to environment:

| Variable | Description |
|----------|-------------|
| `PWD` | Plugin directory |
| `CLAUDE_PROJECT_DIR` | Current project directory |
| Custom vars | Set via `command: "VAR=value python3 script.py"` |

---

## Common Hook Patterns

### 1. Validation Hook (PreToolUse)

**Purpose**: Block actions if validation fails.

**Example**: Don't commit if linting fails.

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "python3 ${JSTACK_PLUGIN_ROOT}/hooks/lint_check.py"
          }
        ]
      }
    ]
  }
}
```

**Script** (`hooks/lint_check.py`) — the `matcher` is just `Bash`, so the
script narrows to commits itself:
```python
#!/usr/bin/env python3
import json
import subprocess
import sys

tool_input = json.load(sys.stdin).get('tool_input', {})
if 'git commit' not in tool_input.get('command', ''):
    sys.exit(0)  # not a commit — nothing to check

# Run linter
result = subprocess.run(['npm', 'run', 'lint'], capture_output=True, text=True)

if result.returncode != 0:
    print(f"ERROR: Linting failed:\n{result.stdout}")
    sys.exit(1)  # BLOCK commit

print("Linting passed.")
sys.exit(0)  # Allow commit
```

---

### 2. Formatting Hook (PostToolUse)

**Purpose**: Auto-format files after edits.

**Example**: Run prettier after editing TypeScript files.

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "python3 ${JSTACK_PLUGIN_ROOT}/hooks/auto_format.py"
          }
        ]
      }
    ]
  }
}
```

**Script** (`hooks/auto_format.py`) — the `matcher` covers every Edit/Write,
so the script filters down to `.ts`/`.tsx`:
```python
#!/usr/bin/env python3
import json
import subprocess
import sys

hook_input = json.load(sys.stdin)
file_path = hook_input['tool_input'].get('file_path')

if file_path and file_path.endswith(('.ts', '.tsx')):
    # Run prettier
    subprocess.run(['npx', 'prettier', '--write', file_path])
    print(f"Formatted {file_path}")

sys.exit(0)
```

---

### 3. Notification Hook (PostToolUse)

**Purpose**: Send notifications on important actions.

**Example**: Slack notify on production deploys.

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "python3 ${JSTACK_PLUGIN_ROOT}/hooks/notify_slack.py"
          }
        ]
      }
    ]
  }
}
```

**Script** (`hooks/notify_slack.py`) — the `matcher` is every Bash call, so
the script narrows to production deploys:
```python
#!/usr/bin/env python3
import json
import re
import requests
import sys

hook_input = json.load(sys.stdin)
command = hook_input['tool_input']['command']

if not re.search(r'deploy.*production', command):
    sys.exit(0)  # not a production deploy — nothing to notify

# Send Slack webhook
webhook_url = "https://hooks.slack.com/services/YOUR/WEBHOOK/URL"
message = f"[DEPLOY] Production deploy initiated: `{command}`"

requests.post(webhook_url, json={"text": message})
print("Slack notification sent.")
sys.exit(0)
```

---

### 4. Audit Hook (PostToolUse)

**Purpose**: Log actions for compliance/auditing.

**Example**: Log all Bash commands to audit trail.

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "python3 ${JSTACK_PLUGIN_ROOT}/hooks/audit_log.py"
          }
        ]
      }
    ]
  }
}
```

**Script** (`hooks/audit_log.py`):
```python
#!/usr/bin/env python3
import json
import sys
from datetime import datetime

hook_input = json.load(sys.stdin)
command = hook_input['tool_input']['command']
timestamp = datetime.now().isoformat()

with open('.audit.log', 'a') as f:
    f.write(f"{timestamp} | {command}\n")

print("Logged to .audit.log")
sys.exit(0)
```

---

## Multi-Hook Ordering

### Execution Order

When multiple hooks match the same tool call:

**PreToolUse**: Execute in **array order** — both across matcher groups
under `hooks.PreToolUse` and, within a group, across its `hooks` array.
- If ANY hook fails -> ALL subsequent hooks skipped, tool blocked.

**PostToolUse**: Execute in **array order** (top to bottom in
`hooks.PostToolUse`, same two levels).
- If ANY hook fails -> Continue executing remaining hooks, log warnings.

---

### Composition Best Practices

**DO**: Order PreToolUse hooks from fastest to slowest.
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {"type": "command", "command": "python3 quick_syntax_check.py"},
          {"type": "command", "command": "python3 expensive_integration_test.py"}
        ]
      }
    ]
  }
}
```
**Why**: Fail fast on cheap checks before running expensive ones.

**DO**: Keep PostToolUse hooks independent.
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {"type": "command", "command": "python3 format.py"},
          {"type": "command", "command": "python3 notify.py"}
        ]
      }
    ]
  }
}
```
**Why**: Failure in one hook shouldn't affect others.

**DON'T**: Create circular dependencies.
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit",
        "hooks": [
          {"type": "command", "command": "python3 edit_file_a_if_b_changed.py"},
          {"type": "command", "command": "python3 edit_file_b_if_a_changed.py"}
        ]
      }
    ]
  }
}
```
Both scripts read `tool_input.file_path` from stdin themselves (`matcher`
cannot tell them apart), and each edits the file the other watches for.
**Why**: Infinite loop.

---

## Performance Considerations

### Keep Hooks Fast

**Target**: Under 100ms per hook.

**Techniques**:
- Use compiled languages (Go, Rust) for speed-critical hooks
- Cache expensive checks (e.g., lint results)
- Run async operations in background (PostToolUse only)
- Exit early on quick failures

---

### Async Operations (PostToolUse)

For slow side effects (API calls, notifications), run in background:

```python
#!/usr/bin/env python3
import subprocess
import sys

# Run slow operation in background
subprocess.Popen(['python3', 'send_notification.py'],
                 stdout=subprocess.DEVNULL,
                 stderr=subprocess.DEVNULL)

print("Notification queued (background).")
sys.exit(0)  # Don't wait
```

---

### Caching Strategy

Cache validation results to avoid redundant work:

```python
#!/usr/bin/env python3
import hashlib
import json
import sys
import subprocess

hook_input = json.load(sys.stdin)
file_path = hook_input['tool_input'].get('file_path')

# Check cache
cache_key = hashlib.md5(open(file_path, 'rb').read()).hexdigest()
cache_file = f'.lint-cache/{cache_key}'

if os.path.exists(cache_file):
    print("Linting cached (passed).")
    sys.exit(0)

# Run lint
result = subprocess.run(['npm', 'run', 'lint'], capture_output=True)
if result.returncode == 0:
    os.makedirs('.lint-cache', exist_ok=True)
    open(cache_file, 'w').close()  # Cache result
    sys.exit(0)
else:
    sys.exit(1)
```

---

## Testing & Debugging

### Manual Testing

**Simulate PreToolUse hook**:
```bash
echo '{"tool_name": "Bash", "tool_input": {"command": "git commit -m test"}}' | python3 hooks/validate_before_commit.py
echo "Exit code: $?"
```

**Simulate PostToolUse hook**:
```bash
echo '{"tool_name": "Edit", "tool_input": {"file_path": "src/file.ts"}}' | python3 hooks/auto_format.py
```

---

### Debug Output

Print debug info to **stderr** (not stdout, which is captured):

```python
import sys

# Debug output (goes to Claude's logs)
print(f"DEBUG: Processing {file_path}", file=sys.stderr)

# User-facing output (shown to user)
print("Validation passed.")
```

---

### Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| Hook not triggering | Wrong `matcher` | Check tool name (Bash, Edit, Write) |
| Regex not matching | Incorrect escape sequences | Test regex with `re.search()` |
| Hook blocks unexpectedly | Exit code 1 when should be 0 | Check all code paths return 0 |
| Slow hook performance | Expensive operations | Add caching or async execution |

---

## Hook vs Agent vs Skill Decision Matrix

| Feature | Hook | Agent | Skill |
|---------|------|-------|-------|
| **Trigger** | Automatic (tool calls) | Manual invocation | Manual invocation |
| **Can Block Actions** | Yes (PreToolUse) | No | No |
| **Async/Background** | PostToolUse only | No | No |
| **User Interaction** | No | Yes | Yes |
| **Best For** | Validation, automation | Analysis, research | Workflows, generation |

**Use Hooks When**: You need automatic, zero-user-intervention validation or side effects.

**Use Agents When**: You need specialized analysis or multi-turn investigation.

**Use Skills When**: You need user-driven workflows or generation tasks.

---

## Advanced Patterns

### Conditional Hook Execution

Run hook only in certain contexts:

```python
#!/usr/bin/env python3
import json
import subprocess
import sys

hook_input = json.load(sys.stdin)
# stdin carries tool_name/tool_input, not the working directory — the hook
# process already runs with the project directory as its own cwd, so read
# it from there instead of inventing a field that hooks.json does not send.

# Only validate if in production branch
current_branch = subprocess.check_output(['git', 'branch', '--show-current'], text=True).strip()

if current_branch != 'main':
    print("Skipping validation (not on main branch).")
    sys.exit(0)  # Pass

# Run validation...
```

---

### Multi-Stage Validation

Chain multiple validation steps:

```python
#!/usr/bin/env python3
import subprocess
import sys

# Stage 1: Syntax check (fast)
if subprocess.run(['npm', 'run', 'lint'], capture_output=True).returncode != 0:
    print("ERROR: Linting failed.")
    sys.exit(1)

# Stage 2: Type check (medium)
if subprocess.run(['npm', 'run', 'typecheck'], capture_output=True).returncode != 0:
    print("ERROR: Type checking failed.")
    sys.exit(1)

# Stage 3: Tests (slow)
if subprocess.run(['npm', 'test'], capture_output=True).returncode != 0:
    print("ERROR: Tests failed.")
    sys.exit(1)

print("All validations passed.")
sys.exit(0)
```

---

## Next Steps

1. Use `/plugin-generator:add-hook` to create hooks with templates
2. Reference this guide when implementing hook logic
3. Test hooks manually before deploying
4. Monitor hook performance (target <100ms)

---

**Last Updated**: v0.3.0 (2025-02)
