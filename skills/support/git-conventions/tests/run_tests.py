#!/usr/bin/env python3
"""Regression suite for the gitrules skill.

Run: python3 tests/run_tests.py   (from skills/gitrules)

## What this locks

1. **The checker makes real decisions.** Saying that a document catches a defect
   does not prove that the checker catches it. These tests execute the checker
   instead of grepping its source, so reversing a constant or turning `--staged`
   into an unchecked pass still fails even when the same words remain in the code.
2. **The written contract matches measured behavior.** The upstream convention
   and this repository's actual history diverged. The measurement is authoritative,
   and the documentation must state that fact.
3. **Banned phrases remain banned.** Removing `Co-Authored-By` after it enters a
   commit is costly, so the prohibition is a tested contract.
4. **Rule direction cannot be reversed.** An earlier adversarial mutation kept all
   35 checks green because the contract tested only whether words existed, not what
   they meant. Sentence-level literals, reversed negative needles, and exact table
   row-to-verdict mappings now lock the direction of each rule.
5. **Tables must still parse as tables.** Deleting every blank line once attached a
   table to the preceding paragraph. Its words, byte volume, and line-survival
   remained unchanged, so none of those axes caught the structural break.
"""

import os
import re
import shutil
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
# E402: This import must follow the sys.path manipulation above — the suite library
# It's outside the skill tree, so you won't be able to find it unless you establish a path first.
from _suite_lib import (  # noqa: E402
    check_no_constant_assertions,
    check_total,
    check_skill_body,
    check_ref_contracts,
    split_frontmatter,
    check_script_contracts,
    check_body_deletion,
    check_contract_coverage,
)  # noqa: E402

ROOT = os.path.dirname(HERE)
CHECK = os.path.join(ROOT, "scripts", "check_commit.py")

results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))


