#!/usr/bin/env bash
# Check research tools: the self-contained path needs no external preparation.
#
# Contract:
#   0  self-contained path and hyperresearch both available
#   1  only self-contained path available (normal default)
#   2  self-contained path unavailable because python3 is absent
#
# The outcome convention matches other ensure scripts, but its meaning
# differs: 1 is the normal state here, designed to work without external tools.
set -u
say() { printf '%s\n' "$*"; }

PY="${PYTHON:-python3}"
if ! command -v "$PY" >/dev/null 2>&1; then
  say "[2] python3 unavailable: cannot run checkers"
  say "    macOS: brew install python@3.12"
  exit 2
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
for s in cite_check.py coverage_matrix.py; do
  if [ ! -f "$HERE/$s" ]; then
    say "[2] $s is absent: skill installation is broken"
    exit 2
  fi
done
say "Self-contained checkers: cite_check.py / coverage_matrix.py available"

if command -v hyperresearch >/dev/null 2>&1; then
  say "hyperresearch: $(hyperresearch --version 2>/dev/null | head -1)"
  say "[0] Self-contained path and broad sweep both available"
  exit 0
fi

say "[1] Only self-contained path available: this is the normal default"
say ""
say "    For a broad sweep of 55-80 sources:"
say "      uv tool install hyperresearch"
say ""
say "    Still run our own citation and requirements checks:"
say "    upstream cite-check checks only one of two pairs (references/cite-check.md)."
exit 1
