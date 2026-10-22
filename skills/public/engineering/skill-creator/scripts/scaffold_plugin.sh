#!/usr/bin/env bash
# Create a plugin directory structure.
#
#   scaffold_plugin.sh <target-directory> <name> [description] [version] [author]
#
# Example: scaffold_plugin.sh /tmp/my-plugin my-plugin "description" 0.1.0 "Plugin Author"
#
# Preserve existing files so scaffolding remains reversible.
set -euo pipefail

TARGET_DIR="${1:?target_dir required}"
NAME="${2:?name required}"
DESCRIPTION="${3:-Claude Code plugin}"
VERSION="${4:-0.1.0}"
AUTHOR="${5:-${JSTACK_PLUGIN_AUTHOR:-Plugin Author}}"
MARKETPLACE_ID="${JSTACK_MARKETPLACE_ID:-local-plugins}"

# Validate the name before creating paths and documentation.
if ! printf '%s' "$NAME" | grep -qE '^[a-z][a-z0-9-]*$'; then
  echo "name is not kebab-case: ${NAME}" >&2
  exit 2
fi

if [[ -d "$TARGET_DIR/.claude-plugin" ]]; then
  echo "WARN: plugin already exists: $TARGET_DIR"
  echo "  Preserving existing plugin.json."
else
  mkdir -p "$TARGET_DIR/.claude-plugin"
  # Pass values to a JSON encoder; interpolation breaks on quotes and backslashes.
  NAME="$NAME" DESCRIPTION="$DESCRIPTION" VERSION="$VERSION" AUTHOR="$AUTHOR" \
  python3 -c 'import json, os, sys
json.dump({
    "name": os.environ["NAME"],
    "description": os.environ["DESCRIPTION"],
    "version": os.environ["VERSION"],
    "author": {"name": os.environ["AUTHOR"]},
    "keywords": [],
}, sys.stdout, ensure_ascii=False, indent=2)
sys.stdout.write("\n")' > "$TARGET_DIR/.claude-plugin/plugin.json"
  echo "Created .claude-plugin/plugin.json"
fi

# Do not create empty directories because Git does not preserve them.

if [[ ! -f "$TARGET_DIR/README.md" ]]; then
  cat > "$TARGET_DIR/README.md" << RMEOF
# ${NAME}

${DESCRIPTION}

## Features

| Feature | Description |
|------|------|
| TODO | TODO |

## Usage

\`\`\`
/TODO
\`\`\`

## Installation

\`\`\`bash
/plugin install ${NAME}@${MARKETPLACE_ID}
\`\`\`

## Changelog

### v${VERSION}
- Initial release
RMEOF
  echo "Created README.md"
fi

echo "=== Scaffold Complete ==="
echo "Path: $TARGET_DIR"
echo "Name: $NAME"
echo ""
echo "Structure:"
find "$TARGET_DIR" \( -type f -o -type d \) | sort | sed 's/^/  /'
echo ""
echo "Next: write skills/<name>/SKILL.md and run validate_plugin.sh."
