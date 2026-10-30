# Unified Hook Contract

`hooks.json` is the registration both hosts read. Claude Code also reads
`claude-hooks.json`, which its manifest names (see `jst-path.js`), and Codex also
reads `codex-hooks.json` (see `link-jst.js`); neither host reads the other's file.
`hooks.json` runs one dispatcher for each
tool event, plus the existing Stop and SessionStart handlers. The dispatcher
routes legacy policy functions after cheap event filters; their individual
contracts below describe policy behavior, not separate host registrations.
Run validation commands from the source checkout; they inspect the corresponding
suite in a temporary runtime.

## Secret-output protection support boundary

The packaged `secret-guard.ts` is an **unregistered candidate**, not an active
protection guarantee. It is not named in `hooks.json`, `claude-hooks.json`,
`codex-hooks.json` or `hook-policies.ts`, and `dispatch.ts` does not call it, so
neither host nor the dispatcher runs it. Its denial JSON is sanitized and its
malformed-input path denies, but neither property makes host hook absence or
runtime failure fail closed.

Host behavior below is the account of an original probe record, whose reports and
synthetic fixtures are not part of this repository and were not reproduced from
this tree. That record used Claude Code 2.1.273 and Codex CLI 0.154.0 with scripted
local API responses and synthetic environment-file values (2026-09-16). It states
that both hosts denied literal `cat .env` when the candidate hook ran, and that both
executed the read when the hook was absent, missing, timed out, exited with an
error, or returned malformed output. It adds that Codex also executed the read when
its non-managed hook was untrusted, that Codex supports plugin lifecycle hook
discovery and requires trust for non-managed hooks, and that an interpreter that
constructs the protected path dynamically passes the candidate's command
inspection. Those inline probes do not establish ordinary installed-plugin
activation, all-tool coverage, or model behavior. This candidate is not an output
filter or an arbitrary-program security boundary.

Therefore fail-closed secret-output protection and trusted policy exceptions are
**unsupported** on these tested paths. Known defects of the candidate:

- Bypasses. Independent review reported plain-shell quote/backslash splicing and
  case-insensitive filename bypasses, and `.envrc` is outside the candidate
  matcher. Reproduced against this tree's compiled hook: `cat .e"n"v`, `cat .e\nv`,
  `python3 -c "open('.e'+'nv')"` and `cat .envrc` are not denied. A case variant
  such as `cat .ENV`, or a `Read` of `.ENV`, is not denied either; on a
  case-insensitive file system (the macOS and Windows default) it reaches the
  protected file. That was re-run on macOS only, where `.ENV` resolved to the
  `.env` file.
- Codex shell calls. The candidate reads only a string `tool_input.command`. Codex
  sends `exec_command` with `cmd`, and a call to one of the candidate's tools may
  carry an argv array instead; the candidate denies both as malformed input.
  Registered as a standalone hook command that receives the raw host payload, it
  would therefore block every Codex `exec_command` call, including `ls`, instead of
  inspecting it. `local_shell` and `container.exec` are not in its tool list, so a
  standalone registration would pass them uninspected. Through the dispatcher a
  policy would receive the normalized event, where `hook-event.ts` already extracts
  the command from `cmd` or an argv array. No adapter exists, so this tree does not
  show how the candidate behaves on that path.
- Over-blocking. A search without a path (`rg` or `grep -r` on the working tree, or
  the `Grep` tool with no `path`) inspects the whole working tree, and the walk is
  limited to 10,000 entries. A larger tree, such as this repository's checkout, is
  denied as "Guard inspection failed" although it holds no environment file. Any
  shell command that contains `.env` at a word boundary or followed by a dot is also
  denied before the command is read, whether or not it touches a file. Both
  `git add .env.example` and an `echo` that only mentions `.env` are denied.

These remain open defects and prohibit registration or protection claims. A project
file, command marker, or assistant claim cannot approve an exception; no
agent-inaccessible approval/consume anchor has been established. Do not register
this candidate as a ready protection layer or recommend disabling other hooks to
work around it. Existing hooks remain independent of SDLC selection.

Registration is allowed only after the HK1 evidence that ADR 0006
(`0006-policy-hook-exceptions.md`) and the hooks workstream plan
(`workstream-hooks.md`) require: guard enforcement, guard-internal-error denial, and
runtime-absent behavior observed per host and version, plus a trusted exception
anchor. Both documents are design records kept outside this repository; the
installed package does not contain them.

## Chain order

| # | Hook | Matcher | Why it occupies this position |
|---|---|---|---|
| 1 | `dispatch.js` | `Bash\|exec_command\|apply_patch\|Write\|Edit\|MultiEdit\|NotebookEdit\|Read` | Normalizes the event and runs only matching policies; cheap guards precede expensive checks |

## Other event registrations

| Event | Order | Hook |
|---|---:|---|
| PostToolUse | 1 | `dispatch.js` |
| Stop | 1 | `commit-session.js` |
| SessionStart | 1 | `load-recent-changes.js` |
| SessionStart | 2 | `ensure-statusline.mjs` |

The active dispatcher emits host-compatible JSON; the legacy exit contracts below
apply only when a policy module is executed directly for migration comparison.
The status line and automatic commit hooks are off by default and operate only
after explicit opt-in. Any order change must update both registration and this table.

## block_emoji.js

This enforces the organization's No-Emoji policy at write time: no emoji in
content a tool writes unless the user asked for it. No other instruction file is
assumed to carry the policy. The hook cannot see the conversation, so its block
message tells the agent about the user-request exemption and points to
`payload/skills/emoji/SKILL.md` in the installed package (source tree:
`skills/support/emoji-policy/SKILL.md`). `hooks/block_emoji.js` is the single
canonical implementation.

```contract
matcher:   Edit|Write|MultiEdit|NotebookEdit|Bash
event:     PreToolUse (first in the chain)
input:     stdin JSON {"tool_name": str, "tool_input": {...}}
block when: write content in tool_input contains at least one emoji code point
exit contract: exit 0 + stdout JSON {"decision":"block"} (not a nonzero exit)
pass contract: exit 0 with no stdout
fail-open: yes — SyntaxError is silent; other exceptions print to stderr and pass
output:    block reason "Emoji detected in content: <list>." (up to ten distinct emojis found, each with its code point) + ASCII replacement guidance + pointer to the user-request exemption
verify:    node --test hooks/hooks-migration.test.js
RED:       deleting the NotebookEdit branch fails `emoji preserves all write-tool decisions and read-only negative controls`
```

### Fields read by the matcher differ by tool

Adding a tool to the matcher without adding its code branch **silently passes**.
`content_to_check` remains empty and exits through
`if not content_to_check: return`. This happened twice, for MultiEdit and NotebookEdit.

| Tool | Field read | Branch |
|---|---|---|
| `Write` | `content` | Present |
| `Edit` | `new_string` | Present |
| `MultiEdit` | `edits[].new_string` (joined) | Present |
| `NotebookEdit` | `new_source` | Present |
| `Bash` | `command` — **only for write-shaped commands** | Present |

