# Evidence needs — opt-in checks for exhaustive and numeric requests

Use this only when a current requirement asks for **every item of a set**, a **count**
or a **total**. A simple question, a summary, or an edit needs none of it, and the
paragraph check in `coverage_matrix.js` stays the whole check for those.

`coverage_matrix.js --needs` adds one deterministic pass. It checks submitted items
against **hash-checked source files**, a **declared item boundary** and the **report**.
It runs no model and no network call.

```
node ${JSTACK_PLUGIN_ROOT}/skills/research/scripts/coverage_matrix.js \
  --needs needs.json --task TASK --report deliverables/report.md [--cover all|ID,ID]
node ${JSTACK_PLUGIN_ROOT}/skills/research/scripts/coverage_matrix.js \
  --needs needs.json --req rfp.txt --report deliverables/report.md [--min-chars N]
```

With `--req` the plain paragraph check also runs, including its `THIN` finding for a
requirement paragraph shorter than `--min-chars` (default 200 characters). A short
report can therefore exit `1` while `evidence.mechanicalResult` is `consistent`; lower
`--min-chars` when short paragraphs are intended.

`--task` reads the current request state (`jst task`, see `runtime/TASKS.md`) when the
command runs; add `--workspace DIR` and `--home DIR` only for a task kept elsewhere.
Without `--needs` the command behaves exactly as before. `--pairs` is refused with
`--needs`, so a typed run never writes beside its own inputs.

## Derive needs from current requirements

One need per information the report must state, each bound to **an existing active
requirement** (and to a Phase 2 subquestion through the optional `subquestion` label).
Do not invent requirements here; a need for a requirement that does not exist, is
withdrawn, or changed meaning fails.

| `type` | Automated check | Needs |
|---|---|---|
| `enumerate` | Items against the boundary (omitted, unknown, duplicate), quotes, report rows | `items`, `boundary` |
| `count` | `claimed` against distinct submitted items and boundary rows, quotes | `items`, `boundary`, `claimed` |
| `compute` | `operation: "sum"` recomputed exactly from items, quotes, report rows | `items` with `value`, `boundary`, `claimed` |
| `lookup` | One item's value grounded in its quote; `claimed` agrees; one source row for the ID | one item with `value`, `claimed`; `boundary` optional |
| `compare`, `judge` | **None.** Reported as `MANUAL`; a person assesses them | `id`, `type`, `requirement` |

Other operations (mean, ratio, difference) are typed but unchecked: `UNSUPPORTED_OPERATION`.

## Input

```json
{
  "schema": "jstack-evidence-needs/1",
  "task": "incidents", "workspace": "<from the check output>", "constraintsRevision": 0,
  "sources": { "S1": { "path": "incidents.log", "sha256": "<sha256 of the file bytes>" } },
  "needs": [
    { "id": "N1", "type": "enumerate", "requirement": "INCIDENTS", "requirementRevision": 1,
      "subquestion": "SQ1", "boundary": { "source": "S1", "linePrefix": "INC-" },
      "items": [ { "id": "INC-1", "source": "S1", "quote": "INC-1 database failover" } ] },
    { "id": "N3", "type": "compute", "operation": "sum", "requirement": "COST", "requirementRevision": 1,
      "claimed": "3000", "reportPrefix": "합계", "boundary": { "source": "S1", "linePrefix": "INC-" },
      "items": [ { "id": "INC-1", "source": "S1", "quote": "INC-1 database failover cost 3000", "value": "3000" } ] }
  ]
}
```

