#!/usr/bin/env bash
# Report gws availability with three values so /setup knows which phase to guide.
#
#   0 = available (installed + account settings present)
#   1 = installed but account settings absent -> start with authentication
#   2 = not installed -> start with installation
#
# Catch the same-name tool trap here too. `brew install gws` installs a git workspace
# tool with the same name; checking presence alone could use the wrong tool.
set -u

CONFIG_BASE="$HOME/.config"

if ! command -v gws >/dev/null 2>&1; then
    printf 'gws: missing\n'
    printf '  Install: brew install googleworkspace-cli\n'
    printf '  Note: `brew install gws` is a **different same-name tool** (git workspace)\n'
    printf '[2] installation required\n'
    exit 2
fi

VER="$(gws --version 2>/dev/null | head -1)"

# Identify the same-name tool — googleworkspace-cli has an auth subcommand.
if ! gws --help 2>&1 | grep -qi 'auth'; then
    printf 'gws: %s\n' "${VER:-unknown}"
    printf '  This gws has no auth subcommand — likely a **different same-name tool**\n'
    printf '  Check: gws --help | head -20\n'
    printf '  Replace: brew uninstall gws && brew install googleworkspace-cli\n'
    printf '[2] wrong tool\n'
    exit 2
fi

printf 'gws: %s\n' "${VER:-installed}"

# Treat an account directory as configured only when it contains a client secret,
# token, or credential file.
FOUND=""
for d in "$CONFIG_BASE"/gws-*; do
    [ -d "$d" ] || continue
    if ls "$d" 2>/dev/null | grep -qiE 'client_secret|token|credential'; then
        FOUND="${FOUND}${FOUND:+, }$(basename "$d")"
    fi
done

if [ -z "$FOUND" ]; then
    printf 'Account settings: missing\n'
    printf '  client_secret.json is required under ~/.config/gws-{account}/\n'
    printf '  Guide: /setup authentication\n'
    printf '[1] authentication required\n'
    exit 1
fi

printf 'Account settings: %s\n' "$FOUND"
printf '  Always set GOOGLE_WORKSPACE_CLI_CONFIG_DIR when running\n'
printf '[0] available\n'
exit 0
