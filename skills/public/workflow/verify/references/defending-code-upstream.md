# Pinned `defending-code-reference-harness` Reference

This document pins the adopted design rationale and local differences without copying upstream code into the runner or product skills.

| Item | Value |
|---|---|
| Repository | `anthropics/defending-code-reference-harness` |
| License | Apache-2.0 |
| Pinned SHA | `d3bea6b5793b5f3d59a75ebe69a58efa88383145` |
| Evidence date | Review and local notes from 2026-09-07 |

| jstack contract | Pinned upstream reference | Local adaptation |
|---|---|---|
| Threat model | [.claude/skills/threat-model/SKILL.md](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/.claude/skills/threat-model/SKILL.md) | Record assets, attacker, boundaries, and environmental assumptions in plan scope. |
| Candidate triage | [.claude/skills/triage/SKILL.md](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/.claude/skills/triage/SKILL.md) | Connect reachability, duplicates, severity, and refutation to audit. |
| Execution and evidence | [harness/artifacts.py](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/harness/artifacts.py) | Judge required stages and empty success separately; do not trust the upstream `passed` Boolean directly. |
| Patch verification | [docs/patching.md](https://github.com/anthropics/defending-code-reference-harness/blob/d3bea6b5793b5f3d59a75ebe69a58efa88383145/docs/patching.md) | Bind the original input, regression input, and variant input into the existing workflow receipt. |

## Excluded Scope

jstack does not import the eight upstream skills, separate orchestrator, C/C++ runners, ASAN, Docker/gVisor execution, automatic discovery, or incident response. It runs only the build command, inputs, and oracle supplied by the project. Registering a link is not code adoption or runtime validation. The local schema, state, and evidence rules must remain independently evaluable even when the upstream text is unavailable.
