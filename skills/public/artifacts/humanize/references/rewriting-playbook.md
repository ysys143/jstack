# Korean Rewriting Playbook

Executable replacement recipes for the rewriter agent, expanding each pattern's
prescription in `ai-tell-taxonomy.md` into actual edits based on detection reports.

## 0. Prime directives

1. **Fidelity:** Preserve facts, claims, numbers, proper names, quotations, and
   causal relationships character for character. Never fill ambiguities by guessing.
2. **Tone match:** Keep formal input formal and essays as essays. Do not change genre.
3. **Locality:** Do not rewrite all sentences at once. Edit only detected AI-tell passages.
4. **Naturalness before perfection:** Avoid overly literary revisions. Aim for
   the typical rhythm of everyday Korean writers.
5. **Span-grounded edits:** Bind every change to a detection-report span. Do not
   edit undetected passages.

   A span is evidence, not an edit boundary. Rules prescribing deletion and
   restatement (D-2 stock phrases, D-1 conclusion openings, C-8 contrasts) cannot
   be fixed by replacing only a keyword. Rewrite the syntactic unit containing
   the span. Locality means targeting detected defects, not minimizing character range.

   Evidence from the 2026-08-30 ablation: all 6 of 6 runs replaced only `지평`
   with `길` in `새로운 지평을 열 것으로 기대된다`, retaining the stock frame
   `~을 열 것으로 기대된다`. The no-plugin baseline rebuilt the construction
   every time (`범위를 넓히는 데 기여할 것으로 본다`) and scored higher. The
   recipe was correct, but directives 3 and 5 overrode it.

   Criterion: if readers still recognize the stock phrase after replacement,
   the defect is not fixed.
6. **Over-polish alarm:** Changing at least 50% of all sentences suggests content
   damage. `scripts/verify_gates.js` (`change_rate` SSOT), not rewriter self-report,
   determines the edit-rate verdict.
7. **Remove only; no new tells (v0.4.0):** AI-tell vocabulary is a removal target.
   Never insert stock phrases absent from the original, such as `괄목할 만한`,
   `주목받았다`, or `의미가 크다`. Replacing vivid original language with stock
   phrasing reverses the goal.
8. **Strip the staging, keep the claim (dodaeri port):** A structural tell (an
   antithesis, a closing punch, an aphorism, decoration) is packaging. Remove the
   packaging and keep the claim, information, greeting, or feeling it carried as a
   plain sentence. Delete a whole sentence only in the deletion cases that
   `direct.md` lists: chatbot residue (D-15), staging with no claim behind it
   (D-2, D-8–D-10, D-12, C-14, C-15, C-17), a repetition of the sentence right
   before it, or a deletion a genre rule names.
9. **Keep commitment strength (dodaeri port):** Do not turn `~해야 한다` into
   `~한다`, `~일 수 있다` into an assertion, or a hedge into a claim. Vary the
   surface of repeated modality instead. This is immutable item 8 in
   `register-invariants.md`.

## 1. Replacement recipes by category

### A. Translationese recipes

| Original pattern | Rewrite example |
|-----------|----------|
| X에 대해 논의한다 | X를 논의한다 / X를 이야기한다 |
| X를 통해 Y한다 | X로 Y한다 / X해서 Y한다 / X함으로써 Y한다 |
| X에 있어서 | X에서 / X를 볼 때 / X에서는 |
| X라는 점에서 | X해서 / X라는 이유로 / X이기 때문에 |
| X와 관련하여 | X에서 / X에는 / X를 두고 |
| X에 기반하여 / X을 바탕으로 | X로 / X를 근거로 / X를 보고 |
| 경쟁력을 가지고 있다 | 경쟁력이 있다 / 경쟁력이 강하다 |
| 판단되어진다 | 판단된다 / 판단한다 |
| AI에 의해 생성된 | AI가 만든 |
| 높일 수 있다 | 높인다 (사실 서술일 때) / 높일 여지가 있다 (가능성일 때) |
| X을 위해 Y한다 | X하려고 Y한다 / X하도록 Y한다 |
| 합의가 이루어졌다 | 합의했다 / 합의에 이르렀다 |
| 기술 발전 속도 가속화 | 기술의 발전 속도가 빨라진다 |
| 그리고 (문두) | (삭제) / "-고" 연결어미로 압축 |

