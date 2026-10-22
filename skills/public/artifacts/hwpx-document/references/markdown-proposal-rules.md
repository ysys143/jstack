# Markdown Proposal Rules

## Reference Style

- Reuse `Contents/header.xml`, first-section `secPr`, and `colPr` from the reference HWPX.
- Named styles take priority over hardcoded fallback IDs.
- Treat the following names as defaults from one known proposal standard, not as universal requirements. For a new standard, infer equivalent styles from the reference or ask using `style-intake.md`.
- Expected proposal styles when present:
  - Body paragraph: `내용 위계 1`
  - Unordered list: `내용 위계 2`
  - Ordered local list: `(1)`
  - Major headings: `2.`
  - Second-level numbered headings: `2.1`
  - Third-level numbered headings: `2.1.1`
  - Table cells: `표 내용`
  - Captions: `표 캡션`, `그림 캡션`

## Markdown Mapping

- Pipe tables become real HWPX `hp:tbl` objects.
- Fenced code blocks that contain grid-like pipe tables are promoted to real tables.
- Normal fenced code stays non-bullet `Code` style when available.
- `*text*`, `**text**`, and `***text***` are unwrapped as plain text.
- Markdown links and image placeholders preserve their display text only.
- `1. text` and `1) text` become `(1) text` and use the `(1)` named style.
- For proposal work, use `--preserve-heading-numbers` so `3.1` and `3.1.1` headings can map to `2.1` and `2.1.1` styles.
- Use `--roman-to-arabic` when source headings contain values such as `Ⅲ-1`; it converts visible text outside fenced code blocks.

## Table Rules

- Table width must not exceed the reference page body width.
- Column widths are weighted by cell text length and normalized to the table width.
- Header and body cells both use named style `표 내용` when present.
- Table colors and borders are inferred from real reference tables when possible.
- Table anchor paragraphs and blank paragraphs must not use bullet paragraph styles.

## Known Limitations

- Markdown merged cells and HTML tables are not supported.
- Images are preserved as placeholder/caption text, not embedded binaries.
- Final Hancom line breaks can differ from XML estimates; visually inspect final delivery files.
