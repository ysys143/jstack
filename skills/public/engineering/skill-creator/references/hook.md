# Hook

Add a new hook to an existing plugin with guided configuration.

## Purpose

This wizard helps add hooks (lifecycle event handlers) to existing plugins with proper architecture patterns and validation.

## Instructions

You are an interactive wizard for adding hooks to Claude Code plugins.

### Phase 1: Context Detection

**Detect Plugin Context**:
1. Check if current directory is inside a plugin (look for `.claude-plugin/plugin.json`)
2. If yes -> use that plugin
3. If no -> list available plugins and ask user to select

```bash
# Detect current plugin
!bash find . -maxdepth 3 -name "plugin.json" -path "*/.claude-plugin/*" 2>/dev/null | head -1

# If not found, list all plugins
!bash ${JSTACK_PLUGIN_ROOT}/skills/author/scripts/list_plugins.js
```

**If not in plugin directory**:
```
[INFO] Not in a plugin directory

Available plugins:
{plugin list}

Which plugin should I add this hook to?
```

### Phase 2: Hook Discovery

**Read Hook Architecture Guide**:
```
Read: ${JSTACK_PLUGIN_ROOT}/references/organizational-guides/hook-architecture.md
```

This guide contains:
- Hook types (validation, formatting, notification)
- Trigger patterns (PreToolUse, PostToolUse, PreCommit, etc.)
- Implementation patterns

### Phase 3: Hook Configuration

#### Question 1: Hook Name

```
AskUserQuestion(
    question: "What should this hook be called?",
    options: [],  // Free text
    context: "Use descriptive name: validate_pr_labels, format_json_output, notify_completion"
)
```

**Validation**:
- [PASS] Matches pattern: `^[a-z][a-z0-9_]*$`
- [FAIL] If uppercase, spaces, or hyphens
- [WARN] If too generic ("hook", "validate")

#### Question 2: Hook Type

```
AskUserQuestion(
    question: "What type of hook is this?",
    options: [
        "Validation - Check correctness and block on failure",
        "Formatting - Transform/normalize output",
        "Notification - Notify external systems",
        "Augmentation - Enhance tool behavior"
    ],
    context: "Type determines architecture pattern. See hook-architecture.md."
)
```

**Based on selection, recommend trigger**:

| Hook Type | Recommended Trigger | Purpose |
|-----------|-------------------|---------|
| Validation | PreToolUse | Block invalid tool calls |
| Formatting | PostToolUse | Transform tool output |
| Notification | PostToolUse | Notify on completion |
| Augmentation | PreToolUse | Modify tool parameters |

#### Question 3: Trigger Event

```
AskUserQuestion(
    question: "When should this hook trigger?",
    options: [
        "PreToolUse - Before tool executes",
        "PostToolUse - After tool completes",
        "PreCommit - Before git commit",
        "PostCommit - After git commit",
        "Custom trigger"
    ],
    context: "Trigger determines when hook runs in the lifecycle."
)
```

#### Question 4: Tool Matcher

```
AskUserQuestion(
    question: "Which tools should this hook match?",
    options: [
        "Specific tool (e.g., Edit, Write, Bash)",
        "Tool pattern (e.g., Edit|Write, Bash:git:*)",
        "All tools (*)",
        "Custom regex pattern"
    ],
    context: "Matcher filters which tool invocations trigger this hook."
)
```

**Get matcher details**:
```
AskUserQuestion(
    question: "Enter the tool matcher pattern",
    options: [],  // Free text
    context: "Examples: 'Edit|Write', 'Bash:git:commit', '*', 'Read:*.json'"
)
```

#### Question 5: Implementation Language

```
AskUserQuestion(
    question: "What language for the hook script?",
    options: [
        "Python (recommended for complex logic)",
        "Bash (for simple shell commands)",
        "Node.js (if you prefer JavaScript)"
    ],
    context: "Python offers best tooling for JSON parsing and validation."
)
```

#### Question 6: Hook Behavior

**For Validation hooks**:
```
AskUserQuestion(
    question: "What should this validation check?",
    options: [],  // Free text
    context: "Example: PR must have labels, JSON must be valid, commit message format, file size limits"
)
```

**For Formatting hooks**:
```
AskUserQuestion(
    question: "What formatting should be applied?",
    options: [],  // Free text
    context: "Example: Pretty-print JSON, normalize whitespace, add headers/footers"
)
```

