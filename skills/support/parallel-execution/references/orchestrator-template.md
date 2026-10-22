# Orchestrator Skill Templates

An orchestrator is a top-level skill that coordinates the entire team. Three templates are provided for different execution modes:

- **Template A: Agent team mode (default)** — the first choice when two or more agents collaborate
- **Template B: Subagent mode (alternative)** — use when team communication is unnecessary
- **Template C: Hybrid mode** — combine modes phase by phase

---

## Template A: Agent Team Mode (Default and First Choice)

This is the default mode to consider first when two or more agents collaborate. Create the team with `TeamCreate`, and coordinate it through a shared task list and `SendMessage`.

```markdown
---
name: {domain}-orchestrator
description: "Coordinates a {domain} agent team. {initial-run keywords}. You must also use this skill for follow-up requests to revise {domain} results, rerun part of the work, update, supplement, run again, or improve earlier results."
---

# {Domain} Orchestrator

An integrated skill that coordinates a {domain} agent team to produce {final deliverable}.

## Execution Mode: Agent Team

## Agent Roster

| Teammate | Agent type | Role | Skill | Output |
|----------|------------|------|-------|--------|
| {teammate-1} | {custom or built-in} | {role} | {skill} | {output-file} |
| {teammate-2} | {custom or built-in} | {role} | {skill} | {output-file} |
| ... | | | | |

## Workflow

### Phase 0: Inspect Context (Support Follow-up Work)

Check whether an existing deliverable is present, then choose the run type:

1. Check whether the `_workspace/` directory exists.
2. Choose the run type:
   - **No `_workspace/`** → Initial run. Continue to Phase 1.
   - **`_workspace/` exists and the user requests a partial revision** → Partial rerun. Invoke only the affected agent and overwrite only the deliverable being revised.
   - **`_workspace/` exists and the user provides new input** → New run. Move the existing `_workspace/` to `_workspace_{YYYYMMDD_HHMMSS}/`, then continue to Phase 1.
3. For a partial rerun, include the path to the previous deliverable in the agent prompt. Instruct the agent to read the existing result and apply the feedback.

### Phase 1: Prepare
1. Analyze the user input — {what to identify}.
2. Create `_workspace/` in the working directory.
   - **Initial run:** Create a new `_workspace/`.
   - **New run:** Immediately after moving the existing `_workspace/` to an archive directory, create a new `_workspace/`.
3. Save the input data under `_workspace/00_input/`.

### Phase 2: Create the Team

1. Create the team:
   ```
   TeamCreate(
     team_name: "{domain}-team",
     members: [
       { name: "{teammate-1}", agent_type: "{type}", model: "{selected-model}", prompt: "{role description and work instructions}" },
       { name: "{teammate-2}", agent_type: "{type}", model: "{selected-model}", prompt: "{role description and work instructions}" },
       ...
     ]
   )
   ```

2. Register tasks:
   ```
   TaskCreate(tasks: [
     { title: "{task-1}", description: "{details}", assignee: "{teammate-1}" },
     { title: "{task-2}", description: "{details}", assignee: "{teammate-2}" },
     { title: "{task-3}", description: "{details}", depends_on: ["{task-1}"] },
     ...
   ])
   ```

   > Five to six tasks per teammate is an appropriate load. Declare dependent work with `depends_on`.

### Phase 3: {Primary Work — for example, Research, Generation, or Analysis}

**Execution method:** Teammates coordinate among themselves.

Teammates claim work from the shared task list and perform it independently.
The leader monitors progress and intervenes when necessary.

**Communication rules between teammates:**
- {teammate-1} sends {what information} to {teammate-2} with `SendMessage`.
- When {teammate-2} completes its work, it saves the result to a file and informs the leader.
- When a teammate needs another teammate's result, it requests that result with `SendMessage`.

**Save deliverables:**

| Teammate | Output path |
|----------|-------------|
| {teammate-1} | `_workspace/{phase}_{teammate-1}_{artifact}.md` |
| {teammate-2} | `_workspace/{phase}_{teammate-2}_{artifact}.md` |

**Leader monitoring:**
- Receive an automatic notification when a teammate becomes idle.
- When a specific teammate is blocked, provide instructions with `SendMessage` or reassign the work.
- Check overall progress with `TaskGet`.

### Phase 4: {Follow-up Work — for example, Validation or Integration}
1. Wait for every teammate's work to finish, checking status with `TaskGet`.
2. Collect each teammate's deliverable with `Read`.
3. Apply {integration or validation logic}.
4. Produce the final deliverable at `{output-path}/{filename}`.

### Phase 5: Clean Up
1. Ask teammates to shut down with `SendMessage`.
2. Clean up the team with `TeamDelete`.
3. Preserve the `_workspace/` directory. Do not delete intermediate deliverables; they are required for later verification and an audit trail.
4. Report a summary of the result to the user.

> **When the team must be reconfigured:** If different phases require different combinations of specialists, clean up the current team with `TeamDelete`, then create a new team with `TeamCreate` for the next phase. Because the earlier team's deliverables remain in `_workspace/`, the new team can access them with `Read`.

## Data Flow

```
[Leader] → TeamCreate → [teammate-1] ←SendMessage→ [teammate-2]
                          │                           │
                          ↓                           ↓
                    artifact-1.md              artifact-2.md
                          │                           │
                          └───────── Read ────────────┘
                                     ↓
                           [Leader: integration]
                                     ↓
                            Final deliverable
