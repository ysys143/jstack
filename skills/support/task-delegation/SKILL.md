---
name: task-delegation
description: Delegate to Codex so it actually executes and writes code, not a second opinion. Triggers — "codex한테 맡겨", "codex로 해결", "ask codex", "codex fix", "codex debug", "codex refactor", "codex한테 시켜줘", "코드 수정 위임", "실행 위임", "delegate to codex".
---

# Delegate — hand off the write, not the question

When delegating security work, include only the input boundaries from the
[security discovery contract](../audit/references/security-discovery.md) and execution
evidence fields from the [security verification contract](../verify/references/security-verification.md)
in the brief. Do not trust the discoverer's reasoning or self-reported result.
These links do not automatically delegate security work that needs no delegation.

## The calling moment decides which skill

Two requests look similar and are not. "Is this right?" keeps the artefact in
your hands and asks for a verdict. "Make this change" gives the artefact away
and asks for a different one back. The first is a review; the second is a
write, and a write needs a sandbox, a working directory, and a model — not an
opinion.

| You are asking for | Skill |
| --- | --- |
| A verdict on code you already wrote, possibly one that disagrees | `consult` |
| The change actually made — files edited, under a sandbox and workdir you name | `delegate` |
| The general contract for probing and calling an external tool | `bridge` |

`delegate` is the second row. It runs Codex CLI non-interactively with
`codex exec`, in a sandbox you choose, against a working directory you name,
and returns what Codex wrote to stdout. It does not review, does not average
multiple opinions, and does not ask Codex to argue against your framing —
`second-opinion`'s synthesis guide (never average verdicts) is built for a panel of
reviewers, and `delegate` calls one executor, not a panel, so it does not apply
here.

## What actually happens when you delegate

`codex exec` is a one-shot process: it reads a prompt from stdin, does its
work inside the sandbox, and exits. There is no follow-up turn — if the first
prompt is ambiguous, Codex fills the gap itself rather than asking. Write the
prompt as a self-contained problem statement, not a chat opener.

The sandbox controls whether that work can touch disk at all:

| Sandbox | Codex may |
| --- | --- |
| `read-only` (default) | Read files, produce a plan or a diff as text — cannot write |
| `workspace-write` | Write inside `--workdir` |
| `danger-full-access` | Write anywhere the process can reach |

Default to `read-only` and escalate only when the task explicitly requires a
write. Escalating by default because "it's probably fine" hands a process you
cannot supervise mid-run the ability to touch files outside the one directory
you meant to scope it to.

Use `--sandbox`/`--workdir`/`--model` when specifying the working directory, sandbox, and model.
Structural diagnosis through an separately installed codex:codex-rescue integration
is distinct from this execution bridge; do not assume that integration is present.

## Running it

```bash
node "${JSTACK_PLUGIN_ROOT}/skills/delegate/scripts/codex-bridge.js" \
  --prompt "Fix the race condition in scripts/worker.py — see the failing test in tests/test_worker.py" \
  [--sandbox "read-only"] \
  [--workdir "/path/to/project"] \
  [--model "MODEL_ID"] \
  [--files "/path/to/file1.py,/path/to/file2.py"] \
  [--timeout 300]
```

No search step is needed to find the script — `${JSTACK_PLUGIN_ROOT}` always
resolves to this plugin's root, so the path above is exact. Do not hardcode a
path under `~/.claude/plugins` or any other user-specific location; that
breaks the moment the plugin is installed somewhere else, and it is the one
mistake this script is built to rule out.

| Parameter | Required | Description |
| --- | --- | --- |
| `--prompt` | Yes | Self-contained task description — Codex gets no follow-up turn |
| `--sandbox` | No | `read-only` (default), `workspace-write`, `danger-full-access` |
| `--workdir` | No | Working directory Codex operates in (defaults to the caller's `pwd`) |
| `--model` | No | Model override; pass the id the user or routing decision names |
| `--files` | No | Comma-separated paths inlined into the prompt as reference context |
| `--timeout` | No | Seconds before the process is killed (default 300 — reasoning takes longer than a lint run) |

The script's stdout is Codex's final answer, ANSI codes stripped and each line
trimmed — nothing else. Read it as the delegate's output, not as a transcript
to summarize back to the user; if `--sandbox workspace-write` was used, the
real evidence of what happened is the diff on disk, not the text Codex printed
about it.

## Availability — three states, no installs

This bridge probes before it runs, following the convention `bridge` defines
for every external-tool dependency in this plugin: report which of three
states holds, and never install anything on the user's behalf.

| State | Meaning | What the script does |
| --- | --- | --- |
| 0 — full | `codex` resolves and credentials are present | Says nothing, proceeds |
| 1 — partial | `codex` resolves, no `OPENAI_API_KEY` and no `~/.codex/auth.json` | Prints that delegation cannot proceed without authentication, exits 1 |
| 2 — blocked | `codex` does not resolve on `PATH` | Prints the exact install command, exits 1 |

State 1 and state 2 are reported with different wording on purpose, even
though both currently stop the delegate: a tool that is installed but signed
out is not the same problem as a tool that was never installed, and telling a
signed-in-but-key-missing user to reinstall Codex sends them to fix the wrong
thing. Only state 2 prints an install command — state 1's fix is
authentication, not installation, and mixing the two guidances back into one
message is exactly the failure `bridge` names as a reduced path that does not
say it is reduced.


## Task routing and completion

For authorized delegation, follow [Runtime routing](../../runtime/ROUTING.md):
plan with `jst route plan`, reserve one attempt with `jst route run`, execute, and
record checked artifacts with `jst route record`. It owns model transitions and
the rules every calling skill follows.

## Boundary

Three things sit next to this skill and are not it.

Asking for a verdict on work that already exists, and treating agreement with
the framing as the failure mode to avoid, is the `consult` skill; it never
touches a file. `delegate` is the opposite shape — the artefact is not
finished, and the point is for Codex to finish it.

Owning the general probe-then-call contract (three states, never install,
report what is lost) that this skill's `codexProbe` implements for one
specific tool is the `bridge` skill. Write a new bridge for a different CLI by
reading that skill first, not by copying this script's Codex-specific checks.

`codex:codex-rescue`, if installed from its own marketplace, is a different
tool for a different moment: it diagnoses why a Codex run went wrong and
orchestrates retries around that diagnosis. `delegate` does not diagnose or
retry — it is for the moment you already know what to hand off and want it run
under a sandbox, working directory, and model that you pick.