**Add the branch before adding a tool to the matcher.** Reversing that order makes
coverage look broader while blocking nothing.

### Coverage (resolution of open item U-5, finalized as (b) after (a))

Plan §10.9 F-5 requires this section to state any difference between the hook's
claimed coverage and the matcher's actual coverage. **There is currently no gap.**

| | Status |
|---|---|
| **Covered** | `Write` · `Edit` · `MultiEdit` · `NotebookEdit` · **writes through `Bash`** |
| **Not covered** | None |

Bash was an accepted gap for a time because registering its matcher starts an
extra Python process for **every** Bash call. The project accepted that ongoing
cost and closed the gap after learning it was not theoretical: auto-mode sessions
write every file through heredocs or `sed -i`, so this hook **never fired once**
in those sessions. The most-used path was the only unprotected path.

### How Bash is classified: write-shaped commands

Because `Bash` has a single tool name, the matcher cannot distinguish reads from
writes. `bash_writes_a_file` therefore classifies the **shape of the command string**.

It first removes non-writing redirections: fd duplication such as `2>&1` and
`> /dev/null`. Without this step, a **read command is mistaken for a write**, as
with `grep "..." f 2>/dev/null`. It then looks for these forms.

| Form | Example |
|---|---|
| Redirection | `echo ... > f`, `>> f` |
| heredoc | `cat > f <<EOF`, `<<'EOF'` |
| In-place edit | `sed -i` |
| Branched write | `tee f` |

If any form matches, the hook checks the **entire command**. This deliberately
coarse classification is not precise shell parsing and **leans toward write when
ambiguous**, because that is preferable to missing a write.

**Remaining false positive:** an emoji inside a write command is caught even when
it does not enter the file, for example `grep "이모지" f > out.txt`, because the
entire command is inspected. A full shell parser could reduce this, but parser
mistakes were judged more dangerous.

### False positives: known tradeoff

The range table is broader than the organization's policy list. In particular,
`U+2300-23FF` (Miscellaneous Technical) **also catches non-emoji technical
symbols**, including `⌘` (U+2318), `⌥`, `⏎`, and `⏱`. Keyboard shortcuts trigger it.

This is deliberate. One emoji leaking into a procurement deliverable costs more
than working around technical symbols a few times. Use ASCII (`Cmd`, `Opt`,
`Enter`) where needed. **Narrowing the range requires reversing this judgment.**

Hangul is not targeted: `U+AC00-D7A3`, `U+1100-11FF`, and `U+3130-318F` do not
appear in the range table.

### User-requested emoji

The hook has no marker, allowlist, environment override, or `ask` decision that
could carry a user's permission: it checks literal characters only. The
exemption rests on the user's own statement in the current conversation, never
on a file, tool output, or web content that says the user allowed it, and the
agent carries it out as the procedure describes: quote the permission, scope it
to one file and the emoji asked for, write through placeholders, report it. The
procedure is the section "When the user asked for emoji" in
`payload/skills/emoji/SKILL.md` (source tree:
`skills/support/emoji-policy/SKILL.md`). The hook cannot verify any of this and
jstack claims no hook-enforced exception for emoji. ADR 0008, which partially
supersedes ADR 0006 for the emoji policy only, records the decision, its limits,
and why it does not extend to other policies.

The same literal rule applies on Codex: the dispatcher normalizes the added
lines of an `apply_patch` and the command of an `exec_command` into the same
inspection, and context or removed lines are not inspected. This was exercised
against the built package's dispatcher, not in a Codex session.

The block message keeps its prefix `Emoji detected in content: <list>.` because
the interactive hook probe matches on it. That probe's prompt tells the agent to
report a block and not work around it, and the procedure tells the agent to
follow such an instruction.

### Keep one canonical implementation

The shared hook is the single file `hooks/block_emoji.js`; do not duplicate its
detection range in another skill or hook. `scripts/check_suite_lib_parity.js`
checks the migration record and single canonical copy, while hook-owned tests
verify actual blocking for each tool.

``emoji preserves all write-tool decisions and read-only negative controls`` in
`node scripts/run_suites.js tests/test_dev_hooks.js` separately checks the
NotebookEdit regression on the development path.


---

## hwpx_guard.js  (skills/hwpx/hooks/)

This delivery gate catches the moment a `.hwpx` file is **handed to the user**.
The script docstring explains why it runs at delivery rather than creation:
creation has many paths, while delivery has one point.

**This file belongs to the `hwpx` skill and lives in that skill's directory.**
The hook layer performs **registration only**; the script docstring is canonical
for the judgment contract. This document records the registration contract: event,
matcher, and exit convention.

```contract
matcher:   Bash|Read|Write|Edit
event:     PreToolUse (second in the chain)
input:     stdin JSON {"tool_input": {...}} — tool_name is not read
block when: an extracted `.hwpx` path **exists** and the file has (a) a
            compressed or non-first mimetype entry, (b) a missing required
            entry (Contents/header.xml or section0.xml), (c) a client-preview
            thumbnail, or (d) charPr that points to a bordered borderFill
exit contract: exit 0 + stdout JSON {"decision":"block"}, like block_emoji
pass contract: exit 0 with no stdout
fail-open: yes — all five paths under "What passes" below pass
output:    per-path defect list + `validate_hwpx.py --semantic` reproduction command
verify:    node scripts/run_suites.js tests/test_work_hooks.js
RED:       a Bash payload containing an HWPX with compressed mimetype must block
```

### Why the matcher is `Bash|Read|Write|Edit`

**The registration copies the script's own declaration.** Its docstring ends with
`{"matcher": "Bash|Read|Write|Edit", ...}`. Because the file belongs to hwpx and
cannot be corrected in the hook layer, narrowing registration would create a
**declaration-to-reality mismatch inside a file this layer cannot fix**. This
repository has repeatedly failed in that form.

The code also handles all four tools **identically**, with no tool-specific branch
like block_emoji. `candidate_paths` joins every string value in `tool_input` and
finds `.hwpx` paths, so Bash `command` and Read/Write/Edit `file_path` all enter
the same path. The **illusion of broad matching that silently passes because no
branch exists**, which hit block_emoji twice, does not apply here.
`TestTheGuardMatcherMatchesItsOwnDeclaration` in `tests/test_hooks.py` mechanically
compares the docstring registration example with the matcher in `hooks.json`.

**The cost is continuous.** `Read` is the most frequently called tool in this
tree, and registration starts one extra Python process for **every Read** (27 ms
when it does not fire). This cost was accepted; reducing it requires reversing
that judgment.

### What passes: five fail-open paths

**Block only when a defect is confirmed.** Blocking when the hook cannot decide
would let a hook defect stop the user's work.

| Path | Behavior |
|---|---|
| stdin is not JSON | Pass silently (`json.JSONDecodeError`) |
| `tool_input` is not a dict | Pass silently |
| Extracted path does not exist | Skip it; deliverables not yet created reach this path |
| ZIP opening or XML parsing fails | Skip the path (`except Exception: continue`) |
| Any other exception | Print to stderr and pass |