```

## Error Handling

| Situation | Strategy |
|-----------|----------|
| One teammate fails or stops | The leader detects it → requests status with `SendMessage` → restarts the teammate or creates a replacement |
| A majority of teammates fail | Inform the user and ask whether to continue |
| Timeout | Use the partial results collected so far and stop unfinished teammates |
| Data conflicts between teammates | Preserve both versions and identify their sources; do not delete either version |
| Task status is delayed | The leader checks with `TaskGet`, then corrects the status manually with `TaskUpdate` |

## Test Scenarios

### Normal Flow
1. The user provides {input}.
2. Phase 1 produces {analysis result}.
3. Phase 2 creates the team ({N} teammates and {M} tasks).
4. In Phase 3, teammates coordinate among themselves and perform the work.
5. Phase 4 integrates the deliverables and produces the final result.
6. Phase 5 cleans up the team.
7. Expected result: `{output-path}/{filename}` exists.

### Error Flow
1. In Phase 3, {teammate-2} stops because of an error.
2. The leader receives an idle notification.
3. The leader requests status with `SendMessage` and attempts a restart.
4. If the restart fails, reassign {teammate-2}'s work to {teammate-1}.
5. Continue to Phase 4 with the remaining results.
6. State "Part of {teammate-2}'s area was not collected" in the final report.
```

---

## Template B: Subagent Mode (Alternative)

Use this mode when team communication overhead is unnecessary. Invoke agents directly with the `Agent` tool and collect results from their return values.

```markdown
---
name: {domain}-orchestrator
description: "Coordinates {domain} agents. {initial-run keywords}. Include follow-up work keywords."
---

## Execution Mode: Subagents

## Agent Roster

| Agent | subagent_type | Role | Skill | Output |
|-------|---------------|------|-------|--------|
| {agent-1} | {built-in or custom} | {role} | {skill} | {output-file} |
| {agent-2} | ... | ... | ... | ... |

## Workflow

### Phase 0: Inspect Context
(Same as Template A — branch according to whether `_workspace/` exists.)

### Phase 1: Prepare
1. Analyze the input.
2. Create `_workspace/` for an initial run, or immediately after moving the old `_workspace/` to an archive directory for a new run.

### Phase 2: Run in Parallel
Invoke N `Agent` tools concurrently in a single message:
For every call, specify `name`, `subagent_type`, `prompt`, `model`, and `run_in_background: true`.

| Agent | Input | Output | model | run_in_background |
|-------|-------|--------|-------|-------------------|
| {agent-1} | {source} | `_workspace/{phase}_{agent}_{artifact}.md` | {selected-model} | true |
| {agent-2} | {source} | `_workspace/{phase}_{agent}_{artifact}.md` | {selected-model} | true |

### Phase 3: Integrate
1. Collect the return value from every agent.
2. Collect file-based deliverables with `Read`.
3. Apply the integration logic and produce the final deliverable.

### Phase 4: Clean Up
1. Preserve `_workspace/`.
2. Report a summary of the result.

## Error Handling
- One agent fails: Retry once. If it fails again, identify the omission and continue.
- A majority of agents fail: Inform the user and ask whether to continue.
- Timeout: Use the partial results collected so far.
```

