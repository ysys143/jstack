#!/usr/bin/env python3
"""verify contract suite.

Run: python3 tests/run_tests.py   (from skills/verify)

## What this locks

1. **Evidence rule** — the claim/evidence table is the skill. Without it this
   becomes "run some commands and say it went fine".
2. **Machine vs human split** — the failure mode this skill exists to prevent is
   reporting a human judgment as if a machine settled it.
3. **The pipe trap** — this repository was caught three separate times by
   `cmd | head` reporting head's exit code. It must stay written down.
4. **Claim labels** — the second axis. "Who settled it" does not say what the
   evidence covered, and `verified` with a caveat is the label that survives
   summarisation as plain `verified`.
5. **Digest contract** — three digests, never one, plus the canonicalization
   clauses. One digest gives a behaviour change and a test-only change the same
   signal.
6. **Diff coverage** — the replacement for the absolute threshold that always
   gets lowered. Prose alone would not survive, so it is a needle.
7. **The three scripts are measured by behaviour, not by prose.** Each is run
   against real temporary trees: preflight refuses the looser mode and rejects
   symlinks, package_check separates match from mismatch, red_probe reports
   an unfalsifiable command as a failure rather than a pass.
8. **Bulk edits and conditional workflows** — broad writes prove their scope;
   no-change steps carry fresh evidence and a reason instead of disappearing.
"""
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
from _suite_lib import (check_no_constant_assertions, check_total, check_skill_body,
                        check_ref_contracts, split_frontmatter, check_body_deletion,
                        check_contract_coverage, check_script_contracts)  # noqa: E402
ROOT = os.path.dirname(HERE)
PREFLIGHT = os.path.join(ROOT, "scripts", "preflight.py")
PACKAGE_CHECK = os.path.join(ROOT, "scripts", "package_check.py")
RED_PROBE = os.path.join(ROOT, "scripts", "red_probe.py")
PACKAGE_IDENTITY = os.path.join(ROOT, "scripts", "package_identity.py")
WORKFLOW = os.path.join(ROOT, "scripts", "workflow.py")
WORKFLOW_TEST = os.path.join(HERE, "test_workflow.py")

# **All lower bounds are actual measurements.** If the declaration and actual measurements are different, `check_floor_parity.py`
# It is paid with a gap - a gap covers a dead contract, and a gap means it is already dead.
#
# Volume lower bound (number of bytes in the document itself, `content_bytes`)
# **Margin is 0.** Enter the actual value as is. Margin is the “amount that can be erased.”
# In the previous version, the lower limit of SKILL.md was 51% of the actual measurement, so even if half the text was deleted, it was still green.
SKILL_FLOOR = 7812
CLAIM_FLOOR = 4482
DIGEST_FLOOR = 6154
MERGE_FLOOR = 2393
SELF_CHECK_FLOOR = 2330
# Number of failures that tampering produces (measured from an empty copy of the file)
# One unconditional failure caused by a line break in the TDD phrase was removed and measured again.
# This is the actual value measured in the current deletion control group of a single package.
SKILL_MIN = 61
CLAIM_MIN = 4
DIGEST_MIN = 4
MERGE_MIN = 4
SELF_CHECK_MIN = 4
PREFLIGHT_FLOOR = 23
PKGCHECK_FLOOR = 9
REDPROBE_FLOOR = 9
PACKAGE_IDENTITY_FLOOR = 37
WORKFLOW_FLOOR = 2
# Total number of checks produced by this suite (including itself)
TOTAL = 168

# **Clause order anchor** in the referenced document. The volume and hash remain the same even if the lines are shuffled, so the order is
# Lock them separately. If even one anchor is missing (=delete/reverse), the same check is performed.
CLAIM_ANCHORS = [
    "# Claim labels — what the evidence covers",
    "| Verification grade | Who settles it |",
    "## The four labels",
    "| `verified` | The evidence covers the whole claim.",
    "| `unsupported` | Only the preconditions are supported;",
    "## The four rules",
    "**1. `verified` never exceeds the review input scope or the evidence timestamp.**",
    "**2. Filename correspondence is not evidence.**",
    "**3. Preconditions only means `unsupported` or `insufficient-coverage`",
    "**4. Scope-limited `verified` is allowed.**",
    "## Decision tree",
    "1. Did any evidence run at all",
    "6. Otherwise -> verified",
    "## Worked examples",
    "## Writing the label in a report",
    "## What this does not do",
]
DIGEST_ANCHORS = [
    "# Digest contract",
    "## Three digests, never one",
    "**Do not merge these into one.**",
    "## Canonicalization v2",
    "**1. Codepoint order.**",
    "**2. NUL framing.**",
    "**3. mtime and mode are excluded.**",
    "**4. `metadata.version` becomes `@VERSION@`.**",
    "## Reporting a digest",
    "## Failure modes seen",
    "| Cache not invalidated after a real behaviour change | One digest doing three jobs |",
]
MERGE_ANCHORS = [
    "# Merge worktree", "## Current context", "## Instructions",
    "### Phase 1: Validation", "**Verify worktree**", "**Clean working tree**",
    "### Phase 2: Research", "### Phase 3: Target branch preparation",
    "### Phase 4: Squash merge", "**stop and report**",
    "### Phase 5: Craft commit message and commit",
    "Trailers are not written here", "### Phase 6: Verification",
    "## Important notes", "Never skip pre-commit hooks",
]
SELF_CHECK_ANCHORS = [
    "# Run Only Reviews Required by the Work",
    "| Review | When required | What the reviewer checks |",
    "| factual | External facts, figures, or quotations determine the result.",
    "| evaluation independence | A model evaluation, benchmark, or validator pass supports the claim.",
    "| SSOT | The same fact, rule, or number is maintained in multiple places.",
    "| portability | The result claims support across harnesses, paths, or installations.",
    "| cold-read | Another person will use an important explanation, plan, or deliverable.",
    "python3 scripts/workflow.py record-review TASK REQUIREMENT cold-read",
    "`record-review` binds the contract, reviewed files, and raw result hashes.",
]

