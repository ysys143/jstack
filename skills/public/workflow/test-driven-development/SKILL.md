---
name: test-driven-development
description: "Build a bounded feature test-first, then refactor. Triggers: TDD, 테스트 먼저."
---

# TDD — test first

## Why incremental is folded in here

**Slicing the work and building each slice test-first happen at the same moment.**
"Do it in small steps" and "write the test first" are two phrasings of one task.
Kept apart, they cost two always-on descriptions and still fail to load together
when you need both.

Outer loop = slice. Inner loop = red-green-refactor.

## Phase 0: detect the language — load exactly one guide

Look at the project root and load **only** the matching guide. Do not read the others.

| Detected | Load |
|---|---|
| `tsconfig.json` | `langs/typescript.md` |
| `package.json` (no tsconfig) | `langs/javascript.md` |
| `pyproject.toml` · `setup.py` · `requirements.txt` | `langs/python.md` |
| `Cargo.toml` | `langs/rust.md` |
| `go.mod` | `langs/go.md` |
| `pom.xml` · `build.gradle` | `langs/java.md` |
| `CMakeLists.txt` · `configure.ac` · `meson.build` · `Makefile` **with `*.c`** | `langs/c.md` |

**If detection fails, ask.** Guessing the framework wrong means throwing away the
whole test file.

`Makefile` alone decides nothing — Go and Rust projects ship one too. C is claimed
only when `*.c` sources sit beside it, and a mixed C/C++ tree is a question for the
user, not a guess.

The guide supplies the framework, file layout, mock patterns, and run commands
used by every later phase.

## Read this one whatever the language

`references/antipatterns.md` — flaky tests (clock, randomness, network), order
dependence, and over-mocking that leaves integration unverified. These take the
same shape in every language, so leaving them inside the language guides meant
**they were visible or invisible depending on what the project was written in.**
Read it before Phase 3.

`references/test-budget.md` — the design checklist, the time budget and flakiness
check for new or changed test files, and how to review a test someone else wrote.
Run its budget check before reporting a new test as done.

`references/test-portfolio.md` — test sizes, the shape of the suite, oracle
strength, and when to add property-based, fuzzing, snapshot, or mutation tests.

## Phase 1: cut the slices (outer loop)

A **thin vertical slice** runs end to end — from entry point to storage — in the
smallest form that works. Do not slice by layer; "model first, controller later"
is not a slice.

| A slice | Not a slice |
|---|---|
| "Log in with email and land on the dashboard" | "Build the User model" |
| Runs end to end and **demonstrates behaviour** | Does nothing until other layers exist |

**Each finished slice must add one thing that runs.** If nothing new runs, the
slice was cut wrong.

## Phase 2: scenarios in user terms [approval required]

Write them as **user behaviour and business rules**, not code structure.

```
## Test Scenarios
1. Correct email and password → dashboard
2. Wrong password → stay on the form, show the error
3. Five failures → locked for 15 minutes
```

**Do not proceed without the user's approval.** Wrong scenarios make everything
below them wrong — this is the most expensive point to get wrong.

Two approvals are required — scenarios, then cases — and a rule with no enforcement
is a recommendation. Record both in the plan and let the checker read them:

Requires Node.js 20+.

```bash
node ${JSTACK_PLUGIN_ROOT}/skills/tdd/scripts/test_gates.js approvals \
    --plan docs/tests/TEST_PLAN.md
```

It fails on a missing approval, a placeholder value, and a case approval recorded
before the scenario approval — the order is part of the gate.

## Phase 3: red — a failing test first

Turn one scenario into a test and **watch it fail**.

**A test whose failure you never saw is not a test.** Accepting a green run
without seeing red means you got the colour without knowing what it measures —
a harness that has only ever gone green can carry the same defect through round
after round of review unnoticed.

## Phase 4: green — make it pass

Use **the simplest thing that works**. Hardcoding is legitimate here; the next
scenario will push it out.

## Phase 5: refactor — change structure while green

Restructure only while the tests are green. Refactoring from red leaves you
unable to tell which change broke what.

## Phase 6: gate the diff, then the next slice

Absolute coverage thresholds take legacy debt hostage: a repository at 43% cannot
be brought to 80 by one pull request, so the gate gets switched off. Gate the
**lines this change added** instead — they are the ones a test just went red for.

```bash
node ${JSTACK_PLUGIN_ROOT}/skills/tdd/scripts/test_gates.js diff-coverage \
    --diff <(git diff -U0 "$(git merge-base origin/main HEAD)"...HEAD) \
    --coverage coverage.xml --fail-under 90
```

It reads LCOV, Go coverprofile, Cobertura and JaCoCo, and passes when a change adds
no executable lines. Each `langs/*` guide carries the same gate in that language's
own tooling under **diff coverage**.

Back to Phase 1. **Completion is judged by the `verify` skill** — "the tests pass"
and "the requirement is met" are different questions.

## Common failures

- **Batching tests afterwards** — they end up shaped by the implementation and
  stop catching its defects
- **Several scenarios in one test** — a failure no longer tells you what broke
- **Mock overuse** — you end up testing the mock. Replace only the boundaries
  (network, clock, filesystem)
- **Skipping the red step** — Phase 3 requires it

## Boundaries

| Task | Owner |
|---|---|
| Completion judgment, requirement coverage | `verify` skill |
| Deciding what to build | `plan` skill |
| Judging existing code quality | `audit` skill |

## Limits (stated)

- Language guides cover **seven** languages. Outside them, ask the user for the framework
- The diff gate measures coverage, not correctness. A covered line with a
  tautological assertion still counts as covered
- This skill supplies the procedure; the language's own tooling runs the tests
- **Scenario approval is a human step.** It is never automatic

## Optional SDLC caller

When an explicitly selected `sdlc` run supplies context, preserve its task/run,
requirement revision and input hashes with the raw result and execution observation.
Return the original verdict and unverified scope to that coordinator; do not advance
its stage or approve a human gate. A standalone or external caller does not need
an SDLC run or new mandatory arguments.
