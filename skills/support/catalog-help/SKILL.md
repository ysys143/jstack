---
name: catalog-help
description: Find the right skill in this plugin by the decision you are facing, not by its name — and get told plainly when nothing here covers it. Triggers — "뭐 할 수 있어", "어떤 스킬", "도움말", "목록", "help", "what can you do", "스킬 알려줘", "이럴 땐 뭘 써".
---

# Help — routed by decision, not by name

## Why a map and not a list

A list of names tells you what exists; it does not tell you which one applies.
The question people actually arrive with is a situation, so this map is indexed
by situation. Names are the answer, never the question.

This map is checked against the tree: every skill here exists, and every skill
in the plugin appears here. A map that drifts is worse than no map, because it
answers confidently.

The source-owner map below preserves maintenance and verification identities.
For the public categories and current invocation names, run
`node ${JSTACK_PLUGIN_ROOT}/runtime/catalog_cli.js list`. Resolve a previous name with
`node ${JSTACK_PLUGIN_ROOT}/runtime/catalog_cli.js resolve NAME --host claude`
(or `codex`). Public results identify native skills; support results identify a
body to read conditionally. Lookup aliases are not native slash aliases.

Read `../../CAPABILITIES.md` (installed at `${JSTACK_PLUGIN_ROOT}/CAPABILITIES.md`)
for dependency and host limits. Public discovery is
controlled by `../../contracts/skill-catalog.json`, not this source-owner map.

## The map

| You are trying to | Skill |
| --- | --- |
| Maintain host profiles, project sessions or stale plugin entries | `agent-maintenance` |
| Decide what to build, before building it | `plan` |
| Explicitly select a complete software lifecycle from clarification through scoped release | `sdlc` |
| Be interviewed or grilled about a request or the work in progress | `requirements-interview` |
| Write code with the test leading | `tdd` |
| Verify completion with fresh evidence | `verify` |
| Record why a choice was made, for later | `decide` |
| Judge quality without changing anything | `audit` |
| Clean up code whose behaviour must not change | `cleanup` |
| Deal with a credential that is in the repository | `secrets` |
| Bring third-party code or assets in | `upstream` |
| Add a new skill, command, or agent here | `author` |
| Remove a skill, command, or agent and its traces | `prune` |
| Depend on an external tool | `bridge` |
| Choose which model tier does the work | `models` |
| Save what a later session needs, or find a past session | `recall` |
| Split work across parallel agents | `team` |
| Get a second opinion that can disagree | `consult` |
| Hand a coding task to codex to actually execute | `delegate` |
| Make a repository ready to work in | `setup` |
| Commit, branch, and shape history | `gitrules` |
| Make React or Next.js code fast, or compose it well | `react` |
| Check an interface for accessibility, focus, forms | `ui` |
| Remove decorative emoji without damaging content | `emoji` |
| Remove AI tells, fix translationese, or apply and audit ASD-STE100 technical clarity | `humanize` |
| Create or validate an editable HWPX document | `hwpx` |
| Use MS Office for docx, xlsx, pptx, spreadsheets, and East Asian fonts | `office` |
| Build an editable presentation deck | `deck` |
| Draw a diagram whose labels and structure must survive | `diagram` |
| Generate or edit an image from a visual brief | `image` |
| Check Korean spelling or count characters and bytes | `proof` |
| Research a question against primary sources | `research` |
| Run a scientific research workflow | `science` |
| Request a personal daily, weekly, or custom-period report | `wrapup` |
| Connect and operate Google Workspace | `workspace` |
| Inspect usage and session state in the dashboard | `dashboard` |
| Diagnose disk growth, inspect storage history, or reclaim selected space | `disk-manager` |
| Report a jstack malfunction or review jstack failures as issue drafts | `issue-report` |
| Check the Claude Code or Codex setup (skills, MCP servers, agents, listing budget) before or after installing jstack | `host-audit` |
| Walk a product's install and onboarding as a new team in a clean environment, or make leak-gated docs screenshots | `journey-qa` |
| Move a repeated, deterministic sweep, benchmark, or regression out of the agent's loop into a DAG | `dag-it` |
| Check a TLA+ model with TLC and draw a Mermaid statechart with the shortest path to each broken rule | `statechart` |
| Formally verify a property with a model checker, proof assistant or SMT-backed verifier and leave a project-local verify skill | `create-formal-verification-skill` |
| Route a situation to the right skill | `help` |

## Commands are explicit entry points

The map indexes **skills, and only skills**. Commands and agents are left out on
purpose, not by oversight. Commands are explicit entry points; use their names
when you already know the operation: `/jstack:test-plugin` runs plugin contracts,
`/jstack:validate` validates an artifact, `/jstack:doctor [skill]` diagnoses without
changing the project, `/jstack:setup-recall` prepares project recall, and
`/jstack:setup-workspace` guides Google Workspace installation and OAuth. The
canonical command and capability catalog owns the
remaining request examples, so this routing map does not duplicate it. An agent
is never chosen by the user at all: a skill picks one, and routing a person to
an agent would skip the skill that knows how to brief it. When the roster itself
is the question rather than the routing, the `skills` command reads the tree and
prints all three layers.

## When nothing here applies

Say so plainly, and say what the request would need. Routing a request to the
nearest-sounding skill is worse than answering directly: the skill applies rules
built for a different situation, and the mismatch is invisible in the output.

This plugin is meant to be sufficient on its own for the work it names. When it
is not, the honest answer is that it is not — not a redirect to something the
user has not installed.

## Two skills seem to apply

Read both boundary sentences; skills with overlapping activation name the
relevant neighbour and say what belongs to it. The pair `audit` and `cleanup` is the usual
confusion, and the split is stated in both: judging changes nothing, cleaning
changes code without changing behaviour.

If the boundaries genuinely do not settle it, the boundary is wrong — that is a
defect in the descriptions, and `author` covers fixing it.

## Boundary

This skill routes and stops. It does not do the work it points at, and it does
not summarise a skill in place of firing it — a summary of judgement is not the
judgement, and the reader cannot tell the difference from the output. Writing a
new skill when the map has a hole is the `author` skill.
