#!/usr/bin/env bash
# Bridge script for multi-AI panel queries.
# Runs agy and Codex in parallel, collects both raw responses.
# Usage: council-bridge.sh --prompt <text> [--mode research|review|debug] [--files <paths>] [--workdir <dir>] [--timeout 180]

set -euo pipefail

# --- Environment setup (bash sub-process does not inherit zsh functions/nvm) ---
export NVM_DIR="${HOME}/.nvm"
[ -s "${NVM_DIR}/nvm.sh" ] && \. "${NVM_DIR}/nvm.sh" 2>/dev/null || true
[ -f "${HOME}/.oh-my-zsh/custom/apikey.env" ] \
  && source "${HOME}/.oh-my-zsh/custom/apikey.env" \
  && export GEMINI_API_KEY OPENAI_API_KEY \
  || true

# macOS does not ship 'timeout'; use gtimeout (coreutils) or fall back to plain exec
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

# check-cli.sh and parse-output.sh live next to this script in
# consult/scripts/ — a sibling lookup, not a plugin-root guess. The
# predecessor climbed three directories to reach a plugin-root scripts/
# that does not exist in this layout; see gemini-bridge.sh for the same fix.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- Parse arguments ---
PROMPT=""
MODE="research"
FILES=""
WORKDIR="$(pwd)"
TIMEOUT=180

while [[ $# -gt 0 ]]; do
  case "$1" in
    --prompt)   PROMPT="$2"; shift 2 ;;
    --mode)     MODE="$2"; shift 2 ;;
    --files)    FILES="$2"; shift 2 ;;
    --workdir)  WORKDIR="$2"; shift 2 ;;
    --timeout)  TIMEOUT="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$PROMPT" ]]; then
  echo "ERROR: --prompt is required" >&2
  exit 1
fi

# --- Check which CLIs are available ---
HAS_AGY=false
HAS_CODEX=false

if command -v agy >/dev/null 2>&1; then
  HAS_AGY=true
fi
if command -v codex >/dev/null 2>&1; then
  HAS_CODEX=true
fi

if [[ "$HAS_AGY" == "false" && "$HAS_CODEX" == "false" ]]; then
  echo "ERROR: Neither agy nor Codex CLI is installed." >&2
  # No `2>&1` here — check-cli.sh already writes its guidance to its own
  # stderr, which inherits this script's stderr unless redirected. A
  # predecessor merged it into this script's stdout instead, which meant a
  # caller reading stdout for a clean panel transcript got install
  # instructions mixed into it on the one path where nothing else runs.
  bash "$SCRIPT_DIR/check-cli.sh" agy || true
  bash "$SCRIPT_DIR/check-cli.sh" codex || true
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

# --- Build mode-specific prompt prefix ---
MODE_PREFIX=""
case "$MODE" in
  research)
    MODE_PREFIX="Answer the following question thoroughly and analytically:"
    ;;
  review)
    MODE_PREFIX="Review the following code for bugs, edge cases, security issues, and potential improvements. Be specific with line references:"
    ;;
  debug)
    MODE_PREFIX="Diagnose the following bug or issue. Identify the root cause, explain why it happens, and suggest a minimal fix:"
    ;;
esac

FULL_PROMPT="${MODE_PREFIX}

${PROMPT}"

if [[ -n "$FILE_CONTEXT" ]]; then
  FULL_PROMPT+="

## Reference Files
${FILE_CONTEXT}"
fi

# --- Create temp directory and prompt file for results ---
# The X run has to be the LAST thing in the template. BSD mktemp (macOS)
# substitutes only a trailing run of X's -- "council-agy-prompt-XXXXXXXX.txt"
# came back verbatim, so every council run wrote the same fixed filename and
# the second one failed with "File exists". `RESULT_DIR` was already correct
# (its X run is terminal); the prompt file was not.
#
# The trap is armed BEFORE either mktemp. Previously it was armed after both,
# which is why the broken prompt-file mktemp leaked a `RESULT_DIR` on every
# failed run -- the directory existed but nothing was registered to remove it.
RESULT_DIR=""
AGY_PROMPT_FILE=""
trap 'rm -rf ${RESULT_DIR:+"$RESULT_DIR"}; rm -f ${AGY_PROMPT_FILE:+"$AGY_PROMPT_FILE"}' EXIT
RESULT_DIR=$(mktemp -d "${TMPDIR:-/tmp}/ai-council-XXXXXXXX")
AGY_PROMPT_FILE=$(mktemp "${TMPDIR:-/tmp}/council-agy-prompt.XXXXXXXX")
printf '%s' "$FULL_PROMPT" > "$AGY_PROMPT_FILE"

AGY_OUT="$RESULT_DIR/agy.out"
AGY_RC="$RESULT_DIR/agy.rc"
AGY_ERR="$RESULT_DIR/agy.err"
CODEX_OUT="$RESULT_DIR/codex.out"
CODEX_RC="$RESULT_DIR/codex.rc"
CODEX_ERR="$RESULT_DIR/codex.err"

