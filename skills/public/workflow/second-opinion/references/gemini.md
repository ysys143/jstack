# Gemini compatibility entry — currently unsupported

The current bridge makes no model call. An installed agy CLI is refused because
jstack has no reviewed adapter that enforces read-only consultation. Use a permitted
native reviewer or the Codex read-only panel participant. The parameter surface
below remains compatible, but a successful response is not currently available.

The skill that calls this backend still carries the name "gemini" because
that is the vocabulary the person asking for it uses — "gemini로 문서 작성", "ask
gemini". The historical backend is **`agy`**, Google's successor to `gemini-cli`.
`gemini-cli` itself is deprecated as of 2026-06-18; `check-cli.js gemini`
prints that deprecation notice and points at `agy` rather than trying to
install the retired tool. Do not let the skill's name lead you to search for
a `gemini` binary — there is not one, and the bridge script never calls it.

The former intended use was document work rather than code execution: it is one
reviewer with one lens (prose clarity, documentation structure, broader
context), called for the writing task itself rather than for a verdict on
someone else's writing.

## When to reach for it

- README generation or improvement
- Technical specification writing
- API documentation drafting
- Blog post or article writing
- Document editing and restructuring
- Translation of documentation

## Running it

```bash
node "${JSTACK_PLUGIN_ROOT}/skills/consult/scripts/gemini-bridge.js" \
  --task "write" \
  --prompt "Your detailed prompt here" \
  [--files "/path/to/file1.md,/path/to/file2.md"] \
  [--output-format text] \
  [--timeout 120]
```

`${JSTACK_PLUGIN_ROOT}` always resolves to this plugin's root — no search step
is needed to find the script, and no path under `~/.claude/plugins` should
ever be hardcoded to reach it. A predecessor of this skill did exactly that
(`find ~/.claude/plugins -name "gemini-bridge.js"` as a mandatory first step,
with an explicit ban on using `${JSTACK_PLUGIN_ROOT}`) because an earlier
revision found that variable unset at call time. The variable is populated
correctly by the harness; the fix belongs here, once, rather than in a
runtime `find` on every invocation.

| Parameter | Required | Description |
| --- | --- | --- |
| `--task` | No | Task label: `write`, `edit`, `review`, `translate` (default: `general`) |
| `--prompt` | Yes | Detailed instruction for agy |
| `--files` | No | Comma-separated file paths to include as context |
| `--output-format` | No | `text` (default) or `json` |
| `--timeout` | No | Timeout in seconds (default: 120) |

The current script returns an error and empty stdout; it does not read reference
files or invoke agy. `--model ID` expresses a requested model but cannot bypass
the missing permission guarantee. The output-format option remains accepted for
compatibility. No response is fabricated when the backend is unavailable.

## Known quirks

- **`--print`/`--prompt` consumes the next token as its value.** Pass the
  prompt as that flag's value, never as a trailing positional argument — a
  trailing form lets `--print` swallow the next flag (e.g. `--print-timeout`)
  as prompt text instead, and agy answers a question about its own CLI flags
  rather than the one it was asked. This is historical CLI guidance for a future reviewed adapter; the current
  compatibility entry never reaches a provider invocation.
- Credentials are inherited from the process environment; startup files are not sourced.
- agy is currently blocked for consultation because no reviewed read-only
  adapter exists. CLI presence is not permission evidence. No model is invoked.
- `--model ID` is accepted as the requested model; it does not bypass this limit.
  Model selection is supported by the shared routing contract, not prohibited
  because an older SDK once failed.
- Use an authorized native reviewer or the Codex read-only council participant.
  Do not install integrations or use permission-bypass flags to recover.

## What comes back, and what to do with it

If a reviewed adapter is added later, use these three response-handling steps.
The current unsupported response must be reported as a failure.

1. **Review the quality first.** Read what agy returned before it goes
   anywhere. Judge it against what was asked for, not against how confident
   it sounds — an unusable draft passed on as a result costs more than a
   reported failure does.
2. **Whether any of it lands is the caller's decision.** This skill does not
   edit files. The bridge writes agy's answer to stdout and changes nothing
   on disk, so adopting a suggestion is a separate act by whoever asked for
   the consultation — and if that act is a write an external model should
   perform, it belongs to `delegate`, under a sandbox and workdir named on
   purpose.
3. **Report it, failures included.** Say what came back and what you judged
   unusable, with the reason. If the bridge itself failed, report its exact
   error rather than quietly substituting your own answer for agy's.

## Boundary

This is one reviewer, called to produce a document, not to referee two
opinions. For querying agy and Codex together and reading the disagreement
between them, see `references/ai-council.md` and, for how to read the panel's
output without averaging it away, `references/synthesis-guide.md`.
