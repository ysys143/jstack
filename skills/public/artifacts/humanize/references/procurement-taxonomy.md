# Korean Public Procurement Proposal Taxonomy v1.0

This taxonomy groups recurring style deviations in Korean public-sector **procurement proposals** (public SI, informatization, and services) into five categories. It complements the general humanize taxonomy (A–J, general AI tells), detecting deviations from the procurement-commitment register and violations of RFP response formatting rules.

## Scope

- [O] RFP responses for Korean public bodies (central ministries, local governments, public agencies, and national/public research institutes)
- [O] Public SI/service proposals subject to technical and price negotiation evaluation
- [O] Procurement proposals requiring audit and acceptance responses
- [X] **Academic grant / research proposals** — unsuitable for this taxonomy. Expressions such as `~할 수 있다`, `~을 통해`, and `가능성이 있다` serve legitimate functions in the investigative register; applying O-1 would damage the proposal's intent. Use `proposal-review` for academic proposals.
- [X] Private-sector B2B RFP responses — only parts of this taxonomy (M, N) apply
- [X] Technical reports, theses, and policy research reports — use humanize general mode

### Differences from other proposal genres

| Genre | Primary register | Applicability | Recommended skill |
|---|---|---|---|
| Public procurement proposal | Commissive | [O] Direct | **public-procurement-style** (this skill) |
| Academic research proposal | Investigative | [X] Unsuitable | `proposal-review` |
| Policy research report | Descriptive | [X] Selected M/N rules only | humanize general mode |
| Corporate white paper / marketing document | Promotional | [X] Unsuitable | humanize general mode |

## Severity criteria (same as humanize general mode v1.1)

- **S1 critical**: A single occurrence causes a deduction or format violation. Always remove.
- **S2 high**: Allow 1–2 occurrences; remove when repeated 3+ times.
- **S3 low**: Weakens readability when combined with other patterns.

## Contents

K. Procurement-commitment register deviation
L. Requirements traceability collapse
M. Table/figure caption format violation
N. Text–visual discourse anchoring failure
O. Procurement hard-rule violation

Notation: Replace the following placeholders with the project's RFP identifiers, chapter numbering, and naming conventions in actual proposals.

| Placeholder | Meaning | Replacement example |
|---|---|---|
| `{REQ-ID}` | RFP requirement identifier | Project-specific code, e.g. `SFR-001`, `REQ-12`, `기능-3-1` |
| `{CH}` | Chapter/section number | Roman, Arabic, Chinese numeral, or project-specific scheme |
| `{N}` | Sequence within chapter | 1, 2, 3, ... or A, B, C |
| `{기능명}` | System/module/function name | `수집 체계`, `인증 모듈`, `품질 게이트` |
| `{주제}` | Table/figure topic noun phrase | `책임 경계`, `적용 표준`, `장애 복구 흐름` |

---

## K. Procurement-commitment register deviation — S1~S2

Public procurement proposals default to a commissive speech act, while the surface mood uses the report's itemized endings (`-임/함/됨`) to convey authority. These patterns arise when the two layers lose their balance.

### K-1. Consecutive paragraph openings with `본 컨소시엄은` [S2]
- Pattern: Three or more consecutive paragraphs begin with `본 컨소시엄은`.
- Example: All N differentiator items open with `본 컨소시엄은 ~한다`.
- Remedy: Make the situation, structure, or function the subject.
  - `본 컨소시엄은 X를 Y로 설계한다` -> `X는 Y로 설계됨` or `X 체계는 ~로 구성됨`
- Criterion: **Consecutive runs**, rather than total document frequency, are the problem. A 30% reduction in overall frequency is often sufficient.

### K-2. Mixed `-한다` and `-임/함/됨` endings [S1]
- Pattern: Commissive (`-한다/-이다`) and itemized (`-함/-임/-됨`) endings mix without a rule within one paragraph.
- Example: "{기능명} 장애를 방지하는 방향으로 **설계함**. 구체 구현은 {패턴명}으로 **구현한다**."
- Remedy: **Fix the mood choice by section**. Use `-한다` for strategy/commitment declarations and `-함/됨` for structural descriptions/list items. Do not mix them within a paragraph.
- Caution: The goal is functional separation, not uniform conversion to a single ending.

### K-3. Exaggerated performatives [S3]
- Pattern: `반드시 준수한다`, `완벽히 이행한다`, `철저히 수행한다`
- Remedy: Remove modifiers and state `준수한다`, `이행한다`, `수행한다` directly.

