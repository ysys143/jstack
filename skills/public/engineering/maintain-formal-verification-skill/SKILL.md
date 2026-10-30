---
name: maintain-formal-verification-skill
description: "Re-align formal verification with code that changed, and tell drift from bugs. Triggers: 형식 검증 갱신, 모델 동기화."
---

# maintain-formal-verification-skill

Bring a project's formal verification back in line with the code after the code changed without rechecking it: find the commits that touched verified code, update the model, harness or properties to describe the code as it is now, rerun, and give each check one outcome (in sync, updated, bug, blocked).

This skill is a pinned copy of an upstream project kept under `repos/pstack/skills/maintain-formal-verification-skill/` (see `NOTICE`). This file is the jstack entry; the procedure lives upstream.

## Start

1. Read `repos/pstack/skills/maintain-formal-verification-skill/SKILL.md`: the outcomes, the edit scope, and the five-step pass.
2. Where it names the pstack `/create-formal-verification-skill`, use the jstack `create-formal-verification-skill` skill; for a TLA+ check, read results with the jstack `statechart` skill. Refer to them by name.
3. Run each check once before changing anything. A check that could not run is not a pass; report it as blocked with the reason.

## Where things live

- The verify skill, its model or proof, and its sync commit belong to the target repository. Never write them under this skill directory; a plugin update replaces it.
- Do not edit `repos/pstack/`. A fix belongs upstream and arrives as a new pinned copy.

## Boundaries

| Need | Owner |
|---|---|
| Choose a target and create the first verify skill | `create-formal-verification-skill` |
| Read a TLA+ result as shortest bug paths and a statechart | `statechart` |
| Check that a code change is complete | `verify` |

## Human gates

Changing product code and moving the sync commit forward are the user's decisions; upstream edits only the verification unless the user asks. Findings stay findings: report a property the current code breaks instead of weakening the property or the model.
