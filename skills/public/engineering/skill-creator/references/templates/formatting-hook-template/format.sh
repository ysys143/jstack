#!/usr/bin/env bash
#
# Formatting Hook Template
#
# Purpose: Format files according to project standards
# Trigger: post_generate, pre_commit, etc.
# Author: <your name or organization>

set -euo pipefail

# Configuration defaults
INDENT=2
TRAILING_NEWLINE=true
TRIM_WHITESPACE=true

# Load configuration from environment variables.
#
# hooks.json only wires a matcher to a command in the real schema — it has
# no per-hook `name`/`config` field to read settings from. So this reads
# env vars (falling back to the defaults above); a bash script has no TOML
# parser to read pyproject.toml's [tool.claude-hooks] itself.
load_config() {
    INDENT="${HOOK_INDENT:-$INDENT}"
    TRAILING_NEWLINE="${HOOK_TRAILING_NEWLINE:-$TRAILING_NEWLINE}"
    TRIM_WHITESPACE="${HOOK_TRIM_WHITESPACE:-$TRIM_WHITESPACE}"
}

# Format JSON file
format_json() {
    local file="$1"

    if ! command -v jq >/dev/null 2>&1; then
        echo "[WARN] jq not found, skipping JSON formatting"
        echo "       Install with: brew install jq"
        return 0
    fi

    if ! jq --indent "$INDENT" . "$file" > "$file.tmp" 2>/dev/null; then
        echo "[FAIL] Invalid JSON: $file"
        rm -f "$file.tmp"
        return 1
    fi

    mv "$file.tmp" "$file"
    echo "[OK] Formatted JSON: $file"
}

# Format Markdown file
format_markdown() {
    local file="$1"

    # Trim trailing whitespace if enabled
    if [ "$TRIM_WHITESPACE" = "true" ]; then
        sed -i '' 's/[[:space:]]*$//' "$file"
    fi

    # Add trailing newline if enabled
    if [ "$TRAILING_NEWLINE" = "true" ]; then
        if [ -n "$(tail -c1 "$file" 2>/dev/null)" ]; then
            echo >> "$file"
        fi
    fi

    echo "[OK] Formatted Markdown: $file"
}

# Format Shell script
format_shell() {
    local file="$1"

    if ! command -v shfmt >/dev/null 2>&1; then
        echo "[WARN] shfmt not found, skipping shell formatting"
        echo "       Install with: brew install shfmt"
        return 0
    fi

    shfmt -w -i 4 -bn -ci -sr "$file"
    echo "[OK] Formatted Shell: $file"
}

# Format Python file
format_python() {
    local file="$1"

    if ! command -v black >/dev/null 2>&1; then
        echo "[WARN] black not found, skipping Python formatting"
        echo "       Install with: pip install black"
        return 0
    fi

    black -q "$file"
    echo "[OK] Formatted Python: $file"
}

# Format file based on extension
format_file() {
    local file="$1"

    if [ ! -f "$file" ]; then
        echo "[WARN] File not found: $file"
        return 0
    fi

    case "$file" in
        *.json)
            format_json "$file"
            ;;
        *.md)
            format_markdown "$file"
            ;;
        *.sh)
            format_shell "$file"
            ;;
        *.py)
            format_python "$file"
            ;;
        *)
            echo "[INFO] No formatter for: $file"
            return 0
            ;;
    esac
}

# Format all files matching patterns
format_all() {
    local patterns=("$@")

    if [ ${#patterns[@]} -eq 0 ]; then
        patterns=("*.json" "*.md" "*.sh" "*.py")
    fi

    local count=0
    for pattern in "${patterns[@]}"; do
        while IFS= read -r file; do
            format_file "$file" && ((count++))
        done < <(find . -name "$pattern" -type f -not -path "*/node_modules/*" -not -path "*/.git/*")
    done

    echo ""
    echo "[OK] Formatted $count files"
}

# Read the Claude Code hook payload from stdin.
#
# PostToolUse passes JSON like {"tool_input": {"file_path": ...}, ...} on
# stdin, not as argv — hooks.json's command line carries no extra
# arguments. Prints the file_path found (if any), or nothing.
read_stdin_file_path() {
    if [ -t 0 ] || ! command -v jq >/dev/null 2>&1; then
        return 0
    fi

    local payload
    payload=$(cat)
    [ -z "$payload" ] && return 0

    echo "$payload" | jq -r '.tool_input.file_path // empty' 2>/dev/null
}

# Main execution
main() {
    # Load configuration
    load_config

    # Format specified files (from argv), or the file named in a hook's
    # stdin payload, or all matching patterns if neither is present.
    if [ $# -gt 0 ]; then
        for file in "$@"; do
            format_file "$file"
        done
        return
    fi

    local stdin_file
    stdin_file=$(read_stdin_file_path)

    if [ -n "$stdin_file" ]; then
        format_file "$stdin_file"
    else
        format_all
    fi
}

# Show usage if requested
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
    cat << EOF
Usage: $(basename "$0") [files...]

Format files according to project standards.

Options:
  --help, -h    Show this help message

Examples:
  $(basename "$0")                    # Format all files
  $(basename "$0") file.json file.md  # Format specific files

Configuration (environment variables; hooks.json has no per-hook config):
  HOOK_INDENT               JSON indent width (default: 2)
  HOOK_TRAILING_NEWLINE     Ensure trailing newline on Markdown (default: true)
  HOOK_TRIM_WHITESPACE      Trim trailing whitespace on Markdown (default: true)

EOF
    exit 0
fi

main "$@"
