#!/usr/bin/env bash
# Bridge script for delegating document-writing tasks to the agy CLI.
# ("gemini" is this bridge's task label, not its backend — see
#  ../references/gemini.md for why the two names diverged.)
# Usage: gemini-bridge.sh --task <type> --prompt <text> [--files <paths>] [--output-format text|json] [--timeout 120]

set -euo pipefail

# --- Environment setup ---
export NVM_DIR="${HOME}/.nvm"
[ -s "${NVM_DIR}/nvm.sh" ] && \. "${NVM_DIR}/nvm.sh" 2>/dev/null || true
[ -f "${HOME}/.oh-my-zsh/custom/apikey.env" ] \
  && source "${HOME}/.oh-my-zsh/custom/apikey.env" \
  && export GEMINI_API_KEY \
  || true

# macOS does not ship 'timeout'; fall back to gtimeout or plain exec
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
# predecessor computed a plugin-root three levels up because its own
# scripts/ sat outside the skill (plugins/multi-ai-delegate/scripts/); that
# directory does not exist here, so the same arithmetic would silently
# resolve to nothing under this layout.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --- Parse arguments ---
TASK=""
PROMPT=""
FILES=""
OUTPUT_FORMAT="text"
TIMEOUT=120

while [[ $# -gt 0 ]]; do
  case "$1" in
    --task)          TASK="$2"; shift 2 ;;
    --prompt)        PROMPT="$2"; shift 2 ;;
    --files)         FILES="$2"; shift 2 ;;
    --output-format) OUTPUT_FORMAT="$2"; shift 2 ;;
    --timeout)       TIMEOUT="$2"; shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

if [[ -z "$PROMPT" ]]; then
  echo "ERROR: --prompt is required" >&2
  exit 1
fi

# --- Check CLI ---
if ! bash "$SCRIPT_DIR/check-cli.sh" agy; then
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

# --- Construct full prompt ---
FULL_PROMPT="Task: ${TASK:-general}

${PROMPT}"

if [[ -n "$FILE_CONTEXT" ]]; then
  FULL_PROMPT+="

## Reference Files
${FILE_CONTEXT}"
fi

# --- Determine parse format ---
PARSE_FORMAT="text"
if [[ "$OUTPUT_FORMAT" == "json" ]]; then
  PARSE_FORMAT="json-extract"
fi

# --- Execute agy CLI ---
EXIT_CODE=0
# The X run has to be the LAST thing in the template. BSD mktemp (macOS)
# substitutes only a trailing run of X's -- given "name-XXXXXXXX.txt" it
# returns that string verbatim, creating one fixed filename. Two runs then
# collide (the second mktemp fails with "File exists") and any leftover from
# a killed run poisons every later run on the machine. GNU mktemp tolerates a
# suffix, so this only ever failed on macOS, which is where it ran.
#
# The trap is armed BEFORE the first mktemp, with both names initialised
# empty: arming it after the second mktemp meant a failure there leaked the
# file the first one had already created. `${VAR:+"$VAR"}` expands to nothing
# while a name is still empty, so the trap is harmless before either exists.
PROMPT_FILE=""
ERR_FILE=""
trap 'rm -f ${PROMPT_FILE:+"$PROMPT_FILE"} ${ERR_FILE:+"$ERR_FILE"}' EXIT
PROMPT_FILE=$(mktemp "${TMPDIR:-/tmp}/gemini-prompt.XXXXXXXX")
ERR_FILE=$(mktemp "${TMPDIR:-/tmp}/gemini-err.XXXXXXXX")
printf '%s' "$FULL_PROMPT" > "$PROMPT_FILE"

# NOTE: agy's --print/--prompt flag CONSUMES the next token as the prompt value
# (--prompt is an alias for --print). The prompt MUST be passed as the flag's
# value, not as a trailing positional arg -- otherwise --print swallows the
# following flag (e.g. "--print-timeout") as the prompt text.
GEMINI_OUTPUT=$(_timeout "$TIMEOUT" \
  agy --prompt "$(cat "$PROMPT_FILE")" --print-timeout "${TIMEOUT}s" --dangerously-skip-permissions \
  2>"$ERR_FILE") || EXIT_CODE=$?

if [[ $EXIT_CODE -eq 124 ]]; then
  echo "ERROR: agy CLI timed out after ${TIMEOUT}s" >&2
  exit 1
elif [[ $EXIT_CODE -ne 0 ]]; then
  echo "ERROR: agy CLI exited with code $EXIT_CODE" >&2
  [[ -s "$ERR_FILE" ]] && cat "$ERR_FILE" >&2
  exit 1
fi

if [[ -z "$GEMINI_OUTPUT" ]]; then
  echo "ERROR: agy returned empty output" >&2
  exit 1
fi

printf '%s\n' "$GEMINI_OUTPUT" | bash "$SCRIPT_DIR/parse-output.sh" "$PARSE_FORMAT"
