#!/usr/bin/env bash
# Measure the environment expected by this plugin. Do not modify it; report the inventory.
# Exit codes: 0 = complete / 1 = partial (reduced path available) / 2 = blocked
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROBE="$ROOT/skills/bridge/scripts/probe.sh"

blocked=0; partial=0

req() {  # Required: missing means blocked
  bash "$PROBE" "$1" --install "$2" >/dev/null 2>&1 || {
    echo "[2] $1 missing — install: $2"; blocked=$((blocked + 1)); }
}
# Optional tool. Missing means a reduced path, and **an unauthenticated tool is
# also a reduced path**. Report them separately because their remedies differ.
# With an auth check as the fourth argument, preserve probe exit code 1
# (installed but unauthenticated). Without that axis, a logged-out tool would
# incorrectly signal readiness (demonstrated externally with gh).
opt() {
  local rc
  if [ -n "${4-}" ]; then
    bash "$PROBE" "$1" --auth "$4" >/dev/null 2>&1; rc=$?
  else
    bash "$PROBE" "$1" >/dev/null 2>&1; rc=$?
  fi
  case "$rc" in
    0) ;;
    1) echo "[1] $1 unauthenticated — $3 (auth: $4)"; partial=$((partial + 1)) ;;
    *) echo "[1] $1 missing — $3 (install: $2)"; partial=$((partial + 1)) ;;
  esac
}

[ -x "$PROBE" ] || { echo "[2] bridge/scripts/probe.sh is missing — the tree is damaged"; exit 2; }

req python3 "brew install python"
req git     "xcode-select --install"
opt rg   "brew install ripgrep"  "search becomes slower"
opt gh   "brew install gh"       "/pr falls back to browser instructions" "gh auth status"
opt jq   "brew install jq"       "JSON summaries fall back to raw output"

[ $blocked -gt 0 ] && exit 2
[ $partial -gt 0 ] && exit 1
# Status 0 is not silent: the user invoked doctor directly, so no output would
# make it impossible to tell whether it ran. This differs from the probe's
# silence-on-success protocol.
echo "[0] all required and optional tools are available"
exit 0