### OWN_TOOLS bypass to avoid deadlock

If `command` contains one of the skill's own nine script names, including
`md_to_hwpx.py`, `validate_hwpx.py`, `fix_borders.py`, or `sanitize_template.py`,
it **passes without checking anything**. Blocking the command needed to repair a
defect would create a deadlock instead of a gate.

**This bypass works only for `Bash`**, the only tool with a `command` field.
Touching a defective `.hwpx` through Read/Write/Edit is blocked without bypass.
This has not caused practical problems because `.hwpx` is a binary ZIP and all
diagnosis and repair goes through Bash scripts. **If attempts to repair HWPX with
text tools increase, this will be the first pressure point.**

### Registration lives outside the skill

The hook script lives under `skills/hwpx/hooks/`, while `hooks/hooks.json`
registers it. Thus, **deleting the hwpx skill leaves this hook pointing to a
missing file**. To prevent silent passage, `test_every_registered_command_points_at_a_real_file`
in `tests/test_hooks.py` checks that every registered command's script exists.

---

## check_model_versions.js

Prevents obsolete LLM model names from entering code or documentation. The model
database is `scripts/models_database.js`, and its location outside the hook
directory matters. The old plugin kept them together; migration separated them,
and a silent import failure reaches the `sys.exit(0)` below and **disables the
entire checker**.

```contract
matcher:   Write|Edit|Bash
fail-open: exceptions pass; ordinary validation failures follow the exit contract
block when: an obsolete model absent from pyproject.toml approved_legacy_models
            appears outside a path in Write content or Edit new_string, or in
            the judged text of a Bash command: every word and input of a
            command that runs something; a data command (search, print, git/gh
            record, query, path tool, pytest test paths, -k/-m filters and path
            options) is judged only where its output reaches a command that runs
warn when:  a Bash command writes a file (block_emoji's write shapes, or an
            in-place sed, yq, awk or perl edit) and carries an obsolete model
            anywhere outside a path, bare names included
exit contract: stderr + exit 1 (nonzero exit)
output:    obsolete model name + recommended replacement
verify:    node scripts/run_suites.js tests/test_dev_hooks.js
RED:       making scripts/models_database.js unreadable disables the entire check
```

**WARN_ONLY path:** warning-level judgments do not block; they emit
`hookSpecificOutput.additionalContext` and exit 0. Thus **this hook has both
blocking and non-blocking exits**. A test that only treats nonzero as blocked
understands only half of this hook.

**Bash: selection blocks, written text warns.** The hook parses the command into
simple commands, honoring quotes, `;`, `&&`, `||`, `|`, `$(...)`, backticks,
`${...}`, `$((...))`, `$[...]`, process substitution, subshells, brace groups,
`if`, `case` and loops, comments, redirections, here-strings and heredocs.

- A command that runs something (an interpreter, a CLI, `curl`, `case`) is
  judged with every pattern over its words and its input (heredoc bodies,
  here-strings). For names the bare-name patterns recognise (`gpt-`, `claude-`,
  `gemini-`, `qwen`, `kimi-k`, `deepseek-v`, `glm-`, `solar-`, `kanana-`,
  `exaone-`), provider prefixes (`openai/<name>`), escaped JSON, `-m` and other
  flag spellings, positional names and trailing punctuation therefore match.
  Bash joins the quoted pieces of one word, so the words are also judged with
  their quotes removed. `break`, `continue`, `return`, `exit`, `sleep`, `wait`,
  `shift`, `set` and `unset` are judged the same way but do not count as
  running something.
- A data command contributes only the words before its arguments: assignments,
  wrappers (`sudo`, `doas`, `env`, `nice`, `ionice`, `setsid`, `time`,
  `timeout`, `xargs`, `stdbuf`, `nohup`, `command`, `exec`, `python -m`,
  `uv run`, `uvx`, `poetry run`, `pipenv run`, `pdm run`, `hatch run`) and the
  command word. Data commands are the grep
  family, `echo`, `printf`, `cat`, `head`, `tail`, `jq`, `yq`, `awk`, `sed`,
  `find`, `fd`, `git`, `gh`, `sqlite3`, `duckdb`, `psql`, `mysql`, `aws s3`,
  path tools such as `ls`, `cd`, `cp`, `tar`, `zip` and `rsync`, `test`, `[`,
  `[[`, and `pytest`. pytest test paths, node ids, the `-k`/`-m` filters and
  path options (`--deselect`, `--ignore`, `--junitxml`, `--rootdir`, `-c` and
  others) are data; every other option is judged with its value, a short
  option's value when the option takes one and a long option's value unless it
  names a test file, node id or directory. `gh models`, `gh workflow run`,
  `gh variable set`, `gh secret set` and a `gh api` call with fields or
  `--input` and no `-X GET` run or dispatch something and are judged.
- A data command's text is judged when its output reaches a command that runs:
  through a pipe, a command substitution in that command's arguments, or the
  closer of a brace group, subshell, `if` or loop piped into one, as in
  `echo '{"model": ...}' | curl -d @-`. An emitter (`echo`, `printf`, `cat` of a
  heredoc or here-string, `jq -n`, `yq -n`) is also judged when its output is
  assigned to a variable or a loop list, as in `BODY=$(jq -n ...)`.
- Assignments and the assigning builtins (`read`, `mapfile`, `readarray`,
  `export`, `declare`, `local`, `typeset`, `readonly`, `printf -v`) are judged
  with their substitutions removed. A `for` or `select` list and the input of a
  compound command (a heredoc, here-string or process substitution after its
  closer) are judged only when the group's values go somewhere: its body runs
  something, its output reaches a command that runs, or its output is assigned
  and its body prints. Command substitutions in them count for emitters only.
- Commands another command runs are judged on their own: command and process
  substitutions (also inside `${...}`), `find -exec`, `fd -x`, `git bisect run`,
  `git rebase --exec`, `git submodule foreach`, and the values of `git -c`
  aliases starting with `!`, pagers, editors, `*.cmd` and `sshcommand`. A
  selection beside a data command, or inside one of these, is therefore judged;
  data commands that run programs in other ways are listed under Known limits.
- A redirection target is not judged as a selection. The redirection writes a
  file, so the whole command, target included, is checked as advisory context.
- A command nested more than 50 levels deep (substitutions, subshells and
  process substitutions inside one another), or a command string nested more
  than 50 deep inside other command strings, makes the whole command be judged
  as one text, as the hook did before it parsed commands. Sibling command
  strings do not add up.
- File writes are advisory: a heredoc, redirect, `tee` or in-place edit
  (`sed -i` and its clusters, `--in-place`, `yq -i`, `awk -i inplace`) keeps
  every pattern over the whole command but only warns, because the hook cannot
  tell a JSONL record or a stats file from code. In auto mode a Bash write of
  project code therefore only warns, while the Write tool blocks the same text
  in a code file. `perl -i` counts as a write too, but perl runs its script as
  code, so a name in the script blocks.

