---
type: regex
pattern: "^(?![\\s\\S]*```[^`]*지평[^`]*```)"
flags: "s"
match: "contains"
weight: 1
---

# Rewrite the `새로운 지평을 열다` cliché (D-2)

This cliché exaggerates significance. Replacing only the headword leaves its structure intact, so the whole phrase must be rewritten.

## Why this is scored mechanically

This requirement used to be one of six bundled under a single LLM judge in
`criteria.md`. A failure therefore did not identify which requirement failed;
the artifact exposed only three Boolean `judgeVotes`. While investigating
negative delta across more than 50 runs and five revisions, this prevented the
remaining hypothesis from being isolated. A probabilistic grader is unnecessary
for a condition with a deterministic answer.

## Why only the fenced output is inspected

Running the check against the entire response creates false failures when the
report quotes the original. Measured across 20 collected outputs, a whole-text
absence check passed only 9, while restricting it to the fenced block passed 16;
all seven differences were false positives.

Putting `[^`]*` only after the opening fence allows it to consume past the
closing fence into the explanation. The pattern therefore confines the token
between both fences: `` ```[^`]*X[^`]*``` ``.

## Why `\A` is not used

The first version used `\A(?!.*...)`, but the harness uses JavaScript regexes.
JavaScript has no `\A` anchor and interprets it as the literal letter `A`.
The check therefore meant "the response contains A and no bad expression after
it," rather than "the response contains no bad expression."

Measurement confirmed this exactly: only the three of ten outputs whose
explanations contained `A` passed; the seven outputs containing only the edited
artifact failed despite having no bad expression. The hypothesis explained all
10/10 runs. Direct Node probes confirmed that the old expression rejected valid
outputs while the replacement passed valid output and caught mutations.

Using `[\s\S]` instead of `.` follows the same rule: do not depend on engine
flags.
