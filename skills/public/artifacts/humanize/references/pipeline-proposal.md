# Pipeline: Research Proposal Review

Review argument, persuasion, and methodology in academic proposals and grant
applications from a reviewer's perspective. Based on Adam Przeworski and Frank
Salomon's *The Art of Writing Proposals* (SSRC, 1988/1995).

## Language detection

- If the user or proposal uses **Korean**, conduct the entire review in Korean.
- For **English**, respond in English.
- If the proposal is English but the user asks in Korean, retain original
  quotations and respond in Korean.

## The reviewer's three core questions

Every reviewer seeks these answers, consciously or otherwise:

1. **What new knowledge will this project produce?**
2. **Is that knowledge worth acquiring?**
3. **How will we know the conclusions are valid?**

Use these as the master diagnosis before detailed auditing.

## Review modes

| Mode | Trigger | Action |
|------|---------|-------------|
| **full-review** | "제안서 검토", "full proposal review" | Run all 6 passes and produce a structured report |
| **section-review** | "방법론 섹션 검토", "서론 확인" | Apply every pass to one section |
| **targeted** | "도입부 수정", "payoff 강화" | Run only the relevant pass |
| **interactive** | "같이 개선해줘" | Work through sections with before/after explanations |
| **draft-assist** | "제안서 작성 도와줘" | Guide each section using the framework |

Default to **full-review** when ambiguous.

## Six audit passes

Apply in order.

### Pass 1: Opening impact — does it command attention?

Only the first paragraph, at most the first page, is guaranteed a reading.

**Checklist:**

- [ ] Does the opening immediately state the core question, hypothesis, or interpretation before background?
- [ ] Is the question substantive rather than rhetorical, with no self-evident answer?
- [ ] Will readers remember something after reading it?
- [ ] Is the central point clear and forceful rather than buried in qualifications?

**Common failures:**

- Opening with broad background ("자고로 학자들은...").
- Stating a topic instead of a question ("이 프로젝트는 X를 연구한다").
- Leading with caveats and conditions before the claim.
- Vague framing such as "~를 탐구하고자 한다".

**Revision principle:** Open with the core question or hypothesis in one or two sentences.

### Pass 2: Clarity — can a multidisciplinary panel understand it?

Reviewers are not specialists in the narrow subfield.

**Checklist:**

- [ ] Is disciplinary jargon minimized and unavoidable terminology explained?
- [ ] Does the text emphasize ideas over methodological machinery?
- [ ] Are incidental technical details moved to appendices so they do not obstruct the argument?
- [ ] Can a scholar from a neighboring field follow the central argument?

**Flag:** Every passage requiring specialist knowledge. Suggest plain-language
restatement or a brief explanation.

### Pass 3: Context — does it establish a knowledge gap?

Show both what is known and what remains unknown.

**Checklist:**

- [ ] Is current knowledge summarized accurately and concisely, with focus rather than exhaustive coverage?
- [ ] Are references current and comprehensive? Missing central work signals poor preparation.
- [ ] Is the gap between existing knowledge and the proposed contribution explicit?
- [ ] Does the literature review build an argument rather than list publications?

**Common failure:** Listing prior studies without arguing why the gap matters.

### Pass 4: Value — is importance argued or merely asserted?

Assertions of importance alone do not persuade reviewers.

**Checklist:**

- [ ] Is the theoretical contribution explicit?
- [ ] Is value argued with evidence and reasoning rather than treated as self-evident?
- [ ] Is timeliness or practical relevance connected to an enduring intellectual problem?
- [ ] Does the proposal acknowledge alternative perspectives?

**Flag:** "X matters because nobody has studied it" without an argument for why it deserves study.

### Pass 5: Methodology — an argument or a task list?

The methodology must argue that the proposed work is the best feasible approach
to the problem.

**Checklist:**

- [ ] Are specific research activities identified: archives, interviews, datasets, analytical techniques?
- [ ] Does methodology argue why these tasks occur in this order, rather than merely listing A, B, and C?
- [ ] Are both data collection and interpretation in relation to the central question explained?
- [ ] In comparative designs, are cases selected to illuminate the central question?
- [ ] Is mastery of every required skill demonstrated, or is a plan to acquire it given?

**Warning phrases:**

- "X와 Y의 관계를 살펴볼 것이다": what concrete work does that entail?
- "1차 자료를 분석할 것이다": which archive and which analysis?
- "인터뷰를 실시할 것이다": with whom, how many, and under what protocol?

### Pass 6: Objectives — does the argument close the loop?

A well-structured proposal returns to its opening question.

**Checklist:**

- [ ] Does the conclusion explicitly connect research procedures to the opening question?
- [ ] Does it explain how to tell whether the hypothesis is correct or incorrect?
- [ ] Is the final output specified: article, book, or dissertation?
- [ ] Does it remain open to the results rather than presupposing them?

## Output format

### full-review and section-review

The following is the Korean output template; follow the language rules above.

```
## 제안서 리뷰: [제목 또는 설명]

### 마스터 진단 — 심사위원의 세 가지 질문
1. 무엇을 알게 되는가? → [명확 / 불명확 / 누락 — 한 문장 평가]
2. 알 가치가 있는가? → [명확 / 불명확 / 누락]
3. 결론이 어떻게 검증되는가? → [명확 / 불명확 / 누락]

### 종합 평가
[2~3문장: 주요 강점, 주요 약점, 전체적인 설득력]

### Pass 1: 도입부 임팩트 — [효과적 / 개선 필요 / 심각한 문제]
[원문 인용과 구체적 수정 제안 포함한 발견 내용]

### Pass 2: 명료성 — [효과적 / 개선 필요 / 심각한 문제]

### Pass 3: 맥락 — [효과적 / 개선 필요 / 심각한 문제]

### Pass 4: 가치 — [효과적 / 개선 필요 / 심각한 문제]

### Pass 5: 방법론 — [효과적 / 개선 필요 / 심각한 문제]

### Pass 6: 목표 — [효과적 / 개선 필요 / 심각한 문제]

### 우선순위 수정 사항 Top 5
[심사위원의 세 가지 질문에 대한 영향도 순으로 정렬]
```

## Severity

- **CRITICAL:** Directly fails one of the three reviewer questions; rejection is nearly certain without revision.
- **MAJOR:** Substantially weakens persuasion, such as a buried opening, task-list methodology, or merely asserted importance.
- **MINOR:** Worth improving without threatening the core argument, such as small clarity issues or missing citations.

## Constraints

- **Never change scientific or intellectual content.** Improve how the argument is communicated.
- **Respect disciplinary conventions.** Hypothesis and methodology norms vary; confirm the target funder and discipline.
- **Be specific.** Every criticism requires an original passage and a concrete revision. Do not merely say "strengthen the methodology" without showing how.
