#!/usr/bin/env python3
"""Diagram regression suite.

Usage: python3 tests/run_tests.py (from skills/diagram)

This suite locks three sources of product value:

1. The documented boundary with `image`: both produce pictures, but only one
   preserves editable structure. A vague boundary breaks routing.
2. The Korean font contract: Geist has no CJK coverage and the Japanese stack
   lacks Korean glyphs. Losing it can corrupt every procurement-diagram label.
3. Vendored validators: upstream limited them to repository checkouts, making
   them unavailable from marketplace installs. Without them, six rules become
   checklist recitation.
"""

import hashlib
import io
import json
import os
import tempfile
import re
import subprocess
import sys

sys.dont_write_bytecode = True
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
from _suite_lib import (  # noqa: E402
    check_no_constant_assertions,
    check_skill_body,
    check_script_contracts,
    check_total,
    check_ref_contracts,
    split_frontmatter,
    check_body_deletion,
    check_contract_coverage,
)  # noqa: E402

ROOT = os.path.dirname(HERE)
VERIFY = os.path.join(ROOT, "scripts", "verify-geometry.py")
VERIFY_TEST = os.path.join(ROOT, "scripts", "test-verify-geometry.py")

results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))


def read(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


def _tracked(path):
    """Return whether the file is tracked by Git; false outside Git or when untracked."""
    path = os.path.abspath(path)
    try:
        r = subprocess.run(
            ["git", "ls-files", "--error-unmatch", "--", path],
            capture_output=True,
            text=True,
            cwd=os.path.dirname(path) or ".",
        )
        return r.returncode == 0
    except OSError:
        return False


# Measured count while references are untracked. Committing adds one
# `type-placement.md line survival` result; see the `check_total` call.
TOTAL_BASE = 362

# Measured `scripts/` contract floors, all with zero slack. Both the mutation
# checker and completeness guard consume this mapping. A prior 9-entry declaration
# omitted the tenth script, `test-verify-geometry.py`, so emptying it caused no
# failure. An unlisted script has no contract.
SCRIPT_FLOORS = {
    "scripts/verify-geometry.py": 5,
    "scripts/test-verify-geometry.py": 3,
    "scripts/verify-connectors.py": 57,
    "scripts/verify-text-width.py": 22,
    "scripts/measure_label.py": 18,
    "scripts/export_scale.py": 6,
    "scripts/check_effective_size.py": 10,
    "scripts/encode_drawio_url.py": 3,
    "scripts/repair_png.py": 4,
    "scripts/subset_fonts.py": 5,
}


def main():
    skill_all = read(os.path.join(ROOT, "SKILL.md"))
    fm, skill = split_frontmatter(skill_all)

    # (1) Boundary with image. Parse a table so prose cannot blur the distinction.
    check("Boundary: difference from image is declared in a table", "| `diagram` | `image` |" in skill)
    for axis in ("SVG", "PNG", "preserves structure", "Editable later", "Not editable"):
        check(f"Boundary: table contains axis `{axis}`", axis in skill)
    check("Boundary: one-sentence decision criterion exists", "are there relationships between elements?" in skill)
    # Read direction as well as tokens; swapping columns must fail.
    m_row = re.search(r"(?m)^\|\s*Output\s*\|([^|]*)\|([^|]*)\|", skill)
    check("Boundary: Output row exists", m_row is not None)
    # Do not guard these results; missing content must fail rather than erase checks.
    ours = m_row.group(1) if m_row else ""
    theirs = m_row.group(2) if m_row else ""
    check(
        "Boundary: diagram column is SVG (columns not swapped)",
        "SVG" in ours and "PNG" not in ours,
        ours.strip()[:30] or "row missing",
    )
    check(
        "Boundary: image column is PNG",
        "PNG" in theirs and "SVG" not in theirs,
        theirs.strip()[:30] or "row missing",
    )

    # Referral targets must exist; declared unimplemented targets are exempt.
    skills_dir = os.path.dirname(ROOT)
    NAME = r"`([a-z][a-z-]{2,})`\s+skill\b"
    declared = sorted(set(re.findall(NAME, skill)))
    unbuilt = set()
    referred = [n for n in declared if n not in unbuilt]
    missing = [n for n in referred if not os.path.isdir(os.path.join(skills_dir, n))]
    check(
        "Referral target population is nonempty",
        len(referred) >= 2,
        f"required {referred} / declared unimplemented {sorted(unbuilt)}",
    )
    check("Every referral target exists", not missing, f"missing {missing}")

    # (2) Korean font contract. Require the complete stack, not a token.
    KO_STACK = "'Apple SD Gothic Neo', 'Noto Sans KR', 'Malgun Gothic'"
    check("Korean: SKILL.md contains the complete Korean font stack", KO_STACK in skill)
    check(
        "Korean: document says Geist has no CJK coverage",
        "Geist" in skill and "no CJK coverage" in skill,
    )
    check(
        "Korean: document forbids reusing the Japanese stack",
        "Japanese stack" in skill and "lacks Korean glyphs" in skill,
    )

    # D-2 enforcement: two-way cross-check between prose values and script constants.
    # Scripts are authoritative. Pin each measured constant, then derive the exact
    # prose needle from it. Either axis alone misses drift in the other or a coordinated
    # reversion to an upstream value.
    _osp_path = os.path.join(ROOT, "references", "output-spec.md")
    osp = read(_osp_path) if os.path.exists(_osp_path) else ""

    def const_of(rel, name):
        """Read a module-level numeric literal from script source, or return None."""
        fp = os.path.join(ROOT, rel)
        if not os.path.exists(fp):
            return None
        m = re.search(rf"(?m)^{name}\s*=\s*([0-9]+(?:\.[0-9]+)?)\b", read(fp))
        return float(m.group(1)) if m else None

    # L-14 mixed-script weights. Scope needles to the paragraph that owns the
    # value; a document-wide match can survive replacement of the actual contract.
    def _para(body, anchor):
        """Return the blank-line-delimited paragraph containing `anchor`, or empty."""
        for block in body.split("\n\n"):
            if anchor in block:
                return block
        return ""

    _EM_SKILL = "mixed-script width weights"
    _EM_OSP = "mixed-script weights"
    _PT_SKILL = "minimum effective size is"
    _PT_OSP = "final criterion is"
    XREF = (
        ("measure_label.py EM_SPACE", "scripts/measure_label.py", "EM_SPACE",
         0.25, "whitespace {}em",
         (("SKILL.md", _EM_SKILL), ("references/output-spec.md", _EM_OSP))),
        ("measure_label.py EM_WIDE", "scripts/measure_label.py", "EM_WIDE",
         1.0, "full-width {}em",
         (("SKILL.md", _EM_SKILL), ("references/output-spec.md", _EM_OSP))),
        ("measure_label.py EM_NARROW", "scripts/measure_label.py", "EM_NARROW",
         0.55, "Latin {}em",
         (("SKILL.md", _EM_SKILL), ("references/output-spec.md", _EM_OSP))),
        ("verify-text-width.py ASCII_EM", "scripts/verify-text-width.py",
         "ASCII_EM", 0.6, "Latin {}em",
         (("SKILL.md", _EM_SKILL), ("references/output-spec.md", _EM_OSP))),
        # L-16 effective-pt floor at final placement width, rather than pixels.
        ("check_effective_size.py MIN_EFFECTIVE_PT",
         "scripts/check_effective_size.py", "MIN_EFFECTIVE_PT",
         10.0, "{}pt",
         (("SKILL.md", _PT_SKILL), ("references/output-spec.md", _PT_OSP))),
    )
    _bodies = {"SKILL.md": skill, "references/output-spec.md": osp}
    for why, rel, name, want, tmpl, targets in XREF:
        got = const_of(rel, name)
        check(
            f"Cross-check: read {why} from source",
            got is not None,
            f"could not find `{name} = <number>` in {rel}; update this check if renamed",
        )
        check(
            f"Cross-check: {why} matches measured value {want:g}",
            got == want,
            f"{got}",
        )
        needle = tmpl.format(f"{got:g}") if got is not None else None
        for tgt, anchor in targets:
            scope = _para(_bodies.get(tgt, ""), anchor)
            check(
                f"Cross-check: `{anchor}` section in {tgt} carries constant "
                f"`{tmpl.format(f'{want:g}')}`",
                bool(scope)
                and needle is not None
                and needle.lower() in scope.lower(),
                (f"could not find paragraph `{anchor}`" if not scope
                 else f"paragraph lacks `{needle}`; update prose with the constant"),
            )

    # Reject restoration of obsolete upstream wording that would create two contracts.
    for gone, why in (
        ("The width budget is **one full-width character = 1em**", "L-14 upstream wording"),
        ("Size uses a **12px minimum**", "L-16 upstream wording"),
    ):
        check(
            f"Cross-check: SKILL.md does not restore {why}",
            gone not in skill,
            f"`{gone}` reappeared",
        )
    check(
        "Cross-check: SKILL.md presents 12px as a separate viewBox-unit floor",
        "separate floor in `viewBox` units" in skill and "insufficient by itself" in skill,
        "restoring 12px as the final floor would recreate the contradiction",
    )

    # Four replacement decisions (L-22, L-24, L-25, L-26) have no scripts.
    # Keep one authority under `references/` and cross-check three prose copies.
    _tgp = os.path.join(ROOT, "references", "taste-gate.md")
    tgate = read(_tgp) if os.path.exists(_tgp) else ""

    # L-22 procurement complexity budget; output-spec.md is authoritative.
    budget = dict(
        re.findall(
            r"(?m)^\| (Procurement system architecture|Project organization chart|WBS or schedule) \| \*\*(\d+–\d+)\*\* \|",
            osp,
        )
    )
    check(
        "Replacement L-22: parsed procurement budget table from output-spec",
        len(budget) == 3,
        f"{budget} — update this parser if the table format changed",
    )
    check(
        "Replacement L-22: authority matches measured budgets (20–40, 15–25, 30–60)",
        budget
        == {
            "Procurement system architecture": "20–40",
            "Project organization chart": "15–25",
            "WBS or schedule": "30–60",
        },
        str(sorted(budget.items())),
    )
    # Use a fixed population so parser failure produces failures rather than
    # disappearing checks and a false disappearance-guard result.
    for _name in ("Procurement system architecture", "Project organization chart", "WBS or schedule"):
        _rng = budget.get(_name, "")
        for _tgt, _body in (("SKILL.md", skill), ("taste-gate", tgate)):
            check(
                f"Replacement L-22: {_tgt} carries authoritative {_name} budget",
                bool(_rng) and _rng in _body,
                f"authority `{_rng or '(not parsed)'}` is absent from {_tgt}",
            )
    check(
        "Replacement L-22: upstream nine-node value was not restored as local budget",
        "The standard complexity budget is nine nodes" not in skill
        and "within the complexity budget — nine nodes" not in tgate,
        "upstream value may remain only when labeled as the web-diagram standard",
    )
    check(
        "Replacement L-22: prose explains why exceeding upstream budget is not a defect",
        "exceed the page limit or omit requirements" in skill
        and "exceed page" in osp and "limits or omit requirements" in osp,
    )

    # L-24 replaces the two-focus constraint with grayscale legibility.
    check(
        "Replacement L-24: output-spec has a grayscale-legibility section",
        "## Grayscale legibility replaces the two-accent limit" in osp and "same distinctions remain when all color is removed" in osp,
    )
    check(
        "Replacement L-24: seven-to-two collapse is documented",
        "seven categories into two" in osp and "seven categories into two" in skill,
    )
    for _tgt, _body in (("SKILL.md", skill), ("taste-gate.md", tgate)):
        check(
            f"Replacement L-24: {_tgt} carries grayscale legibility as a decision",
            "distinctions remain when color is removed" in _body
            or "same distinctions remain when all color is removed" in _body,
            "moving words alone would preserve the two-focus constraint",
        )
    check(
        "Replacement L-24: two-focus constraint was not restored",
        "Do not enforce a two-accent-color limit" in skill
        and "Are accent colors used on **at most two** elements?" not in tgate,
        "restoring the checklist constraint would make grayscale decorative",
    )

    # L-25 reverses the deletion test into an omission test.
    check(
        "Replacement L-25: taste-gate section is the omission test",
        "## Omission test" in tgate and "## Deletion test" not in tgate,
    )
    check(
        "Replacement L-25: reversed question exists",
        "Does the diagram omit any RFP requirement?" in tgate
        and "does this diagram omit\nany RFP requirement?" in skill,
    )
    check(
        "Replacement L-25: procurement rationale for reversal is documented",
        "omit an RFP response" in tgate and "omit an\n**RFP response**" in skill,
    )
    check(
        "Replacement L-25: all three SKILL.md references point to omission test",
        skill.lower().count("omission test") >= 1 and "run the deletion test first" not in skill.lower(),
        f"omission test {skill.lower().count('omission test')} occurrences",
    )

    # L-26 permits a right-side legend box.
    check(
        "Replacement L-26: output-spec permits right-side legend placement",
        "### Legend placement" in osp and "**180px on the right**" in osp,
    )
    check(
        "Replacement L-26: fixed-bottom requirement is absent",
        "The legend is the bottom 60px and nothing else goes there" not in osp,
        "retaining the fixed sentence would create two contracts",
    )
    check(
        "Replacement L-26: rationale includes effective-pt calculation (8px to 4pt)",
        "into **4pt**" in osp,
    )
    check(
        "Replacement L-26: legend type must meet effective-pt floor",
        "Either layout must meet the effective-pt floor" in osp,
    )

    # (3) Vendored validator: require the file and its measured upstream line count.
    # A line-count change exposes divergence from upstream.
    check("Vendor: verify-geometry.py exists", os.path.exists(VERIFY))
    check(
        "Vendor: test-verify-geometry.py was imported with it",
        os.path.exists(VERIFY_TEST),
        "importing only the validator would leave regressions undetected",
    )
    if os.path.exists(VERIFY):
        n = len(read(VERIFY).splitlines())
        check(
            "Vendor: verify-geometry.py matches upstream measured 168 lines", n == 168, f"{n} lines"
        )
    if os.path.exists(VERIFY_TEST):
        n = len(read(VERIFY_TEST).splitlines())
        # One ASSET_DIR line was adapted to our layout and four rationale lines were
        # added (138 -> 142). The validation logic itself remains unchanged.
        check(
            "Vendor: test-verify-geometry.py is 142 lines (upstream 138 plus four ASSET_DIR rationale lines)",
            n == 142,
            f"{n} lines",
        )

    # Bind content with a hash. Line counts alone allow a no-op stub plus padding;
    # one adversarial probe returned `[]` and padded the file to 168 lines.
    # Line counts can be forged, but hashes cannot.
    manifest = read(os.path.join(ROOT, "UPSTREAM.sha256"))
    entries = [
        ln.split(None, 1)
        for ln in manifest.splitlines()
        if ln and not ln.startswith("#")
    ]
    # The raw-byte manifest now contains one unchanged vendor file instead of five.
    # Derived examples are bound separately by machine-readable, sentinel-stripped hashes.
    check(
        "자기검사: hash manifest contains one entry",
        len(entries) == 1,
        f"{len(entries)} entries",
    )
    manifest_text = read(os.path.join(ROOT, "UPSTREAM.sha256"))
    record_prefix = "# sentinel-stripped-sha256 "
    record_re = re.compile(
        r"^# sentinel-stripped-sha256 ([0-9a-f]{64}) (assets/example-[a-z-]+\.html)$"
    )
    record_lines = [
        line for line in manifest_text.splitlines() if line.startswith(record_prefix)
    ]
    derived_records = [
        m.groups() for line in record_lines if (m := record_re.fullmatch(line))
    ]
    derived_by_path = {rel: want for want, rel in derived_records}
    derived_paths = {
        "assets/example-architecture.html",
        "assets/example-dp-integration.html",
        "assets/example-sequence-oauth.html",
        "assets/example-swimlane.html",
    }
    check(
        "자기검사: sentinel-stripped hashes have exactly four machine-readable rows",
        len(record_lines) == len(derived_records) == 4,
        f"prefixed {len(record_lines)} / parsed {len(derived_records)}",
    )
    check(
        "자기검사: sentinel-stripped hashes identify four unique examples",
        len(derived_by_path) == 4 and set(derived_by_path) == derived_paths,
        str(sorted(derived_by_path)),
    )
    check(
        "Source: three original hashes plus swimlane origin hash and geometry rationale remain",
        all(
            needle in manifest_text
            for needle in (
                "The first three derive from upstream with only two paired-sentinel lines added",
                "03716fdb0a4ad641c30a5267b14a4c573d699f0f31ab3d8a0ba4e2b74ad56177",
                "929b6aaefa9a362d4cd18fb1801a57f28d32aa8dd78ba577375a11926ee2cc94",
                "700ff6d8a06aa0b04b67520e4def6388f1a334c1a63d9df9edc5f697eeee4a40",
                "example-swimlane.html is no longer an unchanged import",
                "75fc463ad3282dd0faaa4328c6b07f7e853184eeb1edcff2add8f7ed1876ab3b",
                "orthogonal L paths",
            )
        ),
        "removing it from the list without origin hash and geometry rationale is silent drift",
    )
    begin_marker = b"<!-- verify-connectors:legend:BEGIN -->"
    end_marker = b"<!-- verify-connectors:legend:END -->"

    def sentinel_marker(line):
        """Return markers from exact full-line sentinel comments with only outer whitespace."""
        content = line[:-1] if line.endswith(b"\n") else line
        if content.endswith(b"\r"):
            content = content[:-1]
        content = content.strip(b" \t")
        return content if content in (begin_marker, end_marker) else None

    for rel in sorted(derived_paths):
        with open(os.path.join(ROOT, rel), "rb") as fh:
            asset_bytes = fh.read()
        asset_lines = asset_bytes.splitlines(keepends=True)
        markers = [sentinel_marker(line) for line in asset_lines]
        begin_count = markers.count(begin_marker)
        end_count = markers.count(end_marker)
        check(
            f"자기검사: {rel} has exactly one full-line BEGIN and END sentinel",
            begin_count == end_count == 1,
            f"BEGIN {begin_count} / END {end_count}",
        )
        stripped = b"".join(
            line for line in asset_lines if sentinel_marker(line) is None
        )
        got = hashlib.sha256(stripped).hexdigest()
        want = derived_by_path.get(rel, "")
        check(
            f"자기검사: {rel} matches derivative hash after removing two sentinel lines",
            begin_count == end_count == 1 and got == want,
            f"{got[:16]} != {want[:16]}",
        )
    for want, rel in entries:
        rel = rel.strip()
        f = os.path.join(ROOT, rel)
        if not os.path.exists(f):
            check(f"자기검사: {rel} is byte-identical to upstream", False, "file missing")
            continue
        with open(f, "rb") as fh:
            got = hashlib.sha256(fh.read()).hexdigest()
        check(
            f"자기검사: {rel} is byte-identical to upstream",
            got == want,
            f"{got[:16]} != {want[:16]}",
        )

    # Mutation-test the verdict. A copy with its decision neutralized must make the
    # vendor test fail; otherwise the test checks imports without enforcing the rules.
    import shutil as _sh
    import tempfile as _tf

    work = _tf.mkdtemp()
    try:
        dst = os.path.join(work, "diagram")
        _sh.copytree(
            ROOT,
            dst,
            ignore=_sh.ignore_patterns("__pycache__", "*.pyc", ".omc", "tests"),
        )
        vg = os.path.join(dst, "scripts", "verify-geometry.py")
        src_vg = read(vg)
        # The evaluation function `check()` returns an empty result — the shape (number of lines) is preserved.
        # This reproduces the no-op mutation that previously passed line-count and
        # exit-code checks after padding the file to 168 lines.
        m_def = re.search(r"(?m)^def check\(path[^\n]*\n", src_vg)
        stub = (
            src_vg[: m_def.end()] + "    return []\n" + src_vg[m_def.end() :]
            if m_def
            else src_vg
        )
        neutered = stub != src_vg
        with open(vg, "w", encoding="utf-8") as fh:
            fh.write(stub)
        _sh.copy(VERIFY_TEST, os.path.join(dst, "scripts", "test-verify-geometry.py"))
        r2 = subprocess.run(
            [sys.executable, "test-verify-geometry.py"],
            capture_output=True,
            text=True,
            cwd=os.path.join(dst, "scripts"),
        )
        check(
            "자기검사: created a copy with verdict logic disabled",
            neutered,
            "could not find check_file; update this test if upstream structure changed",
        )
        check(
            "자기검사: vendor test measures validator **verdicts** through mutation",
            neutered and r2.returncode != 0,
            "test passes with verdicts removed, so it checks only importability",
        )
    finally:
        _sh.rmtree(work, ignore_errors=True)

    # Pin the vendor test's assertion count. A mutation that asks whether anything
    # is measured cannot detect assertions removed one at a time.
    vt_src = read(VERIFY_TEST)
    n_assert = len(re.findall(r"(?m)^\s*check_file\(", vt_src))
    check(
        "Vendor: test has measured four verdict assertions", n_assert == 4, f"{n_assert} assertions"
    )

    # Verify that the vendored validator actually runs.
    r = subprocess.run(
        [sys.executable, VERIFY_TEST],
        capture_output=True,
        text=True,
        cwd=os.path.join(ROOT, "scripts"),
    )
    # The `self-test:` prefix excludes this live-only vendor check from deletion-copy
    # accounting, preventing a false disappearance report.
    check(
        "자기검사: validator self-test passes",
        r.returncode == 0,
        (r.stderr or r.stdout).strip().splitlines()[-1][:80] if r.returncode else "",
    )

    # SKILL.md must give users the correct validator path.
    check(
        "Validation: SKILL.md documents validator invocation path",
        "skills/diagram/scripts/verify-geometry.py" in skill,
    )
    check(
        "Validation: document requires both machine and human inspection",
        "Automated checks" in skill and "Visual inspection" in skill,
    )

    # (4) Source and license: require the NOTICE contract.
    notice = read(os.path.join(ROOT, "NOTICE"))
    check(
        "Source: NOTICE identifies upstream and license",
        "MIT" in notice and "cathrynlavery/diagram-design" in notice,
    )
    check(
        "Source: NOTICE explains why validator was vendored",
        "From a repository checkout" in notice and "checklist recitation" in notice,
    )
    check("Source: upstream version is recorded", "v2.6.7" in notice)
    lic = read(os.path.join(ROOT, "LICENSE.upstream"))
    check(
        "Source: complete LICENSE is MIT with terms intact",
        "MIT License" in lic
        and "WITHOUT WARRANTY" in lic
        and "Permission is hereby granted" in lic,
        "a license name without the complete text is not sufficient notice",
    )
    check("Source: SKILL.md also identifies upstream", "up:diagram-design" in skill)

    # up:archify orthogonality import (2026-08-30), with both MIT notices.
    lic2 = read(os.path.join(ROOT, "LICENSE.archify"))
    # Execute the added checker against shipped examples and measure both its exit
    # code and detection power.
    conn = os.path.join(ROOT, "scripts", "verify-connectors.py")
    check("Connector: verify-connectors.py exists", os.path.exists(conn))
    if os.path.exists(conn):
        r = subprocess.run(
            [sys.executable, conn, "--all"], capture_output=True, text=True, cwd=ROOT
        )
        check(
            "Connector: shipped examples have no diagonals",
            r.returncode == 0,
            "" if r.returncode == 0 else r.stdout.strip()[-200:],
        )
        # Detection control: an injected diagonal must be caught.
        with tempfile.TemporaryDirectory() as td:
            src = read(os.path.join(ROOT, "assets", "example-architecture.html"))
            bad = src.replace(
                '<line x1="168" y1="272" x2="220" y2="272"',
                '<line x1="168" y1="272" x2="220" y2="300"',
                1,
            )
            check("Connector: mutation changed the file", bad != src)
            fp = os.path.join(td, "diag.html")
            with open(fp, "w", encoding="utf-8") as f:
                f.write(bad)
            r2 = subprocess.run(
                [sys.executable, conn, fp], capture_output=True, text=True, cwd=ROOT
            )
            check(
                "Connector: detects injected diagonal",
                r2.returncode != 0,
                "" if r2.returncode != 0 else "validator passed after a diagonal was injected",
            )

            # --- Diagnostic contract (H-4) ---------------------------------------
            # Never hide these checks behind parse success; parsing failures must
            # produce failures instead of making checks disappear.
            def payload(*argv):
                r = subprocess.run(
                    [sys.executable, conn, *argv],
                    capture_output=True,
                    text=True,
                    cwd=ROOT,
                )
                try:
                    return json.loads(r.stdout), r
                except ValueError:
                    return None, r

            ok_p, ok_r = payload("--all", "--json")
            check(
                "Diagnostics: --json emits one valid JSON value",
                ok_p is not None,
                (ok_r.stdout or ok_r.stderr).strip()[:80],
            )
            check(
                "Diagnostics: envelope has schemaVersion 1 and identifies source",
                bool(ok_p)
                and ok_p.get("schemaVersion") == 1
                and ok_p.get("source") == "verify-connectors",
                str(ok_p)[:60] if ok_p else "envelope missing",
            )
            check(
                "Diagnostics: clean asset has ok=true and no diagnostics",
                bool(ok_p) and ok_p.get("ok") is True and ok_p.get("diagnostics") == [],
                str(ok_p.get("diagnostics"))[:80] if ok_p else "envelope missing",
            )
            # Independent population metric: zero connectors can otherwise look like
            # a valid zero-finding result after a parser-regex regression.
            n_ok = (ok_p or {}).get("summary", {}).get("connectors", 0)
            check(
                "Diagnostics: clean asset actually parsed connectors (connectors > 0)",
                n_ok > 0,
                f"{n_ok} connectors",
            )

            bad_p, bad_r = payload(fp, "--json")
            check(
                "Diagnostics: injected diagonal produces ok=false",
                bool(bad_p) and bad_p.get("ok") is False and bad_r.returncode != 0,
                str(bad_p)[:60] if bad_p else "envelope missing",
            )
            d0 = (bad_p or {}).get("diagnostics", [{}])[0] if bad_p else {}
            check(
                "Diagnostics: diagonal code is connector/diagonal with error severity",
                d0.get("code") == "connector/diagonal"
                and d0.get("severity") == "error",
                str(d0.get("code")),
            )
            check(
                "Diagnostics: subject contains file, line, connector, and segment",
                {"file", "line", "connector", "segment"} <= set(d0.get("subject", {})),
                str(sorted(d0.get("subject", {}))),
            )
            # Equal coordinates are not diagonal; reject constant padding.
            ev = d0.get("evidence", {})
            check(
                "Diagnostics: evidence from/to are distinct real coordinates",
                isinstance(ev.get("from"), list)
                and isinstance(ev.get("to"), list)
                and ev.get("from") != ev.get("to"),
                str(ev)[:80],
            )
            fixes = d0.get("supportedFixes", [])
            check(
                "Diagnostics: five repair stages run from relocate through delete",
                [f.get("action") for f in fixes]
                == ["relocate", "reroute", "shorten", "restructure", "delete"],
                str([f.get("action") for f in fixes]),
            )
            check(
                "Diagnostics: only deletion requires evidence",
                len(fixes) == 5
                and [f.get("requiresEvidence") for f in fixes]
                == [False, False, False, False, True],
                str([f.get("requiresEvidence") for f in fixes]),
            )

            # Deletion control: removing a diagonal legitimately clears its finding,
            # so also measure the independent connector population to distinguish
            # repair from deletion.
            m_del = re.search(r'<line x1="168" y1="272" x2="220" y2="300"[^>]*/>', bad)
            check(
                "Diagnostics: found the deletion mutation target",
                m_del is not None,
                "connector tag not found; update this test if the asset changed",
            )
            gone = bad[: m_del.start()] + bad[m_del.end() :] if m_del else bad
            gp = os.path.join(td, "gone.html")
            with open(gp, "w", encoding="utf-8") as f:
                f.write(gone)
            del_p, del_r = payload(gp, "--json")
            check(
                "Diagnostics: deleting a connector turns result green (deletion path exists)",
                bool(del_p)
                and del_r.returncode == 0
                and del_p.get("summary", {}).get("findings") == 0,
                str(del_p.get("summary")) if del_p else "envelope missing",
            )
            n_del = (del_p or {}).get("summary", {}).get("connectors", -1)
            n_bad = (bad_p or {}).get("summary", {}).get("connectors", -1)
            check(
                "Diagnostics: deletion lowers connector total and exposes source of green",
                n_del >= 0 and n_bad >= 0 and n_del < n_bad,
                f"{n_bad} -> {n_del}",
            )

            # `input/read` — The previous version died here with traceback.
            nf_p, nf_r = payload(os.path.join(td, "nope.html"), "--json")
            check(
                "Diagnostics: missing file emits input/read",
                bool(nf_p)
                and nf_r.returncode != 0
                and nf_p.get("diagnostics", [{}])[0].get("code") == "input/read",
                str(nf_p.get("diagnostics", [{}])[0].get("code"))
                if nf_p
                else "envelope missing",
            )
            check(
                "Diagnostics: missing file emits no traceback",
                "Traceback" not in nf_r.stderr,
                nf_r.stderr.strip()[-80:],
            )

            # Preserve human-readable output while adding JSON; lock both interfaces.
            h = subprocess.run(
                [sys.executable, conn, fp], capture_output=True, text=True, cwd=ROOT
            )
            check(
                "Diagnostics: without --json, existing human-readable output remains",
                "is diagonal (" in h.stdout
                and h.stdout.rstrip().endswith("finding(s)."),
                h.stdout.strip().splitlines()[-1][:60] if h.stdout else "no output",
            )
            check(
                "Diagnostics: human-readable path contains no JSON",
                "schemaVersion" not in h.stdout and not h.stdout.startswith("{"),
                h.stdout[:60],
            )

            # --- Rule 3: overlap, ambiguous corridors, and crossings (H-2) --------
            # For the shared/geometry.mjs port, report zero candidates separately
            # from candidates that merely remain below the 8px threshold.
            zero_p, _ = payload("--all", "--min-overlap", "0", "--json")
            codes_zero = {d.get("code") for d in (zero_p or {}).get("diagnostics", [])}
            check(
                "Connector: examples have no overlap or crossing candidates even at threshold zero",
                zero_p is not None
                and not (
                    codes_zero
                    & {"connector/ambiguous-corridor", "connector/proper-crossing"}
                ),
                str(sorted(codes_zero)),
            )

            def seed(name, text, *extra):
                """Write a mutated copy and return its diagnostic envelope."""
                p = os.path.join(td, name)
                with open(p, "w", encoding="utf-8") as f:
                    f.write(text)
                r = subprocess.run(
                    [sys.executable, conn, p, *extra],
                    capture_output=True,
                    text=True,
                    cwd=ROOT,
                )
                try:
                    return json.loads(r.stdout), r
                except ValueError:
                    return None, r

            # (1) Collinear overlap: place connector 2 over connector 1 for 40px.
            ov_src = src.replace(
                '<line x1="364" y1="272" x2="416" y2="272"',
                '<line x1="180" y1="272" x2="232" y2="272"',
                1,
            )
            check(
                "Connector: overlap mutation changed the file",
                ov_src != src,
                "update these coordinates if the asset changed",
            )
            ov_p, ov_r = seed("overlap.html", ov_src, "--json")
            ov_d = [
                d
                for d in (ov_p or {}).get("diagnostics", [])
                if d.get("code") == "connector/ambiguous-corridor"
            ]
            # A nonzero rc may come from another failure. Require the 40px overlap
            # and fixed coordinate 272 in the diagnostic.
            check(
                "Connector: detects injected corridor overlap (40px at y=272)",
                ov_r.returncode != 0
                and len(ov_d) == 1
                and "40" in ov_d[0]["message"]
                and "272" in ov_d[0]["message"],
                ov_d[0]["message"][-70:] if ov_d else "corridor diagnostic missing",
            )
            check(
                "Connector: corridor evidence contains numeric overlap length",
                bool(ov_d) and abs(ov_d[0]["evidence"].get("overlapPx", 0) - 40) < 1e-6,
                str(ov_d[0]["evidence"]) if ov_d else "evidence missing",
            )

            # (1b) The legend excludes only the exact paired sentinel span.
            begin = "<!-- verify-connectors:legend:BEGIN -->"
            end = "<!-- verify-connectors:legend:END -->"
            legend_src = (
                '<svg><line x1="20" y1="20" x2="80" y2="40" '
                'marker-end="url(#a)"/></svg>\n'
                f"{begin}\n"
                '<svg><line x1="20" y1="60" x2="80" y2="100" '
                'marker-end="url(#a)"/>'
                '<line x1="20" y1="100" x2="80" y2="60" '
                'marker-end="url(#a)"/></svg>\n'
                f"{end}\n"
                '<svg><line x1="20" y1="140" x2="80" y2="180" '
                'marker-end="url(#a)"/></svg>\n'
            )
            check("Connector: paired-legend mutation changed the file", legend_src != src)
            lg_p, lg_r = seed("sentinel-exclusion.html", legend_src, "--json")
            lg_codes = [d.get("code") for d in (lg_p or {}).get("diagnostics", [])]
            lg_diags = (lg_p or {}).get("diagnostics", [])
            check(
                "Connector: two connectors remain outside paired legend",
                (lg_p or {}).get("summary", {}).get("connectors") == 2,
                str((lg_p or {}).get("summary")),
            )
            check(
                "Connector: paired legend excludes its diagonal and reports two outside source lines",
                lg_r.returncode != 0
                and lg_codes == ["connector/diagonal", "connector/diagonal"]
                and [d.get("subject", {}).get("line") for d in lg_diags] == [1, 5],
                str([(d.get("code"), d.get("subject")) for d in lg_diags]),
            )

            ordinary = legend_src.replace(begin, "<!-- Legend -->").replace(end, "")
            od_p, od_r = seed("ordinary-legend.html", ordinary, "--json")
            od_codes = [d.get("code") for d in (od_p or {}).get("diagnostics", [])]
            check(
                "Connector: generic Legend comment does not hide diagonals",
                od_r.returncode != 0
                and "connector/diagonal" in od_codes
                and (od_p or {}).get("summary", {}).get("connectors") == 4,
                str(od_codes),
            )

            malformed = {
                "orphan-begin": begin,
                "orphan-end": end,
                "reversed": end + "\n" + begin,
                "nested": begin + "\n" + begin + "\n" + end + "\n" + end,
            }
            for case, markup in malformed.items():
                malformed_src = (
                    markup
                    + "\n"
                    + '<svg><line x1="20" y1="20" x2="80" y2="40" marker-end="url(#a)"/></svg>\n'
                )
                mp, mr = seed(f"legend-{case}.html", malformed_src, "--json")
                mp_diags = (mp or {}).get("diagnostics", [])
                mp_codes = [d.get("code") for d in mp_diags]
                check(
                    f"Connector: {case} legend markers fail closed and count real diagonals",
                    mr.returncode != 0
                    and mp is not None
                    and "input/legend-markup" in mp_codes
                    and [d.get("code") for d in mp_diags].count("connector/diagonal")
                    == 1
                    and (mp or {}).get("summary", {}).get("connectors") == 1,
                    str(mp),
                )

            rollback_src = (
                f"{begin}\n"
                '<svg><line x1="20" y1="20" x2="80" y2="40" marker-end="url(#a)"/></svg>\n'
                f"{end}\n"
                f"{begin}\n"
                '<svg><line x1="20" y1="60" x2="80" y2="100" marker-end="url(#a)"/></svg>\n'
            )
            rb_p, rb_r = seed(
                "legend-late-malformed-rollback.html", rollback_src, "--json"
            )
            rb_diags = (rb_p or {}).get("diagnostics", [])
            check(
                "Connector: late legend-marker error rolls back exclusions and counts both diagonals",
                rb_r.returncode != 0
                and "input/legend-markup" in [d.get("code") for d in rb_diags]
                and (rb_p or {}).get("summary", {}).get("connectors") == 2
                and [
                    d.get("subject", {}).get("line")
                    for d in rb_diags
                    if d.get("code") == "connector/diagonal"
                ]
                == [2, 5],
                str(rb_p),
            )

            shipped_counts = {
                "example-architecture.html": 5,
                "example-dp-integration.html": 11,
                "example-sequence-oauth.html": 8,
                "example-swimlane.html": 6,
            }
            for filename, expected in shipped_counts.items():
                cp, cr = payload(os.path.join(ROOT, "assets", filename), "--json")
                check(
                    f"Connector: {filename} ships {expected} connectors",
                    cr.returncode == 0
                    and cp is not None
                    and cp.get("summary", {}).get("connectors") == expected,
                    str((cp or {}).get("summary")),
                )

            # (2) Crossing without a hop: one injected vertical line creates two pairs.
            anchor = '        <line x1="168" y1="272" x2="220" y2="272"'
            check(
                "Connector: found crossing-mutation insertion point",
                anchor in src,
                "update this anchor if the asset changed",
            )
            plain = (
                '        <line x1="200" y1="240" x2="200" y2="310" '
                'stroke="#4f5d75" stroke-width="1" marker-end="url(#arrow)"/>\n'
            )
            cr_src = src.replace(anchor, plain + anchor, 1)
            cr_p, cr_r = seed("crossing.html", cr_src, "--json")
            cr_d = [
                d
                for d in (cr_p or {}).get("diagnostics", [])
                if d.get("code") == "connector/proper-crossing"
            ]
            check(
                "Connector: detects crossing without a hop",
                cr_r.returncode != 0 and len(cr_d) >= 1,
                f"{len(cr_d)} findings",
            )

            # (3) Control: rounding the same vertical line with `Q` above y=272 must
            # remove only that crossing pair.
            hop = (
                '        <path d="M 200,240 V 267 Q 205,272 200,277 V 310" '
                'fill="none" stroke="#4f5d75" stroke-width="1" '
                'marker-end="url(#arrow)"/>\n'
            )
            hp_src = src.replace(anchor, hop + anchor, 1)
            check("Connector: hop control differs from crossing copy", hp_src != cr_src)
            hp_p, _ = seed("hop.html", hp_src, "--json")
            hp_d = [
                d
                for d in (hp_p or {}).get("diagnostics", [])
                if d.get("code") == "connector/proper-crossing"
            ]
            check(
                "Connector: drawing hop (Q) removes the crossing finding",
                len(hp_d) == len(cr_d) - 1,
                f"{len(cr_d)} -> {len(hp_d)}",
            )

            # (4) The documented `--no-crossings` escape hatch must disable the check.
            nc_p, nc_r = seed("crossing-off.html", cr_src, "--json", "--no-crossings")
            check(
                "Connector: --no-crossings disables crossing check",
                nc_r.returncode == 0
                and not [
                    d
                    for d in (nc_p or {}).get("diagnostics", [])
                    if d.get("code") == "connector/proper-crossing"
                ],
                str(nc_p.get("summary")) if nc_p else "envelope missing",
            )

            # (5) An unsupported path command must emit a finding. Treating `A`
            # arguments as a prior command once fabricated a 52px corridor and three
            # diagonals.
            arc_src = src.replace(
                'd="M 220,288 H 168"', 'd="M 220,288 H 168 A 5 5 0 0 1 180,300"', 1
            )
            check("Connector: arc mutation changed the file", arc_src != src)
            arc_p, arc_r = seed("arc.html", arc_src, "--json")
            arc_codes = [d.get("code") for d in (arc_p or {}).get("diagnostics", [])]
            check(
                "Connector: unsupported path command emits a finding",
                arc_r.returncode != 0
                and "connector/unsupported-path-command" in arc_codes,
                str(arc_codes),
            )

            # (6) Population collapse: deleting every marker-end measures no rule-1
            # or rule-3 connectors yet can otherwise look like "no defects."
            no_src = re.sub(r'\s*marker-end="[^"]*"', "", src)
            check("Connector: marker-end removal changed the file", no_src != src)
            no_p, no_r = seed("noconn.html", no_src, "--json")
            check(
                "Connector: zero-connector file emits a finding",
                no_r.returncode != 0
                and [d.get("code") for d in (no_p or {}).get("diagnostics", [])]
                == ["input/no-connectors"],
                str(no_p.get("diagnostics", [{}])[0].get("code"))
                if no_p
                else "envelope missing",
            )

            # (7) Whitespace around `=` is legal XML. A narrow `\bmarker-end=` regex
            # dropped a connector and turned 5/[diagonal,proper-crossing] into 4/[].
            sp_src = bad.replace(
                'marker-end="url(#arrow-link)"', 'marker-end = "url(#arrow-link)"', 1
            )
            check("Connector: whitespace mutation changed the file", sp_src != bad)
            sp_p, sp_r = seed("space.html", sp_src, "--json")
            sp_codes = sorted(
                {d.get("code") for d in (sp_p or {}).get("diagnostics", [])}
            )
            check(
                "Connector: population remains intact with whitespace around marker-end",
                sp_r.returncode != 0
                and (sp_p or {}).get("summary", {}).get("connectors") == 5
                and "connector/diagonal" in sp_codes,
                f"{(sp_p or {}).get('summary')} {sp_codes}",
            )

            # (8) Mutation-test population independence. A prior count_connectors()
            # reused ARROW_RE, so narrowing the arrow regex collapsed both measures.
            mut_src = read(conn).replace(r"\bmarker-end\s*=", r"\bmarker-end=", 1)
            check(
                "Connector: created a copy with only arrow regex reverted",
                mut_src != read(conn),
                "update this test if ARROW_RE shape changed",
            )
            mut = os.path.join(td, "mutated-verify-connectors.py")
            with open(mut, "w", encoding="utf-8") as f:
                f.write(mut_src)
            sp_path = os.path.join(td, "space.html")
            mr = subprocess.run(
                [sys.executable, mut, sp_path, "--json"],
                capture_output=True,
                text=True,
                cwd=ROOT,
            )
            try:
                mp = json.loads(mr.stdout)
            except ValueError:
                mp = None
            mcodes = [d.get("code") for d in (mp or {}).get("diagnostics", [])]
            check(
                "Connector: collapsed population emits input/connector-population-mismatch",
                mr.returncode != 0 and "input/connector-population-mismatch" in mcodes,
                str(mcodes) + " — this check becomes silent if accounting reuses ARROW_RE",
            )

            # (9) Advance the relative poly-Bezier cursor through every coordinate
            # pair. The true endpoint below is (130,130), while the buggy n[-2:]
            # implementation produced (120,120) and missed the y=130 overlap.
            poly = (
                '<svg><path d="M 100,100 q 10,0 10,10 10,10 20,20 h 5" '
                'fill="none" marker-end="url(#a)"/>'
                '<line x1="125" y1="130" x2="145" y2="130" '
                'marker-end="url(#a)"/></svg>\n'
            )
            pl_p, pl_r = seed("polybezier.html", poly, "--json", "--min-overlap", "0")
            pl_d = [
                d
                for d in (pl_p or {}).get("diagnostics", [])
                if d.get("code") == "connector/ambiguous-corridor"
            ]
            check(
                "Connector: detects overlap after relative polybezier (y=130)",
                pl_r.returncode != 0
                and len(pl_d) == 1
                and "y=130" in pl_d[0]["message"],
                pl_d[0]["message"][-70:]
                if pl_d
                else str([d.get("code") for d in (pl_p or {}).get("diagnostics", [])]),
            )

            # (10) Non-UTF-8 input must not leak a traceback or break the one-envelope
            # JSON contract; UnicodeDecodeError is a ValueError, not an OSError.
            enc = os.path.join(td, "latin1.html")
            with open(enc, "wb") as f:
                f.write(
                    b'<svg><line x1="0" y1="0" x2="10" y2="0" '
                    b'marker-end="url(#a)"/>\xff bad</svg>'
                )
            er = subprocess.run(
                [sys.executable, conn, enc, "--json"],
                capture_output=True,
                text=True,
                cwd=ROOT,
            )
            try:
                ep = json.loads(er.stdout)
            except ValueError:
                ep = None
            check(
                "Diagnostics: non-UTF-8 file emits input/decode without traceback",
                bool(ep)
                and er.returncode != 0
                and [d.get("code") for d in ep.get("diagnostics", [])]
                == ["input/decode"]
                and "Traceback" not in er.stderr,
                (er.stderr.strip()[-80:] or str(ep)[:80]),
            )

            # (11) Valid JSON with the wrong baseline shape must not cause AttributeError.
            bl = os.path.join(td, "baseline.json")
            with open(bl, "w", encoding="utf-8") as f:
                f.write("[]")
            br = subprocess.run(
                [sys.executable, conn, fp, "--json", "--baseline", bl],
                capture_output=True,
                text=True,
                cwd=ROOT,
            )
            try:
                bp = json.loads(br.stdout)
            except ValueError:
                bp = None
            bjp = [
                d
                for d in (bp or {}).get("diagnostics", [])
                if d.get("code") == "input/json-parse"
            ]
            check(
                "Diagnostics: malformed baseline JSON is wrapped as input/json-parse",
                len(bjp) == 1
                and bjp[0].get("severity") == "warning"
                and "Traceback" not in br.stderr,
                (br.stderr.strip()[-80:] or str(bjp)[:80]),
            )

            # (12) Legal SVG notation must not become a rule-2 or rule-3 finding.
            expo = (
                '<svg><path d="M 1e2,100 H 150" fill="none" '
                'marker-end="url(#a)"/></svg>\n'
            )
            ex_p, ex_r = seed("expo.html", expo, "--json")
            check(
                "Connector: scientific-notation coordinates (1e2) do not false-positive",
                ex_r.returncode == 0
                and (ex_p or {}).get("diagnostics") == []
                and (ex_p or {}).get("summary", {}).get("connectors") == 1,
                str((ex_p or {}).get("diagnostics"))[:80],
            )
            sq = (
                "<svg><line x1='100' y1='100' x2='200' y2='100' "
                "marker-end='url(#a)'/>"
                "<path d='M 300,100 H 400' fill='none' "
                "marker-end='url(#a)'/></svg>\n"
            )
            sq_p, sq_r = seed("singlequote.html", sq, "--json")
            check(
                "Connector: single-quoted attributes do not false-positive",
                sq_r.returncode == 0
                and (sq_p or {}).get("diagnostics") == []
                and (sq_p or {}).get("summary", {}).get("connectors") == 2,
                str((sq_p or {}).get("diagnostics"))[:80],
            )

            # (13) Keep the diagnostic contract table aligned with all emitted codes.
            rules_md = read(os.path.join(ROOT, "references", "connector-rules.md"))
            emitted = set(
                re.findall(r'"((?:connector|input|repair|taste)/[a-z-]+)"', read(conn))
            )
            documented = set(
                re.findall(
                    r"(?m)^\| `((?:connector|input|repair|taste)/[a-z-]+)` \|", rules_md
                )
            )
            check(
                "Diagnostics: code table exactly matches emitted set",
                emitted == documented,
                f"documented only {sorted(documented - emitted)} / "
                f"emitted only {sorted(emitted - documented)}",
            )
            check(
                "Diagnostics: emitted code count is measured 18",
                len(emitted) == 18,
                f"{len(emitted)} codes {sorted(emitted)}",
            )

            # (14) Compare example envelopes with actual output. One stale example
            # paired message "segment 1" with subject segment 2.
            live_p, _ = payload(fp, "--json")
            check(
                "Diagnostics: example envelope target diag.html exists",
                os.path.basename(fp) == "diag.html" and live_p is not None,
                f"{os.path.basename(fp)} — update the example when the name changes",
            )
            live_diags = (live_p or {}).get("diagnostics", [])
            check(
                "Diagnostics: example summary matches actual output",
                json.dumps((live_p or {}).get("summary", {}), ensure_ascii=False)
                in rules_md,
                json.dumps((live_p or {}).get("summary", {}), ensure_ascii=False),
            )
            mism = [
                d.get("code")
                for d in live_diags
                if json.dumps(d.get("message"), ensure_ascii=False) not in rules_md
                or json.dumps(d.get("subject"), ensure_ascii=False) not in rules_md
                or json.dumps(d.get("evidence"), ensure_ascii=False) not in rules_md
            ]
            check(
                "Diagnostics: example message, subject, and evidence match actual output exactly",
                bool(live_diags) and not mism,
                f"mismatched codes {mism}",
            )

    # --- Rules 2, 4, 5 and taste checks (`--strict-rules`) ------------------
    # Measure both detection power on injected cases and outstanding findings in
    # shipped examples. Exact debt counts expose increases and repayments.
    VC = os.path.join(ROOT, "scripts", "verify-connectors.py")

    def strict(*argv):
        r = subprocess.run(
            [sys.executable, VC, *argv, "--strict-rules", "--json"],
            capture_output=True,
            text=True,
            cwd=ROOT,
        )
        try:
            return json.loads(r.stdout), r
        except ValueError:
            return None, r

    st_p, st_r = strict("--all")
    check(
        "Strict: --strict-rules emits one valid JSON value",
        st_p is not None,
        (st_r.stdout or st_r.stderr).strip()[:80],
    )
    st_codes = {}
    for d in (st_p or {}).get("diagnostics", []):
        st_codes[d.get("code")] = st_codes.get(d.get("code"), 0) + 1
    check(
        "Strict: shipped-example debt matches measurement (label-gap 6, third-box 1)",
        st_codes == {"connector/label-gap": 6, "connector/third-box-transit": 1},
        str(sorted(st_codes.items())),
    )
    check(
        "Strict: outstanding total is seven",
        (st_p or {}).get("summary", {}).get("findings") == 7,
        str((st_p or {}).get("summary")),
    )
    # Require a nonzero population so unchanged debt cannot mask a dead parser.
    check(
        "Strict: connector population remains 30 in strict mode",
        (st_p or {}).get("summary", {}).get("connectors") == 30,
        str((st_p or {}).get("summary", {}).get("connectors")),
    )

    with tempfile.TemporaryDirectory() as td:

        def seeded(name, markup, *extra):
            fp = os.path.join(td, name)
            with open(fp, "w", encoding="utf-8") as f:
                f.write(markup)
            p, r = strict(fp, *extra)
            return [d.get("code") for d in (p or {}).get("diagnostics", [])], p, r

        # Rule 4 — Two attachment points on the same side 4px apart.
        codes, p4, r4 = seeded(
            "fan.html",
            '<svg viewBox="0 0 400 200">'
            '<line x1="200" y1="100" x2="260" y2="100" marker-end="url(#a)"/>'
            '<line x1="200" y1="104" x2="260" y2="104" marker-end="url(#a)"/>'
            '<rect x="40" y="60" width="160" height="80" rx="6" fill="#fff" '
            'stroke="#000"/></svg>\n',
        )
        d4 = next(
            (
                d
                for d in (p4 or {}).get("diagnostics", [])
                if d.get("code") == "connector/attachment-fan"
            ),
            {},
        )
        check(
            "Strict: rule 4 detects 4px attachment gap and reports distance",
            r4.returncode != 0
            and codes == ["connector/attachment-fan"]
            and abs(d4.get("evidence", {}).get("separationPx", 0) - 4) < 1e-6
            and d4.get("subject", {}).get("edge") == "right",
            str(codes) + " " + str(d4.get("evidence")),
        )

        # Control: attachment points 16px apart on the same side must pass.
        codes_ok, _p, r_ok = seeded(
            "fan-ok.html",
            '<svg viewBox="0 0 400 200">'
            '<line x1="200" y1="100" x2="260" y2="100" marker-end="url(#a)"/>'
            '<line x1="200" y1="116" x2="260" y2="116" marker-end="url(#a)"/>'
            '<rect x="40" y="60" width="160" height="80" rx="6" fill="#fff" '
            'stroke="#000"/></svg>\n',
        )
        check(
            "Strict: rule 4 control passes at 16px",
            r_ok.returncode == 0 and codes_ok == [],
            str(codes_ok),
        )

        # Rule 2 — Mask is 4px from the connector.
        codes2, p2, r2s = seeded(
            "gap.html",
            '<svg viewBox="0 0 400 200">'
            '<line x1="40" y1="100" x2="360" y2="100" marker-end="url(#a)"/>'
            '<line x1="40" y1="160" x2="360" y2="160" marker-end="url(#a)"/>'
            '<rect x="100" y="84" width="60" height="12" rx="2" '
            'fill="#f5f5f5"/></svg>\n',
        )
        d2 = next(
            (
                d
                for d in (p2 or {}).get("diagnostics", [])
                if d.get("code") == "connector/label-gap"
            ),
            {},
        )
        check(
            "Strict: rule 2 detects 4px label gap",
            r2s.returncode != 0
            and codes2 == ["connector/label-gap"]
            and abs(d2.get("evidence", {}).get("gapPx", 0) - 4) < 1e-6,
            str(codes2) + " " + str(d2.get("evidence")),
        )

        codes2ok, _p, r2ok = seeded(
            "gap-ok.html",
            '<svg viewBox="0 0 400 200">'
            '<line x1="40" y1="100" x2="360" y2="100" marker-end="url(#a)"/>'
            '<line x1="40" y1="160" x2="360" y2="160" marker-end="url(#a)"/>'
            '<rect x="100" y="82" width="60" height="12" rx="2" '
            'fill="#f5f5f5"/></svg>\n',
        )
        check(
            "Strict: rule 2 control passes at 6px",
            r2ok.returncode == 0 and codes2ok == [],
            str(codes2ok),
        )

        # Rule 5 — Solid line through third box. The name of the condition that was violated appears in evidence.
        codes5, p5, r5 = seeded(
            "third.html",
            '<svg viewBox="0 0 600 200">'
            '<line x1="40" y1="100" x2="560" y2="100" marker-end="url(#a)"/>'
            '<line x1="40" y1="180" x2="560" y2="180" marker-end="url(#a)"/>'
            '<rect x="200" y="70" width="160" height="60" rx="6" fill="#fff" '
            'stroke="#000"/></svg>\n',
        )
        d5 = next(
            (
                d
                for d in (p5 or {}).get("diagnostics", [])
                if d.get("code") == "connector/third-box-transit"
            ),
            {},
        )
        check(
            "Strict: rule 5 detects solid-line traversal and names failed condition",
            r5.returncode != 0
            and codes5 == ["connector/third-box-transit"]
            and d5.get("evidence", {}).get("failedConditions") == ["stroke-dasharray"],
            str(codes5) + " " + str(d5.get("evidence", {}).get("failedConditions")),
        )

        # Rule 5 exception: dashed lines expressed through CSS classes must count;
        # reading attributes alone misses `class="connector auth"`.
        codes5ok, _p, r5ok = seeded(
            "third-dashed.html",
            '<svg viewBox="0 0 600 200"><style>'
            ".connector{stroke:#4f5d75}.connector.transit{stroke-dasharray:4 3}"
            "</style>"
            '<line class="connector transit" x1="40" y1="100" x2="560" y2="100" '
            'marker-end="url(#a)"/>'
            '<line class="connector" x1="40" y1="180" x2="560" y2="180" '
            'marker-end="url(#a)"/>'
            '<rect x="200" y="70" width="160" height="60" rx="6" fill="#fff" '
            'stroke="#000"/></svg>\n',
        )
        check(
            "Strict: rule 5 exception reads dashed CSS class",
            r5ok.returncode == 0 and codes5ok == [],
            str(codes5ok),
        )

        # Treat compound selectors atomically. Splitting `.connector.transit` into
        # two keys can misclassify a plain `.connector` as dashed.
        codes5b, _p, r5b = seeded(
            "third-plain.html",
            '<svg viewBox="0 0 600 200"><style>'
            ".connector{stroke:#4f5d75}.connector.transit{stroke-dasharray:4 3}"
            "</style>"
            '<line class="connector" x1="40" y1="100" x2="560" y2="100" '
            'marker-end="url(#a)"/>'
            '<line class="connector" x1="40" y1="180" x2="560" y2="180" '
            'marker-end="url(#a)"/>'
            '<rect x="200" y="70" width="160" height="60" rx="6" fill="#fff" '
            'stroke="#000"/></svg>\n',
        )
        check(
            "Strict: compound selectors remain intact (dashed exemption does not leak)",
            r5b.returncode != 0 and "connector/third-box-transit" in codes5b,
            str(codes5b),
        )

        # Taste checks: transparent masks and vertical writing.
        codesm, _p, rm = seeded(
            "maskfill.html",
            '<svg viewBox="0 0 400 200">'
            '<line x1="40" y1="100" x2="360" y2="100" marker-end="url(#a)"/>'
            '<line x1="40" y1="160" x2="360" y2="160" marker-end="url(#a)"/>'
            '<rect x="100" y="82" width="60" height="12" rx="2" '
            'fill="none"/></svg>\n',
        )
        check(
            "Strict: taste check detects transparent label mask",
            rm.returncode != 0 and codesm == ["taste/mask-fill"],
            str(codesm),
        )

        codesw, _p, rw2 = seeded(
            "wm.html",
            '<svg viewBox="0 0 400 200">'
            '<line x1="40" y1="100" x2="360" y2="100" marker-end="url(#a)"/>'
            '<line x1="40" y1="160" x2="360" y2="160" marker-end="url(#a)"/>'
            '<text x="10" y="50" writing-mode="vertical-rl" font-size="12">'
            "세로</text></svg>\n",
        )
        check(
            "Strict: taste check detects vertical writing-mode",
            rw2.returncode != 0 and codesw == ["taste/writing-mode"],
            str(codesw),
        )

        # A zone container is not a third box; otherwise every zoned faithful-density
        # diagram fails.
        codesz, _p, rz = seeded(
            "zone.html",
            '<svg viewBox="0 0 600 300">'
            '<line x1="40" y1="100" x2="560" y2="100" marker-end="url(#a)"/>'
            '<line x1="40" y1="260" x2="560" y2="260" marker-end="url(#a)"/>'
            '<rect x="180" y="60" width="240" height="120" rx="8" '
            'fill="rgba(0,0,0,0.02)" stroke="#ccc"/>'
            '<rect x="200" y="120" width="160" height="40" rx="6" fill="#fff" '
            'stroke="#000"/></svg>\n',
        )
        check(
            "Strict: crossing a zone container does not trigger rule 5",
            rz.returncode == 0 and codesz == [],
            str(codesz),
        )

    # --- Width check (H-3, rewrite of up:archify text-fit.mjs/utils.mjs) -----
    # ASCII examples cannot establish the CJK path, so inject a Korean mutation.
    tw = os.path.join(ROOT, "scripts", "verify-text-width.py")
    check("Width: verify-text-width.py exists", os.path.exists(tw))
    if os.path.exists(tw):
        rw = subprocess.run(
            [sys.executable, tw, "--all"], capture_output=True, text=True, cwd=ROOT
        )
        check(
            "Width: four example assets have no overflow",
            rw.returncode == 0,
            "" if rw.returncode == 0 else rw.stdout.strip()[-200:],
        )

        # Publish independent coverage counts. Zero findings cannot distinguish a
        # clean artifact from a parser that never reached any labels.
        def measured(*argv):
            r = subprocess.run(
                [sys.executable, tw, *argv], capture_output=True, text=True, cwd=ROOT
            )
            m = re.search(r"measured (\d+) of (\d+) label\(s\)", r.stdout)
            return (int(m.group(1)) if m else -1, int(m.group(2)) if m else -1), r

        (n_all, t_all), _ = measured("--all")
        check("Width: measured label count is 96", n_all == 96, f"{n_all} labels")
        check(
            "Width: coverage denominator is 128 total text elements",
            t_all == 128,
            f"{t_all} labels",
        )
        rj = subprocess.run(
            [sys.executable, tw, "--all", "--json"],
            capture_output=True,
            text=True,
            cwd=ROOT,
        )
        try:
            wp = json.loads(rj.stdout)
        except ValueError:
            wp = None
        check(
            "Width: --json output is valid JSON and identifies source",
            bool(wp)
            and wp.get("schemaVersion") == 1
            and wp.get("source") == "verify-text-width",
            (rj.stdout or rj.stderr).strip()[:80],
        )
        pf = {
            k: (v.get("measured"), v.get("texts"))
            for k, v in ((wp or {}).get("summary", {}).get("perFile") or {}).items()
        }
        check(
            "Width: per-file measured/total counts match (23/32, 35/41, 21/28, 17/27)",
            pf
            == {
                "example-architecture.html": (23, 32),
                "example-dp-integration.html": (35, 41),
                "example-sequence-oauth.html": (21, 28),
                "example-swimlane.html": (17, 27),
            },
            str(pf)[:160],
        )
        # Report why 32 texts are skipped: legend and lane headers lack containers.
        check(
            "Width: unmeasured reasons match (32 uncontained, all others zero)",
            (wp or {}).get("summary", {}).get("skipped")
            == {"noContainer": 32, "unmeasurable": 0, "outOfScope": 0},
            str((wp or {}).get("summary", {}).get("skipped"))[:120],
        )

        with tempfile.TemporaryDirectory() as td:
            swim = read(os.path.join(ROOT, "assets", "example-swimlane.html"))
            # Replace a 52px-mask ASCII label with Korean. The modeled width is
            # 88px > 52+4, leaving enough margin for coefficient changes.
            ko = swim.replace(">REVISE</text>", ">본문 검토 반려 요청</text>", 1)
            check("Width: Korean-label mutation changed the file", ko != swim)
            kp = os.path.join(td, "ko.html")
            with open(kp, "w", encoding="utf-8") as f:
                f.write(ko)
            (n_ko, _t_ko), r_ko = measured(kp)
            check(
                "Width: detects injected Korean label",
                r_ko.returncode != 0,
                "" if r_ko.returncode != 0 else "validator passed after Korean overflow was injected",
            )
            # Independently require the mutation to reach the parser; a lower label
            # count means parser loss, not successful rejection.
            check(
                "Width: measured label count remains 17 after Korean mutation",
                n_ko == 17,
                f"{n_ko} labels",
            )

            # Do not substitute a default size. An early prototype silently used
            # 12px and mismeasured dp-integration.
            nofs = swim.replace(
                ' font-size="11" font-weight="600"', ' font-weight="600"', 1
            )
            check("Width: font-size removal changed the file", nofs != swim)
            np_ = os.path.join(td, "nofs.html")
            with open(np_, "w", encoding="utf-8") as f:
                f.write(nofs)
            r_nf = subprocess.run(
                [sys.executable, tw, np_, "--json"],
                capture_output=True,
                text=True,
                cwd=ROOT,
            )
            try:
                nfp = json.loads(r_nf.stdout)
            except ValueError:
                nfp = None
            codes = [d.get("code") for d in (nfp or {}).get("diagnostics", [])]
            check(
                "Width: unreadable font-size emits text/unmeasurable",
                r_nf.returncode != 0 and "text/unmeasurable" in codes,
                str(codes)[:80],
            )

            # Missing files must report input/read without a traceback.
            r_missing = subprocess.run(
                [sys.executable, tw, os.path.join(td, "nope.html"), "--json"],
                capture_output=True,
                text=True,
                cwd=ROOT,
            )
            check(
                "Width: missing file emits input/read without traceback",
                r_missing.returncode != 0
                and '"input/read"' in r_missing.stdout
                and "Traceback" not in r_missing.stderr,
                r_missing.stderr.strip()[-80:],
            )

            # Non-UTF-8 files must likewise report a read failure without traceback.
            bp = os.path.join(td, "cp949.html")
            with open(bp, "wb") as f:
                f.write(
                    '<svg><rect x="0" y="0" width="40" height="12"/>'
                    '<text x="20" y="9" font-size="8">한글</text></svg>'.encode("cp949")
                )
            r_dec = subprocess.run(
                [sys.executable, tw, bp, "--json"],
                capture_output=True,
                text=True,
                cwd=ROOT,
            )
            check(
                "Width: non-UTF-8 file emits input/decode without traceback",
                r_dec.returncode != 0
                and '"input/decode"' in r_dec.stdout
                and "Traceback" not in r_dec.stderr,
                r_dec.stderr.strip()[-80:],
            )

            # --- False-positive and false-negative regression net ----------------
            # These are valid SVG idioms that previously caused two false positives
            # and two missed overflows.
            def probe(name, body):
                p = os.path.join(td, name)
                with open(p, "w", encoding="utf-8") as f:
                    f.write(body)
                r = subprocess.run(
                    [sys.executable, tw, p, "--json"],
                    capture_output=True,
                    text=True,
                    cwd=ROOT,
                )
                try:
                    return json.loads(r.stdout), r
                except ValueError:
                    return None, r

            # (1) An element-selector font-size must be read, not only class selectors.
            el_p, el_r = probe(
                "elemsel.html",
                (
                    "<html><head><style>svg text{font-size:12px}</style></head><body>"
                    '<svg viewBox="0 0 400 200">'
                    '<rect x="20" y="60" width="160" height="48" rx="6"/>'
                    '<text x="100" y="88" text-anchor="middle">Node name</text>'
                    "</svg></body></html>\n"
                ),
            )
            check(
                "Width: element selector svg text{font-size} parses without false positive",
                el_r.returncode == 0
                and (el_p or {}).get("diagnostics") == []
                and (el_p or {}).get("summary", {}).get("labels") == 1,
                str((el_p or {}).get("diagnostics"))[:120],
            )

            # (2) Support nodes grouped with `<g transform="translate(...)">`.
            g_p, g_r = probe(
                "gtranslate.html",
                (
                    '<svg viewBox="0 0 400 200"><g transform="translate(100 40)">'
                    '<rect x="0" y="0" width="160" height="48" rx="6"/>'
                    '<text x="80" y="28" font-size="12" text-anchor="middle">'
                    "Node name</text></g></svg>\n"
                ),
            )
            check(
                "Width: label inside translated group measures without false positive",
                g_r.returncode == 0
                and (g_p or {}).get("diagnostics") == []
                and (g_p or {}).get("summary", {}).get("labels") == 1,
                str((g_p or {}).get("diagnostics"))[:120],
            )

            # (3) Zone label: a 16px mask outside `8<=h<=14` was once paired with
            # a 696px zone rectangle, hiding a 1.4x overflow.
            z_p, z_r = probe(
                "zone.html",
                (
                    '<svg viewBox="0 0 800 400">'
                    '<rect x="60" y="72" width="696" height="336" rx="8"/>'
                    '<rect x="548" y="68" width="120" height="16" rx="2"/>'
                    '<text x="608" y="79" font-size="8" letter-spacing="0.18em" '
                    'text-anchor="middle">DATA PLATFORM XXXXXXXXXX</text></svg>\n'
                ),
            )
            z_over = [
                d
                for d in (z_p or {}).get("diagnostics", [])
                if d.get("code") == "text/overflow"
            ]
            check(
                "Width: zone label pairs with its mask rather than zone rectangle",
                z_r.returncode != 0
                and len(z_over) == 1
                and z_over[0]["evidence"]["containerWidth"] == 120,
                str((z_p or {}).get("diagnostics"))[:120],
            )

            # (4) A 12px CJK label with a mask taller than 14px must still be measured.
            c_p, c_r = probe(
                "cjk12.html",
                (
                    '<svg viewBox="0 0 800 400">'
                    '<rect x="40" y="40" width="120" height="20" rx="2"/>'
                    '<text x="100" y="55" font-size="12" text-anchor="middle">'
                    "인증 서비스 게이트웨이 라벨</text></svg>\n"
                ),
            )
            check(
                "Width: CJK 12px label with 20px mask is not silently skipped",
                c_r.returncode != 0
                and (c_p or {}).get("summary", {}).get("labels") == 1
                and any(
                    d.get("code") == "text/overflow"
                    for d in (c_p or {}).get("diagnostics", [])
                ),
                str((c_p or {}).get("summary"))[:120],
            )

            # (5) Honor text-anchor="start" when a label extends beyond the right
            # edge; width-only comparison previously counted it as a passing measure.
            a_p, a_r = probe(
                "anchor.html",
                (
                    '<svg viewBox="0 0 800 400">'
                    '<rect x="40" y="40" width="200" height="48" rx="6"/>'
                    '<text x="235" y="70" font-size="12" text-anchor="start">'
                    "sticking out</text></svg>\n"
                ),
            )
            a_over = [
                d
                for d in (a_p or {}).get("diagnostics", [])
                if d.get("code") == "text/overflow"
            ]
            check(
                "Width: honors anchor and catches overflowing start-aligned label",
                a_r.returncode != 0
                and len(a_over) == 1
                and a_over[0]["evidence"]["overflowSide"] == "right",
                str((a_p or {}).get("diagnostics"))[:120],
            )

            # (6) Emit out-of-scope for rotated text, which cannot be compared with an
            # axis-aligned box. Silent omission would inflate coverage.
            ro_p, ro_r = probe(
                "rotate.html",
                (
                    '<svg viewBox="0 0 400 200"><g transform="rotate(-90 60 60)">'
                    '<rect x="20" y="40" width="80" height="16" rx="2"/>'
                    '<text x="60" y="52" font-size="8" text-anchor="middle">'
                    "ROTATED</text></g></svg>\n"
                ),
            )
            check(
                "Width: rotated text emits text/out-of-scope and is excluded from measurement",
                ro_r.returncode == 0
                and [d.get("code") for d in (ro_p or {}).get("diagnostics", [])]
                == ["text/out-of-scope"]
                and (ro_p or {}).get("summary", {}).get("labels") == 0,
                str((ro_p or {}).get("diagnostics"))[:120],
            )

    # Both source and docs must disclose that coefficients are provisional rather
    # than measured font advances.
    tw_src = read(tw) if os.path.exists(tw) else ""
    check(
        "Width: docstring identifies coefficients as provisional",
        "provisional" in tw_src and "not been measured" in tw_src,
    )
    check(
        "Width: source explains why upstream formula was not copied",
        "6.5px" in tw_src and "false positives" in tw_src,
    )
    # Documentation must disclose intentional implementation divergence.
    check(
        "Width: SKILL.md instructs validator execution",
        "scripts/verify-text-width.py" in skill,
    )
    check(
        "Width: SKILL.md identifies coefficients as provisional",
        "provisional" in skill and "ASCII 0.6em" in skill,
    )
    check(
        "Width: SKILL.md limitations disclose divergence from upstream",
        "6.5px × units + 13px" in skill
        and "diverges from archify" in skill
        and "does not validate the CJK path" in skill,
    )
    check(
        "Source: NOTICE records imported width formula and divergence",
        "text-fit.mjs" in notice
        and "20124265300eb286" in notice
        and "deliberately" in notice and "diverges" in notice,
    )
    check(
        "Source: NOTICE explains why rewrite is absent from UPSTREAM.sha256",
        "byte-identical imports" in notice,
    )

    check(
        "Source: LICENSE.archify is complete MIT text with terms intact",
        "MIT License" in lic2
        and "WITHOUT WARRANTY" in lic2
        and "Permission is hereby granted" in lic2,
        "a license name without the complete text is not sufficient notice",
    )
    check(
        "Source: archify dual copyright is preserved",
        "tt-a1i" in lic2 and "Cocoon AI" in lic2,
        "upstream also credits architecture-diagram-generator",
    )
    check(
        "Source: NOTICE identifies archify import scope",
        "up:archify" in notice and "Orthogonality" in notice,
    )
    # The imported diagnostic schema must disclose divergences from upstream.
    check(
        "Source: NOTICE records diagnostic schema import and supportedFixes divergence",
        "diagnostics.mjs" in notice
        and "supportedFixes" in notice
        and "object array" in notice,
    )

    # (5) All six connector rules must remain in the reference.
    conn = read(os.path.join(ROOT, "references", "connector-rules.md"))
    tg = read(os.path.join(ROOT, "references", "taste-gate.md"))
    # Rule 0 precedes the six rules. Without paint order, the validator can always
    # return zero findings; line survival cannot catch deletion of one line.
    check(
        "Rule 0: draw-arrows-before-boxes prerequisite exists",
        "Draw arrows before boxes" in conn and "prerequisite" in conn,
    )
    check("Rule 0: explains why this is a validator prerequisite", "zero findings" in conn)
    (
        check(
            "Rule 0: also appears in SKILL.md and taste-gate",
            "draw arrows before boxes" in skill and "Were arrows drawn before boxes?" in tg,
        ),
    )
    heads = re.findall(r"(?m)^## \d+\.", conn)
    check("Six rules: all six clauses exist", len(heads) == 6, f"{len(heads)} rules")
    # Rule 5's exception requires all three conditions; check each independently.
    for cond, why in (
        ("stroke-dasharray", "dashed line"),
        ("visible end", "label placement"),
        ("actual destination", "arrowhead destination"),
    ):
        check(f"Rule 5 exception: {why} condition exists", cond in conn)
    for needle, why in (
        ("automatically fail", "diagonal-failure strength"),
        ("6–10px", "label-to-connector clearance"),
        ("≥12px", "attachment and parallel spacing"),
        ("stroke-dasharray", "rule 5 dashed exception"),
        ("painted later", "rule 6 paint order"),
    ):
        check(f"Six rules: {why} exists in the reference", needle in conn)

    # Rule 3 documentation must match both enforcement and limitations.
    for needle, why in (
        ("Collinear", "overlap basis (same axis and fixed coordinate)"),
        ("8px", "overlap threshold"),
        ("Drawing a rounded", "hop proxy behavior"),
        ("sibling exemption", "stricter-than-upstream disclosure"),
        ("--no-crossings", "false-positive escape hatch"),
        ("verify-connectors.py", "rules 1 and 3 validator path"),
    ):
        check(f"Rule 3: {why} exists in the reference", needle in conn)
    check(
        "Rule 3: discloses unenforced near-parallel proximity",
        "Near-parallel noncollinear" in conn and "visual inspection" in conn,
    )
    check(
        "Rule 3: SKILL.md reports five machine-checked rules",
        "Five of the six connector rules are machine-checked" in skill,
        "the limitations become false if the enforced count remains stale",
    )

    # (6) Type-specific placement grammar imported from up:archify. Lock routing
    # as well as content. A missing file must yield named failures and allow later
    # checks to run, rather than aborting the suite with FileNotFoundError.
    tp_path = os.path.join(ROOT, "references", "type-placement.md")
    tp = read(tp_path) if os.path.exists(tp_path) else ""
    # Distinguish parser failure from a wrong set of five types.
    tp_heads = re.findall(
        r"(?m)^## (architecture|workflow|sequence|dataflow|lifecycle)\b", tp
    )
    if not tp_heads:
        check(
            "Placement: all five type sections exist",
            False,
            "parsed no type sections; update this check if heading format changed",
        )
    else:
        check(
            "Placement: all five type sections exist",
            sorted(set(tp_heads))
            == ["architecture", "dataflow", "lifecycle", "sequence", "workflow"],
            f"{sorted(set(tp_heads))}",
        )

    # Routing: an L2 reference is dead unless L1 points to it.
    check(
        "Placement: SKILL.md points to type-placement reference",
        "references/type-placement.md" in skill,
    )
    m_tp = re.search(r"(?m)^\|\s*`references/type-placement\.md`\s*\|([^|]*)\|", skill)
    # Treat a routing-table parse failure as a failure.
    check(
        "Placement: reference map has a type-placement row",
        m_tp is not None,
        ""
        if m_tp
        else "could not parse row; update this check if backtick or spacing format changed",
    )
    check(
        "Placement: SKILL.md routing contains all five type names",
        all(
            t in skill
            for t in ("architecture", "workflow", "sequence", "dataflow", "lifecycle")
        ),
    )

    # Apply multiple axes to SKILL.md and require zero orphaned owned files.
    # Strip HTML comments so invisible strings cannot satisfy routing contracts.
    def live_text(body):
        """Return prose with HTML comments removed for routing checks."""
        return re.sub(r"<!--.*?-->", "", body, flags=re.S)

    # Probe the helper directly so an identity implementation cannot weaken routing.
    _probe = "<!-- scripts/nope.py -->\nThe body cites scripts/yes.py.\n"
    check(
        "Routing: paths inside HTML comments do not count as citations",
        "scripts/nope.py" not in live_text(_probe)
        and "scripts/yes.py" in live_text(_probe),
        repr(live_text(_probe))[:80],
    )
    skill_live = live_text(skill)

    OWNED = [
        "references/type-placement.md",
        "references/connector-rules.md",
        "references/output-spec.md",
        "references/taste-gate.md",
        "references/export.md",
        "references/cjk-contract.md",
        "references/font-delivery.md",
        "scripts/verify-geometry.py",
        "scripts/verify-connectors.py",
        "scripts/verify-text-width.py",
        "scripts/measure_label.py",
        "scripts/check_effective_size.py",
        "scripts/export_scale.py",
        "scripts/repair_png.py",
        "scripts/subset_fonts.py",
        "scripts/encode_drawio_url.py",
        "scripts/test-verify-geometry.py",
        "tests/run_tests.py",
        "tests/test_cjk_contract.py",
        "tests/_test_artifact_e2e.py",
        # Four shipped examples used to execute validators; suite-only knowledge
        # would make them unavailable to users.
        "assets/example-architecture.html",
        "assets/example-dp-integration.html",
        "assets/example-sequence-oauth.html",
        "assets/example-swimlane.html",
    ]
    orphans = [rel for rel in OWNED if rel not in skill_live]
    check(
        f"Citation: SKILL.md names all {len(OWNED)} owned files (zero orphans)",
        not orphans,
        f"uncited {orphans}",
    )
    # Compare the manual ownership list with disk so new files cannot escape it.
    _actual = sorted(
        os.path.join(d, n).replace(ROOT + os.sep, "")
        for d in (
            os.path.join(ROOT, "references"),
            os.path.join(ROOT, "scripts"),
            os.path.join(ROOT, "assets"),
            os.path.join(ROOT, "tests"),
        )
        if os.path.isdir(d)
        for n in os.listdir(d)
        if n.endswith((".md", ".py", ".html"))
    )
    check(
        "Citation: OWNED covers every reference, script, asset, and test",
        sorted(OWNED) == _actual,
        f"unlisted {sorted(set(_actual) - set(OWNED))} / "
        f"missing on disk {sorted(set(OWNED) - set(_actual))}",
    )

    # Script completeness: an unregistered script has no mutation contract.
    # Derive the actual set from disk and compare it with SCRIPT_FLOORS.
    _scripts_dir = os.path.join(ROOT, "scripts")
    _actual_scripts = sorted(
        "scripts/" + n
        for n in (os.listdir(_scripts_dir) if os.path.isdir(_scripts_dir) else [])
        if n.endswith(".py")
    )
    check(
        "Script completeness: SCRIPT_FLOORS lists every scripts/*.py file",
        sorted(SCRIPT_FLOORS) == _actual_scripts,
        f"unlisted {sorted(set(_actual_scripts) - set(SCRIPT_FLOORS))} / "
        f"missing on disk {sorted(set(SCRIPT_FLOORS) - set(_actual_scripts))}",
    )
    check(
        "Script completeness: listed count matches measured 10",
        len(_actual_scripts) == 10,
        f"{len(_actual_scripts)} scripts; register new scripts with a floor",
    )

    # Invocation reachability: naming a path in prose is not an executable example.
    # Every user-facing script needs an invocable command line.
    RUNNABLE = [
        rel
        for rel in SCRIPT_FLOORS
        # The suite runs the self-test; users do not invoke it directly.
        if rel != "scripts/test-verify-geometry.py"
    ]
    for rel in sorted(RUNNABLE):
        needle = "${JSTACK_PLUGIN_ROOT}/skills/diagram/" + rel
        check(
            f"Invocation example: SKILL.md shows how to run {rel}",
            needle in skill_live,
            "a prose mention does not show how to invoke it",
        )

    # Section-pointer reachability. Each cited section must have a real heading.
    POINTERS = {
        "Legend exclusion markers": "references/connector-rules.md",
        "Why rules 2, 4, and 5 are disabled by default": "references/connector-rules.md",
        "Diagnostic contract": "references/connector-rules.md",
        "Visual review at delivery": "references/taste-gate.md",
        "Local adaptations": "references/output-spec.md",
        "Procurement complexity budget": "references/output-spec.md",
        "Grayscale legibility": "references/output-spec.md",
        "Legend placement": "references/output-spec.md",
        "Limitations": "SKILL.md",
    }
    for label, target in sorted(POINTERS.items()):
        body = read(os.path.join(ROOT, target)) if os.path.exists(
            os.path.join(ROOT, target)
        ) else ""
        heads = re.findall(r"(?m)^#{1,4} (.+?)\s*$", body)
        check(
            f"Pointer: `{label}` names a real section in {target}",
            any(h.startswith(label) or label in h for h in heads),
            "heading missing; remove the citation too if the section was deleted",
        )

    # Keep the declaration list bidirectional. English prose names a section as
    # "the X section of `references/...`"; adding that form without declaring
    # its target must fail. Two prose aliases map to their actual heading names.
    pointer_aliases = {
        "Korean font contract": "Korean font contract: the core requirement",
        "local changes": "Local adaptations",
    }

    def undeclared_section_pointers(text):
        found = re.findall(
            r"(?i)\bthe ([a-z][a-z0-9 -]+?) section of "
            r"`references/[a-z0-9_-]+\.md`",
            text,
        )
        declared = set(POINTERS) | set(pointer_aliases.values())
        return sorted(
            label
            for raw in found
            for label in [pointer_aliases.get(raw, raw)]
            if label not in declared
        )

    _undeclared = undeclared_section_pointers(skill_live)
    _negative = undeclared_section_pointers(
        skill_live
        + "\nSee the Undeclared negative control section of "
        "`references/output-spec.md`.\n"
    )
    check(
        "Pointer: every SKILL.md section citation is declared",
        not _undeclared and _negative == ["Undeclared negative control"],
        f"undeclared {_undeclared} / negative control {_negative}",
    )

    # The prose claim names five scripts whose own Limitations sections must exist.
    _limit_claim = next(
        (
            para
            for para in skill_live.split("\n- ")
            if "See each file's limitations" in para
        ),
        "",
    )
    check(
        "Pointer: SKILL.md contains its per-script limitations claim",
        bool(_limit_claim),
        "`See each file's limitations` claim missing",
    )
    LIMIT_CLAIMED = sorted(
        {"scripts/" + n for n in re.findall(r"`([a-z_]+\.py)`", _limit_claim)}
    )
    # Keep the population fixed so deleting the prose does not erase checks.
    LIMIT_SCRIPTS = [
        "scripts/check_effective_size.py",
        "scripts/export_scale.py",
        "scripts/measure_label.py",
        "scripts/repair_png.py",
        "scripts/subset_fonts.py",
    ]
    check(
        "Pointer: prose claim names the declared five scripts",
        LIMIT_CLAIMED == sorted(LIMIT_SCRIPTS),
        f"claim {LIMIT_CLAIMED} / declared {sorted(LIMIT_SCRIPTS)}",
    )
    for rel in LIMIT_SCRIPTS:
        src = read(os.path.join(ROOT, rel)) if os.path.exists(
            os.path.join(ROOT, rel)
        ) else ""
        check(
            f"Pointer: {rel} has a Limitations section",
            re.search(r"(?m)^(?:#{1,3} )?Limitations\b", src) is not None,
            "SKILL.md points to this file's limitations, but the section is absent",
        )

    check_skill_body(
        check,
        ROOT,
        needles=[
            "| `diagram` | `image` |",
            "are there relationships between elements?",
            "'Apple SD Gothic Neo', 'Noto Sans KR', 'Malgun Gothic'",
            "draw arrows before boxes",
            "print-a4-landscape",
            "Automated checks",
            "Visual inspection",
            "up:diagram-design",
            "references/type-placement.md",
            "Choose the type",
            "scripts/verify-text-width.py",
            # Delivery contract and diagnostic-envelope procedure.
            "## Phase 5: delivery",
            "`visual_review: pending`",
            "--strict-deletion",
            # Route new deliverables so files do not become orphans.
            "--strict-rules",
            "scripts/measure_label.py",
            "scripts/check_effective_size.py",
            "references/cjk-contract.md",
            "references/font-delivery.md",
        ],
        floor=16226,
    )

    # up:archify visual review. Only the document contract was imported, so
    # sentence-level checks are its sole enforcement. Complete clauses catch
    # reversals that token needles missed, while the document discloses that
    # contradictory additions can still escape presence checks.
    for why, clause in (
        ("pending status row", "| `visual_review: pending` | **Only automated capture or measurement was performed.** A screenshot is review material, not a passing verdict |"),
        ("passed status row", "| `visual_review: passed` | A person or image reader **actually inspected** the rendered artifact |"),
        ("failed status row", "| `visual_review: failed` | Inspection found concrete defects; record them |"),
        ("skipped status row", "| `visual_review: skipped (이미지 리더 없음)` | No means of viewing the artifact was available |"),
        ("automation cannot promote status", "Passing automated measurements **does not promote** `pending` to `passed`."),
        ("overflow prohibition introduction", "Do not obtain a pass through:"),
        ("prohibition 1: cropping wrappers", "- `overflow: hidden`, `clipPath`, or wrappers that crop SVG."),
        ("prohibition 2: clipped labels", "- Content clipping that reports a truncated label as fitting."),
        ("prohibition 3: typography reduction", "- **Typography reduction**: going below the 12px floor in `output-spec.md` automatically fails."),
        ("prohibition 4: broken aspect ratio", "- Stretching the SVG and breaking its aspect ratio."),
        ("repair order", "Repair in this order: **deletion -> spacing compression -> node/label reduction**."),
        ("no-enforcement disclosure", "**This section has no validator.**"),
        ("needle limitation disclosure", "**cannot detect contradictory additions that leave the originals intact**"),
    ):
        check(
            f"Visual review: complete clause remains — {why}",
            clause in tg,
            "clause changed; update this needle only for a legitimate contract revision",
        )
    check(
        "Visual review: document defines exactly four statuses",
        "Four statuses" in tg and tg.count("| `visual_review: ") == 4,
        f"{tg.count('| `visual_review: ')} rows",
    )

    # This section alone is a post-output contract and must have a workflow caller.
    check(
        "Visual review: taste-gate distinguishes pre-output from delivery",
        "At delivery, after output" in tg and "Only this section is a post-output contract" in tg,
    )
    check(
        "Visual review: taste-gate heading names delivery timing",
        "## Visual review at delivery" in tg,
    )
    check(
        "Visual review: SKILL.md reference map introduces delivery contract",
        "delivery `visual_review` status contract" in skill,
    )
    check(
        "Visual review: SKILL.md has a delivery phase",
        "## Phase 5: delivery" in skill and "report one of the **four statuses**" in skill,
    )
    check(
        "Visual review: SKILL.md contains all four statuses",
        all(f"`visual_review: {st}" in skill for st in ("pending", "passed", "failed", "skipped")),
    )
    check(
        "Visual review: SKILL.md carries promotion ban and repair order",
        "does not promote `pending` to `passed`" in skill
        and "deletion -> spacing compression -> node/label reduction" in skill,
    )
    check(
        "Visual review: SKILL.md discloses self-reported delivery status",
        "self-reported" in skill and "No code enforces" in skill,
    )
    check(
        "Visual review: taste-gate points back to its caller",
        "`SKILL.md`, Phase 5, invokes it" in tg,
    )

    # NOTICE must track the imported delivery contract and its scope.
    check(
        "Source: NOTICE mapping table includes visual-review delivery contract",
        "| Delivery visual-review contract |" in notice and "delivery-contract.md" in notice,
    )
    check(
        "Source: NOTICE archify import scope includes four areas",
        "Four areas were imported" in notice and "visual-review contract" in notice,
        "a stale scope count would leave the new import outside provenance",
    )

    # Diagnostic envelope and deletion guard must be reachable from SKILL.md.
    # The baseline workflow requires two runs; without instructions it is disabled in use.
    for flag in ("--json", "--baseline", "--strict-deletion"):
        check(
            f"Envelope: SKILL.md invokes `{flag}`",
            flag in skill,
            "a suite-only flag is effectively disabled in use",
        )
    check(
        "Envelope: SKILL.md documents envelope fields",
        "schemaVersion" in skill and "supportedFixes" in skill,
    )
    check(
        "Envelope: SKILL.md documents two-run baseline workflow",
        "before.json" in skill and skill.count("before.json") >= 2,
        "one run leaves the deletion guard inactive",
    )
    check(
        "Envelope: SKILL.md says deletion is warning by default and strict only with flag",
        "repair/deletion-without-evidence" in skill
        and "By default this is a warning" in skill
        and "use `--strict-deletion`" in skill,
    )

    # Behavioral tests for six new scripts. Existence alone lets empty scripts pass.
    def run(rel, *argv):
        r = subprocess.run(
            [sys.executable, os.path.join(ROOT, rel), *argv],
            capture_output=True,
            text=True,
            cwd=ROOT,
        )
        try:
            return json.loads(r.stdout), r
        except ValueError:
            return None, r

    # measure_label uses an em cap rather than character count: the same 14
    # characters measure 14em in Korean and 7.7em in Latin.
    ml_p, ml_r = run(
        "scripts/measure_label.py",
        "--json",
        "가나다라마바사아자차카타파하",
        "abcdefghijklmn",
    )
    ml = {m["text"]: m for m in (ml_p or {}).get("measurements", [])}
    ko = ml.get("가나다라마바사아자차카타파하", {})
    la = ml.get("abcdefghijklmn", {})
    check(
        "Label: 14 Korean characters measure 14em",
        ko.get("em") == 14.0 and ko.get("chars") == 14,
        str(ko.get("em")),
    )
    check(
        "Label: same 14 Latin characters measure under 8em (7.7em)",
        la.get("chars") == 14 and la.get("em") == 7.7,
        str(la.get("em")),
    )
    check(
        "Label: value within 14em cap returns rc 0",
        ml_r.returncode == 0 and (ml_p or {}).get("ok") is True,
        str(ml_r.returncode),
    )
    # Mixed-script whitespace weighs 0.25em; treating it as full-width overstates masks.
    sp_p, _sp_r = run("scripts/measure_label.py", "--json", "가 나")
    sp = (sp_p or {}).get("measurements", [{}])[0]
    check(
        "Label: whitespace counts as 0.25em (`가 나` = 2.25em)",
        sp.get("em") == 2.25,
        str(sp.get("em")),
    )
    over_p, over_r = run(
        "scripts/measure_label.py",
        "--json",
        "--cap",
        "10",
        "가나다라마바사아자차카타파하",
    )
    check(
        "Label: exceeding cap returns rc 1 with label/em-cap",
        over_r.returncode == 1
        and [d.get("code") for d in (over_p or {}).get("diagnostics", [])]
        == ["label/em-cap"],
        str(over_r.returncode),
    )

    # (2) export_scale — clamp behavior and the **A3 exception** (C-38).
    a4_p, a4_r = run(
        "scripts/export_scale.py",
        "--json",
        "--viewbox-width",
        "1120",
        "--target-width",
        "4480",
        "--paper",
        "a4",
    )
    check(
        "Scale: 4x A4 export is within clamp",
        a4_r.returncode == 0
        and (a4_p or {}).get("result", {}).get("verdict") == "within-clamp"
        and (a4_p or {}).get("result", {}).get("scale") == 4.0,
        str((a4_p or {}).get("summary")),
    )
    a3_p, a3_r = run(
        "scripts/export_scale.py",
        "--json",
        "--viewbox-width",
        "1120",
        "--paper",
        "a3",
        "--dpi",
        "300",
    )
    a3 = (a3_p or {}).get("result", {})
    check(
        "Scale: A3 at 300dpi needs 4.43 and is allowed by exception",
        a3_r.returncode == 0
        and abs(a3.get("scale", 0) - 4.4291) < 1e-3
        and a3.get("verdict") == "unlocked"
        and abs(a3.get("effectiveDpi", 0) - 300) < 0.5,
        str(a3.get("scale")) + " " + str(a3.get("verdict")),
    )
    check(
        "Scale: exception-unlocked scale requires outlined fonts",
        a3.get("requiresOutlinedFonts") is True
        and "outline the fonts" in a3.get("message", ""),
        str(a3.get("requiresOutlinedFonts")),
    )
    # **If the exception leaks into A4, the clamp is effectively gone.** The same
    # multiplier must fail for A4; this control distinguishes scoped permission.
    bad_p, bad_r = run(
        "scripts/export_scale.py",
        "--json",
        "--viewbox-width",
        "1120",
        "--target-width",
        "4961",
        "--paper",
        "a4",
    )
    check(
        "Scale: same 4.43 fails for A4 (exception does not leak)",
        bad_r.returncode == 1
        and (bad_p or {}).get("result", {}).get("verdict") == "above-clamp",
        str((bad_p or {}).get("summary")),
    )
    # A non-vector destination (HWP/HWPX) also lifts the ceiling, an assumption
    # that L-12 requires the evidence to record.
    nv_p, nv_r = run(
        "scripts/export_scale.py",
        "--json",
        "--no-vector",
        "--viewbox-width",
        "1120",
        "--target-width",
        "4961",
        "--paper",
        "a4",
    )
    check(
        "Scale: unavailable vector delivery also lifts upper bound",
        nv_r.returncode == 0
        and (nv_p or {}).get("result", {}).get("verdict") == "unlocked",
        str((nv_p or {}).get("summary")),
    )

    # (3) check_effective_size — measure **effective pt**, not px (C-40).
    with tempfile.TemporaryDirectory() as td:

        def es(px, *argv):
            fp = os.path.join(td, f"es{px}.svg")
            with open(fp, "w", encoding="utf-8") as f:
                f.write(
                    f'<svg viewBox="0 0 1120 792"><text x="10" y="10" '
                    f'font-size="{px}">한글 라벨</text></svg>\n'
                )
            return run("scripts/check_effective_size.py", fp, "--json", *argv)

        p9, r9 = es(9)
        d9 = ((p9 or {}).get("diagnostics") or [{}])[0]
        check(
            "Effective size: 9px on print-a4 is 6.77pt, below 10pt floor",
            r9.returncode == 1
            and d9.get("code") == "text/effective-size"
            and abs(d9.get("evidence", {}).get("pt", 0) - 6.7653) < 1e-3,
            str(d9.get("evidence", {}).get("pt")),
        )
        # **Even 12px is too small**: the upstream 12px floor becomes 9.0pt on A4,
        # the concrete self-conflict identified by L-16.
        p12, r12 = es(12)
        d12 = ((p12 or {}).get("diagnostics") or [{}])[0]
        check(
            "Effective size: output-spec 12px floor is still 9.02pt on A4",
            r12.returncode == 1
            and abs(d12.get("evidence", {}).get("pt", 0) - 9.0204) < 1e-3,
            str(d12.get("evidence", {}).get("pt")),
        )
        p14, r14 = es(14)
        check(
            "Effective size: 14px passes at 10.5pt (floor is not constant)",
            r14.returncode == 0 and (p14 or {}).get("diagnostics") == [],
            str((p14 or {}).get("summary", {}).get("perFile")),
        )
        # At 60–70% of the HWP body width, the same 14px falls below the floor.
        ph, rh = es(14, "--hwp-fraction", "0.65")
        check(
            "Effective size: 14px fails when placed at 65% HWP width",
            rh.returncode == 1
            and (ph or {}).get("summary", {}).get("fraction") == 0.65,
            str((ph or {}).get("summary", {}).get("fraction")),
        )
        # Do not silently substitute a default when font-size cannot be read.
        nf = os.path.join(td, "nofs.svg")
        with open(nf, "w", encoding="utf-8") as f:
            f.write(
                '<svg viewBox="0 0 1120 792"><text x="10" y="10">한글</text></svg>\n'
            )
        pn, _rn = run("scripts/check_effective_size.py", nf, "--json")
        check(
            "Effective size: unreadable font-size emits diagnostic instead of default",
            [d.get("code") for d in (pn or {}).get("diagnostics", [])]
            == ["text/unmeasurable", "input/no-measurable-text"],
            str([d.get("code") for d in (pn or {}).get("diagnostics", [])]),
        )

        # (4-0) The Korean font stack remains in output-spec. A Japanese-stack
        # substitution once escaped both round-trip and structure checks.
        _osp = io.open(os.path.join(ROOT, "references", "output-spec.md"), encoding="utf-8").read()
        check("Font: output-spec example contains exact Korean stack", KO_STACK in _osp)
        # (4) encode_drawio_url — CJK round trip (X-2; cjk-contract item 1).
        dw = os.path.join(td, "d.drawio")
        xml = "<mxfile><diagram>인증 서비스 &amp; 게이트웨이</diagram></mxfile>"
        with open(dw, "w", encoding="utf-8") as f:
            f.write(xml)
        # Golden control: a self decode() round trip still passes if quoting is
        # removed. Pin the encoded result for a fixed input as a literal.
        _gd = tempfile.mkdtemp()
        try:
            _gp = os.path.join(_gd, "golden.drawio")
            io.open(_gp, "w", encoding="utf-8").write(
                '<mxfile><diagram id="x">가나다 label</diagram></mxfile>')
            _gr = run("scripts/encode_drawio_url.py", _gp)
            _gtxt = _gr[1] if isinstance(_gr, tuple) else _gr
            _gtxt = getattr(_gtxt, "stdout", _gtxt)
            _glines = str(_gtxt).strip().splitlines()
            _gout = _glines[-1] if _glines else ""  # Must finish on an empty copy.
            check("Encode: fixed-input URL matches golden including percent encoding",
                  _gout == 'https://viewer.diagrams.net/#RPYyxDoAgEEO%2FpvvlzgFHwPM%2FMKAhgcWJz%2Fck0aFJm7YPEvs4aysQhcRc03WnDqaaIRuYh%2Bnt1CMQHEEDHGN10wT4xcYtHaXZHbx%2FhImz%2FNMf', _gout[:60])
        finally:
            import shutil as _sh2
            _sh2.rmtree(_gd, ignore_errors=True)
        ep, er = run("scripts/encode_drawio_url.py", dw, "--json")
        url = (ep or {}).get("url", "")
        check(
            "draw.io: CJK diagram encodes into viewer fragment URL and round-trips",
            er.returncode == 0
            and (ep or {}).get("ok") is True
            and url.startswith("https://viewer.diagrams.net/#R"),
            url[:60],
        )
        rt = subprocess.run(
            [
                sys.executable,
                os.path.join(ROOT, "scripts", "encode_drawio_url.py"),
                "--decode",
                url,
            ],
            capture_output=True,
            text=True,
            cwd=ROOT,
        )
        check(
            "draw.io: decode returns original XML exactly",
            rt.returncode == 0 and rt.stdout.strip() == xml,
            rt.stdout.strip()[:60],
        )

        # (5) repair_png — truncated IEND and pHYs DPI (X-4).
        import binascii as _bin
        import struct as _st
        import zlib as _zl

        def _chunk(t, pl):
            return (
                _st.pack(">I", len(pl))
                + t
                + pl
                + _st.pack(">I", _bin.crc32(t + pl) & 0xFFFFFFFF)
            )

        png = (
            b"\x89PNG\r\n\x1a\n"
            + _chunk(b"IHDR", _st.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
            + _chunk(b"IDAT", _zl.compress(b"\x00\xff\xff\xff"))
            + _chunk(b"IEND", b"")
        )
        tr = os.path.join(td, "trunc.png")
        with open(tr, "wb") as f:
            f.write(png[:-12])
        cp, cr = run("scripts/repair_png.py", tr, "--check", "--json")
        check(
            "PNG: truncated IEND is invalid (rc 1)",
            cr.returncode == 1
            and (cp or {}).get("summary", {}).get("hasIend") is False,
            str((cp or {}).get("summary", {}).get("hasIend")),
        )
        fx = os.path.join(td, "fixed.png")
        fp_, fr = run("scripts/repair_png.py", tr, "--dpi", "300", "-o", fx, "--json")
        after = (fp_ or {}).get("summary", {}).get("after", {})
        check(
            "PNG: repair appends IEND and writes 300dpi pHYs",
            fr.returncode == 0
            and after.get("hasIend") is True
            and abs((after.get("dpi") or 0) - 300) < 1,
            str(after.get("dpi")),
        )
        gp, gr = run("scripts/repair_png.py", fx, "--check", "--json")
        check(
            "PNG: repaired file remains clean on recheck",
            gr.returncode == 0 and (gp or {}).get("ok") is True,
            str((gp or {}).get("summary", {}).get("badCrc")),
        )

        # (6) subset_fonts — tool pin, policy, and OFL alias enforcement (H-12–H-14).
        # The subset path itself is not run because no real font file is present.
        # SKILL.md records that limitation.
        sf_p, _sf_r = run("scripts/subset_fonts.py", "--probe", "--json")
        tool = (sf_p or {}).get("summary", {}).get("tool", {})
        check(
            "Font: probe reports fontTools pin 4.53.1 and installed version",
            tool.get("pinned") == "4.53.1"
            and "available" in tool
            and "version" in tool,
            str(tool),
        )
        check(
            "Font: envelope carries both fail-closed policies",
            (sf_p or {}).get("summary", {}).get("policy")
            == {"on_tool_missing": "stop", "on_glyph_missing": "stop"},
            str((sf_p or {}).get("summary", {}).get("policy")),
        )
        al_p, al_r = run(
            "scripts/subset_fonts.py",
            "--json",
            "--allow-version-drift",
            "--font",
            os.path.join(td, "nope.ttf"),
            "--out",
            os.path.join(td, "out.ttf"),
            "--text",
            "abc",
        )
        check(
            "Font: subset requires alias under OFL RFN",
            al_r.returncode == 1
            and [d.get("code") for d in (al_p or {}).get("diagnostics", [])]
            == ["license/alias-required"],
            str([d.get("code") for d in (al_p or {}).get("diagnostics", [])]),
        )
        nf_p, nf_r = run(
            "scripts/subset_fonts.py",
            "--json",
            "--allow-version-drift",
            "--alias",
            "jstack Sans KR",
            "--font",
            os.path.join(td, "nope.ttf"),
            "--out",
            os.path.join(td, "out.ttf"),
            "--text",
            "abc",
        )
        check(
            "Font: missing font emits input/read without traceback",
            nf_r.returncode == 1
            and [d.get("code") for d in (nf_p or {}).get("diagnostics", [])]
            == ["input/read"]
            and "Traceback" not in nf_r.stderr,
            nf_r.stderr.strip()[-60:],
        )

    # (7) The 21-item CJK contract suite must actually run.
    cjk = subprocess.run(
        [sys.executable, os.path.join(ROOT, "tests", "test_cjk_contract.py")],
        capture_output=True,
        text=True,
        cwd=ROOT,
    )
    check(
        "CJK: tests/test_cjk_contract.py passes",
        cjk.returncode == 0,
        (cjk.stdout or cjk.stderr).strip().splitlines()[-1][:100]
        if (cjk.stdout or cjk.stderr)
        else "no output",
    )
    n_cjk = len(re.findall(r"(?m)^\[(?:PASS|FAIL)\]", cjk.stdout))
    check("CJK: suite measures 13 results", n_cjk == 13, f"{n_cjk} results")

    check_ref_contracts(
        check,
        ROOT,
        [
            (
                "type-placement.md",
                "five-type placement grammar",
                [
                    "left-to-right spine",
                    "happy path",
                    "actual transition",
                    "Lane",
                    "participant",
                    "Stage",
                    "Local adaptations",
                ],
                4122,
            ),
            (
                "connector-rules.md",
                "all six connector rules and validator path",
                [
                    "automatically fail",
                    "6–10px",
                    "bridge/hop",
                    "L * k / (N + 1)",
                    "stroke-dasharray",
                    "verify-geometry.py",
                    # Diagnostic contract (H-4): envelope fields and five repair steps.
                    "schemaVersion",
                    "supportedFixes",
                    "requiresEvidence",
                    "connector/diagonal",
                    # Rule 3 (H-2): document enforcement and limitations together.
                    "Collinear",
                    "Drawing a rounded",
                    "sibling exemption",
                    "--no-crossings",
                ],
                14205,
            ),
            (
                "output-spec.md",
                "three dials and Korean font contract",
                [
                    "Apple SD Gothic Neo",
                    "Noto Sans Mono CJK KR",
                    "One full-width character equals 1em",
                    "12px",
                    "grayscale printing",
                    "## Procurement complexity budget",
                    "## Grayscale legibility replaces the two-accent limit",
                    "### Legend placement",
                ],
                9461,
            ),
            (
                "export.md",
                "scale formula and 1–4 clamp",
                [
                    "target_width / viewBox_width",
                    "device_scale_factor",
                    "Below 1",
                    "Above 4",
                ],
                1780,
            ),
            (
                "cjk-contract.md",
                "21 medium-specific CJK requirements with evaluators",
                [
                    "90% character width",
                    "Evaluator",
                    "Medium-specific CJK contract",
                    "encodeURIComponent",
                    "Noto Sans KR",
                    "effective pt",
                ],
                5292,
            ),
            (
                "font-delivery.md",
                "identity SSoT, delivery tiers, OFL RFN, and tool pin",
                [
                    "environment-dependent",
                    "Reserved Font Name",
                    "identity_rewrite",
                    "on_glyph_missing",
                    "4.53.1",
                ],
                3115,
            ),
            (
                "taste-gate.md",
                "omission, signal, six-rule checks, and delivery visual review",
                [
                    "## Omission test",
                    "Does the diagram omit any RFP requirement?",
                    "at most two",
                    "automatically fail",
                    "without reusing the Japanese stack",
                    # The delivery-time contract lives here, so bind it on this axis.
                    "Visual review at delivery",
                    "visual_review: pending",
                ],
                6045,
            ),
        ],
    )

    # Measure once and share the result across all three axes. Also exclude the
    # protocol-prefixed checks below because they do not run on the deletion copy.
    live_ran = sum(
        1
        for r in results
        if not r[0].startswith(("자기검사:", "계약 커버리지:", "스크립트 계약:"))
    )


    # Keep the discriminating case's expected answer aligned with the live rules.
    ev = os.path.join(
        os.path.dirname(os.path.dirname(ROOT)),
        "evals",
        "discriminating",
        "diagram-connector-rules",
        "graders",
        "criteria.md",
    )
    check("eval: discriminating-case criteria exist", os.path.isfile(ev))
    if os.path.isfile(ev):
        crit = io.open(ev, encoding="utf-8").read()
        rules = io.open(
            os.path.join(ROOT, "references", "connector-rules.md"), encoding="utf-8"
        ).read()
        nums = re.findall(r"(?m)^## (?:(?:Rule )?([0-6]))[.:\s]", rules)
        check(
            "eval: live rules contain all seven rules 0–6",
            sorted(set(nums)) == list("0123456"),
            f"{sorted(set(nums))}",
        )
        check(
            "eval: criteria and live Rule 0 both require arrows before boxes",
            "Draw arrows before boxes" in crit
            and "draw arrows before boxes" in rules,
        )
        check(
            "eval: criteria clearance matches the live rule",
            "6~10px" in crit and "6–10px" in rules,
        )

    check_no_constant_assertions(check, __file__)
    # The total is conditional because one result depends on Git tracking state.
    #
    # If type-placement.md is untracked, _freeze_guard fails before creating its
    # line-survival result. Once tracked and frozen, exactly one result is added.
    #
    # A fixed total would fail on one side of that transition even though no
    # contract disappeared, turning the guard into an environment detector.
    #
    # Derive one term from tracking state. It remains independent of contract count.
    check_contract_coverage(
        check,
        __file__,
        ROOT,
        per_file={
            # All floors are measured exactly by scripts/check_floor_parity.py.
            "SKILL.md": 74,
            "NOTICE": 9,
            "LICENSE.upstream": 1,
            "UPSTREAM.sha256": 8,
            "LICENSE.archify": 2,
            "references/type-placement.md": 4,
            "references/connector-rules.md": 30,
            "references/output-spec.md": 27,
            "references/export.md": 3,
            "references/taste-gate.md": 30,
            "references/cjk-contract.md": 5,
            "references/font-delivery.md": 3,
        },
        live_ran=live_ran,
    )

    check_body_deletion(
        check,
        __file__,
        ROOT,
        minimum=96,
        extra_strip=["references/output-spec.md"],
        live_ran=live_ran,
    )

    # Keep this after live_ran: deletion copies skip it.
    check_script_contracts(check, __file__, ROOT, scripts=SCRIPT_FLOORS,
                           live_ran=live_ran)
    check_total(check, results, TOTAL_BASE + (1 if _tracked(tp_path) else 0))

    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n{passed}/{len(results)} 통과")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
