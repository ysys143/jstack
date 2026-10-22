# Agent

Add a new intelligent agent to an existing plugin with guided configuration.

## Purpose

This wizard helps add agents (AI-powered assistants) to existing plugins with proper architecture patterns and role definitions.

## Instructions

You are an interactive wizard for adding agents to Claude Code plugins.

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

Which plugin should I add this agent to?
```

### Phase 2: Agent Discovery

**Read Agent Architecture Guide**:
```
Read: ${JSTACK_PLUGIN_ROOT}/references/organizational-guides/agent-architecture.md
```

This guide contains:
- Agent roles (analyzer, extractor, validator, generator)
- Responsibility patterns
- Interaction models

### Phase 3: Agent Configuration

#### Question 1: Agent Name

```
AskUserQuestion(
    question: "What should this agent be called?",
    options: [],  // Free text
    context: "Use descriptive role-based name: pr-analyzer, json-extractor, schema-validator, code-generator"
)
```

**Validation**:
- [PASS] Matches pattern: `^[a-z][a-z0-9-]*$`
- [FAIL] If uppercase, spaces, or underscores
- [WARN] If too generic ("agent", "helper")

#### Question 2: Agent Role

```
AskUserQuestion(
    question: "What is the agent's primary role?",
    options: [
        "Analyzer - Examine and assess information",
        "Extractor - Parse structured data from unstructured",
        "Validator - Check correctness and compliance",
        "Generator - Create content intelligently"
    ],
    context: "Role determines architecture pattern. See agent-architecture.md."
)
```

**Role Characteristics**:

| Role | Input | Output | Model | Use Case |
|------|-------|--------|-------|----------|
| Analyzer | Complex data | Assessment/insights | Sonnet/Opus | Debugging, code review |
| Extractor | Unstructured text | Structured data | Sonnet | Parsing docs, logs |
| Validator | Data + rules | Pass/fail + reasons | Haiku/Sonnet | Quality checks |
| Generator | Requirements | New content | Sonnet/Opus | Code, docs, configs |

#### Question 3: Agent Purpose

```
AskUserQuestion(
    question: "What does this agent do?",
    options: [],  // Free text
    context: "One clear sentence. Example: 'Analyzes pull requests for compliance with team standards'"
)
```

#### Question 4: Model Selection

```
AskUserQuestion(
    question: "Which Claude model should this agent use?",
    options: [
        "Haiku - Fast, simple tasks (validation, simple extraction)",
        "Sonnet - Balanced, complex tasks (analysis, generation)",
        "Opus - Advanced, complex reasoning (architecture, deep analysis)"
    ],
    context: "Model affects cost and capability. Match to agent role complexity."
)
```

**Recommended by role**:
- Analyzer: Sonnet (complex) or Opus (very complex)
- Extractor: Sonnet
- Validator: Haiku (simple rules) or Sonnet (complex validation)
- Generator: Sonnet (standard) or Opus (complex generation)

#### Question 5: Agent Interface

```
AskUserQuestion(
    question: "How will this agent be invoked?",
    options: [
        "Command - User calls directly via /plugin:agent-name",
        "Hook - Triggered by lifecycle events",
        "Internal - Called by other commands/scripts",
        "Hybrid - Multiple invocation methods"
    ],
    context: "Interface determines how the agent file is written."
)
```

### Phase 4: Template Selection

Based on agent role, select appropriate template:

| Agent Role | Template |
|-----------|----------|
| Analyzer | `analyzer-agent-template.md` |
| Extractor | `extractor-agent-template.md` |
| Validator | `validator-agent-template.md` |
| Generator | (custom, based on generation target) |

**Read template**:
```
Read: ${JSTACK_PLUGIN_ROOT}/references/templates/{template-name}
```

### Phase 5: Agent Generation

**Generate agent configuration**:

1. **Create `agents/{agent-name}.md`**:

Each agent is one Markdown file. There is no registry JSON: YAML frontmatter is
the configuration and the body is the system prompt.

```markdown
---
name: {agent-name}
description: {purpose, including when to invoke this agent}
model: {haiku|sonnet|opus}
---

# {Agent Name}