**A name inside a path is not a model (#144).** Wherever a name is matched
(Write, Edit, MultiEdit and NotebookEdit content, the judged text of a Bash
command and the text a Bash command writes), a match that is part of a path is
skipped before it is judged or deduplicated:

- a dot-directory or dot-file name: the name directly follows a `.` that starts
  a path segment, that is a `.` after `/`, `~`, `=`, a quote, whitespace or the
  start of the text (`~/.<name>`, `$HOME/.<name>`, `CLAUDE_CONFIG_DIR=.<name>`);
- a directory component: the name is directly followed by `/`
  (`results/<name>/out.json`, `~/.<name>/plugins`), unless it ends the
  replacement of an `s/old/<name>/` substitution on one line whose `s` does not
  follow a letter or `_`, which is text written into a file.

A multi-profile setup's `CLAUDE_CONFIG_DIR=$HOME/.claude-<n> claude ...` and a
loop over profile directories therefore pass. A provider-prefixed value
(`anthropic/<name>`, `openai/<name>`, `bedrock/<name>`), a Bedrock model id
(`anthropic.<name>`) and a name followed by other punctuation (`<name>:latest`,
`<name>;`, `<name>,`) are still names, and a selection later in the same text is
still found after a path mention of the same name was skipped.

Known limits. A shell heuristic cannot close the long tail; each item below is
deliberate or documented rather than fixed.

- Names without a bare-name pattern are found only through `--model <name>` or
  a quoted `model=`/`model:` setting. `llm -m <name>`, a JSON body, an
  unquoted `OPENAI_MODEL=<name>` and `--model=openai/<name>` pass for o1,
  o1-mini, o1-preview, o1-pro, o3, o3-mini, o3-pro, o4-mini, deepseek-chat,
  deepseek-reasoner, kimi-latest and deepseek-v4-flash (measured against the
  current database). The name patterns are not widened here.
- A name directly followed by `.` and name characters (`<name>.json`,
  `<name>.log`) is read as one longer name. Most such names are unknown to the
  database and pass; a name covered by one of the database's prefix rules is
  still recognised.
- Code given to an interpreter (`python -c`, `node -e`, `perl -ne`,
  `python - <<EOF`) is judged like code in a file, so a bare name blocks even
  inside `print(...)` or a search pattern.
- A program argument or piped input that only names a model, outside a path,
  blocks: `python update_db.py --remove <name>`, `echo "compare <name>" |
  llm`, `echo <name> | pbcopy`, `open <url with name>`, `glab mr create
  --title <name>`, test filters of runners other than pytest
  (`npm test -- --grep <name>`), and a
  `gh api` search with `-f` but no `-X GET`. An assignment of a name
  (`export GREP_PATTERN=<name>`) and a `case` pattern block too, and so does
  a backtick inside a double-quoted message, which bash runs as a command.
- A selection that reaches a command through an intermediate file (`echo
  '{"model": ...}' > req.json && curl -d @req.json`, `gh api --input req.json`)
  or through `git config` is only advisory or passes.
- Values the shell computes are not resolved: a name assembled from variables
  or command output (`M=<part>; llm -m "${M}<rest>"`, `"$(printf ...)"`) passes,
  and a value found by a search and stored in a variable or loop list
  (`MODEL=$(grep -o <name> config.toml)`) is data.
- A data loop or group piped into any other program is judged as feeding a
  command that runs, so `for m in <name>; do grep -c "$m" f; done | paste -sd+ |
  bc` blocks. A `case` word (`case "$(grep -c <name> f)" in`) and an array
  assignment (`models=(<name> other)`) block like other judged words.
- Not parsed: strings run by `bash -c`, `eval`, `ssh` or `watch` are judged as
  words, so a search inside them blocks; aliases and functions are not resolved;
  a `case` pattern's `)` inside `$(...)` ends the substitution early; `$(...)`
  in an unquoted heredoc body and quotes inside `${...}` are not tracked.
- Data commands that can run a model pass: awk `system()`, the sed `e` command,
  `rg --pre`, SQL functions in `psql` or `duckdb` that call a model, git
  commands and config keys that run a program other than those listed above
  (`git filter-branch --tree-filter`, `git -c credential.helper='!...'`,
  `git -c diff.external=...`), and `gh extension exec`.
- The direction of `>(...)` is not distinguished: a process substitution that
  receives output is judged like one that supplies input, so
  `tee >(curl -d @-)` only warns.
- block_emoji counts every heredoc and here-string as a write, so a commit
  message heredoc or a data loop fed by a here-string that names an obsolete
  model gets advisory context.
- Case-insensitive matching of a few non-ASCII letters differs between Python
  and JavaScript regular expressions (Python folds U+017F to `s`); twin parity is
  not claimed for those letters.
- The path rule reads characters, not intent. A name used as a URL path
  segment followed by `/` (a REST path such as `.../model/<name>/invoke`), a
  model value with a trailing `/` and a search pattern `/<name>/` pass. A
  directory named `s` two segments before a name followed by `/` (`/s/x/<name>/`)
  reads as a substitution and is judged, and a name after a `.` that follows
  another character (`x.<name>`), a backtick or `:` is still a name.
- `extractModels` computes character offsets per match, so a command with
  thousands of distinct name-shaped words takes seconds to tens of seconds in
  the TypeScript twin.

**Disable with** `check_model_versions = false` in `pyproject.toml`.
**Fail-open:** exceptions print to stderr and exit 0, so **a broken hook silently
passes**. This is why model-database freshness needs a behavioral canary (§9).

---

## validate_uv_usage.js

Requires `uv` instead of `pip`.

```contract
matcher:   Bash
fail-open: exceptions pass; ordinary validation failures follow the exit contract
block when: command invokes pip, pip3, or pipx; also when it invokes `uv pip`
            without a .venv (a separate check disabled through venv_check)
exit contract: exit 0 + stdout JSON {"decision":"block"}
output:    blocked pip command + corresponding uv command
verify:    node scripts/run_suites.js tests/test_dev_hooks.js
RED:       the `pip install x` fixture must not pass
```

**Disable through** `pyproject.toml`. **Fail-open:** exceptions emit only a
`systemMessage` and pass.

---

## ruff_check_before_commit.js

Formats and checks staged Python files immediately before a commit.

```contract
matcher:   Bash
fail-open: exceptions pass; ordinary validation failures follow the exit contract
block when: command is `git commit`, at least one staged file is Python, and
            ruff check or pyright fails
exit contract: exit 0 + stdout JSON {"decision":"block"}
output:    ruff/pyright diagnostics + list of formatted files
verify:    node scripts/run_suites.js tests/test_dev_hooks.js
RED:       git commit must not pass with a staged ruff violation
```

**This is not read-only.** It runs `ruff format` before judgment and **restages
formatted files**. Even if it blocks, the worktree has already changed. It is the
only PreToolUse hook in this plugin with side effects, which is why it runs last.

**`--no-verify` cannot bypass this hook.** That option disables **Git's own**
hooks under `.git/hooks/`; this Claude Code PreToolUse hook intercepts the Bash
call itself. Its predicate `\bgit\s+commit\b` also matches
`git commit --no-verify`. The ledger note at :453 saying that `--no-verify`
bypasses hooks refers to `hooks/commit-session.js`, not this hook.

---

## ruff_check_after_edit.js

This is PostToolUse. **The write has already completed, so it provides feedback
rather than blocking.**

```contract
matcher:   Write|Edit   (PostToolUse)
fail-open: exceptions pass; ordinary validation failures follow the exit contract
block when: not applicable after an irreversible write; the feedback condition is
            an existing .py target for which ruff check or pyright fails
exit contract: stderr + exit 2 (PostToolUse feedback; neither 0 nor 1)
output:    diagnostics grouped by whether automatic repair is available
verify:    node scripts/run_suites.js tests/test_dev_hooks.js
RED:       writing a file with a ruff violation must produce exit 2
```

**Why exit 2 is the convention:** in PostToolUse, exit 2 returns stderr to the
agent so it can repair the problem. Applying "nonzero means blocked" would
**mistake a non-blocking hook for a blocker**. Three hooks use three conventions,
which is why `exit contract:` is required in this file.

---

## validate_pr_label.js

Checks whether a locally invoked `gh pr create` follows **that repository's** label policy. The hook reads simple local command chains and follows literal `cd`, `cd --`, `pushd`, `~/`, `$HOME`/`${HOME}`, other environment variables, and plain assignments made earlier in the chain. A prefix assignment on the same `cd` command does not affect that command's argument expansions; only the earlier environment does. It starts from hook input `cwd`, not the hook process directory. Quoted examples, comments, heredoc data (including quoted or escaped delimiters), and literal arguments to `echo`, `git commit`, or `node -e` do not invoke PR creation; shell text is never executed by this reader. A directory that cannot be resolved yields only a `systemMessage` notice, never a block based on the session directory.

A linked worktree's own `.claude/pr-policy.json` wins, including an empty opt-out or a broken file. Only when that file is missing does the hook read the main checkout's policy via Git's common directory. That fallback is read-only: it never refreshes or saves the main checkout's file. An explicit `-R`/`--repo` before `pr create` or in its options enforces local policy when the named GitHub owner/repository matches the checkout's `origin` URL (HTTPS or `git@github.com:`). Other or unrecognized targets receive a target-specific notice without applying unrelated local policy or registering remote policy. This reader does not cover full shell grammar, dynamic command substitutions, arbitrary wrappers, remote/SSH commands, or scripts written into files.

The old `session-and-git` version plugin-relative policy: it passed unless the owner was
one fixed organization, and its category list was constant. It did nothing in other
organizations' repositories and required code changes when labels grew in ours.
This version **reads policy from the repository**.

```contract
matcher:   Bash
fail-open: unknown command directory reports a notice; missing or failed gh passes
           when a registered policy can be read; policy-file errors follow the rules below
block when: a local PR creation omits every --label in any required
            repository-policy group; confidence below 0.60 warns without blocking
exit contract: exit 0 + stdout JSON {"decision":"block"}
output:    missing group + allowed labels + observed PR count, confidence, policy path
verify:    node scripts/run_suites.js tests/test_dev_pr_label.js
RED:       `gh pr create` without a required-group label must not pass
```

### How policy is determined: declarations precede observations

| Order | Evidence | Result |
|---|---|---|
| 1 | **Declared policy** — PR template, CONTRIBUTING, CLAUDE.md, AGENTS.md | Labels people defined as rules |
| 2 | **Defined labels** — `gh label list` | Allowed set |
| 3 | **Observed form** — up to 50 existing PRs | Percentage actually used in each group |

**What people explicitly state precedes observation.** In declaration documents,
the parser collects backtick- or quote-delimited tokens only within a **three-line
window** around policy words (`레이블`, `필수`, required, policy, and so on).
This recognizes the common list below `### 필수 레이블`.

**Prefixes define groups.** Because organizations use different conventions
(`@web`, `type:bug`, `area/web`), the code does not prescribe one and instead uses
observed prefixes as group keys. Labels without prefixes form `_plain`.

Required judgment: observed ratio >= 0.80, or ratio >= 0.60 when a declaration
document mentions the group.

### No action in repositories that do not use labels

**This is the core of generalization.** If observation yields no required group,
there are zero rules and the hook remains silent. It does not impose our
conventions on another repository.

When evidence is weak (confidence below 0.60), it does not block and reports only
through `systemMessage`.

### Delta: do not silently block with stale policy

`.claude/pr-policy.json` stores both the label set and fingerprints of declaration
documents. If either changes, the fingerprint changes; the hook then **rediscovers,
updates, reports what changed, and passes** as chosen by the user. Adding one label
does not block a PR.

The policy file is **committed** so the team can review the same judgment and the
answer to "why is this required?" remains in `observed_prs`, `confidence`, and
`declared_sources`.

**`phantom_labels`:** labels declared in documentation but undefined in the
repository, signaling stale docs. Only prefixed tokens count; an unprefixed
backtick token may be a function name, and `check_file_content` was once
incorrectly reported as a phantom.

**Fail-open:** pass when `gh` is absent or fails. A corrupt policy file triggers
**rediscovery**, not a bypass.

---

## check_readme_version.js

On `git commit`, checks whether the `plugin.json` version for each plugin with a
staged file appears across the documentation set: the plugin README changelog
heading, root README version table, and `.claude-plugin/marketplace.json` entry.

This gate reads the host stdin JSON protocol and checks the staged plugin metadata.

```contract
matcher:   Bash
fail-open: exceptions pass; ordinary validation failures follow the exit contract
block when: command is `git commit`, a staged path belongs to `plugins/<name>/`,
            and its plugin.json version is absent from the plugin README's
            `## v<version>` heading, differs from the root README version table,
            or is absent from marketplace.json
exit contract: exit 0 + stdout JSON {"decision":"block"}
output:    per-plugin mismatch list
verify:    node scripts/run_suites.js tests/test_dev_hooks.js
RED:       git commit must not pass with a staged plugin that lacks a README
```

**Its prefix is `[WARN]`, but it actually blocks.** The string from migration was
kept as a byte-identical copy. Do not trust the message and read it as warning-only;
the judgment is `decision: block`. This demonstrates why **`exit contract:` is required
in this file**.

**Fail-open:** exceptions, JSON parse failure, and missing Git root all return an
empty `{}` and exit 0.

---

## check_marketplace_versions.js

On `git push`, checks that each version in `.claude-plugin/marketplace.json`
matches its corresponding `plugins/<name>/.claude-plugin/plugin.json` version.

This blocker is exercised with staged marketplace fixtures:
the version was altered and a real `git push --dry-run` attempt confirmed that the
tool call was blocked. That demonstration also proved that **the current host
honors the `{"decision":"block"}` schema directly in PreToolUse**. This matters
because six hooks in this plugin rely on that convention.

```contract
matcher:   Bash
fail-open: exceptions pass; ordinary validation failures follow the exit contract
block when: command is `git push` and any marketplace.json version differs from
            the same plugin's plugin.json version
exit contract: exit 0 + stdout JSON {"decision":"block"}
output:    `<name>: marketplace.json=x vs plugin.json=y` list
verify:    node scripts/run_suites.js tests/test_dev_hooks.js
RED:       a git push payload with mismatched versions must block
```

**Its scope is narrow:** version consistency **only** (audit §5). It does not
inspect formatting or skill content. `validate_before_publish.js` covers those,
but wakes only at publication time; **there is still no format gate at `git push`.**

**If marketplace.json is absent, it passes with zero targets.** That is correct for
this hook because it must not impose our conventions on repositories without a marketplace.

**Fail-open:** every exception returns an empty `{}` and exit 0.

---

## block_ai_attribution.js

Denies a commit or PR whose recorded text carries AI attribution. Skill text
alone did not stop Claude Code's default `Co-Authored-By: Claude ...` trailer,
so the rule is enforced where the text is written. The dispatcher runs it as the
`ai-attribution` policy, after `marketplace-versions` and before `pr-label`.

```contract
matcher:   Bash|exec_command (shell events, through dispatch.js)
fail-open: unparseable input passes; a message file that cannot be read, or stdin
           that is not a here-document, passes with a systemMessage naming it as
           unverifiable
block when: a `git commit` in command position records a message (-m, --message,
            --trailer, -F/--file including `-` with a here-document, or the
            reused HEAD message on --amend) with a line that starts with a phrase
            from check_commit's banned list (a `Co-Authored-By` line only when it
            names an AI, not a person), or `gh pr create` has such a line in
            --body/--body-file
