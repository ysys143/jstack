# Image prompt slots: 11 slots (12 for Hero only)

## Provenance

Only the **slot structure** was taken from seven asset-prompt templates in
upstream slopslap (`vibedesignlab/slopslap`, MIT),
`docs/readme-visual-asset-plan.md` sections 6.2-6.8.

**The upstream originals are not in this tree.** The section 6.1 Master Prompt
and section 6.9 QA Prompt were excluded because they depend on upstream-specific
absolute paths and reference kits. The remaining templates were not copied
sentence by sentence either. The table below reconstructs **slot names and their
order** from measured, confirmed file-ledger entries and rewrites their content
for Korean public procurement and evaluation materials.

**There are 11 slots.** The plan's section 5 counted ten incorrectly; measurement
confirmed eleven. Only the Hero asset (section 6.2) adds `Color palette`, making 12.

## Slot table: order is a contract

Move from broad to specific. Reordering can make the model read later slots as
modifiers of earlier slots, confusing the scene and subject.

| # | Slot | What to specify | What happens if omitted |
|---|---|---|---|
| 1 | `Use case` | Placement: proposal cover, presentation background, document illustration | A purposeless image is cropped when placed in the intended location |
| 2 | `Asset type` | Asset kind: hero / icon / illustration / background / thumbnail | The spacing convention specific to that asset kind is not enforced |
| 3 | `Output target` | Final dimensions and medium: 16:9 slide / A4 print / square thumbnail | The model chooses its default aspect ratio; cropping cuts off the subject |
| 4 | `Primary request` | A one-sentence request. Only this slot is required | The other ten slots have no request to qualify |
| 5 | `Scene/backdrop` | Background, setting, and environment | Gray gradients or purple-blue backgrounds become defaults |
| 6 | `Subject` | Main subject and its state | Only the background appears, or multiple subjects compete |
| 7 | `Style/medium` | Visual style and medium: flat vector / photograph / line art / watercolor | Default glossy 3D rendering clashes with the document's tone |
| 8 | `Composition/framing` | Composition, viewpoint, and space: centered / left third / top clearance | The subject fills the center, leaving no room for the title |
| 9 | `Text (verbatim, large labels only)` | **Exact lettering** to include; large labels only | The model invents unreadable pseudo-characters |
| 10 | `Constraints` | Requirements: monochrome readability / minimum text size / safe margins | Violations cannot be identified as failures without stated constraints |
| 11 | `Avoid` | Exclusions: logos, human faces, specific colors | Shapes resembling the procuring institution's logo can appear |
| 12 | `Color palette` | **Hero only.** Specify exact color values | Cover colors vary between runs, breaking consistency across the materials |

**Only Hero has 12 slots.** The other six asset kinds use 11 and omit `Color palette`:
fixing colors separately for every icon and illustration can fragment the document palette.

## Empty slots are filled with defaults

This is why slots are enumerated. The model does not leave omissions blank: it
**fills them from the center of its learned distribution**. Many unexpected
results therefore come from **slots we left unspecified**. Identifying the empty
slot identifies where the prompt needs correction.

## Joining cause tags

Each deduction item in the slide/document review list has a `cause` field.
Empty slots provide a **join key** into that field.

| This document | Joined category |
|---|---|
| A slot among 1-11 (12) was empty | Missing prompt information; fix it by **filling that slot** |
| All slots were filled, but the result was not inspected | Generation without verification; fix it by **rendering and visually inspecting** |

**The canonical tag-value set is the "Cause tags" definition table in the `deck`
skill's `references/design-slop.md`.** Do not duplicate those values here. Two
copies drift, and a divergent join key no longer joins correctly.

**That value set is awaiting a decision.** Whether to keep the upstream four
values or merge them into two is not yet settled (C-43). This document therefore
names **categories** without literal values. Once the canonical set is finalized,
this section can remain as written and follow its referenced source.

## Slot 9: Korean lettering needs distinct treatment

`Text (verbatim, large labels only)` differs from other slots for three reasons.

- **Write it verbatim.** An instruction such as "use the project name as the title"
  makes the model invent wording. Put the exact intended string in quotes.
- **Use large labels only.** Paragraph-length Korean text loses stroke fidelity.
  Measurements found accurate short words but degradation as character count
  increased (the path 1 measurement in `SKILL.md`).
- **Embedded lettering cannot be edited afterward.** If editing may be needed,
  add text as slide elements instead of embedding it in the image. The `deck`
  skill owns typesetting.

Procurement materials add one requirement: **assume monochrome printing**.
Labels distinguished only by color become the same gray in printed review copies.

## Which slots become arguments on each path

The two paths accept slots differently. Read this with `references/cli.md`.

| Slot | codex path | nanobanana path |
|---|---|---|
| Slot 3 `Output target`: aspect ratio | State it in prose; control is weaker | Pass `-a/--aspect-ratio` |
| Slot 3 `Output target`: size | State it in prose | Pass `-s/--size` |
| All remaining slots | Join into one paragraph | Join into one positional argument |

**For placements with fixed dimensions, use available arguments instead of prose.**
Putting an argument-supported value in prose adds a model-interpretation step
that can introduce a mismatch.

## Assembly example: procurement cover Hero

```
Use case: proposal cover, printed submission
Asset type: hero
Output target: A4 portrait, 300dpi, also printed in monochrome
Primary request: a cover showing urban infrastructure data converging at one point
Scene/backdrop: pale gray-white solid background; no gradients
Subject: a line-drawn city outline with connecting data flows
Style/medium: flat vector line art, two stroke weights
Composition/framing: artwork in the lower third; upper half clear for the title
Text (verbatim, large labels only): none
Constraints: distinguishable by luminance in monochrome; 15mm safe margins
Avoid: procuring institution logos, human faces, glossy 3D
Color palette: one ink black plus two gray levels
```

**Writing "none" in slot 9 also fills it.** A blank invites invented lettering;
explicitly writing `none` requests no lettering.

## Before use

- Have **all 11 slots (12 for Hero)** been written? Write `none` where nothing applies.
- Is slot 9 the **exact final wording**? It cannot be edited afterward.
- Does slot 10 include medium constraints such as print or projection?
- Was the result **visually inspected**? Otherwise verification-related deductions remain.
