---
description: Inspect project checks or record a setup decision
argument-hint: "status | recommend | configured | without-setup | reopen"
allowed-tools: Read, Bash(node:*), AskUserQuestion
---

# jstack Project Checks

Use the packaged decision command in the current project. The decision is stored
in the worktree-specific Git directory or a user-local state cache. It does not
create `.jstack/`, install a checker, format files, or change hook trust.

Run status first:

```bash
node "${CLAUDE_PLUGIN_ROOT}/runtime/project-hooks/decision_cli.js" status
```

For a user-requested recommendation, inspect only the named changed files. This
does not approve setup, create a manifest, or run a checker. Include one `--path`
per project-relative file; without paths, the result is `no-check`.

```bash
node "${CLAUDE_PLUGIN_ROOT}/runtime/project-hooks/decision_cli.js" recommend --path src/example.py
```

If the user invoked this command with `configured` or `without-setup`, that
argument is their explicit choice. If there is no choice, ask the user to select
one of those two options and wait for the answer. Silence, existing config files,
or the current project type do not supply approval. `reopen` is also an explicit
user choice. Do not invoke `choose` or `reopen` without that evidence.

After the explicit choice, run exactly one command with the corresponding value.
Use the host message or command invocation identifier as `REF`; if the host does
not expose one, use `claude-command:project-checks` for a direct command invocation.
Never put the user's message text in the reference.

```bash
node "${CLAUDE_PLUGIN_ROOT}/runtime/project-hooks/decision_cli.js" choose configured --host claude --message-ref REF
node "${CLAUDE_PLUGIN_ROOT}/runtime/project-hooks/decision_cli.js" choose without-setup --host claude --message-ref REF
node "${CLAUDE_PLUGIN_ROOT}/runtime/project-hooks/decision_cli.js" reopen --host claude --message-ref REF
```

Run only the one line matching the user's answer. Report the recorded choice and
state location. A `configured` decision allows the existing project hook to run
checks at its documented boundaries; it does not select a formatter or authorize
creating `pyproject.toml`. If a checker or project manifest is missing, describe
the gap and ask separately before changing project files. A `without-setup`
decision keeps persistent jstack project checks inactive; the user can still request
a one-off check.
