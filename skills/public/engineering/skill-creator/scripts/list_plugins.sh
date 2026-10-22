#!/usr/bin/env bash
# List marketplace plugins and their skills.
#
#   list_plugins.sh [marketplace-root]
#
# Default to JSTACK_MARKETPLACE_DIR, then the marketplace under CLAUDE_CONFIG_DIR.
#
# Follow CLAUDE_CONFIG_DIR so alternate profiles do not resolve to a nonexistent ~/.claude.
set -euo pipefail

CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-${HOME}/.claude}"
DEFAULT_ROOT="${JSTACK_MARKETPLACE_DIR:-${CLAUDE_DIR}/plugins/marketplaces/local-plugins}"
MARKETPLACE_ROOT="${1:-$DEFAULT_ROOT}"
PLUGINS_DIR="${MARKETPLACE_ROOT}/plugins"

command -v jq >/dev/null 2>&1 || { echo "jq is missing; this script uses it to read manifests" >&2; exit 2; }

if [[ ! -d "$PLUGINS_DIR" ]]; then
  echo "marketplace not found: ${PLUGINS_DIR}" >&2
  echo "  Pass its path or set JSTACK_MARKETPLACE_DIR." >&2
  exit 1
fi

echo "=== ${MARKETPLACE_ROOT} ==="
echo ""

found=0
for plugin_dir in "$PLUGINS_DIR"/*/; do
  [[ -d "$plugin_dir" ]] || continue
  found=$((found + 1))
  plugin_name=$(basename "$plugin_dir")

  pj="${plugin_dir}.claude-plugin/plugin.json"
  if [[ -f "$pj" ]]; then
    desc=$(jq -r '.description // "N/A"' "$pj" 2>/dev/null || echo "N/A")
    keywords=$(jq -r '.keywords // [] | join(", ")' "$pj" 2>/dev/null || echo "")
  else
    # Identify manifestless directories explicitly rather than silently omitting them.
    desc="(no manifest; not a plugin)"
    keywords=""
  fi

  echo "--- ${plugin_name} ---"
  echo "  Description: ${desc}"
  [[ -n "$keywords" ]] && echo "  Keywords: ${keywords}"

  skills_dir="${plugin_dir}skills"
  skill_count=0
  skill_list=""
  if [[ -d "$skills_dir" ]]; then
    for skill in "$skills_dir"/*; do
      if [[ -d "$skill" ]]; then
        sname=$(basename "$skill")
      elif [[ -f "$skill" && "$skill" == *.md ]]; then
        sname=$(basename "$skill" .md)
      else
        continue
      fi
      skill_list="${skill_list}    - ${sname}"$'\n'
      skill_count=$((skill_count + 1))
    done
  fi
  if [[ $skill_count -gt 0 ]]; then
    echo "  Skills (${skill_count}):"
    printf '%s' "$skill_list"
  else
    echo "  Skills: (none)"
  fi
  echo ""
done

echo "${found} plugins"
