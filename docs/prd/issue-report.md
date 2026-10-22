# Issue report: daily retrospective and proactive offers

Status: proposed on 2026-09-28. Branch `feat/report-command`.

## Problem

jstack users who hit a malfunction rarely report it, and reports that do arrive lack
the version, package digest, host, OS, and failing command needed to reproduce it.
`docs/releasing.md` already expects opt-in reports from real use (Windows
follow-up) but jstack has no collection path.

## Goals

1. A friendly user, meaning anyone who chooses to run the report command, can run
   it once a day to look back over the previous period, lists jstack malfunction candidates with evidence, and turns
   selected ones into redacted issue drafts.
2. During ordinary work, when a jstack command, script, or hook visibly fails, the
   agent offers once to record a report candidate instead of letting it pass.
3. Nothing leaves the machine without the user reading the exact draft and
   approving that submission.

## Non-goals

- No telemetry, background upload, or automatic submission.
- No hook-based daily nudge in this change. Claude hooks are being reworked in a
  separate uncommitted effort (`hosts/claude/hooks/dispatch.ts`,
  `docs/prd/project-hook-rework.md`); a SessionStart reminder for users who already ran the retrospective is
  a follow-up once that lands.
- No fixing of the reported defect; reporting ends at a local draft or an issue.

## Surfaces

| Surface | Path | Role |
|---|---|---|
| Public skill `issue-report` | `skills/public/operations/issue-report/` | Owns the procedure: proactive offer, candidate capture, drafting, redaction, approval, submission |
| Claude command `/report` | `hosts/claude/commands/report.md` | Daily retrospective entry point; delegates to the skill procedure |
| CLI `jst report` | `skills/public/operations/issue-report/scripts/main.ts`, wired in `cli/main.ts` | Deterministic state, scan, draft, redaction, and submission |
| Issue template | `.github/ISSUE_TEMPLATE/bug-report.yml` | Same fields for hand-written reports |

Codex reaches the same procedure through the public skill entry generated from
the catalog; no Codex-specific body is needed unless host dialect differs.

## State

All state is local under `~/.jstack/reports/` (respect `--home`):

- `config.json`: `{ "repo": "ysys143/jstack", "lastRetro": null }`

There is no opt-in flag. A friendly user is defined by behavior: someone who runs
the retrospective deliberately. Running it is the consent; no registration step
exists and no state distinguishes users.
- `queue/<id>.json`: candidate `{ id, signature, source, observedAt, skillOrCommand, excerpt, status }`
  where status is `queued | drafted | submitted | dismissed`
- `drafts/<id>.md`: redacted draft
- `receipts.jsonl`: one line per submission `{ id, url, submittedAt, signature }`

`signature` is a hash of the normalized error text (paths, numbers, timestamps
stripped) plus the jstack surface name. It drives deduplication across the queue,
receipts, and scan results.

## CLI

```
jst report status [--json]
jst report note --surface NAME --text TEXT [--excerpt-file PATH]
jst report scan [--since ISO|--hours N] [--json]
jst report list [--all] [--json]
jst report dismiss ID...
jst report draft ID... [--expected TEXT] [--actual TEXT] [--steps TEXT]
jst report submit DRAFT|ID --confirm [--new] [--repo OWNER/NAME] [--json]
jst report finish
```

- `note` records a candidate from the proactive path. It stores only the redacted
  excerpt. It never contacts the network.
- `scan` reads Claude transcripts (`$CLAUDE_CONFIG_DIR` or `~/.claude/projects/**/*.jsonl`)
  and Codex sessions (`$CODEX_HOME` or `~/.codex/sessions/**`) modified in the
  window (default: since `lastRetro`, else 24 hours). A candidate is an errored
  tool result or hook failure whose command, path, or message references jstack
  (`jst` CLI, the installed jstack plugin root, `jstack:` skills or commands, jstack hook
  names). A missing or unreadable source is a warning, never "no problems".
  Results are deduplicated by signature against queue and receipts.
- `draft` writes fixed fields: summary, surface, expected, actual, steps,
  evidence excerpt, environment (jstack version and package digest from the `claude`
  and `codex` entries of `~/.jstack/installation.json`, host and host version, OS,
  Node), and doctor summary (`scripts/doctor.js` exit code and blocked rows).
  Receipt text is flattened to one line, stripped of control characters and cut
  at 80 characters; a value that is not text reads as `?`, and an entry that is
  not an object is skipped. Without a usable host entry in `installation.json`,
  the version comes from the `package-receipt.json` of the managed marketplace
  (`~/.jstack/marketplace/plugins/<host>/jstack/`), marked `(package receipt;
  installation receipt P)`, because `jst install` writes both together and the
  anomaly matters to the maintainer. P is `missing`, `unreadable` (the file
  cannot be read or is not valid JSON), `malformed` (the receipt, its `hosts` or a host entry is not
  an object) or `lists no hosts`. Without a managed package receipt, a
  host-native marketplace install is named by the `package-receipt.json` of the
  running payload (the package root beside the `payload/` directory holding the
  script), marked `(running package receipt; installation receipt P)`. A package
  receipt gives its source hash as the digest. With no package receipt at all,
  the draft says `not installed through jst install (no installation receipt)`
  when the installation receipt is missing and `unknown (installation receipt P)`
  otherwise. The whole draft passes redaction before it is written.