exit contract: exit 0; through dispatch.js a permissionDecision deny with the reason,
            run directly stdout JSON {"decision":"block"}
output:    where the text goes (commit message or PR body) + the exact phrases to remove
verify:    node scripts/run_suites.js tests/test_dev_hooks.js
RED:       `git commit -m` with a `Co-Authored-By: Claude` trailer must not pass
```

**Scope is every repository where jstack is enabled.** This is a product decision,
not a repository convention: the policy does not look for `AGENTS.md`,
`CLAUDE.md`, or a policy file, and a repository that states no such rule is
denied the same way. There is no per-repository opt-out. The way to stop the
default text at the source is Claude Code's `attribution` setting. Per its
settings reference (code.claude.com/docs/en/settings-reference, read 2026-10-08),
the form that works on every version sets `commit` and `pr` to empty strings and
`sessionUrl` to `false`; `attribution: false` needs Claude Code v2.1.281 or later,
and earlier versions reject it and skip the whole settings file that holds it.
`sessionUrl` matters because it adds the `Claude-Session:` trailer in cloud and
Remote Control sessions, and this hook denies that trailer too.

The banned list is `BANNED` in the `gitrules` skill's `check_commit` checker, the
same list that checker reports, so the hook and the checker cannot drift.
Matching ignores case, and spaces or tabs around the colon, because Git trailer
keys are case-insensitive and GitHub honors `Co-authored-by: claude`. A phrase
counts only at the start of a line, after indentation or an emoji (the default
footer is `<robot emoji> Generated with [Claude Code](...)`), so a message that
quotes the phrase mid-sentence passes. Markdown decoration before the phrase
(`- `, `> `, `**`, `<sub>`) also passes; Claude Code's own PR text has none.

**A human co-author is not denied.** A `Co-Authored-By` trailer names an AI
only when its address is at `anthropic.com` (any name), or its name is `Claude`
alone or `Claude` followed only by model words (`Code`, `Opus`, `Sonnet`,
`Haiku`, `Fable`, `Instant`) and version numbers (`4`, `4.5`). `Claude Monet`,
`Claude Debussy`, `Claude Shannon`, `Claude-Louis` and `Claudette` are people
and pass unless their address is at `anthropic.com`. A bare `Claude` is denied
whatever its address, because that is the form the default trailer takes. The checks use explicit
lookaheads and `[0-9]`, so the TypeScript and Python checkers agree on non-ASCII
letters after the name.

The hook reads the text git will record, not the shell source. Inside double
quotes a backslash is dropped only before `$`, `` ` ``, `"`, `\` or a newline, as
in bash, and `$'...'` is decoded (`\n`, `\'`, `\xHH`, octal, `\u`). A line break
that `printf`, `echo -e` or `$'...'` makes from a `\n` or `\r\n` escape only when
the command runs is also covered (octal or hex escapes such as `\012` or `\x0a`,
`\cJ`, and `printf` format arguments are not expanded and still pass): text typed on the command line (`-m`, `--trailer`, `--body`) is
checked as written and again with `\n` and `\r\n` escapes turned into line
breaks, and a hit in either is a hit. File contents are not rewritten, and the
conservative result is that `-m "a\n\nCo-Authored-By: Claude"` is denied even
though git would record it on one line. `--trailer token=value` is read as the
`token: value` line git records. A relative `-F`/`--file`/`--body-file` path
resolves against the directory the command will be in: the hook input's `cwd`
moved by each `cd` earlier in the same chain and by `git -C`. Command-position
parsing is `invocations` in `hook-common.js`: a grep pattern or an unrelated
heredoc that merely contains the phrase is data, not a commit.

