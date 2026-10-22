# Caption head-noun closed set

A closed set of table/figure caption endings induced from strong reference
proposals in public procurement. Every proposal caption must end within this set.

Evidence: more than 310 table captions and 87 figure captions from representative
proposals. The set covers about 95% of the sample. Other endings make the visual's
function harder for reviewers to identify immediately.

## Table captions: 13 head nouns

| Group | Head noun | Function | Example |
|---|---|---|---|
| Classification/comparison | 비교 / 비교 종합 / 대조 | Compare two or more alternatives | 유사 사업 기술 스택 **비교** |
| Lists/sets | 목록 / 현황 / 항목 / 대상 | Enumerate members | 적용 표준 **목록** / 대상 기관 **현황** |
| Summary/definition | 요약 / 개요 / 정의 | Compress into a higher abstraction | 핵심 요구사항 **요약** / 용어 **정의** |
| Structure/system | 체계 / 구성 / 구성표 / 구조 | Show overall organization | 보안 통제 **체계** / 시스템 **구성** |
| Matrix | 매트릭스 / 매핑 / 룰셋 | Two-dimensional relationships | RFP 요구사항 1:1 대응 **매트릭스** |
| Cases/examples | 사례 / 예시 | Representative instances | 유사 사업 수행 **사례** |
| Schedule/plan | 계획 / 일정 / 로드맵 / WBS | Time axis | 사업 추진 **일정** / 단계별 **로드맵** |
| Roles/organization | 조직도 / 역할 / 분장 | People and units | 인력 **분장** / 책임 **역할** |
| Metrics/criteria | 지표 / 기준 / 평가지표 / KPI | Numeric assessment | 품질 평가 **지표** / SLA **기준** |
| Results/track record | 실적 / 성과 / 기대효과 | Expected outcomes | 유사 사업 수행 **실적** / 기대효과 **요약** |
| Differentiation | 차별점 / 차별성 종합 | Competitive advantage | 본 사업 기술적 차별점 **종합** |
| Process/procedure | 절차 / 단계 / 과정 | Ordered workflow | 감리 대응 **절차** / 검수 **단계** |
| Details | 내역 | Itemized detail | 투입 인력 **내역** / 도입 HW **내역** |

### Disallowed endings outside the set

- `근거` (-> `목록` or `종합`).
- `발췌` (-> `요약` or `핵심 구문 요약`).
- Numeric endings `6종`, `3개`, or `9항목` (-> `목록`).
- A file extension or technical acronym alone (`DAG`, `DDL`, `YAML`, etc.): use a higher-level head noun.
- Nonstandard marketing phrases such as `하이라이트`, `관련 내용`, or `이슈사항`.

## Figure captions: 11 head nouns

| Head noun | Function | Example |
|---|---|---|
| 아키텍처 | Overall system layers | 전체 시스템 **아키텍처** / 보안 계층 **아키텍처** |
| 흐름 | Data/process sequence | 인증 처리 **흐름** / 장애 복구 **흐름** |
| 파이프라인 | Connected processing stages | 데이터 수집·적재 **파이프라인** |
| 조직도 | Personnel/unit organization | 사업 추진 **조직도** |
| 체계도 | Concept hierarchy | 품질 관리 **체계도** |
| 상태머신 | State transitions and events | 트랜잭션 **상태머신** |
| 와이어프레임 | UI/screen composition | 관리자 대시보드 **와이어프레임** |
| 구조 | Spatial/relational layout | 데이터베이스 **구조** / 네트워크 **구조** |
| 예시 | Representative instance visualization | 알림 화면 **예시** |
| 다이어그램 | General schematic | 연계 **다이어그램** |
| 프로세스 | Business/procedure flow | 이슈 대응 **프로세스** |

## Caption syntax

### Tables
```
CAPTION_TABLE := "**[표 " NUM "]" WS TOPIC WS HEADNOUN "**"
  NUM      := CHAPTER "-" INDEX
  CHAPTER  := project chapter numbering (Roman, Arabic, Chinese characters, or custom)
  INDEX    := number | one uppercase letter (supplementary table)
  TOPIC    := noun phrase (2–4 words)
  HEADNOUN := one of the 13 groups in the closed set above
```
- Length: 4–5 words recommended; more than 7 forbidden; 10 or more forbidden.
- Position: above the table, with one blank line between caption and table.

### Figures
```
CAPTION_FIGURE := "[그림 " NUM "]" WS TOPIC WS HEADNOUN [" — " AUX]
  HEADNOUN := one of the 11 head nouns above
  AUX      := optional reading hint, at most 2 words
```
- Wrap in `**` when emphasis is needed.
- Put ASCII-diagram captions above the code fence and image captions below the image.

## Fifteen text/visual integration forms (required)

### C1: Preview (one sentence before the table, required)

1. `다음과 같이 {동사}한다.` (summarize, define, classify, compare)
2. `다음 [표 N]과 같다.`
3. `다음 [표 N]에 {동사}한다.`
4. `다음과 같이 {동사}한 결과를 [표 N]에 제시한다.`
5. `본 사업의 {주제}는 [표 N]과 같다.`
6. `본 컨소시엄은 {주제}를 다음과 같이 정의한다.` (observe the K-1 frequency limit)
7. `본 사업의 {주제}를 [표 N]에 종합한다.`
8. `{주제}는 다음 {N}개 범주로 구성된다.`

### C2: Following weak reference (one sentence after the table, recommended)

9. `위 [표 N]은 {핵심 요지}를 요약한다.`
10. `위 [표 N]에 따르면 {핵심 사실}이다.`
11. `위 [표 N]에서 {핵심 축}을 확인한다.`
12. `앞서 [표 N]에 제시한 {대상}에 근거해, 본 사업은 {결론}을 채택한다.`

### C3: Forbidden subjectification

- [X] `표는 ~이다.`
- [X] `**[표 N]**는 ~이다.`
- [X] `표의 ~은 ~이다.`
