#!/usr/bin/env bash
#
# Notification Hook Template
#
# Purpose: Send notifications when events occur
# Trigger: post_commit, post_generate, etc.
# Author: <your name or organization>

set -euo pipefail

# Rate limiting
RATE_LIMIT_FILE="/tmp/plugin_notifications_$(basename "$0").log"
RATE_LIMIT_MAX=10
RATE_LIMIT_WINDOW=3600  # 1 hour in seconds

# Load configuration from environment variables.
#
# hooks.json only wires a matcher to a command in the real schema — it has
# no per-hook `name`/`config` field to read settings from. So this builds
# the same config object downstream code expects (rate_limit, webhook_url,
# channels, template) from env vars and defaults; a bash script has no
# TOML parser to read pyproject.toml's [tool.claude-hooks] itself.
load_config() {
    local rate_limit_enabled="${HOOK_RATE_LIMIT_ENABLED:-true}"
    local rate_limit_max="${HOOK_RATE_LIMIT_MAX_PER_HOUR:-10}"
    local channels="${HOOK_NOTIFY_CHANNELS:-console}"
    local webhook_url="${HOOK_SLACK_WEBHOOK_URL:-${SLACK_WEBHOOK_URL:-}}"
    local template="${HOOK_NOTIFY_TEMPLATE:-default}"

    jq -n \
        --arg rate_enabled "$rate_limit_enabled" \
        --arg rate_max "$rate_limit_max" \
        --arg webhook_url "$webhook_url" \
        --arg template "$template" \
        --arg channels "$channels" \
        '{
            rate_limit: {
                enabled: ($rate_enabled == "true"),
                max_per_hour: ($rate_max | tonumber)
            },
            webhook_url: $webhook_url,
            template: $template,
            channels: ($channels | split(",")),
            notify_on: {}
        }'
}

# Check rate limit
check_rate_limit() {
    local config="$1"
    local enabled
    enabled=$(echo "$config" | jq -r '.rate_limit.enabled // true')

    if [ "$enabled" != "true" ]; then
        return 0
    fi

    local max_per_hour
    max_per_hour=$(echo "$config" | jq -r '.rate_limit.max_per_hour // 10')

    local now
    now=$(date +%s)

    # Clean old entries
    if [ -f "$RATE_LIMIT_FILE" ]; then
        awk -v cutoff=$((now - RATE_LIMIT_WINDOW)) '$1 > cutoff' \
            "$RATE_LIMIT_FILE" > "$RATE_LIMIT_FILE.tmp" 2>/dev/null || true
        mv "$RATE_LIMIT_FILE.tmp" "$RATE_LIMIT_FILE" 2>/dev/null || true
    fi

    # Count recent notifications
    local count=0
    if [ -f "$RATE_LIMIT_FILE" ]; then
        count=$(wc -l < "$RATE_LIMIT_FILE" | tr -d ' ')
    fi

    if [ "$count" -ge "$max_per_hour" ]; then
        echo "[WARN] Rate limit exceeded ($count/$max_per_hour per hour)" >&2
        return 1
    fi

    # Record this notification
    echo "$now" >> "$RATE_LIMIT_FILE"
    return 0
}

# Console notification
notify_console() {
    local level="$1"
    local message="$2"

    local prefix
    case "$level" in
        success) prefix="[OK]" ;;
        failure) prefix="[FAIL]" ;;
        warning) prefix="[WARN]" ;;
        *) prefix="[INFO]" ;;
    esac

    echo "$prefix $message"
}

# Slack notification
notify_slack() {
    local webhook_url="$1"
    local message="$2"

    if [ -z "$webhook_url" ] || [ "$webhook_url" = "null" ]; then
        return 1
    fi

    curl -X POST "$webhook_url" \
        -H 'Content-Type: application/json' \
        -d "{\"text\": \"$message\"}" \
        -s -o /dev/null \
        2>/dev/null
}

# Desktop notification (macOS)
notify_desktop() {
    local title="$1"
    local message="$2"

    if command -v osascript >/dev/null 2>&1; then
        osascript -e "display notification \"$message\" with title \"$title\"" 2>/dev/null
        return 0
    elif command -v notify-send >/dev/null 2>&1; then
        notify-send "$title" "$message" 2>/dev/null
        return 0
    fi

    return 1
}

