---
type: regex
pattern: "\\bL-4\\b"
flags: ""
match: "contains"
weight: 1
---

# The L series runs through L-4

The final item `L-4` appears only when the series is complete.

Do not enforce the upper bound with `not_contains`. An earlier paired check for
absence of `L-5` let an **empty output pass**; an authentication
failure that produced no answer still scored 0.45 in measurement. Absence checks
are vacuously satisfied when there is no population. The LLM judge in
`criteria.md` handles the upper bound and fabrication because those require
judgment; this mechanical grader measures **recall** only.

LLM judges disagreed on the same answer (3–0 PASS, 3–0 FAIL, and 2–1 FAIL), even
though all three outputs had identical IDs and counts. A probabilistic grader is
unnecessary when the expected ID set and count are fixed.
