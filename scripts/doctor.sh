#!/usr/bin/env bash
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ $# -gt 1 ]; then
  echo "usage: doctor.sh [skill]" >&2
  exit 2
fi
rc=0
if [ $# -eq 0 ]; then
  echo "== jstack shared development environment diagnosis =="
  bash "$ROOT/scripts/doctor-dev.sh"; dev_rc=$?
  [ "$dev_rc" -gt "$rc" ] && rc="$dev_rc"
  echo
fi
bash "$ROOT/scripts/doctor-work.sh" "$@"; work_rc=$?
[ "$work_rc" -gt "$rc" ] && rc="$work_rc"
exit "$rc"
