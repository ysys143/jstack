#!/usr/bin/env python3
"""Measure the three contract files and their matching root documents.

Usage: python3 tests/test_contracts.py (from the built runtime).

## What this locks

Contract files are dangerous because they are **declarations**. Code crashes when
wrong, but declarations stay quiet when a field or referenced test disappears, or
when a required executable becomes a document. Every check here is fail-closed:
**unknown means failure, not pass.**

1. **Four fields** — checks in `portable-contract.yaml` have id/mode/contexts/
   command. Empty contexts fail; an empty list looks present while running nowhere.
2. **Grades determine fields** — `claims.yaml` fails without `검증등급`. Only
   `기계` requires `tests`; its path must exist and command must invoke it.
3. **Do not require documents** — `change-impact.yaml` `require_all_changed`
   contains only `.py` and `.sh`; requiring `NOTICE.md` caused a prior revision to fail.
4. **Measure CHANGELOG by execution** — run `skills/verify/scripts/package_check.py`
   and inspect its exit code rather than a format needle.
5. **RED** — challenge each check. If a deleted-field copy is not caught, it is a tautology.

## YAML parsing

**Do not add dependencies.** The suite must run with `sys.executable` because the
floor comparator invokes it; an import error on a machine without PyYAML is a
broken suite, not fail-closed behavior.

Contract files therefore use a **restricted YAML subset** parsed here. The
restriction is part of the contract: reject tabs, trailing comments, anchors, and
complex flow syntax. Unsupported syntax fails immediately instead of silently
expanding the format.
"""
import json
import os
import re
import subprocess
import sys

sys.dont_write_bytecode = True
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "skills"))
from _suite_lib import check_no_constant_assertions, check_total  # noqa: E402

CONTRACTS = os.path.join(ROOT, "contracts")
PORTABLE = os.path.join(CONTRACTS, "portable-contract.yaml")
CLAIMS = os.path.join(CONTRACTS, "claims.yaml")
IMPACT = os.path.join(CONTRACTS, "change-impact.yaml")
CHANGELOG = os.path.join(ROOT, "CHANGELOG.md")
# **README was absent from this loop, so both plugins passed without one.**
# `CLAUDE.md` requires README in its plugin structure guide, but no checker measured
# it and two ledger disposition rows pointed to nonexistent files.
README = os.path.join(ROOT, "README.md")
PKG_CHECK = os.path.join(ROOT, "skills", "verify", "scripts", "package_check.py")
# **Canonical negative fixtures.** Do not copy them into root `tests/`: copies can
# diverge, leaving no way to know which is `/validate`'s source of truth.
FIXTURES = os.path.join(ROOT, "skills", "author", "scripts", "tests",
                        "fixtures", "negative")
AUTHOR_SUITE = os.path.join(ROOT, "skills", "author", "tests", "run_tests.py")

MANIFEST = os.path.join(ROOT, ".claude-plugin", "plugin.json")
VERSION_HEADING = re.compile(
    r"^#{1,3}\s*\[?v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\]?")

GRADES = ("기계", "인간 게이트", "검증불가", "미상")
GRADE_FIELD = {"기계": "tests", "인간 게이트": "증거",
               "검증불가": "사유", "미상": "사유"}
MODES = ("fail", "warn")
CONTEXTS = ("manual", "hook", "post-run")
RUNNABLE = (".py", ".sh")

results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))


