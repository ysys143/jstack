---
name: create-formal-verification-skill
description: "Formally verify the riskiest code and leave a project-local verify skill. Triggers: 형식 검증, 모델 검사."
---

# create-formal-verification-skill

Find the part of a repository where a bug costs the most and tests reach the least, verify one property of it with the tool that fits (a model checker, a proof assistant, an SMT-backed verifier, or generated inputs), and leave a project-local skill that lets the next agent check a change against that property.

This skill is a pinned copy of an upstream project kept under `repos/pstack/skills/create-formal-verification-skill/` (see `NOTICE`). This file is the jstack entry; the procedure lives upstream.

## Start

1. Read `repos/pstack/skills/create-formal-verification-skill/SKILL.md`: choosing the target, choosing the tool, what makes the result good, generating the verify skill, and proving it before hand-off.
2. Where it names the pstack `/statechart` skill, use the jstack `statechart` skill. Refer to it by name in the generated skill, as upstream says; copy none of its commands, options or paths. Where it points the user at `/maintain-formal-verification-skill`, name the jstack `maintain-formal-verification-skill` skill.
3. Check that the chosen verification tool runs before promising a result. Report what is missing instead of skipping the proof step; a check that could not run is not a pass.

## Where things live

- The generated verify skill and its model or proof belong to the target repository, in its project-local skill folder. Never write them under this skill directory; a plugin update replaces it.
- Do not edit `repos/pstack/`. A fix belongs upstream and arrives as a new pinned copy.

## Boundaries

| Need | Owner |
|---|---|
| Read a TLA+ result as shortest bug paths and a statechart | `statechart` |
| Bring an existing verification back in line after the code changed | `maintain-formal-verification-skill` |
| Check that a code change is complete | `verify` |
| Write the tests for a feature | `test-driven-development` |
| Write a general skill that is not a verification skill | `skill-creator` |

## Human gates

Installing a verification tool and changing product code are the user's decisions; upstream changes product code only when the user asks. Findings stay findings: report a broken property with its counterexample instead of weakening the property or the model.
