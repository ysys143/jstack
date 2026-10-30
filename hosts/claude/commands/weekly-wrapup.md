# /weekly-wrapup — review the week from local records

Run the `jstack:wrapup` skill for one week. This command supplies only the period
and the date; collection, evidence judgment, the draft, and publication follow
that skill, so a change there reaches this command without an edit here.

- **Period and date:** `--period weekly` for the week containing the date
  argument, or the current local date when none is given. The period is
  Monday through Sunday. State the local timezone in the result.
- **Core:** the shared `runtime/work_report.js` collector, run locally.
- **Show the local draft** before any external write, then ask which destination,
  account, and target should receive it. Never assume a sheet, row, or column
  exists: C/D-style physical addresses do not belong in the report core.

```bash
node "${CLAUDE_PLUGIN_ROOT}/runtime/work_report.js" \
  --period weekly --date "${1:-$(date +%F)}"
```
