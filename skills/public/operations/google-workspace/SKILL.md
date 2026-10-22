---
name: google-workspace
description: "Operate Google Drive, Sheets and Docs through gws. Triggers: 구글 드라이브, 스프레드시트."
---

# Workspace — Google Workspace destination adapter

## Boundary with wrapup

When a personal daily, weekly, or custom-period report is requested, the shared
`${JSTACK_PLUGIN_ROOT}/runtime/work_report.js` core (contract:
`${JSTACK_PLUGIN_ROOT}/runtime/WORK-REPORT.md`) can search local records, separate
observations from interpretations and confirmation items, and produce a
recoverable local report. `wrapup` is one user-facing convenience entry for
that report shape, but it is not a prerequisite for this adapter or for other
workflows: they may call the core directly or provide their own reviewed input.
It works without `gws`, a Drive account, or a shared spreadsheet. Read
`${JSTACK_PLUGIN_ROOT}/skills/wrapup/SKILL.md` only when the user explicitly requests that
convenience workflow; otherwise use the selected workflow's input contract.

This skill begins when the user chooses Google Workspace as a destination for an
existing report or artifact. It owns account separation, Drive/Sheets/Docs
discovery, semantic header mapping, approval-gated remote writes, and receipts.
It does not decide what work occurred and it does not make Google or `wrapup` a
prerequisite for unrelated work.

## Read work settings from the local profile

When this adapter is selected, first load the existing profile according to `${JSTACK_PLUGIN_ROOT}/runtime/ONBOARDING.md`. `JSTACK_PLUGIN_ROOT` is the root of the installed plugin. If no profile exists, use optional init to discover required values and save them under `~/.jstack/profiles/<name>/`. Preserve manual settings. Pin the profile and revision at task start and recheck the account with verify-account immediately before remote writes. Keep tokens and client secrets in the existing credential store. An unset item stops only the affected Google feature; never substitute another account or an old ID. A missing Google profile leaves the local wrapup report usable.

## Phase 0: Check the tool

```bash
node "${JSTACK_PLUGIN_ROOT}/skills/workspace/scripts/ensure_gws.js"
```

- exit 0 — `gws` is available and account settings exist
- exit 1 — `gws` exists but **account settings are missing**; authenticate first
- exit 2 — `gws` is missing; show installation guidance and stop

**Know this installation trap:** `brew` has two conflicting tools named `gws`; use `googleworkspace-cli`, not the other `gws` package. See `references/gws-cli.md`.

```bash
brew install googleworkspace-cli     # this one
brew install gws                     # not this one (a different tool)
```

Before writing, check token expiry again:
```bash
node "${JSTACK_PLUGIN_ROOT}/skills/workspace/scripts/token_check.js" --config-dir "<snapshot's configDir>"
```
Exit 0 means all accounts are valid; exit 1 means re-authenticate; exit 2 is **indeterminate**, so inspect `gws auth status` directly and do not treat unknown as pass.

Expiry often appears in the middle of a run, after a partial record already
exists. A sheet with two of five cells written is worse than an untouched sheet
because a reader can mistake it for a finished record.

## Phase 1: Separate accounts

`gws` stores one account per config directory. For every company operation:
```bash
GOOGLE_WORKSPACE_CLI_CONFIG_DIR="<snapshot's configDir>" gws <command>
```
Without this variable the default account may access a company document as a personal account, or the reverse.

## Phase 2: Identify the target

**Folder and Drive IDs are canonical in `~/.jstack/profiles/<name>/workspace.json`.** The `references/gdrive-ids.md` file explains fields and discovery only. Do not put real IDs or names in public documents or use old installation-cache values as a fallback.

**Do not calculate sheet row numbers or tab names.** See
`references/scrum-cells.md`. Calculating a week tab from the weekday on which the
month begins has already disagreed with reality: for 2026-08-27 the calculation
gave `August week 5`, while the actual tab was `August week 4`. Row spacing also
depends on team size. Fetch the actual tab list through the API and locate the
target row by reading it.

## Phase 3: Write only after checking

Immediately before every write, reread the target cell's name column and verify the intended person. Stop if it differs. A quiet write to another person's cell is the worst outcome; reads are reversible, overwritten records are not.

Show a weekly report draft to the user and obtain approval before uploading it (`references/draft-first-workflow.md`). Keep a `.md` recovery copy if upload fails.

## Phase 4: Promote drafts carefully

A commit message records intent, not a verified fact. Load `references/report-judgment.md` before turning commits into team-visible results. The keywords **확정 · 완료 · 합의 · 승인 · 배포 · 전달** require another party; ask the user before copying such claims unchanged.

The same reference defines cell style and density rules and how to classify an
ambiguous project.

## References

| File | Contents | Class |
|---|---|---|
| `references/gws-cli.md` | Installation, authentication, same-name tool trap, CONFIG_DIR separation | Tool knowledge |
| `references/sheets-troubleshooting.md` | Sheets API traps, quote escaping, CLI-surface changes | Tool knowledge |
| `references/gdrive-ids.md` | Fields and discovery for the local canonical ID store | Work-data configuration contract |
| `references/scrum-cells.md` | Daily Scrum row and tab rules | Work data |
| `references/collect-all-projects.md` | Procedure for collecting every project | Procedure |
| `references/draft-first-workflow.md` | Draft-first workflow | Procedure |
| `references/report-judgment.md` | Commit-to-result promotion, cell style, ambiguous-project judgment | Work judgment |
| `references/report-troubleshooting.md` | Seven observed incidents and responses | Operations knowledge |

Tool knowledge and work data are separate because they change for different
reasons: organization changes affect people and folder layouts, while CLI
versions affect tool behavior. Combining them causes an update to one to disturb
the other.

The table distinguishes tool knowledge, work data, procedures, judgment, and incident handling.
Their update cycles differ.

## Watch for adapter decay

The `gws` CLI surface has changed before, and the incident is recorded in
`references/sheets-troubleshooting.md`. When a command behaves differently from
this documentation, suspect stale documentation first and compare it with:

```bash
gws <command> --help
```

## Explicit limits

- `googleworkspace-cli` is not included; the user installs and authenticates it.
- Never store `client_secret.json` or tokens in the repository; keep them under `~/.config/gws-{account}/`.
- Drive IDs point to internal organizational resources and belong only in the local profile. Stop if access is unavailable.
