# Output sink contract

재사용 가능한 보고서 코어(`runtime/work_report.js`, 계약:
`runtime/WORK-REPORT.md`)는 목적지를 모른 채
`report.md`, `evidence.jsonl`, `manifest.json`을 완성한다. `wrapup`은 개인
기간 보고서를 위한 사용자용 진입점 중 하나이며, 다른 워크플로우도 이 코어를
직접 호출하거나 별도의 보고서를 만들 수 있다. 목적지는 사용자가 선택한 뒤
어댑터가 연결한다.

## Adapter interface

모든 sink는 같은 순서를 따른다.

1. 코어 산출물과 manifest를 읽고, 보고서 기간·해시를 고정한다.
2. 목적지의 계정과 대상을 읽기 전용으로 확인한다.
3. 의미 필드와 목적지 구조를 매핑해 쓰기 미리보기를 만든다.
4. 사용자 승인 뒤에만 쓰거나 발송한다.
5. 대상, 계정, 입력 해시, 결과 ID, 시각을 receipt에 기록한다.

쓰기 실패는 코어 산출물을 삭제하거나 “게시 완료”로 표시하지 않는다. 같은
manifest에 대해 재시도할 수 있어야 한다.

## Google Workspace adapter

`google-workspace`는 `gws` 설치, OAuth 계정 분리, Drive/Sheets/Docs 대상
확인, semantic header mapping, 원격 쓰기를 담당한다. Google Drive ID와
시트의 물리 열은 로컬 프로필과 어댑터 내부에만 둔다.

보고서 코어는 `date`, `person`, `done`, `next`, `blocker`, `note` 같은 의미
필드를 사용한다. 어댑터가 실제 헤더를 읽어 매핑하며, C열·D열 같은 주소를
보고서나 코어 계약에 기록하지 않는다.

## Other destinations

새 목적지는 다음 조건을 만족할 때만 추가한다.

- 로컬 초안 없이 원격 쓰기를 성공으로 보고하지 않는다.
- 코어의 evidence ID를 보존한다.
- 계정·대상·권한을 실행 직전에 검증한다.
- 목적지의 열·페이지·채널 구조를 코어로 누출하지 않는다.