**For Notification hooks**:
```
AskUserQuestion(
    question: "Where should notifications be sent?",
    options: [],  // Free text
    context: "Example: Slack webhook, file log, database, email"
)
```

### Phase 4: Template Selection

Based on hook type, select appropriate template:

| Hook Type | Template |
|-----------|----------|
| Validation | `validation-hook-template` |
| Formatting | `formatting-hook-template` |
| Notification | `notification-hook-template` |
| Custom | Ask for custom implementation |

**Read template**:
```
Read: ${JSTACK_PLUGIN_ROOT}/skills/author/references/templates/{template-name}/README.md
Read: ${JSTACK_PLUGIN_ROOT}/skills/author/references/templates/{template-name}/hooks.json
```

Besides its README each template directory carries exactly two working files —
the trigger declaration and the one script that declaration names. Take both or
neither: `hooks.json` alone wires a command that is not there, and the script
alone never fires. Only the validation template ships a `.py`; the other two
ship shell.

| Hook Type | Trigger declaration | Implementation it names |
|-----------|---------------------|-------------------------|
| Validation | `validation-hook-template/hooks.json` | `validation-hook-template/validate_template.js` |
| Formatting | `formatting-hook-template/hooks.json` | `formatting-hook-template/format.js` |
| Notification | `notification-hook-template/hooks.json` | `notification-hook-template/notify.js` |

### Phase 5: Hook Generation

**Generate hook configuration**:

1. **Update or create hooks.json**:
```json
{
  "hooks": {
    "{TriggerEvent}": [
      {
        "matcher": "{tool-matcher}",
        "hooks": [
          {
            "type": "command",
            "command": "{language} ${JSTACK_PLUGIN_ROOT}/hooks/{hook-name}.{ext}",
            "description": "{purpose}"
          }
        ]
      }
    ]
  }
}
```

2. **Create hook script** (Python example):
```python
#!/usr/bin/env python3
"""
{Hook Name} - {Hook Type}

Purpose: {description}
Trigger: {trigger-event}
Matcher: {tool-matcher}
"""

import json
import sys
from typing import Dict, Any

def validate_{hook_name}(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    {Validation logic description}

    Args:
        payload: Hook payload with tool invocation details

    Returns:
        Modified payload or error result
    """
    # Extract tool details
    tool_name = payload.get("tool", {}).get("name", "")
    tool_params = payload.get("tool", {}).get("parameters", {})

    # {Type-specific logic}
    # For validation: Check conditions and return error if invalid
    # For formatting: Transform output and return modified payload
    # For notification: Send notification and return original payload

    # Example validation
    if some_condition_fails:
        return {
            "error": {
                "message": "[FAIL] Validation failed: {reason}",
                "code": "validation_error"
            }
        }

    # Success - return original or modified payload
    return payload

def main():
    """Hook entry point"""
    try:
        # Read payload from stdin
        payload = json.load(sys.stdin)

        # Process hook
        result = validate_{hook_name}(payload)

        # Write result to stdout
        json.dump(result, sys.stdout, indent=2)
        sys.exit(0)

    except json.JSONDecodeError as e:
        error = {
            "error": {
                "message": f"[FAIL] Invalid JSON input: {e}",
                "code": "json_error"
            }
        }
        json.dump(error, sys.stdout, indent=2)
        sys.exit(1)

    except Exception as e:
        error = {
            "error": {
                "message": f"[FAIL] Hook error: {e}",
                "code": "hook_error"
            }
        }
        json.dump(error, sys.stdout, indent=2)
        sys.exit(1)

if __name__ == "__main__":
    main()
```

3. **Create hook README**:
```markdown
# {Hook Name}

**Type**: {Hook Type}
**Trigger**: {Trigger Event}
**Matcher**: {Tool Matcher}

## Purpose

{Description of what this hook does}

## How It Works

1. Triggers on: {trigger description}
2. Matches: {matcher description}
3. Action: {what hook does}
4. Result: {success/failure behavior}

## Configuration

Location: `hooks/hooks.json`

```json
{hook configuration excerpt}
```

## Testing

Test this hook:

```bash
# {Test command example}
```

## Troubleshooting

### Hook not triggering

[WARN] Common causes:
- Matcher pattern doesn't match tool
- Trigger event not firing
- Script not executable

[OK] Fix:
```bash
chmod +x hooks/{hook-name}.{ext}
```

### Validation failing incorrectly

[WARN] Check validation logic in `hooks/{hook-name}.{ext}`

### Performance issues

[INFO] Hooks run synchronously - keep them fast
[OK] Consider async notification for slow operations
```

