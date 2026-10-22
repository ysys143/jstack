# Brainstorming — repository-grounded design shaping

jstack adaptation of [Superpowers brainstorming at b36e082](https://github.com/obra/superpowers/blob/b36e0829c6d0140e93cfef2ca599b1b07d4a7797/skills/brainstorming/SKILL.md).
The [MIT notice](brainstorming-LICENSE.txt) is retained. Read this entire core
when design shaping is selected. An exact `superpowers:brainstorming` request
selects that provider and its own approval, document and mandatory-next contract;
this adapted recipe cannot silently replace it.

## Selection and repository facts

Use when brainstorming or design shaping is explicitly selected, by the user's
request or by a workflow the user started, to shape a proposed feature, behavior
change or new system whose design choices remain. Do not interpose on
explanation, read-only review, diagnosis, ordinary planning or execution of an
already accepted specification. General ideation explores possibilities; the
`requirements-interview` skill owns unresolved decision dependencies; this
procedure owns design depth and convergence. Standalone and external calls
require no jstack task registration.

Before detailed questions, inspect the existing flow, callers, tests, relevant
project instructions, recent changes and deployment constraints. Name inspected
paths/revision and missing facts. Familiarity with an app category is not evidence
that this repository contains the flow. Resolve repository questions by reading
rather than asking the user to repeat discoverable facts. If the repository is
unavailable, identify the missing evidence and keep classification provisional.
User corrections outrank inferred context; do not discard them after compaction.

## Choose depth and its result

State the selected depth and the concrete reason, allowing the user to correct it.

| Depth | Repository and intent evidence | Bounded result |
|---|---|---|
| Spike | The requested result is feasibility knowledge, not retained implementation | Probe question, bounded experiment and recommendation with limits; generated code is explicitly throwaway |
| Bounded | A specific existing flow can be read and its interfaces remain stable | Short design in conversation, affected files and verification; no mandatory spec or implementation-plan file |
| Architectural | New project/subsystem, changed component relationships or interfaces others depend on | Subsystem boundaries, substantive alternatives, sectioned design and a design artifact when requested/needed for the handoff |
| No shaping needed | A clear accepted revision already determines the requested execution, or the request belongs to another leaf | Return that fact and the selected next owner without restarting a design interview |

For multiple independent subsystems, first bound one design slice and describe
its interfaces and dependencies; do not refine a huge undivided specification.
Reassess depth when new evidence changes boundaries. Explain an upgrade or
downgrade; convenience alone does not justify removing necessary design work.
A successful spike does not authorize retaining or shipping its code.
Before running a spike, state the question, bounded method and expected effects.
Use read-only repository inspection or task-relevant public information gathering
within the caller's existing authorization. Running a probe does not itself grant
permission to install dependencies, retain generated code, mutate shared state or
perform external writes. Those effects must be covered by the request or another
valid scope-bound authorization; otherwise keep the probe a proposal and ask only
for the missing decision. Preserve cancellation and cleanup ownership. Existing
authorization remains valid; public read-only lookup does not require a new
approval merely because it uses the network.

## Alternatives and convergence

Ask only questions whose answers materially affect the design. Use the
`requirements-interview` skill when decision dependencies require an interview;
do not restart settled questions. For architectural work, compare two or three
substantively different approaches against criteria fixed from the request:
behavior, boundary changes, failure handling, operational cost and
maintainability. Recommend one with trade-offs and counterevidence. Renamed
versions of the same design are not alternatives. Bounded work needs
alternatives only where a real consequential choice remains; avoid manufacturing
a choice to satisfy a count.

Present architecture, component responsibilities, interfaces, data flow, errors
and validation at the depth required. Each unit has an explicit purpose, public
contract and dependencies; preserve existing patterns unless the requested change
needs a justified departure. Exclude unrelated refactoring and speculative
features. Frontend work takes its stack from the project's existing conventions
and constraints. Where none exist, ask which stack the user wants or propose a
minimal default with its reason; no automatic React, Next or shadcn choice
follows from being a new project.

A design is proposal/open-decision until valid acceptance binds the scope and
revision. If rejected, record the actual objection, revise affected decisions
and their dependents, and present the revised design again. Do not call rejection
acceptance or silently implement the unreviewed revision. No response, elapsed
time, a tool-success message or another agent's claim is acceptance.

Reuse an existing valid acceptance for the same scope and revision; an execution
instruction can supply it when the intended design is unambiguous in context.
Record its source rather than asking again. Materially different alternatives
or scope changes require the unresolved decision, not a blanket new permission
flow. Missing restoration evidence leaves agreement unverified. A user's stop
always returns control, even if design or acceptance gates remain incomplete.

## Finish and return

Self-review the proposal for placeholders, contradictory constraints, unclear
requirements, oversized scope and missing failure/validation behavior. Fix or
label unresolved points; a self-review is not an independent assessment. Return
the chosen depth and why, repository evidence, scope/non-goals, alternatives,
current revision, acceptance source or open decisions, artifacts if any, remaining
effects and the next consumer. A standalone or external design-only call ends
with that result. It does not start implementation, write task state, commit,
initialize a project or publish merely because a design exists.

If implementation was also authorized for an accepted revision, hand off that
bounded revision to the chosen executor. A spike ends in a recommendation;
bounded work ends in its short design; architectural work ends in its design
artifact/proposal unless additional planning or execution was selected.

On cancellation or interruption, preserve the latest revision, accepted scope,
actual acceptance source, objections, open decisions, artifact locations and any
probe process or uncertain effect. On resume re-read affected repository context,
check revision identity and restore objections before reusing acceptance. Report
unknown cleanup/effects; do not replay a probe with uncertain external effects.

## Deliberate differences from upstream

Repository-first classification, meaningful alternatives, design feedback and
path-specific results are preserved. jstack does not impose upstream's universal
fresh approval, one-question-per-message, one-way depth ratchet, mandatory task
list, automatic spec commit or exclusive writing-plans transition. Valid prior
user authorization remains effective. jstack selects this core only on an explicit
request; upstream's use before any creative work is not imported, and ordinary
planning only offers it.
jstack replaces the upstream fresh nod before every spike with the explicit
effect-and-scope check above; it does not remove the probe's authority boundary.
The optional visual server is not vendored
or activated by this core; using one requires its own selected resource and
lifecycle contract. These are adapted semantics, never an exact-provider claim.
