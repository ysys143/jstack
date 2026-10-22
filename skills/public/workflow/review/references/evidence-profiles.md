# Evidence profiles — precision and recall are different reviews

## The conflict this file resolves

Two disciplines were inherited into one skill and they optimise opposite
things. Left unnamed, they do not average out; they fire alternately on the
same finding, and which one wins depends on who is reading.

| | Precision profile | Recall profile |
|---|---|---|
| Inherited from | security guidance, pm-skills | contract-work, thermo |
| What a mistake costs | a false positive turns the gate off | a real defect ships |
| Standing instruction | do not report what you cannot demonstrate | do not manufacture a gap that is not there |
| Default verdict | report the demonstrated ones | block, and make the author argue |
| Where it belongs | merge gates, PR review | sweeps, surveys, handovers |

The failure is not that either is wrong. It is that **the same finding is
promoted by one and dropped by the other**, so a review that has not declared
its profile produces a verdict that cannot be reproduced.

## Precision profile

In force when the review's output is a **gate** — something blocks or does not
block, automatically, on every change.

- A finding is emitted only with the input that triggers it, or with the
  `file:line` and the mechanism spelled out.
- "This could be a problem" is not a finding here. It is a question, and
  questions go in the "what I did not check" section.
- Nit-flooding is a gate failure, not a style problem: a gate that emits noise
  gets disabled, and a disabled gate has recall zero. The precision profile
  protects recall over the long run by protecting the gate's standing.
- Presumptive blockers still apply, but the author's rebuttal is cheap to give
  and must be accepted when given.

## Recall profile

In force when the review's output is a **document a person reads once** — a
survey, a handover, an inventory of an unfamiliar repository.

- Suspicion is reportable, labelled as suspicion. The reader's budget is spent
  on reading, not on a build turning red.
- Missing a defect is the expensive error, because nothing runs again.
- The one thing this profile does not license:
  **Never fabricate intent to manufacture a gap.**
  A finding invented to fill a section is not recall; it is noise the reader
  cannot distinguish from signal, and it costs the whole document its standing.
- Coverage claims become mandatory here. An area not swept reads as a swept
  clean area unless the report says otherwise.

## Which profile is in force

**Declared before the review, not chosen after the findings are in.** Choosing
afterwards means choosing the profile that flatters the result.

Declare the deployment stage (pilot, prototype, internal demo, or production)
alongside the profile before findings; do not revise it after seeing findings.
If the change looks like a pilot or prototype, ask one focused question about
intent and expected exposure. If the user is unsure, briefly explain what each
choice defers. If asking is impossible or unanswered, assume production and
state that assumption before the verdict.

| Situation | Profile |
|---|---|
| PR gate, CI, pre-merge | Precision |
| `--scope=all` over a repository | Recall |
| Unfamiliar code, no baseline | Recall |
| A change with a diff and an author to answer | Precision |
| Handover, inventory, migration audit | Recall |

When the situation is genuinely both — a gate that also has to produce a
survey — run it twice and label the two outputs. One pass cannot hold both
loss functions, and a pass that tries produces the worst of each: it blocks on
suspicion and stays quiet about what it did not check.

## The carrier already exists — and half of it does not

The profile split is a working separation of two rule sets over one artifact,
and one half of it is a real file in this plugin:
`contracts/portable-contract.yaml` (plugin root, not this skill's tree) declares
which checks are portable, and it names the other half only in prose — `/doctor`
runs the portable profile, `/validate` runs the authoring profile.

**There is no `authoring-contract.yaml`.** The authoring profile exists as a
name inside the portable file and nowhere else. Half the pair is a file and half
is a concept, so "the same file pair already carries the discipline" was never
true as written. A reviewer sent to that filename finds nothing, and a mechanism
a document promised but cannot be reached is a mechanism nobody uses.

What carries over is the **axis**, not the file pair: one artifact, two rule
sets, declared before the run rather than picked after it. The portable file
proves the axis is workable in this tree; the missing half is why the
reviewer's side of it has to live in this document rather than in a YAML file.

## What both profiles share

- The taxonomy. Profiles change the reporting threshold, never the axis list.
- `file:line` on every finding.
- The separation of "I verified" from "I believe". The recall profile leans on
  this line so heavily that a review which blurs it is not in either profile.
- The exception list in `security-exceptions.md`. A rebuttal that fires under
  one profile fires under the other; profiles do not touch what is true.

## Limits

- The two profiles are ends of one axis, not a partition. A review can sit
  between them — but then it says where it sits.
- The mapping table is a default, not a rule. Overriding it is fine and is
  stated in the report.
- Neither profile makes a judgement call into a measurement. Whether a design
  is right stays a judgement under both.
