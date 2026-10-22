# Code namespace convention

## 1. Defect

`references/ai-tell-taxonomy.md` uses `## L. Abstract metaphor lexicon`, while
`references/procurement-taxonomy.md` uses `## L. Requirements traceability collapse`.
Both use code L. A single skill loads both documents, so the collision affects
execution: detection output with `category: "L-2"` does not identify which L applies.

This identifier defect arose because no namespace convention existed.

## 2. Convention

1. **Allocate codes per namespace, not per document.** Separate files do not
   create separate names.
2. **Unprefixed `[A-Z]-\d+` codes have an unresolved namespace.** Do not put an
   unresolved code into output schemas; add its prefix when including it.
3. **Never reuse an allocated namespace.** Leave its prefix reserved even after
   retiring a taxonomy, preserving comparison with historical output.
4. **`U-` is reserved for unresolved IDs, not taxonomy entries.** This convention
   applies to its own allocations.

## 3. Allocate a new code

| Step | Action |
|---|---|
| 1 | Determine the namespace first |
| 2 | Choose its smallest unused number |
| 3 | Add a row to `references/taxonomy-codespace.md` |
| 4 | Fill in both `- class:` and `- 적용_서법:` in the rule body |

A code absent from the allocation table has not been issued. Writing it into a
rule before registering it would turn the table into a retrospective log that
cannot prevent collisions.

## 4. Checks

`scripts/lint_taxonomy.js` checks both conventions:

- Prefixes: report intersections between the two taxonomies' category-code sets.
- `적용_서법:`: count prefixed rules that lack a register field.

The second check **warns and reports the remaining count without blocking**.
Blocking during the reorganization would stop work and hide the remaining cases.
Keep them visible. Once the count reaches 0, remove the provisional designation
in section 5 below.

## 5. This convention is provisional

Prefixes resolve identifier collisions. Rules can still issue opposite decisions
on the same paragraph: giving them different names does not resolve that conflict.

The register axis in `references/register-axis.md` addresses the underlying issue.
Counting this document as completion would incorrectly record the conflict as
resolved, so its status remains provisional.

## 6. Document ownership

| Document | Responsibility |
|---|---|
| `references/code-space.md` | Convention, allocation procedure, and checks |
| `references/taxonomy-codespace.md` | Allocations and old-to-new code mapping |
| `references/register-axis.md` | Resolve opposite rule decisions on the same paragraph |
