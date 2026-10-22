---
type: regex
pattern: "제3의 상자 뒤로"
flags: ""
match: "contains"
weight: 1
---

# Rule 2 — `제3의 상자 뒤로`

**This is scored mechanically.**

Do not use a probabilistic grader when the expected answer is a fixed value.
Across three cases, LLM judges disagreed on materially identical outputs
(deck, taxonomy, and diagram, with a different case hitting the threshold each
time).

For `diagram`, all five runs got the core 3/3 correct, yet their scores were
0, 1, 1, 0, and 1; the failed run actually mentioned more rules.

Only tokens the without arm could not produce were selected. Against the ten
existing outputs, this pattern scored with 5/5 and without 0/5. Values that can
be derived by calculation (`59528`, `283.46`, and `7200`) were excluded because
the baseline also produced them 5/5; adding a non-discriminating value dilutes
the signal.

Whether the answer was fabricated still requires judgment, so the LLM judge in
`criteria.md` continues to evaluate it.