The example's `incidents.log` holds exactly one `INC-` row (`INC-1 database failover
cost 3000 won`), so one item is the complete set; a second row would make the
boundary report `OMITTED` until it is submitted.

- **Item ID format.** `id` is the identifier printed in the source row, such as
  `INC-42`. A source whose records print no identifier cannot back `enumerate` or
  `count`; leave it unmeasured and say so.
- **Boundary.** Every source line that starts with `linePrefix` (after leading blanks)
  is one row; its ID runs to the first whitespace, or to `delimiter` (at most 8
  characters). This is an anchored literal rule: no regular expressions. The declared
  `source` is the **measurement scope**, never a claim about all sources. A `lookup`
  may declare a boundary too: its item must then be a boundary row and its quote must
  lie in that row; other rows are not omissions. Without a boundary, a lookup whose ID
  appears on several rows of its source is `AMBIGUOUS_ROW`; every row that names the ID
  as a whole token counts, including a row that only mentions it (`INC-3 caused by
  INC-2`), so declare a boundary when other rows refer to the item.
- **Quote.** An exact span (NFKC and whitespace folded) inside **one physical row** of the
  source, containing the item ID as a whole token (`ITEM-A` is not `ITEM-AB`, `INC-1` is
  not `INC-1.2`), in a row that names that ID as a whole token too. Under a
  boundary it must lie in the item's own boundary row; a quote stitched from two rows
  fails.
  A quote may not start or end inside a number of the source (`3` in `3000`, `1` in
  `1,23`, `3000` after a minus sign): that would ground a clipped number.
- **Numeric input contract.** `value` and `claimed` are nonblank JSON **strings**, for
  counts too (`"claimed": "3"`, `"9700"`, `"0.5"`, `"9007199254740993"`). Any JSON number
  is refused (`INVALID_ITEM`, `INVALID_NEED`): the JSON parser would already have rounded
  a large integer or a long fraction such as `3.0000000000000001` before the check saw it.
  Blanks, arrays, booleans and `null` ground nothing.
- **Value.** Must equal exactly one number token of the quote after the need's item IDs
  are removed as whole tokens. A non-numeric `lookup` value is a label: it must occur in
  the quote as a whole word (`approved` is not found in `unapproved`). Write a Korean
  label exactly as the word appears in the quote and the report, with its particle or
  ending (`승인됨`, not `승인`, when the source says `상태 승인됨`).
  A quote holding several numbers is `AMBIGUOUS_VALUE`: quote a narrower span that
  names the value. A number-only quote is `QUOTE_TOO_BARE`.
  Numbers are read as whole spans: ASCII digits, an optional leading minus, comma
  groups of three and one decimal point. A span in any other notation (`1,23`, `3e3`,
  `1.234,56`, `1_000`) is `MALFORMED_NUMBER`, never read as a prefix. Parenthesized
  negatives such as `(5)` are not recognized as negative; keep them out of quotes.
- **Bindings.** In task mode each need carries `requirementRevision`, and the file
  carries `task`, `workspace` and `constraintsRevision`. Read all of them from the
  check's own output (`--format json`, `evidence.requirements` and `evidence.identity`)
  after the requirements are final. In `--req` mode a need carries `requirementSha256`
  (SHA-256 of the requirement description, NFKC and whitespace folded); duplicate IDs in
  the requirements file abort.

## What counts as reported

The report body (the sources section is ignored) must show the result in a paragraph
that **names the requirement ID**, on the rows it checks:

- `enumerate`: a line naming each item ID.
- `compute` and `lookup`: a line naming the item ID **and** its value, plus, for
  `compute`, the **recomputed** total on the declared aggregate line (below). The line
  must name no other item ID of the same need: `INC-1 5,500 and INC-2 3,000` or a table
  row `| INC-1, INC-2 | 5,500 / 3,000 |` pairs values with IDs only by position, so it
  is never value evidence. A label value must appear as a whole word.
- **Nested IDs.** A dot followed by a digit continues an ID, so the row `INC-1.2 30` never
  names `INC-1` and a paragraph about `REQ-1.2` is not about `REQ-1`, whether or not
  `INC-1.2` is submitted; a sentence-ending dot (`INC-1.`) ends the ID. Other nested IDs,
  such as `C++` and `C` or `A(1)` and `A`, are told apart only when both are submitted
  items of the same need: those are matched longest first.
- `count`: the count on the declared aggregate line.
- A count or total is read from **one declared line**. The need's `reportPrefix` (for
  example `"합계"` or `"Total cost"`) names the label that starts it. In the requirement's
  paragraphs exactly one line may start with that prefix (after a list marker or the
  requirement ID) and name none of the need's item IDs, and what follows must hold exactly
  one supported number (citations and dates are ignored). No match, several matches, no
  number, several numbers or a different number all fail; a component row or another
  labelled number (`Budget 7`) is never aggregate evidence. The check output shows the
  selected line (`aggregateLine`) so a reader sees what was matched. `count` and `compute`
  need `reportPrefix`; without it the need fails with `PREFIX_MISSING`.

Item IDs and the requirement ID (as whole tokens, so `INC-1` never leaves the `2` of
`INC-12`), Markdown citations (`[3]`) and dates are removed first,
so their digits cannot stand in for a value. The total comes from the items; the model's
`claimed` is only compared with it and never trusted.

## Findings

`EMPTY_EVIDENCE` `UNKNOWN_REQUIREMENT` `INACTIVE_REQUIREMENT` `STALE_REQUIREMENT`
`STALE_TASK` `STALE_SOURCE` `SOURCE_MISSING` `INVALID_SOURCE` `SOURCE_TOO_LARGE`
`MALFORMED_NUMBER` `INVALID_NEED` `INVALID_ITEM` `INVALID_BOUNDARY` `EMPTY_BOUNDARY` `OMITTED`
`UNKNOWN_ITEM` `DUPLICATE_ITEM` `AMBIGUOUS_ROW` `QUOTE_NOT_SUPPORTED` `VALUE_MISSING`
`VALUE_NOT_NUMERIC` `VALUE_NOT_IN_QUOTE` `AMBIGUOUS_VALUE` `QUOTE_TOO_BARE`
`CLAIM_MISSING` `COUNT_MISMATCH` `ARITHMETIC_MISMATCH` `VALUE_MISMATCH` `NOT_IN_REPORT`
`PREFIX_MISSING` `AMBIGUOUS_AGGREGATE` `AGGREGATE_NOT_SINGLE_NUMBER` `AGGREGATE_MISMATCH` `NO_NEED` `NO_ACTIVE_REQUIREMENT` — defects. `UNMEASURED` (no boundary),
`UNSUPPORTED_OPERATION` and `MANUAL` — unmeasured: not defects, but never a pass.

Exit `0` only when every need is consistent and no finding exists; `1` for any finding;
`2` for unreadable or malformed input. `--cover` defaults to **every active requirement**,
so a missing need fails (`NO_NEED`); `--cover ID,ID` narrows the check to the named
requirements and the output lists the active requirements left **outside this check**.
An empty selection fails.

## Limits

Each file is checked as a regular, non-symlink file (leaf `lstat`, then `O_NONBLOCK`,
`O_NOFOLLOW` where the platform has it, and `fstat` on the open descriptor) and read at
most 4 MiB. A source `path` is resolved against the directory of the needs file and
must stay inside it: a path that leaves it (`../x.log`, an absolute path elsewhere) or
passes through a symbolically linked directory below it (compared with `realpath`) is
`SOURCE_MISSING`. The `--needs`, `--req` and `--report` paths themselves get only the
leaf checks. These checks run before the open, so a link swapped in between can still
be followed; on Windows, which has no `O_NOFOLLOW`, that holds for the leaf as well.
Sources together at most 16 MiB and 20 files; at most 100 needs and 2000 items; a
boundary at most 2000 items (more is refused, not measured in part); a quote at most
2000 characters; a boundary line at most 4096 characters; a decimal at most 40
characters. Characters here are UTF-16 code units (JavaScript string length), so a
character outside the Basic Multilingual Plane counts twice. Beyond a limit the input
is refused, never truncated.

Only the need's item IDs and the requirement ID are removed before values are read.
Digits inside any other identifier still count as numbers: a `lookup` of `INC-1` with
value `1.2` passes when its quote and report row read `INC-1 refers to INC-1.2`, and
`INC-1 see INC-12`, `TICKET-12` or `v2` lend `12`, `12` or `2` the same way. When rows
carry such identifiers, submit them as items of the same `enumerate`, `count` or
`compute` need so they are removed too; a `lookup` takes one item, so back it with a
boundary and a person's reading of the `evidence.review` pairs.

## What `consistent` does not prove

`mechanicalResult: "consistent"` means the submitted items agree with the supplied
source bytes, the declared boundary and the report paragraphs. It does **not** show that
the source is the **whole population**, that a quote means what the item claims, that a
number token is the intended quantity, or that the work was authorized: a quote match is
**not authorization**, and `runtime/TASKS.md` stays the authority for requirements and
their withdrawal. A later correction inside the source (two rows for one ID, under a
boundary or, for a lookup, anywhere in its source) is reported as `AMBIGUOUS_ROW` and
left to a person. `--format json` lists every quoted item under
`evidence.review`; read them. Record the outcome through `jst task assess` as a
reviewed judgment, never as machine proof.
