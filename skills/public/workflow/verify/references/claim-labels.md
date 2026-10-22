# Claim labels — what the evidence covers

`SKILL.md` phase 3 splits checks by **who settles them**: a machine, a person,
or nobody. That axis is necessary and it is not sufficient. It says a command
ran; it does not say what the command's output reached. A green `pytest` on a
suite that never imports the changed module is machine-settled and covers
nothing.

So a claim carries **two** coordinates, and they are orthogonal:

| Axis | Question | Values |
| --- | --- | --- |
| Verification grade | Who settles it | machine · human · impossible · unknown |
| **Claim label** | **What the evidence covers** | **`verified` · scope-limited `verified` · `insufficient-coverage` · `unsupported`** |

Neither collapses into the other. `unsupported` with grade *machine* is common
and honest — the command ran, and it proved a precondition rather than the
claim. `verified` with grade *human* is also legal: a person read the output
and the reading covered the whole claim.

## The four labels

| Label | Meaning |
| --- | --- |
| `verified` | The evidence covers the whole claim. It **never exceeds the review input scope or the evidence timestamp** |
| scope-limited `verified` | True inside a stated boundary. Legal **only when the boundary is written next to the label** |
| `insufficient-coverage` | Machine verification happened and its **coverage was partial** |
| `unsupported` | Only the preconditions are supported; the claimed result is unproven |

## The four rules

**1. `verified` never exceeds the review input scope or the evidence timestamp.**
If you read six of nineteen files, the label covers six files. A previous run
remains evidence only for its recorded inputs and environment. Changes within
that scope expire the result. Reuse requires a current comparison of source,
tests, configuration, dependencies, toolchain, and relevant environment, including
dirty and untracked inputs. If the dependency boundary or external state cannot
be established, rerun the affected check. Preserve the original run timestamp;
an input comparison is not a new test execution. Required task and CI gates
remain mandatory.

**2. Filename correspondence is not evidence.** A file named
`test_retry_policy.py` existing does not settle "the retry policy is tested".
Neither does a section heading named after the requirement, an import of the
module under test, or a row in a coverage report with a nonzero number. What
settles it is the assertion's text and the fact that it fails when the behaviour
is broken. This rule exists because filename matching is the single most common
way a review reports coverage it never looked at.

**3. Preconditions only means `unsupported` or `insufficient-coverage` — never a
`verified` with caveats.** "Verified, though I could not check X" reads as
verified and gets quoted as verified downstream, with the caveat stripped by the
first person who summarises it. The label is what survives summarisation, so the
label has to carry the bad news. There is no such thing as a qualified
`verified`; there is a different label.

**4. Scope-limited `verified` is allowed.** The point of rule 3 is not to punish
partial work. If the boundary is stated — "verified for the Python path;
Go untested" — the label is honest and useful, and it is strictly better than
downgrading everything to `unsupported` out of caution. A label nobody can act
on has the same effect as no label.

## Decision tree

Run it top to bottom. The first line that matches is the label.

```
1. Did any evidence run at all (a command, a read, a person's judgement)?
   no  -> unsupported
2. Does the evidence bear on the claimed result, or only on its preconditions?
   preconditions only -> unsupported
3. Is the only link between evidence and claim a name — a filename, a heading,
   an identifier that resembles the requirement?
   yes -> unsupported          (rule 2: correspondence is not coverage)
4. Do the recorded inputs and relevant environment still match the claim?
   no -> insufficient-coverage (re-run rather than relabel)
   unknown -> insufficient-coverage (establish the binding or rerun)
5. Did the evidence reach every part of the claim?
   no, and the gap is a stated boundary you can name
       -> scope-limited verified, with the boundary written next to it
   no, and the verified boundary cannot be established
       -> insufficient-coverage
6. Otherwise -> verified
```

Step 5's two branches are the one place people mislabel. The test is whether
you can *name* the excluded region. "Go untested" is a boundary. "I am not sure
how much of it the suite touched" is partial coverage, and partial coverage that
you cannot delimit is `insufficient-coverage`, not a scope note.

## Worked examples

| Situation | Label | Why |
| --- | --- | --- |
| Full suite green, changed module exercised by three failing-then-passing tests | `verified` | Evidence covers the claim |
| Suite green; changed module has no importing test | `unsupported` | Preconditions (suite runs) only |
| `ruff` clean, but the claim was "the refactor is behaviour-preserving" | `unsupported` | Lint does not bear on behaviour |
| Tests pass on Python; Go path has no runner in this repo | scope-limited `verified` | Boundary is nameable |
| 40 of 190 call sites reviewed by hand | `insufficient-coverage` | Gap is countable, not nameable |
| Ran the suite before the last three commits landed | `insufficient-coverage` | Timestamp precedes the tree |
| A `README` says the feature is supported | `unsupported` | Documentation is a claim, not evidence |

## Writing the label in a report

The label goes in the same row as the check, never in a footnote:

```
| Check | Command | Result | Label |
|---|---|---|---|
| Tests | `pytest -q` | 142 passed | verified |
| Types | `mypy src/` | 0 errors | scope-limited verified — `src/` only, `tools/` unchecked |
| Retry policy | — | not exercised | unsupported |
```

A report whose rows are all `verified` deserves one more question before it is
believed, because the natural distribution of a real verification pass is mixed.

## What this does not do

- It does not rank the labels into a score. Three `verified` rows do not offset
  one `unsupported` row on the thing that mattered
- It does not decide whether the claim was worth making. That is the acceptance
  criterion's job, and it belongs to `plan`
- It cannot detect a claim that was never written down. A label only ever
  attaches to a claim someone stated
