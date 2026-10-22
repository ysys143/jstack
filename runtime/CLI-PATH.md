# jstack command on PATH

Read this when a step needs `jst` and `command -v jst` prints nothing or the
shell answers `jstack: command not found`. That is a PATH or installation problem,
not a reason to change the task.

## Do not route around it

Do not substitute a Node absolute path to a plugin file, a shell wrapper, an
alias, or a symlink of your own design. The only exception is a packaged script
route that the current skill documents for that step. Report the problem, then
fix its cause with the user.

## Name the likely cause

Tell the user in plain words that `jst` is not on PATH, and which cause fits:

- Claude Code: a jstack SessionStart hook adds the plugin's `payload/bin`, which holds
  the launcher, to the Bash tool's PATH for the session through `CLAUDE_ENV_FILE`.
  `jstack` is missing when that hook did not run or found no launcher: jstack is not
  enabled, the session started before it was enabled (enable jstack in `/plugin`
  and restart the session), hooks are turned off (`disableAllHooks`, or managed
  settings with `allowManagedHooksOnly`, which blocks plugin hooks),
  `JSTACK_NO_PATH_LINK=1` is set, or `payload/bin/jst` is not executable. Hooks and MCP
  servers never get this PATH entry. On claude.ai and in Cowork the plugin
  installs, but there is no `jst` command there; whether Cowork offers a shell is
  unverified. The CLI package below works whatever the hooks do.
- Codex: a SessionStart hook links `~/.local/bin/jst` to the plugin's launcher,
  `payload/bin/jst`. It has not run while the hook is untrusted (the user
  trusts it in `/hooks`, then starts a new session) or in a session that started
  before jstack was installed.
  The link does not help while `~/.local/bin` is not on PATH, and
  `JSTACK_NO_PATH_LINK=1` turns it off. The hook leaves an existing `~/.local/bin/jst`
  that is not a jstack plugin link alone and reports it on startup only.
- Windows: Claude Code runs the Bash tool in Git Bash; the hook writes the directory
  in Git Bash form, and the launcher works there by path and by PATH lookup.
  PowerShell and cmd cannot run it. Codex on Windows gets no automatic link
  because the hook does nothing there, so use the CLI package.
- Any host: the CLI package from the release (`npm install -g` on the release
  tarball, then `jst install`, as in the README) is the supported fallback, and it
  wins over the plugin's launcher: Claude Code adds `payload/bin` after the user's
  own PATH entries, and when another `jst` is anywhere on PATH the Codex hook
  neither creates nor refreshes its link and removes a `~/.local/bin/jst` that is a
  link into a jstack plugin cache, its own or one made by hand. An unrelated program
  named `jst` on PATH takes precedence the same way in both hosts; `command -v jst`
  shows which one runs.

Evidence and its limits: in a headless `claude -p --plugin-dir` session on macOS,
the Bash tool's PATH contained the plugin's `payload/bin` as a late entry. Claude
Code on Windows sourcing the env file in Git Bash, the minimum Claude Code version,
and the Codex hook in a live Codex session, including its trust review, are
unverified; the Codex hook is tested with a simulated plugin cache and a temporary
home. Say so if the user relies on them.

## Propose the fix; apply it only after the user agrees

Show the exact commands for this machine. Do not run them, edit shell profiles,
or install anything until the user agrees. In Claude Code, first propose enabling
jstack and restarting the session, or unsetting `JSTACK_NO_PATH_LINK`. On Windows,
propose the CLI package route instead of the link below.

1. Resolve the installed plugin root with this skill entry's `inspect-root.mjs`
   script and take its `root`. The launcher is `payload/bin/jst` under that root; confirm
   it exists and is executable. Use the real path, never a placeholder.
2. When the link is missing, give the one command with that path in single
   quotes, writing any single quote inside it as `'\''`:
   `mkdir -p "$HOME/.local/bin" && ln -s 'ROOT/payload/bin/jst' "$HOME/.local/bin/jst"`,
   where ROOT is the resolved root. If `~/.local/bin/jst` already exists, show what
   it is and let the user decide; do not overwrite it.
3. When `~/.local/bin` is not on PATH, give the line for the user's shell profile,
   such as `export PATH="$HOME/.local/bin:$PATH"` in `~/.zshrc`, and say that a
   new shell or session picks it up.
4. Verify with `command -v jst && jst --version`.

The link points into one plugin version folder. A trusted Codex hook moves it
after a plugin update; otherwise repeat step 2 when the old folder is gone.

After the fix, continue the original task with plain `jstack ...` commands.
