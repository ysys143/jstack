---
name: skill-creator
description: "Create or optimize a skill, command or agent. Triggers: 스킬 만들어, 커맨드 추가."
---

# Author — the description is the only thing you always pay for

## Capture a reusable user skill

For “지금 작업한 내용 스킬로 남겨줘”, ask project/global once unless the scope was
already selected. With no answer, prepare a draft only. Follow
`${JSTACK_PLUGIN_ROOT}/runtime/SKILL-STORAGE.md` and use the shared
`runtime/skill_store.js` implementation; project skills are local by default.
`JSTACK_PLUGIN_ROOT` in that document means this installed plugin root. Proposing
team sharing does not authorize stage, commit, push, or edits to tracked
instruction files. User-created skill placement is separate from authoring
this plugin's own shipped skills. Preserve existing sources and other profiles.
“Project skill” and its Korean equivalents already select project scope. Audit
session-derived Claude or Codex tool dialect before placing the common source.


## Existing skill audit and optimization

For skill, prompt, or AGENTS.md maintenance, use `references/skill-writing-guide.md`.
Audit stays read-only; authorized optimization includes affected checks.
Use `references/skill-testing-guide.md` only when measuring model behavior.

## One cost, four layers

Everything a skill contains is loaded on demand except its name and
description. Those two are in context on **every turn of every session**,
whether or not the skill ever fires.

| Layer | Loaded | Put here |
| --- | --- | --- |
| L0 name + description | Always | When to fire, and the one neighbour it yields to |
| L1 SKILL.md | When the skill fires | The judgement — what to do and why it is that way |
| L2 `references/` | When SKILL.md sends you there | Tables, taxonomies, long-form rules |
| L3 `scripts/` | When run | Anything with a deterministic answer |

The layering rule follows from the cost: **if it is not needed to decide
whether to fire, it does not belong in the description.** Everything else is a
matter of how far the reader has already committed.

`references/layers.md` carries the per-layer sizing and the failure mode each
layer has when it is used for the wrong thing.

## Skill, command, or agent

| Build a | When |
| --- | --- |
| Skill | The model needs judgement it does not already have, and should apply it whenever the situation arises |
| Command | The user wants to invoke a fixed procedure by name |
| Agent | The work needs its own context window — long, noisy, or parallel |

A skill that only ever runs one script should be a command. An agent that never
uses its separate context should be a skill.

## The description does two jobs

It says **when to fire** and where the one most confusable neighbour takes over.
Without that boundary two skills both claim the same request, and the model
picks by proximity, which is not a decision anybody made.

The host lists the description to the model on every turn, and all listed
descriptions share one budget of about 1% of the context window. So it is one
sentence plus two or three trigger phrases, at most 100 display columns (a
Korean character counts 2). Every other boundary goes in the body, which costs
nothing until the skill fires.

Write the trigger phrases in both languages the users of this plugin actually
type. A Korean-only set misses the English phrasing of the same request, and the
reverse is equally true; two or three phrases cover both.

Name the neighbour explicitly: *"Fixing belongs to the cleanup skill."* That
sentence is what makes the boundary checkable, and this plugin's suites check
it — a named neighbour that does not exist fails the contract.

A command pays the same listing cost. It carries a description of at most 60
columns only when no public skill carries its intent. A command that only
invokes a skill gets none: it is not listed to the model, and its first body
line, `# /name — hint`, is the text the `/` menu shows. `disable-model-invocation`
is reserved for workflows the model must never start.

## Ship the suite with the skill

A skill with no contract suite is prose. Nothing detects it when a later edit
quietly removes the load-bearing sentence, and the sentence is the whole asset.

Write the suite against the claims, not the wording: check that the rule is
stated and that its **reason** is stated, because a rule whose reason has been
deleted gets deleted next.

**Floors are measured, not chosen.** Measure how many behavior checks fail when
an owning artifact is removed, reading the measured value from disposable
mutation runs. That is a regression control, not a minimum prose length.
The amount of the body that can be deleted is not a quality metric: preserve
required behaviors while permitting concise explanations and equivalent wording.
Use semantic body contracts for revised skills; retain exact strings for public
protocols, units and other literal interfaces. Do not refresh answer keys merely
to hide a behavior regression.

## Do not write these

- **A skill that routes to another skill.** Users install this plugin, not a
  map of skills they do not have. Absorb what is needed and place it properly.
- **A skill that reimplements a maintained CLI.** Depend on the tool and say
  how to install it when it is missing. The `upstream` skill covers the line.
- **A description that describes the domain.** "Handles documents" fires on
  everything and therefore on nothing. Describe the situation, not the subject.

