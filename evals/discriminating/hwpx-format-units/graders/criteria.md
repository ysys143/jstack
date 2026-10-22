---
type: llm
weight: 1
---

# Grading criteria — actual internal constants

## Passing conditions (both required)

**1. Three unit conversions**

| Unit | Conversion |
|---|---|
| HWPUNIT | 1 HWPUNIT = **1/7200 inch** |
| pt | 1pt = **100 HWPUNIT** |
| mm | 1mm ≈ **283.46 HWPUNIT** |

The mm value must match to two decimal places (283.46). The approximation symbol is optional.

**2. A4 page dimensions**

width = **59528** · height = **84186**

Height distinguishes this case. Converting 297mm gives 84189; some sources
list 84188. **This skill's templates use 84186**, based on the actual files
(`templates/base/Contents/section0.xml` and `templates/report/section0.xml`),
not a calculation. This is not a claim about a universal HWP constant: only
these two files were verified, and the prompt asks for the value this format
uses. That distinction therefore does not undermine the grading criterion.
A calculated answer cannot derive this value; that is the distinction this case tests.

## Failure (FAIL) — every case below fails

- **The response says it does not know.** Failure to reach the source is failure.
- **The response fabricates an answer.** It confidently supplies other values.
- Any of the three conversions differs.
- Either A4 value differs.

A calculated answer still passes if its values match: the case grades the
values, not the route. However, A4 height does not follow from the calculation
(84189 ≠ 84186). Reporting 84189 or 84188 indicates **failure to reach the actual
files** and fails.

Distinguish inability to answer from fabrication in the report; both score 0.
