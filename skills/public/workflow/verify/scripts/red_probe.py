#!/usr/bin/env python3
"""RED proof: determine whether a verification command can fail.

A passing test does not prove that the test detects defects; an always-passing
test is also green. Copy the tree, run the command on the unchanged baseline,
apply an explicit mutation, and rerun the same command. The command supplies
evidence only when the mutation changes the tree and changes the exit status.

Procedure:
    1. Copy the tree to a temporary directory.
    2. Run the command unchanged; it must equal `--expect-rc`.
    3. Apply the mutation; it must change real bytes.
    4. Run the same command; its exit status must now differ.

An already-red baseline and a no-op mutation are unexecutable checks, not passes.

Usage:
    red_probe.py --tree DIR --command "python3 tests/run_tests.py" \\
                 --mutate "src/calc.py:return a + b->return a - b" \\
                 [--mutate ...] [--expect-rc 0] [--timeout 300] [--json]

Mutation syntax is `<relative-path>:<old>-><new>`. An empty replacement deletes
the old text. The first colon separates the path.

Exit codes:
    0  RED proven: the mutation made the command fail.
    1  RED unproven: the command still passed after mutation.
    2  Unexecutable: bad baseline, no-op mutation, or missing tree/path.
"""
from __future__ import annotations

import argparse
import json
import os
import shlex
import shutil
import subprocess
import sys
import tempfile

EXIT_RED_PROVEN, EXIT_RED_UNPROVEN, EXIT_UNRUNNABLE = 0, 1, 2


def parse_mutation(spec):
    """Parse `path:old->new`; malformed input raises ValueError."""
    path, sep, rest = spec.partition(":")
    if not sep or not path:
        raise ValueError(f"invalid mutation syntax; missing path colon: {spec}")
    old, sep, new = rest.partition("->")
    if not sep or not old:
        raise ValueError(f"invalid mutation syntax; missing `->`: {spec}")
    return path, old, new


def apply_mutation(root, path, old, new):
    """Return `(applied, reason)`; missing file or text is not applied."""
    p = os.path.join(root, path)
    if not os.path.isfile(p):
        return False, f"mutation target does not exist: {path}"
    with open(p, encoding="utf-8", errors="surrogateescape") as f:
        text = f.read()
    if old not in text:
        return False, f"search text {path} is not present in  {old[:60]!r}"
    with open(p, "w", encoding="utf-8", errors="surrogateescape") as f:
        f.write(text.replace(old, new, 1))
    return True, ""


def run(command, cwd, timeout):
    """Return `(rc, output tail)` without a pipeline that could mask exit status."""
    try:
        env = os.environ.copy()
        # A RED probe must exercise the mutated source, never a bytecode cache
        # left by the baseline run.  This is deliberately combined with cache
        # removal in ``invalidate_bytecode``: PYTHONDONTWRITEBYTECODE alone
        # does not stop Python from reading an existing valid pyc.
        env["PYTHONDONTWRITEBYTECODE"] = "1"
        r = subprocess.run(shlex.split(command), cwd=cwd, env=env,
                           capture_output=True, text=True, timeout=timeout)
    except FileNotFoundError as e:
        return None, str(e)
    except subprocess.TimeoutExpired:
        return None, f"timed out ({timeout}s)"
    tail = (r.stdout + r.stderr).strip().splitlines()[-3:]
    return r.returncode, "\n".join(tail)


def invalidate_bytecode(root):
    """Remove every Python cache in the disposable tree after mutation."""
    removed = 0
    for dirpath, dirnames, filenames in os.walk(root, topdown=True):
        dirnames[:] = [d for d in dirnames if d != ".git"]
        if os.path.basename(dirpath) == "__pycache__":
            shutil.rmtree(dirpath, ignore_errors=True)
            removed += 1
            dirnames[:] = []
            continue
        for name in filenames:
            if name.endswith((".pyc", ".pyo")):
                try:
                    os.unlink(os.path.join(dirpath, name))
                    removed += 1
                except FileNotFoundError:
                    pass
    return removed


def probe(tree, command, mutations, expect_rc=0, timeout=300):
    """Return `(exit code, report dict)`."""
    report = {"tree": tree, "command": command, "expect_rc": expect_rc,
              "mutations": mutations}
    if not os.path.isdir(tree):
        report["error"] = f"tree does not exist: {tree}"
        return EXIT_UNRUNNABLE, report

    work = tempfile.mkdtemp(prefix="red-probe-")
    dst = os.path.join(work, os.path.basename(os.path.abspath(tree)) or "tree")
    try:
        shutil.copytree(tree, dst, symlinks=True,
                        ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))

        base_rc, base_tail = run(command, dst, timeout)
        report["baseline_rc"] = base_rc
        report["baseline_tail"] = base_tail
        if base_rc != expect_rc:
            report["error"] = (
                f"baseline returned {base_rc}, expected {expect_rc}. "
                "cannot measure RED with an already-failing command")
            return EXIT_UNRUNNABLE, report

        applied = []
        for spec in mutations:
            try:
                path, old, new = parse_mutation(spec)
            except ValueError as e:
                report["error"] = str(e)
                return EXIT_UNRUNNABLE, report
            ok, why = apply_mutation(dst, path, old, new)
            if not ok:
                # A no-op mutation is not a pass. Passing on an unchanged tree says nothing
                # about whether the command can detect a defect.
                report["error"] = why
                return EXIT_UNRUNNABLE, report
            applied.append({"path": path, "old": old, "new": new})
        if not applied:
            report["error"] = "no mutation was applied; specify what should change"
            return EXIT_UNRUNNABLE, report
        report["applied"] = applied
        report["bytecode_removed"] = invalidate_bytecode(dst)

        mut_rc, mut_tail = run(command, dst, timeout)
        report["mutated_rc"] = mut_rc
        report["mutated_tail"] = mut_tail
        if mut_rc is None:
            report["error"] = f"could not run command after mutation: {mut_tail}"
            return EXIT_UNRUNNABLE, report
        if mut_rc == expect_rc:
            report["verdict"] = (
                "RED unproven: the command returned the same exit status after mutation. "
                "This command does not demonstrate that the deliverable is correct.")
            return EXIT_RED_UNPROVEN, report
        report["verdict"] = f"RED proven: mutation changed exit status to {mut_rc}"
        return EXIT_RED_PROVEN, report
    finally:
        shutil.rmtree(work, ignore_errors=True)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Prove that a verification command can fail")
    ap.add_argument("--tree", required=True)
    ap.add_argument("--command", required=True)
    ap.add_argument("--mutate", action="append", default=[],
                    help="<relative-path>:<old>-><new>")
    ap.add_argument("--expect-rc", type=int, default=0)
    ap.add_argument("--timeout", type=int, default=300)
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)

    rc, report = probe(a.tree, a.command, a.mutate, a.expect_rc, a.timeout)
    if a.json:
        print(json.dumps(report, ensure_ascii=False, indent=1))
    else:
        print(f"red_probe · {a.command}")
        print(f"  baseline rc={report.get('baseline_rc')} "
              f"· mutated rc={report.get('mutated_rc')}")
        if "error" in report:
            print(f"[UNRUNNABLE] {report['error']}")
        else:
            print(("[PASS] " if rc == EXIT_RED_PROVEN else "[FAIL] ")
                  + report.get("verdict", ""))
    return rc


if __name__ == "__main__":
    sys.exit(main())
