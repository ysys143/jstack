# Review rubric — tone, order, and the default verdict

## Review tone

The ambition is not one axis among others; it is **the posture that governs the
rest**. Strip the slang and the only thing left carrying intensity is the tone
rule — so the tone rule is written down.

| Say | Not |
|---|---|
| "This swallows the failure at `x.ts:42`; the caller cannot tell it happened" | "Error handling could be improved" |
| "Three call sites, one of them wrong — `a.ts:9`" | "Consider refactoring" |
| "I could not determine X" | Silence about X |
| "This is correct and I checked it" | Praise with nothing checked |

Nine standing phrasings:

1. State the defect, then the failure it causes — in that order
2. Name the location as `file:line`, never "somewhere in the module"
3. Give the input that triggers it when you have one
4. Say what you did not check, explicitly
5. Separate "I verified" from "I believe"
6. Do not soften a blocker into a suggestion
7. Do not stack qualifiers onto a finding you are sure of
8. When two findings share a cause, say the cause once
9. If nothing is wrong, say that plainly — do not manufacture findings

## Output priority

Emit in this order and stop when the reader's budget is spent.

1. **Blockers** — this must not merge
2. **Correctness** — it does the wrong thing
3. **Failure handling** — it hides going wrong
4. **Contract** — types and interfaces lie about the value
5. **Structure** — it will be expensive to change
6. **Consistency** — it disagrees with the codebase
7. **Nits** — spelling, formatting

**No nit-flooding.** If items 6–7 outnumber 1–5, cut 6–7. A review whose bulk is
nits reads as "nothing serious was found", whatever it says at the top.

## Presumptive blockers

**The default verdict is block; the burden of proof is on the author.** These six
block unless the author shows why not.

1. A failure path that swallows without a record
2. A public contract changed with no caller audit
3. A new external dependency with no revocation path
4. Concurrent writes with no atomicity argument
5. A test removed or weakened to make a change pass
6. Credentials or personal data on a path that leaves the process

## Exceptions — where "the attacker is the victim" inverts

The self-rebuttal that drops a finding because the only principal who can
trigger it already owns what it reaches is **inseparable from its exception
list**. That list is `references/security-exceptions.md`, it is closed at eight
items, and each item carries a deciding sentence that determines whether it applies.

Applying the self-rebuttal without that file in front of you runs half the
rubric and produces a lower finding count that reads as a cleaner codebase.

Three of the eight were written for this repository and are the ones a reviewer
here hits most:

- **Archive author != extractor** (`E-6`) — an archive arrives from someone else and
  is extracted with our privileges. Extraction-path defects are not
  self-inflicted when the zip was not ours.
- **Agent instruction surface** (`E-7`) — `SKILL.md` and `references/*.md` are loaded as
  instructions by later sessions, so their author is not their executor.
- **Disqualification** (`E-8`) — the victim of a character-count or jamo-normalisation
  defect is the submission's standing at the procuring agency's review, decided
  by a third party after the deadline. The author cannot consent for it.

When no item fires, say so: record that the self-rebuttal was applied and the
finding dropped. A dropped finding with no line is invisible in review.

## `PRE-EXISTING` and `DIFF-ANCHOR` are soft tags

These two tags mark a candidate finding as predating the change, or as anchored
to a hunk in the diff. **They sort and annotate; they do not drop.** Upstream
carries them as soft tags for exactly this reason and this rubric follows.

**In survey mode they are not applied at all.** With no baseline there is no
diff, so every candidate is `PRE-EXISTING` by definition and every candidate is
missing a `DIFF-ANCHOR` — enforcing them there rebuts the entire review at a
rate of 100%. A review of a single document with no baseline is survey mode,
and that is the mode most reviews in this repository run in.

Say which mode you are in before the findings, because the tags mean different
things in each and the reader cannot infer the mode from the output.

## Upstream retreated first, and the retreat is part of the rule

The upstream implementation carries a note at `review_api.py:285` recording why
it stopped dropping candidates outright: **hard-dropping also discards correct
findings.** The mechanism was kept, the enforcement was softened, and the
softening is the durable part.

That note is recorded here because the previous version of this rubric took the
pre-retreat behaviour. Inheriting a rule without its author's own correction is
how a known trap gets rebuilt — the trap was documented at the source, and
**the documentation was the part left behind.**

## Which evidence profile is in force

Precision and recall are different reviews and this rubric serves both. Declare
the profile **before** the findings — `references/evidence-profiles.md` holds
the two, the situation-to-profile mapping, and the one instruction neither
profile relaxes. Choosing a profile after the findings are in means choosing
the one that flatters the result.

Everything in this file applies under both profiles. The profile sets the
reporting threshold; it never edits the axis list, and it never changes whether
an exception in `security-exceptions.md` fires.

## Preferred remedies

Classification without a prescription leaves the reader where they started.

| Finding | Preferred remedy |
|---|---|
| Swallowed failure | Re-raise with context; log at the boundary, not at the source |
| Over-1000-line file | Split along the axis that changes together, not by type |
| Unreachable definition | Delete. Version control is the archive |
| Dependency cycle | Invert one edge with an interface at the stable side |
| Thin wrapper | Inline it; keep it only if it holds a decision |
| Identity abstraction | Delete the layer, keep the call |
| `any` at a boundary | Narrow at the boundary, not at each use |
| Magic constant | Name it where it is decided, not where it is used |
| Comment restating code | Delete the comment, or explain the why the code cannot |
| Mock-asserting test | Assert the observable outcome instead |
| Defensive branch for an impossible state | Delete; if it is possible, the type is wrong |
| Implementation-shaped name | Rename to the caller's intent |
| Single-call-site wrapper | Inline |
| Rebuilt canonical layer | Use the existing one, or state why it did not fit |
| Serial orchestration | Parallelise the independent parts; say what stays ordered |
| Non-atomic update | Make it one transaction, or make the partial state legal |

## `--scope=all` degrades the rubric

Two axes stop meaning anything outside a diff.

- **Axis 1** (1000 lines) — over a whole repository this reports age, not risk
- **"Did this change add it"** — there is no change to attribute to

Say which axes are degraded in the report rather than reporting a lower count
as if it were a cleaner codebase.

## Collection contract

A subagent cannot judge what it was not given. The parent **must** inject:

- the diff
- the full text of each changed file (not just the hunks — axis 1 and axis 5
  need the file, not the change)
- the language, so the reviewer knows which detectors exist
