# Delivery formats and publishing outside the workspace

Source: `up:stack-diagram` `skills/stack-diagram/references/tsx.md` and `SKILL.md`
Step 7 (MIT), commit `f6c5785`, vendored under `../repos/stack-diagram/`. jstack
adapts the TSX procedure to an SVG source and keeps Step 7's disclosure procedure
while removing its gallery upload.

## TSX component

Produce TSX only when the user asks for a React component. Convert the **built** SVG,
after every validator and `self_check.py` has passed on it; the component is a
repackaging, not a second drawing.

```tsx
// ArchDiagram.tsx — no props, no imports beyond React
const ICONS = {
  hono: "data:image/svg+xml;base64,...", // copied from the built SVG
} as const;

export default function ArchDiagram() {
  return (
    <svg viewBox="0 0 1120 792" role="img" aria-labelledby="arch-title arch-desc">
      <title id="arch-title">...</title>
      <desc id="arch-desc">...</desc>
      {/* edges first, then cards: the same paint order as the SVG */}
    </svg>
  );
}
```

- **Self-contained.** Data-URI marks in one constant, colors in one token constant,
  inline attributes. No CSS files, no Tailwind, no imports beyond React.
- **Same geometry.** Keep the `viewBox`, coordinates, paint order and accessibility
  elements. Rename attributes for JSX only: `stroke-width` → `strokeWidth`,
  `marker-end` → `markerEnd`, `text-anchor` → `textAnchor`, `font-size` → `fontSize`,
  `class` → `className`, `xlink:href` → `href`.
- **Readable for later edits.** Repeated cards may become a small local `Card`
  component taking position, mark, name and role.
- **No embedded fonts.** The host app owns its font pipeline. Keep the Korean font
  stack from `SKILL.md`, Phase 2, as `fontFamily` and say in a leading comment which
  faces restore the reference look.
- **Deliver as a file** named `<Name>Diagram.tsx` in the user's workspace. TSX is code
  for their repository, not a page to publish.

The local validators read SVG, not TSX. State in the report that they ran on the
source SVG, not on the component.

## Before anything leaves the workspace

Publishing an artifact, uploading to a gallery or wiki, posting to an issue, or sending
a share link makes the diagram public or at least external. That is the user's
decision, and it needs their approval for that exact content.

1. **Show exactly what will be sent:** the files with their paths, every label in
   them, and any title, description or metadata that accompanies them.
2. **Point out what looks internal** and offer a redacted re-render first: hostnames,
   IP addresses, URLs, account or project IDs, customer and company names, internal
   service names, people's names.
3. **Ask whether it is their own system or one they may show.** Send only after an
   explicit yes on that exact content. A change after approval needs a new approval.
4. **Never send the conversation or the request text** along with the diagram.

jstack ships no gallery client. Upstream's `scripts/share.py` and its Step 7 offer to
post to a public gallery are excluded, and this skill never offers that step. A
draw.io fragment URL from `scripts/encode_drawio_url.js` contains the whole diagram,
so the same disclosure check applies before sharing it.
