# Official-document and Korean bullet-style conventions absorbed from kordoc

Source: [chrisryugj/kordoc](https://github.com/chrisryugj/kordoc) (MIT).
Three sources were absorbed: `gaejosik-munche.md` (endings),
`gongmunseo-reference.md` (hierarchy and indentation), and `munche-lint.ts`
(12 automated rules).

## Ownership: this reference is not the final consumer

This document lives under `hwpx/references/` because **HWPX determines the final
procurement artifact format**, not because prose correction happens here.

**The `humanize` skill consumes these bullet-style rules.** Its
`humanize/references/procurement-taxonomy.md` mode section explicitly references
§2's layer-specific thresholds. Without that connection, bullet-style conventions
and AI-prose-removal rules would remain in separate skills without reconciliation,
first conflicting on the user's document at runtime.

The `hwpx` skill uses only §3's **hierarchy markers and indentation**, which determine
paragraph-property and numbering mappings for `hp:p`.

---

## 1. Two separate responsibilities defined upstream

| Source | Covers | Does not cover |
|---|---|---|
| `gaejosik-munche.md` (88 lines) | **How clauses end**: endings only | Hierarchical numbering, indentation, item parallelism |
| `gongmunseo-reference.md` | Hierarchy markers, indentation, notation (SSOT) | Endings |

The lack of hierarchy rules in the 88-line source is **division of responsibility,
not a defect**. Preserve that separation during absorption so canonical ownership remains clear.

---

## 2. Bullet-style rules: endings and length by layer

### Endings

Korean bullet-style body text conventionally uses **noun endings without verbal
suffixes**. Declarative `~다` endings occurred in **zero of 264 items** across
15 local-government documents totaling 2,288 lines.

**This is observed practice, not a regulation.** Upstream explicitly acknowledges
that distinction. The manual contains no clause requiring noun endings.

### Median character count by layer

| Layer | Median | Sample |
|---|---|---|
| Title, item, detail | Canonical layer thresholds live in `humanize/references/gaejosik.md`; do not duplicate them here (no-copy contract, test_gaejosik_attribution) | 264·307 lines |

**Items are shorter than details**, contrary to the assumption that higher layers
need longer summaries. Items act as headings; details resemble sentences. Although
15 documents form a small sample, consistent increases across layers are unlikely
to be incidental.

### Scope limits

**Do not apply the `~다` rule to drafting or dispatch documents (기안문·시행문).**
They conventionally use polite `~합니다` endings, causing false positives under an
unqualified `DA_ENDING` rule. Upstream explicitly records this exception.

### Twelve automated rules

`munche-lint.ts` checks endings. Only rule names are carried here, including
`DA_ENDING`, `DEONTIC`, and `RHETORIC_CONTRAST`.

**Downgrade `LEAD_ENDING` to a recommendation.** Upstream enforces the single pattern
`[수단]하고, [수단]하여 [목적]하고자 함.`. The manual does not mandate it; it reflects
one local government's drafting practice.

---

## 3. Official-document hierarchy and notation used by hwpx

### Eight levels of item markers

This is the statutory order. These are **hierarchy markers**, not interchangeable
list decorations; do not skip or mix levels.

```
1.  →  가.  →  1)  →  가)  →  (1)  →  (가)  →  ①  →  ㉮
```

Repeated `1) 2) 3)` blocks indicate **level-three hierarchy**, not a prose defect.
Flagging them as excessive enumeration is a false positive and demonstrates why
ownership reconciliation is necessary.

### Indentation

**Accumulate two character positions per level.** In HWPX, express indentation
through paragraph properties at `hh:margin/hc:left`, not literal spaces that lose
alignment when lines wrap.

### Notation

- Dates use **three periods**: `2026. 9. 1.`, including the final period.
- **Remove leading zeros**: use `9. 1.`, not `09. 01.`.
- **Do not put a colon after `붙임`**: use `붙임  1. …`, with two spaces.

### Three authority levels

Preserve upstream's explicit evidence ranking for each rule.

| Rank | Authority |
|---|---|
| 1 | Presidential decree, 「행정업무의 운영 및 혁신에 관한 규정」 |
| 2 | 2020 행정업무운영 편람 |
| 3 | National Institute of Korean Language (국립국어원) |

**Two corrections to upstream:**

1. **Legal hierarchy.** 「행정업무의 운영 및 혁신에 관한 규정 **시행규칙**」 is a
   **Ministry of the Interior and Safety ordinance** (National Law Information Center,
   lsId 007319). Upstream calls it the enforcement rules of Presidential Decree
   No. 33575, but the parent regulation is the presidential decree. This matters
   when citing legal authority for the eight-level marker sequence.
2. **Amendment tracking.** Upstream fixes the effective period as
   "2023.6.27~현행", but the parent regulation has a **2024-05-21 amendment**.
   Compare against the latest legislation when citing legal authority.

---

## 4. Equations and OCR are outside scope

**Neither equations nor OCR belongs to this reference.**

Upstream kordoc includes equation scripts and scanned-document OCR paths, but
**neither was absorbed**, for these reasons:

- **Equations** rarely appear in procurement proposals. HWPX `hp:equation` uses
  Hancom-specific script syntax with no automatic Markdown conversion path here.
  Manual insertion in Hancom is faster.
- **OCR** operates on scanned images, while this skill accepts **Markdown manuscripts
  and reference-format files**. Scanned input belongs to an earlier workflow stage.

**This is an explicit exclusion, not pending work.** The rationale prevents later
contributors from treating these omissions as gaps to fill.

---

## 5. Five conflicts on identical text

Bullet-style conventions and AI-prose-removal rules can give **opposite verdicts on
the same string** in five cases. Removing one knowledge source does not resolve them.

| Target | Bullet-style verdict | AI-prose verdict |
|---|---|---|
| Declarative `~다` ending | Error | Assumes `~다` by default; only four consecutive endings are a problem |
| Predominantly noun endings | Required at every layer | Mechanical prose; restore predicates |
| `1) 2) 3)` enumeration blocks | Statutory hierarchy markers | Two or more blocks violate the rule |
| Body bold | Caption bold is conventional | Three or more occurrences violate the rule |
| `A가 아니라 B` | Error | One occurrence allowed |

**Resolve these at paragraph-level mode, not document genre**: 개조식-무어미,
서술-합쇼체, and 캡션-무어미. Identical text can correctly receive different verdicts
under different modes. One proposal contains bullet summaries, narrative methodology,
and noun-ending captions; a three-way document router cannot express those transitions.

---

## Topics covered elsewhere

- **HWPX element structure**: `references/xml-structure.md`.
- **Markdown-to-proposal conversion rules**: `references/markdown-proposal-rules.md`.
- **Prose-correction execution**: the `humanize` skill consumes these rules.
