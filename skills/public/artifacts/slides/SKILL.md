---
name: slides
description: "Design presentation slides and pick a PPT design pack. Triggers: 발표자료, 슬라이드."
---

# Deck — presentation design and production

## Phase 0: choose the backend — one question decides

> **Is the deliverable itself an editable `.pptx` file?**

| Answer | Backend | Why |
|---|---|---|
| **No** (a presentation is enough / PDF or HTML is sufficient) | **`marp`** — default | Markdown remains the source. It is the **only path** that allows prose to be revised with `humanize` and rendered again |
| **Yes** (the client requires a `.pptx` submission / someone will edit it) | `office` skill (OfficeCLI) | marp's default `--pptx` produces **non-editable image slides** and cannot satisfy this requirement |

**Most requests are "No."** "Create a PT" often means giving a presentation,
not submitting a file. **Ask when it is ambiguous** — choosing the wrong path
splits the source and makes recovery expensive.

> "Do you only need to present, or must you submit or deliver a `.pptx` file?"

Do not use `--pptx-editable` as a submission path because it is
`[EXPERIMENTAL]`. See `references/marp.md` §2.

## Phase 1: check availability

```
node ${JSTACK_PLUGIN_ROOT}/skills/deck/scripts/ensure_marp.js
```

- exit 0 — HTML, PDF, PPTX, and images are all available
- exit 1 — **HTML only** (no browser). Report this immediately if PDF is required
- exit 2 — marp is unavailable. Stop after giving installation guidance

**Do not treat exit 1 as a failure.** HTML is often sufficient for draft review.
However, **say first that a browser is unavailable when PDF is required** — this
is better than discovering it after a silent render failure.

## Phase 2: choose a style

When the user names a design-pack slug, load
`assets/design-packs/{slug}.md` directly. When the user asks for a distinctive
visual direction or a design pack, read `assets/design-packs/catalog.md`,
recommend at most three suitable packs with a reason, or select one and state it
when production was requested. Do not enumerate all 40 packs or load every pack.
Apply its colors, typography, layout, charts, diagrams, and **do-not-use** rules.

For ordinary slide requests that do not call for a pack, load
`references/styles.md`. Choose among the three base styles using the **three
substantive axes**: background brightness, title typeface, and decoration density.

**For procurement, the default is Swiss (light).** Dark backgrounds make body
text **disappear in monochrome print**; procurement proposals are often reviewed
as black-and-white output. Use a light background when print review is unknown.

For `.pptx`, the pack specifies visual requirements while `office` supplies the
editable authoring backend. Titles, body text, tables, bullets, shapes, arrows,
charts, diagrams, and infographics must remain native PowerPoint objects wherever
possible. Do not rasterize a whole slide from HTML/CSS into a full-bleed PNG.
Use images only for photographs and illustrations. Check font availability and
licensing before embedding fonts, provide fallbacks, and inspect the rendering.

## Phase 3: Korean typesetting contract (required)

**Always** apply the Korean font contract in `references/styles.md`.

Both the source styles and marp's default theme contain **zero CJK font
declarations**. Without one, Korean falls back to a browser font and **the same
file renders differently on each machine**. In procurement deliverables, changed
line breaks can overflow a page.

Minimum contract: a CJK stack, `word-break: keep-all`, and body text of at least 14pt.

## Phase 4: write the content

- Write the manuscript in Markdown. Whatever the backend, **Markdown is the source**.
- For procurement documents, run `humanize` in procurement mode after writing the content.
- Use the `proof` skill for notation and spelling (deck handles typesetting; proof handles notation).

## Phase 5: render and inspect

```
# HTML — no browser required
marp deck.md -o deck.html

# PDF — requires Chrome or similar. Add --allow-local-files for local images or fonts
marp deck.md -o deck.pdf --allow-local-files
```

`--allow-local-files` is marked `(NOT SECURE)`. **Use it only with manuscripts we
wrote**; do not enable it for Markdown from an unknown source.

**Do not call it complete until a person opens it.** A successful render does not
mean it looks as intended: Korean font fallback, overflowing tables, and missing
images all appear after rendering succeeds.

### Inspect deduction items while viewing

