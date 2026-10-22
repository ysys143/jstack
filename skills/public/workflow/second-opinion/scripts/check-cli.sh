#!/usr/bin/env bash
# Check if a CLI tool is installed and provide installation guidance.
# Usage: check-cli.sh <cli-name>
# Exit 0 if found, exit 1 with install instructions if not.

set -euo pipefail

CLI_NAME="${1:?Usage: check-cli.sh <cli-name>}"

if command -v "$CLI_NAME" >/dev/null 2>&1; then
  exit 0
fi

echo "ERROR: '$CLI_NAME' CLI not found." >&2
echo "" >&2

case "$CLI_NAME" in
  agy)
    cat >&2 <<'INSTALL'
Install agy CLI:
  npm install -g @google/agy

Then authenticate:
  agy  # Follow the interactive login flow

Docs: https://github.com/google/agy
INSTALL
    ;;
  gemini)
    cat >&2 <<'INSTALL'
Gemini CLI is deprecated as of 2026-06-18. Install agy instead:
  npm install -g @google/agy
INSTALL
    ;;
  codex)
    cat >&2 <<'INSTALL'
Install Codex CLI:
  npm install -g @openai/codex
  # or
  brew install codex  (macOS)

Then authenticate:
  export OPENAI_API_KEY="your-key"
  # or
  codex login

Docs: https://github.com/openai/codex
INSTALL
    ;;
  *)
    echo "No install instructions available for '$CLI_NAME'." >&2
    echo "Install it and ensure it is on your PATH." >&2
    ;;
esac

exit 1
