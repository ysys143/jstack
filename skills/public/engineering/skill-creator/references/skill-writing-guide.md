# Skill Writing Guide

This reference expands the `author` skill's rules for writing effective skills.

## Table of Contents

1. [Description and Routing](#1-description-and-routing)
2. [Body Style](#2-body-style)
3. [Output Formats](#3-output-formats)
4. [Examples](#4-examples)
5. [Progressive Disclosure](#5-progressive-disclosure)
6. [Bundle Repeated Scripts](#6-bundle-repeated-scripts)
7. [Evaluation Schemas](#7-evaluation-schemas)
8. [Exclude Incidental Material](#8-exclude-incidental-material)
9. [Audit Existing Skills and AGENTS.md](#9-audit-existing-skills-and-agentsmd)

## 1. Description and Routing

A description is a short situation statement used for automatic selection. Explicit user invocation is another route, so do not treat the description as the only trigger. The displayed name and description should distinguish the skill's work from neighboring skills.

### Understand the Trigger Mechanism

Models may handle a simple request with ordinary tools even when a description matches. Complex, multistep, specialized requests are more likely to select a skill.

### Writing Principles

State both what the skill does and concrete situations that need it. Include a boundary for similar requests that should not select it. Keep it short and avoid pressuring the model to invoke it.

### Good Examples

```yaml
description: "Extract tables from PDFs into CSV. Excludes ordinary document reading."
```

```yaml
description: "Clean or transform spreadsheet data while preserving formulas and column structure."
```

### Bad Examples

Avoid descriptions such as `"Processes data."`, `"Always invoke when a PDF
is mentioned."`, or instructions to outrank neighboring skills. The first has
no task boundary, the second loads instructions for ordinary file mentions, and
the third creates duplicate routing and conflicting instructions.

## 2. Body Style

### Explain Why First

Explain why a constraint exists so the agent can handle edge cases. Avoid an
unexplained rule:

```markdown
ALWAYS use pdfplumber for table extraction. NEVER use PyPDF2 for tables.
```

State the mechanism instead:

```markdown
Use pdfplumber for table extraction. PyPDF2 specializes in text extraction and
does not preserve table row and column structure, while pdfplumber recognizes
cell boundaries and returns structured data.
```

### Generalize the Rule

When feedback reveals a defect, generalize the governing principle instead of
adding one example-specific exception.

**Overfit correction:**

```markdown
If a column is named "Q4 sales", convert it to a number.
```

**Generalized correction:**

```markdown
If a column name contains a term that implies a numeric value, such as sales,
amount, or quantity, convert it to a numeric type. Preserve the original value
when conversion fails.
```

### Use an Imperative Voice

Use direct imperative language because a skill is an instruction document.

### Conserve Context

Every sentence consumes shared context, so ask whether the model already knows
it, whether omitting it causes a mistake, and whether one precise example would
replace a longer explanation. Delete generic knowledge and retain details that
prevent observed errors.

### Bound the Body

Use the description to say when the skill fires and which neighboring requests
it excludes. Once the skill fires, use the body to decide whether to skip its
procedure and when its work is complete.

Add a skip condition, over-application guard, invalidation condition, or stop
point only when observed use or evaluation shows unnecessary execution or
premature stopping. Tie the instruction to evidence in the current task, name
what would reopen a skipped path or invalidate a stop, and define the completion
evidence so it cannot cut off requested work early. Do not add a stock checklist
to every skill.

When work is skipped or stopped, require the output to state why.

Pattern adapted from skill-authoring guidance in tjboudreaux/cc-thinking-skills
(MIT), whose authoring rules were distilled from two external articles; no
sentences were copied.

## 3. Output Formats

When the shape of a deliverable matters, state a compact template and show a real example:

```markdown
## Report Structure
Follow this template exactly:

# [Title]
## Summary
## Key Findings
## Recommendations
```

## 4. Examples

Examples often teach a contract more efficiently than prose:

```markdown
## Commit Message Format

Input: Add JWT-based user authentication
Output: feat(auth): add JWT authentication

Input: Fix a broken password-visibility button
Output: fix(login): repair password visibility toggle
```

## 5. Progressive Disclosure

Keep `SKILL.md` as a routing and decision entry point. Put domain detail in references and load only the branch needed for the request.

### Pattern 1: Separate by Domain

```text
bigquery-skill/
|-- SKILL.md
`-- references/
    |-- finance.md
    |-- sales.md
    `-- product.md
```

A finance question should load only `finance.md`.

### Pattern 2: Load Conditional Detail

In a document skill, link a separate redlining reference only when tracked
changes are required.

```markdown
# DOCX Processing

## Document creation
Create new documents with docx-js. See [DOCX-JS.md](references/docx-js.md).

## Document editing
Edit simple content directly in XML.
When tracked changes are required, see [REDLINING.md](references/redlining.md).
```

### Pattern 3: Structure Large Reference Files

A reference longer than 300 lines starts with a navigable table of contents:

```markdown
# API Reference

## Table of Contents
1. [Authentication](#authentication)
2. [Endpoints](#endpoints)
3. [Error codes](#error-codes)
4. [Rate limits](#rate-limits)

---

## Authentication
...
```

## 6. Bundle Repeated Scripts

Inspect execution transcripts and apply the observed signal directly:

| Signal | Action |
|---|---|
| All three of three tests create the same helper script | Bundle it under `scripts/`. |
| Every run performs the same `pip install` or `npm install` | Declare a dependency-installation step. |
| Every run repeats the same multistep approach | Put the standard procedure in the skill body. |
| Runs hit similar errors and apply the same workaround | Document the known problem and resolution. |

Execute-test every bundled script.

## 7. Evaluation Schemas

Use stable schemas when skills exchange evaluation data.

### `eval_metadata.json`

```json
{
  "eval_id": 0,
  "eval_name": "descriptive-name-here",
  "prompt": "The user's task prompt",
  "assertions": [
    "The deliverable contains X",
    "A file was created in format Y"
  ]
}
```

### `grading.json`

```json
{
  "expectations": [
    {
      "text": "The deliverable contains Seoul",
      "passed": true,
      "evidence": "Step 3 extracts Seoul regional data"
    }
  ],
  "summary": {"passed": 2, "failed": 1, "total": 3, "pass_rate": 0.67}
}
```

Use the exact keys `text`, `passed`, and `evidence`; do not substitute variants such as `name`, `met`, or `details`.

### `timing.json`

```json
{"total_tokens": 84852, "duration_ms": 23332, "total_duration_seconds": 23.3}
```

Record host-reported token and duration values with the run ID. Leave unavailable usage unmeasured and follow the host's recovery contract.

## 8. Exclude Incidental Material

Do not add README, CHANGELOG, or installation guides inside a skill unless its contract requires them. Exclude creation history, evaluation results, user manuals, and generic knowledge the agent already has.

## 9. Audit Existing Skills and AGENTS.md

When asked only for an audit, report findings and proposed corrections without editing. When optimization is authorized, edit the stated scope and verify it. Do not repeatedly ask for approval for already authorized, reversible edits. Preserve boundaries for publishing, sending messages, and destructive work.

| Target | Judgment | Evidence |
|---|---|---|
| Description | Keep real invocation situations; remove domain-wide claims, unconditional invocation, and long synonym lists. | Requests that should select it and adjacent requests that should not |
| Multi-workflow entry point | Retain only decisions and references required for the selected branch. | A request does not load unrelated references. |
| Detailed procedure | Preserve project-specific contracts and failure causes; reduce explanations of ordinary model capability. | Whether removed text prevented an observed failure |
| AGENTS.md | Scope repository reads, test breadth, and intermediate review to task conditions. | A typo and a behavior change receive appropriately different checks. |
| Completion and approval | Require implementation, execution, result inspection, and failure repair within authorized scope. | The agent neither stops after a first edit nor exceeds approval. |
| Model and host differences | Do not turn one model's observed needs into a universal procedure. | Recorded host, model, reasoning effort, and observations |

An audit result identifies file location, a triggering request, instruction cost, whether to retain, shorten, conditionally move, or remove it, and the validation needed. Do not reduce a skill to links or erase safety and data-preservation contracts. Passing wording or size checks does not prove model utility.

Use matched before/after inputs from `skill-testing-guide.md` to observe routing accuracy, output correctness, irrelevant reads, repeated checks, unnecessary approval, and premature stopping. Without comparative model runs, report structural improvement only; leave speed and quality gains unmeasured. Select checks for the changed decision boundary rather than forcing a full benchmark after every wording edit.

The model-specific discussion was informed by
[Eric Provencher, "Rethinking skills and prompts for GPT-6 Astra," 2026-09-05](https://x.com/pvncher/status/2095991462416490862).
Treat it as the author's dated experience, not a permanent model guarantee.
