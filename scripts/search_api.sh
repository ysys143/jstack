#!/usr/bin/env bash
# Search the public marketplace (claude-plugins.dev) for skills and plugins.
#   search_api.sh <skills|plugins> <query> [limit] [orderBy] [order]
#     orderBy: stars|downloads (default stars, skills only)
#     order: desc|asc (default desc, skills only)
#
# **This answers a different question from `/skills`.** `/skills` reads “what is
# in this plugin?” directly from the tree; this script asks “what exists in the
# world?” Treating them as the same left this capability out during migration
# until `check_arrival` detected the omission.
#
# Exit codes: 0 = results printed / 1 = invalid arguments or no response /
# 2 = blocked (curl missing)
#
# Imported from upstream `plugins/skill-search/scripts/search_api.sh` (70 lines).
# Three changes were made: add a shebang because `[[ ]]` fails under `sh`; treat
# missing curl as **blocked (2)** instead of a silent `set -e` exit; and state exit
# codes in the header, matching `doctor.sh` and `inspect.sh`.
#
# **The suite does not exercise network calls.** It checks only argument guards,
# usage, exit codes, the endpoint allowlist, and `set -euo pipefail`.
set -euo pipefail

ENDPOINT="${1:-}"
QUERY="${2:-}"
LIMIT="${3:-10}"
ORDER_BY="${4:-stars}"
ORDER="${5:-desc}"

BASE_URL="https://api.claude-plugins.dev/api"

if [[ -z "$ENDPOINT" || -z "$QUERY" ]]; then
  echo "Usage: $0 <skills|plugins> <query> [limit] [orderBy] [order]"
  exit 1
fi

# **Do not fail by invoking a missing tool.** Check arguments before the environment
# so a usage request does not produce curl installation guidance.
if ! command -v curl >/dev/null 2>&1; then
  echo "search_api.sh: curl is missing — install: brew install curl" >&2
  exit 2
fi

# URL-encode the query (pass via env to avoid shell injection)
ENCODED_QUERY=$(QUERY_INPUT="$QUERY" python3 -c "import urllib.parse, os; print(urllib.parse.quote(os.environ['QUERY_INPUT']))" 2>/dev/null || echo "$QUERY")

if [[ "$ENDPOINT" == "skills" ]]; then
  URL="${BASE_URL}/skills/search?q=${ENCODED_QUERY}&limit=${LIMIT}&orderBy=${ORDER_BY}&order=${ORDER}"
elif [[ "$ENDPOINT" == "plugins" ]]; then
  URL="${BASE_URL}/search?q=${ENCODED_QUERY}&limit=${LIMIT}"
else
  echo "Error: endpoint must be 'skills' or 'plugins'"
  exit 1
fi

RESPONSE=$(curl -s --max-time 15 "$URL")

if [[ -z "$RESPONSE" ]]; then
  echo "Error: No response from API"
  exit 1
fi

# Check if jq is available
if ! command -v jq &>/dev/null; then
  echo "$RESPONSE"
  exit 0
fi

FORMAT_JQ='
  def format_item:
    "---\nName: \(.name // "N/A")\nDescription: \(.description // "N/A")\nStars: \(.stars // 0) | Installs: \(.installs // 0)\nAuthor: \(.author // "N/A")\nNamespace: \(.namespace // .name // "N/A")\n";

  def extract_items:
    if type == "array" then .
    elif .skills? then .skills
    elif .plugins? then .plugins
    elif .data? then .data
    elif .results? then .results
    else null
    end;

  if extract_items then
    "Total: \(.total // (.skills // .plugins // .data // .results // [] | length)) results\n",
    (extract_items | .[] | format_item)
  else
    "Unexpected response format. Raw:\n\(. | tostring)"
  end
'

echo "$RESPONSE" | jq -r "$FORMAT_JQ" 2>/dev/null || echo "$RESPONSE"
