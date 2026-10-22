---
description: Initialize jstack and save an organization profile
---

# /init — optional organization onboarding

Use the profile, account, and task scope in `$ARGUMENTS` when supplied. This command
is separate from the task contract created by `skills/verify/scripts/workflow.js init`.
Users who do not use organization features can use jstack without this setup.

Read `${CLAUDE_PLUGIN_ROOT}/runtime/ONBOARDING.md` and follow its sequence:
inspect existing settings, select an account, discover read-only candidates, ask
about ambiguous values, and save locally. Here `JSTACK_PLUGIN_ROOT` is the actual
installed `${CLAUDE_PLUGIN_ROOT}`.

Do not copy credentials or perform remote writes or mail delivery. When reusing an
existing profile, preserve manual settings and apply only selected changes. Report
the storage path and unset fields; a successful save does not prove task execution.
