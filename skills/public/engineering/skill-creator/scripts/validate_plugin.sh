#!/usr/bin/env bash
# Validate one plugin against the actual host schema.
#
#   validate_plugin.sh [--marketplace <marketplace.json>] <plugin-directory>
#
# Exit codes
#   0  passed, with a measured check count
#   1  failed, with failure and check counts
#   2  unexecutable due to usage, python3, or PyYAML
#   3  not a plugin because `.claude-plugin/plugin.json` is missing
#
# Keep 3 distinct from success. A multi-directory CI caller may treat it as an
# excluded directory, while a targeted caller must learn that nothing was measured.
#
# Every verdict passes through pass() or fail(), and only those functions
# increment CHECKS. The summary always includes the measured count, preventing
# a zero-measurement run from looking like a clean run.
#
# Do not use set -e: count and report a failed check instead of hiding later checks.
set -uo pipefail

MARKETPLACE_JSON=""
PLUGIN_DIR=""
while [ $# -gt 0 ]; do
  case "$1" in
    --marketplace)
      [ $# -ge 2 ] || { echo "--marketplace requires a value" >&2; exit 2; }
      MARKETPLACE_JSON="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,10p' "$0"; exit 0 ;;
    -*)
      echo "unknown flag: $1" >&2; exit 2 ;;
    *)
      [ -z "$PLUGIN_DIR" ] || { echo "more than one plugin directory argument: $PLUGIN_DIR, $1" >&2; exit 2; }
      PLUGIN_DIR="$1"; shift ;;
  esac
done
[ -n "$PLUGIN_DIR" ] || { echo "usage: validate_plugin.sh [--marketplace <file>] <plugin-dir>" >&2; exit 2; }
[ -d "$PLUGIN_DIR" ] || { echo "not a directory: $PLUGIN_DIR" >&2; exit 2; }

command -v python3 >/dev/null 2>&1 || { echo "python3 is missing; cannot validate frontmatter" >&2; exit 2; }
python3 -c 'import yaml' 2>/dev/null || {
  # A missing dependency is unexecutable, not a pass.
  echo "PyYAML is missing; cannot parse frontmatter with the host-compatible parser" >&2
  echo "  Install: python3 -m pip install pyyaml" >&2
  exit 2
}

PLUGIN_ABS="$(cd "$PLUGIN_DIR" && pwd)"
PLUGIN_DIR_NAME="$(basename "$PLUGIN_ABS")"
[ -n "$MARKETPLACE_JSON" ] && MARKETPLACE_JSON="$(cd "$(dirname "$MARKETPLACE_JSON")" && pwd)/$(basename "$MARKETPLACE_JSON")"

# BSD mktemp requires X at the end; a suffix creates a literal reusable path.
HELPER="$(mktemp -t validate_plugin_helper.XXXXXX)"
trap 'rm -f "$HELPER"' EXIT
cat > "$HELPER" <<'PYHELPER'
"""Parse for validate_plugin.sh and report reasons without deciding totals.

Exit 0 means clean, 1 means violation, and 2 means unexecutable.
"""
import json
import os
import re
import sys

try:
    import yaml
except ImportError:                                  # Defensive check even though the caller checks first
    print("PyYAML missing"); sys.exit(2)

SEMVER_CHARS = set("0123456789.")


def read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def frontmatter(text):
    """Return `(fields, error)` using the host-compatible YAML parser."""
    if not text.startswith("---\n"):
        return None, "frontmatter is missing; the first line must be `---`"
    rest = text[4:]
    end = rest.find("\n---")
    if end < 0:
        return None, "frontmatter is not closed"
    try:
        fields = yaml.safe_load(rest[:end])
    except yaml.YAMLError as err:
        first = str(err).splitlines()[0]
        return None, f"frontmatter is not valid YAML: {first}"
    if fields is None:
        return None, "frontmatter is empty"
    if not isinstance(fields, dict):
        return None, "frontmatter is not a mapping"
    return fields, None


def need_text(fields, key):
    value = fields.get(key)
    if value is None:
        return f"{key} is missing"
    if not isinstance(value, str):
        return f"{key} is not a string ({type(value).__name__})"
    if not value.strip():
        return f"{key} is empty"
    return None


