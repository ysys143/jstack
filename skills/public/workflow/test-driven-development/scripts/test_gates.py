#!/usr/bin/env python3
"""TDD gate checker — turns prose requirements into machine decisions.

The two rules in this skill were long **honor-system rules**. “New code must be covered
by tests” and “obtain approval twice before generating code” existed only in documentation,
so violating them changed nothing. A rule with no enforcement mechanism is advice.

    diff-coverage   measure coverage of newly added lines; return rc 1 below the floor
    approvals       require two approvals in TEST_PLAN.md; return rc 1 when absent

## Why diff coverage instead of absolute coverage

An absolute percentage holds legacy debt hostage. A repository at 43% cannot make one PR
reach 80%, so the gate is soon disabled; a disabled gate is no gate. Tests that saw red
should already cover newly added lines, so measuring only those lines preserves enforcement
without holding the debt hostage.

## Input

The diff is the output of `git diff -U0 $(git merge-base origin/main HEAD)...HEAD`.
Coverage accepts four formats — LCOV (`lcov.info`), Go coverprofile (`cover.out`),
Cobertura XML (`coverage.xml`), and JaCoCo XML (`jacoco.xml`). The format is detected by content.

## Exit codes

    0  pass (or no executable new lines)
    1  below the gate floor
    2  input error (missing file or unknown format)
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import xml.etree.ElementTree as ET

sys.dont_write_bytecode = True

# A change with no executable new lines **passes**.
# Dropping comment/config-only PRs to 0% would make the gate ignored within a week.
NO_NEW_LINES_RC = 0


# ---------------------------------------------------------------- diff parsing

HUNK = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@")


def parse_diff(text):
    """Extract only **new-side line numbers** from a unified diff: {path: {line numbers}}."""
    added = {}
    path = None
    lineno = 0
    for line in text.splitlines():
        if line.startswith("+++ "):
            raw = line[4:].strip()
            raw = raw.split("\t")[0]
            if raw == "/dev/null":
                path = None
            else:
                path = raw[2:] if raw.startswith(("a/", "b/")) else raw
                added.setdefault(path, set())
            continue
        if line.startswith("--- "):
            continue
        m = HUNK.match(line)
        if m:
            lineno = int(m.group(1))
            continue
        if path is None:
            continue
        if line.startswith("+"):
            added[path].add(lineno)
            lineno += 1
        elif line.startswith("-"):
            continue
        elif line.startswith(" ") or line == "":
            lineno += 1
    return {p: s for p, s in added.items() if s}


# ------------------------------------------------------------ coverage parsing


def parse_lcov(text):
    cov, cur = {}, None
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("SF:"):
            cur = line[3:]
            cov.setdefault(cur, {})
        elif line.startswith("DA:") and cur is not None:
            body = line[3:].split(",")
            if len(body) >= 2:
                cov[cur][int(body[0])] = int(body[1])
        elif line == "end_of_record":
            cur = None
    return cov


GO_BLOCK = re.compile(r"^(.+):(\d+)\.\d+,(\d+)\.\d+ \d+ (\d+)$")


def parse_go_profile(text):
    """Go coverprofile — assign each block's execution count to every line in its range."""
    cov = {}
    for line in text.splitlines():
        m = GO_BLOCK.match(line.strip())
        if not m:
            continue
        path, start, end, count = m.group(1), int(m.group(2)), int(m.group(3)), int(m.group(4))
        d = cov.setdefault(path, {})
        for n in range(start, end + 1):
            d[n] = max(d.get(n, 0), count)
    return cov


def parse_cobertura(root):
    cov = {}
    for cls in root.iter("class"):
        fn = cls.get("filename")
        if not fn:
            continue
        d = cov.setdefault(fn, {})
        for ln in cls.iter("line"):
            n, h = ln.get("number"), ln.get("hits")
            if n is not None and h is not None:
                d[int(n)] = max(d.get(int(n), 0), int(h))
    return cov


def parse_jacoco(root):
    cov = {}
    for pkg in root.iter("package"):
        prefix = (pkg.get("name") or "").strip("/")
        for src in pkg.iter("sourcefile"):
            name = src.get("name")
            if not name:
                continue
            key = f"{prefix}/{name}" if prefix else name
            d = cov.setdefault(key, {})
            for ln in src.iter("line"):
                nr, ci = ln.get("nr"), ln.get("ci")
                if nr is not None and ci is not None:
                    d[int(nr)] = max(d.get(int(nr), 0), int(ci))
    return cov


def parse_coverage(text):
    """Detect the format by **content**. Do not trust extensions; CI names them differently."""
    head = text.lstrip()
    if head.startswith("<"):
        root = ET.fromstring(text)
        if root.tag == "report" or root.find(".//sourcefile") is not None:
            return parse_jacoco(root), "jacoco"
        return parse_cobertura(root), "cobertura"
    if head.startswith("mode:"):
        return parse_go_profile(text), "go"
    if "SF:" in text:
        return parse_lcov(text), "lcov"
    raise ValueError("cannot detect coverage format (lcov · go · cobertura · jacoco)")


# ------------------------------------------------------------- path matching


def _parts(p):
    return [x for x in p.replace("\\", "/").split("/") if x and x != "."]