---

## Template C: Hybrid Mode

Use a different execution mode for each phase. At the top of every phase, state `**Execution mode:** {team | subagent}`.

```markdown
---
name: {domain}-orchestrator
description: "A hybrid {domain} orchestrator. {keywords}. Include follow-up work keywords."
---

## Execution Mode: Hybrid

| Phase | Mode | Reason |
|-------|------|--------|
| Phase 2 (parallel collection) | Subagents | Independent data collection; no team communication required |
| Phase 3 (consensus integration) | Agent team | Conflicting data requires discussion and agreement |
| Phase 4 (independent validation) | Subagent | One QA agent performs an objective validation |

## Workflow

### Phase 2: Parallel Data Collection
**Execution mode:** Subagents

Invoke N agents in parallel with the `Agent` tool in a single message (`run_in_background: true`).
Save each result to `_workspace/02_{agent}_raw.md`.

### Phase 3: Consensus-based Integration
**Execution mode:** Agent team

1. Create an integration team with `TeamCreate` (editor + fact-checker + synthesizer).
2. Distribute work with `TaskCreate`. Every teammate reads the Phase 2 `_workspace/02_*` files.
3. Teammates discuss conflicting data with `SendMessage` and produce a file-based consensus result.
4. Produce the final integrated file at `_workspace/03_integrated.md`.
5. Clean up the team with `TeamDelete`.

### Phase 4: Independent Validation
**Execution mode:** Subagent

Give `_workspace/03_integrated.md` to one QA subagent and have it produce a validation report.
```

**Hybrid transition rules:**
- Team → subagent: Always clean up the team with `TeamDelete` before invoking the `Agent` tool.
- Subagent → team: Give teammates the subagents' file deliverables as `Read` paths.
- Team → team: Clean up the previous team, then call `TeamCreate` for the new team. Only one team can be active per session.

---

## Writing Principles

1. **State the execution mode first** — At the top of the orchestrator, state one of "agent team," "subagents," or "hybrid." A hybrid must include a phase-by-phase mode table.
2. **In team mode, specify `TeamCreate`, `SendMessage`, and `TaskCreate` usage concretely** — Include team composition, task registration, and communication rules.
3. **In subagent mode, specify every `Agent` tool parameter** — `name`, `subagent_type`, `prompt`, `run_in_background`, and `model`.
4. **Make file paths absolute** — Do not use relative paths; clearly anchor paths under `_workspace/`.
5. **Declare dependencies between phases** — State which phase depends on which earlier result. In a hybrid, emphasize each mode transition.
6. **Make error handling realistic** — Do not assume that everything succeeds.
7. **Test scenarios are required** — Include at least one normal scenario and one error scenario.

## Follow-up Keywords in the Description

Initial-run keywords alone are insufficient in an orchestrator description. It must include the following kinds of follow-up expressions:

- Rerun, run again, update, revise, and supplement
- "Repeat only part of {domain}"
- "Build on previous results" and "improve the result"
- Common requests for the domain, such as "launch," "promotion," and "trending" for a launch-strategy harness

Without follow-up keywords, the harness becomes effectively dead code after its first run.

## Reference Orchestrator

The basic structure of a fan-out/fan-in orchestrator is:
prepare → Phase 0 (inspect context) → `TeamCreate` + `TaskCreate` → N teammates run in parallel → `Read` + integrate → clean up.
See the research-team example in `references/team-examples.md`.
