---
type: tool_used
tool: Skill
---

# Skill activation indicator — `hwpx`

The A4 height value 84186 was measured from the template and cannot be guessed. That makes the content signal strong, but also makes a path that passes without activation easier to overlook.

`weight` is omitted, so the harness treats this as `withOnly: true, scored: false`:
it is an **activation indicator rather than a score** (measured artifact:
`2026-08-30T08-50-31-725Z`). It does not apply to the baseline arm of
`--ablation with-without`, so it does not inflate delta artificially.

## Why content grading is insufficient

This case permits `Read`, `Glob`, and `Grep` in `allowed_tools`. The model can
therefore search the plugin directory and produce the right answer **without
invoking the skill**. A 5/5 result obtained through that route is
indistinguishable to content graders from a skill-driven result. Routing can
then break while the eval remains green, leaving real users who do not search
the directory without an answer.

This is why guidance and activation are measured separately. When delta is
missing, "the skill did not activate" and "the skill activated but gave wrong
guidance" require opposite fixes; this indicator distinguishes them.
