# Briefs — the fields, and what each one prevents

## The fields

| Field | Prevents |
| --- | --- |
| The deliverable, in one sentence | An agent that explores instead of producing |
| The output shape | A report you have to re-read to extract anything from |
| Already established | Rediscovery, and rediscovery that lands somewhere different |
| Explicitly out of scope | Scope drift into the neighbouring agent's work |
| How it will be checked | Work that cannot be verified when it comes back |

The fourth field matters most when several agents run at once: without it, two
of them do the same middle piece and neither does the edge.

## Say what is settled, not just what is asked

The brief carries conclusions the conversation already reached — the file that
turned out to be the wrong one, the approach already rejected, the constraint the
user stated. Omitting them does not make the agent neutral; it makes it repeat
work with a different outcome, and now there are two answers.

## Shape the output for the merge

Ask for the form you will combine, not the form that is easiest to write. If
five agents return prose and you need a table, you do the conversion five times
and introduce five chances to lose something.

State the shape in the brief, including what to say when the agent finds
nothing. An agent that finds nothing and says nothing is indistinguishable from
an agent that failed.

## Bound the exploration

A brief with no boundary produces an agent that reads until it runs out of room
and then summarises what it happened to have read. Say where to look, or say how
much is enough, or say what would settle the question — any one of the three
turns an open-ended read into a finishable task.

## The report is not the work

Ask for evidence in the report — the command that was run, the number that came
back, the path that was touched. A report that says "verified" without saying
what was checked cannot be distinguished from one that checked nothing, and the
two are equally likely to arrive.


Ask each worker to close with one verdict: `PASS`, `ISSUES` or `BLOCKED`, each
backed by the command or artefact it names. A worker that can prove a defect
reports `ISSUES` and lists every defect it can prove, not only the first; the
first one found is rarely the only one, and a second pass costs more than a
longer first report. `BLOCKED` says what stopped the work and what would unblock
it. A report with no verdict is a gap, not a pass.


## Context, authority, and concurrency

State whether the agent starts fresh or inherits a fork. A fresh brief includes
all task-specific tool restrictions, read/write scope, prior decisions, completion
criteria, and evidence requirements. A fork can also inherit the coordinator's
instructions: explicitly constrain a leaf worker with “Complete this assignment
directly. Do not spawn other agents; parent delegation instructions apply only
to the parent.” Inheritance is not permission to redelegate.

Use the session's actual concurrency budget, including the coordinator. Four was
the cited Codex article's default, not a fixed jstack limit. Queue excess independent
work instead of exceeding the budget. The coordinator keeps communicating with
the user, tracks owners and blockers, integrates results, and avoids duplicate
investigations. One writer owns a file until an explicit handoff. A worker that writes
gets its own worktree or branch, so two writers never share one checkout.

Implementation teammates may exchange relevant discoveries directly when native
messaging is available. Independent reviewers do not see one another's conclusions
or the executor's reasoning before their own findings. Messaging does not turn
an artifact claim into verified evidence or authorize external messages.

Only read this section when delegation is actually selected. A small local task
needs neither a team nor a new task-contract ceremony. Use `../../models/references/tiers.md` for effort selection; the owning `models`
skill selects reasoning effort while this brief preserves task authority.

Source: [Eric Provencher, Practical multi-agent orchestration in Codex, 2026-07-25](https://x.com/pvncher/status/2080707291603407077).
