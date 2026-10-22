# Requirements interview: questions before and during building

Status: proposed on 2026-10-06. Branch `feat/requirements-interview`.

## Problem

`plan` Phase 1 holds five questions, but they are reachable only through `plan`,
which also obliges a spec and a contract. A user who is halfway through an
implementation and wants to be questioned about one decision has no entry point,
and Codex sees only `plan`'s description ("write a spec"), which does not match
"interview me" or "grill me". The retired `dev-workflow` plugin had a standalone
`grill` skill; oh-my-claudecode's `deep-interview` adds evidence reading and a
numeric ambiguity gate. An earlier review judged that the evidence
reading is worth having and that a score forced on every plan is not.

## Goals

1. A public skill that interviews before a spec exists, in the middle of an
   implementation, or on one named decision.
2. It reads the spec, the task contract, the diff and recent commits before the
   first question, and never asks what they already answer.
3. Two Claude commands: `/interview` (cooperative) and `/grill-me` (adversarial).
4. A checkable end: every open item has an answer or a recorded assumption, and
   every acceptance criterion is a verifiable sentence.
5. Answers are recorded in the spec, the one place readers already look.

## Non-goals

- No numeric ambiguity score.
- No state file; the spec's `## Decisions` and `## Assumptions` are the state.
- No edit of `.jstack/tasks/<id>/contract.yaml`; a changed requirement goes back to
  `plan` for a new contract.
- No code is written from either command.

## Surfaces

| Surface | Path |
|---|---|
| Skill | `skills/public/workflow/requirements-interview/SKILL.md` |
| Grill reference | `skills/public/workflow/requirements-interview/references/grill-mode.md` |
| Commands | `hosts/claude/commands/interview.md`, `hosts/claude/commands/grill-me.md` |
| Plan delegation | `skills/public/workflow/plan/SKILL.md` Phase 1 and Boundaries |

The owner and public name are both `requirements-interview`, with the lookup
alias `grill`. A skill named `interview` would collide with the `/interview`
command, and the catalog requires a differing owner to be listed as an alias,
which would collide in turn (`contracts/skill-catalog.md`: "do not add a command
that collides with a skill alias").

Codex has no slash commands; the description carries the triggers 인터뷰,
질문해줘, 파고들어, 반박해줘, interview me and grill me, and the skill's Modes
section selects the mode from the phrase.

## Validation

- Owning suite `skills/public/workflow/requirements-interview/tests/run_tests.ts`:
  contracts on evidence-first reading, the three entry contexts, one question per
  turn, the stop condition without a score, the spec as the record, the grill
  outcome table, description triggers, and that every skill named as a boundary
  exists.
- `plan` suite: Phase 1 gate sentences and boundary targets still hold.
- Command inventory counts in `tests/test_dev_commands.ts`,
  `tests/test_work_commands.ts`, and the `help` suite move from 30 to 32.
- Host evidence (separate): `/jstack:interview` and `/jstack:grill-me` load in Claude
  Code, and Codex lists one more public skill.

## Follow-ups

- A migration-verification reference for `plan` (migration type and its evidence)
  is planned on top of this change.
