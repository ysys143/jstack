# Medium-specific CJK contract (21 requirements)

**Korean labels fail for different reasons when crossing media.** SVG lacks a line
wrapping engine; slide themes delegate fonts to the browser; print substitutes
fonts on machines without Hamchorom; sheets encounter NFC/NFD filename differences.
Different causes require **different contracts for each medium**.

## Why we own this contract

We examined all eight upstream groups and **none covered CJK adequately**. The gaps
arise from the medium, not stylistic preferences.

| Upstream | CJK gap | Cause |
|---|---|---|
| `up:diagram-design` | One non-Latin 12px floor contradicts the same document's 8–9px print ramp | Does not distinguish media |
| `up:archify` | Width formula targets Latin text in Geist | Browser renderer |
| `up:drawio-skill` | Search for `noto`, `cjk`, and `한글` returned **zero matches** | Delegates label rendering to Electron/Chromium fonts |
| `up:marp` | Default theme has no CJK stack | Delegates to browser defaults |
| `up:corazzon` (30 styles) | Korean fonts specified in **0/30** styles | Latin typography presets |
| `up:jkf87-hwpx` | Omits font substitution and implications of `isEmbedded="0"` | Hancom-specific font ecosystem |

CJK meets all three ownership conditions: organization-specific knowledge, no
upstream coverage, and changes required before use.

## The 21 requirements

**The evaluator column makes the table useful.** A rule without an evaluator is
only recitation. Rows marked `Human` cannot be machine-checked; disclose that limit
instead of implying enforcement.

| # | Medium | Requirement | Evaluator | Status |
|---:|---|---|---|---|
| 1 | Diagram (SVG/drawio) | **Apply `encodeURIComponent`** when carrying CJK labels in URLs; otherwise the viewer fails with "URI malformed" | `scripts/encode_drawio_url.js` | Confirmed |
| 2 | Diagram | Extend the Korean font stack **per `<text>` element** to `'Geist', 'Apple SD Gothic Neo', 'Noto Sans KR', 'Malgun Gothic', sans-serif`. Do not replace the entire skin | `tests/run_tests.js` (SKILL.md and output-spec.md needles) | Locally developed |
| 3 | Diagram | **Style-preset extraction is invalid for non-English labels**: upstream acknowledges that role inference mostly collapses to `service`. Do not use preset extraction for Korean diagrams | Human (`taste-gate.md`, type fit) | Confirmed by upstream disclosure |
| 4 | Slides (marp) | **Pin a CJK font stack in the theme.** Do not delegate to the default theme: identical Markdown otherwise renders with different Korean fonts on different machines | `deck` skill suite | Locally developed |
| 5 | Sheets (gws) | Pass Korean tab names through **`json.dumps`**, avoiding shell escaping | `workspace` skill suite | Confirmed |
| 6 | Sheets and Drive | **Normalize Korean filenames to NFC or NFD** before comparison: macOS returns NFD and Drive returns NFC | `workspace` skill suite | Locally developed |
| 7 | SVG | Text budget: **KO ≈ 60% of Latin**, with 2–3 lines per box. SVG has no automatic line wrapping | `scripts/verify-text-width.js` | Confirmed |
| 8 | SVG | Set `dominant-baseline="central"` explicitly. Default `alphabetic` positions Korean text toward the top of the box | Human (`taste-gate.md`, Korean text) | Confirmed |
| 9 | SVG | **Do not compress with `textLength` or shrink individual labels.** Repair geometry when text overflows | `scripts/verify-text-width.js` (`text/out-of-scope`) | Confirmed |
| 10 | SVG | Measure width **only with package-owned font aliases**. System-font measurements differ between laptops and CI | `references/font-delivery.md` grade protocol | Confirmed |
| 11 | SVG | Font embedding requires **subsetting, fail-closed behavior for missing glyphs, and an OFL alias** | `scripts/subset_fonts.py` | Confirmed |
| 12 | Print (HWPX) | Document font substitution on macOS without Hamchorom and the meaning of `isEmbedded="0"` | `hwpx` skill suite | Locally developed |
| 13 | Print (HWPX) | For table page overflow, check hardcoded `repeatHeader` and the semantic difference between `TABLE` and `CELL` in `pageBreak` | `hwpx` skill suite | Locally developed |
| 14 | Print (HWPX) | **Paragraph-property inheritance precedence**: `styleIDRef` carries its own `paraPrIDRef`, causing conflicts when both are specified | `hwpx` skill suite | Locally developed |
| 15 | All media | **Do not compress character width or spacing.** Using 90% character width or -5% tracking to fit content destroys print legibility for evaluators. Reduce content instead | Human (`taste-gate.md`, Korean text) and `hwpx` skill | Confirmed |
| 16 | All media | **Justification conflicts with `keep-all`.** Word-level wrapping plus full justification produces excessive spaces. This directly conflicts with the justification convention in proposals | Human (`humanize`, typesetting review) | Locally developed |
| 17 | All media | **Line-break prohibitions**: closing brackets, punctuation, and numeric units must not start a line | Human (`humanize`, typesetting review) | Locally developed |
| 18 | All media | Anticipate **baseline mismatch in mixed Korean, Latin, and numeric text**. Mixed-label problems concern baseline, not size | Human (`taste-gate.md`, Korean text) | Locally developed |
| 19 | Diagram | **Mixed-script width weights**: full-width 1.0em, spaces 0.25em, Latin/digits 0.55em. Applying one em per character to an entire mixed string makes masks 20–25% too wide, which can violate rule 6 | `scripts/measure_label.js` | Confirmed |
| 20 | Diagram and print | Measure labels in **effective pt at final placement width**, not pixels. In `print-a4-landscape`, 12px yields 9.0pt; at 60–70% width in HWP it becomes 6pt | `scripts/check_effective_size.js` | Confirmed |
| 21 | Print | Grayscale CJK legibility: 2–5% gray prints as blank; 0.8px at 20% hairlines fall below the 0.25mm minimum line width. **Every meaning requires a redundant noncolor cue** | Human (`taste-gate.md`, signal) | Locally developed |

## Vertical writing is outside this contract

Do not use `writing-mode: vertical-rl` in diagrams. The width model assumes
axis-aligned rectangles, so neither `verify-text-width.js` nor `measure_label.js`
can measure vertical labels. Silently passing unmeasured labels would misrepresent
coverage. `scripts/verify-connectors.js --strict-rules` emits `taste/writing-mode`.

## Limitations

- **Seven of the 21 requirements are machine-checked** (1, 2, 7, 9, 11, 19, 20).
  The other 14 name a human or another skill's suite. This document declares the
  contracts; it does not enforce them all.
- Rows delegated to other skills (`deck`, `hwpx`, `workspace`) are not checked here
  to confirm **those suites actually measure the requirement**. There is no
  cross-skill comparator.
- Having an evaluator does not establish that its verdict is correct. Coefficients
  in requirements 19 and 20 inherit provisional values from `references/output-spec.md`.