After opening the render, **also open** `references/design-slop.md`. This is not
an exhaustive audit: read from the top, record only applicable items, and attach
the cause tag (`input` / `no-verify`) and both axes (deduction and cost). Fix
items with **larger deductions and lower costs first**. When several items share
a tag, fix the cause rather than each item. Record when nothing applies;
forced findings make the next person ignore the entire list.

## Phase 6: script paths — two cases marp cannot handle

**This is not the default path.** Use marp when marp can do the job; scripts cover
only cases marp cannot handle.

| Script | Responsibility | When |
|---|---|---|
| `scripts/assemble.py` | Manuscript `.md` or `slide_plan.json` -> PPTX | When each slide must contain a finished image |
| `scripts/pdf2pptx.py` | Existing PDF presentation -> PPTX (+PDF) | When no source Markdown remains and only a PDF exists |

### Argument format

```
python3 ${JSTACK_PLUGIN_ROOT}/skills/deck/scripts/assemble.py deck.md \
  -o workspace/deck/output/result.pptx

python3 ${JSTACK_PLUGIN_ROOT}/skills/deck/scripts/pdf2pptx.py input.pdf \
  --skip-upscale -o workspace/deck/output/result.pptx
```

- Input is a **positional argument**, not an option such as `--input`.
- `-o` is the PPTX path. A PDF is emitted alongside it **only for image slides**.
  The assembly scripts do not embed Korean TTF fonts; marp in Phase 5 handles text-manuscript PDFs.
- `pdf2pptx.py` recommends `--skip-upscale` first. Upscaling requires the `image`
  skill and an API key and cannot preserve the layout exactly.

### `slide_plan.json` schema

Use this input only when image paths already exist. The keys below are all that
`assemble.py` reads; undeclared keys are silently discarded.

| Key | Location | Meaning |
|---|---|---|
| `slides` | Top level | Slide array. If absent, treat it as zero slides and exit 1 |
| `slide_num` | Slide | Sort key; appearance order if absent |
| `title` | Slide | Slide title |
| `key_points` | Slide | Bullet array |
| `image_path` | Slide | Finished image path; empty means typeset a text slide |
| `speaker_notes` | Slide | Speaker notes |

### Dependencies

```
pip install -r ${JSTACK_PLUGIN_ROOT}/skills/deck/requirements.txt
```

One `requirements.txt` contains everything required by both scripts. **Do not
install dependencies on the user's behalf.** If they are missing, the script
stops with **exit 2 and installation guidance** instead of forcing the user to
read a traceback. Exit 1 is an input error and has a different remedy.

Upscaling calls `nanobanana.py` from the `image` skill. Do not duplicate the image
generator here; two model IDs would allow one copy to change while the other
silently diverges.

## References

| File | Contents |
|---|---|
| `references/styles.md` | Three styles, three substantive axes, and the **Korean font contract** |
| `references/marp.md` | Chrome dependency, non-editable PPTX, `--allow-local-files`, and CJK stack (all measured) |
| `references/design-slop.md` | 21 review deductions, two cause tags, deduction x cost axes, and four procurement reversals (**original work**) |
| `assets/design-packs/catalog.md` | Forty PPT packs indexed by visual direction |
| `assets/design-packs/ppt-*.md` | Exact color, typography, layout, chart, diagram, and prohibition contracts |
| `NOTICE` | Source of corazzon/pptx-design-styles (MIT) and our changes |
| `scripts/ensure_marp.js` | Three-state marp/browser availability check (Phase 1) |
| `scripts/assemble.py` · `scripts/pdf2pptx.py` | Assembly and conversion (Phase 6) |
| `requirements.txt` | Dependencies for both scripts, combined in one file |

The design-pack specifications are MIT-licensed original/adapted visual
principles from <https://design-diversity.vercel.app>. They do not authorize
copying a product's trademark or logo.

Contract checks run through `tests/run_tests.js`. `tests/test_style_fonts.js`
detects a zero Korean-font contract; `tests/test_slop_axes.js` measures the two
cause tags and the deduction x cost axes in `design-slop.md`.

## Explicit limitations

- **`design-slop.md` is original work, not an upstream transfer.** The upstream
  slopslap taxonomy is tied to a capture pipeline carrying its own invented
  license tag and was excluded from import. We wrote a replacement for this
  domain; its item count differs from upstream and it is not a crosswalk.
- marp-cli and the browser are not included in this plugin; use the user's environment.
- The `office` skill handles editable `.pptx` files; this skill does not create them.
