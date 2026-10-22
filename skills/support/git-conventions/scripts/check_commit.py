#!/usr/bin/env python3
"""Git convention checker for branch names and commit-message format.

## What is and is not measured

| Decision | Basis | Evaluator |
|---|---|---|
| Type, format, length, banned phrases | Convention | **Machine** |
| Whether the body actually explains why and how | Reading comprehension | **Human** |

The second judgment is not simulated.

Usage:
    check_commit.py --message "feat: add something"
    check_commit.py --staged          # prepared commit-message file
    check_commit.py --branch          # current branch name
    check_commit.py --branch-name feat/foo
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

TYPES = ("feat", "fix", "refactor", "test", "docs", "chore",
         "style", "remove", "perf")
BRANCH_TYPES = ("feat", "fix", "refactor", "docs", "test", "chore")

SUBJECT_MAX = 50
BODY_WRAP = 72

BANNED = ("Generated with Claude Code", "Generated with [Claude Code]",
          "Co-Authored-By: Claude", "Claude-Session:")
# Git trailer keys are case-insensitive and GitHub honors `Co-authored-by`, so
# matching ignores case and tolerates any whitespace around the colon or words. A
# phrase counts only when it starts a line, after indentation or an emoji (the
# default footer is `<robot emoji> Generated with [Claude Code](...)`), so a
# message that quotes it mid-line passes.
LINE_START = "(?:^|\\n)[ \\t\\ufe0f\\u200d\\u2600-\\u27bf\\u2b00-\\u2bff\\U0001f300-\\U0001faff]*"
# A `Co-Authored-By` trailer names an AI when its address is at anthropic.com, or
# when its name is `Claude` alone or `Claude` followed only by model words and
# version numbers. `Claude Monet`, `Claude Shannon` and `Claudette` are people and
# pass. Explicit lookaheads and [0-9] rather than `\b` and `\d` keep this identical
# to the TypeScript checker.
AI_NAME = (r"Claude(?:[ \t]+(?:Code|Opus|Sonnet|Haiku|Fable|Instant|[0-9]+(?:\.[0-9]+)*))*"
           r"(?=[ \t]*(?:<|\r?\n|\r?$))")
AI_ADDRESS = r"[^\n]*?<[^<>\n]*@anthropic\.com>"
AI_CO_AUTHOR = r"Co-Authored-By[ \t]*:[ \t]*(?:" + AI_NAME + "|" + AI_ADDRESS + ")"


def _phrase_source(phrase):
    body = r"[ \t]*:[ \t]*".join(
        r"[ \t]+".join(re.escape(word) for word in part.split()) for part in phrase.split(":"))
    return body + ("(?![A-Za-z0-9_])" if re.search(r"\w$", phrase) else "")


PATTERNS = tuple(
    re.compile(LINE_START + (AI_CO_AUTHOR if phrase.startswith("Co-Authored-By")
                             else _phrase_source(phrase)), re.I)
    for phrase in BANNED
)


def banned_phrases(text):
    return [phrase for phrase, pattern in zip(BANNED, PATTERNS) if pattern.search(text)]


HEAD = re.compile(r"^(?P<type>[a-z]+)(?:\((?P<scope>[^)]+)\))?: (?P<subject>.+)$")
BRANCH = re.compile(r"^(?P<type>[a-z]+)/(?P<name>[a-z0-9][a-z0-9-]*(?:/[a-z0-9-]+)*)$")


def check_message(msg: str) -> list[str]:
    out: list[str] = []
    lines = msg.rstrip().splitlines()
    if not lines or not lines[0].strip():
        return ["subject is empty"]

    head = lines[0]
    m = HEAD.match(head)
    if not m:
        out.append(f"subject does not match `<type>(<scope>): <subject>` — {head[:60]!r}")
    else:
        t = m.group("type")
        if t not in TYPES:
            out.append(f"type `{t}` is outside the convention (allowed: {', '.join(TYPES)})")
        subj = m.group("subject")
        if len(head) > SUBJECT_MAX:
            out.append(f"subject is {len(head)} characters; maximum {SUBJECT_MAX} characters")
        if subj.endswith("."):
            out.append("subject ends with a period")

    # A body must be separated from the subject by a blank line
    if len(lines) > 1 and lines[1].strip():
        out.append("no blank line separates the subject and body")

    for i, line in enumerate(lines[2:], start=3):
        # Do not wrap code blocks, URLs, or tables
        if len(line) > BODY_WRAP and not line.lstrip().startswith(("```", "|", "http")) \
                and "http" not in line:
            out.append(f"line {i} is {len(line)} characters; wrap body text at {BODY_WRAP}")
            break

    for b in banned_phrases(msg):
        out.append(f"banned phrase: {b!r}")
    return out


def check_branch(name: str) -> list[str]:
    out: list[str] = []
    m = BRANCH.match(name)
    if not m:
        out.append(f"branch does not match `<type>/<kebab-case>` — {name!r}")
        if "_" in name:
            out.append("  use hyphens instead of underscores")
        if re.search(r"[A-Z]", name):
            out.append("  do not use uppercase letters")
        return out
    t = m.group("type")
    if t not in BRANCH_TYPES:
        # Call out a username used as a prefix
        out.append(f"branch type `{t}` is outside the convention "
                   f"(allowed: {', '.join(BRANCH_TYPES)})")
        if "-" in t:
            out.append("  do not put a username in the branch name")
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--message")
    g.add_argument("--staged", action="store_true",
                   help="read .git/COMMIT_EDITMSG")
    g.add_argument("--branch", action="store_true", help="check the current branch name")
    g.add_argument("--branch-name")
    a = ap.parse_args(argv)

    if a.message is not None:
        problems, what = check_message(a.message), "commit message"
    elif a.staged:
        p = Path(".git/COMMIT_EDITMSG")
        if not p.exists():
            print("[blocked] .git/COMMIT_EDITMSG does not exist; no commit is being prepared",
                  file=sys.stderr)
            return 2
        body = "\n".join(l for l in p.read_text(encoding="utf-8").splitlines()
                         if not l.startswith("#"))
        problems, what = check_message(body), "commit message"
    elif a.branch:
        r = subprocess.run(["git", "branch", "--show-current"],
                           capture_output=True, text=True)
        if r.returncode != 0:
            print("[blocked] not a Git repository", file=sys.stderr)
            return 2
        name = r.stdout.strip()
        if not name:
            print("[blocked] no branch (detached HEAD)", file=sys.stderr)
            return 2
        problems, what = check_branch(name), f"branch {name}"
    else:
        problems, what = check_branch(a.branch_name), f"branch {a.branch_name}"

    if problems:
        print(f"[convention violation] {what}")
        for p in problems:
            print(f"  {p}")
        return 1
    print(f"[pass] {what}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
