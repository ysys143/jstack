# When two loaded conventions point opposite ways

`scripts/load_guidelines.js` appends preset blocks to a project's `CLAUDE.md`.
Load more than one and the file ends up holding rules that point in opposite
directions. A contradiction with no declared priority is not resolved by the
agent reading it — it is applied at random, differently on each run, and the
project cannot tell an inconsistent agent from an inconsistent rule set.

So the priority is declared here, before the presets are loaded, and the
resolution is written into the project's own `CLAUDE.md` next to the blocks that
collide.

## Name the clauses, never the numbers

The same clause carries a different number in the two Cherny blocks, because
`--cherny` emits five principles and `--cherny-full` emits eight:

| Clause | `--cherny-full` | `--cherny` |
| --- | --- | --- |
| Plan Before You Build | 1 | absent |
| Divide and Conquer | 2 | 1 |
| Learn from Every Mistake | 3 | 2 |
| Prove It Works | 4 | absent |
| Demand Elegance, But Know When to Stop | 5 | 3 |
| Fix Bugs Autonomously | 6 | 4 |
| Core Principles | 7 | absent |
| Pick the Right Parallelization Primitive | 8 | 5 |

A conflict note that says "principle 6" is wrong in half the projects that read
it. Write the clause name.

## Fix Bugs Autonomously vs Think Before Coding and Surgical Changes

Cherny's **Fix Bugs Autonomously** says to resolve a reported bug without asking
the user how. Karpathy's **Think Before Coding** says to stop and ask when
something is unclear, and **Surgical Changes** says not to touch adjacent code.
Loaded together they answer the same question — "I found something else broken,
what now?" — in opposite ways.

The resolution is a limit on where the autonomy clause applies, not a ranking of
the two authors:

| Situation | Which clause wins |
| --- | --- |
| A reviewer other than the author reads the diff before it merges | Fix Bugs Autonomously — a second reader catches the overreach |
| No reviewer: a one- or two-person team, or a solo repository | Think Before Coding and Surgical Changes — report the bug, do not fix it in this change |
| The bug is inside the change already being made | Fix Bugs Autonomously, regardless of reviewer — it is not adjacent code, it is this code |
| The fix would touch a file the task never named | Surgical Changes — flag it, and let the next task own it |

Autonomy is cheap where somebody checks the result and expensive where nobody does.
Without a reviewer, "fix it without asking" is scope creep under a better name.
The diff grows, nobody reads the growth, and the user discovers it at merge time.

Cherny's own clause already concedes the boundary — it says to flag rather than
silently modify anything outside the current task's scope — so limiting it to
reviewed teams sharpens the clause rather than overruling it.

## Demand Elegance vs Minimal Impact and Simplicity First

**Demand Elegance, But Know When to Stop** asks for a better solution when the
first one feels hacky. **Core Principles** carries Minimal Impact — modify only
what is needed — and Karpathy's **Simplicity First** says to write the minimum
code that solves the problem. With `--cherny-full` all three land in the same
`CLAUDE.md`, and two of them are from the same author.

| Moment | Which clause wins |
| --- | --- |
| Before the code is written | Demand Elegance — the question costs one paragraph and changes the design |
| After the code is written and works | Minimal Impact and Simplicity First — a rewrite now buys taste and spends review |
| The first attempt is hacky and not yet reviewed | Demand Elegance, once. Elegance is asked once, not iterated until satisfied |
| The change is a simple, obvious fix | Minimal Impact — the elegance clause excludes these itself |

Elegance is a question asked at design time, not a licence to rewrite working code afterwards.
Read the other way it cancels Minimal Impact entirely, and every bug fix becomes
a refactor.

## Plan Before You Build was transferred, not lost

**Plan Before You Build** exists only in `--cherny-full`. It was cut from the
abbreviated block as a duplicate, and the deduplication was correct: this
plugin's `plan` skill owns deciding what to build before code is written, in
more detail than a five-line preset clause can carry.

But an unrecorded transfer is indistinguishable from an omission.
The next reader compares the two blocks, finds a verifiable clause missing from
one, and restores it — and now the project has two owners for planning that
drift apart. So the transfer is recorded:

| Clause cut from `--cherny` | Who owns it now |
| --- | --- |
| Plan Before You Build | the `plan` skill — spec before code, replan when the plan goes off track |
| Prove It Works | the `verify` skill for the completion judgment, and `tdd` for the evidence |
| Core Principles | Karpathy's Simplicity First and Surgical Changes cover the same ground |

A project loading `--cherny` alone gets the orchestration clauses and none of
the three above. That is the intended shape only when the skills that own them
are present; in a repository that has the preset but not this plugin, load
`--cherny-full` instead.

## Recording a conflict in the project

Write the resolution into the project's `CLAUDE.md`, under the preset blocks it
governs, and say which clauses it reconciles. A resolution kept only here is one
the agent reading that project never sees.

Three things belong in the note: the clauses by name, the condition that decides
between them, and who to ask when the condition itself is unclear. Leave out the
last and the note becomes another rule with no escape hatch.

## Boundary

Which presets a repository should load at all is a `setup` decision made from
what the repository already does. What the individual clauses mean is the
preset's own text. This file covers only the collisions between clauses that are
loaded together.