def read(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


# ---------------------------------------------------------------- YAML subset

BLOCK = (">-", ">", "|", "|-")


def _rows(text):
    """Return (indentation, content, line number), dropping blank lines and **full-line comments**.

    Trailing comments are deliberately unsupported: `#` is valid in a `selector`,
    and accepting them would truncate that value. A truncated selector matches more
    easily and **silently weakens the check**.
    """
    out = []
    for n, raw in enumerate(text.splitlines(), 1):
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        if "\t" in raw:
            raise ValueError(f"line {n}: tab indentation is rejected")
        out.append((len(raw) - len(raw.lstrip()), raw.strip(), n))
    return out


def _scalar(s):
    s = s.strip()
    if len(s) >= 2 and s[0] == s[-1] and s[0] in "\"'":
        return s[1:-1]
    return s


def _flow(s):
    inner = s[1:-1].strip()
    return [_scalar(x) for x in inner.split(",") if x.strip()] if inner else []


def _join(rows, i, indent):
    """Join a block scalar body into one line. Return (value, next index)."""
    buf = []
    while i < len(rows) and rows[i][0] > indent:
        buf.append(rows[i][1])
        i += 1
    return " ".join(buf), i


def _node(rows, i, indent):
    if rows[i][1].startswith("- "):
        return _seq(rows, i, indent)
    return _map(rows, i, indent)


def _seq(rows, i, indent):
    seq = []
    while i < len(rows) and rows[i][0] == indent and rows[i][1].startswith("- "):
        head = rows[i][1][2:].strip()
        if head in BLOCK:
            i += 1
            val, i = _join(rows, i, indent)
            seq.append(val)
        elif head.startswith("[") and head.endswith("]"):
            seq.append(_flow(head))
            i += 1
        elif ":" in head and not head.startswith(("\"", "'")):
            sub = [(indent + 2, head, rows[i][2])]
            i += 1
            while i < len(rows) and rows[i][0] > indent:
                sub.append(rows[i])
                i += 1
            item, _ = _map(sub, 0, indent + 2)
            seq.append(item)
        else:
            seq.append(_scalar(head))
            i += 1
    return seq, i


def _map(rows, i, indent):
    out = {}
    while i < len(rows) and rows[i][0] == indent:
        line = rows[i][1]
        if line.startswith("- "):
            break
        if ":" not in line:
            raise ValueError(f"line {rows[i][2]}: expected a map — {line[:40]}")
        key, _, rest = line.partition(":")
        key, rest = key.strip(), rest.strip()
        if key in out:
            raise ValueError(f"line {rows[i][2]}: duplicate key — {key}")
        if rest in BLOCK:
            i += 1
            out[key], i = _join(rows, i, indent)
        elif rest.startswith("[") and rest.endswith("]"):
            out[key] = _flow(rest)
            i += 1
        elif rest:
            out[key] = _scalar(rest)
            i += 1
        else:
            i += 1
            if i < len(rows) and rows[i][0] > indent:
                out[key], i = _node(rows, i, rows[i][0])
            else:
                out[key] = None
    return out, i


def parse(text):
    rows = _rows(text)
    if not rows:
        raise ValueError("empty document")
    doc, i = _node(rows, 0, rows[0][0])
    if i != len(rows):
        raise ValueError(f"indentation breaks at line {rows[i][2]}")
    return doc


# ------------------------------------------------------------------- Validation functions

def _script_of(command):
    """Extract a script-path token from a command, or return None."""
    for tok in str(command).split():
        if tok.endswith(RUNNABLE):
            return tok
    return None


def portable_problems(doc):
    bad = []
    checks = doc.get("checks") or []
    if not checks:
        bad.append("checks is empty — a zero-check profile is not a profile")
    seen = set()
    for c in checks:
        cid = c.get("id") or "(unnamed)"
        for field in ("id", "mode", "contexts", "command"):
            if not c.get(field):
                bad.append(f"{cid}: missing {field}")
        if cid in seen:
            bad.append(f"{cid}: duplicate id")
        seen.add(cid)
        if c.get("mode") and c["mode"] not in MODES:
            bad.append(f"{cid}: mode outside {MODES} — {c['mode']}")
        ctx = c.get("contexts") or []
        if not isinstance(ctx, list) or not ctx:
            bad.append(f"{cid}: contexts is empty")
        else:
            for v in ctx:
                if v not in CONTEXTS:
                    bad.append(f"{cid}: contexts value {v} is not allowed")
    return bad


def portable_missing_scripts(doc, root):
    miss = []
    for c in doc.get("checks") or []:
        s = _script_of(c.get("command", ""))
        if s is None:
            miss.append(f"{c.get('id')}: command has no executable")
        elif not os.path.exists(os.path.join(root, s)):
            miss.append(f"{c.get('id')}: {s} is absent")
    return miss


def claims_problems(doc):
    bad = []
    schema = doc.get("schema") or {}
    allowed = schema.get("검증등급_허용값") or []
    for g in GRADES:
        if g not in allowed:
            bad.append(f"schema: grade {g} is undeclared")
    claims = doc.get("claims") or []
    if not claims:
        bad.append("claims is empty")
    seen = set()
    for c in claims:
        cid = c.get("id") or "(unnamed)"
        if cid in seen:
            bad.append(f"{cid}: duplicate id")
        seen.add(cid)
        for field in ("id", "주장", "검증등급", "source_refs"):
            if not c.get(field):
                bad.append(f"{cid}: missing {field}")
        grade = c.get("검증등급")
        if grade and grade not in GRADES:
            bad.append(f"{cid}: grade {grade} is not allowed")
        elif grade and not c.get(GRADE_FIELD[grade]):
            bad.append(f"{cid}: grade {grade} lacks {GRADE_FIELD[grade]}")
    return bad


def claims_binding(doc, root):
    """Check that `기계`-grade tests exist and commands invoke them."""
    bad, machine = [], 0
    for c in doc.get("claims") or []:
        if c.get("검증등급") != "기계":
            continue
        machine += 1
        for t in c.get("tests") or []:
            path, cmd = t.get("path"), t.get("command") or ""
            if not path:
                bad.append(f"{c.get('id')}: tests has no path")
                continue
            if not os.path.exists(os.path.join(root, path)):
                bad.append(f"{c.get('id')}: {path} is absent")
            if path not in cmd:
                bad.append(f"{c.get('id')}: command does not invoke {path}")
    return bad, machine


def claims_sources(doc, root):
    bad = []
    for c in doc.get("claims") or []:
        for ref in c.get("source_refs") or []:
            f, sel = ref.get("file"), ref.get("selector")
            full = os.path.join(root, f or "")
            if not f or not os.path.isfile(full):
                bad.append(f"{c.get('id')}: source {f} is absent")
                continue
            if not sel:
                bad.append(f"{c.get('id')}: {f} has no selector")
            elif sel not in read(full):
                bad.append(f"{c.get('id')}: {f} lacks selector `{sel}`")
    return bad


def impact_problems(doc):
    bad = []
    rules = doc.get("rules") or []
    if not rules:
        bad.append("rules is empty")
    seen = set()
    for r in rules:
        rid = r.get("id") or "(unnamed)"
        if rid in seen:
            bad.append(f"{rid}: duplicate id")
        seen.add(rid)
        for field in ("id", "when_changed", "require_all_changed", "verify"):
            if not r.get(field):
                bad.append(f"{rid}: missing {field}")
    return bad


def impact_requires_runnables(doc):
    """**Requiring a document passes with one blank space.** Reject that form."""
    bad = []
    for r in doc.get("rules") or []:
        for p in r.get("require_all_changed") or []:
            if not str(p).endswith(RUNNABLE):
                bad.append(f"{r.get('id')}: {p} is not an executable verifier")
    return bad


def impact_paths(doc, root):
    bad = []
    for r in doc.get("rules") or []:
        for p in r.get("require_all_changed") or []:
            if not os.path.exists(os.path.join(root, p)):
                bad.append(f"{r.get('id')}: required path {p} is absent")
        for p in r.get("when_changed") or []:
            if not os.path.exists(os.path.join(root, p)):
                bad.append(f"{r.get('id')}: when_changed path {p} is absent")
        s = _script_of(r.get("verify", ""))
        if s is None:
            bad.append(f"{r.get('id')}: verify has no executable")
        elif not os.path.exists(os.path.join(root, s)):
            bad.append(f"{r.get('id')}: verify {s} is absent")
    return bad


def table_rows(text):
    """Return Markdown data rows only, excluding separators and headers."""
    rows = []
    for line in text.splitlines():
        s = line.strip()
        if not s.startswith("|") or not s.endswith("|"):
            continue
        cells = [c.strip() for c in s[1:-1].split("|")]
        if all(set(c) <= set("-: ") and c for c in cells):
            continue
        rows.append(cells)
    return rows


# ----------------------------------------------------------------------- Main suite

def main():
    for label, path in (("portable-contract.yaml", PORTABLE),
                        ("claims.yaml", CLAIMS),
                        ("change-impact.yaml", IMPACT),
                        ("CHANGELOG.md", CHANGELOG),
                        ("README.md", README)):
        check(f"File: {label} exists", os.path.isfile(path), path)

    docs = {}
    for label, path in (("portable", PORTABLE), ("claims", CLAIMS),
                        ("impact", IMPACT)):
        try:
            docs[label] = parse(read(path))
            err = ""
        except (OSError, ValueError) as e:
            docs[label] = {}
            err = str(e)
        check(f"Format: {label} parses as restricted YAML", not err, err[:100])

    pdoc, cdoc, idoc = docs["portable"], docs["claims"], docs["impact"]

    check("portable: profile name is portable",
          pdoc.get("profile") == "portable", str(pdoc.get("profile")))
    pb = portable_problems(pdoc)
    check("portable: every check has id, mode, contexts, and command",
          not pb, "; ".join(pb)[:160])
    pm = portable_missing_scripts(pdoc, ROOT)
    check("portable: every command executable exists",
          not pm, "; ".join(pm)[:160])
    hooked = [c for c in pdoc.get("checks") or [] if "hook" in (c.get("contexts") or [])]
    check("portable: at least one check has hook context",
          len(hooked) >= 1, f"{len(hooked)} items")

    cb = claims_problems(cdoc)
    check("claims: grade-specific required fields are respected", not cb, "; ".join(cb)[:200])
    bind, machine = claims_binding(cdoc, ROOT)
    check("claims: machine-grade tests exist and commands invoke them",
          not bind, "; ".join(bind)[:200])
    check("claims: at least one machine-grade claim exists — total exemption is not exemption",
          machine >= 1, f"{machine} items")
    cs = claims_sources(cdoc, ROOT)
    check("claims: source files exist and contain their selectors",
          not cs, "; ".join(cs)[:200])
    verifier_claim = next((claim for claim in cdoc.get("claims", [])
                           if claim.get("id") == "verifier-takes-no-executor-rationale"), {})
    check("claims: verifier input claim binds its independence boundary",
          any(ref.get("file") == "agents/quality-verifier.md" and
              ref.get("selector") == "Do not receive the executor's"
              for ref in verifier_claim.get("source_refs", [])))
    graded = [c for c in cdoc.get("claims") or []
              if c.get("검증등급") in ("검증불가", "미상")]
    check("claims: at least one unmeasurable claim is marked as such",
          len(graded) >= 1, f"{len(graded)} items")

    ib = impact_problems(idoc)
    check("impact: every rule has id, when_changed, require_all_changed, and verify",
          not ib, "; ".join(ib)[:200])
    ir = impact_requires_runnables(idoc)
    check("impact: required items are executable verifiers, not documents",
          not ir, "; ".join(ir)[:200])
    ip = impact_paths(idoc, ROOT)
    check("impact: all when_changed, require, and verify paths exist",
          not ip, "; ".join(ip)[:200])
    selfref = [r for r in idoc.get("rules") or []
               if "contracts/claims.yaml" in (r.get("when_changed") or [])]
    check("impact: changes to the contract files trigger a rule",
          len(selfref) >= 1, f"{len(selfref)} items")

    r = subprocess.run([sys.executable, PKG_CHECK, ROOT],
                       capture_output=True, text=True)
    check("CHANGELOG: package_check returns 0 (top-level <-> plugin.json)",
          r.returncode == 0, (r.stdout + r.stderr).strip().splitlines()[-1][:120]
          if (r.stdout + r.stderr).strip() else f"rc={r.returncode}")
    cl = read(CHANGELOG) if os.path.isfile(CHANGELOG) else ""
    top = None
    for line in cl.splitlines():
        if re.match(r"^#{1,3}\s*\[?Unreleased\]?", line, re.I):
            continue
        m = VERSION_HEADING.match(line)
        if m:
            top = m.group(1)
            break
    declared = json.loads(read(MANIFEST))["version"] if os.path.isfile(MANIFEST) else None
    check("CHANGELOG: top version equals plugin.json version",
          top is not None and top == declared, f"{top} vs {declared}")
    for sec in ("## [Unreleased]", "### Added"):
        check(f"CHANGELOG: `{sec}` section exists", sec in cl)

    # Negative fixtures — **do not create copies**; wire only to the canonical set.
    check("Fixtures: canonical negative-fixture directory exists",
          os.path.isdir(FIXTURES), FIXTURES)
    fx = sorted(os.listdir(FIXTURES)) if os.path.isdir(FIXTURES) else []
    check("Fixtures: at least 10 cases exist", len(fx) >= 10, f"{len(fx)}")
    empty = [n for n in fx
             if not os.listdir(os.path.join(FIXTURES, n))]
    check("Fixtures: no case is empty — empty fixtures always pass",
          not empty, str(empty[:3]))
    au = read(AUTHOR_SUITE) if os.path.isfile(AUTHOR_SUITE) else ""
    check("Fixtures: author suite actually runs those fixtures",
          "run_fixtures.py" in au and "fixtures" in au)
    check("Fixtures: author negative cases have no copies under root tests/",
          not os.path.exists(os.path.join(HERE, "fixtures", "negative"))
          and not any(os.path.exists(os.path.join(HERE, "fixtures", name)) for name in fx),
          "canonical path is skills/author/scripts/tests/fixtures/negative")

    # ------------------------------------------------------------ RED self-checks
    # Challenge whether the checks **actually read their targets**. A deleted copy
    # that remains green is a tautology, worse than no check because it is counted.
    def drop(doc, seq_key, field):
        import copy
        d = copy.deepcopy(doc)
        if d.get(seq_key):
            d[seq_key][0].pop(field, None)
        return d

    check("Self-check (RED): deleting portable mode is caught",
          bool(portable_problems(drop(pdoc, "checks", "mode"))))
    check("Self-check (RED): deleting machine-grade claims tests is caught",
          bool(claims_problems(drop(cdoc, "claims", "tests"))))
    check("Self-check (RED): requiring .md in change-impact is caught",
          bool(impact_requires_runnables(
              {"rules": [{"id": "x", "require_all_changed": ["NOTICE.md"]}]})))
    # **Compose this path at runtime.** A literal would be caught by the gate that
    # scans every tree path reference; this test requires an absent path, so avoid
    # that collision by constructing it.
    absent = os.path.join("tests", "absent-" + "fixture" + ".py")
    check("Self-check (RED): a missing test path is caught",
          bool(claims_binding({"claims": [{
              "id": "x", "검증등급": "기계",
              "tests": [{"path": absent,
                         "command": "python3 " + absent}]}]}, ROOT)[0]))
    tab_rejected = False
    try:
        parse("a:\n\tb: 1\n")
    except ValueError:
        tab_rejected = True
    check("Self-check (RED): parser rejects tab indentation", tab_rejected)

    check_no_constant_assertions(check, __file__)
    check_total(check, results, 38)

    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n{passed}/{len(results)} 통과")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
