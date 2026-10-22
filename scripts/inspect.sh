#!/usr/bin/env bash
# Measure one skill's contract state: check count, layers, and frozen references.
#   inspect.sh <skill-name>
# Exit codes: 0 = contract exists / 1 = no contract / 2 = skill does not exist
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
N="${1-}"
[ -n "$N" ] || { echo "[2] skill name is missing"; exit 2; }
D="$ROOT/skills/$N"
[ -d "$D" ] || { echo "[2] $N: skill does not exist"; exit 2; }

echo "Skill: $N"
[ -f "$D/SKILL.md" ] && echo "  [L1] SKILL.md — $(wc -l < "$D/SKILL.md" | tr -d ' ') lines"
# **L2 is not limited to references/.** tdd has 1,672 lines in langs/, so counting
# only references/ would report the false defect “L2 has 0 items although SKILL.md
# is long; the layer layout is wrong” (confirmed by external review).
refs=0; l2dirs=""
for sub in references langs; do
  n=$(ls "$D/$sub" 2>/dev/null | wc -l | tr -d ' ')
  [ "$n" -gt 0 ] && { refs=$((refs + n)); l2dirs="${l2dirs:+$l2dirs }$sub/"; }
done
scr=$(ls "$D/scripts" 2>/dev/null | wc -l | tr -d ' ')
echo "  [L2] ${l2dirs:-(none)} — ${refs} items"
echo "  [L3] scripts/ — ${scr} items"

# **Do not hard-code suite filenames**; use the same rule as the runner and floor
# checker. Otherwise a skill with a differently named suite is reported as having
# no contract (review 9 caught deck outside the runner gate).
# **Run every suite, as the runner does.** An earlier version kept only the last
# suite in `S`, so inspect skipped the first suite for skills with two; the runner
# ran both, creating an asymmetry (review 11). No current dev-layer skill exposed it,
# but harmless is not correct.
SUITES=""
for _s in "$D"/tests/*.py; do
  case "$(basename "$_s")" in _*) continue ;; esac
  [ -f "$_s" ] && SUITES="${SUITES:+$SUITES }$(basename "$_s")"
done
if [ -z "$SUITES" ]; then
  # **No contract is not a pass.** Returning 0 here would give a skill without
  # a contract the same signal as a skill whose contract passed.
  echo "  Contract — none"
  exit 1
fi
frozen=$(ls "$D/tests/refs" 2>/dev/null | grep -c '\.lines$' || true)
echo "  Frozen references — ${frozen} items"
out="$(cd "$D" && _acc=0
                 for _n in $SUITES; do python3 "tests/$_n" 2>&1 || _acc=1; done
                 exit $_acc)"; rc=$?
echo "  Contract — $(printf '%s' "$out" | tail -1)"
[ $rc -eq 0 ] || { printf '%s\n' "$out" | grep '^\[FAIL\]' | sed 's/^/    /'; exit 1; }
exit 0
