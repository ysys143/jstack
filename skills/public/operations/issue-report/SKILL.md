---
name: issue-report
description: "Record jstack malfunctions and draft redacted issues; submit with approval. Triggers: 버그 신고."
---

# Issue report

Collect evidence of jstack malfunctions so a maintainer can reproduce them. Nothing
leaves the machine until the user has read the exact draft and approved that one
submission. Reporting ends at a local draft or an issue; do not fix the defect here.

Run `node "${JSTACK_PLUGIN_ROOT}/skills/issue-report/scripts/main.js" <action>` from
an installed plugin; `jst report <action>` is the equivalent when the CLI is on
`PATH`. When `jst` is not found, use that script route and explain the cause as
in [jst command on PATH](../../runtime/CLI-PATH.md). State lives in
`~/.jstack/reports/`; `--home DIR` selects another home.
Run the script with `--help` for every action and exit code.

## Proactive offer

Trigger: during work, a jstack command, `jst` CLI call, jstack script or jstack hook fails,
or the user says jstack did something wrong.

1. Finish or stabilize the user's current task first; do not derail it.
2. Offer once per signature per session, in one line, to record a candidate. Do
   not repeat the offer for the same failure in the same session.
3. Record the candidate with `jst report note --surface NAME --text TEXT` only
   when the user accepts the offer, and say so in one line. Silence or refusal
   records nothing. There is no opt-in setting; nothing is recorded automatically.
4. Never draft or submit from the proactive path; submission belongs to the
   retrospective (`/report` in Claude Code, or this skill on request).

`note` stores only the redacted excerpt and never contacts the network.
Running the retrospective deliberately is the user's consent to review reports.

## Retrospective

1. `jst report status`. Mention a retrospective under 20 hours ago, then continue.
   If status prints a WARNING about the target repository (it is not the
   default, or the configured value is invalid), tell the user before drafting.
2. `jst report scan`, then `jst report list`. Show one numbered table of queued
   and scanned candidates with surface, time and a one-line excerpt. Scan reads
   Claude and Codex transcripts since the last retrospective (default 24 hours).
   A missing or unreadable source is a warning, not "no problems": say which host
   was not covered.
3. The user selects candidates; dismiss the rest with `jst report dismiss ID...`.
   Ask for expected and actual behavior in the user's words. Do not invent
   expected behavior; an absent answer stays "not provided".
4. `jst report draft ID... --expected TEXT --actual TEXT --steps TEXT`, then show
   the full draft file, not a summary.
5. Submit only drafts the user approves in this retrospective:
   `jst report submit DRAFT --confirm`. Never submit without that approval, and
   never pass `--new` unless the user chose to file beside a matching open issue
   (exit 4). Report each issue URL. Exit 3 means `gh` is missing, unauthenticated
   or lacks access to the private repository: give the printed draft path for
   manual delivery. Pass `--repo OWNER/NAME` only when the user chose that
   repository for this one submission; it is never saved. Exit 2 because the
   configured repository is invalid means nothing was sent; ask the user which
   repository to use, then pass `--repo OWNER/NAME` or have them fix the
   `repo` setting of the report config. If nothing is submitted, run `jst report finish`.

## Redaction and evidence

Excerpts are redacted at capture and whole drafts before writing: the home
directory becomes `~`, the user name `<user>`, emails, Bearer values and token
shapes `<redacted>`, and `~/.jstack` profile values their field name. Excerpts are
capped at 2,000 characters and contain tool errors only. Add conversation text
only when the user explicitly asks. If you see sensitive text that survived
redaction, remove it from the draft and tell the user before any submission.
