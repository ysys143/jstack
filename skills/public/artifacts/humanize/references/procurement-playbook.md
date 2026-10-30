# Public Procurement Rewriting Playbook

Recipes for converting K–O findings from `procurement-taxonomy.md` into text edits. This serves the same role for public procurement as `rewriting-playbook.md` does for general humanization.

## 0. Highest principles

1. **Fidelity first:** Preserve requirement IDs, RFP numbers, numeric values, fixed technology-stack values, and standard versions character for character.
2. **Permit mixed registers:** Do not replace everything with exploratory research prose. Separate functions: **commitments use `-한다`; structural descriptions use `-함/됨`**.
3. **Preserve genre:** Do not turn a proposal into a research paper. Preserve audit and acceptance readiness (`감리·검수 대응성`).
4. **Prevent overediting:** Warn above 25% edit rate; force a stop above 40%.

## 1. Replacement recipes by category

### K-1. Resolve repeated `본 컨소시엄은`

#### Pattern 1-1. Requirement-response context
```
[전] 본 컨소시엄은 {REQ-ID}을 {방식}으로 설계한다.
[후] {REQ-ID} 요구사항에 대응하여, {기능명}은 {방식}으로
     설계함.
```

#### Pattern 1-2. Consecutive differentiators
```
[전] 본 컨소시엄은 차별화 요소 1을 ~한다.
     본 컨소시엄은 차별화 요소 2를 ~한다.
     본 컨소시엄은 차별화 요소 3을 ~한다.

[후] 차별화 요소 1은 ~로 설계됨.
     차별화 요소 2는 ~로 구성됨.
     차별화 요소 3은 ~로 구현됨.
```

#### Pattern 1-3. Preserve necessary responsibility statements
- Never remove every occurrence. Retain 1–2 per chapter.
- Legal commitments such as `본 컨소시엄은 ~을 확약한다` and `본 컨소시엄은 ~에 대한 모든 책임을 진다` are required.

### K-2. Resolve inconsistent endings

#### Separate registers by function
| Sentence function | Preferred ending |
|---|---|
| Strategy/commitment statement | `-한다 / -이다 / -확약한다` |
| Structure/item description | `-함 / -됨 / -있음` |
| Numeric values/criteria | `-이다 / -다` |
| Operations/procedure description | `-함 / -됨` |
| Interpretation after a table | `-함 / -됨` |

#### Worked correction
```
[전] {장애}를 방지하는 방향으로 설계함.
     {패턴명}으로 구현한다.
     재시도 간격은 1회차 1분이다.
     
[후] (preserve functional separation)
     {장애} 방지를 목표로 설계함.            [structure -> -함]
     구체 구현은 {패턴명}을 적용한다.        [commitment -> -한다]
     재시도 간격은 1회차 1분으로 고정한다.  [criterion -> -한다]
```

### K-4 / N-2. Replace `본 표는 ... 정리함`

```
[전] 본 표는 {대상}을 정리함.
     **[표 {CH}-1] {대상} 내역**

[후] {대상}은 역할과 적용 범위가 서로 다르므로, 항목별
     구분하여 제시할 필요가 있다. 주요 내역은 다음과 같다.

     **[표 {CH}-1] {대상} 내역**

     이 표에서 보듯이 {핵심 관찰}.
```

### L-1. Correct requirement IDs used as subjects

#### General pattern
```
[전] {REQ-ID}은 {방식}으로 설계됨.
[후] {REQ-ID} 요구사항에 대응하여, {기능명}은 {방식}으로
     설계됨.
```

#### Alternative: parenthesize the ID after the function name
```
[전] {REQ-ID}은 단일 진입점으로 구현됨.
[후] {기능명}({REQ-ID})은 단일 진입점으로 구현됨.
```

#### When a requirement ID must introduce the subject
```
[후] 본 {REQ-ID}이 요구하는 {기능명}은 {사업 내 위상}이다.
```

### M-1. Wrap captions in bold

Example of batch detection/replacement with grep:
```
Detection regex: ^\[표 (.+?)\] (.+)$
Replacement: **[표 $1] $2**
```

Bold figure captions only when emphasis is needed.

### M-2. Replace endings outside the head-noun set

| Outside the set | Replacement within the set |
|---|---|
| ~ 근거 | ~ 목록 / ~ 종합 |
| ~ 발췌 | ~ 핵심 구문 요약 |
| ~ 6종 / ~ 9항목 | ~ 목록 |
| ~ DAG | ~ 흐름 (move to a figure) |
| ~ 하이라이트 | ~ 요약 |
| ~ 관련 내용 | ~ 요약 / ~ 체계 |

### M-4. Restore caption boundaries

```
[전] **[표 {CH}-N] {주제}**는 {해설 문장}이다.

[후] 다음과 같이 {주제}를 요약한다.

     **[표 {CH}-N] {주제} 요약**

     | ... |

     {주제는} {해설}을 포함한다.
```

### N-3. Convert C3 subjectification to C1/C2

#### C1 conversion (before the table)
```
[전] **[표 N]**은 {대상}을 정의한다.
[후] {대상}은 다음과 같이 정의한다.
     **[표 N] {대상} 매트릭스**
```

