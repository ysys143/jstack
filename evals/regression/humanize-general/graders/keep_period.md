---
type: regex
pattern: "```[^`]*2024년\\s+1월부터\\s+12월까지[^`]*```"
flags: "s"
match: "contains"
weight: 1
---

# Preserve the period

This is one of the 'score zero if any item changes' requirements in `criteria.md`. The period is a fact, not a style choice.

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

## Why literal spaces are not used

The first pattern used `2024년 1월부터 12월까지`. When the model inserted a line
break, it became `2024년 1월부터\n12월까지` and failed even though the period was
preserved; this caused the measured with 2/5 and without 1/5 result. Line-break
placement is not content, so `\s+` separates the tokens. The same allowance is
needed in absence checks to catch a wrapped expression that remains in the
output.
