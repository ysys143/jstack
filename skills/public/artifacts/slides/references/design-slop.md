# Slide flaws that lose review points

## Source of this document

**Original work.** The plan called for importing 49 upstream slopslap taxonomy
items, but that asset was tied to a capture pipeline with a self-invented
`public-observed` license tag and was excluded. We cannot claim to have imported
unavailable material. This replacement list serves the same purpose for Korean
public procurement and evaluation presentations.

**This is not an AI detector.** The same items flag poor human-authored slides.
Read them as potential evaluation deductions, not evidence of AI authorship.

## Cause tags

Each item has one of two causes. Its tag determines the corrective action.

| Tag | Meaning | Correction |
|---|---|---|
| `input` | Missing input: constraints, evidence, or presentation-specific values were not stated | State the constraints and specific values |
| `no-verify` | The result was created but not inspected | Render it and inspect visually |

Two tags let repeated symptoms point to a common cause instead of inviting
isolated fixes. Fewer, distinct buckets make that grouping useful. The practical
division is whether to improve the instructions or inspect the output.

The previous four tags were `median`, `underspec`, `no-constraint`, and `no-verify`.
The first three all meant insufficient input, so C-43 merged them into `input`.
`median` also suggested the wrong remedy: replace generic values with values
specific to this presentation, rather than trying to be less average.

## Two axes — deduction x cost

Record both `감점` (evaluation impact) and `비용` (correction cost). One axis is
insufficient when prioritizing work the day before a presentation: both impact
and effort matter. Address high-impact, low-cost corrections first.

| Axis | 상 (high) | 중 (medium) | 하 (low) |
|---|---|---|---|
| **감점** | Directly affects a scored criterion | Affects the overall impression | Only visually distracting |
| **비용** | Rewrite the manuscript or structure | Rebuild the slide | Change one value or line |

Use `감점` only as the sorting key. Sorting gives an order; both axes determine
the decision. A high-impact item with high correction cost may reasonably remain
untouched the day before the presentation. Korean axis keys and enum values are
retained for the checklist contract.

## Items

### Content

| # | Flaw | Tag | 감점 | 비용 | Why it loses points |
|---|---|---|---|---|---|
| 1 | The agenda after the cover merely lists section titles | `input` | 중 | 하 | Evaluators look for the argument in the agenda; title repetition adds no information |
| 2 | A slide makes three or more claims | `input` | 상 | 중 | With little time per slide, none of the three claims is retained |
| 3 | Numbers appear without evidence | `input` | 상 | 중 | Questions about an unsourced number undermine trust in the entire slide |
| 4 | A requirements response table omits requirement IDs | `input` | 상 | 하 | Procurement scoring follows IDs; unmatchable responses can receive zero |
| 5 | The final slide only says “감사합니다” | `input` | 중 | 하 | It stays visible throughout questions; put the key claim there |
| 6 | Titles are noun phrases such as “시스템 구성” or “기대 효과” | `input` | 중 | 하 | A claim-bearing title communicates the argument without reading the whole slide |

### Tables and figures

| # | Flaw | Tag | 감점 | 비용 | Why it loses points |
|---|---|---|---|---|---|
| 7 | A table has no units | `input` | 중 | 하 | Numbers without units cannot be compared |
| 8 | A figure lacks a caption or only says “그림 1” | `input` | 중 | 하 | Captions state what the figure claims |
| 9 | Diagram arrows are diagonal | `no-verify` | 하 | 중 | Diagonals obscure reading order; see the diagram skill's six connector rules |
| 10 | A screenshot is pasted without cropping or enlargement | `no-verify` | 중 | 중 | Original resolution is unreadable when projected; crop and enlarge the relevant area |
| 11 | A table extends beyond the slide and is clipped | `no-verify` | 상 | 중 | This indicates that rendered output was not inspected |

### Typesetting

| # | Flaw | Tag | 감점 | 비용 | Why it loses points |
|---|---|---|---|---|---|
| 12 | Body text is smaller than 14pt | `input` | 상 | 하 | It becomes unreadable in projection or print, especially in Korean |
| 13 | A slide uses three or more fonts | `input` | 하 | 하 | Extra fonts add noise, not information |
| 14 | Bold, color, underline, and size duplicate the same emphasis | `input` | 하 | 하 | Stacked emphasis becomes decoration |
| 15 | Margins vary between slides | `no-verify` | 하 | 중 | Viewers must find the alignment baseline again on each slide |
| 16 | Korean line breaks split word units | `no-verify` | 중 | 하 | Missing `word-break: keep-all`; see styles.md |
| 17 | Gradients and shadows are applied to every element by default | `input` | 중 | 중 | They reduce contrast and blur in print |

### Reversals in procurement

Some common web-slide advice reverses in procurement and evaluation documents.

| # | Web convention | Procurement practice | 감점 | 비용 | Reason |
|---|---|---|---|---|---|
| 18 | Minimize slide text and explain orally | Slides remain as documents and must stand alone | 상 | 상 | Evaluators review the written material after the presentation |
| 19 | Reveal content sequentially with animation | Do not use animation | 중 | 하 | Printed layers overlap |
| 20 | Use a dark background | Use a light background | 상 | 중 | Dense toner and poor readability hurt printed output |
| 21 | Replace text with icons | Retain text | 중 | 하 | Icons cannot be matched directly to scoring criteria |

## How to use it

Do not force a finding for every item. Read from the top and record only applicable
flaws, including the cause tag and both axes. Repeated tags call for fixing the
cause: four `input` findings suggest that the deck followed a generic template
rather than specific instructions. Isolated repairs will recur on later slides.

Sort by descending evaluation impact, then ascending correction cost. High impact
and low cost comes first; low impact and high cost can be recorded and deferred
when the presentation is the next day.

No findings is a valid result. State that nothing applies. Inventing a finding
will encourage the next reviewer to ignore the checklist.
