---
name: skill-creator
description: "Create or optimize a skill or plugin component. Triggers: 스킬 만들기, 스킬 최적화."
---

# Author — one source, native execution


## Existing skill audit and optimization

For skill, prompt, or AGENTS.md maintenance, use `references/skill-writing-guide.md`.
Audit stays read-only; authorized optimization includes affected checks.
Use `references/skill-testing-guide.md` only when measuring model behavior.

Choose the smallest component that owns the requested behavior. A skill supplies
judgment on demand; a named procedure belongs in an explicitly invoked entry;
an agent earns a separate context only when the work can be checked independently.
Do not add a router to an absent skill or reimplement a maintained CLI.

Only the name and description are always loaded. Put activation and refusal
boundaries there, judgment in SKILL.md, long material in references, and
deterministic operations in scripts. Read `references/layers.md` when deciding
the layer. Name the neighboring skill so overlapping activation is testable.
Use Korean and English triggers used by this plugin's users.

Keep common behavior in the canonical SKILL.md. Write a reviewed Codex body under
`hosts/codex/skills/<category>/<name>/SKILL.md` only when the host call semantics differ; do not mechanically rename a tool and pretend
its permissions, arguments, or lifecycle are equivalent. The Codex entry uses
the native tools actually exposed in this session. Ordinary text clarification
is sufficient when no question UI exists. Agent creation requires the session's
delegation authority and capability.

Keep imports and references package-relative. This native override owns only
Codex invocation, tool arguments, permissions, and lifecycle differences; it
must not fork the common authoring judgment. Treat generated native files as
delivery output. Validate the owning suite and exported package, then exercise
the installed component outside the source checkout. The Claude command paths
`/jstack:test-plugin`, `/jstack:validate`, and `/jstack:doctor author` are migration
checks for that host, not names for Codex tools.

Ship checks for each new behavior: one valid use, a realistic invalid result,
and removal of the required input or checker. Use the actual artifact and
command result as evidence. String presence, body size, and a model's claim of
success cannot prove behavior. Measure any content floors from the retained
content rather than choosing slack to make a test green.

When editing this consolidated plugin, keep development and artifact workflows
under their owning skills. Add a component to the owning skill; generate Codex
delivery from that source with the bridge exporter. Do not copy generated files
back as a second source of truth.
Use the owning suite and exercise the installed component outside the source
checkout before claiming portability.

Claude command, hook, and agent templates in the source tree describe that
host's API; they are not Codex execution instructions. This entry does not claim
to install equivalent tool interception. Native plugin discovery uses the
generated `.codex-plugin/plugin.json` and skills directory. Registration and
publication are separate actions with their own authorization and evidence.

Judging the result belongs to `audit`; removing an unnecessary component belongs
to `prune`; this skill owns authoring, activation boundaries, and acceptance.

## Capture a reusable user skill

When the user asks to save the current work as a skill, ask project/global once
unless the scope is already specified. With no answer, prepare only the draft.
Follow `${JSTACK_PLUGIN_ROOT}/runtime/SKILL-STORAGE.md` and run the shared
`runtime/skill_store.js`; project storage is local by default and does not
stage, commit, push, or edit tracked instruction files. Global sources live in
`~/.agents/skills` with a relative link for the selected Claude config home.
Do not create a duplicate Codex copy or overwrite existing user sources.
“Project skill” and its Korean equivalents already select project scope. Audit
session-derived Claude or Codex tool dialect before placing the common source.
