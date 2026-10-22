#!/usr/bin/env bash
# Hook: PreToolUse(Bash)
#
# Intercept publish/register calls, run the format validator on the target
# plugin, and block on failure.
#
# Read the host stdin JSON protocol. Environment variables are not hook input.
#
# --- Exit protocol ---------------------------------------------------------
#   0 = pass (allow tool execution)
#   1 = block (prevent tool execution)
#
# Python hooks in the same chain use `exit 0` plus
# `{"decision":"block"}` on stdout. This hook alone returns nonzero, preserving
# the old contract because it is the chain's only shell hook and emits a
# human-readable diagnostic directly to stdout when blocking.
#
# --- Do not report unevaluated input as a pass -----------------------------
#
# Emit a pass only after the validator actually runs. Silent exit 0 was the
# failure mode that made this hook dead (FAILURE-MODES.md class A). A missing
# target path is a block, not a pass; this repository names that failure N-11.

set -uo pipefail

PAYLOAD=$(cat)

PARSED=$(printf '%s' "$PAYLOAD" | python3 -c '
import json, sys
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(1)
name = data.get("tool_name") or ""
command = ((data.get("tool_input") or {}).get("command") or "").replace("\n", " ")
print(name)
print(command)
' 2>/dev/null) || exit 0

TOOL_NAME=$(printf '%s' "$PARSED" | sed -n '1p')
COMMAND=$(printf '%s' "$PARSED" | sed -n '2p')

[[ "$TOOL_NAME" == "Bash" ]] || exit 0

# Ordinary Bash commands other than publish/register are outside this hook.
# Inspecting command substitutions in unrelated commands would break the
# existing no-op contract.
case "$COMMAND" in
    *register_local.sh*) ;;
    *) exit 0 ;;
esac

# shlex tokenizes without executing. Splitting at the first space with grep
# would mistake `"/tmp/plugin with spaces"` for `/tmp/plugin` and block an
# existing directory. punctuation_chars=True also preserves compound-command
# boundaries such as &&.
PARSE_RESULT=$(printf '%s' "$COMMAND" | python3 -c '
import os
import shlex
import sys

command = sys.stdin.read()
if any(marker in command for marker in ("$(", "`", "<(", ">(")):
    print("ERROR")
    raise SystemExit
try:
    lexer = shlex.shlex(command, posix=True, punctuation_chars=True)
    lexer.whitespace_split = True
    tokens = list(lexer)
except ValueError:
    print("ERROR")
    raise SystemExit

scripts = {"register_local.sh"}
operators = {";", "&&", "||", "|", "&", ">", ">>", "<", "<<"}
logical_cwd = os.getcwd()
for index, token in enumerate(tokens):
    if token == "cd":
        if index + 1 >= len(tokens) or tokens[index + 1] in operators:
            print("ERROR")
            raise SystemExit
        destination = tokens[index + 1]
        logical_cwd = os.path.abspath(
            destination if os.path.isabs(destination)
            else os.path.join(logical_cwd, destination)
        )
    if os.path.basename(token) not in scripts:
        continue
    if index + 1 >= len(tokens) or tokens[index + 1] in operators:
        print("ERROR")
        raise SystemExit
    source = tokens[index + 1]
    if "\n" in source or "\r" in source:
        print("ERROR")
        raise SystemExit
    if not os.path.isabs(source):
        source = os.path.join(logical_cwd, source)
    print("OK")
    print(source)
    raise SystemExit

print("NONE")
' 2>/dev/null)

PARSE_STATUS=$(printf '%s' "$PARSE_RESULT" | sed -n '1p')
case "$PARSE_STATUS" in
    NONE) exit 0 ;;
    ERROR)
        echo "[BLOCK] Could not safely parse the plugin path from the publish/register call"
        echo "        command: ${COMMAND}"
        exit 1
        ;;
    OK) PLUGIN_SOURCE=$(printf '%s' "$PARSE_RESULT" | sed -n '2p') ;;
    *)
        echo "[BLOCK] Could not parse the publish/register call"
        echo "        command: ${COMMAND}"
        exit 1
        ;;
esac

if [[ ! -d "$PLUGIN_SOURCE" ]]; then
    echo "[BLOCK] Plugin directory does not exist: ${PLUGIN_SOURCE}"
    exit 1
fi

# Resolve the validator from this plugin's source or installed payload.
HOOKS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VALIDATE_SCRIPT=""
for candidate in \
    "${HOOKS_DIR}/../scripts/validate_plugin.sh" \
    "${HOOKS_DIR}/../skills/author/scripts/validate_plugin.sh" \
    "${HOOKS_DIR}/../../../skills/author/scripts/validate_plugin.sh"
do
    if [[ -f "$candidate" ]]; then
        VALIDATE_SCRIPT="$candidate"
        break
    fi
done
if [[ -z "$VALIDATE_SCRIPT" ]]; then
    echo "[BLOCK] Format validator not found; no decision was made"
    echo "        Required: skills/author/scripts/validate_plugin.sh in this plugin"
    exit 1
fi

echo "[HOOK] Pre-publish format validation: ${PLUGIN_SOURCE}"
echo "       Validator: ${VALIDATE_SCRIPT}"

if bash "$VALIDATE_SCRIPT" "$PLUGIN_SOURCE"; then
    echo "[HOOK] Validation passed; continuing publish/register"
    exit 0
fi

echo "[BLOCK] Validation failed; publish/register was blocked"
echo "        Reproduce manually: bash ${VALIDATE_SCRIPT} ${PLUGIN_SOURCE}"
exit 1
