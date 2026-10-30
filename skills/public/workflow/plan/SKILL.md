---
name: plan
description: "Clarify requirements and write a spec before coding. Triggers: 계획, 요구사항, plan."
---

# Plan — decide before building

For task requests and corrections, follow the shared [request continuity protocol](../../runtime/TASKS.md) once per session.

For security requests (vulnerability discovery, reproduction, or fix verification),
conditionally read the [security scope contract](references/security-scope.md).
Do not impose a threat model, security specification, or execution on ordinary planning.

## Explicit shaping and consensus requests

Only an explicit request from the user, or an explicit selection by a workflow
the user started, selects one of these reference procedures. An ordinary plan
request keeps the three phases below, in order, and reads neither reference; a
reference never replaces the interview, the spec or the zoom-out of ordinary
planning.

- An explicit `consensus-plan` or `plan --consensus` request selects
  [the consensus recipe](references/consensus-plan.md): fixed alternatives and
  criteria, independent reviews of one fixed revision, author-only synthesis and
  a finite re-review cap declared up front. It returns a plan and its dissent,
  never automatic execution.
- An explicit brainstorming or design-shaping request selects
  [the shaping core](references/brainstorming.md). It reads the repository first
  and chooses spike, bounded or architectural depth from that evidence. Bounded
  work needs no full spec.

If material design choices stay open during ordinary planning, offer shaping or
consensus once per plan; do not enter either without that explicit selection.
Executing an already accepted spec is a non-trigger for both: do not reopen the
design or the review for it.

## Why three things in one skill

**The questioning gate, writing the spec, and checking it against the whole**
form one ordered task. Kept apart they cost three always-on descriptions, and the
moment you are mid-spec and need to ask "does this fit the whole?", that skill is
not loaded. The questions themselves live in their own skill because they are
needed at any point of the work, not only before the spec; the gate stays here.

## Phase 1: interrogate (grill)

**Stop when the urge is to start coding.** A requirement that looks clear and one
that is clear are different things.

The questions and how to ask them belong to the `requirements-interview` skill:
it reads the evidence first, asks one question at a time, and records the answers
in this spec. Run it here for a new request, and again whenever the user asks to
be interviewed or grilled, during building as well as before.

**Run a question that a run can answer.** Before asking which approach works, ask
whether running something would settle it (behaviour, timing, output,
performance). If so, run the smallest throwaway probe in a scratch directory and
report the result. Ask only about product or preference calls no run can settle.
The probe states its question, method and effects first, stays local and
reversible, installs nothing, touches no shared state, and its code is never kept.

**What stops and what does not.** Stop for a question that evidence cannot answer
and that changes purpose, acceptance, scope or authority, and before any step that
is hard to undo or leaves this machine (push, PR, publish, delete, install, paid
API, long-running service). Everything else is local and reversible: reading,
probing, drafting the spec, even drafting the contract. Do it, and report what you
did and what is still open in the same reply, so the user corrects afterwards
instead of approving each step.

**Do not proceed while ambiguous.** If you cannot get the answer, report it as a
blocker: name the question, what it blocks and who can answer it, and record it as
`open` in the spec. Do not fill the gap with an assumption and move on. Work that
does not rest on the answer may continue. A small reversible choice that nothing
else depends on is the one exception: record it under Assumptions with the
condition for revisiting it.

## Phase 2: write the spec

For an uplift, transform, or reimagine of code (a version upgrade on the same
stack, a stack replacement, or a rebuild that changes behavior), read
[the migration verification reference](references/migration-verification.md)
before writing Decisions and Acceptance criteria. A schema or data migration
alone is not one.

Such a plan declares where breakage is allowed and what each phase must pass, and
does not plan compatibility copies; the reference says how.

Put these sections in `spec.md`.

| Section | Contents |
|---|---|
| **User stories** | Who, what, why |
| **Acceptance criteria** | **In verifiable sentences.** "Works well" is not a criterion |
| **Edge cases** | The boundaries surfaced in Phase 1 |
| **Constraints** | Performance, compatibility, deadline, what must not be used |
| **Decisions** | Answers from Phase 1, carried from the interview's record |
| **Assumptions** | Small reversible choices made instead of an answer, and when to revisit them |

**Whether the acceptance criteria are verifiable is what makes this document
worth writing.** Not "responds quickly" but "p95 under 200 ms"; not "is secure"
but "unauthenticated requests get 401".

### Sketch the shape before the code

For non-trivial work, add a **Shape** section to the spec, written before any
implementation.

- Write the caller's usage first, then derive types, signatures and module
  boundaries from it, with `not implemented` bodies or pseudocode instead of
  working code. Get the core data structures and their access paths right before
  any logic; the logic that follows is then close to obvious.
- Compare at least two structurally different shapes, not point fixes inside one.
  Prefer the one that hides more behind a smaller interface and in which a change
  that looks right from one file is right for the whole repository.
