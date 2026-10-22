# Sections

Section ID (in parentheses) is the filename prefix that groups rules in `rules/`.

**This file is ours, not upstream.** Two upstream rule sets were merged into one
skill, and each shipped its own `_sections.md` with its own numbering — keeping both
would leave two files claiming to be the ordering. Order below is: performance
sections first (upstream `react-best-practices`), then authoring sections
(upstream `composition-patterns`). See `NOTICE`.

| # | Section | Prefix | Impact |
|---|---|---|---|
| 1 | Eliminating Waterfalls | `async-` | CRITICAL |
| 2 | Bundle Size Optimization | `bundle-` | CRITICAL |
| 3 | Server-Side Performance | `server-` | HIGH |
| 4 | Client-Side Data Fetching | `client-` | MEDIUM-HIGH |
| 5 | Re-render Optimization | `rerender-` | MEDIUM |
| 6 | Rendering Performance | `rendering-` | MEDIUM |
| 7 | JavaScript Performance | `js-` | LOW-MEDIUM |
| 8 | Advanced Patterns | `advanced-` | LOW |
| 9 | Component Architecture | `architecture-` | HIGH |
| 10 | State Management | `state-` | MEDIUM |
| 11 | Implementation Patterns | `patterns-` | MEDIUM |
| 12 | React 19 APIs | `react19-` | MEDIUM |

Rules are read in this order when the whole set is applied. When a task names an
area, read only that prefix — `SKILL.md` routes.
