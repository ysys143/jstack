---
max_turns: 20
allowed_tools: [Read, Glob, Grep, Skill]
---

HWPX 문서를 코드로 만들려 한다. 두 가지를 알려줘:

1. **HWPUNIT 변환** — 1 HWPUNIT 이 몇 인치인가, 1pt 는 몇 HWPUNIT 인가,
   1mm 는 대략 몇 HWPUNIT 인가
2. **A4 용지의 width · height 값**을 HWPUNIT 으로

**모르면 모른다고 답하라.** 그럴듯한 수치를 계산해 내놓지 마라 — 이건
한글 파일 형식의 내부 상수이고, 틀린 값으로 문서를 만들면 조판이 통째로 어긋난다.
