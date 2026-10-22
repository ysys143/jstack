# Quality taxonomy — the canonical list

**This file is the single source of truth for the axes.** `audit` references it
and keeps no copy. When an axis changes, it changes here and nowhere else.

**The count is not in the name.** An earlier draft called this "the 8 axes",
which meant every added item forced a rename and left stale references behind.
The count is whatever this table holds.

**Before this file the axes had never been written down.** The phrase "the 8
axes" appeared three times in the planning document and every one of them was a
reference; the enumeration itself appeared zero times, and `knip` and `madge` —
the tools two of the axes were named after — appeared zero times as well. The
list had been inherited from a retired skill and treated as settled without ever
being set against the upstream it came from. That is the extreme form of
restating a list in several places: not restated, only pointed at.

## Six properties

Every axis below belongs to exactly one of six properties. The property is what
survives a language change; the axis is how it shows up in code, and the tool is
an implementation detail one layer further down (`references/lang-matrix.md`).

```
duplication / unused / cycles / swallowed failure / dead path / excess
```

## Axes

| # | Axis — defined by the property, not the tool | Property | Why it is an axis |
|---|---|---|---|
| 1 | A file that passed 1000 lines, or that this change pushed past it | excess | Size is the cheapest proxy for "nobody reads this whole thing" |
| 2 | Branch complexity this change added | dead path | Paths multiply faster than tests do |
| 3 | **Definitions nothing can reach** | unused | Dead code is a lie about what the system does |
| 4 | **Module dependencies that form a cycle** | cycles | Cycles make every part of the ring untestable alone |
| 5 | Thin wrappers, identity abstractions | duplication | An indirection that adds no decision costs a lookup and returns nothing |
| 6 | **Points that swallow a failure, or raise it with no context** | swallowed failure | The failure still happened; now it is invisible |
| 7 | Casts and `any` that blur a contract; magic that hides a simple structure | excess | The type stopped describing the value |
| 8 | AI slop — **only from the closed list below** | excess | Without a closed list this becomes a euphemism for taste |
| 9 | **Reusing the canonical layer** — was something that already exists rebuilt instead | duplication | Higher signal-to-noise than hunting duplicates |
| 10 | **Serial orchestration, non-atomic updates** | dead path | A structural defect that is also an outage cause |

Axes 3, 4, 6, 9, and 10 are stated as properties rather than as the tool that
finds them. Naming the tool (`knip`, `madge`) ties the axis to one language's
ecosystem and hides the axis in languages where that tool does not exist.

## Upstream eight to our axes — the mapping table

`audit` and `cleanup` are supposed to apply the same taxonomy to the same code.
Without this table they could not: the upstream review rubric these axes descend
from carries eight items of its own, and until the correspondence was written
down each skill was free to read a different list into the same phrase.

| Upstream item | Our axis | Property | Note |
|---|---|---|---|
| number not pinned | 1 — file size | excess | Present upstream; the upstream item's number is not recorded in any source we hold |
| number not pinned | 2 — added branch complexity | dead path | Present upstream |
| number not pinned | 3 — definitions nothing can reach | unused | Upstream states the property; **it does not name `knip`** |
| number not pinned | 4 — dependency cycles | cycles | Upstream states the property; **it does not name `madge`** |
| number not pinned | 5 — thin wrappers, identity abstractions | duplication | Present upstream |
| number not pinned | 6 — swallowed or context-free failures | swallowed failure | Upstream phrases this as unwarranted try/catch, which assumes JS/TS |
| number not pinned | 7 — casts, `any`, magic | excess | Present upstream |
| **item 6** | 9 — reusing the canonical layer | duplication | **We had no counterpart.** Restored |
| **item 7** | 10 — serial orchestration, non-atomic updates | dead path | **We had no counterpart.** Restored |
| — | 8 — AI slop | excess | **No upstream item.** It comes from the deslop line, which is why it alone needs a closed list and an adjudicator |

**The arithmetic does not close, and that is recorded rather than smoothed.**
Upstream holds eight items. Nine rows above claim an upstream counterpart, so at
least one upstream item is claimed by two of our axes. Which one cannot be said
from the sources this repository holds: only items 6 and 7 are pinned by number,
and the remaining correspondences were matched by property. Writing "8 <-> 8"
here would be a number invented to make a table look finished.

## What upstream has that a tool-shaped list loses

Axes 9 and 10 are restorations, not inventions. Both were in the upstream rubric
and both were dropped when the list was inherited.

| Restored axis | Why it earns its place |
|---|---|
| 9 — was something that already exists rebuilt instead of reused | Higher signal-to-noise than hunting duplicates. Asking "why was this written again" finds the cause; asking "where is this repeated" finds the symptom |
| 10 — serial orchestration, non-atomic updates | A structural defect that is also an outage cause, which gives it a higher incident-prevention value than any other axis here |

## Axis 8 — the closed list

**Nothing outside this list is reported as slop.** Two of the obvious candidate
symptoms are restatements of other axes, so an open list would double-count.

| Symptom | Not to be confused with |
|---|---|
| A comment that restates the line below it | Axis 7 (magic needing explanation) |
| A test that asserts the mock, not the behaviour | Axis 5 (thin wrapper) |
| Defensive branches for states the type system already excludes | Axis 2 (added complexity) |
| Names that describe the implementation, not the caller's intent | — |
| A wrapper introduced for a single call site | Axis 5 — **report as 5, not 8** |

`references/slop-criteria.md` carries the adjudicator for each of these five and
the record of which candidates were rejected. A symptom with no adjudicator is
not admitted to the list.

## Priority when axes collide

**Removing a swallowing fallback (axis 6) comes before DRY (axis 5).**
Consolidating a fallback that swallows promotes the defect onto the shared path —
the same bug now reaches every caller.

## Language validity

An axis whose detector does not exist in a language is **still an axis**; it is
found by reading rather than by a tool. Say which it was.

| Language | Axis 3 (unreachable) | Axis 4 (cycles) |
|---|---|---|
| TypeScript / JavaScript | `knip`, `ts-prune` | `madge` |
| Python | `vulture` | `pydeps` |
| Go | `staticcheck -unused` | built into the compiler |
| Rust | `cargo +nightly udeps` | not applicable — the module graph is acyclic |
| Others | read | read |

**An empty cell is written as empty**, not left blank — blank reads as
"not filled in yet".

The table above is the summary. **`references/lang-matrix.md` is the full grid**
— six properties across seven languages, forty-two cells, with the empty sets,
the blind spots, and the one language (C) that this taxonomy judges but
`tdd/langs/` has no guide for.
