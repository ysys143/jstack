#!/usr/bin/env bash
# Reference implementation of the three-state contract: 0=ready, 1=partial, 2=blocked.
#
#   probe.sh <binary> [--floor X.Y.Z] [--auth "<cmd>"] [--install "<cmd>"]
#
# Never install; print the installation command only in a blocked state.
set -u

BIN=""; FLOOR=""; AUTH=""; INSTALL=""
# Reject missing values and unknown flags; otherwise shift can loop forever and a
# typo can silently remove the version floor.
need_value() {   # $1=flag name; $2=remaining argument count
  [ "$2" -ge 2 ] || { echo "probe.sh: $1 requires a value" >&2; exit 2; }
}
while [ $# -gt 0 ]; do
  case "$1" in
    --floor)   need_value "$1" $#; FLOOR="$2"; shift 2 ;;
    --auth)    need_value "$1" $#; AUTH="$2"; shift 2 ;;
    --install) need_value "$1" $#; INSTALL="$2"; shift 2 ;;
    -*)        echo "probe.sh: unknown flag $1" >&2; exit 2 ;;
    *)         if [ -z "$BIN" ]; then BIN="$1"; else
                 echo "probe.sh: multiple executable arguments ($BIN, $1)" >&2; exit 2
               fi
               shift ;;
  esac
done
[ -n "$BIN" ] || { echo "probe.sh: target executable is missing" >&2; exit 2; }

blocked() {
  echo "[2] $1"
  # Guidance must include the full command.
  [ -n "$INSTALL" ] && echo "    Install: $INSTALL"
  exit 2
}

command -v "$BIN" >/dev/null 2>&1 || blocked "$BIN is missing"

# Determine availability from exit status and extract version numbers from text.
# Accept either --version or -version returning zero, including tools that print
# versions to stderr. A tool that prints a version but exits nonzero remains blocked.
_ctxver() {
  # Version contexts include `version`, executable name, line start, or `<name> <version>`.
  # Preserve a trailing newline so BSD sed cannot concatenate multiple matches.
  printf '%s\n' "$1" | sed -n \
    -e "s/.*[Vv]ersion[^0-9]\{0,4\}\([0-9][0-9.]*\).*/\1/p" \
    -e "s/.*$BIN[^0-9]\{0,4\}\([0-9][0-9.]*\).*/\1/p" \
    -e "s/^[vV]\{0,1\}\([0-9][0-9.]*\).*/\1/p" \
    -e "s/^[A-Za-z][A-Za-z0-9_.-]* [vV]\{0,1\}\([0-9][0-9]*\.[0-9][0-9.]*\).*/\1/p" \
    | head -1
}

RAW=""; OK=1
for _flag in --version -version; do          # JDK 8 accepts only -version
  OUT="$("$BIN" "$_flag" 2>&1)"
  if [ $? -eq 0 ]; then RAW="$OUT"; OK=0; break; fi
done
[ $OK -eq 0 ] || blocked "$BIN cannot run; a runtime dependency may be missing"

# Read the first context-valid version line; an earlier warning may contain unrelated numbers.
VER=""; NUM=""
while IFS= read -r _line; do
  _n="$(_ctxver "$_line")"
  if [ -n "$_n" ]; then VER="$_line"; NUM="${_n%.}"; break; fi
done <<EOF
$RAW
EOF

# Compare numeric fields so version 10 sorts after version 9.
if [ -n "$FLOOR" ]; then
  # Prefer the first dotted token over an unrelated earlier number.
  [ -n "$NUM" ] || blocked "cannot read $BIN version: $VER"
  low="$(printf '%s\n%s\n' "$NUM" "$FLOOR" | awk -F. '
    {for(i=1;i<=4;i++) v[NR,i]=($i==""?0:$i+0)}
    END{for(i=1;i<=4;i++){if(v[1,i]<v[2,i]){print "1";exit}
                          if(v[1,i]>v[2,i]){print "0";exit}} print "0"}')"
  [ "$low" = "1" ] && blocked "$BIN $NUM is below required version $FLOOR"
fi

# Authentication and installation are separate states.
if [ -n "$AUTH" ]; then
  if ! eval "$AUTH" >/dev/null 2>&1; then
    echo "[1] $BIN is installed but unauthenticated; authenticated features are unavailable"
    exit 1
  fi
fi

# Ready state is silent so partial-state output remains visible.
exit 0