def bad(reason):
    print(reason)
    sys.exit(1)


def do_manifest(path, dirname):
    try:
        raw = read(path)
    except OSError as err:
        bad(f"cannot read: {err}")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as err:
        bad(f"not valid JSON: {err.msg} (line {err.lineno} col {err.colno})")
    if not isinstance(data, dict):
        bad("top level is not an object")
    for key in ("name", "description", "version"):
        why = need_text(data, key)
        if why:
            bad(why)
    name = data["name"]
    if not name[0].islower() or not all(c.islower() or c.isdigit() or c == "-" for c in name):
        bad(f"name is not kebab-case: {name!r}")
    if name != dirname:
        bad(f"name({name!r}) differs from directory name ({dirname!r})")
    version = data["version"]
    core = version.split("-", 1)[0]
    if not core or set(core) - SEMVER_CHARS or len(core.split(".")) != 3:
        bad(f"version is not x.y.z: {version!r}")
    sys.exit(0)


def do_skill(path, expected):
    try:
        fields, why = frontmatter(read(path))
    except OSError as err:
        bad(f"cannot read: {err}")
    if why:
        bad(why)
    problem = need_text(fields, "name")
    if problem:
        bad(problem)
    if fields["name"] != expected:
        bad(f"name({fields['name']!r}) differs from directory name ({expected!r})")
    problem = need_text(fields, "description")
    if problem:
        bad(problem)
    sys.exit(0)


def distance(a, b):
    row = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        nxt = [i]
        for j, cb in enumerate(b, 1):
            nxt.append(min(row[j] + 1, nxt[j - 1] + 1, row[j - 1] + (ca != cb)))
        row = nxt
    return row[-1]


def do_command(path):
    """A command without a description key passes and prints `undescribed`.

    It costs nothing in the model-facing listing and the `/` menu shows its first
    body line. An empty file, a misplaced fence, or a present but empty value fails.
    Keys near `description` are printed as `typo <key>` so the caller can warn.
    """
    try:
        text = read(path)
    except OSError as err:
        bad(f"cannot read: {err}")
    if re.fullmatch(r"[ \t\r\n]*", text):
        bad("command file is empty")
    if not text.startswith("---\n"):
        first = next(line for line in text.split("\n") if not re.fullmatch(r"[ \t\r\n]*", line))
        if re.fullmatch(r"[ \t]*---[ \t]*", first):
            bad("frontmatter fence is malformed; the first line must be exactly `---`")
        print("undescribed")
        sys.exit(0)
    fields, why = frontmatter(text)
    if why:
        bad(why)
    present = "description" in fields
    if present:
        problem = "description is empty" if fields["description"] is None else need_text(fields, "description")
        if problem:
            bad(problem)
    for key in fields:
        if str(key) != "description" and distance(str(key), "description") <= 2:
            print(f"typo {key}")
    if not present:
        print("undescribed")
    sys.exit(0)


def do_agent(path, expected):
    try:
        fields, why = frontmatter(read(path))
    except OSError as err:
        bad(f"cannot read: {err}")
    if why:
        bad(why)
    problem = need_text(fields, "name")
    if problem:
        bad(problem)
    if fields["name"] != expected:
        bad(f"name({fields['name']!r}) differs from filename ({expected!r})")
    problem = need_text(fields, "description")
    if problem:
        bad(problem)
    sys.exit(0)


def do_hooks_shape(path):
    try:
        data = json.loads(read(path))
    except OSError as err:
        bad(f"cannot read: {err}")
    except json.JSONDecodeError as err:
        bad(f"not valid JSON: {err.msg} (line {err.lineno} col {err.colno})")
    if not isinstance(data, dict) or not isinstance(data.get("hooks"), dict):
        bad("top level has no `hooks` object")
    if not data["hooks"]:
        bad("`hooks` is empty; it matches no event")
    for event, entries in data["hooks"].items():
        if not isinstance(entries, list) or not entries:
            bad(f"{event} is not a nonempty array")
        for entry in entries:
            if not isinstance(entry, dict) or not isinstance(entry.get("hooks"), list):
                bad(f"{event} entry has no `hooks` array")
            for hook in entry["hooks"]:
                if not isinstance(hook, dict):
                    bad(f"{event} hook is not an object")
                if hook.get("type") != "command":
                    bad(f"{event} hook has no type=\"command\"")
                if not str(hook.get("command") or "").strip():
                    bad(f"{event} hook has no command")
    sys.exit(0)