### B. English quotations and terminology

- **Preserve terminology (v0.4.0):** Do not mechanically translate standard development/AI terms such as `API`, `prompt`, `token`, `agent`, or `pipeline`. Category B targets promotional buzzwords (seamless, robust, leverage), repeated parenthetical translations, and showy English unsuitable for the audience. Ask whether readers find the original term more natural than its translation.
- **Parenthetical English:** For general readers, include English only at the first occurrence, then use Korean. For specialists, retain English where useful without repeating it every time.
- **Common English replacements:**
  - pipeline → 파이프라인 (retention allowed) / 흐름 / 공정
  - framework → 체계 / 틀 / 구조
  - leverage → 활용하다 / 기대다 / 끌어올리다
  - seamless → 매끄러운 / 끊김 없는
  - robust → 튼튼한 / 견고한
  - scalable → 확장성 있는
  - insight → 통찰 / 눈 / 시사점
  - impact → 영향 / 파장
  - holistic → 전체적 / 총체적
- **English quotations:** If the original nuance matters, retain it with a Korean translation. Otherwise paraphrase in Korean and footnote the source.

### C. Structural recipes

- **Mechanical parallelism, "첫째/둘째/셋째":**
  - If enumeration is central, vary markers with "우선 / 이어서 / 마지막으로".
  - If decorative, integrate it into prose: "A다. B도 마찬가지다. 여기에 C가 더해진다."
- **Bullet-to-prose example:**
  - Original:
    ```
    - 속도가 빠르다
    - 비용이 저렴하다
    - 확장성이 높다
    ```
  - Rewrite: "속도는 빠르고 비용도 낮다. 무엇보다 확장 여지가 크다."
- **Remove headings:** In essays and columns, remove headings at H2 level or above and rely on paragraph flow.
- **Break formulaic topic-sentence openings:** Begin some paragraphs with scenes, numbers, or questions.
- **Remove all emoji** in essays and reports. They may remain in product copy or social media.
- **C-8 negative contrast (v0.4.0; strongest measured signal):** Retain only 1 in a series of "단순히 A가 아니라 B다" and turn the rest into direct statements. "A가 아니라 B" → "B가 핵심이다" softens exclusivity while preserving meaning. Never eliminate all contrasts: removing every one from an original with 5+ triggers verify_gates P2 FAIL.
- **C-11 commas after connective endings (v0.4.0):** Remove commas in "-고,/-지만,/-면서,". Split with periods when the sentence is too long.
- **C-9 numeric indexing / C-10 colon headings / D-7 transformation formulas (v0.4.0):** Integrate 1 into prose and vary the rest / use a single noun phrase as the heading, preserving academic section titles / replace "X에서 Y로" with a direct statement.
- **C-8 strawman test (dodaeri port):** Keep a contrast whose A the reader actually holds. Rewrite it when nobody holds A: "단순한 도구가 아니라 동료입니다" → "동료처럼 일을 나눠 맡습니다" (only when the source supports the content). Do not use "A라기보다 B"; it is itself a C-8 surface form.
- **C-13 forced triplets:** Keep the items the source supports; never add a third item for rhythm.
- **C-14 closing punch:** Delete a final sentence that only restates the paragraph ("차이는 분명합니다."). Merge staccato fragments ("변명 없이. 핑계 없이.") into one sentence with a predicate.
- **C-15 / C-17 restated headings and self-description:** Delete "## 성능" → "성능이 중요합니다." and "아래 표는 ~를 비교한 것입니다"; start from the first informative sentence.
- **C-16 small tables:** "| A | B |" comparisons of two or three items become one or two sentences. Never change the data.
- **Preserve C-1, I-1, and A-2 by default (v0.4.0 recalibration):** Humans use 첫째/둘째 enumeration, "것이다" endings (fewer than 3 consecutive), and "통해" (1–2 occurrences). Unconditional removal damages text.

### D. Stock phrases (prefer deletion)

