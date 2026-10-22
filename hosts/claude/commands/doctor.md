---
description: "Check the environment jstack expects; changes nothing"
---

# /doctor — inventory, explain, and stop

## Diagnose profiles and user skills

For the host setup itself (plugins, skills, subagents, MCP servers, hooks, the
description listing budget and compatibility with jstack), run
`jst host-audit --verify-docs --measure` and present it as the `host-audit`
support body describes (`skills/host-audit/SKILL.md`); it changes nothing.

Run `node "${CLAUDE_PLUGIN_ROOT}/runtime/profiles.js" inspect` for organization
settings. Diagnose user skill links with `runtime/skill_store.js inspect --scope
<project|global> --name <name>`. Use tools below the actual installation path and
state the required scope and active Claude config home. Report missing or broken
links and in-progress transactions; never run recover, connect, installation, or
authentication automatically. When remote access is requested, run verify-account
with a snapshot loaded from the selected profile and do not substitute another
account. File inspection alone does not prove host discovery or remote access.

## Run

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/doctor.js"
```

With no argument, diagnose shared development tools and all deliverable skills. To
check one deliverable skill, append its name, such as `hwpx`. The script searches
the actual plugin installation path rather than the current work repository.

Deliverable rows are classified as `[ready]`, `[self-contained]`, or `[blocked]`.
They run with shared development-tool checks, but these three classes describe the
availability of deliverable features.

## Exit codes

| Code | Meaning | Next |
|---|---|---|
| 0 | All required and optional tools are available | Continue |
| 1 | An optional tool is missing or unauthenticated, or a deliverable path is blocked | Review the reduced scope shown in the output |
| 2 | A required tool is missing | Stop and use the printed install command |

## Do not install on the user's behalf

Install commands in the output are **for copy and paste**, not execution. Installation
changes a user-managed machine outside this session's scope and may not be cleanly
reversible.

## Why code 1 is separate

Collapsing the result to “present/absent” either blocks a partial environment or
silently reduces it. Both hide **which exact feature is unavailable**. The full
protocol is in the `bridge` skill.

## Why status 0 is not silent

The probe is silent on success, but the user invoked this command directly. With no
output, they could not tell whether it ran.
