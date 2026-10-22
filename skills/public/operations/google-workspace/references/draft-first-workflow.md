# Draft-first workflow

A safe process that reviews and approves a Markdown draft before any Google
Sheets API write.

## Principle

**No direct API write** → **create a draft `.md` file** → **user review and
approval** → **API write**

API-write failures are difficult to recover from. A draft file is a recoverable
audit record.

## Process

### Step 1: Create the Draft

**Location:**

```text
reports/YYYY/WXX_.../scrum_content.md
```

**Per-date structure:**

````markdown
# Daily Scrum update — March week 3 (3/16–3/20)

## row 8 — Monday (3/16)

**D — What I learned yesterday:**

```
- [project] work performed
- ...
```

**E — Today's goals:**

```
- [project] goal
- ...
```

**F — Issues:**

```
- content, or none
```

**G — Other:**

```
- notes
```

---

## row 12 — Tuesday (3/17)
...
````

### Step 2: user review

Present the Markdown file to the user and ask them to check:

- content,
- requested corrections or rewrites,
- link accuracy, and
- project-name spelling.

Apply feedback to the Markdown. Repeat review and revision as often as needed.

### Step 3: obtain approval

Valid final approval signals include:

- `ㅇㅇ` (OK),
- `좋습니다` (approved), or
- a concrete approval comment.

**Never write through the API without approval.**

### Step 4: API write, only after approval

**Update the Daily Scrum sheet:**

```bash
# Not provided upstream; see the replacement in gdrive-ids.md.
bash <report-repository>/update_daily_scrum.sh \
  --sheet-id "[monthly_sheet_ID]" \
  --content reports/2026/W12_20260316-20260322/scrum_content.md
```

**Upload the weekly report:**

```bash
# Not provided upstream; see the replacement in gdrive-ids.md.
bash <report-repository>/upload_gdrive.sh \
  reports/2026/W12_20260316-20260322/weekly_report.md \
  <report-folder-ID>
```

The folder ID is canonical in `gdrive-ids.md`. Hardcoding it here creates two
places to update and can upload to the wrong folder when one is missed.

**Verify the API response:**

- Daily Scrum: `[OK] 업로드 완료`
- Google Docs: `[OK] 업로드 완료: [URL]`

## Scope

### Draft-first is mandatory for

- [O] Daily Scrum D/E/F/G updates containing user-authored content
- [O] Complex updates spanning several projects or components
- [O] Content containing URLs or links whose accuracy must be checked
- [O] Anything the user must approve finally

### Automatic writes are allowed for

- [O] Script-generated data such as Git log and mtime collection
- [O] Simple template-based input

## Benefits

1. **Error prevention:** inspect 100% of content before an API write.
2. **User control:** the user holds final approval.
3. **Audit record:** version the `.md` file.
4. **Recovery:** retry from the `.md` file after failure.

## Cautions

**Never:**

- [X] write through the API immediately after creating a draft without approval,
- [X] skip user review, or
- [X] continue casually after an API-write failure; determine the cause.

**Required checks:**

- [ ] Draft Markdown is complete.
- [ ] Project names, links, and other values are accurate.
- [ ] User review and approval are recorded.
- [ ] API call happens only after approval.
- [ ] API response contains `[OK]`.

## Troubleshooting

### User approval is delayed

Keep the Markdown file and either request approval again or apply new revisions.

### API write fails

Possible causes:

- insufficient Google Workspace permission,
- incorrect gws configuration,
- wrong sheet ID, or
- network failure.

Resolution:

1. Record the error message.
2. Determine whether the cause is permission, configuration, ID, or network.
3. Keep the `.md` file under version control.
4. Retry only after fixing the cause.

### User requests a change during draft review

1. Edit the Markdown file.
2. Show the revised content again.
3. Obtain approval again.
4. Only then write through the API.

## Checklists

Before a Daily Scrum update:

```text
- [ ] scrum_content.md is complete
- [ ] every project name is accurate
- [ ] every URL is accurate
- [ ] columns D/E/F/G are complete
- [ ] review was requested from the user
- [ ] user approval signal was confirmed
- [ ] update_daily_scrum.sh was run
- [ ] [OK] message was confirmed
```

Before a weekly report upload:

```text
- [ ] weekly_report.md is complete
- [ ] all four categories are complete
- [ ] progress is recorded for every project
- [ ] next week's plan is included
- [ ] user review is complete
- [ ] user approval was obtained
- [ ] upload_gdrive.sh was run
- [ ] Google Docs URL was confirmed
```

## Notes

- Keep `.md` files in the Git repository as audit records.
- Draft-first specifically means a `.md` draft, not merely any use of the word draft.
- Preserve the `.md` file after failure so the operation can be retried.
- The API write is the final step; everything before it remains reviewable.
