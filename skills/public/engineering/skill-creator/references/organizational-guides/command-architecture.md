# Command Architecture Guide

Commands are the primary user interface layer in the plugin system. They define how users interact with plugin functionality through Claude Code.

## Command Categories

Commands fall into distinct architectural patterns based on their workflow complexity and user interaction model.

### 1. Wizard Commands (Interactive)

**Pattern**: Multi-step user interviews that gather requirements before execution.

**Characteristics**:
- Use `AskUserQuestion` tool for progressive disclosure
- Build context incrementally across multiple turns
- Guide users through decision trees
- Validate inputs at each step
- Generate comprehensive execution plans

**Examples**:
- `design` - Interactive plugin/skill design session
- `generate` - Full plugin creation with requirements gathering
- `from-session` - Extract skills from conversation history

**Structure**:
```
1. Introduction & Context Gathering
2. Requirement Interview (2-5 questions)
3. Validation & Confirmation
4. Execution & Output
5. Next Steps Guidance
```

**When to Use**:
- Complex workflows with many variables
- Users need guidance on options
- Requires domain expertise to choose correctly
- Multiple valid paths depending on context

### 2. Generator Commands (Templated)

**Pattern**: File/code generation from templates with minimal user input.

**Characteristics**:
- Accept structured input (plugin name, type, parameters)
- Apply templates with variable substitution
- Create files in standardized locations
- Validate output against schema
- Provide immediate feedback

**Examples**:
- `add-hook` - Generate hook from template
- `add-agent` - Generate agent prompt file
- `add-command` - Generate command markdown
- `add-skill` - Generate skill from template

**Structure**:
```
1. Parse & Validate Input
2. Load Template
3. Apply Transformations
4. Write Output Files
5. Report Success/Failure
```

**When to Use**:
- Repetitive file creation tasks
- Strong conventions to follow
- Output structure is predictable
- Minimal business logic required

### 3. Orchestrator Commands (Coordination)

**Pattern**: Coordinate multiple tools, agents, or external systems.

**Characteristics**:
- Delegate work to specialized agents
- Manage workflow state
- Handle errors and retries
- Aggregate results
- Provide progress updates

**Examples**:
- `from-codebase` - Orchestrates analysis -> design -> generation
- `from-docs` - Orchestrates reading -> extraction -> synthesis
- `publish` - Orchestrates build -> test -> deploy -> PR

**Structure**:
```
1. Workflow Planning
2. Sequential/Parallel Task Execution
3. State Management
4. Error Recovery
5. Result Aggregation
```

**When to Use**:
- Multi-stage pipelines
- Requires agent specialization
- Long-running operations
- Complex error handling needed

### 4. Utility Commands (Direct)

**Pattern**: Single-purpose tools that perform one action.

**Characteristics**:
- Minimal user interaction
- Direct execution
- Fast feedback
- Idempotent when possible
- Simple error messages

**Examples**:
- `inspect` - Show plugin component inventory
- `validate` - Run all validation checks
- `sync-guide` - Update reference documentation

**Structure**:
```
1. Execute Action
2. Return Result
```

**When to Use**:
- Information retrieval
- Simple transformations
- Status checks
- Quick fixes

## Command Design Principles

### 1. Progressive Disclosure

Show complexity only when needed:
- Start with simple questions
- Drill down based on user choices
- Provide sensible defaults
- Allow expert mode for power users

**Example**:
```
Q: What type of hook? (validation/formatting/notification)
-> If validation: What validation rules?
-> If formatting: What file types?
-> If notification: What events?
```

### 2. Context Awareness

Commands should understand their environment:
- Detect existing plugin structure
- Infer conventions from codebase
- Suggest compatible options
- Warn about conflicts

**Example**:
```
# Before adding hook, check:
- Does plugin.json exist?
- What hooks already exist?
- What's the naming convention?
- Are dependencies available?
```

### 3. Validation Layers

Validate at multiple stages:

| Stage | What to Validate | When to Fail |
|-------|------------------|--------------|
| Input | Syntax, required fields | Immediately |
| Semantic | Business rules, constraints | Before execution |
| Structural | File system, dependencies | During execution |
| Coherence | Plugin bundle consistency | After execution |

### 4. Error Handling

Provide actionable error messages:

**BAD**:
```
Error: Validation failed
```

**GOOD**:
```
[FAIL] Hook validation failed:
  - Missing required field: hooks[0].trigger
  - Invalid event type: "on_commit" (must be one of: pre_commit, post_commit)

  Fix: Edit hooks/hooks.json and add:
  {
    "trigger": "pre_commit",
    ...
  }
```

Hook configuration lives under `hooks/`, not at the plugin root. An error that
points somewhere other than the real repair location is actively misleading.

### 5. Idempotency

Commands should be safe to re-run:
- Check if output already exists
- Offer to overwrite/skip/merge
- Preserve user modifications
- Use version control hooks

## Command Metadata

Every command.md should include:

```markdown
# Command Title

**Type**: [Wizard|Generator|Orchestrator|Utility]
**Complexity**: [Low|Medium|High]
**User Interaction**: [None|Single|Multiple]
**Estimated Time**: [<1s|1-5s|5-30s|30s+]

## Purpose

[One-line description]

## Usage

/plugin-name:command-name [args]

## Prerequisites

- [What must exist before running]

## Output

- [What files/changes are created]

## Error Handling

- [Common failures and fixes]
```

## Command Testing Strategy

### Unit Testing

Test individual functions:
- Input validation
- Template rendering
- File operations
- Error cases

### Integration Testing

Test full command flow:
- End-to-end execution
- Multi-step wizards
- Agent coordination
- Rollback on failure

### User Testing

Test with real scenarios:
- First-time users
- Edge cases
- Error recovery
- Documentation clarity

## Command Composition

Commands can invoke other commands:

**Pattern**: Chain of Responsibility
```
/plugin-generator:generate
  -> /plugin-generator:design
  -> /plugin-generator:validate
  -> /plugin-generator:add-command
  -> /plugin-generator:add-skill
```

**Pattern**: Facade
```
/plugin-generator:publish
  -> /plugin-generator:validate
  -> /git:commit
  -> /git:push
  -> /git:pr
```

## Anti-Patterns

### 1. God Commands

**Problem**: One command that does everything.

**Solution**: Break into focused sub-commands that compose.

### 2. Hidden Complexity

**Problem**: Command seems simple but has many edge cases.

**Solution**: Use wizard pattern to expose decisions.

### 3. Silent Failures

**Problem**: Command succeeds but output is wrong.

**Solution**: Add validation steps and show what was created.

### 4. Inconsistent UX

**Problem**: Each command has different interaction style.

**Solution**: Follow category patterns consistently.

## Reference Implementation Checklist

When implementing a new command:

- [ ] Choose correct category (Wizard/Generator/Orchestrator/Utility)
- [ ] Define clear prerequisites
- [ ] Write input validation
- [ ] Design error messages
- [ ] Add progress indicators for long operations
- [ ] Include usage examples
- [ ] Test edge cases
- [ ] Document output format
- [ ] Add coherence checks if modifying plugin
- [ ] Consider idempotency

## Related Guides

- [Plugin Design Patterns](./plugin-design-patterns.md) - Overall architecture
- [Agent Architecture](./agent-architecture.md) - When to delegate to agents
- [Hook Architecture](./hook-architecture.md) - Lifecycle integration
- [Bundle Coherence](./bundle-coherence-guide.md) - Validation principles
