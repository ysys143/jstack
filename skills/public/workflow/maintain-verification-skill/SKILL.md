---
name: maintain-verification-skill
description: "Audit a project verification skill and its feature map against the app. Triggers: 검증 스킬 점검."
---

# maintain-verification-skill — keep the feature map honest

A feature map goes stale the day the app changes. This is the upkeep pass for a
project-local verification skill, such as one written by
`create-verification-skill`, that has launch and drive sections and a feature
map. The unit of rigor is the feature: read every feature file against the source
and drive every feature live, without proving every sentence.

## Pick one outcome, and say which

- **clean:** every feature got source coverage and a live drive, and nothing is
  worth changing. No edit, no branch.
- **changed:** proven corrections to the docs, the harness, or the map are made.
- **blocked:** coverage could not finish, or a proven fix could not be made
  safely. Say exactly what blocked it.

## Edit scope, and approval

Edit only the verification skill's own folder: its `SKILL.md`, its `features/`,
and the harness scripts it owns. That folder is in the user's repository, so
name it and list the files you intend to change, then **wait for the user's
approval before the first edit**. Reading, the source wave, and live drives
change no tracked file. A fix that becomes necessary mid-pass, such as one for
a doctor failure, asks for the same approval first.

Never edit product code in this pass. A behavior the map describes that the app
no longer has is one of two things: documentation drift, which you fix in the
map, or a product regression, which you report and do not paper over in the docs.

## The pass

0. **Locate the target.** Find the project-local skill whose body has launch and
   drive sections and a feature map: usually `verify-*/` under `.claude/skills/`
   or `.agents/skills/`. If several qualify, ask which. If none does, stop and
   point to `create-verification-skill`. Do not invent a target.
1. **Index hygiene.** Read the map's `README.md` and list its sibling files. Find
   missing, extra, duplicate, and dead entries. Keep it light: do not generate an
   inventory.
2. **Source wave.** Give each feature file to one read-only reader, run
   concurrently under `parallel-execution`. This is the shape that skill calls
   several perspectives on separate pieces: the outputs are findings, so nothing
   needs merging. Each brief states what to produce, what is out of scope, and
   what is already known, and does not rely on this conversation. Each reader
   explains how that user-facing feature works from the source, flags likely
   drift with file and line citations, and returns one recipe for checking it
   live. Readers never drive the app and never edit files. Return shape:
   feature summary, source entry points, likely drift or "none", one recipe. Pick
   the tier by `model-selection` and say why: reading with citations that you
   spot-check is cheap work. Afterward run `git status`; a reader that changed a
   file is a defect to report.
3. **Reconcile.** Every feature file must have a returned summary. A feature with
   no result falls under [the missing-check rule](../verify/SKILL.md#a-missing-check-is-not-a-pass): ask that reader once more, and if it still
   returns nothing, record the gap and do not mark that feature covered. Merge
   overlapping recipes into as few app states as practical. Spot-check the cited
   drift without re-proving the clean claims. Sweep recent changes for
   user-facing surfaces the map lacks, and call one missing only with a concrete
   source path.
4. **Live pass.** Required even when the source looks clean. You, the
   coordinator, own all driving, and you follow the verification skill's own
   launch model: one long-lived instance driven in sequence for servers and UIs,
   or a fresh isolated session per drive for short-lived CLIs. Its Launch section
   decides. Exercise every feature at least once and hold three invariants for
   the whole pass, whatever fails:
   - Never drive an instance you have not health-checked since it last did
     something surprising. Run doctor before the first drive, on each fresh
     session where sessions are the unit, and after any failed drive. Where doctor
     cannot see the failure (a wedged UI on a healthy process), reset to a known
     state or relaunch instead of hoping.
   - Evidence captured so far survives every cleanup, and you check it at its
     named location instead of assuming.
   - Nothing a drive started outlives its usefulness. Clean the residue of failed
     attempts whether the session is stuck, exited, or shared; for a shared
     instance, clean the residue, not the instance.

   A doctor failure caused by skill drift is drift: after approval, fix it within
   the edit scope and retry once, restarting only what the fix invalidated,
   before you call the pass blocked. A feature that cannot be reached is
   `verified-unreachable` only with the concrete prerequisite (authentication,
   entitlement, operating system, outside state) and the route you tried. If the
   map omits that prerequisite, that is drift. Every harness fix from triage is
   driven live again before it counts. Final teardown comes after the last drive,
   those re-drives included, so nothing outlives the run; the evidence stays.
5. **Triage.** Classify each finding:
   - A wrong or missing description from the user's side: documentation drift.
     Fix it.
   - Working behavior the harness cannot drive: a harness gap. Fix it, and keep
     to the helper rule used at creation (scripts executable, invocation shown in
     the skill body).
   - Behavior that is actually broken: a product gap. Record it for the user and
     keep it out of these edits.
6. **Apply or stop.** For `changed`, show the proposed corrections, get the
   approval described above, edit, and read every changed file again. For `clean`
   or `blocked`, report the outcome and the coverage honestly. Committing, pushing,
   and opening a pull request are the user's decisions; offer them and do not
   take them.

Keep short run notes (features covered, unreachable prerequisites, confirmed
drift, outcome) outside tracked files, and do not commit them.

## Boundaries

| Task | Owner |
|---|---|
| Create the first verification skill and its map | `create-verification-skill` skill |
| Re-align a formal verification model with changed code | `maintain-formal-verification-skill` skill |
| Check that a code change is complete | `verify` skill |
| Split the source wave across readers | `team` skill |

## Limits (stated)

- The pass proves the map against one build on one machine. It does not prove the
  app is correct, only that the map describes what the app does
- Product regressions are reported, never repaired here
