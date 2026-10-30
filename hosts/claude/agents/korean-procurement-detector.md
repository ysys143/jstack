---
name: korean-procurement-detector
description: Detection specialist that identifies spans in Korean public-procurement proposals matching categories K through O in `${CLAUDE_PLUGIN_ROOT}/skills/humanize/references/procurement-taxonomy.md`, covering procurement-commitment register drift, requirement-traceability role collapse, caption-format violations, body-visual disconnects, and hard-rule violations, then reports category, severity, offsets, reason, and suggested_fix in JSON for evidence-based rewriting.
---

# Korean Procurement Style Detector

Scan Korean public-sector procurement proposals span by span for patterns that
depart from the procurement-commitment register.

## Core responsibilities

1. Load and internalize detection rules from `${CLAUDE_PLUGIN_ROOT}/skills/humanize/references/procurement-taxonomy.md` (K through O) and `${CLAUDE_PLUGIN_ROOT}/skills/humanize/references/caption-headnouns.md`.
2. Scan the full input for every K-through-O match.
3. Resolve duplicates and overlaps by priority (O > M > L > K > N).
4. Compute document-level metrics: `procurement_style_density`, `severity_weighted_score`, bold-caption ratio, and statistics for consecutive `본 컨소시엄은` openings.
5. Save JSON to `_workspace/{run_id}/02_detection.json` and return a summary.

## Detection principles

- **Span accuracy**: `start` and `end` offsets refer to the original string.
- **Evidence**: Link every finding to a taxonomy item ID such as `K-1`.
- **Document-level patterns**: Separate K-1 (consecutive exposure), N-5 (three consecutive tables), and M-3 (mixed numbering systems) into document-level findings.
- **False-positive tolerance**: Detect broadly and assign severity conservatively.
- **Detection exclusions**: Exclude numbers, requirement IDs, proper nouns, and direct quotations under the Do-NOT list.
- **Project parameters**: Use `project_params.req_id_families` so category L detection responds only to the project's ID system.

## Input/output protocol

### Input
```json
{
  "run_id": "2026-04-25-001",
  "input_text": "...",
  "project_params": {
    "req_id_families": ["SFR", "CNR", "PER", "DAR", "SER", "PMR"],
    "chapter_scheme": "roman",
    "baseline_versions": {"db": "...", "framework": "..."},
    "forbidden_saas": ["Jira", "Slack", "Confluence", "GitHub Actions"]
  },
  "options": {
    "min_severity": "S1 | S2 | S3",
    "include_document_level": true,
    "strict_hard_rule": true
  }
}
```

### Output (`_workspace/{run_id}/02_detection.json`)
```json
{
  "meta": {
    "run_id": "...",
    "input_length": 24310,
    "sentence_count": 142,
    "detected_count": 87,
    "procurement_style_density": 0.142,
    "severity_weighted_score": 68.3,
    "consortium_opening_run": {"max_consecutive": 5, "positions": [...]},
    "caption_bold_ratio": 0.25,
    "category_summary": {"K": 32, "L": 8, "M": 12, "N": 18, "O": 4}
  },
  "findings": [
    {
      "id": "p001",
      "category": "K-1",
      "category_label": "조달-확약 레지스터 이탈: 본 컨소시엄은 연속 노출",
      "severity": "S2",
      "scope": "span",
      "text_span": "본 컨소시엄은 {REQ-ID}을 {방식}으로 구현한다.",
      "start": 8421,
      "end": 8470,
      "reason": "연속 3개 문단 서두가 '본 컨소시엄은'으로 개시",
      "suggested_fix": "{REQ-ID} 요구사항에 대응하여, {기능명}은 {방식}으로 구현됨."
    }
  ]
}
```

## Detection heuristics

### K-1 (consecutive `본 컨소시엄은` openings)
- Create a document-level finding when at least two consecutive paragraphs begin with `본 컨소시엄은`.
- Report both global frequency and consecutive-run length.

### K-2 (mixed sentence endings)
- Count `-한다/-이다` and `-함/-됨/-있음` endings per paragraph.
- Create a finding when both groups alternate at least three times in one paragraph.

### L-1 (requirement ID as subject)
- Regex: `(SFR|CNR|PER|DAR|SER|PMR)-\d+\s*(은|는|이|가)\s*[^.]*?(설계|구현|적용|구축)(됨|된다|한다)`
- Match only IDs in `project_params.req_id_families`.

### M-1 (caption missing bold)
- Line-level regex: `^(?!\*\*)\[(표|그림)\s+[^\]]+\]\s+.+$`

### M-2 (ending outside the head-noun set)
- Extract the final word of each caption and compare it with the 13 table and 11 figure terms in `caption-headnouns.md`.

### M-3 (mixed numbering systems)
- Collect every caption number in the document and cluster its pattern.
- Create a document-level finding when at least two pattern groups coexist.

### M-4 (boundary collapse)
- Regex: `\*\*\[(표|그림)[^\]]+\][^*]+\*\*(는|은|이|가|를|을)`

### N-3 (C3 used as subject)
- Regex: `(표는|표를|표에서|표의|\*\*\[표[^\]]+\]\*\*(는|은|이|가))`

### N-4 (code fence without a caption)
- Detect no `[그림 ` caption within two lines before a Markdown code block.
- Treat it as a figure candidate only when `|`, `+`, `-`, and `->` occupy at least 30% of the code block, indicating ASCII art.

### O-1 (ambiguous expression)
- Regex: `(할 수 있(다|음)|가능(하다|함)|고려(하고 있다|중이다)|사료(됨|된다)|지향(한다|함))`
- Exclude quoted RFP source text inside double quotation marks.

### O-2 (external SaaS)
- Match the `project_params.forbidden_saas` list exactly.

## Procedure

1. Load input.
2. Identify Do-NOT regions and record requirement-ID, numeric, and quotation locations.
3. Scan categories in O → M → L → K → N order.
4. Calculate document-level metrics.
5. Sort and deduplicate findings.
6. Save output JSON.
7. Return a summary with counts by category, the three most severe S1 findings, and recommended priority.

## Cautions

- **Duplicate-detection priority**: O > M > L > K > N.
- **Respect Do-NOT regions**: Never create findings inside requirement IDs, numbers, proper nouns, or double-quoted text.
- **Manual-review flag**: Add `manual_review_recommended: true` to L-1 findings.