## Scripts — what runs, not what is read

| Script | Run it when |
| --- | --- |
| `scripts/validate_plugin.js` | Before publishing a plugin; a fixture suite in `scripts/tests/` proves it can fail. It is not `/jstack:validate`, which checks deliverables such as `.hwpx` or reports |
| `scripts/scaffold_plugin.js` | Creating a new plugin directory; refuses non-kebab names and never overwrites |
| `scripts/register_local.js` | Registering a plugin in the local marketplace for testing |
| `scripts/list_plugins.js` | Listing what the marketplace currently holds |
| `scripts/check_package_surface.js` | Checking that every file in the plugin is still inside a declared category |
| `references/package-surface.yaml` | The declaration that script enforces — edit it when a new kind of file appears |

The six marketplace scripts take the marketplace root from `JSTACK_MARKETPLACE_DIR`; none hardcode a home path.

## Place one source, then adapt the host

Put shared judgment and content in the owning `SKILL.md` and keep its references
and imports inside this package. A host-specific file may override invocation,
tool arguments, permission handling, or lifecycle only when those semantics
differ. It must point back to the common source and must not copy shared
judgment into a second maintained body. Generated native output is a delivery
surface, never an authoring source.

Before accepting placement, run the owning contract suite. For command-facing
changes, exercise the canonical `/jstack:test-plugin` path; for the complete
artifact, use `/jstack:validate`; and use `/jstack:doctor author` to diagnose loading
without changing the project. Then test the installed or exported component
outside the source checkout so a repository-relative import cannot masquerade
as portability.

## References — when to read what

| Reference | Read it when |
| --- | --- |
| `references/organizational-guides/agent-architecture.md` | Deciding whether to build an agent or leave the judgement in a skill |
| `references/organizational-guides/bundle-coherence-guide.md` | Deciding whether a component belongs in this bundle or in a new plugin |
| `references/organizational-guides/command-architecture.md` | Choosing which command layer to use |
| `references/organizational-guides/hook-architecture.md` | Working out hook lifecycle, matcher, and contract |
| `references/organizational-guides/organizational-governance.md` | Naming conventions, file layout, and version policy |
| `references/organizational-guides/plugin-design-patterns.md` | Picking one of the six bundle patterns |
| `references/skill-writing-guide.md` | Writing the description, or its body narrative patterns |
| `references/skill-testing-guide.md` | Setting up with-skill / baseline verification |
| `references/agent.md` | Walking the procedure for adding an agent |
| `references/command.md` | Walking the procedure for adding a command |
| `references/hook.md` | Walking the procedure for adding a hook |
| `references/skill.md` | Walking the procedure for adding a skill |
| `references/component-decision.md` | Deciding which of skill, command, agent, or hook the thing should be — the summary table above is a summary of this file |
| `references/placement.md` | Deciding where the thing lives and which agents see it, once you know what it is |
| `references/browser-priority.md` | Writing anything that opens a browser — which of the four tools to reach for |
| `references/deprecated-governance.md` | Before writing a new command — the seven that were deleted and the two mistakes they share |
| `references/templates/analyzer-agent-template.md` | Starting an analyzer agent from a skeleton |
| `references/templates/extractor-agent-template.md` | Starting an extractor agent from a skeleton |
| `references/templates/validator-agent-template.md` | Starting a validator agent from a skeleton |
| `references/templates/generator-command-template.md` | Starting a generator command from a skeleton |
| `references/templates/orchestrator-command-template.md` | Starting an orchestrator command from a skeleton |
| `references/templates/wizard-command-template.md` | Starting a wizard command from a skeleton |
| `references/templates/formatting-hook-template/README.md` | Starting a formatting hook from a skeleton |
| `references/templates/notification-hook-template/README.md` | Starting a notification hook from a skeleton |
| `references/templates/validation-hook-template/README.md` | Starting a validation hook from a skeleton |


## Task routing and completion

For authorized delegation, follow [Runtime routing](../../runtime/ROUTING.md):
plan with `jst route plan`, reserve one attempt with `jst route run`, execute, and
record checked artifacts with `jst route record`. It owns model transitions and
the rules every calling skill follows.

## Boundary

Judging the result is the `audit` skill; removing a skill that stopped earning
its description is the `prune` skill. This skill covers writing a new one.


The standalone hook templates include their own ESM manifests:
`references/templates/formatting-hook-template/package.json`,
`references/templates/notification-hook-template/package.json`, and
`references/templates/validation-hook-template/package.json`. Keep each manifest
with its compiled hook when copying the template into another plugin.
