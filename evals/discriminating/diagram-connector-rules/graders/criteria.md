---
type: llm
weight: 1
---

# Grading criteria — actual rules 0–6

**One passing condition: the seven rules have the following content.**

| Number | Requirement |
|---|---|
| 0 | **Draw arrows before boxes** (premise) |
| 1 | Orthogonal connectors with rounded corners |
| 2 | Label-to-connector clearance of 6~10px |
| 3 | No connector overlap |
| 4 | Fan out attachment points on the same side |
| 5 | Do not pass behind a third box (exceptions apply) |
| 6 | Label masks must not cover nodes drawn later |

Equivalent wording is acceptable. **Rule 0 must mean "Draw arrows before boxes"
and the clearance must be 6~10px**: neither can be guessed.

## Failure (FAIL) — every case below fails

- **The response says it does not know.** This case measures **access to this rule system**;
  inability to reach it is failure, regardless of honesty.
- **The response fabricates an answer.** It supplies a different rule list.
- Rule 0 is missing or has a different meaning.
- The clearance differs.

Report **inability to reach the source** separately from **fabrication**, because
they require different fixes. Both score 0.
