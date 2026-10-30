---
description: Open a PR that explains why, after self-review
---

# /pr — read it before opening

## Before opening

1. **Read the entire** `git diff <base>...HEAD` before asking reviewers to read it.
   This catches leftover debug output and unrelated changes.
2. Run checks. A red PR consumes reviewer time before the author resolves failures.
3. **Commit anything originally missed now.** Later fixes change the review basis
   while review is already in progress.
4. **Offer an acceptance walkthrough when the change alters how a new user starts.**
   If the diff touches install or setup documents, `Dockerfile` or `docker-compose*`,
   `.env.example`, or first-run or onboarding screens or routes, and the `journey-qa`
   skill is available, and `git config --local --get branch.<branch>.jstack-walkthrough`
   prints nothing, ask whether to run a new-team walkthrough before opening. Name the
   changed paths, say that it needs an isolated environment and model time, and
   never start it without a yes. Record the answer with
   `git config --local branch.<branch>.jstack-walkthrough declined` (or `ran`); a
   recorded answer is final, so ask once per branch, from any session or command.

## Questions the description must answer

| Item | If absent |
|---|---|
| Why is this change necessary? | Reviewers reconstruct intent from the diff |
| Which alternatives were rejected, and why? | Review repeats rejected suggestions |
| How was this verified? | A claim of passing has no supporting evidence |
| What was deliberately left out? | Reviewers mistake scope decisions for omissions |
| Who or what does this touch, and why is that safe or risky? | Reviewers check only the files in the diff and miss the callers, consumers, and data it reaches |

**Do not rewrite the diff as prose.** Reviewers can read the diff themselves.

The body keeps the two headings `gitrules` sets, `## Summary` and `## Test plan`.
Answer the why, rejected-alternatives, left-out, and touched-area rows under
Summary, and the verification row under Test plan. Keep SHAs, step-by-step logs, and long
command output out of the body and link them instead, so the body stays a
one-minute briefing.

## After the PR is open

When the PR gets review comments (including bot comments) or a CI run fails, read
`${CLAUDE_PLUGIN_ROOT}/skills/verify/references/pr-feedback.md`. It classifies each
comment and each failure and drafts the replies and fixes locally. Posting a
reply, resolving a thread, pushing, and rerunning a remote job each wait for the
user's approval.

## Tools

If `gh` is absent, `/doctor` explains the reduced path. Prepare a description for
the user to paste rather than opening the PR on their behalf.

**Do not merge on the user's behalf.** Opening and merging are separate decisions.