# --- Launch AIs in parallel ---
echo "Council: querying available AIs in parallel..." >&2

if [[ "$HAS_AGY" == "true" ]]; then
  (
    # NOTE: agy's --print/--prompt flag CONSUMES the next token as the prompt
    # value (--prompt is an alias for --print). Pass the prompt as the flag's
    # value, NOT as a trailing positional arg -- otherwise --print swallows the
    # following flag (e.g. "--print-timeout") and treats it as the prompt text.
    _timeout "$TIMEOUT" \
      agy --prompt "$(cat "$AGY_PROMPT_FILE")" --print-timeout "${TIMEOUT}s" --dangerously-skip-permissions \
      >"$AGY_OUT" 2>"$AGY_ERR" \
      || echo $? > "$AGY_RC"
    [[ -f "$AGY_RC" ]] || echo "0" > "$AGY_RC"
  ) &
  AGY_PID=$!
else
  echo "skip" > "$AGY_RC"
fi

if [[ "$HAS_CODEX" == "true" ]]; then
  (
    # This panel asks Codex for a second opinion — it does not hand Codex a
    # write. consult's contract is that it never touches a file (that is
    # `delegate`'s job, under a sandbox and workdir the caller names
    # explicitly). So this call is pinned to --sandbox read-only, not
    # workspace-write: a predecessor of this script ran workspace-write here,
    # which let a "get a second opinion" request silently become a write.
    # --skip-git-repo-check lets the council run outside a git repo (codex is
    # still sandboxed to read-only).
    _timeout "$TIMEOUT" codex exec --sandbox read-only --skip-git-repo-check -C "$WORKDIR" - <<< "$FULL_PROMPT" \
      >"$CODEX_OUT" 2>"$CODEX_ERR" \
      || echo $? > "$CODEX_RC"
    [[ -f "$CODEX_RC" ]] || echo "0" > "$CODEX_RC"
  ) &
  CODEX_PID=$!
else
  echo "skip" > "$CODEX_RC"
fi

# --- Wait for results ---
FAILURES=0

if [[ "$HAS_AGY" == "true" ]]; then
  wait "$AGY_PID" 2>/dev/null || true
  [[ ! -f "$AGY_RC" ]] && echo "1" > "$AGY_RC"
fi

if [[ "$HAS_CODEX" == "true" ]]; then
  wait "$CODEX_PID" 2>/dev/null || true
  [[ ! -f "$CODEX_RC" ]] && echo "1" > "$CODEX_RC"
fi

# --- Collect and output results ---

# agy
AGY_STATUS=$(cat "$AGY_RC" 2>/dev/null || echo "1")
echo "=== AGY RESPONSE ==="
if [[ "$AGY_STATUS" == "skip" ]]; then
  echo "[agy CLI not installed - skipped]"
elif [[ "$AGY_STATUS" == "0" ]] && [[ -s "$AGY_OUT" ]]; then
  cat "$AGY_OUT" | bash "$SCRIPT_DIR/parse-output.sh" text
elif [[ "$AGY_STATUS" == "124" ]]; then
  echo "[ERROR: agy timed out after ${TIMEOUT}s]"
  FAILURES=$((FAILURES + 1))
else
  echo "[ERROR: agy failed with exit code $AGY_STATUS]"
  [[ -s "$AGY_ERR" ]] && cat "$AGY_ERR"
  FAILURES=$((FAILURES + 1))
fi
echo "=== END AGY ==="

echo ""

# Codex
CODEX_STATUS=$(cat "$CODEX_RC" 2>/dev/null || echo "1")
echo "=== CODEX RESPONSE ==="
if [[ "$CODEX_STATUS" == "skip" ]]; then
  echo "[Codex CLI not installed - skipped]"
elif [[ "$CODEX_STATUS" == "0" ]] && [[ -s "$CODEX_OUT" ]]; then
  cat "$CODEX_OUT" | bash "$SCRIPT_DIR/parse-output.sh" text
elif [[ "$CODEX_STATUS" == "124" ]]; then
  echo "[ERROR: Codex timed out after ${TIMEOUT}s]"
  FAILURES=$((FAILURES + 1))
else
  echo "[ERROR: Codex failed with exit code $CODEX_STATUS]"
  [[ -s "$CODEX_ERR" ]] && cat "$CODEX_ERR"
  FAILURES=$((FAILURES + 1))
fi
echo "=== END CODEX ==="

# --- Summary ---
TOTAL=0
SUCCESS=0
[[ "$HAS_AGY" == "true" ]] && TOTAL=$((TOTAL + 1))
[[ "$HAS_CODEX" == "true" ]] && TOTAL=$((TOTAL + 1))
SUCCESS=$((TOTAL - FAILURES))

echo "" >&2
echo "Council: ${SUCCESS}/${TOTAL} AIs responded successfully." >&2
