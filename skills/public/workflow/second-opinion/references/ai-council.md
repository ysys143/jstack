# AI council backend — the Codex read-only participant

The council bridge sends one prompt to the `Codex` CLI and returns its raw
response. It does not pick a winner, does not merge answers, and does not run
one reviewer to check another's work — that ordering would make the second call
a review of the first call's framing, exactly the failure `SKILL.md` opens with.

One Codex answer is one reviewer. A panel needs a second independent answer, and
the caller supplies it: a native reviewer given the same artefact and a different
angle, or a second Codex round under a different lens. Neither reviewer sees the
other's answer while answering. `references/synthesis-guide.md` says how to read
the answers together.

Codex tends toward deep code reasoning, edge cases, and algorithmic correctness.
That is a statement about what the backend is *good at*, not a lens assignment —
see `references/synthesis-guide.md` for why treating "which reviewer answered" as
if it were an analytical lens is the first way a panel goes wrong.

## When to reach for it instead of a native reviewer

- Cross-verification of a conclusion before acting on it
- Code review that benefits from a read-through by a different model
- A research claim that should survive more than one source's framing
- Any moment a single model's confident, fluent wrong answer would be
  expensive to act on unchecked

A native reviewer is enough when the session authorizes one and the question
needs no second model. Do not describe the same model in a new context as a
different model.

## Running it

```bash
node "${JSTACK_PLUGIN_ROOT}/skills/consult/scripts/council-bridge.js" \
  --prompt "The question or task for the reviewer" \
  [--mode "research"|"review"|"debug"] \
  [--files "/path/to/file1,/path/to/file2"] \
  [--workdir "$(pwd)"] \
  [--codex-model ID] \
  [--timeout 180]
```

`${JSTACK_PLUGIN_ROOT}` always resolves to this plugin's root; do not
hardcode a path under `~/.claude/plugins` to locate this script, and do not
add a runtime `find` step to rediscover it. That was a predecessor's fix for
a different bug (an unset `${JSTACK_PLUGIN_ROOT}` at call time) and it does
not apply here — the variable resolves correctly, so the direct path is
exact.

| Parameter | Required | Description |
| --- | --- | --- |
| `--prompt` | Yes | The question or task sent to the reviewer |
| `--mode` | No | `research` (default), `review`, `debug` — each prepends a different instruction, not a different question |
| `--files` | No | Comma-separated file paths inlined into the prompt as context |
| `--workdir` | No | Directory Codex's sandbox is scoped to |
| `--codex-model` | No | Codex model ID; omitted keeps the CLI default |
| `--timeout` | No | Timeout in seconds (default: 180) |

If the Codex CLI is not installed, the bridge prints the `check-cli.js` install
block and exits 1. A timeout or a nonzero exit is reported in the response block
and in the exit code.

## The Codex call here is read-only, not a delegation

`council-bridge.js` invokes `codex exec --sandbox read-only`. That is a
deliberate correction, not the upstream default: an earlier revision of this
script ran `--sandbox workspace-write`, which meant asking for "a second
opinion" could silently let Codex write to disk. consult's contract is that
it never touches a file — the moment a task needs Codex to actually make a
change is the moment it has become `delegate`'s job, under a sandbox and
`--workdir` the caller names on purpose. A panel query is not that moment,
so its sandbox is pinned to the state that cannot write, independent of
whatever default a future Codex CLI release might ship.

## Model selection and permission parity

Use `--codex-model ID` to honor an explicit Codex model selection. Omission
retains the CLI default and does not establish the actual model identity.
A past SDK failure is not a permanent prohibition on model selection.

The call never receives permission-bypass flags and uses `--sandbox read-only`.
Zero successful responses returns a nonzero exit. API keys are inherited from the
process environment; no shell startup file is sourced and no credential values
are reported.

## Output shape

```
=== CODEX RESPONSE ===
[Codex's raw answer, or an error block]
=== END CODEX ===
```

followed by a `stderr` summary line, `Council: N/M AIs responded
successfully.` The block is unedited model output — reading it is where
`references/synthesis-guide.md`'s rules apply, not before.

## Availability

Executable presence is inspected for `codex`; `check-cli.js` supplies missing-tool
guidance. Presence is not authentication or permission evidence, and nothing is
installed on the caller's behalf.

## Boundary

Reading what reviewers returned — without collapsing several answers into an
averaged one — is `references/synthesis-guide.md`.
Handing Codex a write to actually execute, under a sandbox and workdir chosen for
that purpose, is the `delegate` skill, not this one.
