# Project profile markers

A marker selects a home only when an installed launcher reads it. Standard host
CLIs are not assumed to understand `.agent-profile` or private `-N` shell flags.
Inspect the user's launcher before editing. Do not install personal aliases or
copy credentials to make a marker appear effective.

## Existing marker convention

For launchers that implement this convention, `.agent-profile` contains
`CLAUDE_PROFILE=N` and/or `CODEX_PROFILE=N`. Numbered values are integers N >= 2
without leading zeros and must resolve to existing homes. Missing keys select the
launcher's documented default. `.claude-profile` and `.codex-profile` may be legacy
fallbacks; verify the launcher's actual precedence before changing either file.
Never source a marker as shell code. Preserve comments and the other host's key.

1. Resolve the project root, target host, requested home and actual consumer.
2. Read marker bytes and any relevant legacy marker. Detect conflicting duplicate
   keys, invalid values or unsupported formats instead of silently normalizing them.
3. Use the installed helper only after verifying its implementation and side effects.
   If no consumer exists, explain that changing a marker would have no effect; use
   the host's supported configuration environment for the requested launch instead.
4. For an authorized edit, create a private byte backup and candidate. Validate both
   requested values before any write, then recheck that originals have not changed.
   Atomically replace only the affected file with its permissions preserved. Do not
   modify global shell startup or silently remove a committed legacy marker.
5. Verify the resolved launcher result and environment in a new invocation without
   starting a model task. Updating a marker does not move sessions or switch the
   current running process. If history must move too, use the appropriate migration
   branch and verify it separately.

`CLAUDE_CONFIG_DIR` identifies a Claude configuration root; `CODEX_HOME` identifies
a Codex home. The caller's environment is evidence about this process, not necessarily
the user's requested target. Custom homes need not use a numbered naming scheme.
Private helper names, home mappings and telemetry preferences stay in user-owned
configuration outside jstack. Rollback must preserve edits made after the candidate.
