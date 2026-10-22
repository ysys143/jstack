---
description: Convert documents after choosing the destination format
---

# /convert — Choose a conversion route

## What this command does

Choosing the route determines most of a conversion. A poor choice can be costly
to reverse, such as converting `.hwpx` to `.docx` and then typesetting it again.

This command therefore (1) selects a destination, (2) **explains that route's
pitfalls first**, and (3) hands off to the appropriate skill. `/validate`
verifies the result after the handoff.

## Route table

| Source → destination | Owner | Know this first |
|---|---|---|
| Markdown → `.hwpx` | `hwpx` | **A reference template is required.** Without one, the model must invent styles |
| Markdown → `.docx` `.pptx` `.xlsx` | `office` | Korean text breaks without an `<a:ea>` font declaration |
| Markdown → slides | `deck` | The default marp theme **has no CJK font**. PDF and PPTX require Chrome |
| Markdown → diagram | `diagram` | Use this for structure and `image` for illustration |
| `.hwp` → `.hwpx` | `hwpx` | **Requires Windows and Hancom COM.** Unavailable on macOS and Linux |
| `.hwpx` → Markdown | `hwpx` | Tables and merged cells lose information |
| Generate an image | `image` | Text inside an image **cannot be edited later** |

## Choices that are hard to reverse

1. Once **`.hwpx` becomes the final format**, later body edits require new
   typesetting. Finish prose revision (`humanize`) and notation (`proof`)
   **before** typesetting.
2. marp's default PPTX output uses **image slides** that cannot be edited. Use
   experimental `--pptx-editable` or `office` when editing is required.
3. Text embedded in an image requires regeneration for every revision. Use
   `diagram` when the text may change because SVG preserves it as text.

## Procedure

1. **Confirm the destination and submission format.** The extension required by
   the client is authoritative.
2. Choose a route in the table and **read its pitfalls first**.
3. Check tool availability with `/doctor` or the skill's Phase 0.
4. Convert with the corresponding skill.
5. **Run `/validate`.** Conversions often fail silently through missing fonts,
   broken references, or tables that exceed the page width.

## Chain order for procurement deliverables

```
humanize  →  proof  →  hwpx/office/deck
 (style)    (notation)   (typesetting)
```

**Keep this order.** Prose revision changes length. If typesetting comes first,
column allocation and character counts must be recalculated afterward.
