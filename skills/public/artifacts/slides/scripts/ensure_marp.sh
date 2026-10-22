#!/usr/bin/env bash
# Report marp availability with three exit states:
#   0 = all formats (HTML + PDF/PPTX/images)
#   1 = HTML only (marp exists but no browser is available)
#   2 = marp itself is missing
# A binary result would unnecessarily discard the working HTML route when a
# browser is absent. HTML is often enough for procurement draft review.
# This matches the drawio ensure-script contract.
set -u

say() { printf '%s\n' "$*"; }

# 1) marp executable
MARP=""
if command -v marp >/dev/null 2>&1; then
    MARP="marp"
elif command -v npx >/dev/null 2>&1; then
    # npx needs no global installation; network access may be required.
    if npx --no-install @marp-team/marp-cli --version >/dev/null 2>&1; then
        MARP="npx --no-install @marp-team/marp-cli"
    fi
fi

if [ -z "$MARP" ]; then
    say "[2] marp missing; slide rendering unavailable"
    say "    Install: brew install marp-cli   or   npx @marp-team/marp-cli"
    exit 2
fi

VER="$($MARP --version 2>/dev/null | head -1)"
say "marp: $VER"

# 2) Browser: required only for PDF/PPTX/images
FOUND=""
for c in \
    "/Applications/Google Chrome.app" \
    "/Applications/Microsoft Edge.app" \
    "/Applications/Chromium.app" \
    "/Applications/Firefox.app"; do
    if [ -d "$c" ]; then
        FOUND="$(basename "$c" .app)"
        break
    fi
done
if [ -z "$FOUND" ]; then
    for b in google-chrome chromium chromium-browser microsoft-edge firefox; do
        if command -v "$b" >/dev/null 2>&1; then
            FOUND="$b"
            break
        fi
    done
fi
# Prefer an explicit environment override, for example in CI.
if [ -n "${CHROME_PATH:-}" ] && [ -x "${CHROME_PATH}" ]; then
    FOUND="CHROME_PATH=${CHROME_PATH}"
fi

if [ -z "$FOUND" ]; then
    say "[1] no browser; HTML only. PDF/PPTX/images unavailable"
    say "    marp --help Browser Options specifies 'for PDF, PPTX, and image'"
    exit 1
fi

say "browser: $FOUND"
say "[0] all formats available (HTML, PDF, PPTX, images)"
exit 0
