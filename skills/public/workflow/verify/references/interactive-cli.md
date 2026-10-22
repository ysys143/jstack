# Interactive CLI checks

Use this procedure when a claim depends on what a person sees or types in a
terminal program: a prompt, menu, confirmation dialog, full-screen TUI, REPL, or
an agent CLI session. A non-interactive mode (`--print`, `exec`, piped stdin)
often runs a different code path. Its output does not verify the interactive
surface.

## Decide whether a terminal is needed

Use the non-interactive mode when the claim is about logic or output format; it
is cheaper and deterministic. A real terminal is needed when behavior branches
on whether stdin or stdout is a TTY, when a prompt or dialog decides what
happens next, when the claim is about rendering or key handling (arrows, Escape,
Ctrl combinations), or when hooks, permission prompts, or trust and consent
flows run only in an interactive session.

Look for an existing harness before building one: repository test helpers, demo
scripts, `expect` scripts, or a PTY library already in use (`node-pty`,
`pexpect`). Reuse it when it reaches the surface in question.

## Drive the session with tmux

tmux gives a detached terminal of fixed size whose screen can be read as text.
Save the recipe as one script and run it in one call. An agent's shell tool
starts a new shell for each call, so functions, variables, and the trap do not
carry over. Replace the capitalized placeholders:

```bash
#!/usr/bin/env bash
set -u
S="check-$$"
D=$(mktemp -d)                      # working directory, removed on exit
E=$(mktemp -d); echo "evidence: $E" # saved screens, kept after exit
t() { tmux -L "$S" -f /dev/null "$@"; }
trap 't kill-server 2>/dev/null; rm -rf "$D"' EXIT
t new-session -d -s main -x 200 -y 50 -c "$D" \
  sh -c 'PROGRAM ARGS; echo "[exit=$?]"; sleep 3600'

screen() { t capture-pane -p -J -t main -S -2000; }
wait_for() {  # wait_for PATTERN SECONDS [MIN_COUNT]
  local end=$((SECONDS + $2)) want=${3:-1}
  until (( $(screen | grep -Ec -- "$1") >= want )); do
    (( SECONDS < end )) || { screen > "$E/timeout.txt"; return 1; }
    sleep 0.2
  done
}

wait_for 'READY PATTERN' 30 || exit 1
t send-keys -t main -l -- 'text to type'
t send-keys -t main Enter
wait_for 'RESULT PATTERN' 60 || exit 1
screen > "$E/step-1.txt"
```

- `-L` starts a private tmux server and `-f /dev/null` skips the person's
  configuration, so the check cannot touch their sessions and its one session
  needs no unique name. `sh -c` runs the command in a known shell instead of the
  person's default shell.
- A wide fixed size keeps long lines from wrapping across the text you match;
  `-J` joins lines that still wrap.
- The trailing `echo` and `sleep` keep the pane open after the program exits, so
  the final screen and its exit status stay readable. Full-screen programs may
  clear the screen when they exit; capture what you need before quitting.
- `send-keys -l` types its argument literally, and `--` keeps text that starts
  with `-` from being read as a flag. tmux still drops a trailing `;`; end such
  text with `\;` instead. Without `-l`,
  words such as `Enter`, `Up`, `Escape`, or `C-c` are key names. Send keys in a
  separate call.
- If the program creates Unix sockets under its working directory, keep that
  path short: `sun_path` holds 104 bytes on macOS and 108 on Linux.
- The `trap` is set before the session starts. It stops the server and removes
  the working directory on every exit path, including a failed wait, and keeps
  the evidence directory.

## Wait for the screen, not the clock

Follow every input with a wait for a pattern that proves the action finished,
with a deadline. A fixed sleep is either too short on a slow run or wasted on a
fast one, and it hides the difference between slow and stuck.

Choose a pattern unique to this step. The echo of your own input, or text left
on screen by an earlier step, matches immediately. When the same text recurs,
pass the number of matches you expect (`wait_for '^5$' 10 2`) so the wait needs a
new occurrence. A process exit is the `[exit=N]` line.

A timeout is a failure with evidence: keep the saved screen and report what was
on it. Do not retry the same input and report the second attempt as a pass.

Keys can be lost or misread in ways the screen does not announce:

- A dialog may drop keys that arrive while it is still drawing. Wait until the
  screen has been unchanged for about a second before the first key, and confirm
  that each arrow key moved the highlight before pressing Enter.
- Screens use non-ASCII spacing; Claude Code follows its prompt glyph with a
  no-break space. Match spacing with a class such as `\s`, not a literal space.
- Escape and Ctrl-U may leave typed text in place. Delete it with `BSpace` and
  confirm the input line is empty before typing the next input.

## Judge from durable state

The screen holds only what fits and is visible; it is cut, reflowed, and
stripped of color. Judge the result from durable state when it exists: files the
program wrote, its logs, a database row, or the exit status. Use the screen for
what only the screen shows, such as whether a dialog appeared or which option
was highlighted. Save each step's screen to a numbered file as the transcript.

## Agent CLI sessions

An interactive Claude Code or Codex session runs hooks, MCP servers, permission
prompts, and trust dialogs as a person sees them. `claude -p` and `codex exec`
skip or change some of these, so their evidence does not cover the interactive
path.

- Read the screen before answering a trust or permission dialog. Whether it
  appears depends on the directory and the host version, and the highlighted
  default may be the option that exits. Send the keys that select the option
  you mean, then confirm the screen changed.
- Codex approves new or changed hooks only in its TUI, through the startup
  "Hooks need review" modal or the in-session hooks browser. Trusting writes
  `hooks.state.<key>.trusted_hash` to `config.toml`. Hook trust, and the hooks
  it gates, therefore need an interactive session.
- If a permission prompt, policy, or classifier blocks the tool call before the
  target runs, the target was not exercised. Report it as not verified.
- These sessions use the real account and model, so they need a login and cost
  usage; they do not belong in CI. Never type credentials with `send-keys`. If a
  login screen appears, stop and ask the person.
- A session writes trust entries, prompt history, and file backups into the
  configuration home it uses. Point it at a dedicated, logged-in home
  (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`) rather than the person's own, and run it
  in a disposable directory. Load the plugin under test for the session only
  when the host allows it (Claude Code `--plugin-dir`). Afterwards restore state
  the check created in that home, such as installed plugins or hook trust, so
  the next run starts from the same state.

## Clean up

Stop the server and remove the working directory on every path; the `trap`
above does both. Then confirm nothing remains: no process the check started is
still running. Agent CLIs may start background daemons that leave the session's
process tree and outlive it; Codex 0.159 left an `app-server` daemon running
from its disposable home. List processes naming that home before the check
(`pgrep -f "$HOME_DIR"`), and afterwards stop only the ones that are new. Wait
for stopped processes to exit before restoring configuration they might still
write. Remove state the program created elsewhere, or report that it remains.

## Without tmux

The same rules apply to other drivers: wait for a pattern with a deadline, judge
from durable state, and clean up. Options include `expect`, Python `pexpect` or
`pty`, and Node `node-pty`. `script` differs between BSD and util-linux; check
its arguments on the target system. Native Windows programs need a ConPTY-based
driver. A run under WSL is Linux evidence, not Windows evidence.

## Record

For each step, record the input sent, the pattern waited for, the elapsed time,
and the saved screen file. End with the durable-state evidence for the verdict
and anything the session did not exercise, such as a blocked tool call, a
dialog that never appeared, or a login that was required.