def do_hook_scripts(path):
    """Print plugin-relative hook script paths, one per line.

    Select the token immediately after the plugin root rather than the final token,
    because a hook command may include arguments after its script path.
    """
    data = json.loads(read(path))
    out = []

    def walk(node):
        if isinstance(node, dict):
            command = node.get("command")
            if isinstance(command, str):
                for marker in ("${CLAUDE_PLUGIN_ROOT}/", "$CLAUDE_PLUGIN_ROOT/"):
                    if marker in command:
                        tail = command.split(marker, 1)[1]
                        out.append(tail.split()[0].strip("\"'"))
                        break
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    walk(data)
    for rel in out:
        print(rel)
    sys.exit(0)


def do_marketplace(path, name):
    try:
        data = json.loads(read(path))
    except OSError as err:
        bad(f"cannot read: {err}")
    except json.JSONDecodeError as err:
        bad(f"not valid JSON: {err.msg}")
    entries = data.get("plugins")
    if not isinstance(entries, list):
        bad("marketplace.json has no plugins array")
    for entry in entries:
        if isinstance(entry, dict) and entry.get("name") == name:
            sys.exit(0)
    bad(f"marketplace.json does not list {name!r}")


MODES = {
    "manifest": lambda a: do_manifest(a[0], a[1]),
    "skill": lambda a: do_skill(a[0], a[1]),
    "command": lambda a: do_command(a[0]),
    "agent": lambda a: do_agent(a[0], a[1]),
    "hooks-shape": lambda a: do_hooks_shape(a[0]),
    "hook-scripts": lambda a: do_hook_scripts(a[0]),
    "marketplace": lambda a: do_marketplace(a[0], a[1]),
}

if len(sys.argv) < 2 or sys.argv[1] not in MODES:
    print(f"unknown mode: {sys.argv[1:2]}"); sys.exit(2)
MODES[sys.argv[1]](sys.argv[2:])
PYHELPER

cd "$PLUGIN_ABS" || exit 2

CHECKS=0
FAILURES=0
N_SKILLS=0
N_COMMANDS=0
N_AGENTS=0
N_HOOKS=0

pass() { CHECKS=$((CHECKS + 1)); echo "[PASS] $1"; }
fail() { CHECKS=$((CHECKS + 1)); FAILURES=$((FAILURES + 1)); echo "[FAIL] $1"; }

# Read the helper exit code. Code 2 is unexecutable, so stop without counting it.
NOTES=""
verdict() {   # $1=label; remaining arguments belong to the helper
  local label="$1"; shift
  local out rc
  NOTES=""
  out="$(python3 "$HELPER" "$@" 2>&1)"; rc=$?
  case $rc in
    0) pass "$label"; NOTES="$out" ;;
    1) fail "$label — $out" ;;
    *) echo "[STOP] Unexecutable: $label — $out" >&2; exit 2 ;;
  esac
}

check_manifest() {
  verdict "plugin.json schema" manifest ".claude-plugin/plugin.json" "$PLUGIN_DIR_NAME"
}

