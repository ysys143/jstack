# Choosing a Skill, Command, Agent, or Hook

This table is authoritative. Other skills should reference it rather than maintain divergent copies.

## Why There Were Three Copies

Three places answered the same question differently:
`organizational-guides` covered hooks, agents, and skills; harness instructions
covered only skills and agents and prohibited commands; and `automation-scout`
covered skills, commands, and agents. All three classified by what a component
does, which is not decidable: cleanup can be analysis, workflow, and automation
at once. Distributing these answers is worse than deleting one copy because
there is no authority for resolving their conflicting recommendations.

## Two Decision Axes

1. **When is it invoked?** If two branches begin at the same user decision, keep one skill and move detail into references. If the user must choose which operation to invoke, they are separate decision points. If input determines the branch automatically, it is implementation detail.
2. **What is the cost of a violation?** Move behavior into a stronger layer because a violation causes harm, not merely for reassurance.

These axes are exclusive, decidable, and expose persistent cost. A matrix that
hides that cost is biased toward creating more components; the earlier
activity-based scheme accumulated 19 layer-0 components in exactly that way.

## Decision Matrix

| Component | Invocation | Unique ability | Persistent cost | Failure mode |
|---|---|---|---|---|
| Skill | Model selects it from the situation | Attaches judgment to a situation | Name and description | Unselected judgment pays listing cost without effect. |
| Command | User invokes a name | Gives a fixed procedure one explicit entry point | Name and description | The user must repeatedly invoke work the model should infer. |
| Agent | Delegator invokes it | Separate context window | Name and description; highest unit cost | Without a separate-context need, it is an expensive skill. |
| Hook | Harness invokes on an event | Can block execution | Runs on every matching event | Harmful work passes, or harmless work is blocked. |

If the unique-ability cell is empty, there is no basis for choosing that layer.

## Three Clauses Retained from the Copies

- **Only hooks can enforce a block.** The other three layers can give
  instructions but cannot stop execution. A need to block is therefore the
  sufficient condition for choosing a hook.
- **An agent's unique ability is a separate context window.** Counting only its
  cost makes an agent always lose; long, noisy, or parallel work supplies the
  corresponding benefit.
- **Use the minimum tool set.** Give each layer only the tools needed for its
  work. A write tool on a read-only reviewer can silently turn judgment into
  execution.

## Component Types Have Different Unit Costs

Unit costs also differ within always-on listings. In the measured inventory,
9 agent types accounted for about 74% of the always-on cost. Adding one skill
and adding one agent are therefore different accounting events: treat creation
of an agent as a more expensive decision than creation of a skill.

## After the Decision

After selecting the component type, use `placement.md` to choose source location and distribution. See `layers.md` for detailed size and misuse costs.
