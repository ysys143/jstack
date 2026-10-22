---
name: host-audit
description: "Audit a user's Claude Code and Codex setup (plugins, skills, commands, subagents, MCP servers, hooks, description listing budget) against documented host rules and a jstack package, read-only. Used when installing or updating jstack and when the user asks to check their host setup."
---

# Host setup audit

This is a read-only audit. It changes no host setting, plugin, skill, MCP entry or
file; every action it names belongs to the user or to another owner.

## Run it

Before installing or updating jstack, run it from the extracted release, once per
selected profile, with that profile's `CLAUDE_CONFIG_DIR` or `CODEX_HOME` set:

```bash
node <extracted>/jstack-marketplace/plugins/jstack/payload/skills/host-audit/scripts/main.js \
  --package <extracted>/jstack-marketplace/plugins/jstack --verify-docs --measure [--project <dir>]
```

After installation, and whenever the user asks to check their setup:

```bash
jst host-audit --verify-docs --measure [--project <dir>]
```

`--host claude|codex` limits it to one host; `--model <id>` names the Claude model
when neither `ANTHROPIC_MODEL` nor the settings say it; `--json` gives the full
report. Without `--package` it checks each host against the jstack plugin enabled on
that host; a host without one gets no jstack comparison. Exit 0
means no blockers, 1 a blocker, 2 a usage error or an unreadable input.

## Present the result

Show the text output as it is, in this order: documentation drift, the hosts and
the jstack package or installation checked against, the listing figures, findings by
severity. Do not add, soften or re-order findings. Listing
figures are estimates from the documented budget unless the line says
`measured by`, which is the host's own figure; say which one you are quoting.

When the output reports **documentation drift**, say first that the official
documentation changed since the rules were checked and that findings marked
`unverified` rely on a changed rule. Do not repeat an unverified finding as fact.
When the documentation could not be fetched, say it was not re-checked.

For the exact Codex listing, the user can run `codex debug prompt-input`
(experimental): it prints the model-visible input, including the skill list. In a
Claude Code session, `/context` shows the listing after the budget is applied.

## Route each finding

| Finding | What to tell the user | Owner |
|---|---|---|
| `second-jstack` (blocker) | Two jstack plugins run every hook twice; choose one before installing | README cleanup table |
| `listing-over-budget`, `jstack-descriptions-dropped` | Some skills will be listed by name only and rarely start on their own. Plugin skills, jstack's included, cannot be demoted with `skillOverrides`; the choices are demoting the user's own large skills or synced claude.ai skills (by their full name `anthropic-skills:<name>`, or `syncClaudeAiSkills: false`), disabling unused plugins with `/plugin`, or raising `skillListingBudgetFraction` (Codex: `[[skills.config]] enabled = false` or `skills.max_context_tokens`) | The user decides; change settings only with approval, through the host's `/skills` or `/plugin` menu where one exists |
| `override-misses-synced-skill` | A `skillOverrides` entry under the bare name of a synced claude.ai skill does not reach it, because another command holds that name: a user or project skill (by its folder or frontmatter name), a user or project command (by the name it is listed under), or a plugin skill or command whose frontmatter names it; the synced skill stays listed | Offer the full-name key, for example `"anthropic-skills:<name>": "off"`, and removing the bare entry when only plugin entries hold the name; the audit never edits settings, so change it only with approval |
| `name-collision` | Which name answers `/name` and how to reach jstack's (`/jstack:<name>`); both stay installed | Keep the user's own; rename only if the user asks |
| `duplicate-hook` | The same handler runs twice | Ask which plugin keeps it |
| `prompt-routers` | Each `UserPromptSubmit` hook adds context before every prompt; more than one competes | The user decides; jstack adds none |
| `agent-descriptions-heavy`, `mcp-always-loaded`, `mcp-shadowed`, `codex-agent-overrides-builtin` | The figure and what the host does with it | Informational |
| `description-truncated`, `spec-limits` | The host truncates or another host may reject it | The skill's author |
| `rules-older-than-host`, `inventory-warnings` | What could not be checked or may have changed | Informational |

## Limits

- Claude Code's own skills share the listing and its budget but are not files in
  the profile; the audit counts them as an observed figure (about 6,600
  characters on 2.1.292) that is kept first. claude.ai connectors are not visible.
- The Claude listing follows what the host binary computes, not a documented
  rule: 3 characters per token for current models and 4 for older ones (a model
  alias such as `opus` is counted as 3 and the result for 4 is noted), display
  width (a Korean character counts 2), `- name: text` lines, and descriptions
  kept greedily in descending usage score. The Codex shortening order is
  undocumented.
- By the host binary, Claude Code's own commands and bundled skills also hold a
  bare name. This was not probed and the audit cannot see them, so it counts the
  bare `skillOverrides` entry of a synced claude.ai skill as applying.
- When a user or project skill's frontmatter name differs from its folder name,
  the audit resolves its override under the folder name as the host does, but
  still lists it and words its advice under the frontmatter name.
- Plugin skill namespacing in Codex is undocumented; collisions there are
  reported, not resolved.
- MCP entries are read without secrets: no environment, header or argument values
  reach the report.

The rules, their sources and how to refresh them after drift are in
[references/host-rules.md](references/host-rules.md).
