# Rendering review boundary: automated checks and human-only checks

Hangul rendering depends on its GUI and cannot be reproduced in CI. This skill has
no rendering test and **does not plan to add one**. This document instead defines
what machines can check **before** opening Hancom and what requires a person to open it.

This document complements `references/hitl-review.md` with separate responsibilities.

| Document | Question answered |
|---|---|
| `references/hitl-review.md` | **How to hand off and label review status**: iteration loop and status labels |
| This document | **What must be completed before handoff, and when to hand off**: scope and schedule |

The status-label set is defined only in the other reference.

---

## 1. What automated validation establishes

Passing `validate_hwpx.py --semantic` establishes **only** the following:

| Dimension | Established condition |
|---|---|
| Package | `mimetype` is the first uncompressed entry; required entries exist |
| XML | XML parses |
| Reference integrity | All `styleIDRef`, `paraPrIDRef`, `charPrIDRef`, and `borderFillIDRef` targets exist |
| Structure | First paragraph contains `hp:secPr` and `hp:colPr`; secPr children are complete |
| Identifiers | Paragraph IDs are unique |
| Tables | Summed cell widths do not exceed body width |
| Residue | No Markdown pipes, code fences, or unconverted numbering remain in body text |

**This supports a claim of structural validity, not correct visual appearance.**

---

## 2. What automated validation does not establish

| Unverified condition | Why | Reference |
|---|---|---|
| Line-break positions | Requires font metrics | `hangul-practice.md` §6 |
| Page breaks | Same reason | — |
| Font substitution | Happens on the opening machine without an XML trace | `hangul-practice.md` §6 |
| Table page overflow and repeated headers | Depends on rendering | `hangul-practice.md` §1 |
| Objects covering body text | Final placement is determined by the renderer | `hangul-practice.md` §2 |
| Hancom repair dialogs | Only Hancom exposes them | `xml-structure.md` §2 and `troubleshooting.md` |
| Page count | Combines all the above | — |

**Proposals with page-count limits need particular care.** A maximum-page requirement
cannot be checked automatically here; counts obtained without Hancom are unreliable.

---

## 3. Before handoff: six automated checks

**Complete all six before giving the file to a person.** Skipping any can waste a
review cycle on defects that machines could already have caught.

1. `validate_hwpx.py <out> --semantic`: zero errors.
2. `scripts/text_extract.py <out>`: actual body content exists; the document is not empty.
3. `scripts/sanitize_template.py <out> --check`: no client previews, personal metadata,
   or tracked changes remain in the output.
4. `scripts/fix_borders.py <out> --check`: characters are not individually boxed.
5. Compare reference and output `hp:pagePr`: page size and margins were inherited.
6. If tables exist, check paired `repeatHeader` and `pageBreak` rules described in §1.

`--check` reports findings without modifying the file. Use `--fix` for repair.

---

## 4. Handoff timing is the practical safeguard

**When the only final safeguard is a person, the timing of review matters as much as validation.**

| Timing | What to show | Reason |
|---|---|---|
| Immediately after first conversion | A 1–2-page sample | Catch wrong style mappings before producing 200 pages that all need rework |
| When the body is complete | Entire document | Line breaks and table overflow require full content |
| At least two days before submission | Entire final document | Hancom dialogs and font substitution take time to fix; discovering them one day before submission can be too late |

**A review one day before submission often functions only as notice of defects.**
Place HITL in the penultimate schedule slot, not the last.

**Showing a sample first is the highest-value rule here.** Style mapping accounts
for the rendering issues automation misses, and a single page can expose a wrong mapping.

---

## 5. Route reported discrepancies

| Reported symptom | First reference |
|---|---|
| "한컴이 파일이 손상됐다고 한다" | `xml-structure.md` §2: secPr attribute misuse |
| "열리는데 빈 쪽이다" | `troubleshooting.md`: raw-content diagnosis |
| "모든 글자에 네모가 있다" | `scripts/fix_borders.py` |
| "표 둘째 쪽에 열 제목이 없다" | `hangul-practice.md` §1 |
| "도해가 딴 데 가 있다" | `hangul-practice.md` §2 |
| "스타일이 안 먹는다" | `hangul-practice.md` §3 |
| "다른 기계에서 쪽 수가 다르다" | `hangul-practice.md` §6: **not a defect** |
| "표지에 발주처 이름이 미리보기로 보인다" | `scripts/sanitize_template.py` |

The page-count discrepancy represents an **environment difference**, not a defect.
Treating it as a defect wastes time attempting an impossible repair. Classify before editing.

---

## 6. Updating this reference

The tables in §1 and §2 must **match the actual checks in `validate_hwpx.py`**.
If validation changes without corresponding documentation, reviewers may assume a
condition was checked when nobody inspected it. Update the validator and this
reference in the same commit.
