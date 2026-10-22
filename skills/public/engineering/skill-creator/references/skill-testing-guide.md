# Skill Testing and Iteration Guide

Use qualitative review and quantitative assertions together to validate and improve a skill written with `author`.

## Table of Contents

1. [Testing Model](#1-testing-model)
2. [Write Realistic Test Prompts](#2-write-realistic-test-prompts)
3. [Compare With-Skill and Baseline Runs](#3-compare-with-skill-and-baseline-runs)
4. [Score Objective Claims](#4-score-objective-claims)
5. [Evaluation Roles](#5-evaluation-roles)
6. [Iterate](#6-iterate)
7. [Validate Description Triggers](#7-validate-description-triggers)
8. [Workspace Layout](#8-workspace-layout)

## 1. Testing Model

| Evaluation | Method | Suitable work |
|---|---|---|
| Qualitative | A user reviews the deliverable | Style, design, and other subjective quality |
| Quantitative | Automated assertion scoring | File creation, extraction, code generation, and other objective checks |

The core loop is **write -> execute -> evaluate -> improve -> retest**.

## 2. Write Realistic Test Prompts

### Principles

A test prompt should resemble a concrete, natural user request. Abstract commands such as "process a PDF" or "generate a chart" provide little value. Include realistic file names, columns, constraints, and awkward details:

### Bad Examples

```text
"Process a PDF."
"Extract data."
"Generate a chart."
```

### Good Examples

```text
In Q4_sales_final_v2.xlsx from Downloads, use columns C (revenue) and D
(cost) to add a profit-margin percentage, then sort descending by margin.
```

```text
Extract the table on page 3 of this PDF as CSV. The table has a two-row
header: categories on the first row and actual column names on the second.
```

### Prompt Variety

Include all of the following forms:

- formal and casual tone;
- explicit and implied intent, including cases that require inference from context;
- simple and compound tasks; and
- abbreviations, plausible typos, and casual phrasing.

### Coverage

Begin with 2-3 prompts that cover one central use case, one edge case, and
optionally one compound task.

## 3. Compare With-Skill and Baseline Runs

### 3-1. Comparison Run Structure

Run both arms only when a comparison answers a real question. Pin the same tools, permissions, completion criteria, host, model, and reasoning effort. Do not show either arm the other's result. Run in parallel only when delegation is authorized and capacity exists; otherwise use isolated sequential runs.

```text
With-skill run:
  prompt: {test prompt}
  skill path: {skill path}
  output path: _workspace/iteration-N/eval-{id}/with_skill/outputs/
```

```text
Baseline run:
  prompt: {same test prompt}
  skill: none for a new skill, or a preserved pre-change snapshot
  output path: _workspace/iteration-N/eval-{id}/without_skill/outputs/
```

### 3-2. Select the Baseline

| Situation | Baseline |
|---|---|
| Creating a new skill | Run the same prompt without the skill. |
| Improving an existing skill | Preserve and run the pre-change skill snapshot. |

### 3-3. Capture Timing Data

Capture host-provided `total_tokens` and `duration_ms` with run ID and model settings. Leave unavailable values unmeasured; never record estimates as observed usage. Compare latency and cost only under matched conditions.

```json
{"total_tokens": 84852, "duration_ms": 23332, "total_duration_seconds": 23.3}
```

## 4. Score Objective Claims

### 4-1. Write Assertions

Write assertions that are objectively decidable, have descriptive names, and
test the skill's central value.

Good assertions:

- can be decided true or false from the artifact;
- make the checked behavior clear from the name; and
- measure the skill's central value.

Bad assertions pass regardless of the skill, such as merely confirming an
output exists, or disguise a subjective claim such as "well written" as a
Boolean test.

### 4-2. Prefer Programmable Verification

When an assertion can be evaluated by code, write a reusable script. An
assertion that both configurations pass 100% of the time is non-discriminating;
remove it or make the case more demanding.

### 4-3. Reject Non-discriminating Assertions

Treat a check that passes both configurations at 100% as evidence that the check
does not measure the skill's differential value. Remove it or replace it with a
more demanding assertion.

### 4-4. Scoring Result Schema

```json
{
  "expectations": [
    {
      "text": "A profit-margin column is present",
      "passed": true,
      "evidence": "Column E is named profit_margin_pct"
    },
    {
      "text": "Rows are sorted by descending margin",
      "passed": false,
      "evidence": "Rows remain in source order"
    }
  ],
  "summary": {"passed": 1, "failed": 1, "total": 2, "pass_rate": 0.5}
}
```

## 5. Evaluation Roles

Use specialist roles when the evaluation warrants them:

### 5-1. Grader

A **grader**:

- decides each assertion with evidence;
- extracts and cross-checks verifiable factual claims from the output; and
- flags assertions that are too easy or ambiguous.

### 5-2. Comparator

- A **comparator** reviews anonymized A/B outputs without knowing which used the
  skill. Use it when the question is whether a new version is actually better.
  Judge content by accuracy and completeness, structure by organization,
  formatting, and usability, then record an overall score.

### 5-3. Analyzer

An **analyzer** finds:

- non-discriminating assertions that both configurations pass;
- high-variance evaluations whose results change materially between runs; and
- quality-versus-time or quality-versus-token tradeoffs.

## 6. Iterate

### 6-1. Collect Feedback

Show outputs to the user and collect feedback; an empty response to a requested review means no issue was identified. Generalize feedback into a principle rather than overfitting one prompt. Remove instructions that transcripts show are unproductive. Understand why a concise correction matters and encode that reason. If every run creates the same helper, bundle it under `scripts/`.

### 6-2. Improvement Principles

1. Generalize feedback into a principle instead of fitting one test example.
2. Remove instructions that transcripts show produce no useful work.
3. Explain why the feedback matters and encode that understanding.
4. Bundle helpers that every test run recreates.

### 6-3. Iteration Procedure

```text
1. Revise the skill.
2. Rerun every test in a new iteration-N+1 directory.
3. Show the results beside the previous iteration.
4. Collect feedback.
5. Revise and repeat.
```

### 6-4. Draft and Rereview

Stop when the user is satisfied, all requested feedback is resolved, or no meaningful improvement remains. After drafting a revision, reread it from a fresh perspective and improve it before treating it as final.

## 7. Validate Description Triggers

### 7-1. Write Trigger Evaluation Queries

Create exactly 20 queries: 10 that should trigger and 10 near misses that
should not. Use concrete, natural requests with varied length, tone, format,
paths, company names, and column names. Focus on boundaries instead of
obviously unrelated prompts.

The positive group should contain 8-10 varied expressions of the same intent,
implicit need, less common use cases, and competition where this skill should
win. The negative group should contain 8-10 near misses with overlapping
keywords where a neighboring skill or ordinary tool is more appropriate.

### 7-2. Check Conflicts with Existing Skills

Collect existing skill descriptions and test for routing conflicts. When a query routes incorrectly, sharpen the boundary condition in the new description.

### 7-3. Optional Automated Optimization

For optional automated optimization, split the 20 queries into 60% training
and 40% held-out test sets. Measure the current description, revise from training
failures, and select the best description using the test set rather than training
accuracy. Limit the loop to five iterations and run it only after the skill itself
is stable because model-driven optimization is expensive. This can be automated
with a script that invokes `claude -p`; record the cost and do not run it as a
routine edit-time check.

## 8. Workspace Layout

```text
{skill-name}-workspace/
|-- iteration-1/
|   |-- eval-descriptive-name-1/
|   |   |-- eval_metadata.json
|   |   |-- with_skill/
|   |   |   |-- outputs/
|   |   |   |-- timing.json
|   |   |   `-- grading.json
|   |   `-- without_skill/
|   |       |-- outputs/
|   |       |-- timing.json
|   |       `-- grading.json
|   `-- benchmark.json
|-- iteration-2/
`-- evals/evals.json
```

Use descriptive evaluation directory names such as
`eval-multi-page-table-extraction`, preserve each iteration independently
without overwriting earlier runs, and keep `_workspace/` for later verification
and audit.
