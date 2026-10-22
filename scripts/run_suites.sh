#!/usr/bin/env bash
# Run every contract suite for this plugin.
#   validate.sh [skill-name ...]   — omit names to run all suites
# Exit codes: 0 = all passed / 1 = at least one failed / 2 = nothing to run
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 2

# Contributor sources keep host components under hosts/. Test the generated
# runtime layout so both installed hosts use exactly the same contract inputs.
if [ -d "$ROOT/hosts/claude" ] && [ -f "$ROOT/packaging/product.json" ] && [ ! -f "$ROOT/.claude-plugin/plugin.json" ]; then
  exec python3 "$ROOT/packaging/run_contracts.py" "$@"
fi

targets=()
if [ $# -gt 0 ]; then
  for n in "$@"; do
    case "$n" in
      tests/test_*.py)
        [ "$n" = "tests/$(basename "$n")" ] && [ -f "$n" ] || {
          echo "[2] root suite is missing: $n"; exit 2;
        }
        targets+=("$n")
        continue
        ;;
    esac
    _found=""
    for _s in "skills/$n"/tests/*.py; do
      case "$(basename "$_s")" in _*) continue ;; esac
      [ -f "$_s" ] && _found="$_s"
    done
    [ -n "$_found" ] || { echo "[2] $n: suite is missing"; exit 2; }
    targets+=("$n")
  done
else
  # **Do not hard-code suite filenames.** A previous version found only
  # `run_tests.py`, leaving deck's `test_marp_contract.py` **outside the gate**.
  # The runner stayed green even when that skill's evaluation answer key was
  # emptied (review 9 reproduction). Review 6 had already fixed this assumption
  # in `check_floor_parity.suites()`, but the runner did not share it. The
  # asymmetry was severe: the parity checker counted deck's 71-test floor in
  # `EXPECTED`, while the gate missed its failures. Match the parity rule: every
  # non-underscore `.py` file directly under `tests/`.
  for d in skills/*/; do
    n="$(basename "$d")"
    # **Register each skill once.** Registering a two-suite skill such as
    # humanize once per file makes the execution branch run all suites twice,
    # producing four runs and double-counting the suite total.
    _has=""
    for s in "$d"tests/*.py; do
      case "$(basename "$s")" in _*) continue ;; esac
      [ -f "$s" ] && _has=1
    done
    [ -n "$_has" ] && targets+=("$n")
  done
  # **Run plugin-root suites too.** A previous version traversed only `skills/*/`,
  # so `tests/test_commands.py` and `tests/test_agents.py` were **never invoked**.
  # The entire axis added after review 3 was missing from its only entry point;
  # deleting those suites and replacing agent bodies with filler still produced
  # 18/0 green (review 6 reproduction), despite documentation claiming all ran.
  for f in tests/test_*.py; do
    [ -f "$f" ] && targets+=("$f")
  done
fi
# **Nothing to run is not green.** Treating zero passing checks as success makes
# validation pass even when the entire tree disappears.
[ ${#targets[@]} -gt 0 ] || { echo "[2] no suites to run"; exit 2; }

fail=0; total=0; leak=0
# **Measure duration.** Every other axis measured correctness while none measured
# cost, so a run grew to five hours unnoticed until 8,961 temporary directories
# filled the disk. Measurement is the first step; a ceiling comes next.
_t0=$(date +%s)
# **Capture suite output so floor parity need not rerun it.** A previous version
# ran 25+16 suites here and immediately ran them all again in `check_floor_parity`,
# consuming more than half of a measured 2,503-second cycle. The floor evidence
# already exists in stdout; read the current run's artifact under the same
# convention as the reachability dump.
if [ -n "${JSTACK_SUITE_EVIDENCE_DIR:-}" ]; then
  _sout="$JSTACK_SUITE_EVIDENCE_DIR"
  mkdir -p "$_sout" || exit 2
  [ -z "$(ls -A "$_sout" 2>/dev/null)" ] || {
    echo "[2] evidence directory is not empty: $_sout"
    exit 2
  }
else
  _sout="$(mktemp -d)"
  trap 'rm -rf "$_sout"' EXIT
fi
for n in "${targets[@]}"; do
  # **Run each suite with an empty isolated temporary directory** so leftovers
  # can be counted. On 2026-09-03, suites left 8,961 directories in the system
  # temp area, filling the disk to 100% with 143 MiB free. `mkdtemp` then failed,
  # and **`check_floor_parity` measured only 129 of 155 floor cases while reporting
  # zero mismatches**. The instrument did not crash; it silently measured less.
  # Without a total marker that result looked green. Deletion regression reruns
  # suites once per reference file, multiplying one leak dozens of times in a
  # floor run. This is therefore a **measurement-accuracy issue**, not merely a
  # disk issue. Counting the shared system temp directory would mix in other
  # processes; isolation is the foundation of this measurement.
  _box="$(mktemp -d)"
  # **Collect reachability at no extra execution cost.** Suites already empty
  # each reference, script, and frozen file through `check_body_deletion`. Record
  # the checks that turn red there to find checks untouched by any mutation with
  # **zero additional executions**.
  #
  # Measuring separately was expensive: rerunning 30 skills externally took more
  # than four hours and defeated the reason for moving instrumentation into the
  # suites. This path writes only one additional file.
  _reach="${JSTACK_REACH_DIR:+$JSTACK_REACH_DIR/$(printf '%s' "$n" | tr '/' '_').json}"
  case "$n" in
    tests/*) out="$(TMPDIR="$_box" JSTACK_REACH_OUT="$_reach" python3 "$n" 2>&1)"; rc=$? ;;
    # **Accumulate failures across multiple suites.** A `for` loop's `$?` retains
    # only the final command, so a later pass can hide an earlier failure. This
    # masking appeared when the runner glob expanded. Return the code accumulated
    # by the subshell.
    *)       out="$(cd "skills/$n" && _acc=0
                    if [ "$n" = dashboard ] && [ -n "${JSTACK_DASHBOARD_DEPENDENCIES:-}" ]; then
                      if [ -e node_modules ] || [ -L node_modules ]; then
                        echo '[2] dashboard dependency path is occupied; preserving it'
                        exit 2
                      fi
                      ln -s "$JSTACK_DASHBOARD_DEPENDENCIES" node_modules || exit 2
                      trap 'if [ -L node_modules ] && [ "$(readlink node_modules)" = "$JSTACK_DASHBOARD_DEPENDENCIES" ]; then rm node_modules; fi' EXIT
                    fi
                    for _f in tests/*.py; do
                      case "$(basename "$_f")" in _*) continue ;; esac
                      [ -f "$_f" ] || continue
                      TMPDIR="$_box" JSTACK_REACH_OUT="$_reach" python3 "$_f" 2>&1 || _acc=1
                    done
                    exit $_acc)"; rc=$? ;;
  esac
  # **Show the failing suite's line in a failure row.** A previous version kept
  # only the last line. For a two-suite skill whose first suite failed and second
  # passed, it printed a failure row with a passing count, such as
  # `[FAIL] humanize  1/1 통과` (review 12), which visually communicated the
  # opposite result.
  if [ $rc -ne 0 ]; then
    line="$(printf '%s\n' "$out" | grep -E '^[0-9]+/[0-9]+ 통과' \
            | awk -F/ '$1 != substr($2,1,index($2," ")-1)' | tail -1)"
    [ -n "$line" ] || line="$(printf '%s' "$out" | tail -1)"
  else
    line="$(printf '%s' "$out" | tail -1)"
  fi
  # **Count before deleting.** Names are shown because a count alone cannot locate
  # the fix.
  # **One fixed-name cache is exempt, with a documented reason.**
  # `node-compile-cache` is a **fixed-name** directory created by Node through
  # `module.enableCompileCache()` rather than by this repository (which contains
  # no `NODE_COMPILE_CACHE` setting). Its fixed name does not grow per run; this
  # axis detects **unbounded growth**, not cache existence. The 8,961 directories
  # came from `mkdtemp`, which used a new name on every run. This is the only
  # exemption; adding another requires equivalent justification. Move caches
  # owned by this project instead of exempting them, as with the author fixture cache.
  printf '%s\n' "$out" > "$_sout/$(printf '%s' "$n" | tr '/' '_').out"
  _left="$(ls -A "$_box" 2>/dev/null | grep -v '^node-compile-cache$' | head -4 | tr '\n' ' ')"
  _nleft="$(ls -A "$_box" 2>/dev/null | grep -vc '^node-compile-cache$' || true)"
  _nleft="$(printf '%s' "$_nleft" | tr -d ' ')"
  rm -rf "$_box"
  if [ "$_nleft" -ne 0 ]; then
    leak=$((leak + 1))
    printf '[누수] %-10s 임시 항목 %s건 남김 (%s)\n' "$n" "$_nleft" "$_left"
  fi
  total=$((total + 1))
  if [ $rc -ne 0 ]; then
    fail=$((fail + 1))
    printf '[FAIL] %-10s %s\n' "$n" "$line"
    printf '%s\n' "$out" | grep '^\[FAIL\]' | sed 's/^/         /'
  else
    printf '[ok]   %-10s %s\n' "$n" "$line"
  fi
done
_el=$(( $(date +%s) - _t0 ))
echo "스위트 $total 개 / 실패 $fail 개 / 누수 $leak 개 / 스위트 시간 ${_el}초"
# **Apply a duration ceiling.** Measurement without a limit only claims to
# observe cost; that was exactly the class O state in which a run reached five
# hours unnoticed.
#
# **This ceiling intentionally has headroom.** Unlike content floors, which must
# track measured values to expose dead contracts, time varies with machine load.
# Pinning it to one measurement creates class H false positives until users
# disable the check. Measure whether the suite became **several times slower**,
# rather than a regression of a few seconds.
#
# Measurement basis: dev layer 799s (previously 1,557s); work layer 476s and 505s.
# If the ceiling is exceeded, document **why it became slower** before changing it.
#
# A plugin without a declared budget is not green. For a new tree, the default
# is "record a measured value here," not "unlimited."
case "$(basename "$ROOT")" in
  jstack)      _budget=2700 ;; # Preserve the prior two trees' 1600+1100 fluctuation ceilings.
  *)        _budget=-1 ;;
esac
if [ $# -eq 0 ]; then
  if [ "$_budget" -lt 0 ]; then
    echo "[FAIL] plugin has no declared time budget: $(basename "$ROOT")"
    fail=$((fail + 1))
  elif [ "$_el" -gt "$_budget" ]; then
    echo "[FAIL] suite time ${_el}s > budget ${_budget}s — document the slowdown first"
    fail=$((fail + 1))
  fi
fi
# **Run meta-checks even when suites are red.** A previous version exited here,
# making floor parity structurally impossible on machines missing one dependency
# (hwpx's lxml). No one then saw the work-layer floor loosen by 15 cases (review 12
# reproduction). Meta-checks are independent oracles unrelated to suite pass
# status; an oracle hidden by a suite failure is not independent.

# **Verify that floors equal measured values.** Without invoking this here,
# "keep floors measured" remains a convention. A script people must remember to
# run is a renamed convention, not a contract (review 6). Run only during a full
# execution because selected runs measure subsets and would misfire the total marker.
# **Missing contract-enforcement scripts are not green.** A previous fail-open
# `[ -f ... ]` let the entire tree pass after deleting both checkers (review 7),
# despite stating above that nothing to run is not green.
CHECKOUT="$ROOT"
PARITY="$CHECKOUT/scripts/check_floor_parity.py"
BEHAV="$CHECKOUT/scripts/check_suite_lib_behaviour.py"
# Monitor files that must have one canonical copy (`_suite_lib.py` and this
# script itself). If no entry point invokes this check, it creates the same blind spot.
LIBPAR="$CHECKOUT/scripts/check_suite_lib_parity.py"

if [ $# -eq 0 ]; then
  # **Check existence only inside a full run.** Placing it outside also triggers
  # during selected runs, which intentionally skip meta-checks, creating a false
  # failure. That failure was visible: the selected `test_commands.py` check
  # `validate returns 0 on pass` ran in deletion-regression copies without
  # `refactor/`, adding one unrelated failure to all 11 floors (review 8
  # reproduction: one failure even in an unmodified copy).
  for _f in "$PARITY" "$BEHAV" "$LIBPAR"; do
    [ -f "$_f" ] || { echo "[2] contract checker is missing: $_f"; exit 2; }
  done
  echo
  # Pass the tree path so total markers are computed against that tree.
  _tree="."
  python3 "$PARITY" "$_tree" --from-dir "$_sout" || fail=$((fail + 1))
  echo
  # **After a pipe, `$?` belongs to tail.** Capture output first, then truncate it.
  _out="$(python3 "$BEHAV")" || { printf '%s\n' "$_out" | tail -20
                                  fail=$((fail + 1)); }
  printf '%s\n' "$_out" | tail -1
  echo
  python3 "$LIBPAR" || fail=$((fail + 1))
else
  echo
  echo "(지정 실행 — 하한 대조·하네스 거동 검사는 건너뛴다. 전체 실행에서 돈다)"
fi
# **Leaks are failures too.** Reporting without including them in the exit code
# lets the next person overlook the line, repeating the repository's documented
# pattern of declarations without enforcement.
[ $fail -eq 0 ] || exit 1
[ $leak -eq 0 ] || exit 1
exit 0
