---
name: model-selection
description: Choose a model tier for delegated work by error tolerance, supported capabilities and evidence; record why. Triggers — "어떤 모델", "모델 선택", "haiku 로 돌려", "opus 써야", "모델 라우팅", "비용 아끼려면", "서브에이전트 모델", "tier".
---

# Models — route by tolerance, not by size

## The wrong axis

"Big task, big model" is the intuition, and it is wrong twice. A long mechanical
edit across forty files tolerates a cheap model perfectly. A three-line change to
a locking protocol does not.

Route by **what the task can tolerate being wrong about**:

| The task | Tier | Because |
| --- | --- | --- |
| Look something up, restate it, apply a fixed rule | Cheap | The answer is checkable at a glance, and being wrong is visible immediately |
| Ordinary implementation with tests to catch it | Middle | The tests are the safety net; the model does not have to be the safety net |
| Ambiguity with no test that would catch a wrong call — design, protocol, security boundary | Expensive | Nothing downstream will notice the mistake |

The third row is the whole point. Where a mistake is invisible to everything
downstream, the model is the last check, and that is where the money goes.

## Say the tier and the reason

A delegation that names no model inherits one, and the inheritance is invisible
in the transcript afterwards. Name it, and name why in the same breath — one
clause is enough: *"cheap: mechanical rename across the tree"*.

Without the reason the next reader cannot tell a deliberate choice from a
default, and so cannot correct it. A wrong tier that was chosen for a stated
reason gets fixed; a wrong tier that just happened does not.

## Select effort separately from model identity

When delegation is authorized, `references/tiers.md` maps scout/worker/smart-worker
roles to low/medium/high effort where the current session supports those settings.
Record inherited settings explicitly; naming the choice does not require an
override. Keep the inherited model family unless an override is required. Check supported
parameters and context-fork restrictions before overriding; report unavailable
settings rather than silently substituting. Small tasks stay local when delegation
would add more coordination than useful work. This policy does not authorize spawn.

## Do not shard a judgement to save money

Splitting one judgement across several cheap calls does not buy the judgement
cheaply — it buys several partial answers that nobody reconciles. The cost was
never the tokens; it was that the decision needs one context holding all of it.

Splitting **work** is different and usually right. The line is whether the pieces
can be checked separately. `references/tiers.md` has the split test and the
worked cases.

## The model name is not a capability contract

Tiers change with releases, and a name pinned in a document ages into a claim
nobody re-measured. Say what the work needs; keep concrete names in one place so
that when they change, one file changes. Where a specific model was genuinely
measured to behave differently, record the measurement next to the name — not
the impression.

## Where a cheaper tier falls short first

Treat this as a hypothesis to measure, not a settled result: cheaper tiers are
expected not to degrade uniformly but to fall short at held instructions, at
multi-step constraint tracking, and at noticing that the request
contradicts itself. If the task needs any of those held across many steps,
measure the cheaper tier on that task before relying on it, or
restructure the task instead, so that each step holds less.

## The other model question: the name written in the code

Routing decides which tier runs a task. The other question is which model id a
file **names**, and that one ages on the provider's schedule rather than ours —
an id that was current when it was written keeps working right up to the day it
does not. A PreToolUse hook reads that axis on every `Write`, `Edit`, and
`Bash`: an officially retired id blocks the operation, a merely superseded one
comes back as context and lets it through.

The hook is not the authority on the project. When an old id is the right choice
— an API-only model that is far cheaper at volume, a reproduction pinned to the
model that produced the published numbers — the project says so once in
`pyproject.toml` and the check stops arguing. `references/exceptions.md` holds
both switches, what the parser actually does with them, and the edge cases.

**Never locate that database by plugin name.** A `find` or `Glob` over a path
containing the plugin's own name dies the day the plugin is renamed, and it
dies silently: the search prints nothing, the destination variable is empty, and
the sync step still reports success. The hook resolves the database relative to
itself; anything else uses `${JSTACK_PLUGIN_ROOT}`.


## Task routing and completion

For authorized delegation, follow [Runtime routing](../../runtime/ROUTING.md):
plan with `jst route plan`, reserve one attempt with `jst route run`, execute, and
record checked artifacts with `jst route record`. It owns model transitions and
the rules every calling skill follows.

## Boundary

Deciding what work exists at all is the `plan` skill; whether the result is any
good is the `audit` skill. Splitting work across several agents at once is the
`team` skill — that is a question about the shape of the work, this one is about
who runs each piece. This skill covers who does it.
