#!/bin/bash
# Collect projects from git log (weekly report Stage 1).
#
# The upstream document (collect-all-projects.md) calls this script but **contained no
# body** — its quoted block was an ellipsis excerpt such as `git -C ... log ...`.
# This implementation follows the behavior described by the document.
#
# Process projects with .git only; collect_by_mtime.sh covers the rest.
#
# Usage: collect_git.sh <SINCE:YYYY-MM-DD> [UNTIL:YYYY-MM-DD] [OUTPUT]
set -u

GITHUB_DIR="${GITHUB_DIR:-$HOME/Documents/GitHub}"
SINCE="${1:?Usage: collect_git.sh <YYYY-MM-DD> [UNTIL] [OUTPUT]}"
UNTIL="${2:-$(date +%F)}"
OUTPUT="${3:-/dev/stdout}"
# Commit filter. Empty means everyone; set a name or email fragment to select the report author.
AUTHOR="${GIT_COLLECT_AUTHOR:-}"

if [ ! -d "$GITHUB_DIR" ]; then
    printf 'Collection directory does not exist: %s\n' "$GITHUB_DIR" >&2
    printf 'Set the GITHUB_DIR environment variable\n' >&2
    exit 2
fi

{
    printf '# Git Log collection\n'
    printf '> Period: %s ~ %s\n' "$SINCE" "$UNTIL"
    [ -n "$AUTHOR" ] && printf '> Author filter: %s\n' "$AUTHOR"
    printf '\n'
} > "$OUTPUT"

found=0
for repo_dir in "$GITHUB_DIR"/*/; do
    [ -d "$repo_dir/.git" ] || continue
    name="$(basename "$repo_dir")"

    if [ -n "$AUTHOR" ]; then
        log="$(git -C "$repo_dir" log \
            --since="$SINCE 00:00:00" --until="$UNTIL 23:59:59" \
            --author="$AUTHOR" --pretty=format:'- %ad %s' --date=short 2>/dev/null)"
    else
        log="$(git -C "$repo_dir" log \
            --since="$SINCE 00:00:00" --until="$UNTIL 23:59:59" \
            --pretty=format:'- %ad %s' --date=short 2>/dev/null)"
    fi

    [ -z "$log" ] && continue
    found=$((found + 1))
    {
        printf '## %s\n\n' "$name"
        printf '%s\n\n' "$log"
    } >> "$OUTPUT"
done

printf '%d projects with commits\n' "$found" >&2
exit 0