- Put what every later slice benefits from (shared types, test setup, CI) first,
  after removing the dead code in its way.
- When a new requirement lands in an existing design, redesign as if it had been
  there from the start, carry it through types, docs, examples and rationale, and
  deliver it in slices. Do not bolt it on.
- Once implementation starts, the sketch is the contract. A need it did not
  foresee is a signal to surface, not to absorb. If the same workaround keeps
  appearing, or types need escape hatches such as casts, the sketch is wrong:
  redraw it instead of patching.

### The machine-readable half

For work that needs a durable handoff, write a version 2 contract and initialize
one state root; before initialization, read [the pre-mortem reference](references/pre-mortem.md)
if any of these apply: the work is expensive to reverse, a launch or migration is
imminent, or there is evidence that the plan may be optimistic.

```bash
node "${JSTACK_PLUGIN_ROOT}/skills/verify/scripts/workflow.js" init <task-id> contract.yaml
```

The immutable copy is `.jstack/tasks/<task-id>/contract.yaml`. It names the task,
whether delegation is needed, readiness probes, and one or more verification
requirements. Each requirement has a stable ID, a user-observable behavior,
the files that implement it, a positive command with its expected exit code,
and a RED command with its expected exit code. RED receives only a temporary
copy through `{RED_ROOT}`; list every fixture, configuration file, and dependency
file that copy needs under `관련파일`.

A minimal local contract is complete enough to run as written:

```yaml
계약버전: 2
작업ID: add-fix
발동: 사용자
위임: 불필요
준비:
  - 도구: python3
    확인명령: python3 --version
산출:
  - 경로: app.py
    형식: Python
검증:
  - 요구ID: ADD-1
    사용자행동: Return the sum when adding two numbers
    관련파일: [app.py, test_app.py, red_check.py]
    등급: 기계
    명령:
      실행: python3 test_app.py
      기대종료: 0
    반증:
      실행: python3 red_check.py {RED_ROOT}
      기대종료: 0
    인간검토: 불필요
    추가검토:
      - 종류: cold-read
        적용: 생략
        생략사유: A machine check of this single function directly verifies the user behavior
```

`red_check.py` must alter only the copy named by its `{RED_ROOT}` argument and
must return the declared code only when that alteration makes the positive
behavior check fail.

Set `인간검토` to `필요` only when a person must decide. Select additional
reviews per requirement rather than by ceremony: `cold-read`, `사실`,
`평가독립성`, `SSOT`, or `이식성`. Mark an inapplicable review `생략` and
state why. A required review without a native reviewer result remains open.

`scripts/contract_lint.js` keeps accepting version 1 contracts for historical
documents. Version 2 additionally rejects an empty requirement set, duplicate
requirement IDs, paths outside the repository, a prose-only RED field, an
unscoped RED command without `{RED_ROOT}`, and unexplained review skips. It
retains the verification grades `기계 | 인간 | 불가 | 미상`. It exits 2 — not 0 —
when it could not run at all. The workflow's verify command
runs this linter before reading earlier task claims or executing any check.

Small local work may set `위임: 불필요`; it still gets fresh verification, while
the delegation brief and agent operations are skipped.

## Phase 3: check it against the whole (zoom-out)

Step back from the implementation and look at three things.

1. **Does it overlap something that exists** — if so, changing that is usually better
2. **Does it belong at this layer** — is the responsibility in the right place
3. **Is it more than needed** — generalising for a case you do not have yet

**If it is more than needed, cut it.** Growing it later usually costs less than
maintaining something unused now.

### Re-entering mid-implementation

The same check runs again when you have been deep in an implementation and no
longer know whether it still fits. Read `references/slice-shape.md` — it carries
the horizontal-layer antipattern in the form it actually appears, the four
judgment axes, the report shape, and the four actions one of which has to be
chosen. **Ask what runs at the end of step one.** If the answer is "nothing yet,
but the next step needs it", the work drifted into layers and the slices have to
be recut before more of them are built on that answer.

## When to go back to Phase 1

Go back the moment a question appears **that you cannot answer**. Filling it with
an assumption and moving on bakes that assumption into the code. The one exception
is the small reversible choice from Phase 1, recorded under Assumptions.

## Boundaries

| Task | Owner |
|---|---|
| Asking the questions, before or during building | `requirements-interview` skill |
| Building what was decided | `tdd` skill |
| Recording why it was decided | `decide` skill (ADR) |
| Judging whether it is done | `verify` skill |

## Limits (stated)

- This skill supplies **a gate and a format**. The answers are the user's
- It does not check whether the spec is correct — only whether it is written **verifiably**
- Whether something is over-built is a judgment. This skill only forces the question

## Optional SDLC caller

When an explicitly selected `sdlc` run calls this skill, follow
[the leaf rules in sdlc](../sdlc/SKILL.md#leaf-skills-called-by-a-run). A standalone
call needs no run context.
