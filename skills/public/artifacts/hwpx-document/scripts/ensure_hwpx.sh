#!/usr/bin/env bash
# Check HWPX tools on demand.
#
# Exit contract, matching other ensure scripts:
#   0  All operations available
#   1  Partial: .hwpx available, .hwp input unavailable
#   2  Unavailable: installation required
#
# Do not install on the user's behalf. Explain what is needed and why, then stop.
set -u
say() { printf '%s\n' "$*"; }

PY="${PYTHON:-python3}"

if ! command -v "$PY" >/dev/null 2>&1; then
  say "[2] python3 missing: .hwpx generation and validation unavailable"
  say "    macOS: brew install python@3.12"
  exit 2
fi

if ! "$PY" -c 'import lxml' >/dev/null 2>&1; then
  say "[2] lxml missing: OWPML manipulation unavailable"
  say "    Install: uv pip install -r \"\${CLAUDE_PLUGIN_ROOT}/skills/hwpx/requirements.txt\""
  say "    Or: uv run --with lxml python3 <script>"
  say ""
  say "    lxml handles HWPX XML. Preserving the namespaces and ordering"
  say "    required by Hancom is difficult with the standard xml.etree."
  exit 2
fi
say "lxml: $("$PY" -c 'import lxml.etree as e; print(e.__version__)' 2>/dev/null)"

# Legacy .hwp input optionally requires Windows and Hancom COM.
if [ "$(uname -s)" = "Darwin" ] || [ "$(uname -s)" = "Linux" ]; then
  say "[1] .hwp input unavailable: requires Windows, Hancom Office, and pywin32"
  say "    .hwpx generation and validation remain available; see references/com-windows-guide.md"
  exit 1
fi

if ! "$PY" -c 'import win32com' >/dev/null 2>&1; then
  say "[1] pywin32 missing: only .hwp input is unavailable"
  say "    Install: uv pip install pywin32"
  exit 1
fi
say "pywin32: available (.hwp input supported)"
exit 0