**Codex is covered only through the dispatcher.** `dispatch.js` normalizes
`exec_command` and reads its command from `tool_input.cmd`; a raw Codex payload
carries the command in `cmd`, which this module does not read. It is therefore
registered as a dispatch policy and never as a standalone hook entry.

**Fail-open:** through the dispatcher a throwing policy is reported as `[UNKNOWN]`
and the call passes; run directly, exceptions and JSON parse failure return `{}`
and exit 0. `--amend` with no readable HEAD message checks nothing for it.

---

## validate_before_publish.js

Intercepts `register_local.js` calls (and the older `.sh` name) and runs the format
checker against the target plugin.

```contract
matcher:   Bash
fail-open: missing target or checker and checker failure block; stdin parse failure
           and tool mismatch pass
block when: command invokes register_local.js or .sh and the
            extracted plugin directory is absent, the format checker is absent,
            or the checker exits nonzero
exit contract: nonzero exit (exit 1); stream diagnostics unchanged on stdout
output:    block reason + checker path + manual reproduction command
verify:    node scripts/run_suites.js tests/test_dev_hooks.js
RED:       a publish payload with a nonexistent path must not exit 0; it did at handoff
```

### Why it was rewritten: this hook was dead (audit §2)

The old version read hook input from **environment variables**.

```bash
TOOL_NAME="${TOOL_NAME:-unknown}"     # The host does not provide this variable.
[[ "$TOOL_NAME" != "Bash" ]] && exit 0  # Execution always ended here.
```

It passed even when given a nonexistent publication path and emitted zero bytes,
so nobody noticed. **Two Python hooks in the same directory read stdin JSON
correctly; only one of the three violated the convention, and it happened to be
the only format blocker.**

