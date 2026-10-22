# Pre-mortem for high-cost plans

Use this procedure to find plan-specific failure paths before execution and make
the plan answer them.

## When to omit

- Skip a small, local task that is cheaply reversible, active incident response,
  or a re-entry after execution has already started. This is a pre-execution
  review; do not interrupt incident work or repeat it after the plan is underway.
- Skip when a maintained risk register already covers the same specific failure
  paths, with named owners and checks.
- Existing CI, canary, rollback, or alert gates justify omission only when you
  can state that there is **no residual path the gates miss**.

## Procedure

1. Assume the plan has failed. Describe a concrete failure in past tense:
   the launch was missed, migration data could not be restored, or the service
   objective was breached. Keep the failure tied to carrying out this plan, not
   a generic prediction that something may go wrong.
2. Collect possible causes broadly before ranking them. Consider technical
   assumptions, dependencies, sequencing, process, and people. Ask what the plan
   most needed to be true that was not true. Do not prune the list while
   collecting it.
3. Group related causes and select the three to five most consequential risks
   that are tied to this plan. Drop labels such as “scope creep” unless they
   describe a concrete path through one of this plan's steps or dependencies.
4. For each selected risk, state the conditions that had to hold for the failure
   to happen. Turn each condition around into a requirement that can be checked
   and would prevent or expose that failure.
5. Bind every requirement to the plan:
   - Add a machine-checkable risk as a version 2 `검증` item only when the
     project has a real command that checks it. Give it a stable `요구ID`, a
     positive `명령`, and a `반증` command scoped to the temporary `{RED_ROOT}`
     copy. The RED check must alter only that copy. Reuse a command the project
     actually provides; do not invent a command to make a risk appear
     verifiable.
   - For every other risk that cannot be checked by such a command, put its
     check point and named owner in the plan body, bound to a gate that must pass
     before the stage it protects, such as execution, release, or a migration
     step. A check that can only happen after release does not satisfy the gate.
     Do not represent it as machine-checked.
   - When the plan has no contract, put the verifiable requirements in the
     spec's Acceptance criteria, and still bind each human follow-up to a plan-body
     gate that must pass before the stage it protects, with a named owner and
     check point.
6. Make a concrete plan change for the selected risks, such as a new task, a
   decision point, or an owned check. A risk list without a corresponding plan
   change is incomplete. If the plan did not change, the pre-mortem is incomplete.
7. Stop when the selected risks have a bound requirement and further candidates
   are only generalities. Remove those generalities instead of adding them as
   unowned work.

## Keep it distinct from Phase 1

The interview question "What if it fails" (the `requirements-interview` skill)
asks how the feature behaves when it fails. A pre-mortem asks how carrying out
the plan failed and what must change before execution to prevent that outcome.
