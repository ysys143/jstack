# Agent Team Design Patterns

## Execution modes: agent teams and subagents

Understand the core differences before selecting a mode.

### Agent teams — default mode

The leader creates a team with `TeamCreate`. Members run as independent Claude
Code instances, communicate directly with `SendMessage`, and coordinate through
a shared task list (`TaskCreate`/`TaskUpdate`).

```
[Leader] ←→ [Member A] ←→ [Member B]
   ↕           ↕             ↕
   └──────── Shared tasks ───┘
```

**Core tools:**
- `TeamCreate`: create the team and spawn members.
- `SendMessage({to: name})`: message a specific member.
- `SendMessage({to: "all"})`: broadcast; expensive, use sparingly.
- `TaskCreate`/`TaskUpdate`: manage shared tasks.

**Properties:**
- Members can discuss, challenge, and verify each other's work directly.
- Information can pass between members without the leader.
- Members coordinate and request work through the shared task list.
- The leader is automatically notified when a member becomes idle.
- Plan approval mode permits review before risky work.

**Constraints:**
- Only one team may be **active** per session; a team can be dissolved and
  replaced between phases.
- Teams cannot nest: members cannot create their own teams.
- Leadership is fixed and cannot be transferred.
- Token cost is high.

**Team reconfiguration:**
When different phases need different experts, save the previous team's artifacts
to files, clean up the team, then create its replacement. Results preserved in
`_workspace/` remain readable by the new team.

### Subagents — lightweight mode

The main agent creates subagents with `Agent`. They return results only to the
main agent and do not communicate with each other.

```
[Main] → [Subagent A] → return result
       → [Subagent B] → return result
       → [Subagent C] → return result
```

**Core tool:**
- `Agent(prompt, subagent_type, run_in_background)`: create a subagent.

**Properties:**
- Lightweight and fast.
- Results return as summaries to the main context.
- Token efficient.

**Constraints:**
- No communication between subagents.
- The main agent handles all coordination.
- No live collaboration or challenges between workers.

### Mode selection decision tree

```
Are there at least two agents?
├── Yes → Do they need to communicate?
│         ├── Yes → Agent team (default)
│         │         Cross-checks, shared discoveries, and live feedback.
│         └── No → Subagents are also suitable
│                  Producer-reviewer or expert pools needing only result handoff.
└── No → Subagent
         A single worker does not need a team.
```

> **Core principle:** agent teams are the default. Before selecting subagents,
> ask whether communication between members is truly unnecessary.

---

## Team architectures

### 1. Pipeline

Sequential flow: one agent's output becomes the next agent's input.

```
[Analysis] → [Design] → [Implementation] → [Verification]
```

**Suitable when:** each stage strongly depends on the preceding artifact.
**Example:** novel writing: worldbuilding, characters, plot, drafting, editing.
**Caution:** a bottleneck delays the entire pipeline. Make stages as independent
as possible.
**Team suitability:** strong sequential dependencies limit the benefits of teams,
but a team helps when the pipeline contains parallel sections.

### 2. Fan-out/Fan-in

Run independent work in parallel, then integrate the results.

```
             ┌→ [Expert A] ─┐
[Distribute] ├→ [Expert B] ─┼→ [Integrate]
             └→ [Expert C] ─┘
```

**Suitable when:** the same input needs analysis from different domains or perspectives.
**Example:** research official, media, community, and background sources concurrently,
then assemble a report.
**Caution:** integration quality determines overall quality.
**Team suitability:** this is the most natural team pattern. **Use an agent team.**
Members share discoveries and challenge one another; one finding can redirect
another member's investigation in real time and improve on isolated research.

### 3. Expert pool

Select the appropriate expert for the situation.

```
[Router] → { Expert A | Expert B | Expert C }
```

**Suitable when:** input types require different processing.
**Example:** invoke only the relevant security, performance, or architecture
specialist for a code review.
**Caution:** routing accuracy is critical.
**Team suitability:** subagents fit better because only needed experts run;
a permanent team is unnecessary.

### 4. Producer-Reviewer

A producer and reviewer work as a pair.

```
[Produce] → [Review] → if issues remain → [Produce] again
```

**Suitable when:** quality assurance matters and objective criteria exist.
**Example:** a webtoon artist creates panels, a reviewer checks them, and faulty
panels are regenerated.
**Caution:** set a maximum of 2–3 retries to prevent an endless loop.
**Team suitability:** a team supports direct producer-reviewer feedback through
`SendMessage`.

### 5. Supervisor

A central agent tracks state and dynamically assigns work to workers.

```
               ┌→ [Worker A]
[Supervisor] ──┼→ [Worker B]  ← assignments adapt to observed state
               └→ [Worker C]
```

**Suitable when:** workload varies or assignments must be made at runtime.
**Example:** for a large code migration, the supervisor analyzes the file list
and assigns batches to workers.
**Difference from fan-out:** fan-out fixes assignments in advance; a supervisor
adjusts them according to progress.
**Caution:** use sufficiently large delegation units to avoid a supervisor bottleneck.
**Team suitability:** shared tasks fit this pattern naturally. Register work with
`TaskCreate` and let members request tasks.

### 6. Hierarchical delegation

Higher-level agents recursively delegate and decompose complex problems.