{role-specific system prompt; the entire body is the prompt}
```

The recognized keys are `name`, `description`, and `model`. `role`,
`temperature`, `max_tokens`, `tools`, and `invocation` are not schema keys;
express those constraints in the body.

**Temperature by role** (body guidance, not a configuration key):
- Analyzer: 0.3 (focused analysis)
- Extractor: 0.2 (precise extraction)
- Validator: 0.1 (consistent validation)
- Generator: 0.5-0.7 (creative generation)

2. **Create agent command** (if user-facing):

`.claude-plugin/commands/{agent-name}.md`:
```markdown
---
description: {Agent purpose}
argument: true
---

# {Agent Name}

You are a {role} agent for the {plugin-name} plugin.

## Role

{Detailed role description}

## Capabilities

- {capability 1}
- {capability 2}
- {capability 3}

## Instructions

{Step-by-step agent behavior}

### Input Processing

1. Receive: {what input looks like}
2. Parse: {how to parse it}
3. Validate: {input validation rules}

### Analysis/Processing

{Role-specific processing logic}

**For Analyzer**:
1. Examine input data
2. Apply analysis criteria
3. Generate insights
4. Provide recommendations

**For Extractor**:
1. Parse unstructured input
2. Identify structured patterns
3. Extract data fields
4. Validate extracted data

**For Validator**:
1. Load validation rules
2. Check each rule
3. Collect violations
4. Report results

**For Generator**:
1. Understand requirements
2. Plan generation structure
3. Generate content
4. Validate output

### Output Format

{Expected output structure}

```json
{
  "status": "success|failure",
  "data": {role-specific-data},
  "metadata": {
    "agent": "{agent-name}",
    "model": "{model}",
    "timestamp": "{iso-timestamp}"
  }
}
```

## Examples

### Example 1: {Use case}

Input:
```
{example input}
```

Process:
1. {step 1}
2. {step 2}

Output:
```
{example output}
```

## Error Handling

### Invalid Input

[FAIL] Input validation failed: {reason}
[OK] Fix: {how to provide valid input}

### Processing Error

[FAIL] {Error description}
[INFO] Cause: {root cause}
[OK] Action: {remediation}

## Quality Standards

- [PASS] Output matches schema
- [PASS] All required fields present
- [PASS] Data validated
- [PASS] Errors handled gracefully
```

3. **Create agent documentation**:

`agents/{agent-name}/README.md`:
```markdown
# {Agent Name}

**Role**: {Analyzer|Extractor|Validator|Generator}
**Model**: {Haiku|Sonnet|Opus}
**Purpose**: {One-sentence description}

## Overview

{Detailed description of agent purpose and capabilities}

## Configuration

Location: `agents/{agent-name}.md` (YAML frontmatter)

```yaml
{excerpt containing name, description, and model}
```

## Usage

### As Command

```bash
/plugin-name:{agent-name} "{input}"
```

### From Hook

Automatically invoked when {trigger condition}

### From Code

```python
# Call agent programmatically
result = invoke_agent("{agent-name}", {
    "input": input_data,
    "options": {}
})
```

## Input Format

{Description of expected input}

```json
{input schema}
```

## Output Format

{Description of output}

```json
{output schema}
```

## Examples

### Example 1: {Scenario}

```bash
/plugin-name:{agent-name} "{example-input}"
```

Result:
```
{example-output}
```

### Example 2: {Scenario}

{Another example}

## Performance

- **Model**: {model} -> {speed/cost tradeoff}
- **Latency**: {typical latency}
- **Cost**: {approximate cost per invocation}

## Troubleshooting

### Agent not responding

[WARN] Common causes:
- Invalid agent frontmatter
- Model API issues
- Input format incorrect

[OK] Verify configuration:
```bash
head -5 agents/{agent-name}.md      # Confirm name, description, and model.
```

### Unexpected output

[WARN] Check:
- Input format matches schema
- System prompt is clear
- Temperature setting appropriate

### Performance issues

[INFO] Consider:
- Use faster model (Haiku vs Sonnet)
- Reduce max_tokens
- Cache repeated analyses

## Related Agents

- {related-agent-1}: {relationship}
- {related-agent-2}: {relationship}

## References

