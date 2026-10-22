# Report schema

일일·주간은 같은 보고서 구조를 사용하고 기간만 다르게 선택한다.

```json
{
  "schemaVersion": 1,
  "period": { "kind": "day|week|range", "since": "YYYY-MM-DD", "until": "YYYY-MM-DD" },
  "sources": ["git", "filesystem", "session"],
  "sections": {
    "observed": [],
    "interpreted": [],
    "needsConfirmation": [],
    "nextQuestions": []
  },
  "publication": { "status": "local-draft|approved|published|failed", "sinks": [] }
}
```

`observed`의 각 항목은 `evidence.jsonl`의 ID를 가리킨다. `interpreted`는
근거 ID와 해석임을 함께 표시한다. `needsConfirmation`은 사용자에게 묻기
전까지 팀 문서나 자동 메일에 넣지 않는다.

`publication`은 코어가 기록하는 상태일 뿐, 원격 게시를 자동으로 실행하는
권한이 아니다. 원격 어댑터는 별도의 receipt에 대상, 계정, 승인 시각,
성공·실패를 남긴다.
