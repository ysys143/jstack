---
argument-hint: "[plan file or topic]"
---

# /consensus-plan — review one fixed plan independently, then revise it

Follow the `plan` skill's consensus recipe: read its consensus-plan reference in
full before anything else. `$ARGUMENTS` is a plan file or a topic to plan, or
empty. Empty means the plan or spec in progress; if there is none, say so and
stop.

## Sequence

1. Fix the alternatives, the criteria and the finite round limit before any
   review, and tell the user the limit. Freeze one plan revision.
2. Run the independent assessors on that unchanged revision, each without the
   other's answer. If separate assessors are unavailable, return unavailable;
   if their isolation cannot be evidenced, return unverified. In both cases
   never present one author's roleplay as consensus.
3. Synthesize the answers yourself as the plan's only author, revise the whole
   plan, and send the entire revision back for review until the criteria
   assessor approves or the declared limit is reached.

## Stop

Return the best plan with its unresolved dissent and the recipe's exact status:
converged, pending approval, partial, unavailable, unverified or cancelled.
Consensus is not approval to execute. Never edit `contract.yaml`; never
implement, commit, or hand the plan to an executor from this command.
