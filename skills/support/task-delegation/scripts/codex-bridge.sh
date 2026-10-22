#!/usr/bin/env bash
# Bridge script for delegating an execution task to Codex CLI.
# Usage: codex-bridge.sh --prompt <text> [--sandbox <value>] [--workdir <dir>]
#                         [--model <model>] [--files <paths>] [--timeout 300]
set -euo pipefail

# --- Environment setup (bash sub-process does not inherit zsh functions/nvm) ---
export NVM_DIR="${HOME}/.nvm"
[ -s "${NVM_DIR}/nvm.sh" ] && \. "${NVM_DIR}/nvm.sh" 2>/dev/null || true
[ -f "${HOME}/.oh-my-zsh/custom/apikey.env" ] \
  && source "${HOME}/.oh-my-zsh/custom/apikey.env" \
  && export OPENAI_API_KEY \
  || true

# macOS does not ship GNU timeout. Use gtimeout from coreutils when available,
# and run without a timeout when neither command exists.
_timeout() {
  local t="$1"; shift
  if command -v timeout >/dev/null 2>&1; then
    timeout "${t}s" "$@"
  elif command -v gtimeout >/dev/null 2>&1; then
    gtimeout "${t}s" "$@"
  else
    "$@"
  fi
}

# --- Availability probe: follows the bridge skill's three-state contract -----
# 0 = ready (silent) / 1 = partial (installed but unauthenticated) / 2 = blocked (missing)
# It never installs anything; it only prints an install command when blocked.
_codex_probe() {
  if ! command -v codex >/dev/null 2>&1; then
    echo "ERROR: codex CLI was not found." >&2
    echo "  Install: npm install -g @openai/codex   # or: brew install codex (macOS)" >&2
    echo "  Documentation: https://github.com/openai/codex" >&2
    return 2
  fi
  if [[ -z "${OPENAI_API_KEY:-}" && ! -f "${HOME}/.codex/auth.json" ]]; then
    echo "WARNING: codex CLI is installed but unauthenticated; execution cannot be delegated." >&2
    echo "  Authenticate: export OPENAI_API_KEY=\"...\"   or: codex login" >&2
    return 1
  fi
  return 0
}

if ! _codex_probe; then
  exit 1
fi

# --- Parse arguments ---
PROMPT=""
SANDBOX=""
WORKDIR="$(pwd)"
MODEL=""
FILES=""
TIMEOUT=300

while [[ $# -gt 0 ]]; do
  case "$1" in
    --prompt)   PROMPT="$2"; shift 2 ;;
    --sandbox)  SANDBOX="$2"; shift 2 ;;
    --workdir)  WORKDIR="$2"; shift 2 ;;
    --model)    MODEL="$2"; shift 2 ;;
    --files)    FILES="$2"; shift 2 ;;
    --timeout)  TIMEOUT="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$PROMPT" ]]; then
  echo "ERROR: --prompt is required" >&2
  exit 1
fi

# --- Build file context ---
FILE_CONTEXT=""
if [[ -n "$FILES" ]]; then
  IFS=',' read -ra FILE_ARRAY <<< "$FILES"
  for filepath in "${FILE_ARRAY[@]}"; do
    filepath="$(echo "$filepath" | xargs)"
    if [[ -f "$filepath" ]]; then
      FILE_CONTEXT+="
--- FILE: $filepath ---
$(cat "$filepath")
--- END FILE ---
"
    else
      echo "WARNING: File not found: $filepath" >&2
    fi
  done
fi

# --- Build full prompt ---
FULL_PROMPT="$PROMPT"
if [[ -n "$FILE_CONTEXT" ]]; then
  FULL_PROMPT+="

## Reference Files
${FILE_CONTEXT}"
fi

# --- Temp files for output and errors ---
# **X must be the template suffix.** BSD mktemp (the macOS default) replaces
# only trailing X characters, so `codex-out-XXXXXXXX.txt` becomes a literal
# filename. One leftover then makes every later call fail with mkstemp EEXIST,
# and concurrent calls in a shared TMPDIR overwrite each other's output.
# **Install the trap before mktemp.** Otherwise a failure between the two calls
# leaves the first file behind and creates the same EEXIST failure.
OUTPUT_FILE=""
ERR_FILE=""
trap 'rm -f -- ${OUTPUT_FILE:+"$OUTPUT_FILE"} ${ERR_FILE:+"$ERR_FILE"}' EXIT
OUTPUT_FILE=$(mktemp "${TMPDIR:-/tmp}/codex-out.XXXXXXXX")
ERR_FILE=$(mktemp "${TMPDIR:-/tmp}/codex-err.XXXXXXXX")

# --- Execute Codex CLI ---
EXIT_CODE=0

CODEX_ARGS=(exec)
# --full-auto is deprecated in codex-cli >=0.135; use -s/--sandbox instead.
# **The default is read-only.** SKILL.md declares this in four places and this
# script implements that declaration. The old version inherited workspace-write
# from the `--full-auto` era, contradicting the documentation: callers who omitted
# --sandbox received write access silently. Elevation now requires explicit --sandbox.
CODEX_ARGS+=(-s "${SANDBOX:-read-only}")
CODEX_ARGS+=(--skip-git-repo-check)
CODEX_ARGS+=(-C "$WORKDIR")
if [[ -n "$MODEL" ]]; then
  CODEX_ARGS+=(-m "$MODEL")
fi

# Use stdin (-) for prompt to avoid shell quoting issues
_timeout "$TIMEOUT" codex "${CODEX_ARGS[@]}" - <<< "$FULL_PROMPT" \
  > "$OUTPUT_FILE" 2>"$ERR_FILE" || EXIT_CODE=$?

# --- Handle errors ---
if [[ $EXIT_CODE -eq 124 ]]; then
  echo "ERROR: Codex CLI timed out after ${TIMEOUT}s" >&2
  exit 1
elif [[ $EXIT_CODE -ne 0 ]]; then
  echo "ERROR: Codex CLI exited with code $EXIT_CODE" >&2
  [[ -s "$ERR_FILE" ]] && cat "$ERR_FILE" >&2
  exit 1
fi

# --- Output: strip ANSI escapes and per-line whitespace, inline (no
# external parse-output.sh — this script owns its own output contract) ---
if [[ -s "$OUTPUT_FILE" ]]; then
  sed -e 's/\x1b\[[0-9;]*[a-zA-Z]//g' "$OUTPUT_FILE" \
    | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'
else
  echo "ERROR: Codex returned empty output" >&2
  exit 1
fi
