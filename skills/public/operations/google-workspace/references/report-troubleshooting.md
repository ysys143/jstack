# Weekly report troubleshooting

Ported from the upstream `weekly-wrapup` skill at commits adb6b55 and ac25a57.
These are **records of incidents that actually occurred**. Start here when a
symptom repeats.

## Troubleshooting

### An Entire Project Is Missing (most common)

**Symptom:** Work definitely occurred, but appears in neither `git_log.md` nor
`mtime_projects.md`.

**Cause:** One of the four collection blind spots in the Step 1 table.

**Resolution:** Run the creation-time sweep in Step 1-3 and inspect these three
locations separately:

```bash
find ~/Documents/GitHub -maxdepth 3 -name .git | sed 's|/.git$||'   # nested repositories
git -C <repo> status --short | grep '^??'                           # uncommitted directories
ls ~/Documents/GitHub | while read d; do [ -d "$d/.git" ] || echo "$d"; done  # non-Git
```

### mtime_projects.md contains only its header

**Symptom:** `collect_by_mtime.js` emits only the five header lines.

**Cause:** Under `set -euo pipefail`, `find ... | head -10` causes SIGPIPE;
`pipefail` marks it failed and `set -e` terminates the whole script. It occurs in
directories containing many files.

**Resolution:** Guard the pipeline with `|| true` or use a count-limited `-print`
instead of `head`. Use the creation-time sweep as a temporary replacement.
**Never interpret an empty file as "no work."**

### `[ABORT] safety check failed: C{row} = '...'`

**Symptom:** Column C of the write target does not contain the selected person's
name.

**Cause:** Rows per day differ from the script's four-row assumption. Spacing
changes with team size.

**Resolution:** Find the real row using Step 3-3 and, if it differs, write it
directly instead of using the script. **This ABORT is correct behavior**: it
prevents overwriting another person's row.

### A tab cannot be found

**Symptom:** Range error or empty response.

**Cause:** The week calculation in `get_sheet_name()` disagrees with the actual
tab name.

**Resolution:** Use `spreadsheets get` to list real tabs and use the title
verbatim.

### The Monthly Sheet Changed

**Symptom:** A Daily Scrum upload fails in a new month or writes to last month's
sheet.

**Cause:** `GDRIVE_DAILY_SCRUM_SHEET_ID` in `reports/gdrive.env` is not refreshed
automatically.

**Resolution:** If the user supplied a URL, use it and update the environment.
Otherwise use the discovery procedure that replaces the unprovided
`find_monthly_sheet.sh`; see `gdrive-ids.md`.

### A cloned repository is counted as completed work

**Symptom:** The top creation-time results contain thousands of files from
llama.cpp, vllm, or a similar repository.

**Cause:** Cloning gives every file the clone-time creation date.

**Resolution:** Treat a batch of standard repository files such as README,
LICENSE, and CMakeLists as a clone rather than authored work.

### A report link opens in edit mode

**Symptom:** The report link inserted in Daily Scrum column E uses an `/edit` URL
and prompts the recipient for unnecessary edit permission.

**Cause:** The old, unprovided `upload_gdrive.sh` returned `/edit` by default.

**Resolution:** When adapting that upstream script, use the direct gws procedure
in `gdrive-ids.md` and preserve this URL correction at its former line 46:

```bash
# Before
DOC_URL="https://docs.google.com/document/d/$FILE_ID/edit"
# After
DOC_URL="https://docs.google.com/document/d/$FILE_ID/edit?usp=sharing"
```

## Known script defects

These defects are confirmed. Never trust script output without verification.

**Fixed on 2026-08-27:**

| Script | Defect | Fix |
|---|---|---|
| `collect_git.js` | Searched only one level with `$GITHUB_DIR/*/`, missing nested repositories | Extended discovery by one nested level |
| `collect_by_mtime.js` | `find \| head` plus SIGPIPE and `pipefail` terminated early, leaving only the header | Added `\|\| true` to the pipeline |

**Unfixed; workaround required:**

| Script | Defect | Impact |
|---|---|---|
| `update_daily_scrum.sh` | `row_for_weekday()` hardcodes four-row spacing | ABORT in a five-row layout; find the row through Step 3-3 and write directly |
| `update_daily_scrum.sh` | `get_sheet_name()` calculates the wrong week | Tab mismatch; query the API through Step 3-2 |
| `upload_gdrive.sh` | Filename becomes document title | Before upload, name the file `weekly_report_name_period.md` |

**The creation-time sweep in Step 1-3 remains necessary even after nested and
non-Git discovery is repaired.** Uncommitted directories inside repositories and
artifacts outside repositories remain invisible to both collectors.

## References

- [Google Drive ID configuration](./gdrive-ids.md) — report and Daily Scrum folder fields
- [Collect all projects](./collect-all-projects.md) — Git and mtime collection details
- [Draft-first workflow](./draft-first-workflow.md) — verification before API writes

Current runs read `~/.jstack/profiles/<name>/` and reconfirm the account. Never copy
legacy environment values, real names, or fixed row numbers into public
documentation or installation defaults.
