# CI diagnosis — pin the failing execution

Use this procedure only when the request is to explain a CI result or decide
what to investigate next. It is read-only. It can run alone or return to an
external caller. A diagnosis is not a verification receipt or source repair.

## Capture before explaining

Record the repository identity, expected full Git HEAD, current local HEAD,
provider run ID, run attempt, job ID, job attempt, run/job status and conclusion,
the complete job log, artifact listing and availability, and the checker command,
exit code, and observed result. Record the provider URL, retrieval command and
capture time separately. Obtain run and job facts from the CI provider using
read-only calls; a PR title, branch name, notification, or copied success badge
does not bind a run to the current code. If the provider does not expose an
attempt or complete log, mark the evidence incomplete. A run from another
repository or HEAD, an earlier attempt, a different job, or a stale completion
signal cannot prove current code.

Use `scripts/ci_diagnosis.js` for an additional local identity check. Supply
the provider facts in a JSON file with `repository` (`OWNER/REPO`),
`expectedHead`, `run` (`id`, `repository`, `headSha`, `attempt`, `status`,
`conclusion`), `job` (`id`, `runId`, `repository`, `headSha`, `attempt`, `status`,
`conclusion`), `log` (`path`, SHA-256 `sha256`, `complete`), `artifacts` (an
explicit array, each with `id`, `name`, `status` of `available`, `expired`, or
`missing`), and `checker` (`status` of `success`, `failed`, `unknown`, or
`skipped`; `exitCode` when it ran). Include the raw provider response paths or
URLs in the narrative. The helper compares this capture with `git rev-parse`
and the checkout's GitHub origin. It checks log bytes and refuses unknown or
skipped checkers as proof. It does not authenticate the capture or contact the
provider; report that limit. Keep the evidence file outside the source tree
when the report itself should remain read-only.

```bash
node "${JSTACK_PLUGIN_ROOT}/skills/verify/scripts/ci_diagnosis.js" \
  --repo-root /absolute/project --evidence /absolute/ci-evidence.json \
  --head FULL_SHA --run RUN_ID --job JOB_ID --attempt ATTEMPT
```

Exit 0 means the supplied identities and evidence are internally consistent;
it does not mean CI passed or current code is verified. Exit 1 means stale,
foreign, partial, or conflicting evidence. Exit 2 means the local check could
not run. Cancelled or timed-out runs/jobs are incomplete evidence even when
a checker exited nonzero; preserve their raw conclusions and do not infer a
completed checker failure from interruption. Preserve every problem in the result; do not relabel it as a pass.

## Return a bounded diagnosis

Report observations first: exact identity, failed step, relevant log lines,
artifact state, and what is unavailable. Give at least two competing,
falsifiable hypotheses; for each, name a read-only check or minimal bounded
reproducer and the observation that would reject it. A reproducer must pin
tool version, inputs and command, use a disposable checkout or fixture when a
command may mutate, and stay within the failed surface. Do not repair source
merely because a log suggests a cause.

Return the result to the original phase or external caller with the exact
failing identity, captured evidence paths and hashes, open uncertainty, and a
proposed repair scope. The original owner decides whether repair is authorized,
performs its RED→fix→GREEN work, and obtains fresh verification for the new
HEAD. A completed old run is never substituted for that verification.
"Original phase" and "original owner" mean whichever workflow step or requester
asked for the diagnosis. A standalone request has no workflow step: the requester
is the original owner, receives the result, and decides whether repair is
authorized; no other jstack state is implied.
