---
type: regex
pattern: "```[^`]*```"
flags: "s"
match: "contains"
weight: 1
---

# A fenced artifact block exists

This prevents absence checks from passing vacuously. Without a fenced block, all four checks for a missing expression become true over an empty population. The repository already saw this failure in `check_body_paths`: no population must be a failure, not a pass.

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
