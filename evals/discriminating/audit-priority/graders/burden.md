---
type: regex
pattern: "(기본 판정은 차단|default verdict is block|기본값은 차단|차단이 기본)"
flags: ""
match: "contains"
weight: 1
---

# The default verdict is block

## Why the first pattern matched an "I don't know" baseline

The first pattern was `입증 책임|burden of proof`. The baseline could not give
the answer and said **"추정 차단의 개수·내용·기본 판정·입증 책임도 모릅니다"**.
Because that sentence contained `입증 책임`, it passed 5/5 in measurement.

The grader could not distinguish giving the answer from saying that the answer
was unknown. Ignoring negation is a classic failure mode of regex grading.

## Current pattern

The answer must state the rule `기본 판정은 차단` itself. That phrase is
unlikely to appear in an admission of ignorance, and a block-by-default rule
runs against ordinary review practice, so it is unlikely without the reference.

A discriminating token must be something the without arm **actually missed**,
rather than something it seems likely to miss. This repeats the lesson from
filtering out calculable HWPX values such as `59528` and `283.46`.