# The needle/anchor of a document contract is a **module constant**. If you bury it in main()
# It is not possible to import a suite and measure only one axis.
SKILL_NEEDLES = [
    "No completion claim without fresh evidence",
    "A pipe hides the exit code", "rc=$?",
    "Do not pretend to measure the right column",
    "A check that does not exist is not a passing check",
    "Diff coverage is a floor, not a proof",
    # Claim -> Evidence Table. If you swap columns, these rows disappear entirely.
    '| "Fixed" | A test that fails before and passes now |',
    '| "Implemented" | Build passes, diagnostics clean |',
    '| "Refactored" | The existing tests still pass |',
    '| "Debugged" | Root cause named at `file:line` |',
    # Pipe Trap — Prohibition and prescription in one sentence. If you reverse it, there is neither.
    "**A pipe hides the exit code.** `cmd | head` reports head's status, "
    "not cmd's.",
    "Write `cmd > out.txt 2>&1; rc=$?` instead",
    # diff coverage threshold — when `100` becomes `000`, the gate dies
    "--fail-under=100`",
    "untouched legacy files are outside the rule",
    # Machine <-> People table. Heat exchange targets this target.
    "| Settled by machine | Settled by a person |",
    "| Tests pass, build succeeds, lint clean | Does this meet the requirement |",
    "| Types check, no diagnostics | Is the design sound |",
    "| Coverage numbers | Are the tests testing the right thing |",
    # Owned list table — locks header and row mappings together
    "| File | Read or run it when |",
    "| `references/claim-labels.md` | Writing a verification report",
    "| `references/digest-contract.md` | A check compares package digests,",
    "| `references/merge.md` | Squash-merging a worktree back |",
    "| `scripts/preflight.py` | Before a package is installed",
    "| `scripts/package_check.py` | Before release",
    "| `scripts/red_probe.py` | Proving a verification command can actually fail |",
    "| `references/self-check.md` | Selecting only the cold-read, fact,",
    "| `scripts/package_identity.py` | Binding runtime, test, asset, metadata,",
    "| `scripts/workflow.py` | Connecting one version 2 task contract",
    # stop condition
    "**Do not merge on a red check.**",
    "**If something did not run, say it did not run.**",
    "assert both the exact match count and the intended scope",
    "A zero diff with an\nunexplained skipped step is incomplete",
]

BULK_EDIT_TABLE = [
    ("One explicit occurrence", "Edit it directly, then inspect the diff"),
    ("Mechanical or bulk edit",
     "Enumerate every match, assert the exact count and intended scope before writing, "
     "then inspect the diff"),
]

CONDITIONAL_COMPLETION_TABLE = [
    ("The step changed the artifact", "Show the diff and fresh verification"),
    ("It was already satisfied and no change was needed",
     "Show fresh verification and state why that step was skipped"),
    ("There is no diff and a skipped step has no reason", "Incomplete"),
]

REF_CONTRACTS = [
    ("claim-labels.md", "four labels, four rules, and decision tree",
     ["never exceeds the review input scope",
      "Filename correspondence is not evidence",
      "never a\n`verified` with caveats",
      "Scope-limited `verified` is allowed",
      # Label definition table — Modulations that swap definitions have the same bytes.
      "| `verified` | The evidence covers the whole claim.",
      "| scope-limited `verified` | True inside a stated boundary.",
      "| `insufficient-coverage` | Machine verification happened and its "
      "**coverage was partial** |",
      "| `unsupported` | Only the preconditions are supported; "
      "the claimed result is unproven |",
      # Decision tree — Put **Conclusion** in rows. The goal is to falsify only the conclusion.
      "   no  -> unsupported",
      "   preconditions only -> unsupported",
      "   yes -> unsupported          (rule 2: correspondence is not coverage)",
      "       -> insufficient-coverage",
      "       -> scope-limited verified, with the boundary written next to it",
      "   no -> insufficient-coverage (re-run rather than relabel)",
      "6. Otherwise -> verified",
      # Example table — Correspondence of situations and labels. Even if you just mix the label rows, it gets caught here.
      "| Suite green; changed module has no importing test | `unsupported` |",
      "| Tests pass on Python; Go path has no runner in this repo | "
      "scope-limited `verified` |",
      "| 40 of 190 call sites reviewed by hand | `insufficient-coverage` |",
      "| A `README` says the feature is supported | `unsupported` |",
      ], CLAIM_FLOOR),
    ("digest-contract.md", "three separate digests and canonicalization v2",
     # **The entire section title is written as needle.** The two words `NUL framing` fail.
     # It also appears in the mod table, so needle survived even if I just changed the section title.
     # (red case R6 empirical). Nail it in the only form that comes out.
     ["Three digests, never one", "Do not merge these into one",
      "**1. Codepoint order.**", "**2. NUL framing.**",
      "cannot appear in a POSIX path",
      "**3. mtime and mode are excluded.**", "@VERSION@",
      # Locale Sorting Prohibited — The goal is to change the ban to allow.
      "**1. Codepoint order.** Sort paths by Unicode codepoint, never by locale",
      "Do not\ncall a locale-aware sort.",
      # Failure Mode Table — **Wiring of Symptoms and Causes**. Cause: If you just mix the columns, the bytes are the same.
      "| Digest differs between CI and a laptop, no diff in `git status` | "
      "mtime or mode included (clause 3) |",
      "| Digest differs only under a non-C locale | Locale collation instead "
      "of codepoint order (clause 1) |",
      "| Version bump alone changes the content digest | Missing `@VERSION@` "
      "substitution (clause 4) |",
      "| Two distinct trees share a digest | Missing NUL framing (clause 2) |",
      "| Cache not invalidated after a real behaviour change | "
      "One digest doing three jobs |",
      ], DIGEST_FLOOR),
    ("merge.md", "six-phase squash procedure; gitrules owns trailers",
     ["contains `/worktrees/`", "merge --squash",
      "Trailers are not written here", "Never skip pre-commit hooks",
      # Stop condition four. In this skill, twists are the most expensive sentences.
      "1. **Verify worktree**: Check `git rev-parse --git-dir` contains "
      "`/worktrees/`. If not, stop:",
      "5. **Clean working tree**: Run `git status --porcelain`. "
      "If uncommitted changes exist, stop.",
      "3. If conflicts: list files, show markers, **stop and report** "
      "-- do NOT auto-resolve",
      "- Never skip pre-commit hooks (`--no-verify`)",
      "- If anything unexpected happens, stop and explain rather than guessing",
      ],
     MERGE_FLOOR),
    ("self-check.md", "conditional factual, independence, SSOT, portability, and cold-read reviews",
     ["Do not demand every review for a simple wording edit",
      "`applicability: skipped` with a specific `skipReason`",
      "Test rejection with a real wrong answer and false PASS",
      "Reading the source checkout does not prove the installation",
      "python3 scripts/workflow.py record-review TASK REQUIREMENT cold-read",
     "it is not a signature that authenticates an author or proves reviewer independence"],
     SELF_CHECK_FLOOR),
    ("security-verification.md", "security specification, result JSON, stages, and freshness",
     ["# Security Verification Contract", '"schemaVersion": 1',
      "Runner stdout must be exactly one JSON result",
      "current machine fix verification requires every stage",
      "invalidates the earlier receipt"], 2360),
    ("defending-code-upstream.md", "pinned upstream SHA and adopted versus excluded scope",
     ["# Pinned `defending-code-reference-harness` Reference", "Apache-2.0",
      "d3bea6b5793b5f3d59a75ebe69a58efa88383145",
      "Pinned upstream reference", "## Excluded Scope"], 1526),
]