def match_path(diff_path, cov_paths):
    """Choose the item with the longest **common suffix path**.

    Coverage report paths are often not relative to the repository root: Go adds a module
    path, JaCoCo gives only a package path, and Maven omits the module directory. Without
    suffix matching, normal reports all become unmatched and the gate becomes meaningless.
    """
    dp = _parts(diff_path)
    best, best_len = None, 0
    for cp in cov_paths:
        cq = _parts(cp)
        n = 0
        while n < len(dp) and n < len(cq) and dp[-1 - n] == cq[-1 - n]:
            n += 1
        if n > best_len:
            best, best_len = cp, n
    return best if best_len else None


# ------------------------------------------------------------ diff-coverage


def cmd_diff_coverage(args):
    diff_text = sys.stdin.read() if args.diff == "-" else _read(args.diff)
    cov_text = _read(args.coverage)
    added = parse_diff(diff_text)
    if not added:
        print("[SKIP] no lines were added by the diff — pass")
        return NO_NEW_LINES_RC
    try:
        cov, fmt = parse_coverage(cov_text)
    except (ValueError, ET.ParseError) as e:
        print(f"[ERROR] {e}", file=sys.stderr)
        return 2

    report_exts = {os.path.splitext(p)[1] for p in cov}
    total = covered = 0
    missing_lines = {}
    unmeasured = []

    for path in sorted(added):
        key = match_path(path, cov)
        if key is None:
            if os.path.splitext(path)[1] in report_exts:
                unmeasured.append(path)
            continue
        lines = cov[key]
        for n in sorted(added[path]):
            if n not in lines:
                continue  # not an executable line (comment, declaration, or blank line)
            total += 1
            if lines[n] > 0:
                covered += 1
            else:
                missing_lines.setdefault(path, []).append(n)

    print(f"[INFO] coverage format: {fmt} · changed files {len(added)}")

    if unmeasured and not args.allow_unmeasured:
        for p in unmeasured:
            print(f"[FAIL] {p} is absent from the coverage report — it was never measured")
        print(
            "[FAIL] new source is absent from the report "
            "(use --allow-unmeasured if intentional)"
        )
        return 1
    for p in unmeasured:
        print(f"[WARN] {p} is unmeasured — allowed with --allow-unmeasured")

    if total == 0:
        print("[PASS] no executable new lines — pass")
        return NO_NEW_LINES_RC

    pct = 100.0 * covered / total
    for p, ns in sorted(missing_lines.items()):
        print(f"[MISS] {p}: {_ranges(ns)}")
    verdict = "PASS" if pct >= args.fail_under else "FAIL"
    print(
        f"[{verdict}] diff coverage {pct:.1f}% "
        f"({covered}/{total} new lines, floor {args.fail_under:.1f}%)"
    )
    return 0 if pct >= args.fail_under else 1


def _ranges(ns):
    out, start, prev = [], ns[0], ns[0]
    for n in ns[1:]:
        if n == prev + 1:
            prev = n
            continue
        out.append(f"{start}" if start == prev else f"{start}-{prev}")
        start = prev = n
    out.append(f"{start}" if start == prev else f"{start}-{prev}")
    return ",".join(out)


# --------------------------------------------------------------- approvals

PLACEHOLDERS = ("tbd", "todo", "undecided", "미정", "<name>", "-", "n/a", "none", "없음")
SCENARIO_MARK = "Scenario-Approved-By:"
CASE_MARK = "Case-Approved-By:"


def cmd_approvals(args):
    text = _read(args.plan)
    ok = True

    if not re.search(r"(?m)^\|?\s*TS-\d+", text):
        print("[FAIL] no scenario row (TS-NNN)")
        ok = False
    if not re.search(r"(?m)^\|?\s*TC-\d+", text):
        print("[FAIL] no test-case row (TC-NNN)")
        ok = False

    pos = {}
    for mark, label in ((SCENARIO_MARK, "scenario"), (CASE_MARK, "case")):
        m = re.search(re.escape(mark) + r"(.*)", text)
        if m is None:
            print(f"[FAIL] no {label} approval record — `{mark} <name> <date>`")
            ok = False
            continue
        value = m.group(1).strip()
        if not value or value.lower() in PLACEHOLDERS:
            print(f"[FAIL] {label} approval is a placeholder: {value!r}")
            ok = False
            continue
        pos[mark] = m.start()

    if SCENARIO_MARK in pos and CASE_MARK in pos:
        if pos[CASE_MARK] < pos[SCENARIO_MARK]:
            print("[FAIL] case approval precedes scenario approval — order is a gate")
            ok = False

    print("[PASS] two approvals are recorded" if ok else "[FAIL] approval gate not met")
    return 0 if ok else 1


# -------------------------------------------------------------------- main


def _read(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


def main(argv=None):
    ap = argparse.ArgumentParser(description="TDD gate checker")
    sub = ap.add_subparsers(dest="cmd", required=True)

    d = sub.add_parser("diff-coverage", help="new-line coverage gate")
    d.add_argument("--diff", required=True, help="unified diff file (- means stdin)")
    d.add_argument("--coverage", required=True, help="lcov · go · cobertura · jacoco")
    d.add_argument("--fail-under", type=float, default=90.0)
    d.add_argument("--allow-unmeasured", action="store_true",
                   help="do not fail for new source absent from the report")
    d.set_defaults(fn=cmd_diff_coverage)

    a = sub.add_parser("approvals", help="check two approvals in TEST_PLAN.md")
    a.add_argument("--plan", required=True)
    a.set_defaults(fn=cmd_approvals)

    args = ap.parse_args(argv)
    try:
        return args.fn(args)
    except FileNotFoundError as e:
        print(f"[ERROR] file not found: {e.filename}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
