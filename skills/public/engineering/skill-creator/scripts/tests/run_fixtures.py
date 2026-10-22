#!/usr/bin/env python3
"""validate_plugin.sh fixture suite: prove that the validator can fail.

## Why negative fixtures

An earlier validator invoked ten checks, ignored every return value, and always
printed success. A run that printed `[FAIL] Invalid name format` exited zero. Adding
checks to such a gate changes nothing, so this suite asks whether seeded defects fail.

## Three axes

1. `fixtures/negative/*`: plugins with one seeded defect. Each must return rc 1
   with the expected failure count and reason. Any pass exposes a dead check.
2. `fixtures/positive/good-plugin`: a valid plugin. It must return rc 0 after
   measuring a nonzero number of checks. Measuring zero is not a pass.
3. Mutation: rerun fixtures against a copy where one check is a no-op. If every
   fixture remains green, that function enforces nothing and the suite fails.

Run from the skill root: `python3 scripts/tests/run_fixtures.py`
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SCRIPT = os.path.join(os.path.dirname(HERE), "validate_plugin.sh")
FIXTURES = os.path.join(HERE, "fixtures")

results: list[tuple[str, bool, str]] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    results.append((label, bool(ok), detail))
    print(
        f"{'[ok]  ' if ok else '[FAIL]'} {label}"
        + (f"  — {detail}" if not ok and detail else "")
    )


def run(*args: str, script: str = SCRIPT) -> tuple[int, str]:
    proc = subprocess.run(["bash", script, *args], capture_output=True, text=True)
    return proc.returncode, proc.stdout + proc.stderr


def summary_counts(out: str) -> tuple[int, int] | None:
    """Parse (total checks, failures) from the summary line, or return None."""
    hit = re.search(r"\[FAIL\] (\d+) checks, (\d+) failed", out)
    if hit:
        return int(hit.group(1)), int(hit.group(2))
    hit = re.search(r"\[OK\] Passed: (\d+) checks", out)
    if hit:
        return int(hit.group(1)), 0
    return None


# (fixture name, expected failures, required reason fragment, extra arguments)
NEGATIVE: list[tuple[str, int, str, list[str]]] = [
    ("broken-manifest", 1, "not valid JSON", []),
    ("manifest-name-mismatch", 1, "directory name", []),
    ("skill-no-frontmatter", 1, "frontmatter is missing", []),
    ("skill-name-mismatch", 1, "directory name", []),
    ("skill-empty-description", 1, "description is empty", []),
    ("skill-colon-description", 1, "not valid YAML", []),
    ("skills-dir-empty", 1, "no skills", []),
    ("command-empty-description", 1, "description is empty", []),
    ("command-null-description", 1, "description is empty", []),
    ("command-empty-file", 1, "command file is empty", []),
    ("command-fence-not-first", 1, "frontmatter fence is malformed", []),
    ("agent-name-mismatch", 1, "filename", []),
    ("hook-script-missing", 1, "hook script is missing", []),
    ("hooks-dir-no-manifest", 1, "hooks/hooks.json is missing", []),
    ("two-failures", 2, "name('delta')", []),
    (
        "unregistered",
        1,
        "does not list",
        [
            "--marketplace",
            os.path.join(FIXTURES, "negative", "unregistered", "marketplace.json"),
        ],
    ),
]


def negative_verdicts(script: str = SCRIPT) -> list[tuple[str, bool, str]]:
    """Return (name, rejected, observation) for every negative fixture."""
    seen = []
    for name, want_fails, needle, extra in NEGATIVE:
        path = os.path.join(FIXTURES, "negative", name)
        rc, out = run(*extra, path, script=script)
        counts = summary_counts(out)
        ok = (
            rc == 1 and counts is not None and counts[1] == want_fails and needle in out
        )
        note = f"rc={rc} counts={counts}"
        if (
            rc == 1
            and counts is not None
            and counts[1] == want_fails
            and needle not in out
        ):
            note += f" reason missing {needle!r}"
        seen.append((name, ok, note))
    return seen


def mutant(fn: str) -> str:
    """Return a copied validator with one check replaced by a no-op."""
    with open(SCRIPT, encoding="utf-8") as fh:
        text = fh.read()
    head, sep, tail = text.rpartition("\nmain\n")
    assert sep, "could not find the `main` call after MUTATION_POINT"
    if fn == "fail":
        # Print without counting, reproducing the validator's former behavior.
        override = 'fail() { echo "[FAIL] $1"; }'
    else:
        override = f"{fn}() {{ :; }}"
    handle, path = tempfile.mkstemp(prefix="validate_plugin_mutant_", suffix=".sh")
    with os.fdopen(handle, "w", encoding="utf-8") as fh:
        fh.write(head + "\n" + override + "\nmain\n" + tail)
    return path


MUTANTS = [
    "check_manifest",
    "check_skills",
    "check_commands",
    "check_agents",
    "check_hooks",
    "check_marketplace",
    "fail",
]


def main() -> int:
    if not os.path.isfile(SCRIPT):
        print(f"[FAIL] validator missing: {SCRIPT}")
        return 1

    # --- Axis 1: negative fixtures ---
    verdicts = negative_verdicts()
    for name, ok, note in verdicts:
        check(f"reject: {name}", ok, note)
    # Lock the fixture count itself. Removing an entry would leave every remaining
    # fixture passing while silently shrinking this axis.
    check(
        f"negative fixture count is {len(NEGATIVE)}",
        len(NEGATIVE) >= 16 and len(verdicts) == len(NEGATIVE),
        f"{len(verdicts)} fixtures",
    )
    on_disk = sorted(
        d
        for d in os.listdir(os.path.join(FIXTURES, "negative"))
        if os.path.isdir(os.path.join(FIXTURES, "negative", d))
    )
    check(
        "negative fixtures on disk match the list",
        on_disk == sorted(n for n, _, _, _ in NEGATIVE),
        f"disk {on_disk}",
    )

    # --- Axis 2: valid plugin ---
    rc, out = run(os.path.join(FIXTURES, "positive", "good-plugin"))
    counts = summary_counts(out)
    check("pass: good-plugin returns rc 0", rc == 0, f"rc={rc}")
    check(
        "pass: summary reports a nonzero measured check count",
        counts is not None and counts[0] >= 6 and counts[1] == 0,
        f"counts={counts}",
    )
    check(
        "pass: all four layers were counted",
        "skills 1, commands 3, agents 1, hook scripts 1" in out,
        out.strip().splitlines()[-1] if out.strip() else "",
    )
    check(
        "pass: undescribed commands are named in an INFO notice",
        "[INFO] commands without a description are not listed to the model" in out
        and "commands/hint-only.md, commands/menu-only.md" in out
        and "commands/do-thing.md," not in out,
        out,
    )
    rc, out = run(os.path.join(FIXTURES, "positive", "typo-key-plugin"))
    check(
        "pass: a misspelled description key passes with a WARN and the INFO notice",
        rc == 0
        and "[WARN] commands/typo.md — frontmatter key 'desciption'" in out
        and "first body line: commands/typo.md" in out,
        out,
    )

    # --- Axis 3: distinguish unmeasured/absent from pass ---
    rc, out = run(os.path.join(FIXTURES, "edge", "no-manifest"))
    check("directory without a manifest returns rc 3, not 0", rc == 3, f"rc={rc}")
    check(
        "directory without a manifest reports that it measured nothing",
        "measured zero checks" in out,
        out.strip()[-60:],
    )
    rc, _ = run("--nope", os.path.join(FIXTURES, "positive", "good-plugin"))
    check("unknown flag returns rc 2", rc == 2, f"rc={rc}")
    rc, _ = run(
        os.path.join(FIXTURES, "positive", "good-plugin"), os.path.join(FIXTURES)
    )
    check("two positional arguments return rc 2", rc == 2, f"rc={rc}")
    rc, _ = run(os.path.join(FIXTURES, "no-such-directory"))
    check("missing directory returns rc 2", rc == 2, f"rc={rc}")
    rc, _ = run("--marketplace")
    check("--marketplace without a value returns rc 2", rc == 2, f"rc={rc}")

    # --- Axis 4: fixtures detect a disabled check ---
    for fn in MUTANTS:
        path = mutant(fn)
        try:
            caught = [name for name, ok, _ in negative_verdicts(script=path) if not ok]
        finally:
            os.unlink(path)
        check(
            f"mutation detected: {fn} becomes red when replaced by a no-op",
            bool(caught),
            "no fixture detected the mutation; this check enforces nothing",
        )

    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n{passed}/{len(results)} passed")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
