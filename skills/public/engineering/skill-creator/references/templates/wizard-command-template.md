# Wizard Command Template

Template for interactive multi-step commands that guide users through complex workflows.

## Purpose

Wizard commands use progressive disclosure to gather requirements, guide decisions, and execute complex operations.

## Template Structure

```markdown
# {Command Name}

Interactive wizard for {purpose}.

## Usage

/plugin-name:command-name

## How It Works

This command guides you through:
1. {Step 1 description}
2. {Step 2 description}
3. {Step 3 description}
4. {Final step}

## Instructions

You are a wizard command for {purpose}.

### Phase 1: Introduction

Greet the user and explain what this wizard does:

```
I'll guide you through {process}. This wizard will:
- {Benefit 1}
- {Benefit 2}
- {Benefit 3}

The process takes about {N} minutes and involves {X} questions.

Let's begin!
```

### Phase 2: Requirement Gathering

Use `AskUserQuestion` tool for each decision point.

#### Question 1: {Topic}

```
AskUserQuestion(
    question: "What {aspect} would you like?",
    options: [
        "{Option 1}",
        "{Option 2}",
        "{Option 3}"
    ],
    context: "This determines {what it affects}."
)
```

**Response Handling**:
- If "{Option 1}" -> {what to do}
- If "{Option 2}" -> {what to do}
- If "{Option 3}" -> {what to do}

#### Question 2: {Topic}

[Only ask if relevant based on previous answers]

```
AskUserQuestion(
    question: "How should we handle {aspect}?",
    options: ["{Choice 1}", "{Choice 2}"],
    context: "For {previous choice}, we recommend {default}."
)
```

#### Question 3: {Topic}

[Continue pattern for all required information]

### Phase 3: Confirmation

Summarize all choices and confirm:

```
Here's what I'll create:

- {Setting 1}: {Value}
- {Setting 2}: {Value}
- {Setting 3}: {Value}

Output will include:
- {Output file 1}
- {Output file 2}
```

```
AskUserQuestion(
    question: "Proceed with these settings?",
    options: ["Yes, proceed", "No, let me adjust"],
    context: "This will {what happens next}."
)
```

If "No":
- Ask which setting to change
- Loop back to that question

### Phase 4: Execution

Execute the workflow:

```
[INFO] Starting {process}...

[Step 1/N] {Step description}
{Output or progress}

[Step 2/N] {Step description}
{Output or progress}

...

[OK] Completed successfully!
```

### Phase 5: Next Steps

Guide user on what to do next:

```
[OK] {Command name} complete!

## What Was Created

- {File 1}: {Purpose}
- {File 2}: {Purpose}

## Next Steps

1. {Action 1}
2. {Action 2}
3. {Optional action 3}

## Related Commands

- /plugin-name:{related-command-1}
- /plugin-name:{related-command-2}
```

## Decision Trees

### Tree: {Decision Name}

```
Question: {Question text}

