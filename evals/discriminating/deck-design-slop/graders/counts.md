---
type: regex
pattern: "내용[\\s\\S]{0,40}?6[\\s\\S]{0,120}?표와 그림[\\s\\S]{0,40}?5[\\s\\S]{0,120}?조판[\\s\\S]{0,40}?6"
flags: ""
match: "contains"
weight: 1
---

# Section item counts: 6, 5, 6, and 4

The regex anchors each count to its section name. It accepts tables, lists, and
prose while rejecting prose that merely contains the same numbers by chance.

## How this pattern was derived

The first version checked only the numeric order `6...5...6...4` and missed all
five runs. Actual outputs insert item-number ranges, as in
`| **내용** | 6항 | 1–6 |`, producing the sequence 6, 1, 6, 5, 7, 11, and so on.

A regex must be tested against real outputs before use. Otherwise a grader that
matches nothing silently awards zero, which is a broken grader rather than a
measurement. This pattern was verified against ten existing outputs: with 5/5
and without 0/5.

The reason for mechanical grading is the same as in `tag_*.md`.
