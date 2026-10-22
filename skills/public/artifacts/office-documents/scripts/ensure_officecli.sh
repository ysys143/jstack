#!/usr/bin/env bash
# Report OfficeCLI availability with three outcomes.
#
#   0 = available
#   1 = npx exists but cannot fetch the package (network/registry)
#   2 = Node/npx is absent
#
# Do not use officecli install: it adds skills to every detected AI agent,
# a global change the user did not request. Invoke only the binary.
set -u

PKG="@officecli/officecli@latest"

if command -v officecli >/dev/null 2>&1; then
    printf 'officecli: %s (PATH)\n' "$(officecli --version 2>/dev/null | head -1)"
    printf '[0] 사용 가능\n'
    exit 0
fi

if ! command -v npx >/dev/null 2>&1; then
    printf '[2] Node/npx unavailable: cannot invoke OfficeCLI\n'
    printf '    Install: https://nodejs.org or brew install node\n'
    exit 2
fi

VER="$(npx --yes "$PKG" --version 2>/dev/null | head -1)"
if [ -z "$VER" ]; then
    printf '[1] npx exists but could not fetch %s\n' "$PKG"
    printf '    Check network or registry access\n'
    exit 1
fi

printf 'officecli: %s (npx)\n' "$VER"
printf '[0] 사용 가능\n'
exit 0