IF answer = "{Option A}"
  -> Next: {Follow-up question or action}
  -> Skip: {Questions that don't apply}

ELSE IF answer = "{Option B}"
  -> Next: {Different follow-up}
  -> Skip: {Different questions}

ELSE
  -> Next: {Default path}
```

## Validation Rules

Before executing:

- [ ] All required information gathered
- [ ] Choices are consistent
- [ ] Paths/names are valid
- [ ] No conflicts with existing files
- [ ] Dependencies available

If validation fails:
```
[FAIL] Cannot proceed

Issue: {What's wrong}
Fix: {What needs to change}

Would you like to:
1. Adjust settings
2. Cancel wizard
```

## Error Handling

### User Cancels

```
[INFO] Wizard cancelled

No changes were made.
To resume: /plugin-name:{command-name}
```

### Execution Fails

```
[FAIL] {Step name} failed

Error: {Error message}

What happened:
- Completed: {Steps that succeeded}
- Failed: {Step that failed}
- Skipped: {Steps not attempted}

Rollback: {Whether changes were reverted}

To retry: /plugin-name:{command-name}
```

### Invalid Response

```
[WARN] Invalid input: {what they entered}

Expected: {what format is needed}
Please choose from: {valid options}
```

## Context Awareness

Detect and adapt to context:

### Existing Structure

```
[INFO] Detected existing {component}

I'll {how you'll integrate} with:
- {Existing item 1}
- {Existing item 2}
```

### Missing Prerequisites

```
[WARN] Missing prerequisite: {what's missing}

Required for: {why it's needed}
Install with: {how to get it}

Continue anyway? (Not recommended)
[Yes/No]
```

### Conflicts

```
[WARN] Conflict detected

{Component} already exists: {path}

Options:
1. Overwrite (current will be backed up)
2. Skip this component
3. Choose different name
4. Cancel wizard
```

## Progressive Disclosure

Show complexity only when needed:

**Basic Path** (minimal questions):
- {Required choice 1}
- {Required choice 2}

**Advanced Path** (shown if user chooses advanced):
- All basic questions
- {Advanced option 1}
- {Advanced option 2}
- {Expert option 3}

Trigger advanced:
```
AskUserQuestion(
    question: "Configuration level?",
    options: ["Quick (recommended)", "Advanced (custom)"],
    context: "Quick uses sensible defaults."
)
```

## Examples

### Example Session: {Scenario}

**User Input**:
```
/plugin-name:wizard-command
```

**Wizard Flow**:
```
I'll guide you through creating {thing}.

Q1: What type? [Type A / Type B]
A1: Type A

Q2: Which features? [Feature 1 / Feature 2 / Both]
A2: Both

Summary:
- Type: Type A
- Features: Feature 1, Feature 2

Proceed? [Yes]

[1/3] Creating structure...
[2/3] Generating files...
[3/3] Validating...

[OK] Complete!
```

## Quality Checklist

For your wizard:
- [ ] Clear introduction
- [ ] Logical question order
- [ ] Context for each question
- [ ] Sensible defaults offered
- [ ] Confirmation before execution
- [ ] Progress indicators
- [ ] Error handling
- [ ] Clear next steps
- [ ] Related commands suggested

## Anti-Patterns

### Don't: Ask Everything Upfront

```
Q1: Name?
Q2: Version?
Q3: Description?
Q4: Author?
Q5: License?
Q6: Keywords?
[... 20 more questions ...]
```

### Do: Progressive Disclosure

```
Q1: What type? [A/B/C]
A1: Type A

Q2: Quick or custom setup? [Quick]
A2: Quick

[OK] Using sensible defaults for Type A
     Name: {suggested}
     Version: 0.1.0
     ...
```

### Don't: Vague Questions

```
"What do you want?"
"How should it work?"
```

### Do: Specific Options

```
"What type of validation?"
[ ] Schema validation
[ ] File structure check
[ ] Naming conventions
[ ] All of the above
```

### Don't: Silent Execution

```
[Creating files...]
[OK] Done!
```

### Do: Transparent Progress

```
[1/4] Creating directory: .claude-plugin/
[2/4] Generating plugin.json
[3/4] Creating command template
[4/4] Validating structure
[OK] All steps completed!
```

## Related Templates

- [generator-command-template.md](./generator-command-template.md) - Simpler generation
- [orchestrator-command-template.md](./orchestrator-command-template.md) - Multi-step workflows

## References

- [Command Architecture](../organizational-guides/command-architecture.md)
- [Anthropic Skills Guide](../anthropic-skills-guide/02-planning-and-design.md)
```

## Customization

### 1. Define Wizard Purpose

What complex workflow does this guide users through?
- Plugin creation
- Skill design
- Configuration setup
- Migration process

### 2. Map Question Flow

Create a flowchart:
1. What must be asked first?
2. What questions depend on previous answers?
3. What can be inferred/defaulted?
4. What's optional vs required?

### 3. Design Questions

For each question:
- Clear, specific wording
- 2-5 options (not overwhelming)
- Context explaining impact
- Sensible default highlighted

### 4. Handle All Paths

For each decision:
- What happens next?
- What gets skipped?
- Are there conflicts?
- Can it be undone?

### 5. Add Validation

Before execution:
- Check all required info
- Validate combinations
- Detect conflicts
- Verify prerequisites

## Implementation Tips

1. **Test the happy path first**: Get basic flow working
2. **Add validation incrementally**: One rule at a time
3. **Handle errors gracefully**: Don't crash, guide back
4. **Show progress**: Users need feedback
5. **Allow escape**: Always offer cancel option

## References

- [Command Architecture](../organizational-guides/command-architecture.md)
