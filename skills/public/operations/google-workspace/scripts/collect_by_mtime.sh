#!/bin/bash
GITHUB_DIR="${GITHUB_DIR:-$HOME/Documents/GitHub}"
SINCE_DATE="$1"  # YYYY-MM-DD
OUTPUT="${2:-/dev/stdout}"

echo "# Project collection by file modification time" > "$OUTPUT"
echo "> Since: $SINCE_DATE" >> "$OUTPUT"
echo "" >> "$OUTPUT"

# Recently modified folders (limited to 50 for performance)
for project_dir in $(ls -1t "$GITHUB_DIR" | head -50); do
  full_path="$GITHUB_DIR/$project_dir"
  [[ ! -d "$full_path" ]] && continue
  [[ -d "$full_path/.git" ]] && continue  # git repos are handled in Stage 1

  # Find recently modified files
  recent_files=$(find "$full_path" \
    -type f \
    -newermt "$SINCE_DATE 00:00:00" \
    ! -path "*/.git/*" \
    ! -path "*/node_modules/*" \
    ! -path "*/__pycache__/*" \
    2>/dev/null | head -5)

  [[ -z "$recent_files" ]] && continue

  echo "## $project_dir" >> "$OUTPUT"
  echo "" >> "$OUTPUT"

  # Show README first
  if [[ -f "$full_path/README.md" ]]; then
    head -3 "$full_path/README.md" | sed 's/^/> /' >> "$OUTPUT"
    echo "" >> "$OUTPUT"
  fi

  # Recent file list
  echo "**Recently modified files:**" >> "$OUTPUT"
  echo "$recent_files" | while read -r file; do
    rel_path="${file#$full_path/}"
    echo "- $rel_path" >> "$OUTPUT"
  done
  echo "" >> "$OUTPUT"
done