| Removal target | Alternative |
|----------|------|
| 결론적으로 | (삭제) — 마지막 문단 자체가 결론이므로 라벨링 불필요 |
| 요약하면 / 정리하자면 | (삭제) 또는 "한 줄로 말하면" |
| ~라고 할 수 있다 | ~이다 (단언 가능하면) / ~로 보인다 (관측이면) |
| 매우 중요하다 | 구체 근거로 대체: "X 없이는 Y가 성립하지 않는다" |
| 시사하는 바가 크다 | (삭제) 또는 "의미는 분명하다" |
| 주목할 만하다 | (삭제) — 이미 문장이 주목하게 만드는 내용이면 불필요 |
| 혁신적인 / 획기적인 | 대부분 삭제. 필요하면 "처음 시도한" / "이전과 다른" 같이 구체화 |
| ~의 지평을 열다 / ~시대가 도래했다 | 삭제 후 실제 변화를 서술 |
| 본질은 ~다 / 결국 중요한 건 ~다 (D-8) | 문단이 뒷받침하는 구체 주장으로 바꾼다 |
| 자, 그럼 살펴볼까요? / 솔직히 말하면? (D-9) | (삭제) 바로 본론 |
| 오해하지 마세요 / ~라고 생각하실 수도 있지만 (D-10) | 없는 반론을 지우고 주장만 남긴다 |
| 앞으로가 더 기대됩니다 / 중요한 전환점 (D-11) | (삭제) 마지막 구체적 사실에서 끝낸다 |
| 과제도 남아 있다 / 한계도 분명하다 (D-12) | 원문이 말하는 실제 과제를 바로 쓴다. 없으면 삭제 |
| ~하는 이유다 / 결국 ~로 이어진다 (D-13) | 그래서 ~다 |
| 청사진 / 적신호 / 신호탄 / 뿌리내리다 (D-14) | 계획 / 경고 / 첫 사례 / 자리 잡다 |
| 좋은 질문입니다! / 도움이 되셨길 바랍니다 (D-15) | (삭제) 감싼 내용은 남긴다. 인사·맺음말·서명은 그대로 둔다 |
| 전문가들은 ~라고 말합니다 (G-4) | 주장은 남기고 출처를 만들지 않는다. `[출처 확인 필요]` 표시 |

### E. Rhythm

- **Input analysis:** The detector calculates mean sentence length and standard deviation.
- **When uniformity is detected:**
  - Join adjacent sentences so that one paragraph carries one long sentence, and keep a short sentence only where it delivers a new fact. Do not add a short restating sentence such as "그게 핵심이다."; that is a C-14 closing punch.
  - Allow 1 long sentence of 80+ characters.
- **Vary endings:** Do not repeat one ending across 4–5 consecutive sentences. Mix "~다 / ~았다 / ~인 것" and nominal endings.

### F. Modifiers

- Delete 90% of degree adverbs ("매우", "정말", "대단히") by default. Use concrete numbers or comparisons when emphasis is necessary.
- Keep only one modifier in synonymous pairs such as "중요하고 핵심적인".
- Replace "~적 / ~성 / ~화" suffixes with concrete verbs or nouns.
  - "근본적 변화" → "뿌리부터 바뀐다"
  - "구조적 문제" → "구조가 문제다" / "구조 자체가 문제다"

### G. Hedging

- **Collapse stacked hedges to one:** "~할 수 있을 것으로 보인다" → "~할 것으로 보인다" / "어느 정도 ~할 수도 있을 것으로 보입니다" → "~할 수 있습니다". Keep exactly one hedge of the source's strength.
- **Do not assert a hedged claim.** Turn a hedge into an assertion only when the source itself supplies the evidence that settles it. For repeated "~로 보인다 / ~로 판단된다", vary the ending ("~로 본다", or a stated basis) instead of removing the hedge. Do not vary into "~인 듯하다", which G-1 also lists.
- In medical, legal, and policy writing, the hedge is part of the meaning. Keep it and collapse only stacked hedges.

### H. Conjunctions

- With 3 or more consecutive sentence-initial conjunctions, delete 70%.
- Delete most "또한" occurrences. When necessary, vary with "여기에", "거기에", or "더해".
- Delete "따라서 / 그러므로" when causality is obvious; otherwise use "그래서" where appropriate.
- Alternate repeated "하지만 / 그러나", or replace one with "그런데".

### I. Formal nouns

- Connect the ending directly instead of using "것이다".
  - "변화가 크다는 것이다" → "변화가 크다"