# Get event context
get_event_context() {
    local event="$1"

    case "$event" in
        commit|post_commit)
            if git rev-parse --git-dir >/dev/null 2>&1; then
                local hash
                hash=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")
                local msg
                msg=$(git log -1 --pretty=%s 2>/dev/null || echo "")
                local author
                author=$(git log -1 --pretty=%an 2>/dev/null || echo "")

                jq -n \
                    --arg hash "$hash" \
                    --arg msg "$msg" \
                    --arg author "$author" \
                    '{hash: $hash, message: $msg, author: $author}'
            else
                echo '{}'
            fi
            ;;

        generate|post_generate)
            if [ -f ".claude-plugin/plugin.json" ]; then
                jq -c '{name, version, description}' .claude-plugin/plugin.json 2>/dev/null || echo '{}'
            else
                echo '{}'
            fi
            ;;

        *)
            echo '{}'
            ;;
    esac
}

# Render message template
render_template() {
    local template="$1"
    local context="$2"

    case "$template" in
        commit_success)
            local hash
            hash=$(echo "$context" | jq -r '.hash // "unknown"')
            local msg
            msg=$(echo "$context" | jq -r '.message // ""')
            local author
            author=$(echo "$context" | jq -r '.author // ""')

            cat << EOF
Commit successful: $hash
Author: $author
Message: $msg
EOF
            ;;

        plugin_generated)
            local name
            name=$(echo "$context" | jq -r '.name // "unknown"')
            local version
            version=$(echo "$context" | jq -r '.version // "0.0.0"')

            cat << EOF
Plugin generated: $name v$version
EOF
            ;;

        default)
            echo "$context"
            ;;

        *)
            echo "$context"
            ;;
    esac
}

# Send notification to all configured channels
send_notifications() {
    local config="$1"
    local level="$2"
    local message="$3"

    local channels
    channels=$(echo "$config" | jq -r '.channels // ["console"] | .[]')

    local sent=false

    while IFS= read -r channel; do
        case "$channel" in
            console)
                notify_console "$level" "$message"
                sent=true
                ;;

            slack)
                local webhook_url
                webhook_url=$(echo "$config" | jq -r '.webhook_url // env.SLACK_WEBHOOK_URL // ""')
                if notify_slack "$webhook_url" "$message"; then
                    sent=true
                fi
                ;;

            desktop)
                if notify_desktop "Plugin Event" "$message"; then
                    sent=true
                fi
                ;;

            *)
                echo "[WARN] Unknown notification channel: $channel" >&2
                ;;
        esac
    done <<< "$channels"

    if [ "$sent" = "false" ]; then
        # Fallback to console
        notify_console "$level" "$message"
    fi
}

# Main execution
main() {
    # Read the Claude Code hook payload from stdin when invoked as a hook.
    #
    # PostToolUse passes JSON like {"tool_name": ..., "tool_input": ...} on
    # stdin, not as argv — hooks.json's command line has no event/level
    # arguments. Manual CLI use (with event/level passed as $1/$2) skips
    # this since stdin is normally a terminal in that case.
    local payload="{}"
    if [ ! -t 0 ]; then
        local stdin_data
        stdin_data=$(cat)
        [ -n "$stdin_data" ] && payload="$stdin_data"
    fi

    local event="${1:-}"
    if [ -z "$event" ] && command -v jq >/dev/null 2>&1; then
        event=$(echo "$payload" | jq -r '.tool_name // empty' 2>/dev/null)
    fi
    event="${event:-unknown}"

    local level="${2:-info}"

    # Load configuration
    local config
    config=$(load_config)

    # Check if should notify based on level
    local notify_on
    notify_on=$(echo "$config" | jq -r ".notify_on.$level // true")
    if [ "$notify_on" != "true" ]; then
        exit 0
    fi

    # Check rate limit
    if ! check_rate_limit "$config"; then
        exit 0
    fi

    # Get event context
    local context
    context=$(get_event_context "$event")

    # Render message from template
    local template
    template=$(echo "$config" | jq -r '.template // "default"')
    local message
    message=$(render_template "$template" "$context")

    # Send notifications
    send_notifications "$config" "$level" "$message"
}

# Show usage if requested
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
    cat << EOF
Usage: $(basename "$0") [event] [level]

Send notification when event occurs.

Arguments:
  event     Event name (commit, generate, etc.)
  level     Notification level (success, failure, warning, info)

Configuration (environment variables; hooks.json has no per-hook config):
  HOOK_RATE_LIMIT_ENABLED       Enable rate limiting (default: true)
  HOOK_RATE_LIMIT_MAX_PER_HOUR  Max notifications per hour (default: 10)
  HOOK_NOTIFY_CHANNELS          Comma-separated channels: console,slack,desktop (default: console)
  HOOK_SLACK_WEBHOOK_URL        Slack webhook URL (falls back to SLACK_WEBHOOK_URL)
  HOOK_NOTIFY_TEMPLATE          Message template: default, commit_success, plugin_generated (default: default)

Examples:
  $(basename "$0") commit success
  $(basename "$0") generate failure

EOF
    exit 0
fi

main "$@"