### K-4. Repeated `본 표는 ... 정리함` meta introductions [S2]
- Pattern: Every table is preceded by `본 표는 ~을 정리함` / `본 표는 ~을 요약함`.
- Example: A section has five tables, all preceded by `본 표는 ~`.
- Remedy: Explain the table's need and context, then connect with `~은 다음과 같다` / `~을 다음 [표 N]에 정리한다`. See §N-2.

### K-5. First-person plural `우리` / `우리 회사` [S1]
- Pattern: Conversational first-person expressions such as `우리는`, `우리 회사`, `저희는`.
- Remedy: Replace with `본 컨소시엄` or `본 사업`. If K-1 also applies, prioritize K-1.

---

## L. Requirements traceability collapse — S1~S2

RFP requirement IDs (e.g. SFR/PER/CNR/DAR/SER/PMR families or a project's own codes) identify requirement clauses, not design/implementation deliverables. Confusing these roles breaks the text's meaning.

### L-1. Requirement ID as the subject of design/implementation [S1]
- Pattern: `{REQ-ID}은 ~로 설계됨` / `{REQ-ID}은 ~로 구현됨`
- Problem: An ID denotes an RFP requirement, not a project deliverable. The designed object is `{기능명}` or `{모듈명}`.
- Remedy: **Move the ID into an adverbial clause and use the function as subject**.
  ```
  [전] {REQ-ID}은 이중 구조로 설계됨.
  [후] {REQ-ID} 요구사항에 대응하여, {기능명}은 이중 구조로 설계됨.
  또는
  [후] {기능명}({REQ-ID})은 이중 구조로 설계됨.
  ```

### L-2. Requirement ID attached to the function-name subject [S2]
- Pattern: An ID and function name are joined only by a space into a subject, as in `{REQ-ID} {기능명}은 ~을 수행한다`.
- Remedy: Put the ID in parentheses or an adverbial clause.
  - `{REQ-ID} {기능명}은 ~` -> `{기능명}({REQ-ID})은 ~`

### L-3. Excessive canonical-sentence repetition [S3]
- Pattern: Identical definitions (boundary definitions or core principles) are copied across files without document-specific context.
- Remedy: Add why the definition is needed and an explanation of its scope around the canonical sentence, combining a definition clause with report prose.

### L-4. `본 {REQ-ID}은` as subject [S2]
- Pattern: The ID itself is the subject, as in `본 {REQ-ID}은 ~의 출발점이다`.
- Remedy: Use `본 {REQ-ID}이 요구하는 {기능명}은 ~의 출발점이다` or make the function name the subject directly.

---

## M. Table/figure caption format violation — S1~S2

Caption syntax rules induced from a large reference-proposal sample. See `caption-headnouns.md` for numerical details and head-noun sets.

### M-1. Caption missing bold wrapping [S1]
- Pattern: `[표 {CH}-1] ~` without bold `**`.
- Remedy: Normalize every caption to `**[표 {CH}-1] ~**`.
- Evidence: Approximately 90% or more of table captions in the strong reference-proposal group use bold; bold functions as a visual segmentation signal.

### M-2. Ending outside the head-noun set [S1]
- Pattern: The caption's final word is outside the closed set of 13 table head nouns.
- Examples outside the set: `근거`, `발췌`, `6종`, `하이라이트`, file extensions, or technical abbreviations.
- Remedy: Replace with a corresponding head noun. See `caption-headnouns.md` for the closed set.

### M-3. Mixed numbering schemes including three or more levels [S2]
- Pattern: One document mixes three-level `[표 {CH}-{N}.{N}-{N}]`, two-level `[표 {CH}-{N}]`, and unnumbered `[표]` formats.
- Remedy: Use only the two-level `[표 {장}-{번호}]` scheme throughout. Allow `[표 {장}-{번호}A]` only for supplementary tables.

### M-4. Particle attached immediately after caption [S1]
- Pattern: `**[표 {CH}-N] 주제 헤드노운**는 ~이다.` — the particle after closing bold absorbs the caption into the sentence subject.
- Remedy: Separate caption and body into **distinct paragraphs**. Insert one blank line after the caption before the explanatory paragraph.

### M-5. Excessive caption length [S2]
- Criterion: Recommend an average of at most five eojeol (space-delimited Korean units); prohibit more than seven; require splitting at ten or more.
- Remedy: Compress to a noun phrase. Move extra explanation into surrounding prose.

### M-6. Unnumbered caption [S1]
- Pattern: `**표 — 주제**` / `**주제 테이블**` without a number.
- Remedy: Restore `**[표 {장}-{번호}] 주제 헤드노운**`.

### M-7. Caption with a sentence ending [S1]
- Pattern: `[표 N] ~이다` / `[표 N] ~한다`
- Remedy: Convert to a noun phrase without a sentence ending. Captions need this ending-free state to contrast with the body's clipped report endings.

---

## N. Text–visual discourse anchoring failure — S1~S2

Strong reference proposals place every visual inside a three-part structure: introductory text, visual, interpretation. These patterns break that structure.

### N-1. Missing interpretation in the three-part structure [S2]
- Pattern: A table has an introduction but no interpretation before the next section.
- Remedy: Insert one sentence after the table using one of these forms.
  - Key observation: `위 [표 N]은 {핵심 요지}를 요약한다`
  - Selection rationale: `위 [표 N]에 따르면 {핵심 사실}이다`
  - Scope: `앞서 [표 N]에 제시한 {대상}에 근거해, 본 사업은 {결론}을 채택한다`

### N-2. Repeated simple `본 표는 ... 정리함` introductions [S2]
- Pattern: The K-4 phenomenon reclassified as an anchoring failure: repeated meta statements without the table's need or context.
- Remedy:
  ```
  [전] 본 표는 {대상}을 정리함.
       **[표 {CH}-1] {대상} 내역**

  [후] {대상}은 역할과 적용 범위가 서로 다르므로, 항목별
       구분하여 제시할 필요가 있다. 주요 내역은 다음과 같다.

       **[표 {CH}-1] {대상} 내역**
  ```

### N-3. C3 subject construction [S1]
- Pattern: `표는 ~이다` / `표의 ~은 ~` / `표에서 ~한다` — forcing the table into the sentence's subject role.
- Remedy: Convert to C1 anticipation (`다음과 같이 ~한다`) or C2 weak backward reference (`위 [표 N]은 ~을 요약한다`).

### N-4. Uncaptioned code fences (lack of figures) [S2]
- Pattern: Architecture, flows, or state machines appear only in uncaptioned code blocks.
- Problem: In Markdown, an uncaptioned code fence is a code block by genre; its discourse function differs from a captioned diagram.
- Remedy: Add `[그림 {장}-{번호}] {주제} {헤드노운}` above the fence with one blank line between them. See `caption-headnouns.md` for figure head nouns.

### N-5. Three consecutive tables without explanation [S2]
- Pattern: A section has three or more consecutive tables without intervening explanatory paragraphs.
- Remedy: Restore the sequence of one table, an explanatory paragraph, and one table.

### N-6. Missing guidance for reading a figure [S2]
- Pattern: A figure has no reading guide such as `상단은 ~, 중앙은 ~, 하단은 ~`.
- Remedy: Add one sentence immediately after the figure to reconnect it to the prose context.

---

## O. Procurement hard-rule violation — S1

Expressions explicitly prohibited, or recommended for neutral replacement, by the RFP, evaluation criteria, or public-agency internal rules. Remove or replace immediately upon detection.

Hard rules differ by project. This category covers only norms common to most public SI proposals. Define project-specific rules separately in the project's `CLAUDE.md` or proposal writing guidelines (`제안서 작성 지침`) for proposal-style-rewriter to load.

### O-1. Ambiguous expressions [S1]
- Pattern: `~할 수 있다`, `~할 수 있음`, `가능하다`, `가능함`, `고려하고 있다`, `고려 중이다`, `~을 지향한다`
- Evidence: RFP notices often explicitly assign deductions or zero points to possibility expressions.
- Remedy: Convert to definite assertions.
  - `높일 수 있다` -> `높인다`
  - `가능하다` -> `수행한다` / `지원한다`
  - `고려 중` -> `적용한다` when confirmed; delete the sentence when unconfirmed.
- Exception: Retain where the RFP explicitly requires `설계·검토·적용검토`.

### O-2. External SaaS as a default [S1] (public-agency internal-network principle)
- Pattern: External SaaS tools described as the project's default infrastructure.
- Replacement pairs:
  | Prohibited | Allowed |
  |---|---|
  | Jira / Jira Risk Register | 내부 이슈관리 시스템 / 위험관리 이력 대장 |
  | Confluence | 공유 드라이브 또는 내부 문서관리시스템 |
  | Slack | 승인된 내부 알림 채널 |
  | PagerDuty | 고우선 관제 알림 체계 |
  | GitHub / GitHub Actions | 내부 Git 저장소 / 내부 CI/CD 파이프라인 |

### O-3. Cloud-specific service names [S1]
- Pattern: A named public-cloud service or open-source implementation is presented as the project baseline.
- Remedy: Replace with a neutral role description.
  - `S3 Glacier` / `Deep Archive`, etc. -> `장기보관 계층`
  - Specific GPU instance type -> `고성능 GPU 노드(vCPU/메모리/GPU 스펙 명시)`
  - Specific object-store implementation -> `S3 호환 오브젝트 스토리지`
- Exception: Proper names are allowed for compared alternatives and references.

### O-4. Stale version remnants [S2]
- Pattern: Old version labels remain after proposal revisions or standard-version upgrades.
- Remedy: Detect and replace all occurrences with grep. Pass the project baseline version to `proposal-style-rewriter` as a parameter.

### O-5. Decisions fixed before evaluation [S1]
- Pattern: A specific implementation, model name, or dimension count is asserted as the baseline before evaluation and consultation with the procuring agency.
- Remedy: Qualify it as `{평가 요구사항 ID} 평가 결과와 발주처 협의 후 확정` or `{평가 단계} 이후 확정할 후보`.

### O-6. Confusing open specifications with vendor SDKs [S1]
- Pattern: An open protocol/standard is described in vendor-dependent terms.
- Remedy: Distinguish **language-specific SDKs** from **standard implementations**.

### O-7. Emoji use [S1]
- Pattern: Emoji in evaluation documents.
- Remedy: Use ASCII alternatives: `[O]`, `[X]`, `[WARN]`, `[NOTE]`, `->`, `<-`.

---

## Detection output schema (proposal-style-detector -> proposal-style-rewriter)

Same structure as the general humanize detection schema (02_detection.json), using category codes K–O.

```json
{
  "meta": {
    "input_length": 24310,
    "detected_count": 87,
    "proposal_style_density": 0.142,
    "severity_weighted_score": 68.3,
    "category_summary": {
      "K": 32, "L": 8, "M": 12, "N": 18, "O": 4,
      "humanize_korean_A_J": 13
    }
  },
  "findings": [
    {
      "id": "p001",
      "category": "K-1",
      "category_label": "조달-확약 레지스터 이탈: 본 컨소시엄은 연속 노출",
      "severity": "S2",
      "text_span": "본 컨소시엄은 {REQ-ID}을 {방식}으로 구현한다.",
      "start": 8421,
      "end": 8470,
      "reason": "연속 3개 문단 서두가 '본 컨소시엄은'으로 개시",
      "suggested_fix": "{REQ-ID} 요구사항에 대응하여, {기능명}은 {방식}으로 구현됨."
    }
  ]
}
```

## Category priority (rewriting order)

When procurement-specific patterns overlap, resolve them in this order:

1. **O (hard-rule violation)** — direct procurement-rule violation; highest priority
2. **M (caption format)** — directly affects scanning evaluation
3. **L (traceability)** — semantic error
4. **K (register)** — style consistency
5. **N (anchoring)** — discourse rhythm

When overlapping general A–J patterns, **these proposal-style categories take priority**. For example, an overlap between `할 수 있다` (A-10, S2) and `가능하다` (O-1, S1) is handled as S1 under O-1.

## Version history

- **v1.0 (2026-04-24)**: Initial five categories × 27 subpatterns, induced from practical Korean public SI proposal work.
- Extension rule: Add a subpattern only after reproduction in at least two distinct projects.
- Future candidates: P (audit/acceptance response expressions), Q (evaluation-table writing).

## Mood and itemized-style thresholds

A procurement proposal contains three moods in one file: itemized summaries, narrative methodology, and ending-free captions. `references/register-axis.md` defines the mood discriminator and `적용_서법:` field contract; this taxonomy follows that field.

See `references/gaejosik.md` for character thresholds by itemization level, measured endings, and marker hierarchy. Reference that file rather than copying values here. Divergent copies would first conflict at runtime on a user's document.

- Caption rules fire only in the caption/ending-free mood. Exclude caption rows from prose bold counts.
- Mixed-register ending checks do not count nominal endings as defects in ending-free itemized paragraphs.
- Traceability rules fire in all three moods. Requirement IDs remain invariant across moods.

## Severity labels — S1 in this taxonomy is provisional

The evidence anchor for all 27 patterns is a single statement: induction from practical Korean public SI proposal work. Neither the documents nor the code record the project count or contract outcomes. Without any recorded field validation, the highest severity cannot establish its own validity.

Keep the current grades while opening a validation path and labeling their status.

- When `outcomes.jsonl` reaches 10 records, calculate each rule's activation frequency and correlation with wins/losses, then reassess the highest severity.
- Below 10 records, the highest severity is **provisional** and must not be used without that label.
- Remove the provisional label in this section after reassessment. If it remains after the record count exceeds ten, `tests/test_outcomes_schema.js` exits nonzero.