- `submit` refuses without `--confirm`. It checks `gh` presence and auth, searches
  open issues for the signature, and when a match exists prints it and stops
  unless `--new` is also given. Otherwise it runs `gh issue create --repo REPO
  --body-file DRAFT --label bug --label from-report`, records a receipt, marks the
  candidate submitted, and sets `lastRetro`. When `gh` is missing, unauthenticated,
  or lacks repository access, it exits 3, leaves the draft, and prints its path
  for manual delivery; without `gh`, open the issue by hand from that file.
- The target repository is `ysys143/jstack` unless `repo` in
  `config.json` names another one, which then applies to every later submission.
  `submit --repo OWNER/NAME` targets that one submission and is never saved; it
  is a usage error on any other action. A `repo` in `config.json` that is not a
  valid slug is not used and not rewritten: `status` prints a WARNING naming it,
  and `submit` exits 2 and keeps the draft unless `--repo` is given. `status` and
  `submit` print a WARNING naming the target whenever it is not the default,
  `status --json` carries the warnings in `warnings` beside `defaultRepo`,
  `submit --json` carries the target in `repo` and the same warnings in
  `warnings` (with `--repo` they also name an ignored configured value), and a
  refusal without `--confirm` names the target on stderr.

  `submit --json` prints its JSON result on stdout only when the submission ran
  far enough to have one (exit 0, 3 or 4, or 1 for a draft changed by
  re-redaction). A refusal, whether for a missing `--confirm` or for an invalid
  configured repository, exits 2 with text on stderr and no JSON on stdout.

Exit codes: 0 success, 1 error or draft changed by re-redaction at submit time
(review again), 2 usage error, missing `--confirm`, or an invalid configured
repository without `--repo`, 3 `gh` unavailable (draft kept), 4 open issue with
the same signature found (not submitted). The issue title is
`[report] <surface>: <summary>`; the draft carries a `jstack-report-signature:` line
used for duplicate search.

The draft summary is one line of at most 160 characters and the title's summary
at most 100. ANSI escape sequences and control characters are removed before the
cut, so a title never carries a raw escape; each run of line breaks and tabs
becomes one space, ordinary spaces are kept, and the ends are trimmed, so a line
shorter than its limit changes only in that way. A longer line ends at its last
whole word that fits, followed by `…`. A line whose only spaces sit in the first
half of the limit, such as one long token, is cut at the limit instead (the
earlier hard cut) and ends with `…` all the same. The cut never splits a
grapheme cluster, except that one cluster longer than the limit is cut between
code points. Markup is not interpreted: a literal backtick, asterisk or bracket
is ordinary text, and a cut may leave a span open. The evidence excerpt keeps
the full text.

`jst report finish` sets `lastRetro` when a retrospective ends with no submission, so the next
scan window starts at the right place.

## Redaction

Applied to excerpts at capture time and to the whole draft:

- the home directory and user name become `~` and `<user>`
- email addresses, `Bearer` values, and known token shapes (`sk-`, `ghp_`,
  `github_pat_`, `xox?-`, `AKIA`, JWT) become `<redacted>`
- values from `~/.jstack` organization profiles are replaced by their field name
- excerpts are capped (default 2,000 characters) and conversation text other than
  tool errors is excluded unless the user explicitly adds it

Reuse the repository's existing privacy scanner patterns if one exists rather than
maintaining a second list.

## Proactive offer (skill behavior)

Trigger: during work, a jstack command, `jst` CLI call, jstack script, or jstack hook
fails, or the user says jstack did something wrong.

1. Finish or stabilize the user's current task first; do not derail it.
2. Offer once per signature per session, in one line, to record a candidate.
3. Record the candidate with `jst report note` only when the user accepts the
   offer. Silence or refusal records nothing; do not repeat the offer for that
   signature in the session.
4. Never draft or submit from the proactive path; submission belongs to the
   retrospective.

## Daily retrospective (`/report`)

1. `jst report status`; mention if the previous retro was under 20 hours ago, then
   continue because the user invoked it.
2. `jst report scan` and `jst report list`; show one numbered table of queued and
   scanned candidates with surface, time, and a one-line excerpt.
3. The user selects candidates, dismisses the rest, and supplies expected/actual
   in their words. Do not invent expected behavior.
4. `jst report draft`; show the full draft.
5. Submit only drafts the user approves in this retrospective, with `--confirm`.
   Report each issue URL or the fallback file path.

## Validation

- Behavior tests (`node --test`) for redaction, signature normalization, scan over
  synthetic Claude and Codex fixtures, dedup against queue and receipts,
  `submit` refusal without `--confirm`, the `gh`-missing fallback (exit 3, draft
  kept), and `config.json` without any opt-in field.
- Owning suite `tests/run_tests.ts` with contract patterns for "never submit
  without approval", "missing source is not no problems", and "offer once".
- Command list, catalog entry, CLI help, and `packaging/package-files.json` updated
  together; `node dist/scripts/run_suites.js` passes.

## Follow-ups

- SessionStart reminder when a previous retrospective exists (`lastRetro` set) and
  is older than a day, after the hook rework lands. Users who never ran the
  retrospective are never reminded.
- Windows report collection from `docs/releasing.md` uses this path.
