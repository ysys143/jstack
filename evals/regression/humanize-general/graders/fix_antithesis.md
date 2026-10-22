---
type: regex
pattern: "^(?![\\s\\S]*```[^`]*(?:단순히|것이\\s+아니라)[^`]*```)"
flags: "s"
match: "contains"
weight: 1
---

# Rewrite the `단순히 A가 아니라 B` antithesis (C-8)

The taxonomy identifies this as the strongest measured AI signal, occurring 9.2 times as often in AI text as in human text. If it remains, the text still reads as AI-written even after every other issue is fixed.

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

## Why literal spaces are not used

The first pattern used `2024년 1월부터 12월까지`. When the model inserted a line
break, it became `2024년 1월부터\n12월까지` and failed even though the period was
preserved; this caused the measured with 2/5 and without 1/5 result. Line-break
placement is not content, so `\s+` separates the tokens. The same allowance is
needed in absence checks to catch a wrapped expression that remains in the
output.
