# Report judgment — promote traces only with evidence

The collector records traces. It does not know the user's intention, ownership,
approval state, or whether a result was delivered. A report therefore has two
different jobs: state what the local source contains, and make the gap between a
trace and a claim visible to the user.

## Promotion rules

| Source | What can be stated as observed | What remains confirmation-needed |
| --- | --- | --- |
| Git commit | Repository, commit time, hash, and subject | What the subject means, who authored the work, and whether it is complete |
| Changed or created file | Path, project, and observed timestamp | Why it changed, whether it is an intentional deliverable, and whether it was reviewed |
| Session export | The recorded title or line and its source file | Whether the session statement is accurate, approved, or still current |
| External receipt | Adapter-reported request and response identifiers | Whether the destination reader accepted or acted on the content |

Never turn a commit subject or file timestamp into “완료”, “승인”, “전달”,
“합의”, “확정”, or “배포” without the user's confirmation or a separate
authoritative receipt. A repository name is a location, not proof that the work
belongs to an organization. A large number of commits is not a measure of
importance.

## Draft wording

Use a source ID for every factual bullet. Keep interpretation in a separate
sentence and link it to the observations that support it. Put uncertainty in a
`확인 필요` section rather than hiding it in a confident verb. If two sources
disagree, preserve both records, describe the disagreement, and ask which one
governs. Do not silently discard a missing, inaccessible, or empty source.

The safe Korean form is concrete and modest:

```text
- 관찰: [git:…] `project`에서 `subject` 커밋이 기록됨
- 해석: 해당 커밋은 설명한 방향의 변경을 시도한 흔적으로 보임
- 확인 필요: 실제 완료·검토·전달 여부와 업무 귀속
```

An empty collection means “이 기간에 확인된 기록 없음” and must include the
sources that were attempted and any warnings. It never means “작업 없음”.

## Publication boundary

The local report is the recoverable source for any later publication. A sink may
map semantic fields such as `person`, `date`, `previousWork`, `nextWork`, and
`blockers` to a destination's columns or properties, but the core report must
not contain a physical address such as C or D. The sink rereads its target,
records an idempotency key derived from the report manifest, and writes only
after the user selected that destination. A failed write keeps the local draft
and is reported separately from collection success.