def read(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


def write(p, text):
    with open(p, "w", encoding="utf-8") as f:
        f.write(text)


def run(*args):
    r = subprocess.run([sys.executable, CHECK, *args], capture_output=True, text=True)
    return r.returncode, r.stdout + r.stderr


def run_at(cwd, *args):
    """Run the checker from another working directory.

    Both --staged and --branch depend on cwd, unlike --message. This probes those
    paths independently so replacing either with an unchecked pass is detected.
    """
    r = subprocess.run(
        [sys.executable, CHECK, *args], capture_output=True, text=True, cwd=cwd
    )
    return r.returncode, r.stdout + r.stderr


GIT_QUIET = ("-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null")


def git(cwd, *args):
    return subprocess.run(
        ["git", *GIT_QUIET, *args], capture_output=True, text=True, cwd=cwd
    )


# ---------------------------------------------------------------------------
# Markdown structure — is the table parsed as a table?
#
# The adversary erased all blank lines and added 9 tables to the previous paragraph, but there were no detections. word
# As it is, the needle passes through, the volume does not count the empty string in the first place, and the string survival rate is
# Blank lines are omitted during the normalization step. **You have to parse it yourself to see it.**
# ---------------------------------------------------------------------------
SEP = re.compile(r"^\s*\|(?:\s*:?-{2,}:?\s*\|)+\s*$")
BLOCK_START = re.compile(r"^\s*(?:#{1,6}\s|```)")


def _cells(line):
    return tuple(c.strip() for c in line.strip().strip("|").split("|"))


def md_tables(text):
    """Return only blocks that parse as GFM tables.

    Require a pipe-led header, equal separator/header column counts, and a blank
    line or block boundary before the header. The final condition detects deletion
    of the blank line that separates a table from preceding prose.
    """
    lines = text.splitlines()
    out = []
    for i, ln in enumerate(lines):
        if i == 0 or not SEP.match(ln):
            continue
        head = lines[i - 1]
        if not head.lstrip().startswith("|"):
            continue
        prev = lines[i - 2] if i >= 2 else ""
        if i >= 2 and prev.strip() and not BLOCK_START.match(prev):
            continue
        cols = _cells(head)
        if len(_cells(ln)) != len(cols):
            continue
        rows = []
        for j in range(i + 1, len(lines)):
            if not lines[j].lstrip().startswith("|"):
                break
            rows.append(_cells(lines[j]))
        out.append((cols, tuple(rows)))
    return tuple(out)


def section(text, header):
    """Return one level-two section body for scoped direction checks."""
    m = re.search(
        r"(?m)^" + re.escape(header) + r"\s*$\n(.*?)(?=^## |\Z)", text, re.S
    )
    return m.group(1) if m else ""


# ---------------------------------------------------------------------------
# **Row-Evaluation Correspondence** in the table. If you just count the number of lines, you won't be able to catch the modulation that swaps two lines —
# The entire header, row content, and row order are written as literals.
# ---------------------------------------------------------------------------
TABLES = {
    "SKILL.md": (
        (
            ("Type", "When"),
            (
                ("`feat`", "New feature"),
                ("`fix`", "Bug fix"),
                ("`refactor`", "Structure changes with no behaviour change"),
                ("`docs`", "Documentation"),
                ("`test`", "Tests"),
                ("`chore`", "Build, config, dependencies"),
            ),
        ),
        (
            ("The file says", "Then"),
            (
                ("Required label groups", "Missing one blocks the PR"),
                ("`rules: []`", "Nothing is enforced; this repository does not label"),
                (
                    "`enforced: false`",
                    "The evidence was weak — it warns and lets the PR through",
                ),
            ),
        ),
        (
            ("Task", "Owner"),
            (
                ("Session wrap-up, retrospective, next steps", "`/wrap` command"),
                ("Running the commit itself", "`/commit` command"),
                ("Opening the PR", "`/pr` command"),
                (
                    "A credential that is already in the repository",
                    "`secrets` skill",
                ),
                (
                    "Registering the PR policy in a new repository",
                    "`setup` skill",
                ),
                ("`gh` missing or signed out", "`bridge` skill"),
            ),
        ),
    ),
    "references/branch.md": (
        (
            ("Folder", "Description"),
            (
                ("infra", "Infrastructure work"),
                ("server", "Backend work"),
                ("web", "Frontend work"),
            ),
        ),
        (
            ("Category", "Description"),
            (
                ("feature", "Add new feature"),
                ("refactor", "Modify existing code"),
                ("bug", "Fix bugs"),
                ("test", "Add or modify tests"),
                ("docs", "Documentation work"),
                ("chore", "Non-code changes (build, config, etc.)"),
                ("hotfix", "Urgent fixes (direct to master)"),
            ),
        ),
    ),
    "references/commit.md": (
        (
            ("Type", "Description"),
            (
                ("feat", "Add new feature"),
                ("fix", "Fix a bug"),
                (
                    "refactor",
                    "Improve code structure without changing functionality",
                ),
                ("test", "Add or update tests"),
                ("docs", "Update documentation"),
                (
                    "chore",
                    "Non-code changes (build, package management, etc.)",
                ),
                ("style", "Code formatting, style changes"),
                ("remove", "Remove unused code or files"),
                ("perf", "Performance improvements"),
            ),
        ),
    ),
    "references/pr.md": (
        (
            ("Label", "Description"),
            (
                ("@web", "Web/Frontend related work"),
                ("@server", "Backend feature addition or modification"),
                ("@infra", "Infrastructure related work"),
                ("@database", "Database related work"),
                ("@agent", "AI Agent related work"),
                ("@docs", "Documentation related work"),
            ),
        ),
        (
            ("Label", "Description"),
            (
                ("feature", "Add new feature"),
                ("bug", "Fix functional errors"),
                ("remove", "Remove unnecessary code or files"),
                ("performance", "Performance improvement"),
                ("refactoring", "Code refactoring"),
                ("ci/cd", "CI/CD related work"),
                ("testing", "Add or modify test code"),
                ("dependencies", "Dependency management"),
                ("security", "Security fixes"),
                ("development", "Development environment setup"),
                ("documentation", "Add or modify documentation"),
                ("ignore-for-release", "Exclude from release changelog"),
            ),
        ),
    ),
    "references/secrets.md": (
        (
            ("", "`.gitignore`", "`.git/info/exclude`"),
            (
                ("Scope", "**Whole repository** — committed", "**Local only** — not committed"),
                (
                    "Use for",
                    "Build artifacts, dependencies, shared secret paths",
                    "Personal editor settings, local scratch files",
                ),
            ),
        ),
        (
            ("What Git can do", "What Git cannot do"),
            (
                (
                    "Remove a blob from history (`git filter-repo`, BFG)",
                    "Remove it from existing clones",
                ),
                ("Rewrite local refs", "Rewrite refs in forks, PRs, or mirrors"),
                (
                    "Move remote refs with a force push",
                    "Immediately expire commits cached by the forge",
                ),
            ),
        ),
        (
            ("Tool", "Purpose", "When"),
            (
                ("**gitleaks**", "**Detect** secrets before commit and in CI", "Start here in most cases"),
                (
                    "**SOPS**",
                    "**Encrypt and commit** files",
                    "When configuration must contain secrets (k8s, Terraform)",
                ),
                (
                    "**git-secret**",
                    "Encrypt files with GPG",
                    "Older than SOPS and requires GPG key management",
                ),
            ),
        ),
    ),
}

# Number of empty lines and number of code fences. Ground truth fixation (margin 0) — If you delete a blank line, it gets hit here first.
LAYOUT = {
    "SKILL.md": (36, 8),
    "references/branch.md": (6, 0),
    "references/commit.md": (20, 10),
    "references/pr.md": (18, 6),
    "references/secrets.md": (15, 0),
}

# Separate the byte length of the clause with an equal sign.
#
# The lower volume limit only sees deletion. Modification by inserting “except for …” **increases** the volume.
# Any lower bound is passed, and statement literals survive (Adversarial RC-1: `Personal
# experiment branches may keep the author name.` One line insertion was undetected).
# A word blacklist (HEDGE) cannot block every formulation: formulations are
# unbounded, and byte length does not identify them. When one section changes,
# only that section's expected size changes, so maintenance remains local.
SECTIONS = {
    "SKILL.md": (
        ("Why these four together", 286),
        ("Branches — `<type>/<kebab-case>`", 1630),
        ("Commits — Conventional Commits", 1185),
        ("PRs — the repository owns the label rule", 1914),
        ("Secrets — stop them before the commit", 332),
        ("Checking", 428),
        ("Boundaries", 376),
        ("Limits (stated)", 764),
    ),
    "references/branch.md": (
        ("Format", 132),
        ("Folder (Work Area)", 155),
        ("Category", 309),
        ("Examples", 247),
    ),
    "references/commit.md": (
        ("Constraints (CRITICAL)", 132),
        ("Format", 130),
        ("Types", 419),
        ("Title Rules", 125),
        ("Body Rules", 204),
        ("Examples", 216),
        ("Full Example with Body", 375),
    ),
    "references/pr.md": (
        ("Constraints (CRITICAL)", 231),
        ("Format", 346),
        ("Labels — current repository values (example, not authoritative)", 961),
        ("Command Usage", 245),
    ),
    "references/secrets.md": (
        ("`.gitignore` vs `.git/info/exclude`", 437),
        ("Secrets already committed", 802),
        ("Toolset — what to choose", 537),
        ("This repository's rules", 364),
    ),
}

# **Contract** of checker constants. Compare the script source by execution rather than grep.
COMMIT_TYPES = ("feat", "fix", "refactor", "test", "docs", "chore",
                "style", "remove", "perf")
BRANCH_TYPES = ("feat", "fix", "refactor", "docs", "test", "chore")
COMMIT_ONLY = tuple(t for t in COMMIT_TYPES if t not in BRANCH_TYPES)
BANNED = ("Generated with Claude Code", "Co-Authored-By: Claude",
          "Co-authored-by: Claude")

# L0 — The only layer that is always read. Even if the routing was reversed, the main contract was all abstract.
L0_SENTENCES = (
    "git conventions in one place — branch names, commit messages, PRs, and "
    "secret handling.",
    "A checker verifies the format before you commit and says what is wrong "
    "and why.",
    "Session wrap-up and retrospective belong to the wrap command.",
)
L0_TRIGGERS = (
    "커밋", "커밋 메시지", "브랜치 만들어", "브랜치명", "PR 올려", "풀리퀘",
    "PR 설명", "gitignore", "비밀키 커밋", "시크릿 관리",
    "commit", "branch", "pull request",
)

# Direction — (name, sentence that must be alive, inverted form that must not appear)
#
# The sentence is taken as a whole **including line breaks**. The word needle is “except…”
# Even if you add it after, it passes as is, but the inversion is caught here because the sentence needs to be corrected.
SKILL_DIRECTION = (
    (
        "branch names omit usernames",
        "**No usernames** (`jaesol-shin/...` is out). Type and name are separated by a\n"
        "**slash** (not `feature-new-plugin`).",
        (r"(?i)usernames are (?:allowed|fine|ok)", r"(?i)\*\*Usernames\*\*"),
    ),
    # D-4 Correction — An earlier version asserted that “there is not a single three-column form in this history.”
    # **That's wrong** (7 real out of 79 remote). This is a rule based on incorrect measurements.
    # The basis has been re-established. The rules remain the same and the original has been changed to CLAUDE.md.
    (
        "records that the three-part form exists here",
        "**That form does exist here — 7\n"
        "of 79 remote branches carry it**, the newest "
        "`infra/feature/code-convention-hook`\n(2026-03-15).",
        (r"(?i)contains no such branch", r"(?i)no such branch exists here"),
    ),
    (
        "discloses the earlier measurement error",
        "An earlier version of this paragraph said there were none; that was\n"
        "a wrong measurement, and the rule cannot stand on it.",
        (r"(?i)the earlier measurement was right",),
    ),
    (
        "identifies CLAUDE.md as canon and measurement as corroboration",
        "**CLAUDE.md is the canon here; the measurement\nagrees with it.**",
        (r"(?i)the measurement is\s*\n?the convention",
         r"(?i)the upstream is the canon"),
    ),
    (
        "exempts the default branch from type prefixes",
        "**The default branch is exempt.** `master` carries no type prefix because "
        "the\nrule is about *work* branches — there is nothing to name it after.",
        (r"(?i)`master` must carry a type prefix", r"(?i)no branch is exempt"),
    ),
    (
        "subject is at most 50 characters with no trailing period",
        "**Subject** — 50 characters or fewer, no trailing period, ends with an action\n"
        "verb (add, modify, change, or remove).",
        (r"(?i)50 characters or more", r"(?i)at least 50 characters",
         r"(?i)ends with a trailing period", r"(?i)a trailing period is fine"),
    ),
    (
        "body gives why, then how, wrapped at 72",
        "**Body** — separated from the subject by a blank line; the first paragraph is\n"
        "**why** (problem, motivation), the second is **how** (approach). Wrap at 72.",
        (r"\*\*how\*\* \(approach\), the second is \*\*why\*\*",
         r"(?i)wrap at 50", r"(?i)wrap at 80"),
    ),
    # D-4 Correction — The old phrase was wider than the target. This environment's harness belongs to
    # They **requested** a trailer, but the skill **forbid**d it, so neither of them could comply.
    # The targets (tool advertisements and false co-authors) were narrowed down and exceptions were specified.
    (
        "forbids tool advertising and false co-authorship",
        "**Never advertise the tool, and never claim a co-author who did not write "
        "it.**\n`Generated with Claude Code` is out; so is a bare "
        "`Co-Authored-By: Claude`\npasted onto work no Claude session produced.",
        (r"(?i)\*\*Always include\*\*",
         r"(?i)always include `Generated with Claude Code`",
         r"(?i)advertise the tool freely"),
    ),
    (
        "exempts a harness-required attribution trailer",
        "**The attribution trailer this\nharness requires is exempt** — "
        "`Co-Authored-By: Claude <model>\n<noreply@anthropic.com>` together with "
        "`Claude-Session:` records *who ran the\nsession*, which is true",
        (r"(?i)no trailer is exempt",
         r"(?i)the attribution trailer[\s\S]{0,40}is banned"),
    ),
    (
        "discloses rules broader than checker behavior",
        "- Two rules above are stated wider than the checker implements. "
        "`scripts/check_commit.py` still bans the harness attribution trailer, and "
        "`--branch` still calls the default branch malformed. Both gaps are in the "
        "checker; the rule is what this document says",
        (r"(?i)the checker implements every rule",),
    ),
    (
        "does not claim authority over label rules",
        "**The rule is not written here.**",
        (r"\*\*The rule is written here",),
    ),
    (
        "distinguishes an absent policy file from an empty one",
        "**The file must exist before a PR can be opened**, even empty. Empty means\n"
        "someone decided this repository has no label policy; absent means nobody has\n"
        "looked.",
        (r"(?i)the file may be absent", r"(?i)absent means someone decided",
         r"(?i)the two are the same"),
    ),
    (
        "gitignore is repository-wide and info/exclude is local",
        "`.gitignore` is a **repository-wide** rule; `.git/info/exclude` is **local "
        "only**.",
        (r"`\.gitignore` is a? ?\*\*local",
         r"`\.git/info/exclude` is a? ?\*\*repository-wide"),
    ),
    (
        "history rewriting does not repair a committed secret",
        "**A secret already committed is not fixed by rewriting history** — revoke and\n"
        "reissue it immediately.",
        (r"is fixed by rewriting history", r"(?i)rewriting history is enough"),
    ),
    (
        "checker evaluates format only",
        "**The checker sees format** — type, length, banned phrases, branch shape.\n"
        "Whether the body actually explains *why* is read by a person.",
        (r"(?i)the checker (?:also )?(?:sees|measures|judges) whether the body",),
    ),
)

REF_DIRECTION = (
    (
        "branch.md",
        "records the corrected count of three-part branches",
        "**7 of this repository's 79 remote branches actually use it** (the newest is\n"
        "from 2026-03-15). An earlier version incorrectly said there were none.",
        (r"(?i)none of this repository's branches use it",),
    ),
    (
        "commit.md",
        "preserves upstream text while identifying the narrower authority",
        "**The forbidden-phrase rule under `## Constraints` remains verbatim upstream\n"
        "text.** This repository's authoritative rule is narrower because attribution\n"
        "trailers required by a harness are exempt. The decision and rationale are in\n"
        '"Commits" in `SKILL.md`.',
        (r"(?i)authoritative rule is broader", r"(?i)upstream text was changed"),
    ),
    # RC-7' — This is the place where it was demonstrated that hostility can be reversed with a **backbite**. The volume is
    # Even if the margin is 0, substitution of the same length is not visible. Lock all three terms as literals.
    (
        "secrets.md",
        "preserves the repository's three credential rules",
        "- **Do not put credentials** (`client_secret.json`, tokens) in the repository.\n"
        "  Store them under `~/.config/<tool>-<account>/`.\n"
        "- Put API keys in `~/.claude/.env.*` or shell environment variables. `.env`\n"
        "  files are covered by `.gitignore`.\n"
        "- If a key was committed, follow the `secrets` skill; do not duplicate that\n"
        "  procedure here.",
        (r"(?im)^- Put credentials.*in the repository", r"(?i)\.env.*not.*gitignore"),
    ),
    (
        "branch.md",
        "identifies SKILL.md as authoritative",
        "**`SKILL.md` is authoritative.**",
        (r"(?i)this reference is authoritative",),
    ),
    (
        "branch.md",
        "preserves upstream three-part format and kebab-case",
        "- All branch names must be in English\n- Use kebab-case for description",
        (r"(?i)must (?:not|never) be in English", r"(?i)Use snake_case for description"),
    ),
    (
        "commit.md",
        "preserves the banned-phrase clause",
        "- NEVER include phrases like `Generated with Claude Code` or "
        "`Co-Authored-By: Claude` in commit messages",
        (r"(?i)- ALWAYS include phrases like",),
    ),
    (
        "commit.md",
        "preserves the direction of all three title rules",
        "- Maximum 50 characters\n- End with an action verb (add, modify, change, remove, etc.)\n"
        "- No period at the end",
        (r"(?i)- Maximum 72 characters", r"(?i)- Minimum 50 characters",
         r"(?i)- Period at the end", r"(?i)- End with a period"),
    ),
    (
        "commit.md",
        "preserves all four body rules in order",
        "- Separate from title with a blank line\n"
        "- First paragraph: WHY (explain the problem or motivation)\n"
        "- Second paragraph: HOW (describe the solution approach)\n"
        "- Wrap at 72 characters per line",
        (r"(?i)- First paragraph: HOW", r"(?i)- Second paragraph: WHY",
         r"(?i)- Wrap at 50 characters", r"(?i)- Wrap at 100 characters"),
    ),
    (
        "pr.md",
        "requires both label categories",
        "- MUST include at least one position label AND one category label via "
        "`--label` flag when creating PRs",
        (r"(?i)MUST NOT include at least one", r"(?i)at most one position label",
         r"(?i)one position label OR one category label"),
    ),
    (
        "pr.md",
        "states that this document is not authoritative for labels",
        "**This document is not authoritative for label rules.**",
        (r"(?i)this document is authoritative for label rules",),
    ),
    (
        "pr.md",
        "records why @package was removed",
        "**`@package` was removed.**",
        (r"(?i)`@package` was retained", r"(?i)`@package` was restored"),
    ),
    (
        "secrets.md",
        "does not duplicate the response procedure",
        "**The response procedure is not duplicated here.**",
        (r"(?i)the response procedure is authoritative here",),
    ),
    (
        "secrets.md",
        "requires revocation before history rewriting",
        "Because the right column is not empty, **credential revocation comes first**.",
        (r"(?i)history rewriting comes first",),
    ),
    (
        "secrets.md",
        "distinguishes detection from encryption",
        "**Detection and encryption solve different problems.**",
        (r"(?i)detection and encryption solve the same problem",),
    ),
    (
        "secrets.md",
        "keeps personal settings out of gitignore",
        "**Do not put personal settings that others do not need in `.gitignore`.**",
        (r"(?im)^\*\*Put personal settings.*in `\.gitignore`",),
    ),
)

# Exception injection trace. It's a list of words, so it's not a proof — the cheapest version of "except for..."
# The purpose is to prevent falsification on a clause-by-clause basis, and it is meaningful only when used **together** with a sentence literal.
#
# **`is optional` has been removed.** "`(scope)` is optional" in the Commits clause is legitimate.
# There was a false positive because it was a sentence. Exception signs are limited to connections that break the rule.
HEDGE = re.compile(r"however|unless|except when|does not apply|no longer required")


def check_checker_execution():
    """Execute the checker and measure verdict direction.

    Source-string checks cannot detect a reversed comparison, swapped constants,
    one removed banned-phrase row, an unchecked `--staged` or `--branch` path, or
    removal of the required space after a colon. Paired valid/invalid cases and
    boundary values exercise every one of those failures.
    """
    # -- The fact that the two lists of types are different is itself a contract --------------------
    refused = [t for t in COMMIT_TYPES if run("--message", f"{t}: 무엇을 추가")[0] != 0]
    check(f"Checker: accepts all {len(COMMIT_TYPES)} commit types",
          not refused, f"rejected {refused}")
    refused_br = [t for t in BRANCH_TYPES if run("--branch-name", f"{t}/x")[0] != 0]
    check(f"Checker: accepts all {len(BRANCH_TYPES)} branch types",
          not refused_br, f"rejected {refused_br}")
    # This breaks if you swap the two constants — if the lists are equal, this test doesn't work.
    leaked = [t for t in COMMIT_ONLY if run("--branch-name", f"{t}/x")[0] != 1]
    check(f"Checker: rejects commit-only types {COMMIT_ONLY} as branches",
          not leaked, f"accepted {leaked}")

    # -- Title Length Boundary (50/51) -----------------------------------------------------------
    for pad, want in ((44, 0), (45, 1)):
        rc, out = run("--message", "feat: " + "a" * pad)
        check(f"Checker: subject-length boundary at {pad + 6}", rc == want,
              f"rc={rc} (expected {want})")
    rc, out = run("--message", "feat: " + "a" * 45)
    check('checker: reveals upper limit 50 when title exceeds',
          rc == 1 and "subject is 51 characters; maximum 50 characters" in out, out.strip()[:70])

    # -- Body fold border (71/72/73). If the comparison sign is reversed, 71·72 turns red --
    for width, want in ((71, 0), (72, 0), (73, 1)):
        rc, out = run("--message", "feat: 제목\n\n" + "a" * width)
        check(f"Checker: body-line boundary at {width}", rc == want,
              f"rc={rc} (expected {want})")
    rc, out = run("--message", "feat: 제목\n\n" + "a" * 73)
    check('Inspector: Reveals fold width 72 when text exceeds',
          rc == 1 and "wrap body text at 72" in out, out.strip()[:70])
    # Do not fold code blocks, tables, or URLs — if this exception disappears, document commits are blocked.
    for lead, why in (("```", "code block"), ("|", "table"), ("http://a.example/", "URL")):
        rc, out = run("--message", "feat: 제목\n\n" + lead + "a" * 90)
        check(f"Checker: excludes {why} lines from wrapping", rc == 0, f"rc={rc}")

    # -- Require space after colon --------------------------------------------------
    rc, out = run("--message", "feat:공백이 없다")
    check('Checker: Catches missing spaces after colons',
          rc == 1 and "subject does not match" in out, f"rc={rc}")
    rc, out = run("--message", "feat(plugins): 무엇을 추가")
    check('Inspector: Passes normal titles with scope', rc == 0, f"rc={rc}")

    # -- Three types of prohibited phrases. Even if you delete just one lowercase line, it gets stuck here ----------
    for phrase in BANNED:
        rc, out = run("--message", f"feat: 추가\n\n본문\n\n{phrase}")
        check(f"Checker: rejects banned phrase {phrase!r}",
              rc == 1 and "banned phrase" in out, f"rc={rc}")

    # -- `--staged` is not a stage that passes without inspection -------------------------------
    st = tempfile.mkdtemp()
    try:
        rc, out = run_at(st, "--staged")
        check('Inspector: --staged breaks COMMIT_EDITMSG absence (rc=2)',
              rc == 2 and "no commit is being prepared" in out, f"rc={rc}")
        os.makedirs(os.path.join(st, ".git"), exist_ok=True)
        msg = os.path.join(st, ".git", "COMMIT_EDITMSG")
        write(msg, "feat: 무엇을 추가\n# 이 줄은 주석이다\n")
        rc, out = run_at(st, "--staged")
        check('checker: --staged passes correct messages',
              rc == 0 and "[pass]" in out, f"rc={rc}")
        write(msg, "Feat: 대문자 타입\n")
        rc, out = run_at(st, "--staged")
        check('Checker: --staged catches format violations',
              rc == 1 and "[convention violation]" in out, f"rc={rc}")
        write(msg, "feat: 추가\n\n본문\n\nCo-authored-by: Claude\n")
        rc, out = run_at(st, "--staged")
        check('Inspector: --staged catches prohibited phrases',
              rc == 1 and "banned phrase" in out, f"rc={rc}")
        write(msg, "feat: 무엇을 추가\n\n본문\n# " + "가" * 90 + "\n")
        rc, out = run_at(st, "--staged")
        check('Inspector: --staged excludes `#` comment lines from inspection',
              rc == 0, f"rc={rc}")
    finally:
        shutil.rmtree(st, ignore_errors=True)

    # -- `--branch` is not a test-free passer -------------------------------
    br = tempfile.mkdtemp()
    try:
        rc, out = run_at(br, "--branch")
        check('Checker: --branch breaks outside the repository with a break (rc=2)',
              rc == 2 and "not a Git repository" in out, f"rc={rc}")
        git(br, "init", "-q", ".")
        git(br, "checkout", "-q", "-b", "feat/ok")
        rc, out = run_at(br, "--branch")
        check('checker: --branch passes the current branch that conforms to the convention',
              rc == 0 and "feat/ok" in out, f"rc={rc}")
        git(br, "checkout", "-q", "-b", "Bad_Branch")
        rc, out = run_at(br, "--branch")
        check('Checker: --branch catches current branch violations',
              rc == 1 and "use hyphens instead of underscores" in out and "do not use uppercase letters" in out,
              f"rc={rc}")
        git(br, "-c", "user.email=t@example.com", "-c", "user.name=t",
            "commit", "-q", "--allow-empty", "-m", "chore: 빈 커밋")
        git(br, "checkout", "-q", "--detach", "HEAD")
        rc, out = run_at(br, "--branch")
        check('checker: --branch breaks detached HEAD into a break (rc=2)',
              rc == 2 and "detached HEAD" in out, f"rc={rc}")
    finally:
        shutil.rmtree(br, ignore_errors=True)

    # -- If you don't choose a branch at all, it stops ---------------------------------------
    rc, out = run()
    check('Checker: If you do not select a branch, it stops with a usage error (rc=2)',
          rc == 2 and "--branch-name" in out, f"rc={rc}")


def doc_sections(text):
    """Return level-two sections as ordered (heading, byte count) pairs."""
    text = text.replace("${JSTACK_PLUGIN_ROOT}", "${CLAUDE_PLUGIN_ROOT}")
    heads = [(m.group(1).strip(), m.start())
             for m in re.finditer(r"(?m)^## (.+?)\s*$", text)]
    out = []
    for i, (h, start) in enumerate(heads):
        end = heads[i + 1][1] if i + 1 < len(heads) else len(text)
        out.append((h, len(text[start:end].encode("utf-8"))))
    return tuple(out)


def check_section_lengths(rel, text):
    """Pin section structure and exact byte lengths (adversarial case RC-1)."""
    got, want = doc_sections(text), SECTIONS[rel]
    if [h for h, _ in got] != [h for h, _ in want]:
        detail = f"section structure differs — {[h for h, _ in got]}"
    else:
        diff = [f"{h} {g}B (expected {w}B)"
                for (h, g), (_, w) in zip(got, want) if g != w]
        detail = " · ".join(diff) if diff else f"{len(got)} sections"
    check(f"Structure: {rel} preserves {len(want)} sections and byte counts",
          got == want, detail)


def check_markdown_structure(rel, text):
    """Check parsed tables plus retained blank lines and code fences."""
    blanks, fences = LAYOUT[rel]
    got_blank = sum(1 for ln in text.splitlines() if not ln.strip())
    got_fence = text.count("```")
    check(
        f"Structure: {rel} paragraph boundaries ({blanks} blank lines, {fences} fences)",
        got_blank == blanks and got_fence == fences,
        f"blank lines {got_blank}, code fences {got_fence}",
    )
    parsed = md_tables(text)
    want = TABLES[rel]
    check(
        f"Structure: {rel} parses {len(want)} tables",
        len(parsed) == len(want),
        f"{len(parsed)} blocks with valid header, separator, and column count",
    )
    for i, (cols, rows) in enumerate(want):
        got = parsed[i] if i < len(parsed) else None
        check(
            f"Structure: {rel} table {i + 1} `{cols[0] or '(blank)'}` row mapping",
            got == (cols, rows),
            "table missing" if got is None else f"header {got[0]}, {len(got[1])} rows",
        )


def main():
    fm, skill = split_frontmatter(read(os.path.join(ROOT, "SKILL.md")))
    refs = {
        n: read(os.path.join(ROOT, "references", n))
        for n in ("secrets.md", "branch.md", "commit.md", "pr.md")
    }
    sec = refs["secrets.md"]

    # (1) The tester actually determines
    rc, _ = run("--message", "feat: 모델 검사기 추가")
    check('Checker: Pass the correct commit message', rc == 0, f"rc={rc}")
    for msg, why in (
        ("Feat: 대문자 타입", "format violation"),
        ("feat 콜론 없음", "missing separator"),
        ("feat: 마침표로 끝난다.", "trailing period"),
        ("nope: 없는 타입", "unknown type"),
        ("chore: " + "가" * 60, "subject length"),
    ):
        rc2, _ = run("--message", msg)
        check(f"Checker: rejects {why}", rc2 == 1, f"rc={rc2}")

    rc3, out3 = run("--message", "feat: 추가\n\n본문\n\nCo-Authored-By: Claude")
    check(
        'Checker: Catch prohibited phrases (Co-Authored-By)', rc3 == 1 and "banned phrase" in out3
    )
    rc4, out4 = run("--message", "feat: 추가\n\n본문\n\nGenerated with Claude Code")
    check(
        'Checker: Catch prohibited phrases (Generated with)', rc4 == 1 and "banned phrase" in out4
    )

    rc5, _ = run("--message", "feat: 추가\n바로 본문")
    check('Inspector: Catches missing blank lines between title and body', rc5 == 1)

    for br, ok_want, why in (
        ("feat/add-thing", 0, "valid"),
        ("jaesol-shin/jstack-plugin", 1, "username"),
        ("feature-new-plugin", 1, "missing slash"),
        ("Feat/Upper", 1, "uppercase"),
        ("nope/x", 1, "unknown type"),
    ):
        rcb, _ = run("--branch-name", br)
        check(
            f"Checker: branch verdict for {why}", rcb == ok_want, f"rc={rcb} (expected {ok_want})"
        )

    # (1') Axis visible only through execution — boundary value, separation of two constants, cwd branch
    check_checker_execution()

    # (2) Does the protocol match the actual measurements? Does it reveal the fact that it differs from the upstream version?
    check(
        'Protocol: There are 6 branch types in the document',
        all(
            f"`{t}`" in skill
            for t in ("feat", "fix", "refactor", "docs", "test", "chore")
        ),
    )
    check(
        'Protocol: Revealing the fact that there was a split with the upper stream',
        "[Source correction]" in skill
        and "CLAUDE.md is the canon here" in skill,
        "the three-part form exists in 7 of 79 branches; CLAUDE.md is authoritative",
    )
    check('Protocol: Specifies that usernames are prohibited', "**No usernames**" in skill)
    check(
        'Protocol: Specifies no-commit statements',
        "Generated with Claude Code" in skill and "Co-Authored-By" in skill,
    )
    check(
        'Protocol: Explain why and how the text is in order',
        "**why** (problem, motivation)" in skill and "**how** (approach)" in skill,
    )
    # The old contract was, “Is the two-axis table in the text?” The votes were the problem — one organization's
    # The label list pretended to be a rule that applied to all repos, when in fact `@package`
    # It remained only in the document, not in the repo. The new invariant is the owner, not the **value**.
    check(
        'Protocol: Reveals that the authentic source of the label rule is the repo policy file',
        ".claude/pr-policy.json" in skill and "not written here" in skill,
    )
    check(
        'protocol: states that PR cannot be opened without policy file',
        "must exist before a PR can be opened" in skill,
    )
    check(
        'Protocol: Identify the difference between an empty file and an absent file',
        "Empty means" in skill and "absent means" in skill,
    )
    check(
        'Convention: Do not embed label values in the text',
        "@package" not in skill.split("It already had")[0].split("## PRs")[-1],
        "label list reappeared in prose; policy file and gh label list own the values",
    )

    # Are there any discrepancies between the tester and document values?
    src = read(CHECK)
    check(
        'Conformity: Title length upper limit is the same in document and validator',
        "SUBJECT_MAX = 50" in src and "50 characters" in skill,
    )
    check(
        'Match: Body fold width is the same', "BODY_WRAP = 72" in src and "Wrap at 72" in skill
    )

    # (2') direction — sentence literal + inverted voice needle.
    # The fact that there is a needle does not tell **which way** the rule points.
    # No. This is the place where all 35 hostile cases were green.
    for label, positive, negatives in SKILL_DIRECTION:
        trace = [n for n in negatives if re.search(n, skill)]
        check(
            f"Direction: {label}",
            positive in skill and not trace,
            "sentence missing" if positive not in skill else f"inversion traces {trace}",
        )
    # The modulation followed by “except for …” does not touch the sentence literal.
    # Block exception markers on a clause-by-clause basis. It is not a proof as it is a list of words, but the above literal and
    # It only makes sense when taken **together**.
    for header in (
        "## Branches — `<type>/<kebab-case>`",
        "## Commits — Conventional Commits",
        "## PRs — the repository owns the label rule",
        "## Secrets — stop them before the commit",
    ):
        part = section(skill, header)
        hits = sorted(set(HEDGE.findall(part)))
        check(
            f"Direction: {header.split('—')[0].strip()} section has no exception-injection marker",
            bool(part) and not hits,
            "section missing" if not part else f"markers {hits}",
        )

    # (2'') L0 — The only layer that is always read. Even if the routing is reversed, the main contract is abstract.
    gone = [s for s in L0_SENTENCES if s not in fm]
    check('L0: The definition, role, and boundary sentences of description remain the same.', not gone, f"missing {gone}")
    quoted = tuple(re.findall(r'"([^"]+)"', fm))
    check(
        f"L0: all {len(L0_TRIGGERS)} trigger terms remain in order",
        quoted == L0_TRIGGERS,
        f"{list(quoted)}",
    )
    check('L0: The skill name is gitrules', bool(re.search(r"(?m)^name: gitrules$", fm)))

    # (3) Secrets — **The original is the secrets skill.** The previous version had a response procedure (discarded →
    # History → Notification) is copied here in Korean, and it is audit/cleanup
    # This was directly contradictory to the stipulation that “copy 0” was stipulated in the contract (as pointed out by external reviews).
    # What this measures is **what git can't do** and the return path.
    check(
        'Secret: We state that we do not have response procedures here.',
        "The response procedure is not duplicated here" in sec,
    )
    check('Secret: Point out that the original is a secrets skill', "`secrets`" in sec)
    check(
        "Secret: Revealing why you shouldn't have the same procedure in two places", "one could change while the\nother did not" in sec
    )
    check(
        'Secret: What works with git and what doesn’t',
        "What Git can do" in sec and "What Git cannot do" in sec,
    )
    check(
        'Secret: Reveals that copies, forks, and caches are outside of git',
        "existing clones" in sec and "forks" in sec and "cached" in sec,
    )
    check('Secret: So we conclude that disposal comes first', "credential revocation comes first" in sec)
    check(
        'Secret: The secrets skill to be returned is real.',
        os.path.isdir(os.path.join(os.path.dirname(ROOT), "secrets")),
    )
    check(
        'Secret: Reveal the difference between gitignore and info/exclude',
        "Whole repository" in sec and "Local only" in sec,
    )
    check(
        'Secret: Reveals that detection and encryption are different problems',
        "Detection and encryption solve different problems" in sec,
    )

    # (3') Orientation of the referenced document — do the rules and provisions say the opposite?
    for fn, label, positive, negatives in REF_DIRECTION:
        text = refs[fn]
        trace = [n for n in negatives if re.search(n, text)]
        check(
            f"Reference direction: {fn} — {label}",
            positive in text and not trace,
            "sentence missing" if positive not in text else f"inversion traces {trace}",
        )

    # (3'') Structure — Is the table parsed as a table? Modification that erased all blank lines was undetected.
    check_markdown_structure("SKILL.md", skill)
    check_section_lengths("SKILL.md", skill)
    for fn in ("branch.md", "commit.md", "pr.md", "secrets.md"):
        check_markdown_structure(f"references/{fn}", refs[fn])
        check_section_lengths(f"references/{fn}", refs[fn])

    # Voice needle — a gap that the filling report itself pointed out. The label table in pr.md is "This repository
    # Current value (example)" and `@package` is a ghost label that is not defined in the repo.
    # **Literal comparisons are bypassed by a single space** — `|  @package` was missing.
    # Whitespace between pipes and labels is absorbed by regular expressions and broken by word boundaries.
    ghost = re.search(r"\|\s*@package\b", refs["pr.md"])
    check(
        'No ghost label @package row in pr.md labels table',
        ghost is None,
        f"{ghost.group(0)!r}  exists" if ghost else "",
    )

    # boundary
    skills_dir = os.path.dirname(ROOT)
    NAME = r"`([a-z][a-z-]{2,})`\s+skill\b"
    referred = sorted(set(re.findall(NAME, skill)))
    missing = [n for n in referred if not os.path.isdir(os.path.join(skills_dir, n))]
    check('Alert: All return objects are real', not missing, f"missing {missing}")
    check(
        'Boundary: Identifies passing to command',
        "/wrap" in skill and "/commit" in skill and "/pr" in skill,
    )
    check('Limitations: Reveal that only the format is visible', "The checker sees **format**" in skill)

    check_skill_body(
        check,
        ROOT,
        needles=[
            "feat/add-model-version-checker",
            "Generated with Claude Code",
            "[Source correction]",
            "the repository owns the label rule",
            "revoke and\nreissue it immediately",
        ],
        # **Fixed actual measurement, margin 0.** The previous value of 2637 was 62% of the actual measurement 4222 —
        # Even if 37% of the text was deleted, this axis passed (a form demonstrated by the enemy).
        floor=5293,
    )

    check_ref_contracts(
        check,
        ROOT,
        [
            (
                "secrets.md",
                "gitignore distinction, revocation order, and tool selection",
                [
                    "`.git/info/exclude`",
                    "The response procedure is not duplicated here",
                    "credential revocation comes first",
                    "gitleaks",
                    "SOPS",
                ],
                1614,
            ),
            (
                "branch.md",
                "upstream three-part form and evidence for local divergence",
                [
                    "`<folder>/<category>/<description-in-kebab-case>`",
                    "email-verification-workflow",
                    "board-query-performance",
                ],
                1212,
            ),
            (
                "commit.md",
                "upstream type table, title/body rules, and full example",
                [
                    "FlyToCart",
                    "loginUser",
                    "Resolves: #105",
                ],
                1861,
            ),
            (
                "pr.md",
                "upstream label table as example and rationale for excluding @package",
                [
                    "phantom_labels",
                    "ignore-for-release",
                    "closed #123",
                ],
                2091,
            ),
        ],
    )

    # A prefix that does not appear in the copy. **Three axes use the same list/same numbers** — Except for one side
    # The difference becomes a free margin and misses the real extinction. `script contract:` also
    # Since it is returned early from the copy, it must be left out together for the coefficient to be correct.
    META = ("자기검사:", "계약 커버리지:", "스크립트 계약:")
    live_ran = sum(1 for r in results if not r[0].startswith(META))

    check_contract_coverage(
        check,
        __file__,
        ROOT,
        # **Actual measurement fixed, margin 0.** The preceding values ​​(15·12·4·4·4) are compared to the actual measurement (35·19·8·8·9).
        # It was less than half — this means that even if you erase half of a contract, it was still green.
        # D-4 After correction and locking the verse length, it was remeasured (refixed only in the abstract).
        per_file={
            "SKILL.md": 45,
            "references/secrets.md": 22,
            "references/branch.md": 11,
            "references/commit.md": 11,
            "references/pr.md": 11,
        },
        live_ran=live_ran,
    )

    check_body_deletion(
        check,
        __file__,
        ROOT,
        minimum=45,
        live_ran=live_ran,
    )
    # Actual measurement 32. The previous value of 15 is the value before adding the execution-based check, and even then
    # Because it exceeded the actual measurement (14), this axis was always red and ignored.
    check_script_contracts(
        check, __file__, ROOT, scripts={"scripts/check_commit.py": 32},
        live_ran=live_ran,
    )

    check_no_constant_assertions(check, __file__)
    check_total(check, results, 158)

    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n{passed}/{len(results)} 통과")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
