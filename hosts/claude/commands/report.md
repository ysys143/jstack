# /report — daily jstack malfunction retrospective

Follow the `issue-report` skill procedure. This command is its daily entry point:
look back over the period since the last retrospective, list jstack malfunction
candidates with evidence, and turn the ones the user selects into redacted issue
drafts. Nothing leaves the machine until the user has read the exact draft and
approved that submission.

```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/issue-report/scripts/main.js" status
```

## Sequence

1. Run `status`. If the previous retrospective was under 20 hours ago, say so in
   one line, then continue because the user invoked this command. If status
   prints a WARNING about the target repository (it is not the default, or the
   configured value is invalid), tell the user before drafting.
2. Run `scan`, then `list`. Show one numbered table of queued and scanned
   candidates with surface, time and a one-line excerpt. A scan warning about a
   missing or unreadable transcript source means that host was not covered; say
   so instead of reporting that there were no problems.
3. Let the user select candidates and dismiss the rest with `dismiss ID...`.
   Ask for expected and actual behavior in the user's words.
   Do not invent expected behavior.
4. Run `draft ID... --expected TEXT --actual TEXT --steps TEXT` and show the full
   draft file.
5. Submit only drafts the user approves now, one at a time, with
   `submit DRAFT --confirm`. Do not submit a draft the user has not approved in
   this retrospective. Report each issue URL. Exit 3 keeps the draft and prints
   its path for manual delivery; exit 4 means an open issue already carries the
   same signature, so ask before adding `--new`. Pass `--repo OWNER/NAME` only
   when the user chose that repository for this one submission; it is never saved.
   Exit 2 because the configured repository is invalid means nothing was sent;
   ask the user which repository to use, then pass `--repo OWNER/NAME` or have
   them fix the `repo` setting of the report config.
6. If nothing was submitted, run `finish` so the next scan starts here.

Running this command deliberately is the user's consent to review reports;
there is no registration or opt-in state. Do not fix the reported defect here.
