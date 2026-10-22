#!/usr/bin/env bash
# Hook: Stop  (dev layer)
#
# At session end, stage changes, generate a Conventional Commits message with
# `claude -p`, commit, and append one line to an existing CHANGELOG. If
# `claude -p` fails, use a generic convention-compliant message.
#
# ===========================================================================
# This hook is opt-in and a **no-op by default**. This repository has not enabled it.
# ===========================================================================
#
# Enable when either condition below is present. Without either, do nothing.
#
#   Configuration file: touch <repo>/.claude/session-autocommit
#   Environment variable: JSTACK_SESSION_AUTOCOMMIT=1
#
# Disable with the environment-variable kill switch, which overrides the file.
#
#   JSTACK_SESSION_AUTOCOMMIT=0
#
# **This repository does not create the configuration file.** With several
# worktrees active, add+commit on every Stop races with edits and rebases in
# other trees, while `git add -A` indiscriminately includes untracked files.
# Off-by-default behavior is required and locked by
# `tests/test_hooks.py::TestTheStopHookIsOffByDefault`.
#
# Reasons for remaining off by default, inherited from v0.3.0:
#   (1) `git add -A` commits new untracked files indiscriminately, potentially
#       exposing unintended files in a later push.
#   (2) During concurrent agent/worktree work, add+commit on every Stop races
#       with active edits and rebases.
#   (3) Atomic commits are impossible because every change is bundled into one WIP.
#
# --- What `--no-verify` bypasses (ledger :453) -----------------------------
#
# The `git commit -F - --no-verify` below **bypasses this plugin's emoji and ruff
# hooks** through two real paths.
#
#   (1) `--no-verify` disables git's own hooks such as `.git/hooks/pre-commit`,
#       including ruff or gitleaks when repositories install them there.
#   (2) More significantly, this commit **does not pass through the Bash tool**.
#       The Stop hook calls `git commit` directly, so the PreToolUse chain
#       (`block_emoji.py`, `ruff_check_before_commit.py`, `validate_pr_label.py`)
#       never sees it. Removing `--no-verify` does not close this second path.
#
# Result: when enabled, **content that should have been blocked can enter a
# commit**. This is one reason the hook defaults off; enabling it accepts this bypass.

set -euo pipefail

# Resolve the git repo root (worktree-safe).
# Under `set -u`, a missing `$CLAUDE_PROJECT_DIR` would kill the hook here.
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || REPO_ROOT="${CLAUDE_PROJECT_DIR:-}"
[ -n "$REPO_ROOT" ] || exit 0
cd "$REPO_ROOT" || exit 0

# --- Opt-in guard: no-op by default ---------------------------------------
# The environment variable overrides the file; 0 disables it even when the file exists.
AUTOCOMMIT="${JSTACK_SESSION_AUTOCOMMIT:-}"
case "$AUTOCOMMIT" in
  0|false|off|no) exit 0 ;;
  1|true|on|yes) ;;
  *) [ -f "$REPO_ROOT/.claude/session-autocommit" ] || exit 0 ;;
esac

# Avoid concurrent git-operation races by skipping when another process holds the index.
GIT_DIR=$(git rev-parse --git-dir 2>/dev/null) || exit 0
[ -f "$GIT_DIR/index.lock" ] && exit 0

# Stage all changes
git add -A 2>/dev/null || true

# Exit if nothing to commit
if git diff-index --quiet HEAD 2>/dev/null; then
  exit 0
fi

# Extract diff for commit message generation (truncated to 2000 lines)
DIFF=$(git diff --cached 2>/dev/null | head -2000)

# Generate commit message via Claude headless mode
COMMIT_MSG=""
if command -v claude &>/dev/null; then
  _claude_out=$(echo "$DIFF" | claude -p \
    "You are a commit message generator for an AUTOMATIC session snapshot in a repository that uses Conventional Commits with English descriptions. You are given ONLY a git diff — there is no human-provided intent, so you cannot know WHY the change was made.
Rules:
- First line: '<type>(<scope>): <English description>'. type is inferred from the diff and MUST be one of: feat, fix, refactor, test, docs, chore, style, remove, perf. scope = main changed area or plugin name (optional).
- Type inference from the diff: new capability/file = feat; bug fix = fix; restructure without behavior change = refactor; only *.md/docs = docs; deps/version/config/build = chore; tests = test; deletions = remove; formatting only = style.
- Description: English, MAX 50 chars, imperative mood, NO trailing period.
- Describe ONLY what the diff literally shows. Do NOT invent motivation, impact, rationale, or ticket numbers — you have no evidence. OMIT the WHY paragraph rather than fabricate it.
- If several unrelated areas changed, use 'chore: update multiple areas' and list them in the body.
- Optional body: a blank line then up to 4 English bullets naming concrete changes (what/how), wrapped at 72 chars.
- NEVER include 'Generated with Claude Code' or 'Co-Authored-By: Claude'. Never reproduce secrets, tokens, or keys.
- Output ONLY the commit message, nothing else." 2>/dev/null) && COMMIT_MSG="$_claude_out" || true
fi

# Fallback if claude -p failed or returned empty (still convention-compliant)
if [ -z "$COMMIT_MSG" ]; then
  FILE_COUNT=$(git diff --cached --name-only | wc -l | tr -d ' ')
  COMMIT_MSG="chore: snapshot ${FILE_COUNT} files automatically"
fi

# Append a neutral provenance trailer (Conventional-Commits footer) so
# auto-snapshots stay identifiable/squashable across concurrent agents,
# without violating the commit convention or the banned Claude phrases.
COMMIT_MSG="${COMMIT_MSG}

Auto-Session-Commit: true"

# Commit using -F - to safely handle special characters
echo "$COMMIT_MSG" | git commit -F - --no-verify 2>/dev/null || true

# Update CHANGELOG if it exists
CHANGELOG="$REPO_ROOT/docs/CHANGELOG.md"
if [ -f "$CHANGELOG" ]; then
  TIMESTAMP=$(date '+%Y-%m-%d %H:%M')
  FIRST_LINE=$(echo "$COMMIT_MSG" | head -1)

  if grep -q '## \[Unreleased\]' "$CHANGELOG"; then
    sed -i '' "/## \[Unreleased\]/a\\
- $TIMESTAMP: $FIRST_LINE" "$CHANGELOG" 2>/dev/null || \
    sed -i "/## \[Unreleased\]/a\\- $TIMESTAMP: $FIRST_LINE" "$CHANGELOG" 2>/dev/null || true
  fi

  git add "$CHANGELOG" 2>/dev/null || true
  if ! git diff-index --quiet HEAD 2>/dev/null; then
    git commit -m "docs: auto-update changelog" --no-verify 2>/dev/null || true
  fi
fi
