#!/usr/bin/env bash
# Determine availability of both image-generation paths.
#
#   0 = both available
#   1 = only one available (identify it in the output)
#   2 = neither available
#
# A binary result cannot represent the common case of one available path.
# Codex alone lacks dimensional control; nanobanana alone needs key setup.
# The available path determines what must be disclosed to the user beforehand.
set -u

CODEX=0
NANO=0

if command -v codex >/dev/null 2>&1; then
    CODEX=1
    printf 'codex: %s\n' "$(command codex --version 2>/dev/null | head -1)"
else
    printf 'codex: 없음\n'
fi

# Nanobanana requires both a key and the script.
SCRIPT="$(dirname "$0")/nanobanana.py"
KEY_FILE="$HOME/.claude/.env.nanobanana"
HAS_KEY=0
if [ -n "${GEMINI_API_KEY:-}" ]; then
    HAS_KEY=1
    KEY_SRC="environment variable"
elif [ -f "$KEY_FILE" ] && grep -q 'GEMINI_API_KEY' "$KEY_FILE" 2>/dev/null; then
    HAS_KEY=1
    KEY_SRC="$KEY_FILE"
fi

if [ -f "$SCRIPT" ] && [ "$HAS_KEY" -eq 1 ]; then
    NANO=1
    printf 'nanobanana: 사용 가능 (key source: %s)\n' "$KEY_SRC"
elif [ ! -f "$SCRIPT" ]; then
    printf 'nanobanana: 스크립트 없음\n'
else
    printf 'nanobanana: GEMINI_API_KEY 없음 — optional for Google API key holders\n'
    printf '  1) Obtain: https://aistudio.google.com/apikey (Google account required; usage is billed to that account)\n'
    printf '  2) Configure: printf %s > %s && chmod 600 %s\n' \
        "'GEMINI_API_KEY=YOUR_ISSUED_KEY\\n'" "$KEY_FILE" "$KEY_FILE"
    printf '     Or in the shell: export GEMINI_API_KEY=YOUR_ISSUED_KEY\n'
    printf '  3) Dependencies: uv pip install -r <skill>/requirements.txt (install explicitly)\n'
    printf '  Note: the working directory .env overrides home settings. Never commit keys\n'
fi

TOTAL=$((CODEX + NANO))
if [ "$TOTAL" -eq 2 ]; then
    printf '[0] 두 경로 모두 가능 — use nanobanana for dimensional control\n'
    exit 0
elif [ "$TOTAL" -eq 1 ]; then
    if [ "$CODEX" -eq 1 ]; then
        printf '[1] codex 만 가능 — aspect ratio and resolution cannot be fixed through arguments\n'
    else
        printf '[1] nanobanana 만 가능\n'
    fi
    exit 1
fi

printf '[2] 두 경로 모두 불가 — cannot generate images\n'
exit 2