### Phase 6: Integration

**Update plugin structure**:

1. **Ensure directories exist**:
```bash
mkdir -p hooks
```

2. **Merge hooks.json** (if exists):
```
[INFO] Merging with existing hooks.json
```

Read existing, merge new configuration, write back.

3. **Make script executable**:
```bash
chmod +x hooks/{hook-name}.{ext}
```

4. **Add to plugin.json keywords** (if relevant):
```json
{
  "keywords": [...existing, "hooks", "{hook-type}"]
}
```

### Phase 7: Validation & Testing

**Validate hook configuration**:

```bash
# Use validation script
!bash ${JSTACK_PLUGIN_ROOT}/skills/author/scripts/validate_plugin.js .
```

**Test hook manually**:

```
[INFO] Testing hook configuration

To test this hook:

1. Create test payload:
```json
{
  "tool": {
    "name": "{tool-name}",
    "parameters": {test-params}
  }
}
```

2. Run hook:
```bash
echo '{test-payload}' | {language} hooks/{hook-name}.{ext}
```

3. Verify output:
[PASS] Returns valid JSON
[PASS] Contains expected fields
[PASS] Exit code correct (0 for success, 1 for failure)
```

### Phase 8: Documentation & Completion

**Show summary**:

```
[OK] Hook added successfully!

## Hook Summary

**Name**: {hook-name}
**Type**: {hook-type}
**Trigger**: {trigger-event}
**Matcher**: {tool-matcher}

## Files Created

- hooks/hooks.json (updated)
- hooks/{hook-name}.{ext}
- hooks/CONTRACT.md (updated)

## Next Steps

### Test the hook:

```bash
# Test with sample payload
echo '{{test-json}}' | {language} hooks/{hook-name}.{ext}
```

### Use the plugin:

Restart Claude Code or reload plugins to activate the hook.

### Validate the plugin:

```bash
/plugin-generator:validate
```

## Hook Checklist

- [OK] Hook configured in hooks.json
- [OK] Script created and executable
- [OK] Documentation added
- [ ] Hook tested with real payload
- [ ] Plugin validated
- [ ] Changes committed (if using git)
```

**Ask about next steps**:

```
AskUserQuestion(
    question: "What would you like to do next?",
    options: [
        "Add another hook",
        "Test this hook",
        "Validate plugin",
        "Done"
    ],
    context: "You can continue building the plugin or test what you've created."
)
```

## Quality Checks

Before completion:
- [PASS] Hook name follows conventions (snake_case)
- [PASS] hooks.json is valid JSON
- [PASS] Script has correct shebang and is executable
- [PASS] Trigger/matcher combination makes sense
- [PASS] Error handling included in script
- [OK] Hook ready for use

## Error Handling

### Invalid Hook Configuration

```
[FAIL] Invalid hook configuration

Issue: {what's wrong}
Fix: {how to correct}

Example valid configuration:
{example json}
```

### Hook Script Error

```
[FAIL] Hook script error

Command: {failed command}
Error: {error message}

Check:
- Script syntax
- File permissions (chmod +x)
- Dependencies installed
```

### Merge Conflict

```
[WARN] Existing hooks.json has conflicting configuration

Existing:
{existing config}

New:
{new config}

How to resolve?
1. Merge manually
2. Overwrite (will lose existing config)
3. Cancel and review
```

## Related Commands

- `/plugin-generator:add-agent` - Add intelligent agent
- `/plugin-generator:add-command` - Add user command
- `/plugin-generator:validate` - Validate plugin structure
- `/plugin-generator:design` - Design plugin architecture

## References

- [Hook Architecture Guide](../references/organizational-guides/hook-architecture.md)
- [Validation Hook Template](../references/templates/validation-hook-template/)
- [Formatting Hook Template](../references/templates/formatting-hook-template/)
- [Plugin Design Patterns](../references/organizational-guides/plugin-design-patterns.md)
