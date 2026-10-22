---
argument-hint: "[topic] | --resume"
---

# /interview — find what is not settled yet

Follow the `requirements-interview` skill in interview mode. `$ARGUMENTS` is a
topic, `--resume`, or empty. Empty means the work in progress when there is a
spec, a task contract, or a diff touching the request; otherwise the request just
stated. `--resume` follows the skill's Resume section.

## Sequence

1. Read the evidence before asking anything, in the skill's order, and show what
   is already settled. Do not ask what the spec, the contract, the diff, or the
   code already answers.
2. Ask one question per turn, as the skill's Question discipline says.
3. After each answer, record it as the skill's Record section says.
4. At the mode's limit or the skill's stop condition, give the readiness report
   and offer the next step.

## Stop

Stop on the skill's stop condition, when the user says stop, or after the
readiness report if the user does not continue. Never edit `contract.yaml` and
never write code from this command.