Corroborating evidence: three emojis remained in the old output. Their survival
despite this repository distributing `emoji-blocker` suggests **nobody ever saw
that output**. This version uses only ASCII prefixes (`[HOOK]` and `[BLOCK]`).

### Missing checker blocks: unique convention for this hook

Every other hook fails open; this one differs.

```
1) <hooks>/../scripts/validate_plugin.js
2) skills/author/scripts/validate_plugin.js (installed payload)
3) skills/author/scripts/validate_plugin.js (source checkout)
```

If all three are absent, it **blocks**. Treating an absent checker as a pass is `N-11`.
Stdin parse failure and tool mismatch still pass silently: they mean "not our
event," rather than "unable to check."

The plugin-relative lookup supports the installed payload and canonical source
checkout. It never searches an unrelated working repository for a validator.
The author skill owns format validation; missing checker files block publication.

---

## commit-session.js  (Stop)

At session end, stages changes, generates a Conventional Commits message with
`claude -p`, and commits. If `<repo>/docs/CHANGELOG.md` exists at the target
repository root, it adds one line there; that file is outside this plugin tree.

```contract
matcher:   ""   (Stop · async: true · timeout: 120)
fail-open: performs no tool blocking; missing target or configuration exits 0;
           shell-execution conditions follow below
block when: not applicable at session end; the activation condition is opt-in
            enabled, no git index.lock, and a staged tree different from HEAD
exit contract: always exit 0 with no output. The output is a side effect (a commit),
               not a block. A Stop hook could block with stdout decision JSON, but
               this hook never emits it; async mode also means the host does not wait
output:    one or two commits (snapshot plus optional changelog), each carrying
           the `Auto-Session-Commit: true` trailer
verify:    node scripts/run_suites.js tests/test_dev_hooks.js
RED:       deleting the opt-in guard fails TestTheStopHookIsOffByDefault because
           a commit appears in the isolated temporary repository
```

### Commits use the repository's Git identity

Both commits use the repository's own `user.name` and `user.email`. When the
snapshot commit fails (for example, no identity is configured), the hook stops
before touching `docs/CHANGELOG.md`.

### The message follows the effective conventions

The prompt asks for `autocommitLanguage`, the allowed `commitTypes`, `subjectMax`,
`bodyWrap` and, for Korean with `subjectVerbEnding: korean`, an action-noun ending,
all from `runtime/conventions.js`: the default profile's `conventions.json` when
it agrees with this repository's history or the user chose it here, otherwise
the defaults (English). A hook cannot ask, so an undecided conflict keeps the
defaults; a broken profile never blocks the snapshot.

### Default behavior is a no-op

Either of two conditions enables it. **Without both, it does nothing.**

| Enable through | Value |
|---|---|
| Configuration file | `touch <repo>/.claude/session-autocommit` |
| Environment variable | `JSTACK_SESSION_AUTOCOMMIT=1` |
| Disable (kill switch) | `JSTACK_SESSION_AUTOCOMMIT=0` — overrides the configuration file |

**This repository does not contain the configuration file.** With multiple
worktrees active, add+commit on every Stop competes with edits and rebases in
other trees, while `git add -A` indiscriminately includes untracked files.

### `--no-verify` bypasses emoji and ruff hooks (ledger :453)

This hook commits with `git commit -F - --no-verify`. It has **two** real bypass paths.

| | What it bypasses |
|---|---|
| `--no-verify` | Git's own hook (`.git/hooks/pre-commit`); repositories that attach ruff or gitleaks there do not run them |
| **Does not pass through the Bash tool** | More significant: the Stop hook invokes `git commit` directly, so this plugin's PreToolUse chain (`block_emoji.js`, `ruff_check_before_commit.js`, `validate_pr_label.js`) **never sees the commit**. This remains even if `--no-verify` is removed |

Result: **when this hook is enabled, content that should have been blocked can
enter a commit.** This supports the off-by-default setting and is a cost that
users must understand before enabling it.

This does not contradict the `ruff_check_before_commit.js` contract saying
`--no-verify` cannot bypass it. That statement concerns `git commit --no-verify`
**through the Bash tool**; this commit avoids the Bash tool. The **invocation path**,
not the flag, creates the bypass.

---

## load-recent-changes.js  (SessionStart)

At session start, injects the last 20 CHANGELOG lines and
`git log --oneline -10` into context.

```contract
matcher:   startup   (SessionStart)
fail-open: performs no tool blocking; missing target or configuration exits 0;
           shell-execution conditions follow below
block when: not applicable for SessionStart; inject only after finding a Git root
            and reading at least one CHANGELOG entry or commit
exit contract: exit 0 + stdout JSON {"additionalContext": "..."}. Context
               injection is the output, not a block. With nothing to inject,
               emit no output and exit 0
output:    recent CHANGELOG entries + ten recent commits
verify:    node scripts/run_suites.js tests/test_dev_hooks.js
RED:       a repository with commits must produce additionalContext
```

**This cost occurs unconditionally at every session start.** Like the continuous
L0 cost, increasing output consumes more tokens in every session. The last 20
lines and 10 commits are the cap.

**One line was fixed during migration.** The original used
`REPO_ROOT="$CLAUDE_PROJECT_DIR"`; under `set -u`, absence of that variable **killed
the hook with an error** whenever a session opened outside a Git repository. It
now uses `${CLAUDE_PROJECT_DIR:-}` and silently exits 0 when empty. Failing to load
context differs from a dead hook. The same line in `commit-session.js` was fixed too.

---

## ensure-statusline.mjs

```contract
matcher:   "" (SessionStart)
fail-open: catches installation errors and exits 0 without blocking session start
block when: not applicable; repair the install path only after explicit status-line opt-in
exit contract: exit 0; without opt-in, do not write settings or user data
verify:    node scripts/run_suites.js dashboard
RED:       an unconfigured temporary home must gain neither statusline.mjs nor settings changes
```

The hook resolves the installed package from host metadata, with a bounded cache
fallback, and finds the shim source from its own package location. Its repair path
is off by default; setup or `install-statusline.mjs optin` records automatic
recovery per configuration directory. `JSTACK_DASHBOARD_STATUSLINE=1` enables it and
`=0` disables it. A healthy run makes no write. Before a repair write it backs up
the file and preserves a user-owned status line; another managed value changes
only when the user allowed that identity.

### Detailed status-line installation contract


At SessionStart, the status-line hook is registered after
`load-recent-changes.js`. Each matcher and execution order follows the first table
in this document and `hooks.json`.

| Hook | Matcher | Behavior |
|---|---|---|
| `hooks/ensure-statusline.mjs` | None (all) | Checks and, when opted in, repairs the installed shim and `settings.json` `statusLine` |

**By default it does nothing.** It exits immediately without the per-home opt-in
record or the enabling environment switch. This persistent host-setting repair
needs its own consent, separate from the project checks decision.

The enabled safety contracts are **measured by execution with a stub
`settings.json` fixture, not by string matching** in
`skills/dashboard/tests/run_tests.js`.

