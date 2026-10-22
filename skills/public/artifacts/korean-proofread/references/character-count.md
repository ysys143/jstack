---
name: korean-character-count
description: Count Korean text deterministically with exact grapheme, line, and byte contracts for self-intros and form limits.
license: MIT
metadata:
  category: writing
  locale: ko-KR
  phase: v1
---

# Korean character counting

## What this skill does

Count Korean text deterministically without LLM estimates when character limits
matter, such as personal statements, applications, and free-text forms.

- Characters: Unicode extended grapheme clusters via Intl.Segmenter.
- Lines: CRLF, LF, CR, U+2028, and U+2029 each count as one line break.
- Default bytes: actual UTF-8 encoded length.
- Compatibility profile: neis byte rules.

## When to use

- "이 자기소개서 1000자 넘는지 정확히 세줘"
- "이 텍스트를 UTF-8 byte 기준으로 계산해줘"
- "줄 수랑 byte 수도 같이 알려줘"
- "한글/영문/이모지 섞인 문장을 추정 말고 코드로 세줘"

## Why this skill exists

A one-character difference can matter. LLM estimates are not reproducible.
Do not arbitrarily trim or normalize input; apply only the documented contract.

## Contracts

### `default` profile

- characters: `Intl.Segmenter("ko", { granularity: "grapheme" })`
- bytes: `Buffer.byteLength(text, "utf8")`
- lines: empty string => `0`; otherwise line-break sequence count + `1`.
- Count CRLF as one line break, not two.

### `neis` profile

- Characters and lines match default.
- Bytes: Hangul grapheme => 3B; ASCII grapheme => 1B; line-break sequence => 2B.
- Other characters fall back to UTF-8 byte length.

## Prerequisites

- Node 18+.
- scripts/korean_character_count.js included in the installed payload.
- No API key.

## Workflow

1. Receive text directly or read it from a file or STDIN.
2. Run node scripts/korean_character_count.js for deterministic counts.
3. Select the profile (default/neis) and output format (json/text).
4. Return the result unchanged and identify the counting contract.

## CLI examples

```bash
node scripts/korean_character_count.js --text "가나다"
node scripts/korean_character_count.js --text $'첫 줄\r\n둘째 줄🙂'
node scripts/korean_character_count.js --text $'첫 줄\n둘째 줄🙂' --profile neis --format text
node scripts/korean_character_count.js --file ./input.txt --profile default
cat input.txt | node scripts/korean_character_count.js --stdin --profile neis
```

## Response policy

Use helper output without estimating. Show the selected profile; use default
unless the recipient explicitly requires NEIS/school-record counting rules.

## Done when

- Character, line, and byte counts are returned together.
- Differences between default and neis contracts are explicit.
- node scripts/korean_character_count.js --help works.
- Tests cover mixed Korean/Latin text, spaces, newlines, and emoji.

## Notes

- Unicode grapheme clusters: https://www.unicode.org/reports/tr29/
- WHATWG Encoding Standard: https://encoding.spec.whatwg.org/
- Node Buffer.byteLength: https://nodejs.org/api/buffer.html
