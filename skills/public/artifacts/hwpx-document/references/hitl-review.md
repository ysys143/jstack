# HITL Review Loop

HITL means human-in-the-loop visual review. Use it as an iteration loop, not as a rigid pass/fail gate.

The normal workflow is:

1. Receive a reference HWP/HWPX style file and Markdown or text source.
2. Generate an initial `.hwpx`.
3. Run structural and semantic validation.
4. Give the `.hwpx` to the user for visual review in Hancom Office or the target viewer.
5. Apply the user's concrete feedback and regenerate or patch the document.
6. Repeat until the user accepts the output or asks to stop.

Validators prove that the HWPX package and XML references are coherent. They do not prove final visual fidelity, because line wrapping, page breaks, font substitution, table pagination, and Hancom rendering can differ from XML-level expectations.

## Review Focus

Ask the reviewer to look for concrete corrections, especially:

- Page breaks or line wrapping that look wrong.
- Heading numbering, local numbering, or bullets that do not match the reference.
- Tables that are too wide, too cramped, or styled unlike the reference.
- Captions, spacing, fonts, or Korean text rendering that look off.
- Raw Markdown artifacts such as `|---`, code fences, or placeholder text.
- Hancom repair dialogs, broken opening behavior, or corruption.

## Status Labels

Use these lightweight labels in agent responses:

- `HITL: ready-for-review` - generated and validated; waiting for the user to inspect visually.
- `HITL: reviewed-needs-revision` - user reviewed and requested concrete changes.
- `HITL: revised-ready-for-review` - changes were applied and a new file is ready for another review.
- `HITL: accepted-by-user` - user accepted the visual result.
- `HITL: not-run` - no visual review was requested or possible.

Do not block initial delivery of a generated `.hwpx` just because HITL has not happened. Do not say the visual result is approved unless the user has reviewed and accepted it.
