---
name: second-opinion
description: "Get an independent attempt to refute a proposal or result. Triggers: 2차 의견, 적대적 검증."
---

# Consult — ask to be refuted, not approved

## "Does this look right?" gets you a yes

A reviewer handed a finished artefact and an open question tends to confirm it.
The framing does the work: the artefact is presented as the answer, and the
reviewer's job appears to be finding nothing.

Ask the opposite question. **"What is wrong with this, and what would prove
it?"** puts the burden where it belongs and makes silence expensive — the
reviewer now has to say it found nothing, which is a claim it has to stand
behind.

| Ask | You get |
| --- | --- |
| "Review this" | A list of style opinions and one hedge |
| "Is this correct?" | Agreement with the framing you supplied |
| "What breaks this, concretely?" | A failure case, or an admission there is none |
| "Argue the strongest case against" | The objection you had not considered |

## Do not hand over your reasoning

Send the artefact and the question; withhold why you believe it works. A
reviewer given your argument evaluates the argument, and the failure you are
looking for is the one your argument does not cover.

Supply the facts a reviewer cannot obtain — constraints, prior decisions, what
has already been tried. Withhold conclusions. `references/framing.md` separates
the two and gives the phrasings for each.

## A verdict is evidence, not permission

An approval says one reviewer found nothing under one framing. It does not
transfer responsibility, and it does not make an unverified claim true. Where a
verdict can be checked — run the case it named, test the failure it predicted —
check it rather than filing it.

A rejection you disagree with is also evidence: something was legible enough to
be misread. Either the artefact is wrong or its presentation is, and both are
worth fixing.

## Multiple reviewers are one reviewer unless they are separated

Two reviewers who read each other agree by construction. If you want independent
judgements, give each the same artefact and no access to the others' output, and
combine them yourself.

Give them **different angles** rather than the same one repeated — correctness,
failure under load, what a hostile user does, what breaks on the next change. A
repeated angle finds the same thing more times; a different angle finds a
different thing.

## Do not consult to postpone a decision

If you would proceed the same way whatever the answer, the consultation is
ceremony and its cost is real. Ask what the answer would change first; if the
honest answer is nothing, decide and move on.

## When the reviewer is an actual external CLI

Everything above holds whether the reviewer is a human, a subagent, or an
external model — but this plugin also has two concrete backends that make
"different angles" and "no access to the others' output" literal rather than
aspirational.

`references/gemini.md` documents the compatibility entry
`scripts/gemini-bridge.js` for `agy`: one reviewer, one lens, no panel.
It currently refuses inference because no reviewed read-only adapter exists.
`references/ai-council.md` runs the Codex panel through
`scripts/council-bridge.js`; the `agy` participant reports unsupported until a
reviewed read-only adapter exists, so the panel has one independent reviewer. When
a second participant runs, neither sees the other's answer while answering — that is the separation the "one reviewer unless they are
separated" section above requires, enforced by the call shape rather than by
instruction. `references/synthesis-guide.md` is what to do with the two raw
answers that come back: it is the concrete form of "a verdict is evidence,
not permission" and "do not average" for exactly this panel, spelled out as
three rules — role is not a lens, disagreement is the deliverable a panel
exists to produce, and a consensus computed by splitting the difference is
the specific way this kind of tool fails.

`scripts/check-cli.js` and `scripts/parse-output.js` are the two bridges'
shared plumbing (CLI presence checks and output cleanup) — read them only if
a bridge call is behaving unexpectedly, not as a starting point.

## Rules the bridges cannot enforce for you

The bridge scripts pin what a script can pin — the sandbox, the flag set, the
parallel-without-cross-reading shape. These five are on the caller, and each
one has broken a production run when skipped.

**Go through the bridge.** Never invoke `agy` or `codex` directly. The bridge
is where the sandbox pin, the flag set and the separation live; a direct call
drops all three at once and nothing reports that it did.

**Keep reviewer independence explicit.** Native reviewers are permitted when the
routing decision and current session authorize them. Do not describe the same
model in a new context as a different model. A reviewer must not inherit the
executor's conclusions. No session-wide tool lock is imposed when a reviewer
is unavailable; return the limitation and continue independent authorized work.

**Honor model selection.** Use `--model ID` for a single backend and
`--codex-model ID` for the Codex panel participant. A past SDK failure is not a
permanent model prohibition. agy remains unsupported until a reviewed read-only
adapter exists; neither model selection nor installation bypasses that boundary.

**A bridge failure is reported, not improvised around.** When a bridge exits
non-zero, hand the user its exact stderr. Do not fall back to calling a CLI
directly, do not guess a model name, and do not answer the question yourself
while letting it read as though an external model had. Diagnose with
`node "${JSTACK_PLUGIN_ROOT}/skills/consult/scripts/check-cli.js" agy` and the
same line for `codex`.

**When no target is named, derive one before asking for one.** Run
`git diff --name-only HEAD` and take the review candidates from what actually
changed. If that comes back empty, ask the user which files to send — do not
send the whole repository, and do not pick a file by guess.


## Task routing and completion

For authorized delegation, use the common routing contract in
[Runtime routing](../../runtime/ROUTING.md). Run `jst route plan --request FILE`,
then `jst route run --decision FILE` to reserve one attempt. A native decision
is executed through the current session tools; it is not a CLI substitution.
Record independently checked artifacts with `jst route record`. If `jstack` is not
found, follow [jst command on PATH](../../runtime/CLI-PATH.md). Retain explicit
user model choices, permission boundaries, exclusive files, and host fork limits.
Only a verification failure permits one model transition; environment failures
do not justify stronger models. Small tasks stay with the coordinator.

## Boundary

Splitting work across agents so it gets done is the `team` skill; judging code
against this plugin's rubric is the `audit` skill. Handing Codex an actual
write — files changed on disk, under a sandbox and workdir chosen for that
purpose — is the `delegate` skill; `ai-council.md`'s Codex call is pinned to
`--sandbox read-only` for exactly this reason, so asking this skill for a
second opinion can never quietly become that. This skill covers asking to be
proved wrong.

The bridges share literal argument transport, bounded output capture, and native
process deadlines through `scripts/bridge-common.js`.

## Optional SDLC caller

When an explicitly selected `sdlc` run supplies context, preserve its task/run,
requirement revision and input hashes with the raw result and execution observation.
Return the original verdict and unverified scope to that coordinator; do not advance
its stage or approve a human gate. A standalone or external caller does not need
an SDLC run or new mandatory arguments.
