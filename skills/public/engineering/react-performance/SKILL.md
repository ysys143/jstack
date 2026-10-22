---
name: react-performance
description: "Apply React and Next.js performance and composition rules. Triggers: React 성능, 리렌더."
---

# React — rules with an impact grade, not opinions

The 78 rules are not ours. They come from **Vercel** —
<https://github.com/vercel-labs/agent-skills> — and live verbatim in `rules/`.
`NOTICE` records the version, the licence grade (`none`), and the four things
we changed.

Each rule is one file: frontmatter with `impact` and `tags`, then an
**incorrect / correct pair**. That shape is why they are worth reading rather
than summarising — the pair is the content.

## Route by prefix, do not read all 78

`rules/_sections.md` is the ordering. Twelve sections, highest impact first.

| Prefix | Section | Impact |
| --- | --- | --- |
| `async-` | Eliminating waterfalls | CRITICAL |
| `bundle-` | Bundle size | CRITICAL |
| `server-` | Server-side performance | HIGH |
| `architecture-` | Component architecture | HIGH |
| `client-` | Client-side data fetching | MEDIUM-HIGH |
| `rerender-` | Re-render optimisation | MEDIUM |
| `rendering-` | Rendering performance | MEDIUM |
| `state-` | State management | MEDIUM |
| `patterns-` | Implementation patterns | MEDIUM |
| `react19-` | React 19 APIs | MEDIUM |
| `js-` | JavaScript performance | LOW-MEDIUM |
| `advanced-` | Advanced patterns | LOW |

When the task names an area, read that prefix. When it does not, start at
`async-` and `bundle-` — the CRITICAL two are where the measurable wins are.

How to apply what you read — scope, measurement, and what not to count as a
finding — is in `references/applying.md`. Read it before reporting.

## Two things to know before applying any of it

**`js-` needs no React.** Fourteen rules are plain JavaScript performance —
`Set`/`Map` lookups, hoisted regexes, cached property access, early exit. They
apply to any JS or TS in this repository, front end or not.

**Ten rules assume Next.js.** They are correct where Next.js is used and
**out of scope elsewhere — not wrong**:

```
server-hoist-static-io      server-after-nonblocking     server-cache-react
server-auth-actions         bundle-dynamic-imports       bundle-analyzable-paths
bundle-barrel-imports       bundle-defer-third-party     rendering-script-defer-async
rendering-hydration-suppress-warning
```

They are kept, not deleted: deleting upstream rules breaks the byte binding and
loses content that becomes correct the moment Next.js is adopted. The contract
suite compares this list against the files, so if upstream renames one, the
list goes red instead of quietly lying.

## Impact grades are claims, and claims get checked

`impact: CRITICAL` with `2-10x improvement` is a measurable statement. Treat it
as a hypothesis to confirm on the actual code path, not as a licence to
refactor. A waterfall that runs once at build time is not a CRITICAL finding
just because the rule says so.

**Measure before and after when the rule claims a number.** If it cannot be
measured here, say so in the report rather than claiming the rule's number.

## What this is not

| Question | Skill |
| --- | --- |
| Is the interface accessible and usable? | the `ui` skill |
| Should this change merge? | the `audit` skill |
| Fix it, in what order? | the `cleanup` skill |
| Write the test first? | the `tdd` skill |

`react` answers **"is this React code fast and well-composed"**. It does not
judge accessibility, and it does not decide whether to merge.

## Limits

- **Rules age with the framework.** React 19 and Next.js move; a pinned
  snapshot drifts. `NOTICE` carries the commit, `upstream` carries the refresh.
- **Vercel wrote them for their own stack.** Six rules mention Vercel; all six
  are asides (a Fluid Compute note and two blog citations), not requirements —
  measured, not assumed. The rules themselves are platform-neutral.
- **No machine applies these.** There is no linter here. The contract suite
  checks that the rules are intact and routed, not that code obeys them.
