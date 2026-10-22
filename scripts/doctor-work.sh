#!/usr/bin/env bash
# Diagnose the plugin by running each skill's ensure check.
#
# **Do not install anything.** Report what is blocked and show the command that
# would resolve it. This command must not install tools that will not be used.
#
# Exit codes: 0 no blocked skills / 1 one or more blocked skills
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
ONLY="${1:-}"

# Skill : ensure script (empty means no prerequisite)
SKILLS="deck:ensure_marp.sh
diagram:
humanize:
hwpx:ensure_hwpx.sh
image:probe_backends.sh
office:ensure_officecli.sh
proof:
research:ensure_research.sh
science:
workspace:ensure_gws.sh"

blocked=0
partial=0
ready=0
selfsuf=0

printf '%s\n' "== work-layer diagnosis =="
printf '%s\n' ""

while IFS=: read -r skill script; do
    [ -n "$skill" ] || continue
    [ -z "$ONLY" ] || [ "$ONLY" = "$skill" ] || continue

    if [ -z "$script" ]; then
        printf '  [self-contained] %-10s no prerequisites\n' "$skill"
        selfsuf=$((selfsuf + 1))
        continue
    fi

    path="$ROOT/skills/$skill/scripts/$script"
    if [ ! -f "$path" ]; then
        printf '  [blocked] %-10s check script missing (%s)\n' "$skill" "$script"
        blocked=$((blocked + 1))
        continue
    fi

    out="$(bash "$path" 2>&1)"
    rc=$?
    first="$(printf '%s' "$out" | grep -v '^$' | head -1)"

    case "$rc" in
      0) printf '  [ready] %-10s %s\n' "$skill" "$first"; ready=$((ready + 1)) ;;
      1) # research exits 1 for a self-contained path; that is not a defect.
         # Count it as self-contained when the script says so explicitly.
         if printf '%s' "$out" | grep -q 'self-contained path is the default and expected'; then
             printf '  [self-contained] %-10s %s\n' "$skill" "$first"
             selfsuf=$((selfsuf + 1))
         else
             printf '  [partial] %-10s %s\n' "$skill" "$first"
             partial=$((partial + 1))
         fi ;;
      *) printf '  [blocked] %-10s %s\n' "$skill" "$first"
         printf '%s\n' "$out" | sed -n '2,6p' | sed 's/^/              /'
         blocked=$((blocked + 1)) ;;
    esac
done <<< "$SKILLS"

printf '%s\n' ""
printf '  ready %d · self-contained %d · partial %d · blocked %d\n' \
    "$ready" "$selfsuf" "$partial" "$blocked"

if [ "$blocked" -gt 0 ]; then
    printf '%s\n' ""
    printf '%s\n' "  Resolve only the blocked feature you need now; installing everything is unnecessary."
    printf '%s\n' "  gws still requires OAuth after installation; /setup explains that step."
    exit 1
fi
exit 0