# A skill lives at skills/<name>/SKILL.md and its frontmatter name matches the directory.
check_skills() {
  [ -d skills ] || { echo "[INFO] no skills/ directory"; return 0; }
  local dir name
  for dir in skills/*/; do
    [ -d "$dir" ] || continue
    name="$(basename "$dir")"
    case "$name" in .*|_*) continue ;; esac
    N_SKILLS=$((N_SKILLS + 1))
    if [ ! -f "${dir}SKILL.md" ]; then
      fail "skills/${name}: SKILL.md is missing"
      continue
    fi
    verdict "skills/${name}: SKILL.md frontmatter" skill "${dir}SKILL.md" "$name"
  done
  # A present skills directory with zero skills fails.
  if [ "$N_SKILLS" -eq 0 ]; then
    fail "skills/ exists but contains no skills"
  fi
}

check_commands() {
  [ -d commands ] || { echo "[INFO] no commands/ directory"; return 0; }
  local file name note undescribed=""
  for file in commands/*.md; do
    [ -f "$file" ] || continue
    name="$(basename "$file")"
    N_COMMANDS=$((N_COMMANDS + 1))
    verdict "commands/${name}: frontmatter" command "$file"
    # Notes are printed only by a passing helper run, one per line.
    while IFS= read -r note; do
      case "$note" in
        undescribed) undescribed="${undescribed:+${undescribed}, }commands/${name}" ;;
        "typo "*) echo "[WARN] commands/${name} — frontmatter key '${note#typo }' is within edit distance 2 of 'description'" ;;
      esac
    done <<< "$NOTES"
  done
  if [ "$N_COMMANDS" -eq 0 ]; then
    fail "commands/ exists but contains no commands"
  fi
  if [ -n "$undescribed" ]; then
    echo "[INFO] commands without a description are not listed to the model, and the / menu shows their first body line: ${undescribed}"
  fi
}

# Agents are agents/*.md; validate the real files rather than a nonexistent registry.
check_agents() {
  [ -d agents ] || { echo "[INFO] no agents/ directory"; return 0; }
  local file stem
  for file in agents/*.md; do
    [ -f "$file" ] || continue
    stem="$(basename "$file" .md)"
    N_AGENTS=$((N_AGENTS + 1))
    verdict "agents/${stem}: frontmatter" agent "$file" "$stem"
  done
  if [ "$N_AGENTS" -eq 0 ]; then
    fail "agents/ exists but contains no agents"
  fi
}

# The actual hook manifest is hooks/hooks.json.
check_hooks() {
  [ -d hooks ] || { echo "[INFO] no hooks/ directory"; return 0; }
  if [ ! -f hooks/hooks.json ]; then
    fail "hooks/ exists but hooks/hooks.json is missing; no hook can fire"
    return 1
  fi
  verdict "hooks/hooks.json structure" hooks-shape hooks/hooks.json

  local scripts rc missing=0 rel
  scripts="$(python3 "$HELPER" hook-scripts hooks/hooks.json 2>&1)"; rc=$?
  if [ $rc -ne 0 ]; then
    echo "[STOP] Unexecutable: hook command parsing — $scripts" >&2
    exit 2
  fi
  # Avoid a pipeline subshell that would discard counter increments.
  while IFS= read -r rel; do
    [ -n "$rel" ] || continue
    N_HOOKS=$((N_HOOKS + 1))
    if [ -f "$rel" ]; then
      pass "hook script exists: $rel"
    else
      fail "hook script is missing: $rel ; this hook cannot fire"
      missing=$((missing + 1))
    fi
  done <<< "$scripts"
  if [ "$N_HOOKS" -eq 0 ]; then
    fail "hooks.json points to no plugin-relative script"
  fi
  [ "$missing" -eq 0 ]
}

check_marketplace() {
  [ -n "$MARKETPLACE_JSON" ] || return 0
  if [ ! -f "$MARKETPLACE_JSON" ]; then
    # An explicitly requested marketplace must exist.
    fail "marketplace.json is missing: $MARKETPLACE_JSON"
    return 1
  fi
  verdict "marketplace.json registration" marketplace "$MARKETPLACE_JSON" "$PLUGIN_DIR_NAME"
}

main() {
  echo "================================"
  echo "Plugin format validation: $PLUGIN_DIR"
  echo "================================"

  if [ ! -f .claude-plugin/plugin.json ]; then
    echo "[SKIP] Not a plugin: .claude-plugin/plugin.json is missing; measured zero checks"
    exit 3
  fi

  check_manifest
  check_skills
  check_commands
  check_agents
  check_hooks
  check_marketplace

  local census="skills ${N_SKILLS}, commands ${N_COMMANDS}, agents ${N_AGENTS}, hook scripts ${N_HOOKS}"
  echo "================================"
  if [ "$FAILURES" -gt 0 ]; then
    echo "[FAIL] ${CHECKS} checks, ${FAILURES} failed (${census})"
    exit 1
  fi
  # Include the measured census so zero findings cannot hide zero measurements.
  echo "[OK] Passed: ${CHECKS} checks (${census})"
  exit 0
}

# MUTATION_POINT -- run_fixtures.py replaces this line with a disabled check.
# If fixtures still pass, the suite reports that the check has no discriminatory power.
main
