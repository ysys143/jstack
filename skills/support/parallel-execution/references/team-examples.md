# Agent Team Examples

## Example 1: Research Team

**Architecture:** fan-out/fan-in. **Mode:** agent team.

```text
[Leader/orchestrator]
    |-- TeamCreate(research-team)
    |-- TaskCreate(four research tasks)
    |-- Teammates coordinate with SendMessage
    |-- Collect results with Read
    `-- Produce a consolidated report
```

| Teammate | Agent type | Role | Output |
|---|---|---|---|
| official-researcher | general-purpose | Official documentation and blogs | research_official.md |
| media-researcher | general-purpose | Media and investment | research_media.md |
| community-researcher | general-purpose | Community and social media | research_community.md |
| background-researcher | general-purpose | Background, competition, and research | research_background.md |
| Leader/orchestrator | - | Consolidation | consolidated-report.md |

Define every research agent in `.claude/agents/{name}.md`, even when it uses the built-in `general-purpose` type. State its role, research scope, and communication protocol so it can be reused and collaborate consistently.

```text
Phase 1: Preparation
  - Analyze the topic and requested research mode.
  - Create _workspace/.

Phase 2: Team creation
  - Create research-team with official, media, community, and background members.
  - Register one scoped task for each teammate.

Phase 3: Research
  - Teammates research independently.
  - They share useful discoveries and discuss conflicting evidence directly.
  - Each teammate saves its deliverable and notifies the leader.

Phase 4: Consolidation
  - The leader reads all four deliverables and produces one report.
  - The report cites both sources when evidence conflicts.

Phase 5: Cleanup
  - Request teammate shutdown, remove the team, and preserve _workspace/
    for later verification and audit.
```

### Team communication pattern

The official researcher sends newly discovered official statistics to the media
researcher. The media researcher sends interview details that need source
verification to the official researcher. The community researcher alerts the
media researcher when public reaction conflicts with press coverage. The
background researcher broadcasts historical context that changes how every
teammate should interpret the current evidence.

When evidence conflicts, the responsible researchers discuss it directly with
`SendMessage`, preserve both sourced versions when they cannot resolve it, and
notify the leader which point remains disputed.

## Example 2: Science-fiction Writing Team

**Architecture:** pipeline plus fan-out. **Mode:** agent team for collaborative phases and subagents for individual phases.

```text
Phase 1 (parallel): worldbuilder + character-designer + plot-architect
  -> coordinate consistency with SendMessage
Phase 2 (sequential): prose-stylist writes the draft
Phase 3 (parallel): science-consultant + continuity-manager review it
  -> share discoveries with SendMessage
Phase 4 (sequential): prose-stylist applies the reviews
```

| Teammate | Agent type | Role | Skills |
|---|---|---|---|
| worldbuilder | custom | World building | world-setting |
| character-designer | custom | Character design | character-profile |
| plot-architect | custom | Plot structure | outline |
| prose-stylist | custom | Prose editing and drafting | write-scene, review-chapter |
| science-consultant | custom | Scientific review | science-check |
| continuity-manager | custom | Continuity review | consistency-check |

### Full agent example: `worldbuilder.md`

````markdown
---
name: worldbuilder
description: "Designs science-fiction worlds, including physical laws, social structures, technology, and history."
---

# Worldbuilder

Build the physical, social, and technological foundations of a science-fiction story from scientific evidence while leaving room for imagination.

## Core responsibilities
1. Define physical laws and the level of technology.
2. Design social, political, and economic systems.
3. Establish history and current conflicts.
4. Describe each location's environment and atmosphere.

## Working principles
- Preserve internal consistency.
- Ask successive "If this technology existed, what would follow?" questions.
- Make the setting serve the story; omit detail that obstructs the plot.

## Input and output protocol
- Input: the user's setting concept and genre requirements
- Output: `_workspace/01_worldbuilder_setting.md`
- Format: Markdown sections for physics, society, technology, history, and locations

## Team communication protocol
- Send social structure, class, and occupation details to character-designer.
- Send central conflicts and hazards to plot-architect.
- Apply scientific corrections from science-consultant.
- Broadcast setting changes to every affected teammate.

## Error handling
- If the concept is ambiguous, offer three directions and ask the user to choose.
- When identifying a scientific error, propose an alternative with it.

## Collaboration
- Provide social-structure information to character-designer.
- Provide conflict-structure information to plot-architect.
- Apply science-consultant feedback when revising the setting.
```

### Detailed team workflow

```text
Phase 1: TeamCreate(team_name: "novel-team",
                    members: [worldbuilder, character-designer, plot-architect])
         TaskCreate([world building, character design, plot structure])
         -> teammates coordinate while working in parallel
         -> when worldbuilder completes the social structure,
            send it to character-designer with SendMessage
         -> when character-designer completes the protagonist,
            send it to plot-architect with SendMessage

Phase 2: Remove the Phase 1 team.
         Invoke prose-stylist as a subagent because drafting is individual work.
         Read all three Phase 1 artifacts from _workspace/.
         Write _workspace/02_prose_draft.md.

Phase 3: TeamCreate(team_name: "review-team",
                    members: [science-consultant, continuity-manager])
         This is valid because the Phase 1 team has been removed.
         Both reviewers inspect the draft and share discoveries.
         A science-consultant who finds a physics error also notifies
         continuity-manager.
         Remove the review team after both reviews finish.

Phase 4: Invoke prose-stylist as a subagent again and apply both reviews.
```

## Example 3: Webtoon Production

**Architecture:** generate and verify. **Mode:** subagents.

This pattern has two agents and primarily passes results between them, so subagents are sufficient.

```text
Phase 1: Agent(webtoon-artist) creates panels
Phase 2: Agent(webtoon-reviewer) reviews them
Phase 3: Agent(webtoon-artist) regenerates rejected panels, at most twice
```

