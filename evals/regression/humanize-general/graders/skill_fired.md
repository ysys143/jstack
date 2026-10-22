---
type: tool_used
tool: Skill
---

# Skill activation indicator

Did the `humanize` skill actually run?

This is a `with-only` grader, so it is an **activation indicator rather than a
score**. It does not apply to the baseline arm without the plugin during
`--ablation with-without`.

Promotion condition 4 targets exactly this distinction: if the score is good
when our skill did not activate, the baseline is good; our skill did not earn
that result.