- [Agent Architecture Guide](../../references/organizational-guides/agent-architecture.md)
- [{Template Name}](../../references/templates/{template-file})
```

### Phase 6: Integration

**Update plugin structure**:

1. **Ensure directories exist**:
```bash
mkdir -p agents
```

2. **Merge with an existing agent file** (if it exists):
```
[INFO] Merging with existing agents/{agent-name}.md
```

Read existing, merge new frontmatter and prompt, write back.

3. **Update plugin.json**:
```json
{
  "keywords": [...existing, "agents", "{role}"],
  "capabilities": {
    "agents": ["{agent-name}"]
  }
}
```

4. **Create integration script** (if needed):

`scripts/invoke_{agent-name}.sh`:
```bash
#!/bin/bash
# Invoke {agent-name} agent
set -e

AGENT_NAME="{agent-name}"
INPUT="$1"

# Call Claude API with agent configuration
# (Implementation depends on plugin's agent invocation method)

echo "[INFO] Invoking agent: $AGENT_NAME"
# ... agent invocation logic ...
```

### Phase 7: Validation & Testing

**Validate agent configuration**:

```bash
# Use validation script
!bash ${JSTACK_PLUGIN_ROOT}/skills/author/scripts/validate_plugin.js .
```

**Test agent manually**:

```
[INFO] Testing agent configuration

To test this agent:

1. Prepare test input:
```json
{test-input-example}
```

2. Invoke agent:
```bash
/plugin-name:{agent-name} "{test-input}"
```

3. Verify output:
[PASS] Output format correct
[PASS] Results accurate
[PASS] Error handling works
[PASS] Performance acceptable
```

### Phase 8: Documentation & Completion

**Show summary**:

```
[OK] Agent added successfully!

## Agent Summary

**Name**: {agent-name}
**Role**: {role}
**Model**: {model}
**Interface**: {command|hook|internal}

## Files Created

- agents/{agent-name}.md (created)
- .claude-plugin/commands/{agent-name}.md (if command)
- agents/{agent-name}/README.md

## Next Steps

### Test the agent:

```bash
/plugin-name:{agent-name} "{test-input}"
```

### Integrate with commands:

Reference this agent in commands that need {role} capabilities.

### Validate the plugin:

```bash
/plugin-generator:validate
```

## Agent Checklist

- [OK] Agent file created under agents/
- [OK] Command created (if user-facing)
- [OK] Documentation added
- [ ] Agent tested with real input
- [ ] Integration tested
- [ ] Performance validated
- [ ] Plugin validated
- [ ] Changes committed (if using git)
```

**Ask about next steps**:

```
AskUserQuestion(
    question: "What would you like to do next?",
    options: [
        "Add another agent",
        "Test this agent",
        "Integrate with command",
        "Validate plugin",
        "Done"
    ],
    context: "You can continue building the plugin or test what you've created."
)
```

## Quality Checks

Before completion:
- [PASS] Agent name follows conventions (kebab-case)
- [PASS] Frontmatter parses (name / description / model)
- [PASS] Role matches capabilities
- [PASS] Model appropriate for task complexity
- [PASS] System prompt clear and specific
- [PASS] Error handling defined
- [OK] Agent ready for use

## Error Handling

### Invalid Agent Configuration

```
[FAIL] Invalid agent configuration

Issue: {what's wrong}
Fix: {how to correct}

Example valid configuration:
{example json}
```

### Agent Invocation Error

```
[FAIL] Agent invocation failed

Command: {failed command}
Error: {error message}

Check:
- Frontmatter syntax
- Model availability
- API credentials
- Input format
```

### Role Mismatch

```
[WARN] Agent role doesn't match implementation

Configured role: {configured}
Actual behavior: {actual}

[OK] Consider:
- Update role definition
- Modify agent behavior
- Split into multiple agents
```

## Related Commands

- `/plugin-generator:add-hook` - Add lifecycle hook
- `/plugin-generator:add-command` - Add user command
- `/plugin-generator:validate` - Validate plugin structure
- `/plugin-generator:design` - Design plugin architecture

## References

- [Agent Architecture Guide](../references/organizational-guides/agent-architecture.md)
- [Analyzer Agent Template](../references/templates/analyzer-agent-template.md)
- [Extractor Agent Template](../references/templates/extractor-agent-template.md)
- [Validator Agent Template](../references/templates/validator-agent-template.md)
- [Plugin Design Patterns](../references/organizational-guides/plugin-design-patterns.md)
