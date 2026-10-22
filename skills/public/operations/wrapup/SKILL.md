---
name: wrapup
description: "Prepare daily scrum drafts and weekly reports from project activity. Triggers: 업무 정리, 주간 보고."
metadata:
  author: jstack
  version: "0.1.0"
  category: operations
  tags: [wrapup, personal-records, evidence, daily, weekly]
---

# Wrapup — 개인 기간 보고서 편의 워크플로우

이 기능의 결과는 협업 공간의 행이나 문서가 아니라, 사용자의 기록을
확인해 사용자에게 보여 주는 보고서다. `wrapup`은 개인 일·주간·사용자 지정
기간 보고서를 직접 요청했을 때 쓸 수 있는 편의 진입점 중 하나다. 기록 수집과
증거 판단은 모든 작업을 가로채는 소유권이 아니라 `runtime/work_report.js`와
`runtime/WORK-REPORT.md`의 공용 코어 계약이다. 다른 워크플로우와 목적지 어댑터도 필요할 때 같은 코어를
호출하거나 자체 보고서를 만들 수 있으며, 어떤 작업도 `wrapup`을 거쳐야
한다는 규칙은 없다. Google Drive가 없거나 인증되지 않은 상태에서도 기록
수집과 보고서 초안은 완료되어야 한다.

## 이 편의 기능의 기간 선택

- **daily**: 하루의 기록과 전후 경계를 확인한다.
- **weekly**: 월요일부터 일요일까지의 기록을 집계하고 중복을 합친다.
- **range**: 사용자가 지정한 임의 기간을 처리한다.

`/daily-wrapup`과 `/weekly-wrapup` 요청은 이 코어를 사용하는 편의 명령이다.
코어는
`--period daily|weekly|range`로 실행하며, 날짜를 추정하지 말고 기준 날짜와
시간대를 보고한다.

## 기록 수집

1. Git 로그와 변경 파일을 읽는다. 커밋이 없는 프로젝트와 미커밋 파일도
   포함한다.
2. 설정된 세션 내보내기 경로와 로컬 작업 기록을 선택적으로 읽는다. 기록
   저장소가 없으면 “기록 파이프라인 없음”으로 보고하고 작업이 없었다고
   결론내리지 않는다.
3. 각 항목에 출처, 관찰 시각, 프로젝트·경로, 안정적인 evidence ID를 붙인다.
4. 같은 흔적을 합치고 수집 실패·권한 오류·범위 밖 항목은 경고로 남긴다.

기본 수집기는 로컬에서만 동작한다. 기록 원문을 외부 모델·메일·협업 공간에
보내는 일은 선택한 출력 어댑터의 별도 동작이며, 범위와 목적지를 먼저
확인한다.

```bash
node "${JSTACK_PLUGIN_ROOT}/runtime/work_report.js" \
  --period daily --date 2026-09-15
node "${JSTACK_PLUGIN_ROOT}/runtime/work_report.js" \
  --period weekly --date 2026-09-15 --json
```

기본 산출물은 `~/.jstack/state/work-reports/<since>_<until>/`에 0700으로
저장한다. `report.md`는 사람에게 보여 줄 초안, `evidence.jsonl`은 관찰
원장, `manifest.json`은 범위·경고·해시, `prompt.md`는 합성 지침이다.

## 사실과 해석 분리

보고서에는 다음 세 층을 명시한다.

| 층 | 의미 | 표현 |
|---|---|---|
| 관찰 | 로그·파일·세션에서 직접 확인한 것 | 출처 ID와 함께 사실로 기록 |
| 해석 | 여러 관찰을 묶은 설명 | 해석임을 표시하고 근거를 연결 |
| 확인 필요 | 커밋 의도, 저자, 완료·승인 여부를 기록만으로 판단할 수 없는 것 | 사용자에게 확인 질문으로 제시 |

커밋 제목은 의도이고 파일 시각은 흔적이다. 둘을 완료·승인·전달 같은
사실로 승격하지 않는다. 애매한 프로젝트와 개인 기록은 자동으로 업무
성과에 넣지 않고 확인 필요로 둔다. 상세 판단은
`references/evidence-contract.md`와 `references/report-judgment.md`를 읽는다.

## 초안과 게시 분리

초안을 먼저 만들고 사용자에게 보여 준다. 사용자가 선택한 경우에만
`references/output-sinks.md`의 어댑터를 읽어 게시한다.

- 로컬 Markdown: 기본이며 항상 가능해야 한다.
- 이메일: 초안 생성 또는 명시적 발송을 별도 승인한다.
- Google Sheets/Docs: `google-workspace` 어댑터를 선택했을 때만 계정·대상을
  확인하고 실행한다.
- 다른 협업 공간: 같은 sink 계약을 구현한 경우에만 추가한다.

게시 실패는 보고서 실패가 아니다. `manifest.json`과 로컬 초안을 보존하고,
원격 쓰기를 재수행하기 전에 계정·대상·현재 버전을 다시 검증한다. 시트의
날짜·이름·목표는 의미 이름으로 찾고 물리적인 C열·D열 주소를 코어에 넣지
않는다.

`google-workspace`는 Google API·계정 분리·시트 구조·원격 쓰기만 소유한다.
기록 수집과 보고서 판단을 중복해서 구현하지 않는다. 새 기록 저장소나
게시처를 추가할 때도 이 경계를 유지한다.

## 완료 보고

마지막 응답에는 기간, 실제 읽은 소스, 기록 수, 확인 필요 수, 경고, 초안
경로를 짧게 적는다. 게시하지 않았다면 게시하지 않은 상태를 명시한다. 빈
결과는 “작업 없음”이 아니라 “확인된 기록 없음”으로 표현하고 수집기 상태를
함께 보고한다.