| Agent | subagent_type | Role | Skills |
|---|---|---|---|
| webtoon-artist | custom | Generate panel images | generate-webtoon |
| webtoon-reviewer | custom | Review quality | review-webtoon, fix-webtoon-panel |

### Full agent example: `webtoon-reviewer.md`

```markdown
---
name: webtoon-reviewer
description: "Reviews webtoon panels for composition, character consistency, text legibility, direction, and pacing."
---

# Webtoon Reviewer

Review webtoon panels for visual completeness, story clarity, and character
consistency.

## Core responsibilities
1. Evaluate each panel's composition and visual completeness.
2. Check character appearance for consistency across panels.
3. Evaluate speech-bubble legibility and placement.
4. Review direction and pacing across the full episode.

## Working principles
- Return one of `PASS`, `FIX`, or `REDO` for every panel.
- Use `FIX` when a partial edit is sufficient and `REDO` when full
  regeneration is required.
- Base each decision on observable consistency, legibility, and composition
  criteria rather than taste.

## Input and output protocol
- Input: panel images under `_workspace/panels/`
- Output: `_workspace/review_report.md`
- Format:
  ```text
  ## Panel {N}
  - Decision: PASS | FIX | REDO
  - Reason: [specific reason]
  - Correction: [specific direction for FIX or REDO]
  ```

## Error handling
- Mark an unloadable image `REDO`.
- After two failed regeneration attempts, pass the panel with a warning.

## Collaboration
- Deliver file-based correction instructions to webtoon-artist.
- Review regenerated panels again, for at most two loops.
````

The reviewer checks composition, character consistency, text legibility, direction, and pacing. It returns `PASS`, `FIX`, or `REDO` for every panel. Use `FIX` when a partial edit is sufficient and `REDO` when full regeneration is required. Base the decision on observable criteria rather than taste.

```text
## Panel {N}
- Decision: PASS | FIX | REDO
- Reason: [specific reason]
- Correction: [specific direction for FIX or REDO]
```

Mark an unloadable image `REDO`. Review regenerated panels for at most two loops. After two failed attempts, pass the panel with a warning. If at least half of all panels receive `REDO`, suggest revising the generation prompt.

## Example 4: Code Review Team

**Architecture:** fan-out/fan-in plus discussion. **Mode:** agent team.

```text
[Leader] -> TeamCreate(review-team)
    |-- security-reviewer: inspect vulnerabilities
    |-- performance-reviewer: assess performance impact
    `-- test-reviewer: inspect test coverage
    -> reviewers share and challenge findings with SendMessage
    -> leader consolidates the results
```

Reviewers communicate directly to catch issues that cross specialties. A security reviewer can ask the performance reviewer to assess a risky query; the performance reviewer can ask the test reviewer to look for an N+1 regression test; the test reviewer can ask the security reviewer to rank an untested authentication path.

## Example 5: Supervisor Pattern for Code Migration

**Architecture:** supervisor. **Mode:** agent team.

```text
[supervisor/leader] -> analyze files -> allocate batches
    |-> [migrator-1] batch A
    |-> [migrator-2] batch B
    `-> [migrator-3] batch C
    <- receive TaskUpdate -> allocate or reassign more work
```

| Teammate | Role |
|---|---|
| Leader / migration-supervisor | Analyze files, allocate batches, and manage progress |
| migrator-1 through migrator-3 | Migrate claimed file batches |

### Dynamic allocation logic

1. Collect the complete target-file list.
2. Estimate complexity from file size, import count, and dependencies.
3. Register file batches and dependencies as tasks with `TaskCreate`.
4. Let teammates claim available work from the shared task list.
5. When a teammate reports completion with `TaskUpdate`, let a successful
   worker claim the next task. On failure, ask for the cause with `SendMessage`
   and reassign the task or give it to another teammate.
6. After every task finishes, have the leader run integration tests.

Unlike a fixed fan-out, this pattern assigns work dynamically at runtime. A shared task list with task claiming fits the supervisor pattern.

### Pilot before scaling

The allocation loop assumes each batch result can be trusted. Establish that on
a pilot before allocating the rest:

- Carry one small partition end to end, through review and merge. Fix what
  fails while it is cheap, and repeat until a pilot lands without manual repair.
- Fix recurring failures at the source. When the same kind of failure or
  reviewer flag recurs across batches, change the migrator brief, the shared
  instructions, or the acceptance check instead of repairing each batch. The
  supervisor groups failures by cause before it reassigns them.
- To migrate in place while others keep committing, partition from the leaves
  of the dependency graph inward, freeze and migrate one partition at a time,
  and add a CI check that rejects commits reintroducing the old form into a
  finished partition.
- Order each batch's checks by cost: build and type checks, then tests, then
  expensive evidence such as replay, old-versus-new output comparison, or an
  independent review. Expensive verification runs only on batches that passed
  the cheap gates.
- Measure tokens and wall time per pilot batch and extrapolate them as a floor
  for the rest. Name what the pilot could not observe, such as reconciliation
  with concurrent commits, as unmeasured instead of folding it into the estimate.

## Deliverable Patterns

Agent definitions live at `project/.claude/agents/{agent-name}.md`. Each definition includes core responsibilities, working principles, input/output protocol, error handling, and collaboration. Team-mode definitions also include a **team communication protocol** that specifies incoming and outgoing messages and the scope of tasks the agent may claim.

Project skills live at `project/.claude/skills/{skill-name}/SKILL.md`; global skills live at `~/.claude/skills/{skill-name}/SKILL.md`.

An orchestrator skill defines the roster and workflow for the whole scenario. See `references/orchestrator-template.md`. Always state the execution mode: agent team by default, or subagent.
