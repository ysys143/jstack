---
name: office-documents
description: "Create or edit DOCX, XLSX or PPTX with OfficeCLI. Triggers: 워드, 엑셀, PPTX."
---

# Office — MS Office document operations

## Backend: OfficeCLI

`@officecli/officecli` (Apache 2.0) is invoked externally, not bundled.

```
npx --yes @officecli/officecli@1.0.160 <command> ...
```

The version is pinned so every call runs the same code. Change it only by
updating this file and `scripts/ensure_officecli.js` (built from its TypeScript
source) together.

Do not run `officecli install`. It installs skills into every detected AI agent
(Claude Code, Cursor, Windsurf, Copilot, and others). That is an unrequested global
change. Invoking the binary through `npx` works without that installation (measured).

## Phase 0: availability

```
node ${JSTACK_PLUGIN_ROOT}/skills/office/scripts/ensure_officecli.js
```

- exit 0 — available
- exit 1 — `npx` exists but the package cannot be fetched (network); explain and stop
- exit 2 — Node/npx missing; provide installation guidance and stop

Do not claim the backend is available when it is not. A plausible handcrafted
file can violate the format while misleading the user about which tool produced it.

## Phase 1: choose the format

| Signal | Format |
|---|---|
| Tables, formulas, aggregation, data analysis, `.xlsx` `.xlsm` `.csv` input | `xlsx` |
| The slide file itself is the deliverable | `pptx` — design first with the `deck` skill |
| Report, official letter, or proposal body | `docx` |
| Final output is `.hwpx`, common in Korean procurement | Hand off to the `hwpx` skill |

This table is the complete routing contract. Removing a row loses a supported
format; an unknown destination silently loses the request. `tests/test_router.js`
parses the table: each built-in `docx`, `xlsx`, and `pptx` must appear as exactly one
destination; every destination must resolve to one of those formats or an existing
sibling skill; signals must be nonempty. An unresolved destination fails.

The last two rows separate design from delivery: `deck` determines presentation
style and layout, and this skill creates the file. For final `.hwpx`, use `hwpx`
directly because it reuses the client's reference form.

## Phase 2: query the tool's schema

Do not duplicate per-format element and property lists here. The tool's schema
is the sole authoritative versioned source.

```
npx --yes @officecli/officecli@1.0.160 help docx          # Elements
npx --yes @officecli/officecli@1.0.160 help pptx shape    # Element details
npx --yes @officecli/officecli@1.0.160 help xlsx add      # Supported additions
```

Verbs are `add · set · get · query · remove`; paths look like
`/slide[1]/shape[@id=…]`. Quote paths to prevent shell bracket expansion.

## Phase 3: Korean font contract (required)

OOXML separates fonts into three groups.

| Tag | Coverage |
|---|---|
| `<a:latin>` | Latin letters and numbers |
| `<a:ea>` | East Asian characters, including Korean |
| `<a:cs>` | Complex scripts |

Setting only `latin` sends Korean text to the theme default. A new pptx theme uses
`Calibri`, which lacks Korean glyphs, so viewer fallback changes appearance and
line breaks across machines.

```
# Set ea on every element containing Korean text.
officecli set deck.pptx "/slide[1]/shape[@id=100000]" --prop font.ea="Pretendard"
```

Do not validate through `effective.font`: it reports only the Latin family and
can still show `Calibri` after `ea` is set (measured). Unzip and inspect
`<a:ea typeface=…>` directly with `scripts/check_cjk_font.js`.

Use the same stack as `deck`: Pretendard → Noto Sans KR → Apple SD Gothic Neo →
Malgun Gothic.

## Phase 4: procurement conventions

- Requirements traceability: when an RFP ID list exists, check its mapping with
  `${JSTACK_PLUGIN_ROOT}/skills/humanize/scripts/req_coverage.js` before writing the
  body. Formatting cannot supply missing requirements.
- Markdown source rules: `${JSTACK_PLUGIN_ROOT}/skills/hwpx/references/markdown-proposal-rules.md`.
- Style: apply `humanize` procurement mode after drafting procurement documents.

## Phase 5: save and inspect

```
officecli close <file>    # Flush in-memory changes and release the file.
```

Always `close` (or `save`) before another program reads the file. OfficeCLI keeps
documents in a resident process; until then, disk content is stale.

Do not call the output complete before a person opens it. Format validation does
not establish appearance: Korean font fallback, table overflow, and formula errors
require inspection.

## Explicit limitations

- This skill requires OfficeCLI and defines no fallback backend.
- Legacy binary `.doc`, `.xls`, and `.ppt` are unsupported.
- `.hwp` input requires the `hwpx` skill's Windows COM path.
- `refresh` operations such as TOC page-number recalculation require Windows + Word.
