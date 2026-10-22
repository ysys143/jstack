---
argument-hint: "[topic]"
---

# /grill-me — attack the assumptions

Follow the `requirements-interview` skill in grill mode and read its grill-mode
reference first. `$ARGUMENTS` is a topic or empty. Empty means the work in
progress when there is a spec, a task contract, or a diff touching the request;
otherwise the request just stated.

## Sequence

1. Read the evidence before asking anything, in the skill's order. Do not
   challenge what the code already disproves; cite it.
2. List the assumptions in one message: those written in the spec, those implicit
   in the diff, those the user stated.
3. Challenge them in order of cost if wrong, one per turn, using the hardest
   challenge for each: what breaks this, what happens without it, who is harmed if
   it is wrong, what evidence would change your mind.
4. Record each outcome (held, changed, dropped) as the skill's Record section says.
5. After eight challenges, give the readiness report and ask whether to go on.

## Stop

Continue until the user says stop or every listed assumption has an outcome.
Never edit `contract.yaml`; if a challenge changes a requirement, hand the change
to the `plan` skill. Never write code from this command.
