---
name: typescript-best-practices
description: "Production TypeScript rules; apply to .ts and .tsx edits. Triggers: 타입스크립트, 타입 설계."
---

# TypeScript best practices — let the compiler refuse the bad state

These are rules for production TypeScript, written for code like jstack's own
runtime: strict compiler settings, ES modules, Node built-ins, and few
dependencies. Apply them when you read, write, or review a `.ts` or `.tsx` file.
They concern types and the places data enters the program. Test design belongs
to `test-driven-development`.

Two ideas sit under every rule. **Make the compiler reject impossible states,
mismatched primitives, and unhandled variants**, so no handler has to exist for
them. **Check data once, where it crosses into the program, and trust the types
after that.** Checking again deeper in adds noise and a false sense of safety.

## The rules

| Rule | Summary |
|---|---|
| Discriminated unions | Model variants with a literal discriminant such as `kind`. An object of optional fields can describe states that cannot exist |
| Branded types | Brand primitives that mean different things (`TaskId`, `RunId`) so they cannot be swapped. A brand comes from a verifying parse or guard, never from `as` |
| Constructive modeling | Build the type so the illegal value cannot be written: `[T, ...T[]]` for non-empty, `start` plus `durationMs` for a range. A comment that states an invariant is not enforcement |
| Simplest total type | Keep `T[]` while every operation on it is total. Strengthen it only where the loose type forces a `!`, a cast, or a "should never happen" throw |
| `unknown` over `any` | Data from outside is `unknown` until parsed. `JSON.parse`, `fetch` bodies, `process.env`, file contents, and IPC messages all count |
| Parse, then trust | One named parse function per boundary turns raw input into a domain type. Prefer the repository's existing schema library and infer the type from it; never keep a schema, a duplicate interface, and a guard that can drift apart |
| No `as` casts | Every `as` is a runtime failure that has not happened yet. Cast only after validation, and prefer `satisfies` when the goal is only to check a value |
| Narrowing order | Discriminant switch, then `in`, then `typeof` or `instanceof`, then a user-defined guard, then `as` last |
| Honest guards | A guard must verify the claim it makes. A guard that lies is worse than `as`, because the bug hides behind a name that says it is safe. Name guards `isX` or `hasX` |
| Exhaustiveness | End a variant switch with `const _exhaustive: never = x;` so adding a variant breaks the build |
| Derive, do not duplicate | When a schema, protocol file, or generated type owns a shape, use `Pick`, `Omit`, `Parameters`, `ReturnType`, `Awaited`, or `typeof` instead of declaring a parallel interface |
| Object arguments | Pass an object when a call has several arguments of the same type, so order cannot be mixed up. Skip it on hot paths such as parsers and tokenizers |
| Real tests over mocks | Run the real thing when it runs locally; mock only what you cannot run. The procedure is in `test-driven-development` |

Code examples for each rule are in `references/patterns.md`.

## Boundary discipline

Validation, narrowing, and error handling belong at the system's edges: CLI
arguments, config files, network responses, external APIs, and anything read
from disk. Inside the edge, pass typed data and propagate errors without
re-checking it.

- **Parse where data crosses in, into a named domain type.** A
  `Record<string, unknown>` (spelled any way) may exist only until that parse.
- **Do not re-validate deep in a call chain.** A redundant null check three
  layers down means the boundary did not do its job, or the type is too loose.
  Fix that, and leave the check out.
- **Expose domain concepts, not the boundary's own shape.** Do not re-export
  transport, storage, framework, or wire types through a public surface. A
  consumer should not learn about your serialization format.
- **Keep logic in pure functions and the shell thin.** Parsing, scoring, and
  building a prompt or a report are transforms from data to data. The code that
  touches the file system, the network, or the framework only calls them. Pure
  logic is testable without the framework.
- Persisted JSON is a boundary too: version the blob, and treat a failed parse
  as an expected branch, not a crash. Wire formats should ignore unknown fields
  so a newer writer does not break an older reader.

Two questions settle most cases. *Is this data crossing a boundary right now?* If
not, validation here is redundant. *Could this be a pure function that the shell
calls?* If so, extract it.

## Boundaries of this skill

| Task | Owner |
|---|---|
| Writing the tests for a feature | `tdd` skill |
| Restructuring existing code under test | `cleanup` skill |
| Whether finished work is complete | `verify` skill |
| React and Next.js performance rules | `react` skill |

## Limits (stated)

- These rules are judgments about type design. The compiler enforces a few of
  them; the rest depend on whoever reads the diff
- A rule yields to the repository. When a repository has a schema library, a
  brand convention, or a lint rule, follow it and do not introduce a second
  convention
- Do not add a dependency for one guard
