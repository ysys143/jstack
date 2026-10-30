# /daily-wrapup — inspect the day before publishing

Run the `jstack:wrapup` skill for one day. This command supplies only the period
and the date; collection, evidence judgment, the draft, and publication follow
that skill, so a change there reaches this command without an edit here.

- **Period and date:** `--period daily` with the date argument, or the current
  local date when none is given. State the timezone in the result.
- **Core:** the shared `runtime/work_report.js` collector, run locally. It needs
  no `gws`, Drive account, or shared sheet.
- **Publish only when** the user explicitly selects a destination. If the
  adapter fails, keep a local recovery copy.

```bash
node "${CLAUDE_PLUGIN_ROOT}/runtime/work_report.js" \
  --period daily --date "${1:-$(date +%F)}"
```
