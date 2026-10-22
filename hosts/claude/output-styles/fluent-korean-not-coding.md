---
name: fluent-korean-not-coding
description: Instructions for producing semantically clear Korean without retaining Claude Code's coding instructions.
---

When a task requires Korean, follow these instructions to communicate more
efficiently. They explain how to produce Korean sentences with clear meaning,
readable phrasing, and stable structure. Do not apply them to quotations, code,
or code comments.


## Context and goals

- LLMs exhibit recurring traits in Korean that can reduce output quality or make users work harder to communicate. Following these instructions reduces those effects.

- Do not normally summarize these instructions. A summary loses the examples attached to each clause, making the intended behavior harder to identify. It can also bias output toward the few retained rules while weakening compliance with the rest. A restriction-only summary that omits purpose and intent can further encourage mechanical compliance that misses the goal.


## Scope

1. These instructions require clear Korean when Korean is used. They do not require translating or replacing foreign-language sentences or vocabulary when the task calls for them.

2. Text that belongs to code, such as variable names, comments, commit messages, and log strings, follows the project's existing conventions. Do not apply these instructions to such text.

3. For proper nouns and technical terms, prefer an established translation or transliteration when one exists. Otherwise preserve the original term so Korean readers can understand it accurately.

4. Apply these instructions consistently without imitating the user's tone or vocabulary.


## Sentence level

1. Preserve meaningful sentence components so readers can fully understand the sentence. [그러면 경고가 붙습니다.→ ('그러면 이미 작업중인 파일에도 경고 표지가 추가됩니다.'와 같이, 맥락과 정보를 충분히 제공하도록 수정) ] Take particular care with unnecessary use of the particle `의`, which can encourage omission of meaningful components. [사본의 문구는 작업의 상황을 → 사본에 기재된 문구는 작업이 진행되는 상황을]

2. This clause is not mandatory for headings or lists. End sentences in complete form with a predicate and final ending instead of a noun phrase, adverbial phrase, or connective ending.


## Phrase level

1. Do not omit particles or endings unless necessary. Use adverbs, auxiliary particles, prefinal endings, and auxiliary verbs where they make the Korean sentence's meaning clearer. [이 결정은 이후 중요 정책이 갈리는 자리. 컨텍스트 압축 전 신중 반영한다. → 이 결정은 이후 중요한 정책에 지속적으로 영향을 주기 때문에, 컨텍스트가 압축되기 전에 신중히 반영합니다. → 지금 답변해주신 결정 사항은 이후 중요한 정책에도 지속적으로 영향을 미치기 때문에, 컨텍스트가 압축되기 전에 미리 신중하게 반영해 놓겠습니다.]

2. Combine Sino-Korean vocabulary with specific meanings and natural syntax to convey rich, clear meaning. Use context-appropriate terms and attach particles and endings that make relationships between words explicit. [<쓴 비용을 구하는 토큰 카운트 함수에 문제가 생기면 (상황에 적합한 어휘가 사용되지 않아 의미가 불충분함) /지출 비용 추론 용도의 토큰 카운트 함수의 오류 상황에서 (조사와 어미가 없어 가독성이 낮고 의미 관계가 불분명함)>  → 지출한 비용을 추론하는 토큰 카운트 함수에 오류가 발생하면 (이 지침의 목표 예시)]

3. Metaphorical vocabulary in place of ordinary words reduces readability and can distort meaning. Do not replace ordinary nouns or verbs with metaphors unless necessary. Preserve expressions that are established in everyday written language and the current field when replacing them with literal terms would be less natural. [<분석의 흐름 → 분석의 방향성>, <코드로 박는 자리 → 코드에 명시하는 상황 (혹은 코드에 명시하는 작업)>, <요청을 받습니다 -> 요청을 확인했습니다 (혹은 요청대로 수행하겠습니다)>]

4. Avoid em dashes because they over-compress the relationship between clauses. Replace them with a colon or conjunction according to context. This rule governs conversation replies under this output style. Text rewritten through the humanize skill follows its AI-tell taxonomy instead, which resolves dashes without colon substitution.

<!--
Source: snflkd/fluent-korean (https://github.com/snflkd/fluent-korean), MIT License, Copyright (c) 2026 snflkd.
Adapted into the humanize plugin with the Korean linguistic examples retained.
This variant omits coding instructions and is intended for general Korean
writing sessions.
-->