ANCHORS_OF = {"claim-labels.md": CLAIM_ANCHORS,
              "digest-contract.md": DIGEST_ANCHORS,
              "merge.md": MERGE_ANCHORS,
              "self-check.md": SELF_CHECK_ANCHORS,
              "security-verification.md": ["# Security Verification Contract", "## Specification and Results", "## Stages and Evidence"],
              "defending-code-upstream.md": ["# Pinned `defending-code-reference-harness` Reference", "## Excluded Scope"]}

results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))


def read(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


def md_rows(text, head, width):
    """Return exact cell tuples from the first table under `## head`."""
    if head not in text:
        return []
    body = text.split(head, 1)[1].split("\n## ", 1)[0]
    out = []
    for line in body.splitlines():
        stripped = line.strip()
        if not stripped.startswith("|"):
            continue
        cells = [cell.strip() for cell in stripped.strip("|").split("|")]
        if len(cells) != width or set("".join(cells)) <= set("-: "):
            continue
        out.append(tuple(cells))
    return out[1:] if out else out


def run(script, *args, env=None):
    """Return (rc, stdout, stderr) without using the pipe this skill forbids.

    `env` overlays the real environment. Replacing the environment would remove
    PATH, kill the script, and falsely make the resulting failure look invariant.
    """
    r = subprocess.run([sys.executable, script, *args],
                       capture_output=True, text=True,
                       env=({**os.environ, **env} if env else None))
    return r.returncode, r.stdout, r.stderr


# Environment variable names that can revive loose mode and skip inspection. No matter which of these you read
# This means that if the decision is shaky, fail-closed is turned off with an environment variable.
ENV_BYPASS = ("PREFLIGHT_MODE", "PREFLIGHT_ALLOW_LOOSE", "PREFLIGHT_FORCE",
              "PREFLIGHT_SURFACE", "SKIP_PREFLIGHT", "VERIFY_MODE", "VERIFY_FORCE",
              "ALLOW_LOOSE", "FORCE", "CI", "CLAUDE_PLUGIN_ROOT")

# Development remnants that should be rejected from distribution. When the `DEV_ARTIFACTS` list shrinks,
# One of the ones here goes through.
DEV_ARTIFACT_FIXTURES = ("references/stale.pyc", "references/stale.pyo",
                         "references/patch.orig", "references/patch.rej",
                         "references/__pycache__/mod.py",
                         "references/.ruff_cache/CACHEDIR", 
                         "references/.pytest_cache/CACHEDIR",
                         "references/.git/config", ".DS_Store")

# `ESCAPE_PATTERNS` A fixture for each of the three items. (Path, body, reason for expectation)
ESCAPE_FIXTURES = (
    ("references/home.md", "Settings are in ~/.claude/settings.json.\n", "hard-coded home path"),
    ("references/abs.md", "The original is at /Users/someone/work/x.\n", "absolute home path"),
    ("references/up.md", "Read ${CLAUDE_PLUGIN_ROOT}/../other/x.md.\n",
     "reference outside the plugin root"),
)


def as_json(out):
    try:
        return json.loads(out)
    except ValueError:
        return {}


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


def make_package(base, *, with_tests=True, version="1.2.0", changelog="1.2.0",
                 extra=None):
    """Create a temporary package; `with_tests` controls mode detection."""
    write(os.path.join(base, "SKILL.md"),
          "---\nname: sample\ndescription: sample\n---\n\n# Sample\n\nbody\n")
    write(os.path.join(base, "references", "notes.md"), "# Notes\n\nreference body\n")
    write(os.path.join(base, "scripts", "run.py"), "print('ok')\n")
    if with_tests:
        write(os.path.join(base, "tests", "run_tests.py"), "print('tests')\n")
    write(os.path.join(base, ".claude-plugin", "plugin.json"),
          json.dumps({"name": "sample", "version": version}) + "\n")
    if changelog is not None:
        write(os.path.join(base, "CHANGELOG.md"),
              f"# Changelog\n\n## [Unreleased]\n\n## [{changelog}] - 2026-01-01\n\n- 첫 항목\n")
    for rel, body in (extra or {}).items():
        write(os.path.join(base, rel), body)
    return base


def preflight_checks(tmp):
    src = make_package(os.path.join(tmp, "src"))
    for mode in ("source-development", "installed-runtime"):
        rc, out, err = run(PREFLIGHT, src, "--mode", mode)
        check(f"preflight: valid tree passes in {mode} (rc 0)",
              rc == 0, f"rc={rc} {err.strip()[:80]}")

    # Symlink — reject in both modes
    linked = make_package(os.path.join(tmp, "linked"))
    os.symlink(os.path.join(linked, "SKILL.md"),
               os.path.join(linked, "references", "alias.md"))
    for mode in ("source-development", "installed-runtime"):
        rc, out, err = run(PREFLIGHT, linked, "--mode", mode)
        check(f"preflight: symlink is rejected in {mode} (nonzero rc)",
              rc != 0, f"rc={rc}")
    rc, out, _ = run(PREFLIGHT, linked, "--json")
    kinds = [v["kind"] for v in as_json(out).get("violations", [])]
    check("preflight: violation kind is reported as symlink", "symlink" in kinds, f"{kinds}")

    # Non-regular files — FIFO
    fifo_tree = make_package(os.path.join(tmp, "fifo"))
    fifo = os.path.join(fifo_tree, "references", "pipe")
    os.mkfifo(fifo)
    rc, out, _ = run(PREFLIGHT, fifo_tree, "--json")
    kinds = [v["kind"] for v in as_json(out).get("violations", [])]
    check("preflight: non-regular file (FIFO) is rejected",
          rc != 0 and "non-regular" in kinds, f"rc={rc} {kinds}")

    # Mode detection + no loose side selection
    installed = make_package(os.path.join(tmp, "installed"), with_tests=False)
    rc, out, _ = run(PREFLIGHT, installed, "--json")
    check("preflight: tree without tests is detected as installed-runtime",
          as_json(out).get("detected") == "installed-runtime",
          as_json(out).get("detected"))
    rc, out, err = run(PREFLIGHT, installed, "--mode", "source-development")
    check("preflight: a mode looser than detection is rejected (rc 2)", rc == 2, f"rc={rc}")
    check("preflight: rejection explains that the requested mode is looser",
          "looser mode" in err, err.strip()[:80])
    rc, _, _ = run(PREFLIGHT, os.path.join(tmp, "src"), "--mode", "installed-runtime")
    check("preflight: a stricter requested mode is allowed", rc == 0, f"rc={rc}")

    # Surface fail-closed — fails with one unclassified file
    stray = make_package(os.path.join(tmp, "stray"),
                         extra={"leftover.bin": "x\n"})
    rc, out, _ = run(PREFLIGHT, stray, "--json")
    kinds = [v["kind"] for v in as_json(out).get("violations", [])]
    check("preflight: one file outside the surface fails closed",
          rc == 1 and "unclassified" in kinds, f"rc={rc} {kinds}")

    # If the surface text is available, read it — if it is a narrow surface, the reference is off the surface.
    surface = os.path.join(tmp, "package-surface.yaml")
    write(surface, "runtime:\n  - SKILL.md\nverification:\n  - tests/**\n")
    rc, out, _ = run(PREFLIGHT, os.path.join(tmp, "src"), "--surface", surface, "--json")
    paths = [v["path"] for v in as_json(out).get("violations", [])]
    check("preflight: --surface reads the supplied surface definition",
          rc == 1 and "references/notes.md" in paths, f"rc={rc} {paths[:4]}")

    # installed-runtime only — development remnants
    dirty = make_package(os.path.join(tmp, "dirty"), with_tests=False,
                         extra={"references/stale.pyc": "x"})
    rc, out, _ = run(PREFLIGHT, dirty, "--json")
    kinds = [v["kind"] for v in as_json(out).get("violations", [])]
    check("preflight: development residue is rejected from installed runtime",
          rc == 1 and "dev-artifact" in kinds, f"rc={rc} {kinds}")

    rc, _, _ = run(PREFLIGHT, os.path.join(tmp, "does-not-exist"))
    check("preflight: an unexecutable check returns 2, not 0", rc == 2, f"rc={rc}")


def package_check_checks(tmp):
    ok_tree = make_package(os.path.join(tmp, "pkg-ok"))
    rc, out, _ = run(PACKAGE_CHECK, ok_tree)
    check("package_check: matching versions return rc 0", rc == 0, f"rc={rc}")

    bad = make_package(os.path.join(tmp, "pkg-bad"), version="1.3.0", changelog="1.2.0")
    rc, out, _ = run(PACKAGE_CHECK, bad)
    check("package_check: top CHANGELOG version mismatch returns rc 1", rc == 1, f"rc={rc}")
    rc, out, _ = run(PACKAGE_CHECK, bad, "--json")
    problems = " ".join(as_json(out).get("problems", []))
    check("package_check: mismatch reports both values",
          "1.3.0" in problems and "1.2.0" in problems, problems[:90])

    missing = make_package(os.path.join(tmp, "pkg-nochangelog"), changelog=None)
    rc, _, _ = run(PACKAGE_CHECK, missing)
    check("package_check: missing CHANGELOG is not a pass (rc 1)", rc == 1, f"rc={rc}")

    unreleased = make_package(os.path.join(tmp, "pkg-unreleased"))
    rc, out, _ = run(PACKAGE_CHECK, unreleased, "--json")
    check("package_check: [Unreleased] is not parsed as a version",
          as_json(out).get("facts", {}).get("changelog_top") == "1.2.0",
          str(as_json(out).get("facts", {}).get("changelog_top")))

    root_cl = os.path.join(tmp, "ROOT-CHANGELOG.md")
    write(root_cl, "# Root\n\n- 다른 패키지 0.1.0\n")
    rc, _, _ = run(PACKAGE_CHECK, ok_tree, "--root-changelog", root_cl)
    check("package_check: missing (name, version) row in root CHANGELOG returns rc 1",
          rc == 1, f"rc={rc}")
    write(root_cl, "# Root\n\n- sample 1.2.0 배포\n")
    rc, _, _ = run(PACKAGE_CHECK, ok_tree, "--root-changelog", root_cl)
    check("package_check: matching root row returns rc 0", rc == 0, f"rc={rc}")

    empty = os.path.join(tmp, "pkg-empty")
    os.makedirs(empty, exist_ok=True)
    rc, _, _ = run(PACKAGE_CHECK, empty)
    check("package_check: missing plugin.json is unexecutable (2), not defect (1)",
          rc == 2, f"rc={rc}")


def red_probe_checks(tmp):
    tree = os.path.join(tmp, "red-tree")
    write(os.path.join(tree, "impl.py"), "def f():\n    return 1\n")
    write(os.path.join(tree, "t_real.py"),
          "import sys\nfrom impl import f\nsys.exit(0 if f() == 1 else 1)\n")
    write(os.path.join(tree, "t_hollow.py"), "import impl\nprint('ok')\n")
    real = f"{sys.executable} t_real.py"
    hollow = f"{sys.executable} t_hollow.py"
    flip = "impl.py:return 1->return 2"

    rc, out, _ = run(RED_PROBE, "--tree", tree, "--command", real,
                     "--mutate", flip, "--json")
    rep = as_json(out)
    check("red_probe: command that fails after mutation proves RED (rc 0)",
          rc == 0, f"rc={rc}")
    check("red_probe: reports baseline and mutated exit codes",
          rep.get("baseline_rc") == 0 and rep.get("mutated_rc") not in (0, None),
          f"{rep.get('baseline_rc')} -> {rep.get('mutated_rc')}")

    rc, out, _ = run(RED_PROBE, "--tree", tree, "--command", hollow,
                     "--mutate", flip, "--json")
    check("red_probe: command that survives mutation leaves RED unproven (rc 1)", rc == 1, f"rc={rc}")
    verdict = as_json(out).get("verdict", "")
    check("red_probe: an unfalsifiable command is reported as unproven",
          "unproven" in verdict, verdict[:80])

    rc, out, _ = run(RED_PROBE, "--tree", tree, "--command", real,
                     "--mutate", "impl.py:없는문자열->x", "--json")
    check("red_probe: no-op mutation is unexecutable, not pass (rc 2)",
          rc == 2, f"rc={rc}")

    rc, out, _ = run(RED_PROBE, "--tree", tree, "--command", hollow,
                     "--mutate", flip, "--expect-rc", "3", "--json")
    check("red_probe: unexpected baseline is unexecutable (rc 2)", rc == 2, f"rc={rc}")

    rc, out, _ = run(RED_PROBE, "--tree", tree, "--command", real, "--json")
    check("red_probe: missing mutation is unexecutable (rc 2)", rc == 2, f"rc={rc}")

    # The original tree is not touched — tampering only occurs on the copy
    check("red_probe: original tree remains unchanged",
          "return 1" in read(os.path.join(tree, "impl.py")))


def preflight_hardening(tmp):
    """Measure `preflight.py` fail-closed behavior with malformed trees.

    A valid-tree rc-0 check can survive an emptied script. Every fixture here is
    valid only when rejected, so removing a rejection turns the check red.
    """
    # A symlink that points outside the tree. This is different from an implementation that only looks at internal links —
    # When you copy, someone else's file either follows or gets cut off.
    outside = os.path.join(tmp, "outside-target.md")
    write(outside, "# 트리 밖 파일\n")
    esc = make_package(os.path.join(tmp, "escape-link"))
    os.symlink(outside, os.path.join(esc, "references", "outside.md"))
    rc, out, _ = run(PREFLIGHT, esc, "--json")
    vs = as_json(out).get("violations", [])
    check("preflight: symlink outside the tree is rejected",
          rc == 1 and any(v["kind"] == "symlink" and v["path"] == "references/outside.md"
                          for v in vs),
          f"rc={rc} {[v['kind'] for v in vs]}")
    check("preflight: symlink violation reports its target",
          any(v["kind"] == "symlink" and outside in v["detail"] for v in vs),
          str([v.get("detail") for v in vs])[:90])

    # Broken symlink — there is no target, so `stat` dies and only `lstat` lives.
    brk = make_package(os.path.join(tmp, "broken-link"))
    os.symlink(os.path.join(brk, "gone.md"), os.path.join(brk, "references", "dangling.md"))
    rc, out, _ = run(PREFLIGHT, brk, "--json")
    kinds = [v["kind"] for v in as_json(out).get("violations", [])]
    check("preflight: broken symlink is rejected", rc == 1 and "symlink" in kinds,
          f"rc={rc} {kinds}")

    # SKILL.md absent — not a package
    noskill = os.path.join(tmp, "no-skill")
    write(os.path.join(noskill, "references", "notes.md"), "# 참조\n")
    write(os.path.join(noskill, ".claude-plugin", "plugin.json"),
          json.dumps({"name": "sample", "version": "1.2.0"}) + "\n")
    rc, out, _ = run(PREFLIGHT, noskill, "--json")
    vs = as_json(out).get("violations", [])
    check("preflight: missing SKILL.md fails as missing-skill",
          rc == 1 and any(v["kind"] == "missing-skill" for v in vs),
          f"rc={rc} {[v['kind'] for v in vs]}")

    # 0-byte runtime file — a shell that remains in the installation copy
    hollow = make_package(os.path.join(tmp, "hollow"), with_tests=False,
                          extra={"references/hollow.md": ""})
    rc, out, _ = run(PREFLIGHT, hollow, "--json")
    vs = as_json(out).get("violations", [])
    check("preflight: empty runtime file is rejected from distribution",
          rc == 1 and any(v["kind"] == "empty-runtime"
                          and v["path"] == "references/hollow.md" for v in vs),
          f"rc={rc} {[(v['kind'], v['path']) for v in vs]}")

    # Reference outside the package — ESCAPE_PATTERNS Passes **each** of the three items
    escaped = []
    for i, (rel, payload, why) in enumerate(ESCAPE_FIXTURES):
        tree = make_package(os.path.join(tmp, f"escape-{i}"), with_tests=False,
                            extra={rel: payload})
        rc, out, _ = run(PREFLIGHT, tree, "--json")
        vs = as_json(out).get("violations", [])
        if not (rc == 1 and any(v["kind"] == "escapes-package" and v["path"] == rel
                                and v["detail"] == why for v in vs)):
            escaped.append(f"{why}({rel})")
    check("preflight: every package-escape pattern is rejected",
          not escaped, f"unexpected passes {escaped}")

    # All of the development leftovers — as the list shrinks, one of them passes.
    leaked = []
    for i, rel in enumerate(DEV_ARTIFACT_FIXTURES):
        tree = make_package(os.path.join(tmp, f"dev-{i}"), with_tests=False,
                            extra={rel: "x\n"})
        rc, out, _ = run(PREFLIGHT, tree, "--json")
        vs = [v for v in as_json(out).get("violations", []) if v["path"] == rel]
        if not (rc == 1 and vs and vs[0]["kind"] == "dev-artifact"):
            leaked.append(rel)
    check("preflight: every development-residue fixture is rejected",
          not leaked, f"unexpected passes {leaked}")

    # The fallback surface is **closed**. If even one glob is widened, one of these is classified.
    strays = ["leftover.bin", "notes.txt", "deep/nested/thing.dat", "Makefile", "noext"]
    many = make_package(os.path.join(tmp, "stray-many"),
                        extra={s: "x\n" for s in strays})
    rc, out, _ = run(PREFLIGHT, many, "--json")
    unc = {v["path"] for v in as_json(out).get("violations", [])
           if v["kind"] == "unclassified"}
    check("preflight: fallback surface is closed; every stray is unclassified",
          rc == 1 and set(strays) <= unc,
          f"rc={rc} unexpectedly classified {sorted(set(strays) - unc)}")

    # `ignore` does not swallow the surface whole. If swallowed, fail-closed disappears.
    ig_path = os.path.join(tmp, "surface-ignore.yaml")
    write(ig_path,
          "categories:\n"
          "  runtime:\n    - SKILL.md\n    - references/**\n    - scripts/**\n"
          "  verification:\n    - tests/**\n"
          "  metadata:\n    - .claude-plugin/**\n    - CHANGELOG.md\n"
          "ignore:\n  - '*.log'\n")
    ig_tree = make_package(os.path.join(tmp, "ignore-tree"),
                           extra={"leftover.bin": "x\n", "run.log": "x\n"})
    rc, out, _ = run(PREFLIGHT, ig_tree, "--surface", ig_path, "--json")
    unc = {v["path"] for v in as_json(out).get("violations", [])
           if v["kind"] == "unclassified"}
    check("preflight: ignore list cannot swallow the full surface",
          rc == 1 and "leftover.bin" in unc and "run.log" not in unc,
          f"rc={rc} unclassified {sorted(unc)}")

    # Do not disguise fallbacks as authentic. `src` is rc 0 in the fallback, rc 0 in the narrow source
    # Since rc 1, we also measure **whether the source notation is tied to the surface on which it was actually written** —
    # Looking at the string alone, you cannot tell the disguise of writing the authentic path in place of the fallback.
    src_tree = os.path.join(tmp, "src")
    rc_fb, out_fb, _ = run(PREFLIGHT, src_tree, "--json")
    origin_fb = str(as_json(out_fb).get("surface"))
    check("preflight: source reports fallback when canonical surface is absent",
          "FALLBACK_SURFACE" in origin_fb, origin_fb[:80])
    named = os.path.join(tmp, "package-surface.yaml")
    rc_ex, out_ex, _ = run(PREFLIGHT, src_tree, "--surface", named, "--json")
    origin_ex = str(as_json(out_ex).get("surface"))
    check("preflight: source label matches the surface actually used",
          "FALLBACK_SURFACE" not in origin_ex and rc_fb == 0 and rc_ex == 1,
          f"{origin_fb[:24]}(rc {rc_fb}) vs {origin_ex[:24]}(rc {rc_ex})")

    # Loose modes are not revived by environment variables
    polluted = {k: "1" for k in ENV_BYPASS}
    installed = os.path.join(tmp, "installed")
    rc, _, _ = run(PREFLIGHT, installed, "--mode", "source-development", env=polluted)
    check("preflight: environment variables cannot revive loose mode (rc remains 2)",
          rc == 2, f"rc={rc}")
    rc_a, out_a, _ = run(PREFLIGHT, many, "--json")
    rc_b, out_b, _ = run(PREFLIGHT, many, "--json", env=polluted)
    check("preflight: violation verdict is independent of environment variables",
          (rc_a, as_json(out_a).get("violations"))
          == (rc_b, as_json(out_b).get("violations")),
          f"rc {rc_a} -> {rc_b}")


def package_check_hardening(tmp):
    """Ensure `package_check.py` rejects cross-package rows and the last version."""
    ok_tree = os.path.join(tmp, "pkg-ok")

    # Rows that match only the name · Rows that match only the version. If `and` is changed to `or`, both will pass.
    cross = os.path.join(tmp, "CROSS-CHANGELOG.md")
    write(cross, "# Root\n\n- sample 9.9.9 배포\n- other-plugin 1.2.0 배포\n")
    rc, out, _ = run(PACKAGE_CHECK, ok_tree, "--root-changelog", cross, "--json")
    problems = " ".join(as_json(out).get("problems", []))
    check("package_check: name and version from different rows do not match (rc 1)",
          rc == 1 and "(sample, 1.2.0)" in problems, f"rc={rc} {problems[:80]}")

    # Do not quietly overlook manifest defects
    unreported = []
    for key in ("version", "name"):
        broke = make_package(os.path.join(tmp, f"pkg-no-{key}"))
        fields = {"name": "sample", "version": "1.2.0"}
        fields.pop(key)
        write(os.path.join(broke, ".claude-plugin", "plugin.json"),
              json.dumps(fields) + "\n")
        rc, out, _ = run(PACKAGE_CHECK, broke, "--json")
        problems = " ".join(as_json(out).get("problems", []))
        if not (rc == 1 and key in problems):
            unreported.append(f"{key}(rc={rc})")
    check("package_check: reports every manifest name and version defect",
          not unreported, f"unreported {unreported}")

    # When there are multiple versions, read **top**
    multi = make_package(os.path.join(tmp, "pkg-multi"))
    write(os.path.join(multi, "CHANGELOG.md"),
          "# Changelog\n\n## [Unreleased]\n\n## [1.2.0] - 2026-02-01\n\n- 최신\n\n"
          "## [1.1.0] - 2026-01-15\n\n- 중간\n\n## [1.0.0] - 2026-01-01\n\n- 최초\n")
    rc, out, _ = run(PACKAGE_CHECK, multi, "--json")
    top = as_json(out).get("facts", {}).get("changelog_top")
    check("package_check: reads the first of multiple versions, not the last",
          rc == 0 and top == "1.2.0", f"rc={rc} top={top}")


def red_probe_hardening(tmp):
    """Catch three quiet red_probe reversals: pipes, replace-all, and timeout."""
    tree = os.path.join(tmp, "red-tree")
    real = f"{sys.executable} t_real.py"
    flip = "impl.py:return 1->return 2"

    # Pipes do not obscure the exit code. If `shell=True`, the rc of the following command wins.
    rc, out, _ = run(RED_PROBE, "--tree", tree, "--command", real + " | cat",
                     "--mutate", flip, "--json")
    rep = as_json(out)
    check("red_probe: pipe cannot hide the command exit code",
          rc == 0 and rep.get("mutated_rc") not in (0, None),
          f"rc={rc} mutated rc={rep.get('mutated_rc')}")

    # Modulation is **first match only**. If there is a complete substitution, the observation end code will be different.
    write(os.path.join(tree, "conf.py"), 'A = "keep"\nB = "keep"\n')
    write(os.path.join(tree, "t_conf.py"),
          "import sys, conf\n"
          "sys.exit(0 if (conf.A, conf.B) == ('keep', 'keep')\n"
          "         else 2 if (conf.A, conf.B) == ('gone', 'keep') else 3)\n")
    rc, out, _ = run(RED_PROBE, "--tree", tree,
                     "--command", f"{sys.executable} t_conf.py",
                     "--mutate", 'conf.py:"keep"->"gone"', "--json")
    rep = as_json(out)
    check("red_probe: mutation changes only the first match, not every match",
          rc == 0 and rep.get("mutated_rc") == 2,
          f"rc={rc} mutated rc={rep.get('mutated_rc')} (3 means replace-all)")

    # **Failure to run** after modification is not RED proof.
    write(os.path.join(tree, "spin.py"), "MARK = 1\n")
    write(os.path.join(tree, "t_spin.py"),
          "import sys, spin\nsys.exit(0 if spin.MARK == 1 else 1)\n")
    rc, out, _ = run(RED_PROBE, "--tree", tree,
                     "--command", f"{sys.executable} t_spin.py",
                     "--mutate", "spin.py:MARK = 1->MARK = __import__('time').sleep(30) or 1",
                     "--timeout", "3", "--json")
    rep = as_json(out)
    check("red_probe: post-mutation timeout does not prove RED (rc 2)",
          rc == 2 and rep.get("mutated_rc") is None,
          f"rc={rc} mutated rc={rep.get('mutated_rc')}")


def package_identity_checks(tmp):
    package = make_package(os.path.join(tmp, "identity-package"))
    rc, out, err = run(PACKAGE_IDENTITY, package, "--json")
    first = as_json(out)
    check("package_identity: computes role digests for a package without Git",
          rc == 0 and set(first.get("digests", {})) ==
          {"runtime", "test", "assets", "metadata", "versionNeutralTree", "tree"},
          f"rc={rc} {err.strip()[:80]}")
    write(os.path.join(package, "scripts", "run.py"), "print('changed')\n")
    rc, out, err = run(PACKAGE_IDENTITY, package, "--json")
    second = as_json(out)
    check("package_identity: runtime change updates runtime and tree digests",
          rc == 0
          and first.get("digests", {}).get("runtime") != second.get("digests", {}).get("runtime")
          and first.get("digests", {}).get("tree") != second.get("digests", {}).get("tree"),
          f"rc={rc} {err.strip()[:80]}")
    check("package_identity: reads package name and version from manifest",
          second.get("package") == {"name": "sample", "version": "1.2.0"},
          f"{second.get('package')}")


def workflow_checks():
    for method, label in (
        ("test_full_plan_delegate_interrupt_resume_verify",
         "plan -> prepare -> brief -> interrupt/resume -> verify -> complete"),
        ("test_timeout_kills_the_command_process_group",
         "timeout kills the child process group and records failure"),
    ):
        run_case = subprocess.run(
            [sys.executable, WORKFLOW_TEST, f"WorkflowCase.{method}"],
            capture_output=True, text=True,
            env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"})
        check(f"workflow: {label}", run_case.returncode == 0,
              (run_case.stdout + run_case.stderr)[-160:].replace("\n", " "))


def check_doc_order(label, text, anchors):
    """Lock document line order independently of volume and frozen hashes.

    Reordering retains the same bytes, and refreshing a frozen reference can make
    that bad order look canonical. Embedding the anchor sequence in this suite
    makes a reversed document fail regardless of how its frozen copy is changed.
    """
    at = [(a, text.find(a)) for a in anchors]
    missing = [a for a, i in at if i < 0]
    if missing:
        check(label, False, f"missing anchors {missing}")
        return
    wrong = [f"{at[k][0]!r} followed by {at[k + 1][0]!r}"
             for k in range(len(at) - 1) if at[k][1] >= at[k + 1][1]]
    check(label, not wrong, f"wrong order {wrong[:2]}")


REF_CONTRACTS.extend([
    ("local-feedback.md", "focused diagnosis and execution scope", [], 3077),
    ("validation-cost.md", "setup cost and execution isolation", [], 2922),
])
ANCHORS_OF.update({
    "local-feedback.md": ["# Local feedback", "## Collect the failure inventory", "## Form and check a hypothesis", "## Choose the environment and widen scope", "## Preserve evidence and stop redundant execution"],
    "validation-cost.md": ["# Validation cost", "## Measure the bottleneck", "## Reduce repeated setup before adding workers", "## Bound concurrency and preserve isolation", "## Speed up a slow test suite", "## Record the result"],
})


def skill_prose_checks(fm, skill):
    """Check the SKILL.md prose and tables outside main for isolated mutation probes.
    """
    # (1) Rules of evidence
    check("Evidence: forbids completion claims without fresh evidence",
          "No completion claim without fresh evidence" in skill)
    check("Workflow: task.json takes precedence over the generic repository scan",
          "use the task workflow before the\ngeneric repository scan" in skill
          or "use the task workflow before the generic repository scan" in skill)
    check("Workflow: verify always runs the contract linter first",
          "`verify` always runs the plan contract linter first" in skill)
    check("Workflow: positive runs in repository and RED in a fresh copy",
          "positive command in the repository" in skill
          and "copied under a fresh `{RED_ROOT}`" in skill)
    check("Workflow: RED_ROOT is not described as an OS sandbox",
          "working-directory boundary supplied to a trusted contract command, not an OS\nsandbox" in skill
          or "working-directory boundary supplied to a trusted contract command, not an OS sandbox" in skill)
    check("Workflow: timeout kills the process group and records failure",
          "120-second default limit" in skill
          and "timeout terminates its process\ngroup" in skill)
    check("Workflow: preflight does not confuse a TDD failure with a missing tool",
          "does not mistake a pre-implementation TDD failure for a missing tool"
          in " ".join(skill.split()))
    check("Workflow: local brief does not spawn; native harness delegates",
          "local brief\ndoes not spawn an agent" in skill
          and "native harness owns delegation" in skill)
    check("Extra review: select only task-required kinds from self-check",
          "Choose extra self-checks from `references/self-check.md`" in skill)
    check("Extra review: local receipt fields do not prove reviewer independence",
          "reviewer name or JSON flag does\nnot prove identity or independence" in skill
          or "reviewer name or JSON flag does not prove identity or independence" in skill)
    check("Receipt: preflight, brief, or coordinator runtime change invalidates it",
          "binds the\ncurrent preflight, brief, and coordinator package runtime identity" in skill
          and "invalidates an older receipt" in skill)
    check("Evidence: lists what does not count as evidence",
          "It should work" in skill and "are not evidence" in skill)
    check("Evidence: table gives required evidence by claim",
          "| Claim | Required evidence |" in skill)
    for claim, ev in (("Fixed", "fails before and passes now"),
                      ("Implemented", "Build passes"),
                      ("Refactored", "existing tests still pass"),
                      ("Debugged", "`file:line`")):
        check(f"Evidence: {claim} has concrete evidence", ev in skill)

    # (2) Machine ↔ People
    check("Separation: table distinguishes machine and human decisions",
          "| Settled by machine | Settled by a person |" in skill)
    check("Separation: forbids pretending to measure human judgment",
          "Do not pretend to measure the right column" in skill)
    check("Separation: requires naming who must decide",
          "say who\nmust decide" in skill or "say who" in skill)
    check("Limit: identifies false machine settlement of human judgment as the target failure",
          "the failure this\nskill exists to prevent" in skill
          or "skill exists to prevent" in skill)

    # (3) Pipe Trap — This repository actually got caught three times
    check("Trap: explains that a pipe hides the exit code",
          "A pipe hides the exit code" in skill)
    check("Trap: gives the correct command form", "rc=$?" in skill)
    check("Trap: ties the rule to repository experience",
          "three separate times" in skill)
    check("Trap: zero exit with zero tests is not a pass",
          "zero exit code with zero tests collected is not a pass" in re.sub(r"\s+", " ", skill))

    # (3a) Mass editing locks the target set and semantic scope together before writing.
    got = md_rows(skill, "## Bulk edit safety", 2)
    check("Bulk edit: action table matches the canonical rows", got == BULK_EDIT_TABLE,
          f"{got}")
    check("Bulk edit: asserts exact count and intended scope before writing",
          "assert both the exact match count and the intended scope" in skill)
    check("Bulk edit: stops on any out-of-scope match",
          "stop if any match falls\noutside it" in skill
          or "stop if any match falls outside it" in skill)
    check("Bulk edit: does not impose bulk procedure on one explicit edit",
          "One explicit occurrence does not need this bulk-edit ceremony" in skill)

    # (3b) Conditional steps are all described as either change or verified no change.
    got = md_rows(skill, "## Conditional workflow completion", 2)
    check("Conditional completion: evidence table matches canonical rows",
          got == CONDITIONAL_COMPLETION_TABLE, f"{got}")
    check("Conditional completion: a change requires diff and fresh verification",
          "A useful change produces a diff and fresh verification" in skill)
    check("Conditional completion: satisfied step requires fresh evidence and skip reason",
          "keep the fresh\nverification evidence and state why that step was skipped" in skill
          or "keep the fresh verification evidence and state why that step was skipped" in skill)
    check("Conditional completion: no diff and no skip reason is incomplete",
          "A zero diff with an\nunexplained skipped step is incomplete" in skill
          or "A zero diff with an unexplained skipped step is incomplete" in skill)

    # (4) Do not count missing inspections as passing.
    check("Honesty: a nonexistent check cannot count as passing",
          "A check that does not exist is not a passing check" in skill)
    check("Honesty: requires reporting checks that did not run",
          "say it did not run" in skill)
    check("Honesty: explains that an omitted row reads as a pass",
          "An omitted row reads as a pass" in skill)

    # (5) Merge — If you squash in the red state, bisect becomes difficult.
    check("Merge: requires worktree check first", "/worktrees/" in skill)
    check("Merge: verification precedes merge",
          "before the merge, not after" in skill)
    check("Merge: forbids red merge and explains why",
          "Do not merge on a red check" in skill and "bisect" in skill)
    check("Merge: delegates commit format to gitrules", "`gitrules`" in skill)

    # (6) boundary
    skills_dir = os.path.dirname(ROOT)
    named = set(re.findall(r"`([a-z][a-z-]{2,})`\s*skill", skill))
    missing = [n for n in named if not os.path.isdir(os.path.join(skills_dir, n))]
    check("Boundary: handoff target population is nonempty", len(named) >= 3, f"{sorted(named)}")
    check("Boundary: every handoff target exists", not missing, f"missing {missing}")

    # (7) Language policy
    check("Language: description has Korean triggers",
          all(term in fm for term in ("검증", "PR 전 점검")))
    check("Language: description has English triggers",
          "fresh evidence" in fm and "repeat-failing checks" in fm)

    # (8) diff coverage — replacement for discarded absolute criticality
    check("Gate: diff coverage section exists", "diff coverage" in skill)
    check("Gate: explains how lowering disables an absolute threshold",
          "gets switched off" in skill and "lowering" in skill)
    check("Gate: leaves untouched legacy files outside the rule",
          "untouched legacy files are outside the rule" in skill)
    check("Gate: table provides commands by language",
          "| Language | Diff coverage command |" in skill
          and "diff-cover" in skill)
    check("Gate: coverage is not proof and is paired with red_probe",
          "Diff coverage is a floor, not a proof" in skill
          and "scripts/red_probe.py" in skill)

    # (9) No orphans — all references and scripts are called from the text.
    owned = sorted(
        [f"references/{n}" for n in os.listdir(os.path.join(ROOT, "references"))
         if n.endswith(".md")]
        + [f"scripts/{n}" for n in os.listdir(os.path.join(ROOT, "scripts"))
           if n.endswith(".py")])
    orphans = [rel for rel in owned if rel not in skill]
    check("References: no orphan references or scripts", not orphans, f"orphans {orphans}")
    check("References: owned-file table exists", "| File | Read or run it when |" in skill)



def main():
    fm, skill = split_frontmatter(read(os.path.join(ROOT, "SKILL.md")))

    skill_prose_checks(fm, skill)
    flat = re.sub(r"\s+", " ", skill)
    check("Scope: affected checks are the default",
          "affected checks are the default scope" in flat)
    check("Scope: does not run every repository check by default",
          "Do not run unrelated suites merely because the repository owns them" in flat
          and "run every check the repository owns" not in flat)
    check("Scope: shared contract expands to known consumer suites",
          "requires every consumer suite named by that contract" in flat)
    check("Scope: release claim requires full package and release gates",
          "requires the full package and release gates" in flat)
    check("Scope: report records selected scope and rationale",
          "Record which scope applied and why" in flat)

    # (10) Script Actions — Measure by Execution, Not Prose
    tmp = tempfile.mkdtemp(prefix="verify-suite-")
    try:
        preflight_checks(tmp)
        preflight_hardening(tmp)
        package_check_checks(tmp)
        package_check_hardening(tmp)
        red_probe_checks(tmp)
        red_probe_hardening(tmp)
        package_identity_checks(tmp)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    workflow_checks()

    # **needle is a sentence/table row unit.** The word needle survives direction reversal —
    # "A pipe hides the exit code" remains the same even if the next sentence is reversed,
    # Tables with swapped columns have the same bytes, so both volume and hash axes pass through. So the table is
    # Put **the entire line** as a literal, and for normative sentences, put the **whole sentence** as a literal.
    check_skill_body(check, ROOT, needles=SKILL_NEEDLES, floor=SKILL_FLOOR)

    check_ref_contracts(check, ROOT, REF_CONTRACTS)

    # **Line order axis.** Looking at the order of the three axes (needle, volume, survival rate) of the shared helper is
    # It's just a survival rate, and it doesn't run outside of git — the Marketplace installer and all
    # The environment is a deleted or altered copy. Documents with **all lines reversed** on the spot
    # Since the bytes are the same, the volume, hash, and needle also pass through. Procedures/provisions documents are in order
    # Since this is the content, the anchor sequence is embedded in the sweet source and locked regardless of the environment.
    for fn, _desc, _needles, _floor in REF_CONTRACTS:
        check_doc_order(f"Reference contract: {fn} section order is preserved",
                        read(os.path.join(ROOT, "references", fn)), ANCHORS_OF[fn])

    # The lower bound is the actual value — the number of tests that actually break when that script is emptied.
    # Checks that expect rc==0 pass even in empty scripts, so they are not included in this number.
    # A prefix that does not appear in the copy. **Use a list with the same coefficients on both sides** — Except for one side
    # The difference becomes a free margin and misses the real extinction.
    ENV_DEPENDENT = ("자기검사:", "계약 커버리지:", "스크립트 계약:")
    # **Counted before `check_script_contracts`.** The axis also counts extinction with `live_ran`.
    # As you can see, if the result you entered is mixed with the standard number, it does not contrast with the copy.
    live_ran = sum(1 for r in results if not r[0].startswith(ENV_DEPENDENT))
    check_script_contracts(check, __file__, ROOT,
                           scripts={"scripts/preflight.py": PREFLIGHT_FLOOR,
                                    "scripts/package_check.py": PKGCHECK_FLOOR,
                                    "scripts/package_identity.py": PACKAGE_IDENTITY_FLOOR,
                                    "scripts/red_probe.py": REDPROBE_FLOOR,
                                    "scripts/workflow.py": WORKFLOW_FLOOR},
                           live_ran=live_ran)
    check_contract_coverage(check, __file__, ROOT, per_file={
        "SKILL.md": SKILL_MIN,
        "references/claim-labels.md": CLAIM_MIN,
        "references/digest-contract.md": DIGEST_MIN,
        "references/merge.md": MERGE_MIN,
        "references/self-check.md": SELF_CHECK_MIN,
        "references/local-feedback.md": 3,
        "references/validation-cost.md": 3,
        "references/security-verification.md": 4,
        "references/defending-code-upstream.md": 4,
        "scripts/preflight.py": PREFLIGHT_FLOOR,
        "scripts/package_check.py": PKGCHECK_FLOOR,
        "scripts/package_identity.py": PACKAGE_IDENTITY_FLOOR,
        "scripts/red_probe.py": REDPROBE_FLOOR,
        "scripts/workflow.py": WORKFLOW_FLOOR,
    }, live_ran=live_ran)
    check_body_deletion(check, __file__, ROOT, minimum=SKILL_MIN,
                        live_ran=live_ran)
    check_no_constant_assertions(check, __file__)
    check_total(check, results, TOTAL)

    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n{passed}/{len(results)} 통과")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
