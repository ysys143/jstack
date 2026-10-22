# Slide styles — three options and three substantive axes

See `../NOTICE` for provenance and licensing. Three of the 30 styles in
corazzon/pptx-design-styles (MIT) were selected and re-described. The Korean font
contract is original work.

## Why three instead of thirty

The original style dimensions are neither orthogonal nor mutually exclusive.
Listing all 30 repeatedly presents substantially similar choices under different
names.

- 07 Swiss International and 13 Monochrome Minimal share the same visual grammar.
  Apart from palette, the substantive difference is a left red stripe of 4~8pt.
- 08, 14, 17, 20, and 29 are color variations on dark background, neon, and Bebas.
- The original recommendation matrix assigns the 30 styles repeatedly across
  12 rows, illustrating this overlap.

The remaining 27 were excluded for procurement context rather than taste. Most
introduce potential deductions through excessive decoration, low-contrast body
text, or poorly readable fonts, or disappear in monochrome printing. Procurement
proposals are often evaluated from black-and-white printouts.

## Three substantive axes

Choose by these independent dimensions rather than style names.

| Axis | Values | Procurement implication |
|---|---|---|
| **Background brightness** | Light (#FFFFFF~#FAFAFA) / dark (#0D2240~#0A0A0A) | Dark backgrounds consume toner and obscure body text in monochrome print; choose light for printed evaluation |
| **Title typeface** | Bold sans serif / thin sans serif with tracking / monospace | Thin strokes and wide tracking blur under projection |
| **Decoration density** | None / 1~2 rules / grid plus annotations | Higher density increases the chance of Korean typesetting misalignment |

## Three styles

### A. Swiss (light · bold sans serif · rules)

The default for institutions, public-sector work, and consulting presentations.
**First choice for procurement slides.**

| Role | HEX |
|---|---|
| Background | `#FFFFFF` (or `#FAFAFA`) |
| Body | `#111111` |
| Accent bar | `#E8000D` |
| Secondary text | `#444444` |
| Divider | `#DDDDDD` |

- Align every element to a five- or twelve-column grid.
- Use a left vertical red rule (4~8pt) and one horizontal title/body divider.
- Latin titles: 32~44pt; body: 12~14pt.

### B. Monochrome (light or dark · thin sans serif · no decoration)

Swiss with color removed: hierarchy comes from weight and whitespace without an
accent color. It is the safest option for monochrome printing.

| Role | HEX |
|---|---|
| Background | `#FAFAFA` (dark variant: `#0A0A0A`) |
| Body | `#1A1A1A` |
| Thin lines | `#E0E0E0` |
| Intermediate elements | `#888888` |

- Use generous whitespace. Align left or center; do not right-align.
- Express hierarchy with bars of differing widths (120/80/40pt).
- Thin type with wide tracking blurs under projection. Increase weight for talks.

### C. Blueprint (dark · monospace · grid + annotations)

Use only for technical, design, or spatial proposals, not as a general style.

| Role | HEX |
|---|---|
| Background | `#0D2240` |
| Fine grid | `#64B4FF` 12% |
| Major grid | `#64B4FF` 22% |
| Shapes and dimension lines | `#64C8FF` 60% |
| Titles | `#96DCFF` 80% |

- Overlay fine (20pt) and major (60pt) grids.
- Use monospace throughout Latin text at 8~12pt.
- The background becomes a dark mass in monochrome print. Do not use it when
  evaluation includes printed copies.

## Korean font contract (our work — zero counterpart in the source)

None of the original 30 styles explicitly declares a Korean font. They specify
Latin families such as Helvetica Neue, Arial, Space Mono, and Futura, leaving
Korean to fallback fonts and making the same file appear differently by machine.

Apply this stack to every style:

```css
font-family:
  "Pretendard Variable", Pretendard,
  "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic",
  system-ui, sans-serif;
```

| Style | Latin original | Korean counterpart | Rationale |
|---|---|---|---|
| Swiss | Helvetica Neue Bold | Pretendard **SemiBold~Bold** | Match Latin Bold's visual weight; try SemiBold first because Korean Bold can merge strokes |
| Monochrome | Helvetica Neue Thin with 8~12pt tracking | Pretendard **Light**, **2~4pt** tracking | Do not transfer Latin tracking directly to Korean; its syllable blocks lose clear word boundaries with excessive spacing |
| Blueprint | Space Mono | **D2Coding** or `Noto Sans Mono CJK KR` | Korean monospace options are limited; Space Mono lacks Korean glyphs |

Four shared rules:

1. **Minimum body size:** Korean body text must be larger than Latin. Do not use
   slide body text below 14pt; it does not match the readability of 12pt Latin.
2. **Line breaks:** break Korean by word units. Set `word-break: keep-all` so
   browsers do not split words character by character across lines.
3. **Numbers and units:** Latin numerals in amounts and durations can have a
   different visual weight. Do not bold adjacent Korean merely to emphasize numbers.
4. **Line height:** use **1.2~1.35** for slides. Commonly cited 1.6~1.8 values are
   for web body text; they leave only a few lines on a 16:9 slide and separate
   multi-line titles into disconnected blocks. Korean glyph boxes already carry
   more vertical space than Latin, so there is no reason to exceed the upper
   bound. `scripts/assemble.py` uses this range; contract checks fail outside it.

`tests/test_style_fonts.js` prevents Korean font declarations from falling to
zero. That was the state of the 30 upstream styles. This section is the sole
increment correcting it and is therefore especially vulnerable during resync.

## Unavailable upstream material — design-slop.md

The design-slop.md import specified in plan §5 and the density ledger (62 visual
slop items plus four Korean typesetting items) remains unavailable. Upstream
aiSlopTaxonomyData.js is absent from this repository. The ledger records counts
only: 8 parts, 14 categories, and 100 items, with 49 for deck, 6 for image, and 7
meta items. It does not contain the item text.

Do not invent an import. Record it as unavailable until upstream is obtained.
