# Team Operations — size, handoffs, follow-ups, and evolution

`SKILL.md` covers what to split and how to verify returned work. This reference
collects **quantified operating rules**: team size, the data and channels used
between members, what to rerun on a second execution, and where feedback belongs.

## Phase selection matrix

Do not repeat every phase when extending an existing team harness. Here, phases
refer to **building** the harness: 1 domain analysis, 2 team architecture,
3 agent definitions, 4 skills, 5 integration and orchestration, 6 validation and
testing. Phase 0 audits the current state and always comes first.

| Change | Phase 1 | Phase 2 | Phase 3 | Phase 4 | Phase 5 | Phase 6 |
|--------|---------|---------|---------|---------|---------|---------|
| Add an agent | Skip; use Phase 0 results | Placement only | Required | If a dedicated skill is needed | Update orchestrator | Required |
| Add or modify a skill | Skip | Skip | Skip | Required | If connections change | Required |
| Change architecture | Skip | Required | Affected agents only | Affected skills only | Required | Required |

Adding an agent extends definitions, so Phase 3 is required. Adding or modifying
a skill changes behavior, so only Phase 4 is inherently required. Architecture
changes reopen Phase 2 because a new arrangement affects everything beneath it.

## Team size guidelines

| Workload | Suggested members | Tasks per member |
|----------|-------------------|------------------|
| Small: 5–10 tasks | 2–3 | 3–5 |
| Medium: 10–20 tasks | 3–5 | 4–6 |
| Large: 20+ tasks | 5–7 | 4–5 |

> Coordination overhead grows with team size. Three focused members are better
> than five distracted members.

The third column is the practical constraint. Below three tasks per member,
briefing costs more than execution; above six, one member becomes a bottleneck.

## Data handoff protocol

Declare inter-agent data channels in the orchestrator:

| Strategy | Mechanism | Mode | Suitable for |
|----------|-----------|------|--------------|
| **Messages** | Direct member communication with `SendMessage` | Team | Live coordination, feedback, lightweight status |
| **Tasks** | Shared task state with `TaskCreate`/`TaskUpdate` | Team | Progress, dependencies, work requests |
| **Files** | Read and write agreed paths | Team + subagents | Large data, structured artifacts, audit trails |
| **Return values** | Return message from the `Agent` tool | Subagents | Main agent directly collecting results |

**Suggested team combination:** tasks for coordination + files for artifacts +
messages for live communication.
**Suggested subagent combination:** return values for results + files for large
artifacts.
**Hybrid:** use the combination appropriate to each phase's execution mode.

Files work in both modes. Artifact paths therefore survive a mode change, and
files connect phases in a hybrid workflow.

Rules for file handoffs:

- Store intermediate artifacts in `_workspace/` beneath the working directory.
- Name files `{phase}_{agent}_{artifact}.{ext}`, for example `01_analyst_requirements.md`.
- Write only final artifacts to the user-specified output path. Preserve
  `_workspace/` intermediates for later verification and audit tracing.

Deleting intermediates removes the means to reconstruct which agent produced
which result from which evidence, even though the working directory looks clean.

## Detecting follow-up runs

The orchestrator must handle follow-ups as well as initial execution. At startup,
check existing artifacts and the request type to select the execution mode:

- `_workspace/` exists + partial modification requested: **partial rerun**; call only affected agents.
- `_workspace/` exists + new input supplied: **new run**; move the old workspace to `_workspace_prev/`.
- `_workspace/` does not exist: **initial run**.

Both dimensions matter. Workspace existence alone conflates partial and new runs;
request type alone may try to read nonexistent artifacts on an initial run.

Move existing results instead of overwriting them so the previous version remains
available for comparison. `references/orchestrator-template.md` implements the
same rule with a timestamp suffix, `_workspace_{YYYYMMDD_HHMMSS}/`.

Follow-ups also need two activation provisions:

1. **Include follow-up keywords in the orchestrator description:** "다시 실행",
   "재실행", "업데이트", "수정", "보완", "{도메인}의 {부분작업}만 다시",
   "이전 결과 기반으로". Initial-creation keywords alone miss follow-up requests.
2. **Include recall instructions in agent definitions:** read existing result
   files, incorporate improvements, and modify only the portions addressed by
   user feedback.

## Where feedback belongs

| Feedback type | Change target | Example |
|---------------|---------------|---------|
| Artifact quality | The agent's skill | "Analysis is too shallow": add depth criteria |
| Agent role | Agent definition `.md` | "Security review is needed": add an agent |
| Workflow order | Orchestrator skill | "Validate first": reorder phases |
| Team composition | Orchestrator + agents | "These two can be combined": merge agents |
| Missing trigger | Skill description | "This wording does not activate it": extend the description |

Routing every quality complaint to the orchestrator repeatedly distorts the
workflow while leaving the actual quality problem untouched.

## Evolution triggers

Suggest harness improvements not only when the user explicitly asks for them,
but also when:

- The same feedback type recurs at least twice.
- An agent repeatedly fails in the same pattern.
- The user bypasses the orchestrator and performs its work manually.

The last signal can be silent: doing the work manually without complaining may
be the strongest evidence that the harness is not earning its cost.

## Operation and maintenance workflow

Systematically inspect, change, and synchronize an existing harness.

**Step 1: Audit current state**
- Compare `.claude/agents/` files with the orchestrator's agent roster and list mismatches.
- Compare `.claude/skills/` directories with the orchestrator's skill roster and list mismatches.
- Report the audit results to the user.

**Step 2: Incremental additions and changes**
- Add, modify, or remove agents and skills according to the user's request.
- Make one change at a time and immediately perform Step 3 to synchronize records.

**Step 3: Update change history**
- Record the date, change, target, and reason in the change-history table.

**Step 4: Validate changes**
- Validate the structure of modified agents and skills.
- Validate triggers when the changed scope affects activation.
- For major changes, including architecture changes or adding/removing three or
  more agents, also perform execution tests and a dry run.
- Finally verify that records match the actual files.

Skipping Step 3 after a modification creates a mismatch in the next audit because
the implementation and its record no longer agree.