#### C2 conversion (after the table)
```
[전] 표에서 보듯이 {A}는 {역할}을 담당한다.
[후] 위 [표 N]에 따르면 {A}는 {역할}을 전담한다.
```

### N-4. Add figure captions to code fences

#### Step 1: Insert a caption
```
[전]
     ```
     [노드 A]
        |
        v
     [노드 B]
     ```

[후]
     [그림 {CH}-2] {주제} 흐름

     ```
     [노드 A]
        |
        v
     [노드 B]
     ```
```

#### Step 2: Introduction and reading guidance
```
[후]
     {서술로 먼저 구조 설명}. 이를 도식화하면 다음과 같다.

     [그림 {CH}-2] {주제} 흐름

     ```
     [ASCII]
     ```

     상단은 {A}, 중앙은 {B}, 하단은 {C}를 나타낸다.
```

### O-1. Convert vague expressions to definite commitments

Apply these replacements only to commitments the proposer has confirmed (O-1); mark an unconfirmed possibility for the author instead.

| Disallowed | Replacement |
|---|---|
| ~할 수 있다 / ~할 수 있음 | ~한다 |
| 가능하다 / 가능함 | 수행한다 / 지원한다 |
| ~할 수 있을 것으로 기대된다 | ~을 확보한다 |
| ~에 기여할 것으로 보인다 | ~에 기여한다 |
| ~의 가능성이 있다 | ~을 수행한다 (or delete) |
| ~을 고려하고 있다 | ~을 적용한다 (when confirmed) |
| ~을 지향한다 | ~을 목표로 한다 |
| 사료됨 | 판단한다 (with evidence) |

Preserve exceptions where the RFP explicitly requires `설계·검토·적용검토` (design, review, or applicability review).

### O-2. Replace external SaaS (public-institution internal-network principle)

| Disallowed | Replacement |
|---|---|
| Jira / Jira Risk Register | 내부 이슈관리 시스템 / 위험관리 이력 대장 |
| Confluence | 공유 드라이브 또는 내부 문서관리시스템 |
| Slack | 승인된 내부 알림 채널 |
| PagerDuty | 고우선 관제 알림 체계 |
| GitHub / GitHub Actions | 내부 Git 저장소 / 내부 CI/CD 파이프라인 |

An optional `site-rules.yaml` can define project-specific replacements.

### O-3. Replace cloud-specific service names

| Original type | Neutral wording |
|---|---|
| Specific public-cloud storage tier name | 장기보관 계층 / 자주 접근 계층 |
| Specific GPU instance type | 고성능 GPU 노드 (vCPU/메모리/GPU 스펙 명시) |
| Specific object-store implementation | S3 호환 오브젝트 스토리지 |

Exception: proper names are allowed for compared alternatives and reference implementations.

### O-5. Remove decisions fixed before evaluation

| Pattern | Replacement |
|---|---|
| Definite choice of embedding model | {평가 요구사항 ID} 평가 후 확정하는 임베딩 후보 |
| Definite choice of LLM model | 평가 후 확정하는 LLM 후보 |
| Definite dimension/numeric value | 평가 후 확정하는 {파라미터} |

## 2. Do-NOT list

Never change these elements, even when detected:

- **Requirement IDs:** preserve exactly, including SFR/CNR/PER/DAR and project-specific systems.
- **RFP item numbers:** `1호·2호·3호`, `①②③`, `(가)(나)(다)`, etc.
- **Standard version numbers:** framework, database, and API-standard versions.
- **Numbers, units, amounts:** project costs, schedules, FP/MM, quantitative metrics.
- **Fixed numeric boundaries:** performance SLAs, accuracy thresholds, etc.
- **Proper names:** organizations, people, products, and models (O-5 exception).
- **Double-quoted quotations:** preserve every enclosed character.
- **Legal/notice provisions:** article numbers and text.
- **Fixed technology-stack tables:** version tables declared as the project baseline.

## 3. Monitor edit rate

- Count changed characters per category.
- Overall edit rate = changed characters / total characters * 100.
- Warning threshold: **25%**; stop threshold: **40%**.
  - Stricter than general mode's 30/50 thresholds because proposals require conservative editing.

## 4. Allowances by genre/section

| Proposal section | Special allowance |
|---|---|
| Overview/company introduction | Relax bold-overuse limits; retain some emphasis |
| Strategy/methodology | Allow some canonical sentences (L-3); boundary definitions are referenced throughout the document |
| Technical/functional details | Allow dense tables as evidence of requirement coverage |
| Performance/quality | Allow concentrated numeric tables; at least 1 interpretation sentence is required |
| Project management | Recommend at least 2 organization-chart/WBS figures |
| Project support | Fully resolve K-1 in differentiator items |
| Appendices/other | Watch M-3 numbering: appendix and body numbering can become mixed |

## 5. Required rewriting order

1. **O:** Hard Rule violations first; they directly reduce evaluation scores.
2. **M:** Direct effects on scan-based review.
3. **L:** Semantic errors.
4. **K:** Style consistency.
5. **N:** Discourse rhythm.
6. If needed, apply **general-mode A–J** to remaining translationese, AI stock phrases, and related tells.
