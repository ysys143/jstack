---
name: korean-proofread
description: "Check Korean spelling and spacing, count characters or bytes; no rewrites. Triggers: 맞춤법, 글자수."
---

# Proof — spelling and length measurement

## Two distinct functions

| | Character counting | Spelling check |
|---|---|---|
| Computation | Local and deterministic | Sends text to an external web service |
| Unconditionally safe? | Yes | No; see below |
| Failure mode | None | Service changes or blocking can break it at any time |

This distinction is the first contract: one function is unconditional; the other
requires consent.

## Character counting (local; no external service)

```
node -- ${JSTACK_PLUGIN_ROOT}/skills/proof/scripts/korean_character_count.js \
  --file <path> --profile default --format json
```

Choose one input: `--text`, `--file`, or `--stdin`. Output is `json` (default) or `text`.

`korean_character_count.js` is the canonical counter. It runs on the same Node.js
20+ runtime as jstack and needs no Python, network connection, or separately installed
integration. Unicode grapheme segmentation uses `Intl.Segmenter`; a visible
character can contain several code points, including combining marks or a family
emoji joined with ZWJ characters.

| Input | Invocation | Interpretation |
|---|---|---|
| Literal text | `--text <text>` | Count the supplied string without newline conversion |
| UTF-8 file | `--file <path>` | Read the complete file locally; preserve CRLF sequences |
| Standard input | `--stdin` | Count the complete input stream using the same profiles |

Select exactly one input route. CRLF counts as one line break and one grapheme;
LF, CR, U+2028, and U+2029 also count as one break each. An empty string has zero
lines. These rules apply equally to all three input routes, so moving a document
from literal text to a file does not change its submission count.

`tests/run_tests.js` exercises these routes and compares both profiles against
independent fixed expectations, including decomposed Hangul, combining marks,
emoji, and all five line-break forms. For local library use, the ESM module exports
`createReport(text, profile)`, `countLines`, `countNeisBytes`, and `countUtf8Bytes`.
Importing it does not run its command-line entry point.

Choose the appropriate profile:

| Profile | Byte calculation | Use |
|---|---|---|
| `default` | Actual UTF-8 bytes | General length checks |
| `neis` | Korean character = 3B, ASCII = 1B, newline = 2B | Public-form character and byte limits |

Public submission forms requesting a limit such as 3,000 bytes almost always mean
NEIS counting. Passing a `default` check can still exceed the submission limit.

Output includes `characters` (graphemes), `characters_without_whitespace`,
`code_points`, `utf16_code_units`, `lines`, and `bytes`. Establish which metric the
requirement means, including whether spaces count, before assessing compliance.

## Spelling check (external transmission; confirm before use)

```
node -- ${JSTACK_PLUGIN_ROOT}/skills/proof/scripts/korean_spell_check.js \
  --file <path> --consent-external-transmission
```

This command sends input text to `nara-speller.co.kr`.

Code enforces the boundary. Immediately before transmission, the script reports
the destination and amount to stderr. In noninteractive mode without
`--consent-external-transmission`, it exits 2 without networking. Interactive mode
asks for confirmation.

For library use, the gate is at `fetch_spell_check_html`, not only the CLI entry
point; direct `check_text()` calls are also blocked. Explicitly enable transmission:

```javascript
import * as k from './scripts/korean_spell_check.js';
k.allow_external_transmission();     // Otherwise raises ExternalTransmissionDenied.
const report = await k.check_text(text);
```

Calling this function constitutes consent. First ensure the user knows what will
be transmitted; the function itself does not ask.

The executable guard remains effective when prose instructions disappear through
context compaction or direct script invocation. Confidential disclosure cannot be
undone, so prose alone is insufficient.

### Required checks before use

- Do not send procurement proposals, contracts, or unpublished business content by
  default. These are common in our work; upstream treats them as exceptional, but
  here they define the default boundary.
- If transmission is needed, tell the user what will leave and obtain consent.
  Paragraph-level splitting allows selected excerpts.
- Proper names, amounts, institution names, and requirement IDs are not spelling
  targets. Redact them where possible before sending.

### Tool behavior

This script imitates a webpage, not an official API. It sets browser `User-Agent`,
`Origin`, and `Referer`, and extracts HTML with regular expressions.

- Service changes can break parsing silently. Suspect the parser first if results
  are unexpectedly empty.
- Requests are spaced 1.2 seconds apart. Do not send bulk content.
- Input is split into 1500-character chunks.

For a local alternative, `humanize` taxonomy covers some passive constructions,
translationese, and stock phrases. Local spelling and spacing require a separate
dictionary, which this skill does not include.

## Boundaries

| Task | Owner |
|---|---|
| Style, AI-tell removal, translationese, excessive passive voice | `humanize` |
| Slide layout, fonts, spacing, and line breaks | `deck` (layout); proof owns spelling |
| Requirements traceability | `humanize` procurement mode |

## Position in the workflow

Use `humanize → proof → hwpx`: correct style, check spelling and length, then typeset.
Rewriting changes length; typesetting first forces another pass over column
allocation and character counts afterward.

## Provenance

The scripts were ported from two local skills, `korean-spell-check` and
`korean-character-count`, both MIT. Their reference documents are
`references/spell-check.md` and `references/character-count.md`.

## Explicit limitations

- Spelling checks depend on an external service and do not work offline or when blocked.
- Character counting runs locally on Node.js 20+; spelling uses the external service.
- No local spelling dictionary is bundled. If transmission is disallowed, spelling
  checking is unavailable.
