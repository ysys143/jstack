# Skill

Add a skill to an existing plugin or create a plugin to contain it.

## Step 0: Determine Scope

Before writing, distinguish project and organization scope.

### 0-1. Choose the Skill Level

| Property | Project skill | Organization skill |
|---|---|---|
| Location | `{project}/.claude/skills/` | A plugin marketplace |
| Reach | Current project only | All projects for installed users |
| Sharing | Project repository | Published marketplace plugin |
| Best for | Project workflows and domain contracts | General tools and reusable team workflows |

Recommend project scope for repository-specific work and organization scope for reusable work. If the user did not state scope and the answer materially changes the artifact, ask one focused question with your recommendation.

A project skill proceeds directly to writing at `{project}/.claude/skills/{skill-name}/SKILL.md`. An organization skill follows the inspection, placement, installation, and publication steps below.

Use a concrete scope question:

### 0-2. Ask for Scope When It Is Unclear

> Where should this skill be available?
>
> 1. **Project skill** — use it only in the current project at
>    `{current-working-directory}/.claude/skills/`; it can be shared through
>    that repository.
> 2. **Organization skill** — use it across projects through the plugin
>    marketplace; activation follows the host's installation lifecycle.
>
> Recommended: **{1 or 2}**, because {reason}.

## Step 1: Define the Skill

Choose a kebab-case name, a description of one sentence plus two or three trigger phrases, and concrete operating instructions.

## Step 1.5: Consult the Anthropic Guidance

For design and structure guidance, consult the pinned upstream pointers recorded
in `upstream.toml` under `corca-ai-claude-plugins`:

| Need | Upstream document |
|---|---|
| Skill design and scope | `references/anthropic-skills-guide/02-planning-and-design.md` |
| SKILL.md structure and YAML | `references/anthropic-skills-guide/03-skill-structure.md` |
| Writing instructions | `references/anthropic-skills-guide/04-writing-instructions.md` |
| Architecture patterns | `references/anthropic-skills-guide/07-patterns.md` |

Resolve these paths against the pinned
`https://github.com/corca-ai/claude-plugins/blob/main/` source. The documents
are pointers and are not embedded in this tree. At minimum, review the structure
and instruction-writing documents when they are available; if remote access was
not authorized or the source cannot be loaded, state the unverified reference
instead of pretending it was read.

## Step 2: Inspect Existing Components

Run the inspection command:

```text
/inspect
```

It shows skills, commands, hooks, agents, and scripts. Use that inventory to
identify the coherent destination and avoid duplicates.

## Step 3: Choose Placement

Show relevant existing plugins in descending semantic fit, including their skills, and offer a new plugin as an alternative. Ask the user to select when more than one placement would create materially different ownership or publication behavior.

Present the decision explicitly:

> Where should this skill live?
>
> **Existing plugins:** list the most semantically related plugins first and
> show their existing skills.
>
> **Alternative:** create a new plugin.
>
> Select a number or name.

## Step 4: Write `SKILL.md`

```markdown
---
name: <skill-name>
description: One sentence on when to use it, two or three trigger phrases, and the one neighbour it yields to.
metadata:
  author: your-organization
  version: "0.1.0"
  category: <category>
  tags: [relevant, tags]
---

# <Skill Title>

## When to Use
- Concrete routing conditions

## Prerequisites
Required tools, MCP servers, or credentials, when applicable.

## Implementation
Concrete steps and decision rules.

## Examples
Real commands or snippets.

## Troubleshooting
### Problem: A known failure
**Resolution:** How to diagnose and resolve it.

## References
Links to supplementary files under references/.
```

For a project skill, create the directory and write the file directly:

### Project Skill

```bash
mkdir -p .claude/skills/<skill-name>
# Write .claude/skills/<skill-name>/SKILL.md
```

Stop after the quality checklist.

### Organization Skill in an Existing Plugin

Write directly to
`~/.claude/plugins/marketplaces/local-plugins/plugins/<plugin-name>/skills/<skill-name>/SKILL.md`.

### Organization Skill in a New Plugin

Create a temporary source tree and write the skill inside it:

```bash
bash "${JSTACK_PLUGIN_ROOT}/skills/author/scripts/scaffold_plugin.js" \
  "/tmp/claude-plugin-<name>" "<name>" "<description>"
```

Then write `/tmp/claude-plugin-<name>/skills/<skill-name>/SKILL.md`.

## Step 4.5: Quality Checklist

- [ ] `name` is kebab-case and matches its directory.
- [ ] `description` states the task and routing situation.
- [ ] `description` contains no XML and stays within 100 display columns (a Korean character counts 2).
- [ ] Routing conditions are concrete.
- [ ] The body contains a real example or a usable procedure.
- [ ] Troubleshooting is present when known failures exist.
- [ ] Core behavior is in `SKILL.md`; large conditional detail is in references.

## Step 4.7: Coherence Check

Read the authoritative bundle-coherence guide:

```text
Read: ${JSTACK_PLUGIN_ROOT}/references/organizational-guides/bundle-coherence-guide.md
```

Verify that the purpose fits the plugin domain, does not duplicate an existing
skill, and complements existing components. When adding to an existing plugin,
report the integration in this form:

```text
[INFO] Integration analysis

Plugin: {plugin-name}
Existing skills: {list}
New skill: {skill-name}

Relationship:
- Extends: {which existing skill}
- Works with: {which commands/hooks}
- Use case: {when used together}

[OK] Coherent addition confirmed
```

## Step 5: Select Delivery

Install a plugin skill locally with the registration script. Publishing to a
shared marketplace is outside this skill: after local testing, open that
repository's own pull request only with the user's authorization.

## Step 6: Deliver

```bash
bash "${JSTACK_PLUGIN_ROOT}/skills/author/scripts/register_local.js" \
  "<source_dir>" "<plugin-name>"
```

## Step 7: Report Completion

For local Claude installation, state that activation requires a Claude Code restart.
