#!/usr/bin/env bash
# Parse and clean output from AI CLI tools.
# Usage: parse-output.sh <format> [< stdin]
#   format: "text" | "json-extract"

set -euo pipefail

FORMAT="${1:-text}"
INPUT="$(cat)"

strip_ansi() {
  sed 's/\x1b\[[0-9;]*[a-zA-Z]//g' | sed 's/\x1b([0-9;]*[a-zA-Z]//g'
}

case "$FORMAT" in
  text)
    printf '%s' "$INPUT" | strip_ansi | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'
    ;;
  json-extract)
    if printf '%s' "$INPUT" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    for key in ('result', 'response', 'output', 'content', 'text', 'message'):
        if key in data:
            val = data[key]
            if isinstance(val, str):
                print(val)
                sys.exit(0)
            elif isinstance(val, list):
                for item in val:
                    if isinstance(item, dict) and 'text' in item:
                        print(item['text'])
                    elif isinstance(item, str):
                        print(item)
                sys.exit(0)
    print(json.dumps(data, indent=2, ensure_ascii=False))
except Exception:
    sys.exit(1)
" 2>/dev/null; then
      :
    else
      printf '%s' "$INPUT" | strip_ansi
    fi
    ;;
  *)
    printf '%s' "$INPUT"
    ;;
esac