- "~할 필요가 있다" → "~가 필요하다". Do not weaken it to "~할 만하다"; use "~해야 한다" only when the source states an obligation.
- **I-7 focus frames:** "중요한 것은 X라는 점이다" → "X가 중요하다"; "핵심은 X다" → state X directly.
- **I-8 administrative verbs:** Replace "확대·강화·개선·확보·마련·구축" with the action the source describes ("교육 과정 강화" → "교육 시간을 주 2회로 늘림" only when the source says so). Without a concrete action in the source, keep the verb.
- Make "~이 필요하다" concrete with a subject and verb: "혁신이 필요하다" → "이 회사가 제품을 다시 만들어야 한다", when context permits.

### J. Decoration

- **Bold:** Remove nearly all body bold; allow it only in contents and heading-level text.
- **Quotation marks:** Limit to quotations and special usages.
- **Em dashes (—):** At most 1–2 per document. Replace others with commas, parentheses, or separate sentences.

### L. Abstract metaphors (prefer concrete replacements)

Remove the metaphor and restore its concrete referent: axis, criterion, number, or relationship. If a replacement is ambiguous, identify the intended dimension from the original context. Leave cases covered by each rule's **Keep** exception unchanged.

| Original metaphor | Concrete rewrite |
|-----------|----------------|
| 가정이 무너진다 | 가정이 성립하지 않는다 / (security) 뚫린다 |
| A와 B가 맞물린다 | A가 B의 조건이다 / A가 B를 전제한다 (state causality/combination) |
| 승패를 가른다 | 승패를 정한다 / 승패는 ~에 달렸다 / 둘로 나뉜다 |
| 모델이 무겁다 | 추론 지연이 크다 / 메모리를 40GB 쓴다 (specify the dimension) |
| 갈리는 지점 | 갈리는 대목 / 부분 / 곳 |
| ~라는 축에서 | ~라는 기준에서 / 원인에서 / 항목에서 |
| 여러 겹의 의미 | 의미가 세 층으로 나뉜다 / 뜻이 두 가지다 |
| 성능의 손잡이 | 성능을 조절하는 값 / 이 값으로 성능을 조정한다 |
| 사실상 표준 | (retain if an established de facto term) / 표준 |
| ~한 셈이다 | ~했다 (state ordinary conclusions directly) / (retain when closing a metaphor) |
| 논의의 결이 다르다 | 논의의 방향이 다르다 / 성격이 다르다 / 톤이 다르다 |

- **Decision priority:** Do not rewrite candidates the detector marked `kept`, such as physical handles, actual coordinate axes, or "말의 무게". Apply the table only to flagged `findings`.
- **Specify the dimension:** For "무겁다/가볍다", identify memory, latency, size, or training volume from the original context and state it concretely or parenthetically. Without contextual evidence, do not invent details; mark "사람 확인 요망".

## 2. Monitor edit rate

- Record edit rate as **Levenshtein distance / original length** between before and after text.
- Recommended range: 5–30%.
- Above 30%: possible overediting; review again.
- Below 5%: possible underediting; recheck for remaining S1 patterns.

## 3. Replacement risks (Do-NOT list)

Preserve these even when they resemble AI tells, because changing them changes meaning:

- Technical proper names, products, and models (GPT-4, Claude 3, Gemini, etc.).
- Numbers, units, and dates.
- Directly quoted sentences inside double quotation marks.
- Quotations of legal or regulatory provisions.
- Necessary academic terminology, such as "확률적 앵무새" or "창발".

## 4. Genre adjustments

| Genre | Allowed | Disallowed |
|------|------|------|
| Column/essay | Short sentences, personal voice, literary metaphor | Emoji, excessive headings or bullets |
| Report | One heading level, statistics, quotations | Excessive emoji, hype vocabulary |
| Blog post | Friendly tone, questions | Mechanical "첫째/둘째" formulas |
| Public speech/congratulatory address | Formal written register | Colloquial language, emoji, bullets |

Infer genre from the first 100 input characters, then apply this table's boundaries.

### Genre details (dodaeri port)

`references/direct.md` owns the destination and genre defaults for mail, notices,
business replies, training material, LinkedIn posts, and reports. Pipelines that
rewrite those genres apply the same defaults.

## 5. Repeated rewriting

- After the first rewrite, remaining S1/S2 findings from the naturalness reviewer trigger a second rewrite.
- At most 3 iterations. Mark passages still unresolved afterward as "사람이 직접 확인 요망" in the report.
