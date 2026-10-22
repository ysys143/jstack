---
type: regex
pattern: "\\bno-constraint\\b"
flags: ""
match: "contains"
weight: 1
---

# Cause tag `no-constraint`

The four tags are unique fixed values that cannot be guessed. **They are scored
mechanically.**

LLM judges disagreed on materially identical outputs: both sides contained the
section counts 6, 5, 6, and 4 and all four tags, yet one received a 3–0 FAIL.
The same failure pattern in `taxonomy` was moved to deterministic grading but
had not been corrected here. A probabilistic grader is inappropriate when the
answer is a fixed value.

Whether the answer was fabricated requires judgment, so the LLM judge in
`criteria.md` continues to evaluate it.
