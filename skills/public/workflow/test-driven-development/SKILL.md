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

Write them as **user behaviour and business rules**, not code structure. Give every
scenario and every case an ID: the approval checker looks for `TS-NNN` and `TC-NNN`
rows, then for the two approval lines. Once both approvals are in, the plan looks
like this:

```
## Test Scenarios

| ID | User action | Verification goal |
|---|---|---|
| TS-001 | Correct email and password | Land on the dashboard |
| TS-002 | Wrong password | Stay on the form, show the error |
| TS-003 | Five failures in a row | Locked for 15 minutes |

Scenario-Approved-By: Dana Lee 2026-09-02

## Detailed Test Cases

| Case ID | Scenario | Expected result |
|---|---|---|
| TC-001 | TS-001 | Redirect to the dashboard |
| TC-002 | TS-002 | Form stays, error message shown |
| TC-003 | TS-003 | Sixth attempt refused for 15 minutes |

Case-Approved-By: Dana Lee 2026-09-02
```

The approval line is `<Marker> <name> <date>`. Write it only after the user has
said yes, or have the user write it. The checker reads the line but cannot tell who
typed it, so a line written beforehand turns the gate into a formality. A
placeholder such as `TBD`, `-` or `N/A` fails.

**What waits and what does not.** Drafting scenarios or cases, reading
code to find the behaviour they describe, and running a throwaway probe in a
scratch directory are local and reversible: do them without asking, and say in your
reply what you drafted or ran. A probe that installs a dependency, touches shared
state or writes outside this machine is not that kind of step; ask first.

**Do not proceed without the user's approval.** Everything from Phase 3 on is built
on the scenarios. Wrong scenarios make everything below them wrong — this is the
most expensive point to get wrong. Cases get the same stop before the first test
is written.

Two approvals are required — scenarios, then cases — and a rule with no enforcement
is a recommendation. Let the checker read the plan:

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

Gate the **lines this change added**, not an absolute threshold: they are the ones
a test just went red for. The threshold and its reason live in
[the diff coverage gate](../verify/SKILL.md#the-diff-coverage-gate).

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

## Fixing a bug

A bug fix is one slice with one scenario: the behaviour the report says is broken.
When a cheap, local test can reproduce it, make the failure executable before
touching production code.

1. Name the intended behaviour, the observed behaviour and the smallest repro. If
   the intended behaviour is disputed, settle it through Phase 2 first.
2. Write the narrowest test that would have caught the bug, in the test file the
   code path already uses. It encodes the intended behaviour, not today's
   implementation.
3. Run it and watch it fail for the reason in the report. A pass, or a failure for
   an unrelated reason, means the test is wrong: fix it before the code.
4. Make the smallest production change that satisfies it, then run it again.

When no cheap test path exists (broad harness setup, brittle mocks, slow end-to-end
infrastructure, production-only state, a vague repro), do not build one to satisfy
the procedure. Use the closest executable check, such as a targeted script, a repro
command or a focused integration check, and say why there is no failing test.
**No new test beats a bad one:** a test that mostly exercises mocks, pins
implementation detail, depends on timing or global state, or would be deleted right
after the fix proves nothing.

Do not edit or weaken an existing assertion to match a wrong implementation, unless
the expected behaviour really changed and you say why. Report the failing-before
test or check and the failure it gave, the passing-after run, and, when there is no
failing-before evidence, why and what you used instead.

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

When an explicitly selected `sdlc` run calls this skill, follow
[the leaf rules in sdlc](../sdlc/SKILL.md#leaf-skills-called-by-a-run). A standalone
call needs no run context.
