#!/usr/bin/env bash
# Deliverable validation — **choose the checker based on the file type.**
#
# Do not ask which skill created it; the verdict is whether the file meets its
# contract. If a checker is unavailable, skip only that file and report rc=2;
# do not abort checks for other files.
set -u
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
PY="${PYTHON:-python3}"

REQ=""
FILES=()
while [ $# -gt 0 ]; do
    case "$1" in
        --req) REQ="${2:-}"; shift 2 ;;
        -h|--help) printf '%s\n' "usage: validate.sh [--req <requirements.txt>] <file>..."; exit 0 ;;
        *) FILES+=("$1"); shift ;;
    esac
done

if [ "${#FILES[@]}" -eq 0 ]; then
    printf '%s\n' "[STOP] no files were provided for validation" >&2
    printf '%s\n' "  usage: validate.sh [--req <requirements.txt>] <file>..." >&2
    exit 2
fi

fail=0
skipped=0

run() {   # run <label> <command...>
    local label="$1"; shift
    local out rc
    out="$("$@" 2>&1)"; rc=$?
    if [ "$rc" -eq 0 ]; then
        printf '  [PASS] %s\n' "$label"
    else
        printf '  [FAIL] %s\n' "$label"
        printf '%s\n' "$out" | sed -n '1,12p' | sed 's/^/         /'
        fail=1
    fi
}

for f in "${FILES[@]}"; do
    if [ ! -f "$f" ]; then
        printf '%s\n' "[STOP] file is missing: $f" >&2
        exit 2
    fi
    printf '%s\n' "== $f"

    case "$f" in
      *.hwpx)
        V="$ROOT/skills/hwpx/scripts/validate_hwpx.py"
        if "$PY" -c 'import lxml' >/dev/null 2>&1; then
        run "hwpx structural and semantic validation" "$PY" "$V" "$f" --semantic
        else
            printf '  [SKIP] lxml is missing — check with /doctor\n'; skipped=1
        fi ;;
      *.svg|*.html)
        run "diagram geometry validation" "$PY" "$ROOT/skills/diagram/scripts/verify-geometry.py" "$f" ;;
      *.docx|*.pptx|*.xlsx)
        run "East Asian font contract" "$PY" "$ROOT/skills/office/scripts/check_cjk_font.py" "$f" ;;
      *.md)
        run "citation integrity (all pairs)" "$PY" "$ROOT/skills/research/scripts/cite_check.py" "$f"
        if [ -n "$REQ" ]; then
            run "requirements mapping" "$PY" \
                "$ROOT/skills/research/scripts/coverage_matrix.py" \
                --req "$REQ" --report "$f"
        fi ;;
      *.txt)
        run "character and byte measurement" "$PY" \
            "$ROOT/skills/proof/scripts/korean_character_count.py" --file "$f" --format text ;;
      *)
        printf '  [SKIP] no checker exists for this format\n' ;;
    esac
    printf '%s\n' ""
done

[ "$fail" -eq 1 ] && exit 1
[ "$skipped" -eq 1 ] && exit 2
exit 0