1. Before modification, `.bak` preserves the original unchanged.
2. It modifies an empty or broken owned value; it preserves a user value and any
   managed identity the user did not allow for replacement.
3. Failure does not block session start (`try` wrapper and `exit 0`).

## dispatch.js  (active PreToolUse/PostToolUse entry)

`hooks/dispatch.js` is the registered entry for tool events. Its registry retains
all prior policies, with the two Ruff policies available only through the explicit
`JSTACK_HOOK_LEGACY_RUFF=1` transition switch.

```contract
matcher:   Bash|exec_command|apply_patch|Write|Edit|MultiEdit|NotebookEdit|Read (PreToolUse); Write|Edit|MultiEdit|apply_patch (PostToolUse)
block when: a routed PreToolUse policy returns deny, or a fail-closed publish policy cannot decide
exit contract: exit 0 with hookSpecificOutput.permissionDecision deny and a nonempty reason; emergency publish failure uses exit 2 and stderr
fail-open: optional policy failures report [UNKNOWN]; malformed JSON yields no output
entry:     node "${CLAUDE_PLUGIN_ROOT}/hooks/dispatch.js" <PreToolUse|PostToolUse> [--host claude|codex]
modules:   hook-event.ts (normalize) · hook-patch.ts (apply_patch) · hook-output.ts (render)
           hook-policies.ts (registry) · hook-project.ts (project lane, lazily loaded)
pass:      exit 0 with no stdout; irrelevant events return before any policy module loads
deny:      exit 0 + {"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"..."}}
never:     exit 1, plain stdout as a block, permissionDecision allow/ask, continue:false
post-tool: findings are hookSpecificOutput.additionalContext diagnostics, never a block
unknown:   a check that could not run or an uncertain change set is reported as [UNKNOWN] context
fail-closed: a failClosed policy (publish) that throws denies; the process-level
           fallback for that call is stderr + exit 2
```

**Host normalization.** `Bash`, Codex `exec_command`, `shell`, and `local_shell`
are shell events; `tool_input.command` may be a string or an argv array, and
`tool_input.cmd` is accepted. Codex `apply_patch` keeps its tool name and is parsed
from its `*** Begin Patch` envelope (also inside a heredoc) into add, update,
delete, and move changes across multiple files. A missing envelope, an unknown
directive, or a malformed hunk marks the event uncertain; content guards then scan
raw added lines, and no check is claimed for the unparsed paths.

**Output contract evidence.** The Codex shapes were checked against the
`pre-tool-use.command.output` and `post-tool-use.command.output` schemas embedded
in codex-cli 0.157.1: PreToolUse deny requires a non-empty
`permissionDecisionReason`; `hookSpecificOutput` has `additionalProperties:false`.
This is static schema evidence, not an observed trusted-hook execution.

**Behavior changes from the per-hook registration.**

| Policy | Legacy exit contract | Dispatcher |
|---|---|---|
| `check_model_versions` block path | stderr + exit 1 (blocked on neither host) | deny |
| `validate_before_publish` failures | exit 1 (blocked on neither host) | deny; guard exceptions deny |
| `block_ai_attribution` block path | exit 0 + `{"decision":"block"}` | deny with the same reason; an unreadable message file adds a `systemMessage` and passes |
| `ruff_check_after_edit` | stderr + exit 2 feedback | additionalContext diagnostic; only with `JSTACK_HOOK_LEGACY_RUFF=1` |
| `ruff_check_before_commit` | block, auto-format, restage | only with `JSTACK_HOOK_LEGACY_RUFF=1`; the project lane owns commit checks |

The project lane (`runtime/project-hooks`) runs only on `git commit` (PreToolUse)
or on edits to Python, JavaScript/TypeScript, Go, or Rust paths (PostToolUse). It
sets `JSTACK_HOOK_CONTEXT=1`, reads decision state, and records a diagnostic; it
never asks for or records a decision, installs a tool, formats files, or creates
`.jstack/`. An undecided project is off: the lane runs nothing and stays quiet
unless the state file is damaged. `JSTACK_PROJECT_HOOKS=0` disables the lane.

---

## jst-path.js  (SessionStart)

Registered only in `claude-hooks.json`, which the Claude manifest names; Claude
Code merges it with `hooks.json`, and Codex never reads it. Puts the plugin's
`payload/bin`, which holds the `jst` launcher, on the Bash tool's PATH for the
session. claude.ai and Cowork refuse a plugin with a top-level `bin/`, so Claude
Code's own plugin-bin PATH entry is not used.

```contract
matcher:   "" (SessionStart, every source; whether each session start gets its own env file is unverified)
fail-open: every error exits 0 silently; JSTACK_NO_PATH_LINK=1, a missing launcher or
           no CLAUDE_ENV_FILE (Codex, which also reads hooks.json) write nothing
block when: never; it only appends one export line to CLAUDE_ENV_FILE
exit contract: exit 0 with no output; the line is appended once and puts the
               directory after the user's PATH entries, so an installed CLI wins
verify:    the jst-path.test.ts Node test in the source checkout
RED:       sourcing the env file must resolve jstack to the launcher, and to an
           earlier jstack on PATH when one exists
```

Evidence: in a headless `claude -p --plugin-dir` session on macOS, the Bash tool's
PATH contained `payload/bin` as a late entry. Unverified: Claude Code on Windows
sourcing the Git Bash form (`/c/...`) of the directory, and the minimum Claude
Code version that passes `CLAUDE_ENV_FILE` to plugin hooks.

---

## link-jst.js  (Codex SessionStart)

Registered only in `codex-hooks.json`, which the Codex manifest names next to
`hooks.json`; an explicit Codex list replaces default `hooks.json` discovery, so
both stay listed. It links `~/.local/bin/jst` to `payload/bin/jst`. Claude Code
never runs it; there `jst-path.js` adds `payload/bin` through `CLAUDE_ENV_FILE`.

```contract
matcher:   startup|resume   (SessionStart, Codex only), timeout 10
fail-open: every error exits 0 with at most one line; JSTACK_NO_PATH_LINK=1, an empty
           or relative HOME, and Windows do nothing
block when: never; it writes only ~/.local/bin/jst and creates ~/.local/bin; when
            another jstack is on PATH it only removes its own link
exit contract: exit 0; on startup (or without hook input) one plain-text line
               for the agent to relay when it links, relinks, removes its own
               link, leaves a foreign entry alone or fails; none on resume
verify:    the link-jst.test.ts Node test in the source checkout
RED:       a link into an older jstack plugin version must be relinked to this launcher
```

Codex replaces `${PLUGIN_ROOT}` and `${CLAUDE_PLUGIN_ROOT}` in the command text
itself and runs it through `$SHELL`, or `COMSPEC /C` on Windows (read from the
openai/codex hook engine source). On Windows the hook does nothing, because the
launcher is a POSIX script; the Windows CI job runs the substituted command
through `cmd.exe`. A live Codex session on either OS, including its trust review,
is unverified.