```
[Coordinator] → [Lead A] → [Worker A1]
                         → [Worker A2]
              → [Lead B] → [Worker B1]
```

**Suitable when:** the problem naturally decomposes into a hierarchy.
**Example:** full-stack development: coordinator, frontend lead with UI/logic/test
workers, and backend lead with API/database/test workers.
**Caution:** three or more levels increase latency and context loss. Prefer at
most two levels.
**Team suitability:** teams cannot nest. Use a team at the first level and
subagents at the second, or flatten the hierarchy into one team.

## Composite patterns

Real workflows often combine patterns:

| Pattern | Structure | Example |
|---------|-----------|---------|
| **Fan-out + producer-reviewer** | Parallel production, each result reviewed | Translate four languages concurrently, then use a native reviewer for each |
| **Pipeline + fan-out** | Parallelize selected sequential stages | Sequential analysis, parallel implementation, sequential integration testing |
| **Supervisor + expert pool** | Supervisor dynamically selects experts | Classify customer inquiries and assign appropriate experts |

### Execution modes for composite patterns

**Use agent teams by default for composite patterns.** Active communication
between members is a primary contributor to result quality.

| Scenario | Recommended mode | Reason |
|----------|------------------|--------|
| **Research + analysis** | Agent team | Share discoveries and discuss conflicting evidence live |
| **Design + implementation + verification** | Agent team | Feedback between designer, implementer, and verifier |
| **Supervisor + workers** | Agent team | Dynamic shared-task assignment and worker progress sharing |
| **Production + review** | Agent team | Direct feedback reduces rework |

> Mix in subagents only for completely isolated, one-off work by a single agent.

## Selecting agent types

Set `subagent_type` when invoking `Agent`. Team members can also use custom agent
definitions.

### Built-in types

| Type | Tool access | Suitable use |
|------|-------------|--------------|
| `general-purpose` | All tools, including WebSearch and WebFetch | Web research and general work |
| `Explore` | Read only; no Edit/Write | Codebase exploration and analysis |
| `Plan` | Read only; no Edit/Write | Architecture and planning |

### Custom types

Define an agent in `.claude/agents/{name}.md` and invoke it with
`subagent_type: "{name}"`. Custom agents have access to all tools.

### Selection criteria

| Situation | Recommendation | Reason |
|-----------|----------------|--------|
| Complex role reused across sessions | **Custom type** in `.claude/agents/` | Keep persona and operating principles in a file |
| Simple research or collection fully described by a prompt | **`general-purpose`** with a detailed prompt | No dedicated agent file needed for the instructions |
| Read-only analysis or review | **`Explore`** | Prevent accidental file edits |
| Design or planning only | **`Plan`** | Focus on analysis and prevent code changes |
| Implementation requiring file edits | **Custom type** | Full tools plus specialized instructions |

**Principle:** define every agent in `.claude/agents/{name}.md`. Even for built-in
types, create a definition describing the role, principles, and protocol. Files
support reuse in later sessions; explicit team communication protocols support
collaboration quality.

**Model:** use the supported model selected by the `models` routing contract.
Record the selected model and reason in `Agent` calls; no model is mandatory
for every role. Preserve explicit user choices and current host restrictions.

## Agent definition structure

```markdown
---
name: agent-name
description: "One or two sentences describing the role. List trigger keywords."
---

# Agent Name — one-line role summary

You are a [role] specialist in [domain].

## Core responsibilities
1. Responsibility 1
2. Responsibility 2

## Operating principles
- Principle 1
- Principle 2

## Input/output protocol
- Input: [what arrives from where]
- Output: [what is written where]
- Format: [file format and structure]

## Team communication protocol (agent team mode)
- Receive: [message types and senders]
- Send: [message types and recipients]
- Request work: [task types to request from the shared list]

## Error handling
- [Behavior on failure]
- [Behavior on timeout]

## Collaboration
- Relationships with other agents
```

## Criteria for separating agents

| Criterion | Separate | Combine |
|-----------|----------|---------|
| Expertise | Different domains | Overlapping domains |
| Parallelism | Independent execution possible | Consider combining sequential dependencies |
| Context | High context burden | Lightweight, quick work |
| Reuse | Useful in other teams | Consider combining team-specific roles |

## Skills versus agents

| Aspect | Skill | Agent |
|--------|-------|-------|
| Definition | Procedural knowledge and tool bundle | Expert persona and operating principles |
| Location | `.claude/skills/` | `.claude/agents/` |
| Activation | User-request keyword matching | Explicit invocation through Agent |
| Size | Small to large workflow | Small role definition |
| Purpose | How to do the work | Who does the work |

A skill is a **procedural guide** an agent consults while working.
An agent is an **expert role definition** that uses skills.

## Connecting skills and agents

| Method | Implementation | Suitable when |
|--------|----------------|---------------|
| **Skill tool invocation** | Tell the agent to invoke `/skill-name` with Skill | The skill is an independent, user-invocable workflow |
| **Inline prompt** | Include skill content directly in the agent definition | The skill is short, at most 50 lines, and dedicated to this agent |
| **Reference loading** | Read files under the skill's references/ only when needed | Content is large and conditionally needed |

Prefer the Skill tool for reusable workflows, inline content for dedicated short
instructions, and reference loading for large material.
