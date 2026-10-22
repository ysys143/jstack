---
argument-hint: "[topic]"
---

# /brainstorming — shape a design from the repository first

Follow the `plan` skill's shaping core: read its brainstorming reference in full
before anything else. `$ARGUMENTS` is the feature, change or system to shape, or
empty. Empty means the work in progress when there is a spec, a task
contract, or a diff touching the request; otherwise the request just stated.

## Sequence

1. Read the repository before asking anything: the existing flow, callers,
   tests, project instructions and recent changes. Name what you inspected.
2. State the depth (spike, bounded or architectural) and the reason, and let the
   user correct it. If an accepted spec already settles the work, say so and
   stop; do not reopen a design.
3. Ask only the questions whose answers change the design. Compare alternatives
   only where a real consequential choice remains.
4. Present the design at that depth. It stays a proposal until the user accepts
   its scope and revision; a rejection is revised and presented again.

## Stop

Return the result the depth calls for and stop: a spike's recommendation, a
bounded short design, or an architectural design. Never edit `contract.yaml`;
never write code, commit, or start a spec or an implementation from this command
unless the user then asks for it.
