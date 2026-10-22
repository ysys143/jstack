#!/usr/bin/env bash
# Register a plugin in this machine's Claude configuration at user scope.
#
#   register_local.sh <plugin-source> <plugin-name> [marketplace-id]
#
# 1) Copy plugin files into cache
# 2) Register in installed_plugins.json
# 3) Add it to settings.json enabledPlugins
#
# Registration takes effect in the next session; the current session cannot invoke it.
set -euo pipefail

PLUGIN_SOURCE="${1:?plugin source directory required}"
PLUGIN_NAME="${2:?plugin name required}"
MARKETPLACE_ID="${3:-${JSTACK_MARKETPLACE_ID:-local-plugins}}"

# Respect CLAUDE_CONFIG_DIR for installations with multiple profiles.
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-${HOME}/.claude}"
PLUGINS_DIR="${CLAUDE_DIR}/plugins"
INSTALLED_JSON="${PLUGINS_DIR}/installed_plugins.json"
SETTINGS_JSON="${CLAUDE_DIR}/settings.json"

command -v jq >/dev/null 2>&1 || { echo "jq is missing; registration uses it to edit JSON" >&2; exit 2; }

PLUGIN_JSON="${PLUGIN_SOURCE}/.claude-plugin/plugin.json"
if [[ ! -f "$PLUGIN_JSON" ]]; then
  echo "ERROR: .claude-plugin/plugin.json is missing: ${PLUGIN_SOURCE}" >&2
  exit 1
fi

# Fail when version cannot be read; a fallback can create a second stale installation.
VERSION=$(jq -er '.version' "$PLUGIN_JSON") || {
  echo "ERROR: cannot read version from plugin.json: ${PLUGIN_JSON}" >&2
  exit 1
}

# Registration targets must exist; a cache copy alone is not registration.
for f in "$INSTALLED_JSON" "$SETTINGS_JSON"; do
  [[ -f "$f" ]] || { echo "ERROR: registration target file is missing: $f" >&2
                     echo "  Check CLAUDE_CONFIG_DIR (current: ${CLAUDE_DIR})" >&2
                     exit 1; }
done

# Edit JSON through a temporary file so jq failure cannot truncate user settings.
edit_json() {   # $1=file; remaining arguments belong to jq
  local file="$1"; shift
  local tmp
  tmp="$(mktemp "${file}.XXXXXX")"
  if jq "$@" "$file" > "$tmp"; then
    mv "$tmp" "$file"
  else
    rm -f "$tmp"
    echo "ERROR: JSON edit failed; preserved ${file}" >&2
    return 1
  fi
}

CACHE_DIR="${PLUGINS_DIR}/cache/${MARKETPLACE_ID}/${PLUGIN_NAME}/${VERSION}"
if [[ -d "$CACHE_DIR" ]]; then
  echo "Updating existing installation: ${CACHE_DIR}"
  find "$CACHE_DIR" -mindepth 1 -delete
else
  mkdir -p "$CACHE_DIR"
fi
cp -R "$PLUGIN_SOURCE"/. "$CACHE_DIR"/
echo "Copied plugin to: ${CACHE_DIR}"

PLUGIN_KEY="${PLUGIN_NAME}@${MARKETPLACE_ID}"
NOW=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")

edit_json "$INSTALLED_JSON" \
  --arg key "$PLUGIN_KEY" --arg path "$CACHE_DIR" --arg ver "$VERSION" --arg now "$NOW" \
  '.plugins[$key] = [{
     "scope": "user",
     "installPath": $path,
     "version": $ver,
     "installedAt": $now,
     "lastUpdated": $now
   }]'
echo "Registered in installed_plugins.json: ${PLUGIN_KEY}"

edit_json "$SETTINGS_JSON" --arg key "$PLUGIN_KEY" '.enabledPlugins[$key] = true'
echo "Enabled in settings.json: ${PLUGIN_KEY}"

echo ""
echo "=== Local Registration Complete ==="
echo "Plugin: ${PLUGIN_KEY}"
echo "Version: ${VERSION}"
echo "Path: ${CACHE_DIR}"
echo ""
echo "Unavailable in this session. Restart Claude Code to load it."
