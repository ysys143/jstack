#!/usr/bin/env python3
"""HWPX regression suite.

Usage: python3 tests/run_tests.py   (from the plugin's skills/hwpx directory)
       This suite requires lxml. If ambient python3 lacks it, the suite
       re-executes itself in a temporary uv environment
       (`uv run --isolated --no-project --with lxml`). It installs nothing in
       the user's environment, following the escape hatch documented by the skill.

       **Failure to acquire lxml fails rather than skips** (rc=2). All axes
       independent of lxml (document contracts, reference contracts, ensure,
       and source grep) still run. Checks that could not run are printed by
       **their exact names** as `[SKIP]` (currently 80 lines), and the total is
       reported as unmeasurable. Fixing the total for a partial run would
       legitimize a suite that runs less.

       Acquisition failure is **not determined from rc**. uv also exits 1 when
       dependency resolution fails, the same value as a child suite contract
       failure. The parent therefore checks an **independent marker file** that
       proves the child completed the suite. Without it, the parent distrusts
       the child and falls back. This also catches a fake uv that exits 0 while
       doing nothing: the result becomes fallback rc=2, not empty output and rc=0.

       **Measured behavior for the four provider states** (the contract here):

       | provider     | condition                         | output and rc                 |
       |--------------|-----------------------------------|-------------------------------|
       | ambient      | ambient has lxml (uv irrelevant)  | all 214 checks; rc=0          |
       | uv           | no ambient lxml, working uv       | child suite output unchanged  |
       | uv failure   | uv cannot create the environment  | 133 checks + 80 [SKIP]; rc=2  |
       | neither      | neither lxml nor uv exists        | 133 checks + 80 [SKIP]; rc=2  |

       On the ambient path, deleted-copy runners also use the ambient
       interpreter. Hard-coding uv made three self-check axes die with
       FileNotFoundError on ambient machines without uv (`_runner_for`).

       **The lxml gate once hid regressions.** On a machine whose ambient
       python3 lacked lxml, the suite collapsed to 20 checks and concealed two
       real contract failures: an undeclared agents/openai.yaml and a 98 != 101 total.

## What this suite locks

Upstream (jkf87/hwpx-skill) has no tests, so there was no baseline for asking
whether the migration broke anything. This suite's baseline is **our delta**:
the inventory rows for `build_hwpx.py`, `rekian_xml.py`,
`scripts/office/unpack.py`, and `validate_hwpx.py` that say they are absent
upstream. These are the first parts likely to disappear during an upstream resync.

The general conversion path is locked too. Testing only the delta would miss a
failure in the core while the delta remained intact.
"""
import atexit
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

sys.dont_write_bytecode = True
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"

HERE = os.path.dirname(os.path.abspath(__file__))
# Shared skill utilities measure whether document contracts survive body deletion.
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
from _suite_lib import (check_skill_body, in_deleted_run, check_no_constant_assertions, check_script_contracts, check_total, check_ref_contracts, split_frontmatter, check_body_deletion,  # noqa: E402
                        check_contract_coverage, section)  # noqa: E402
ROOT = os.path.dirname(HERE)
SCRIPTS = os.path.join(ROOT, "scripts")
sys.path.insert(0, SCRIPTS)

FIXTURE = os.path.join(ROOT, "assets", "fixtures", "minimal.md")
BASE = Path(ROOT) / "templates" / "base"

results = []

# uv command used to acquire lxml. Re-execution and deleted-copy runs whose
# provider is uv share this list so the pin cannot drift between two copies.
# This is not a universal runner: when ambient python3 already has lxml, copies
# must use that interpreter. Hard-coding uv caused three self-check axes to die
# with FileNotFoundError on ambient machines without uv. `_runner_for` selects
# the runner from the provider.
_UV = ["uv", "run", "--isolated", "--no-project", "--quiet", "--with", "lxml", "python"]
# Recursion guard. When set, the process is already inside uv; if lxml is still
# unavailable there, do not re-execute again and fall back instead.
_REEXEC = "HWPX_SUITE_LXML_VIA_UV"
# **Independent proof that the child actually ran the suite.** Trusting rc alone
# permits a fake uv that exits 0 without doing anything, producing a silent green
# run with no output. Just before exit the child writes "check-count rc" here;
# the parent falls back if the file is absent or the count is zero.
_MARK = "HWPX_SUITE_CHILD_MARK"
# Remove the marker from the environment so deleted copies and self-check
# children cannot overwrite it. Only this process retains the value.
_MARK_PATH = os.environ.pop(_MARK, None)
# Force the fallback path for self-checks. Even when lxml exists, this makes the
# run behave as if it does not so every run can verify that `SKIPPED_AXES`
# represents the checks that really disappear.
_FORCE_NO_LXML = "HWPX_SUITE_FORCE_NO_LXML"
# Total check count. Keep the protocol name in one place for self-checks.
TOTAL_EXPECTED = 209
TOTAL_NAME = f"자기검사: 검사 총수가 {TOTAL_EXPECTED} 건이다"


def _write_child_mark(rc):
    """Tell the parent that the child completed the suite (F2 independent marker)."""
    if not _MARK_PATH:
        return
    try:
        with open(_MARK_PATH, "w", encoding="utf-8") as f:
            f.write(f"{len(results)} {rc}\n")
    except OSError:
        pass


def _read_child_mark(path):
    """Return ``(check_count, rc)`` or ``None``."""
    try:
        with open(path, encoding="utf-8") as f:
            n, rc = f.read().split()
        return int(n), int(rc)
    except (OSError, ValueError):
        return None


def _runner_for(provider):
    """Choose a deleted-copy runner that follows how the parent acquired lxml."""
    return None if provider == "ambient" else _UV


def _lxml_provider():
    """Return ``(provider, detail)`` describing how lxml will be acquired.

    - `("ambient", path)`   already present in the ambient interpreter
    - `("uv-child", path)`  acquired after uv re-execution
    - `("uv", None)`        the parent must re-execute now
    - `(None, reason)`       unavailable; use the fallback path
    """
    if os.environ.get(_FORCE_NO_LXML):
        return (None, "fallback path forced by self-check")
    try:
        import lxml  # noqa: F401
    except ImportError:
        if os.environ.get(_REEXEC):
            return (None, "lxml is unavailable even after uv re-execution")
        if shutil.which("uv") is None:
            return (None, "ambient python3 lacks lxml and uv is unavailable")
        return ("uv", None)
    if os.environ.get(_REEXEC):
        return ("uv-child", getattr(lxml, "__file__", "?"))
    return ("ambient", getattr(lxml, "__file__", "?"))


# Print axes that did not run when acquisition fails. They are excluded from
# `results`: `[SKIP]` does not match the `^\[FAIL\]` or `^\[(PASS|FAIL)\]`
# counting expressions, so it does not interfere with deleted-copy counts.
SKIPPED_AXES = (
    'delta: reference preview does not leak into the output',
    'delta: preview is replaced with the neutral image',
    'delta: all three zip-slip path forms are blocked',
    'delta: safe entries pass',
    'delta: clear_linesegarrays removes caches',
    'delta: a targeted paragraph mutation preserves untouched paragraph caches',
    'delta: the surviving cache belongs to the second paragraph',
    'delta: the rewrite path actually clears caches (caller binding)',
    'delta: the template list is static',
    'core: Markdown parsing produces blocks',
    'core: tables, lists, and paragraphs are all recognized',
    'core: output contains required entries',
    'core: mimetype is the first entry',
    'core: mimetype is uncompressed (ZIP_STORED)',
    'core: preview text reflects the document body',
    'baseline: block structure matches the frozen copy',
    'validate_hwpx: valid output has no errors',
    'validate_hwpx: a missing required entry is detected (live assertion)',
    'validate_hwpx: a missing file is an error',
    'validate_hwpx: the required-entry list is nonempty',
    'validate_hwpx: the required-entry list matches the canonical order',
    'validate_hwpx: the required-entry probe covers the complete list',
    'validate_hwpx: a missing mimetype is detected',
    'validate_hwpx: a missing Contents/content.hpf is detected',
    'validate_hwpx: a missing Contents/header.xml is detected',
    'validate_hwpx: a missing Contents/section0.xml is detected',
    'validate_hwpx: EXPECTED_MIMETYPE is the canonical OPC value',
    'validate_hwpx: an incorrect mimetype value is detected',
    'validate_hwpx: the required secPr child names match the canonical set',
    'validate_hwpx: required secPr children cover all eight concrete types',
    'validate_hwpx: valid output has no secPr child defects',
    'validate_hwpx: the base probe starts with a complete secPr',
    'validate_hwpx: removing pagePr from secPr is detected',
    'validate_hwpx: a missing margin inside pagePr is detected separately',
    'validate_hwpx: that defect is classified as document/structure',
    'diagnostics: --json output is one valid JSON value',
    'diagnostics: envelope has schemaVersion 1 and identifies its source',
    'diagnostics: valid output has ok=true and no diagnostics',
    'diagnostics: missing required entry becomes package/missing-file',
    'diagnostics: severity is error',
    'diagnostics: diagnostic count equals validate() result count (no swallowing)',
    'diagnostics: the injected IDRef mutation changes the file',
    'diagnostics: injected undefined IDRef is classified as reference/undefined',
    'diagnostics: evidence structures idref instead of raw text',
    'diagnostics: five repair stages appear in relocate-to-delete order',
    'diagnostics: only deletion requires evidence (requiresEvidence)',
    'diagnostics: package defects omit the five stages (no false guidance)',
    'diagnostics: steering paragraph was actually injected',
    'diagnostics: paragraph text cannot steer the code (F1)',
    'diagnostics: body text cannot fabricate reference evidence (F1)',
    'diagnostics: a missing file becomes input/read',
    'diagnostics: VALID line remains unchanged without --json',
    'diagnostics: human-readable output does not mix in JSON',
    'text_extract: extracted output agrees with body-text presence',
    'text_extract: a missing file is an error',
    'rekian_xml: parses XML from a path and returns a tree',
    'office/unpack: extracts hwpx into a directory (rc=0)',
    'office/unpack: unpacking and repacking preserves entries',
    'analyze_template: base template header.xml exists',
    'analyze_template: reads actual font definitions from the base template',
    'batch_convert: strips numeric prefixes and changes underscores to spaces',
    'batch_convert: converter path points inside this skill',
    '스크립트 계약: hooks/hwpx_guard.py',
    '스크립트 계약: scripts/analyze_template.py',
    '스크립트 계약: scripts/batch_convert.py',
    '스크립트 계약: scripts/build_hwpx.py',
    '스크립트 계약: scripts/fix_borders.py',
    '스크립트 계약: scripts/hwpx_zip.py',
    '스크립트 계약: scripts/md_to_hwpx.py',
    '스크립트 계약: scripts/office/pack.py',
    '스크립트 계약: scripts/office/unpack.py',
    '스크립트 계약: scripts/rekian_xml.py',
    '스크립트 계약: scripts/sanitize_template.py',
    '스크립트 계약: scripts/text_extract.py',
    '스크립트 계약: scripts/validate_hwpx.py',
    '계약 커버리지: 선언 목록이 실제 파일과 일치한다',
    '계약 커버리지: SKILL.md',
    '계약 커버리지: agents/openai.yaml',
    '계약 커버리지: references/com-windows-guide.md',
    '계약 커버리지: references/example-flow.md',
    '계약 커버리지: references/hangul-practice.md',
    '계약 커버리지: references/hitl-review.md',
    '계약 커버리지: references/hwpx-format.md',
    '계약 커버리지: references/kordoc-public-doc.md',
    '계약 커버리지: references/markdown-proposal-rules.md',
    '계약 커버리지: references/render-checklist.md',
    '계약 커버리지: references/style-intake.md',
    '계약 커버리지: references/troubleshooting.md',
    '계약 커버리지: references/validation-rules.md',
    '계약 커버리지: references/workflows.md',
    '계약 커버리지: references/xml-structure.md',
    '계약 커버리지: scripts/ensure_hwpx.sh',
    '자기검사: 본문 삭제 사본이 완주한다 (비정상 종료 아님)',
    '자기검사: 사본에서 검사가 소멸하지 않았다',
    '자기검사: SKILL.md 본문 삭제 시 계약 검사가 실패한다',
)


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    mark = "PASS" if ok else "FAIL"
    print(f"[{mark}] {name}" + (f" — {detail}" if detail else ""))


# Only the **live checks** from `SKIPPED_AXES`; the three meta axes do not run in
# deleted copies (the same set of excluded prefixes used by `live_ran`).
_LIVE_SKIPPED = tuple(
    n for n in SKIPPED_AXES
    if not n.startswith(("자기검사:", "계약 커버리지:", "스크립트 계약:")))

# The sections must partition `_LIVE_SKIPPED` completely. An uncovered name
# disappears instead of failing when a script is emptied; the self-check below measures this.
_SECTION_PREFIXES = ("delta:", "core:", "baseline:", "validate_hwpx:", "diagnostics:",
                     "text_extract:", "rekian_xml:", "office/unpack:",
                     "analyze_template:", "batch_convert:")


def _axes(*prefixes):
    """Return names emitted by sections, selected from `SKIPPED_AXES` by prefix.

    Do not duplicate the names. The `need()` gate follows the lxml gate, so the
    boundary between axes lost to the environment and axes lost with an artifact
    sits in one place. Every fallback run verifies the former.
    """
    return tuple(n for n in _LIVE_SKIPPED if n.startswith(prefixes))



def _run_py(script, *args):
    """Run a script with **ambient python3**; these scripts use only the standard library."""
    return subprocess.run([sys.executable, script, *[str(a) for a in args]],
                          capture_output=True, text=True)


def _run_hook(hook, payload, raw=None):
    """Send JSON to a hook on stdin; when `raw` is given, send it unchanged."""
    body = raw if raw is not None else json.dumps(payload)
    return subprocess.run([sys.executable, hook], input=body,
                          capture_output=True, text=True)


# Same value as `hwpx_zip.NEUTRAL_PNG`. The suite deliberately does not import
# it from the script: in a copy with that script emptied, the import would die
# and all checks below it would disappear without failing.
_NEUTRAL_PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
    "890000000a49444154789c63000100000500010d0a2db40000000049454e44ae"
    "426082"
)
_HH = "{http://www.hancom.co.kr/hwpml/2011/head}"


def _make_probe(path: Path, *, neutral_preview: bool, box_every_char: bool = False,
                drop_header: bool = False, mimetype_last: bool = False):
    """Build a probe .hwpx from `templates/base` using only the standard library.

    `box_every_char` injects a **real defect** by enabling all four sides of a
    borderFill and pointing all seven charPr elements to it. A test that cannot
    recover the injected defect is not a meaningful assertion.
    """
    import xml.etree.ElementTree as _ET

    entries = {}
    for src in BASE.rglob("*"):
        if src.is_file() and src.name != "mimetype":
            entries[src.relative_to(BASE).as_posix()] = src.read_bytes()
    if neutral_preview:
        entries["Preview/PrvImage.png"] = _NEUTRAL_PNG
    if box_every_char:
        raw = entries["Contents/header.xml"]
        for m in re.finditer(rb'xmlns:([A-Za-z0-9_.-]+)="([^"]+)"', raw[:8192]):
            _ET.register_namespace(m.group(1).decode(), m.group(2).decode())
        root = _ET.fromstring(raw)
        # Enable **only one**. Enabling all of them leaves no clean borderFill to
        # rebind, so `--fix` reports that there is nothing to repair. That would
        # disable the script instead of injecting a defect (measured fix rc=1).
        for bf in root.iter(_HH + "borderFill"):
            if bf.get("id") != "2":
                continue
            for side in ("leftBorder", "rightBorder", "topBorder", "bottomBorder"):
                el = bf.find(_HH + side)
                if el is not None:
                    el.set("type", "SOLID")
        entries["Contents/header.xml"] = _ET.tostring(
            root, encoding="UTF-8", xml_declaration=True)
    if drop_header:
        entries.pop("Contents/header.xml", None)
    with zipfile.ZipFile(path, "w") as z:
        if not mimetype_last:
            z.writestr(zipfile.ZipInfo("mimetype"), "application/hwp+zip",
                       compress_type=zipfile.ZIP_STORED)
        for name, data in entries.items():
            z.writestr(name, data)
        if mimetype_last:
            z.writestr(zipfile.ZipInfo("mimetype"), "application/hwp+zip",
                       compress_type=zipfile.ZIP_STORED)
    return str(path)


def make_reference(tmp: Path, preview: bytes) -> Path:
    """Build a reference .hwpx from the base template; preview is the leak-test payload."""
    ref = tmp / "reference.hwpx"
    with zipfile.ZipFile(ref, "w") as z:
        z.writestr("mimetype", "application/hwp+zip")
        for rel in ("Contents/header.xml", "Contents/section0.xml",
                    "Contents/content.hpf", "META-INF/container.xml",
                    "settings.xml", "version.xml", "Preview/PrvText.txt"):
            src = BASE / rel
            z.writestr(rel, src.read_bytes() if src.exists() else b"<x/>")
        z.writestr("Preview/PrvImage.png", preview)
    return ref


def main():
    # **Acquire lxml first**, before document contracts. On re-execution this
    # process must print nothing and pass through the child's output and rc.
    # Capturing output would hide child [FAIL] lines and create a silent green run.
    provider, detail = _lxml_provider()
    if provider == "uv":
        # **Do not classify by rc.** uv exits 1 on resolution failure (offline or
        # uncached), the same as a child suite contract failure. The old
        # `if r.returncode in (0,1,2): return ...` made fallback unreachable and
        # produced only rc=1 with zero axes, zero [SKIP] lines, and zero checks.
        # Instead inspect an independent marker proving the child ran the suite.
        # This also catches a fake uv that exits 0 while doing nothing.
        _mark_dir = tempfile.mkdtemp(prefix="hwpx-suite-mark-")
        _mark = os.path.join(_mark_dir, "ran")
        try:
            r = subprocess.run(_UV + [os.path.abspath(__file__)] + sys.argv[1:],
                               env=dict(os.environ, **{_REEXEC: "1", _MARK: _mark}),
                               cwd=os.getcwd())
            got = _read_child_mark(_mark)
        finally:
            shutil.rmtree(_mark_dir, ignore_errors=True)
        if got and got[0] > 0 and got[1] == r.returncode:
            return r.returncode
        # No proof that the child ran: uv failed to create the environment, or
        # another executable occupies the uv path. Continue into fallback.
        provider, detail = (
            None,
            f"uv re-execution left no marker proving the suite ran — rc={r.returncode}, "
            f"marker={'missing' if got is None else f'{got[0]} checks/rc={got[1]}'}")

    tmp = Path(tempfile.mkdtemp())
    # `tmp` is used until the end and this function has early returns. Wrapping
    # it in try/finally would indent the whole body, so close it at process exit.
    atexit.register(shutil.rmtree, tmp, ignore_errors=True)

    # 0a. **Document contracts stay before the lxml gate.** Placing them after it
    #     reduced the suite to one check on dependency-free machines and skipped
    #     the self-checks. The original suite measured scripts but never read
    #     SKILL.md; deleting its entire body still yielded 16/16 green.
    with open(os.path.join(ROOT, "SKILL.md"), encoding="utf-8") as _f:
        _raw = _f.read()
    skill_fm, skill = split_frontmatter(_raw)

    # HWPX has one workflow and no mode branches, so measure its Workflow steps.
    steps = re.findall(r"(?m)^\d+\. ", skill.split("## Commands")[0])
    check("SKILL.md: Workflow section contains steps", len(steps) >= 3, f"{len(steps)} steps")

    # Verify that referenced and routed targets exist (the same D-3 rule as image).
    #
    # The previous version iterated zero times. It looked only for backtick-wrapped
    # paths, while this SKILL.md used that form in a code fence. Zero matches
    # produced zero checks, so nonexistent advertised files still passed.
    _paths = set(re.findall(r"\$\{CLAUDE_PLUGIN_ROOT\}/skills/hwpx/([\w./-]+)", skill))
    _paths |= {m.replace("\\", "/") for m in
               re.findall(r"\$env:CLAUDE_PLUGIN_ROOT\\skills\\hwpx\\([\w.\\-]+)", skill)}
    _paths |= {m.replace("\\", "/") for m in
               re.findall(r"\$Skill\\([\w.\\-]+)", skill)}
    # Exclude paths outside the skill, such as the plugin root's hooks/hooks.json.
    for _m in re.finditer(
            r"`((?:scripts|references|hooks|templates|assets|agents)/[\w./-]+)`", skill):
        if "plugin root" in skill[max(0, _m.start() - 40):_m.start()]:
            continue
        _paths.add(_m.group(1))
    check("SKILL.md reference existence: population is nonempty (zero iterations do not pass)",
          len(_paths) >= 25, f"{len(_paths)} entries")
    _dead = sorted(rel for rel in _paths
                   if not os.path.exists(os.path.join(ROOT, rel)))
    check("SKILL.md reference existence: every referenced path exists", not _dead,
          f"missing {_dead}" if _dead else f"{len(_paths)} entries")

    for label, needle in [
        ("validation procedure", "validate_hwpx.py"),
        ("HITL gate: no approval before opening", "hitl-review.md"),
        ("reference-style reuse design", "reference"),
        ("Windows COM path for .hwp", "COM"),
        ("structural trap: attributes versus children", "references/xml-structure.md"),
        ("boundary before human handoff", "references/render-checklist.md"),
        ("handoff gate inspects at delivery time", "hooks/hwpx_guard.py"),
    ]:
        check(f"SKILL.md contract: {label}", needle in skill)

    # Keep automatic installation instructions defanged.
    check("SKILL.md: does not install dependencies on the user's behalf",
          "Users install dependencies" in skill)

    # This remains before the lxml gate. Needles alone let a skeleton pass:
    # retaining only needle-bearing lines deleted 67-85% of the body while
    # staying green. Line survival, size, and blob binding catch that reduction.
    check_skill_body(check, ROOT, needles=[
        'md_to_hwpx.py',
        'references/hitl-review.md',
        'references/troubleshooting.md',
        '`.hwpx` remains available',
        'references/xml-structure.md',
        'scripts/fix_borders.py',
    ], floor=3818)

    # Bind discriminating-case answers (unit constants and A4 dimensions) to the
    # real files. This block stays before the lxml gate because it only reads
    # criteria.md, hwpx-format.md, and section0.xml.
    ev = os.path.join(os.path.dirname(os.path.dirname(ROOT)), "evals",
                      "discriminating", "hwpx-format-units", "graders", "criteria.md")
    check("eval: discriminating-case criteria exist", os.path.isfile(ev))
    if os.path.isfile(ev):
        crit = io.open(ev, encoding="utf-8").read()
        fmt = io.open(os.path.join(ROOT, "references", "hwpx-format.md"),
                      encoding="utf-8").read()
        for token, why in (("1/7200", "HWPUNIT definition"), ("100 HWPUNIT", "pt conversion"),
                           ("283.46", "mm conversion"), ("59528", "A4 width"),
                           ("84186", "A4 height")):
            check(f"eval: {why} value matches concrete files",
                  token in fmt and token in crit, token)
        # **A4 height differs from the calculated value.** Converting 297 mm gives
        # 84189, while Hangul uses 84186. Keep the documented template evidence
        # so a future contributor does not "correct" it to the calculated value.
        tmpl = os.path.join(ROOT, "templates", "base", "Contents", "section0.xml")
        check("eval: documentation identifies the real template as A4-height evidence",
              "84186 is the value Hangul uses, not a calculated conversion" in fmt
              and "section0.xml" in fmt)
        check("eval: that template actually uses 84186",
              os.path.isfile(tmpl)
              and 'height="84186"' in io.open(tmpl, encoding="utf-8").read())

    # ------------------------------------------------------------------
    # Axes that **do not use lxml** stay before the gate. They use only file reads,
    # source grep, and subprocesses, and must run even when acquisition fails.
    # ------------------------------------------------------------------

    # The agent card is the only file exposing this skill to external runtimes.
    # Its default_prompt contract is ordered: analyze the reference, ask about
    # missing mappings, convert, then validate structure and semantics.
    AGENT = os.path.join(ROOT, "agents", "openai.yaml")
    check("agent card: openai.yaml exists", os.path.isfile(AGENT))
    _agent = io.open(AGENT, encoding="utf-8").read() if os.path.isfile(AGENT) else ""
    for _label, _needle in [
        ("analyzes the reference first", "Analyze the provided reference"),
        ("asks about missing mappings (HITL)", "ask for any missing"),
        ("validates both structure and semantics", "structurally and semantically"),
    ]:
        check(f"agent card contract: {_label}", _needle in _agent, _needle)

    # Delta: source-level check that argparse enforces a static allowlist.
    src = io.open(os.path.join(SCRIPTS, "build_hwpx.py"), encoding="utf-8").read()
    check("delta: argparse enforces the allowlist",
          "choices=AVAILABLE_TEMPLATES" in src)
    check("prohibition: proposal template is absent from the tree",
          not (Path(ROOT) / "templates" / "proposal").exists())
    check("fixture exists", os.path.exists(FIXTURE))


    # Give each reference a contract for content it uniquely owns. A reference
    # that can be emptied without failure is unmeasured. Needles target substance
    # not inferable from the filename, rather than headings that a one-line stub
    # could retain.
    REF_CONTRACTS = [
        ('com-windows-guide.md', 'the only .hwp input path: required COM environment and entry pattern',
         ['pywin32', 'HWPFrame.HwpObject', 'Windows'], 890),
        ('example-flow.md', 'actual converter arguments and ambiguity-question format',
         ['md_to_hwpx.py', '--reference', '--title', '2.1.1.1', 'inferred draft'], 2292),
        ('hitl-review.md', 'status-label set: no approval before human acceptance',
         ['ready-for-review', 'accepted-by-user', 'not-run', 'Do not block initial delivery'], 1471),
        ('hwpx-format.md', 'OWPML container structure: section, header, and mimetype',
         ['section', 'header', 'mimetype'], 6038),
        ('markdown-proposal-rules.md', 'concrete mapping pairs, table rules, and unsupported features',
         ['hp:tbl', '--preserve-heading-numbers', '--roman-to-arabic', '표 내용', 'merged cells', 'page body width'], 1527),
        ('style-intake.md', 'concrete reference-inspection items and gap questions',
         ['analyze_template.py', '2.1.1.1', 'line spacing', 'style-generated', 'one short grouped question'], 1849),
        ('troubleshooting.md', 'failures that remain possible after validator success',
         ['validate_hwpx.py', 'Hancom layout looks wrong', 'Korean paths', 'missing styles'], 604),
        ('validation-rules.md', 'concrete structural and semantic checks plus diagnostic contract (H-4)',
         ['ZIP_STORED', 'secPr', 'colPr', 'styleIDRef', '--semantic',
          # The document must contain the envelope, five repair stages, and fallback code.
          'schemaVersion', 'supportedFixes', 'requiresEvidence',
          'internal/unclassified'], 804),
        ('workflows.md', 'actual commands, arguments, and batch ownership rules for every path',
         ['analyze_template.py', 'md_to_hwpx.py', '--semantic-validate', 'PYTHONUTF8', 'one worker per output file'], 1522),
        # --- Four additions from density ledger I-6, I-9, I-20, N-19, D-16 ----
        # Use values unique to the document, such as attributes, constants, and
        # institution names, rather than element names a one-line stub can retain.
        ('xml-structure.md', 'secPr attribute misuse, required hp:pic children, and ID-reference rules',
         ['hp:pagePr', 'masterPageCnt', 'hp:imgClip', 'hp:renderingInfo',
          'binaryItemIDRef', 'itemCnt'], 7905),
        ('hangul-practice.md', 'table overflow, anchoring, paragraph-property inheritance, and font substitution',
         ['repeatHeader', 'pageBreak="CELL"', 'vertRelTo', 'isEmbedded="0"',
          'ON_SECTION', 'hp:textart'], 6028),
        ('render-checklist.md', 'automated/HITL boundary and handoff timing rules',
         ['--check', 'At least two days before submission', 'hp:pagePr', 'repeatHeader',
          'review one day before submission often functions only as notice'], 3988),
        ('kordoc-public-doc.md', 'bullet-style endings, layer thresholds, official hierarchy, and explicit exclusions',
         ['bullet-style rules', 'Ministry of the Interior and Safety ordinance',
          '2020 행정업무운영 편람', 'Equations', 'OCR'], 5580),
    ]
    # Check ensure **on demand** rather than requiring installation in advance.
    ENSURE = os.path.join(ROOT, "scripts", "ensure_hwpx.sh")
    check("ensure: check script exists", os.path.exists(ENSURE))
    _r = subprocess.run(["bash", ENSURE], capture_output=True, text=True)
    check("ensure: exit code is within the contract (0, 1, or 2)", _r.returncode in (0, 1, 2),
          f"rc={_r.returncode}")
    _src = io.open(ENSURE, encoding="utf-8").read()
    check("ensure: missing lxml maps to exit 2", "import lxml" in _src and "exit 2" in _src)
    check("ensure: unavailable .hwp input maps to exit 1 while .hwpx remains available",
          "exit 1" in _src and ".hwpx generation and validation remain available" in _src)
    check("ensure: advises installation without performing it", "uv pip install" in _src)

    check_ref_contracts(check, ROOT, REF_CONTRACTS)

    # ------------------------------------------------------------------
    # Documentation-to-implementation cross-check. **Needles lock only docs.**
    #
    # `--semantic-validate` was pinned in both docs but had no implementation
    # contract; deleting the argparse line stayed green. Exercise both sides.
    # ------------------------------------------------------------------
    MD2HWPX_FLAGS = ("--reference", "--title", "--roman-to-arabic",
                     "--preserve-heading-numbers", "--reference-cache-dir",
                     "--validate", "--semantic-validate")
    _cmds = skill.split("## Commands", 1)[-1]
    _wf = io.open(os.path.join(ROOT, "references", "workflows.md"),
                  encoding="utf-8").read()
    _undoc = [f for f in MD2HWPX_FLAGS if f not in _cmds and f not in _wf]
    check("cross-check: all canonical md_to_hwpx flags are documented", not _undoc,
          f"missing from docs {_undoc}")
    _help = _run_py(os.path.join(SCRIPTS, "md_to_hwpx.py"), "--help")
    _unimpl = [f for f in MD2HWPX_FLAGS if f not in _help.stdout]
    check("cross-check: md_to_hwpx.py accepts those flags (executed --help)",
          _help.returncode == 0 and not _unimpl,
          f"rc={_help.returncode} missing from implementation {_unimpl}")
    _m2h_src = io.open(os.path.join(SCRIPTS, "md_to_hwpx.py"),
                       encoding="utf-8").read()
    check("cross-check: --semantic-validate is wired to semantic validation",
          "validate_output(args.output, semantic=args.semantic_validate)" in _m2h_src
          and "validator.validate_semantic(str(output))" in _m2h_src)

    # ------------------------------------------------------------------
    # Documentation-to-artifact cross-check: `hwpx-format.md` says fontRef values
    # are **numeric IDs**. Reverting to `hangul="한양신명조"` makes Hancom ignore
    # the assignment. Bind the documentation to the real `templates/base` data.
    # ------------------------------------------------------------------
    _fmt = io.open(os.path.join(ROOT, "references", "hwpx-format.md"),
                   encoding="utf-8").read()
    _hdr_txt = io.open(str(BASE / "Contents" / "header.xml"),
                       encoding="utf-8").read()
    _fr = re.search(r'<hh:fontRef hangul="([^"]+)"', _hdr_txt)
    check("cross-check: real header.xml uses a numeric fontRef hangul ID",
          bool(_fr) and _fr.group(1).isdigit(), _fr.group(1) if _fr else "missing")
    _hangul_block = re.search(r'<hh:fontface lang="HANGUL".*?</hh:fontface>',
                              _hdr_txt, re.S)
    _face = (re.search(r'<hh:font id="%s" face="([^"]+)"' % re.escape(_fr.group(1)),
                       _hangul_block.group(0))
             if _fr and _hangul_block else None)
    check("cross-check: that ID identifies a real font in the HANGUL fontface",
          bool(_face), _face.group(1) if _face else "not found")
    check("cross-check: documented fontRef matches the real value",
          bool(_fr) and ('<hh:fontRef hangul="%s" latin=' % _fr.group(1)) in _fmt)
    check("cross-check: documented font name matches the real face",
          bool(_face) and _face.group(1) in _fmt,
          _face.group(1) if _face else "")
    check("cross-check: documentation preserves the warning against name-valued references",
          "Hancom does not resolve a name there" in _fmt
          and "numeric IDs, not font names" in _fmt)

    # ------------------------------------------------------------------
    # The three-value pageBreak table is a **row/value contract**. Swapping rows
    # reverses its advice without changing row count, byte count, or needles.
    # ------------------------------------------------------------------
    PAGEBREAK_ROWS = [
        ("`TABLE`", "Keeps the table whole; if it does not fit, moves **the entire table to the next page**"),
        ("`CELL`", "Splits **between cells**; paragraphs within one cell do not cross pages"),
        ("`NONE`", "Does not split; overflow is **clipped and invisible**"),
    ]
    _hp = io.open(os.path.join(ROOT, "references", "hangul-practice.md"),
                  encoding="utf-8").read()
    _sec = re.split(r"(?m)^#{2,3} ",
                    _hp.split("### Three `pageBreak` values", 1)[-1])[0]
    _rows = [tuple(c.strip() for c in ln.strip().strip("|").split("|"))[:2]
             for ln in _sec.splitlines()
             if ln.startswith("| `")]
    check("cross-check: pageBreak table value/behavior pairs match the canonical rows",
          _rows == [tuple(r) for r in PAGEBREAK_ROWS], f"{_rows}")
    check("cross-check: repeatHeader and CELL pairing rule is preserved",
          '`repeatHeader="1"` matters only with `pageBreak="CELL"`' in _sec)

    # ------------------------------------------------------------------
    # `templates/base/mimetype`: **the value itself is the contract**.
    # ------------------------------------------------------------------
    check("template: base/mimetype has the canonical OPC value without a newline",
          (BASE / "mimetype").read_bytes() == b"application/hwp+zip",
          repr((BASE / "mimetype").read_bytes()[:40]))

    # ------------------------------------------------------------------
    # `scripts/office/pack.py` was previously unmeasured. Neither the contract
    # dictionary nor any check covered it, so removing ZIP_STORED or emptying the
    # file stayed green. Exercise it here. `unpack.py` imports lxml and runs later.
    # ------------------------------------------------------------------
    PACK = os.path.join(SCRIPTS, "office", "pack.py")
    check("office/pack: script exists", os.path.isfile(PACK))
    _pd = Path(tempfile.mkdtemp())
    try:
        (_pd / "src").mkdir()
        (_pd / "src" / "mimetype").write_bytes(b"application/hwp+zip")
        (_pd / "src" / "Contents").mkdir()
        (_pd / "src" / "Contents" / "header.xml").write_text(
            "<a/>" + "x" * 4000, encoding="utf-8")
        _out = _pd / "packed.hwpx"
        _r = _run_py(PACK, _pd / "src", _out)
        check("office/pack: packages a directory as hwpx (rc=0)",
              _r.returncode == 0 and _out.is_file(), _r.stderr.strip()[:80])
        _info = zipfile.ZipFile(_out).infolist() if _out.is_file() else []
        check("office/pack: mimetype is the first entry",
              bool(_info) and _info[0].filename == "mimetype",
              _info[0].filename if _info else "no entries")
        check("office/pack: mimetype is uncompressed (ZIP_STORED)",
              bool(_info) and _info[0].compress_type == zipfile.ZIP_STORED,
              str(_info[0].compress_type) if _info else "")
        check("office/pack: remaining entries are compressed (ZIP_DEFLATED)",
              any(i.filename != "mimetype" and i.compress_type == zipfile.ZIP_DEFLATED
                  for i in _info),
              str([(i.filename, i.compress_type) for i in _info]))
        check("office/pack: all files are included",
              {i.filename for i in _info}
              == {"mimetype", "Contents/header.xml"},
              str(sorted(i.filename for i in _info)))
        (_pd / "bad").mkdir()
        (_pd / "bad" / "Contents").mkdir()
        (_pd / "bad" / "Contents" / "header.xml").write_text("<a/>", encoding="utf-8")
        _rb = _run_py(PACK, _pd / "bad", _pd / "bad.hwpx")
        check("office/pack: rejects a directory without mimetype (rc!=0)",
              _rb.returncode != 0, f"rc={_rb.returncode}")
        _rc = _run_py(PACK, _pd / "nope", _pd / "nope.hwpx")
        check("office/pack: classifies a missing directory as input error (rc=1)",
              _rc.returncode == 1, f"rc={_rc.returncode}")
    finally:
        shutil.rmtree(_pd, ignore_errors=True)

    # ------------------------------------------------------------------
    # Sanitizer, repair script, and handoff hook stay **before the lxml gate**.
    # All three use only the standard library and must answer even after ensure
    # reports exit 2. A check that never runs is silence, not a contract.
    # ------------------------------------------------------------------
    _probe_dir = tempfile.mkdtemp()
    try:
        _clean = _make_probe(Path(_probe_dir) / "clean.hwpx", neutral_preview=True)
        _dirty = _make_probe(Path(_probe_dir) / "dirty.hwpx", neutral_preview=False)
        _boxed = _make_probe(Path(_probe_dir) / "boxed.hwpx", neutral_preview=True,
                             box_every_char=True)
        _absent = os.path.join(_probe_dir, "nope.hwpx")

        _fb = os.path.join(SCRIPTS, "fix_borders.py")
        _r = _run_py(_fb, _clean, "--check")
        check("fix_borders: accepts a border-free file (rc=0)",
              _r.returncode == 0 and "OK:" in _r.stdout, f"rc={_r.returncode}")
        _r = _run_py(_fb, _boxed, "--check")
        # Check the count too; rc alone would permit an implementation that always returns 1.
        check("fix_borders: finds character-border miswiring per charPr (rc=1)",
              _r.returncode == 1 and _r.stdout.count("borders on)") == 7,
              f"rc={_r.returncode}, {_r.stdout.count('borders on)')} findings")
        _r = _run_py(_fb, _boxed, "--fix")
        _after = _run_py(_fb, _boxed, "--check")
        check("fix_borders: --fix actually rebinds styles (recheck passes)",
              _r.returncode == 0 and "FIXED:" in _r.stdout
              and _after.returncode == 0,
              f"fix rc={_r.returncode}, recheck rc={_after.returncode}")
        # Measure the `hwpx_zip.rewrite` mimetype invariant on its output. Earlier
        # checks covered order but not compression, although Hancom rejects a
        # package whose mimetype entry is compressed.
        _wi = zipfile.ZipFile(_boxed).infolist()
        check("hwpx_zip: rewritten output has mimetype first",
              bool(_wi) and _wi[0].filename == "mimetype",
              _wi[0].filename if _wi else "no entries")
        check("hwpx_zip: rewritten output stores mimetype uncompressed (ZIP_STORED)",
              bool(_wi) and _wi[0].compress_type == zipfile.ZIP_STORED,
              str(_wi[0].compress_type) if _wi else "")
        check("hwpx_zip: remaining entries are compressed (ZIP_DEFLATED)",
              any(i.filename != "mimetype"
                  and i.compress_type == zipfile.ZIP_DEFLATED for i in _wi))
        # Measure this one in source because behavior cannot pin it. ZipInfo's
        # default is already ZIP_STORED, so removing the keyword leaves output
        # unchanged today. Explicit intent prevents a later ZipFile default of
        # ZIP_DEFLATED from making Hancom reject the package.
        _hz = io.open(os.path.join(SCRIPTS, "hwpx_zip.py"), encoding="utf-8").read()
        check("hwpx_zip: mimetype write explicitly uses ZIP_STORED (not the default)",
              re.search(r'ZipInfo\("mimetype"\),\s*data,\s*compress_type=zipfile\.ZIP_STORED',
                        _hz) is not None)
        _r = _run_py(_fb, _absent, "--check")
        check("fix_borders: classifies a missing file as input error (rc=2)",
              _r.returncode == 2, f"rc={_r.returncode}")

        _st = os.path.join(SCRIPTS, "sanitize_template.py")
        _r = _run_py(_st, _dirty, "--check")
        check("sanitize_template: detects a retained client preview thumbnail (rc=1)",
              _r.returncode == 1 and "PrvImage.png" in _r.stdout,
              f"rc={_r.returncode}")
        _r = _run_py(_st, _dirty, "--fix")
        _left = _run_py(_st, _dirty, "--check")
        # Unused styles must remain after --fix; sanitation and optimization are
        # deliberately separate operations.
        check("sanitize_template: --fix replaces the preview with the neutral image",
              _r.returncode == 0 and "PrvImage.png" not in _left.stdout,
              f"fix rc={_r.returncode}")
        check("sanitize_template: unused styles remain without --prune-styles",
              "unused-style:" in _left.stdout,
              f"remaining {_left.stdout.count('unused-style:')} entries")
        _r = _run_py(_st, _dirty, "--fix", "--prune-styles")
        _left = _run_py(_st, _dirty, "--check")
        check("sanitize_template: --prune-styles removes them when requested",
              "pruned" in _r.stdout and "unused-style:" not in _left.stdout,
              _r.stdout.strip().splitlines()[-1] if _r.stdout.strip() else "")
        _r = _run_py(_st, _absent, "--check")
        check("sanitize_template: classifies a missing file as input error (rc=2)",
              _r.returncode == 2, f"rc={_r.returncode}")

        # Blocking cases must not reuse `_boxed`, which --fix already cleaned.
        # Measuring that file would pass even if the hook were empty.
        _hook = os.path.join(ROOT, "hooks", "hwpx_guard.py")
        _still_boxed = _make_probe(Path(_probe_dir) / "boxed2.hwpx",
                                   neutral_preview=True, box_every_char=True)
        _no_header = _make_probe(Path(_probe_dir) / "noheader.hwpx",
                                 neutral_preview=True, drop_header=True)
        _mime_last = _make_probe(Path(_probe_dir) / "mimelast.hwpx",
                                 neutral_preview=True, mimetype_last=True)
        check("hook: hwpx_guard.py exists", os.path.isfile(_hook))

        def _guard(cmd):
            return _run_hook(_hook, {"tool_name": "Bash",
                                     "tool_input": {"command": cmd}})

        _r = _guard(f"open {_still_boxed}")
        check("hook: blocks character-border miswiring at handoff",
              '"decision": "block"' in _r.stdout and "fix_borders.py" in _r.stdout,
              _r.stdout.strip()[:60])
        _r = _guard(f"open {_no_header}")
        check("hook: blocks a missing required entry at handoff",
              '"decision": "block"' in _r.stdout
              and "Contents/header.xml" in _r.stdout,
              _r.stdout.strip()[:60])
        _r = _guard(f"open {_mime_last}")
        check("hook: blocks packages whose first entry is not mimetype",
              '"decision": "block"' in _r.stdout
              and "first ZIP entry" in _r.stdout,
              _r.stdout.strip()[:60])
        # The preview is already clean, so this path must pass. It catches a hook
        # that degenerates into blocking everything.
        _r = _guard(f"open {_dirty}")
        check("hook: does not block handoff of sanitized output",
              _r.returncode == 0 and "block" not in _r.stdout,
              _r.stdout.strip()[:60])
        _r = _guard(f"python3 md_to_hwpx.py a.md {_still_boxed}")
        check("hook: allows this skill's own command because it is not a handoff",
              _r.stdout.strip() == "", _r.stdout.strip()[:60])
        _r = _run_hook(_hook, None, raw="이건 JSON 이 아니다")
        check("hook: fails open on unreadable input (rc=0 and no output)",
              _r.returncode == 0 and _r.stdout.strip() == "",
              f"rc={_r.returncode}")
    finally:
        shutil.rmtree(_probe_dir, ignore_errors=True)


    # Reject assertions that evaluate to constants, such as `... if cond else True`.
    # The AST scan reads only this suite, so it stays before the gate. I-2 also
    # pins both directions of the fontRef example after a numeric-ID-to-name
    # reversal escaped needles, size, and survival checks.
    _fmt2 = io.open(os.path.join(ROOT, "references", "hwpx-format.md"),
                    encoding="utf-8").read()
    check("I-2: fontRef example uses the numeric-ID form", '<hh:fontRef hangul="1"' in _fmt2)
    check("I-2: example element lacks the font-name form (correction quote excepted)",
          '<hh:fontRef hangul="한양신명조"' not in _fmt2)
    # Pin prose too: a mutation that preserved the element but reverted the
    # explanation escaped all three axes. The incorrect name form belongs only
    # in the correction quote.
    check("I-2: font-name form appears only in the correction quote",
          _fmt2.count('hangul="한양신명조"') == 1,
          f"{_fmt2.count(chr(96) + chr(96))} / actual {_fmt2.count('hangul=' + chr(34) + '한양신명조' + chr(34))} occurrences")
    check("I-2: numeric-ID explanation remains",
          '`hangul="1"` selects **함초롬바탕**' in _fmt2)

    # Verify section declarations cover every disappearing check. An uncovered
    # check vanishes instead of failing when a script is empty. Keep this before
    # the lxml gate so it also runs in fallback.
    _uncovered = sorted(n for n in _LIVE_SKIPPED
                        if not n.startswith(_SECTION_PREFIXES))
    check("자기검사: section declarations cover every disappearing check", not _uncovered,
          f"uncovered {_uncovered}" if _uncovered else f"{len(_LIVE_SKIPPED)} checks")

    check_no_constant_assertions(check, __file__)

    # 0. Dependency: check the **acquisition path** and fail if none exists.
    if provider is None:
        # Fallback C: unavailable does not count as passing.
        check("dependency: an lxml acquisition path exists", False,
              f"{detail} — users install it themselves: "
              "uv pip install -r skills/hwpx/requirements.txt")
        # Print every disappearing check by name. An earlier 15-line summary
        # represented 64 lost checks and hid 14 diagnostic names.
        for _axis in SKIPPED_AXES:
            print(f"[SKIP] {_axis} — cannot run without lxml")
        # Do not lock the total of a partial run; report it as unmeasurable.
        check("자기검사: total check count", False,
              "unmeasurable without dependency; measure totals only in a full run")
        passed = sum(1 for _, ok, _ in results if ok)
        print(f"\n{passed}/{len(results)} 통과, {len(SKIPPED_AXES)}개 판정 건너뜀 "
              "— 의존성 부재(스위트 판정: 실패)")
        return 2                      # Distinguish dependency failure from contract failure (1).

    # Record **where acquisition succeeded**. The uv detail preserves the fact
    # that the user's ambient environment still lacks lxml.
    check("dependency: an lxml acquisition path exists", provider is not None,
          {"ambient": f"ambient python3 — {detail}",
           "uv-child": f"temporary uv environment; absent from ambient python3 ({detail})",
           }[provider])


    # Do not die when a script is empty. An import or attribute crash makes all
    # checks below disappear without failing, which is silence rather than a contract.
    import importlib

    broken = []

    def need(modname, *attrs):
        try:
            mod = importlib.import_module(modname)
        except Exception as e:                  # noqa: BLE001 - preserve the reason
            broken.append(f"{modname}: import failed — {type(e).__name__}: {e}")
            return None
        missing = [a for a in attrs if not hasattr(mod, a)]
        if missing:
            broken.append(f"{modname}: missing names {missing}")
            return None
        return mod

    md_to_hwpx = need("md_to_hwpx", "write_hwpx", "parse_markdown")
    rekian_xml = need("rekian_xml", "parse_xml")
    build_hwpx = need("build_hwpx", "AVAILABLE_TEMPLATES")
    analyze_template = need("analyze_template", "get_text", "analyze_fonts")
    batch_convert = need("batch_convert", "infer_title", "CONVERTER")
    _text_extract = need("text_extract", "TAG_T")
    validate_hwpx = need("validate_hwpx", "validate", "REQUIRED_FILES")
    office_unpack = None
    try:
        from office import unpack as office_unpack  # noqa: E402
    except Exception as e:                          # noqa: BLE001
        broken.append(f"office.unpack: import failed — {type(e).__name__}: {e}")
    from lxml import etree  # noqa: E402

    # Convert absence into checks instead of returning early. `_Section` records
    # every missing dependent name as a failure, and all paths reach check_total.
    for why in broken:
        check("script unavailable", False, why)

    # md_to_hwpx, office.unpack, and build_hwpx section. Names remain as checks
    # even when no artifact exists.
    with section(check, results, *_axes('delta:', 'core:', 'baseline:')):
        # 1. Delta: prevent reference-preview leakage. `write_hwpx` passes through
        # every unlisted entry, including a client's first-page thumbnail.
        SECRET = b"\x89PNG\r\n\x1a\n" + b"REFERENCE-ORIGINAL-THUMBNAIL" * 20
        ref = make_reference(tmp, SECRET)
        out = tmp / "out.hwpx"
        md_to_hwpx.write_hwpx(ref, out, b"<sec/>", b"<hdr/>",
                              [{"type": "paragraph", "text": "본문"}], "제목")
        with zipfile.ZipFile(out) as z:
            got = z.read("Preview/PrvImage.png")
        check("delta: reference preview does not leak into the output",
              got != SECRET and b"REFERENCE-ORIGINAL" not in got,
              f"output thumbnail {len(got)}B")
        neutral = (BASE / "Preview" / "PrvImage.png").read_bytes()
        check("delta: preview is replaced with the neutral image", got == neutral)

        # 2. Delta: block zip slip in office/unpack.safe_destination.
        outdir = tmp / "slip"
        outdir.mkdir()
        # If the guard disappears, fail instead of crashing. Earlier an empty
        # unpack.py stopped the suite with AttributeError and added no failures.
        _sd = getattr(office_unpack, "safe_destination", None)
        blocked = 0
        for evil in ("../escape.txt", "../../escape.txt", "/etc/passwd"):
            if _sd is None:
                break
            try:
                _sd(outdir, evil)
            except ValueError:
                blocked += 1
        check("delta: all three zip-slip path forms are blocked", blocked == 3,
              f"{blocked}/3" if _sd else "safe_destination is missing")
        inside = _sd(outdir, "Contents/header.xml") if _sd else None
        check("delta: safe entries pass",
              inside is not None and outdir.resolve() in inside.parents)

        # 3. Delta: clear line-layout caches so Hancom recalculates them.
        xml = (b'<hp:sec xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">'
               b'<hp:p><hp:linesegarray><hp:lineseg/></hp:linesegarray></hp:p>'
               b'<hp:p><hp:linesegarray><hp:lineseg/></hp:linesegarray></hp:p>'
               b'</hp:sec>')
        root = etree.fromstring(xml)
        n = rekian_xml.clear_linesegarrays(root)
        left = len(root.findall(".//{*}linesegarray"))
        check("delta: clear_linesegarrays removes caches", n == 2 and left == 0,
              f"removed {n} / remaining {left}")

        # 3'. Granularity: **modified-paragraph-only mutation** (I-13). Full
        # removal is safe but destroys linesegarray count as a raw diagnostic.
        root2 = etree.fromstring(xml)
        paras = root2.findall(".//{*}p")
        n2 = rekian_xml.clear_linesegarrays(root2, [paras[0]])
        left2 = len(root2.findall(".//{*}linesegarray"))
        check("delta: a targeted paragraph mutation preserves untouched paragraph caches",
              n2 == 1 and left2 == 1, f"removed {n2} / remaining {left2}")
        check("delta: the surviving cache belongs to the second paragraph",
              rekian_xml.owning_paragraph(
                  root2.findall(".//{*}linesegarray")[0]) is paras[1])

        # 3''. **Caller binding**: direct function tests stayed green when the
        # rewrite_redraftable_paragraphs call was removed. Exercise the real path.
        _sd = tempfile.mkdtemp()
        _sp = os.path.join(_sd, "section0.xml")
        io.open(_sp, "w", encoding="utf-8").write(
            '<hp:sec xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">'
            "<hp:p><hp:run><hp:t>가</hp:t></hp:run>"
            "<hp:linesegarray><hp:lineseg/></hp:linesegarray></hp:p>"
            "<hp:p><hp:run><hp:t>나</hp:t></hp:run>"
            "<hp:linesegarray><hp:lineseg/></hp:linesegarray></hp:p>"
            "</hp:sec>")
        try:
            rekian_xml.rewrite_redraftable_paragraphs(Path(_sp), {0: "다"})
            _after = etree.fromstring(io.open(_sp, "rb").read())
            _left3 = len(_after.findall(".//{*}linesegarray"))
            check("delta: the rewrite path actually clears caches (caller binding)",
                  _left3 == 0, f"remaining {_left3}")
        except Exception as _e:   # noqa: BLE001 - retain failures as checks
            check("delta: the rewrite path actually clears caches (caller binding)", False, str(_e)[:80])
        finally:
            shutil.rmtree(_sd, ignore_errors=True)

        # 4. Delta: static AVAILABLE_TEMPLATES allowlist. This is the only code
        # barrier against an upstream templates/proposal containing real bid data.
        check("delta: the template list is static",
              build_hwpx.AVAILABLE_TEMPLATES == ["report"],
              str(build_hwpx.AVAILABLE_TEMPLATES))
        # Argparse enforcement, proposal prohibition, and fixture existence run
        # before the gate because they require only file reads.

        # 5. Core fixture conversion round trip.
        blocks = md_to_hwpx.parse_markdown(io.open(FIXTURE, encoding="utf-8").read())
        check("core: Markdown parsing produces blocks", len(blocks) > 0, f"{len(blocks)} blocks")
        kinds = {b.get("type") for b in blocks}
        check("core: tables, lists, and paragraphs are all recognized",
              {"table", "paragraph"} <= kinds, str(sorted(kinds)))

        ref2 = make_reference(tmp, neutral)
        out2 = tmp / "fixture.hwpx"
        md_to_hwpx.write_hwpx(ref2, out2, b"<sec/>", b"<hdr/>", blocks, "픽스처")
        with zipfile.ZipFile(out2) as z:
            names = set(z.namelist())
            prv = z.read("Preview/PrvText.txt").decode("utf-8")
        check("core: output contains required entries",
              {"mimetype", "Contents/header.xml", "Contents/section0.xml"} <= names,
              f"{len(names)} entries")
        # The earlier "first uncompressed entry" check never inspected compression.
        _mi = zipfile.ZipFile(out2).infolist()[0]
        check("core: mimetype is the first entry", _mi.filename == "mimetype", _mi.filename)
        check("core: mimetype is uncompressed (ZIP_STORED)",
              _mi.compress_type == zipfile.ZIP_STORED, str(_mi.compress_type))
        check("core: preview text reflects the document body", "테스트" in prv,
              repr(prv[:30]))

        # 6. Freeze block structure as the regression baseline for upstream resyncs.
        gold = os.path.join(HERE, "gold", "minimal_blocks.json")
        shape = [{"type": b.get("type"),
                  "level": b.get("level"),
                  "rows": len(b.get("rows", [])) if b.get("type") == "table" else None}
                 for b in blocks]
        if os.path.exists(gold):
            want = json.load(io.open(gold, encoding="utf-8"))
            check("baseline: block structure matches the frozen copy", shape == want,
                  "mismatch" if shape != want else f"{len(shape)} blocks")
        elif os.environ.get("FREEZE_BASELINE"):
            # Refresh only with **explicit intent**.
            os.makedirs(os.path.dirname(gold), exist_ok=True)
            io.open(gold, "w", encoding="utf-8").write(
                json.dumps(shape, ensure_ascii=False, indent=2))
            check("baseline: rewrote frozen copy (FREEZE_BASELINE)", False,
                  f"{os.path.relpath(gold, ROOT)} — record the update in a commit and rerun")
        else:
            # Absence must not pass by silently creating a new baseline.
            check("baseline: block structure matches the frozen copy", False,
                  f"frozen copy missing ({os.path.relpath(gold, ROOT)}) — "
                  "rerun with FREEZE_BASELINE=1 only for an intentional update")

        # Self-check the defect class directly by running a body-deleted copy.
        # Floors are measured values, including per-file floors that prevent
        # aggregate cancellation and expose references contributing zero checks.
        # Zero is forbidden. The AST scan also rejects constant assertions, and
        # script contracts keep formerly unmeasured scripts under observation.

    # validate_hwpx section; names remain checks even without an artifact.
    with section(check, results, *_axes('validate_hwpx:')):
        # Valid output passes; removing a required entry must fail.
        errs_ok = validate_hwpx.validate(str(out2))
        check("validate_hwpx: valid output has no errors", errs_ok == [], str(errs_ok[:2]))
        broken_path = tmp / "broken.hwpx"
        with zipfile.ZipFile(out2) as zin, zipfile.ZipFile(broken_path, "w") as zout:
            for it in zin.infolist():
                if it.filename == "Contents/header.xml":
                    continue                        # Remove one required entry.
                zout.writestr(it, zin.read(it.filename))
        errs_bad = validate_hwpx.validate(str(broken_path))
        check("validate_hwpx: a missing required entry is detected (live assertion)",
              errs_bad != [], f"{errs_bad[:2]}")
        check("validate_hwpx: a missing file is an error",
              validate_hwpx.validate(str(tmp / "nope.hwpx")) != [])
        check("validate_hwpx: the required-entry list is nonempty",
              len(validate_hwpx.REQUIRED_FILES) >= 3,
              str(validate_hwpx.REQUIRED_FILES))

        # ------------------------------------------------------------------
        # Exercise the required-entry list. Earlier checks only removed header.xml
        # or checked len >= 3, so deleting mimetype from REQUIRED_FILES stayed green.
        # Remove each entry independently and require detection.
        # ------------------------------------------------------------------
        REQUIRED_CANON = ["mimetype", "Contents/content.hpf",
                          "Contents/header.xml", "Contents/section0.xml"]
        check("validate_hwpx: the required-entry list matches the canonical order",
              list(validate_hwpx.REQUIRED_FILES) == REQUIRED_CANON,
              str(validate_hwpx.REQUIRED_FILES))

        def _without(entry):
            """Return a copy of `_secpr_base` with one entry removed."""
            probe = tmp / ("miss_" + entry.replace("/", "_") + ".hwpx")
            with zipfile.ZipFile(_req_base) as zin, \
                    zipfile.ZipFile(probe, "w") as zout:
                for it in zin.infolist():
                    if it.filename == entry:
                        continue
                    zout.writestr(it, zin.read(it.filename))
            return validate_hwpx.validate(str(probe))

        _req_base = Path(_make_probe(tmp / "required_base.hwpx", neutral_preview=True))
        _req_names = set(zipfile.ZipFile(_req_base).namelist())
        check("validate_hwpx: the required-entry probe covers the complete list",
              set(REQUIRED_CANON) <= _req_names,
              str(sorted(set(REQUIRED_CANON) - _req_names)))
        for _req in REQUIRED_CANON:
            _e = _without(_req)
            check(f"validate_hwpx: a missing {_req} is detected",
                  any(f"Missing required file: {_req}" in x for x in _e), f"{_e[:2]}")

        # The mimetype **value** is also a contract; Hancom cannot open arbitrary values.
        check("validate_hwpx: EXPECTED_MIMETYPE is the canonical OPC value",
              validate_hwpx.EXPECTED_MIMETYPE == "application/hwp+zip",
              repr(validate_hwpx.EXPECTED_MIMETYPE))
        _mt_probe = tmp / "badmime.hwpx"
        with zipfile.ZipFile(_req_base) as zin, \
                zipfile.ZipFile(_mt_probe, "w") as zout:
            for it in zin.infolist():
                zout.writestr(it, b"application/zip" if it.filename == "mimetype"
                              else zin.read(it.filename))
        _mt_errs = validate_hwpx.validate(str(_mt_probe))
        check("validate_hwpx: an incorrect mimetype value is detected",
              any("Invalid mimetype" in x for x in _mt_errs), f"{_mt_errs[:2]}")

        # Pin required secPr children by **name**, not only a count floor.
        SECPR_CANON = ("grid", "startNum", "visibility", "lineNumberShape",
                       "pagePr", "footNotePr", "endNotePr", "pageBorderFill")
        check("validate_hwpx: the required secPr child names match the canonical set",
              tuple(validate_hwpx.SECPR_REQUIRED_CHILDREN) == SECPR_CANON,
              str(validate_hwpx.SECPR_REQUIRED_CHILDREN))

        # --- secPr child completeness (I-5) ----------------------------------
        # Presence alone misses children whose absence resets paper and margins
        # to Hancom defaults. Inject the defects and require their recovery.
        check("validate_hwpx: required secPr children cover all eight concrete types",
              len(validate_hwpx.SECPR_REQUIRED_CHILDREN) >= 8
              and "pagePr" in validate_hwpx.SECPR_REQUIRED_CHILDREN,
              str(validate_hwpx.SECPR_REQUIRED_CHILDREN))
        _base_errs = validate_hwpx.validate_semantic(str(out2))
        check("validate_hwpx: valid output has no secPr child defects",
              not [e for e in _base_errs if "secPr is missing required child" in e],
              f"{_base_errs[:2]}")

        # Use `templates/base`; fallback output contains only `<sec/>` and no secPr,
        # so removing a child there would measure nothing.
        _secpr_base = Path(_make_probe(tmp / "secpr_base.hwpx", neutral_preview=True))
        check("validate_hwpx: the base probe starts with a complete secPr",
              not [e for e in validate_hwpx.validate_semantic(str(_secpr_base))
                   if "secPr" in e],
              str(validate_hwpx.validate_semantic(str(_secpr_base))[:2]))

        def _secpr_probe(dropper):
            """Copy base section0 while removing one secPr child."""
            probe = tmp / "secpr_probe.hwpx"
            with zipfile.ZipFile(_secpr_base) as zin:
                sec = etree.fromstring(zin.read("Contents/section0.xml"))
                dropper(sec)
                payload = etree.tostring(sec, encoding="UTF-8", xml_declaration=True)
                with zipfile.ZipFile(probe, "w") as zout:
                    for it in zin.infolist():
                        if it.filename == "mimetype":
                            zout.writestr(zipfile.ZipInfo("mimetype"),
                                          zin.read("mimetype"),
                                          compress_type=zipfile.ZIP_STORED)
                        elif it.filename == "Contents/section0.xml":
                            zout.writestr(it, payload)
                        else:
                            zout.writestr(it, zin.read(it.filename))
            return validate_hwpx.validate_semantic(str(probe))

        def _drop(tag):
            def _f(sec):
                for el in sec.findall(f".//{{*}}{tag}"):
                    el.getparent().remove(el)
            return _f

        _errs = _secpr_probe(_drop("pagePr"))
        check("validate_hwpx: removing pagePr from secPr is detected",
              any("hp:secPr is missing required child: hp:pagePr" in e for e in _errs),
              f"{_errs[:2]}")
        _errs = _secpr_probe(_drop("margin"))
        check("validate_hwpx: a missing margin inside pagePr is detected separately",
              any("hp:pagePr/hp:margin" in e for e in _errs), f"{_errs[:2]}")
        check("validate_hwpx: that defect is classified as document/structure",
              validate_hwpx.classify(
                  "hp:secPr is missing required child: hp:pagePr")
              == "document/structure")

    # validate_hwpx diagnostic mapping section; names remain checks without artifacts.
    with section(check, results, *_axes('diagnostics:')):
        # `validate()` retains its return type. JSON is produced by the mapping
        # layer in main(), so this section verifies that it swallows no diagnostics.
        VAL = os.path.join(SCRIPTS, "validate_hwpx.py")

        def vpayload(*argv):
            r = subprocess.run([sys.executable, VAL, *argv],
                               capture_output=True, text=True)
            try:
                return json.loads(r.stdout), r
            except ValueError:
                return None, r

        ok_p, ok_r = vpayload(str(out2), "--json")
        check("diagnostics: --json output is one valid JSON value", ok_p is not None,
              (ok_r.stdout or ok_r.stderr).strip()[:80])
        check("diagnostics: envelope has schemaVersion 1 and identifies its source",
              bool(ok_p) and ok_p.get("schemaVersion") == 1
              and ok_p.get("source") == "validate_hwpx", str(ok_p)[:60])
        check("diagnostics: valid output has ok=true and no diagnostics",
              bool(ok_p) and ok_p.get("ok") is True and ok_p.get("diagnostics") == []
              and ok_r.returncode == 0,
              str(ok_p.get("diagnostics"))[:80] if ok_p else "no envelope")

        bad_p, bad_r = vpayload(str(broken_path), "--json")
        codes = [d.get("code") for d in (bad_p or {}).get("diagnostics", [])]
        check("diagnostics: missing required entry becomes package/missing-file",
              bool(bad_p) and bad_p.get("ok") is False and bad_r.returncode != 0
              and "package/missing-file" in codes, str(codes))
        check("diagnostics: severity is error",
              bool(bad_p) and all(d.get("severity") == "error"
                                  for d in bad_p.get("diagnostics", []))
              and codes != [], str(codes))
        # Count identity prevents the mapping layer from silently swallowing items.
        check("diagnostics: diagnostic count equals validate() result count (no swallowing)",
              bool(bad_p)
              and len(bad_p.get("diagnostics", [])) == len(errs_bad),
              f'{len((bad_p or {}).get("diagnostics", []))} vs {len(errs_bad)}')

        # Detection power: inject a nonexistent IDRef and require reference/undefined.
        sem_path = tmp / "semantic-broken.hwpx"
        base_sec = (BASE / "Contents" / "section0.xml").read_text(encoding="utf-8")
        bad_sec = base_sec.replace('styleIDRef="0"', 'styleIDRef="99999"', 1)
        check("diagnostics: the injected IDRef mutation changes the file", bad_sec != base_sec)
        with zipfile.ZipFile(out2) as zin, zipfile.ZipFile(sem_path, "w") as zout:
            for it in zin.infolist():
                zout.writestr(it, bad_sec.encode("utf-8")
                              if it.filename == "Contents/section0.xml"
                              else zin.read(it.filename))
        sem_p, sem_r = vpayload(str(sem_path), "--semantic", "--json")
        sem_ds = [d for d in (sem_p or {}).get("diagnostics", [])
                  if d.get("code") == "reference/undefined"]
        check("diagnostics: injected undefined IDRef is classified as reference/undefined",
              sem_r.returncode != 0 and len(sem_ds) >= 1,
              str([d.get("code") for d in (sem_p or {}).get("diagnostics", [])])[:80])
        d0 = sem_ds[0] if sem_ds else {}
        check("diagnostics: evidence structures idref instead of raw text",
              d0.get("evidence", {}).get("idref") == "99999",
              str(d0.get("evidence"))[:80])
        fixes = d0.get("supportedFixes", [])
        check("diagnostics: five repair stages appear in relocate-to-delete order",
              [f.get("action") for f in fixes]
              == ["relocate", "reroute", "shorten", "restructure", "delete"],
              str([f.get("action") for f in fixes]))
        check("diagnostics: only deletion requires evidence (requiresEvidence)",
              len(fixes) == 5
              and [f.get("requiresEvidence") for f in fixes]
              == [False, False, False, False, True],
              str([f.get("requiresEvidence") for f in fixes]))
        # Read/package defects must not receive false reference-repair guidance.
        miss = next((d for d in (bad_p or {}).get("diagnostics", [])
                     if d.get("code") == "package/missing-file"), {})
        check("diagnostics: package defects omit the five stages (no false guidance)",
              miss.get("supportedFixes") == [], str(miss.get("supportedFixes"))[:60])

        # Document body text cannot select its own diagnostic code (F1). When
        # classification searched a message containing the first 40 body chars,
        # `1. undefined styleIDRef=9` changed the code to reference/undefined,
        # fabricated evidence.idref, and attached false repair guidance.
        inj_path = tmp / "text-steered.hwpx"
        inj_sec = base_sec.replace(
            "</hs:sec>",
            '  <hp:p id="777" paraPrIDRef="0" styleIDRef="0" pageBreak="0" '
            'columnBreak="0" merged="0"><hp:run charPrIDRef="0">'
            '<hp:t>1. undefined styleIDRef=9</hp:t></hp:run></hp:p>\n</hs:sec>')
        check("diagnostics: steering paragraph was actually injected", inj_sec != base_sec)
        with zipfile.ZipFile(out2) as zin, zipfile.ZipFile(inj_path, "w") as zout:
            for it in zin.infolist():
                zout.writestr(it, inj_sec.encode("utf-8")
                              if it.filename == "Contents/section0.xml"
                              else zin.read(it.filename))
        inj_p, _inj_r = vpayload(str(inj_path), "--semantic", "--json")
        inj_ds = [d for d in (inj_p or {}).get("diagnostics", [])
                  if d.get("subject", {}).get("identity") == "777"]
        ord_ds = [d for d in inj_ds
                  if d.get("message", "").startswith("ordered list marker")]
        check("diagnostics: paragraph text cannot steer the code (F1)",
              len(ord_ds) == 1
              and ord_ds[0].get("code") == "conversion/residual-markup",
              str([(d.get("code"), d.get("message", "")[:30]) for d in inj_ds])[:90])
        # The body-text `styleIDRef=9` exists nowhere. If it reaches evidence,
        # the diagnostic fabricated a reference.
        fabricated = [d for d in (inj_p or {}).get("diagnostics", [])
                      if d.get("evidence", {}).get("idref") == "9"]
        check("diagnostics: body text cannot fabricate reference evidence (F1)",
              not fabricated and bool(ord_ds)
              and "idref" not in ord_ds[0].get("evidence", {}),
              str(fabricated or (ord_ds[0].get("evidence") if ord_ds else "no diagnostic"))[:80])

        nf_p, nf_r = vpayload(str(tmp / "nope.hwpx"), "--json")
        check("diagnostics: a missing file becomes input/read",
              bool(nf_p) and nf_r.returncode != 0
              and [d.get("code") for d in nf_p.get("diagnostics", [])] == ["input/read"],
              str(nf_p.get("diagnostics", [{}])[0].get("code")) if nf_p else "no envelope")

        # Human-readable output must remain unchanged when JSON support is added.
        h = subprocess.run([sys.executable, VAL, str(out2)],
                           capture_output=True, text=True)
        check("diagnostics: VALID line remains unchanged without --json",
              h.returncode == 0 and h.stdout.startswith("VALID: "),
              h.stdout.strip()[:60] or h.stderr.strip()[:60])
        check("diagnostics: human-readable output does not mix in JSON",
              "schemaVersion" not in h.stdout and not h.stdout.startswith("{"),
              h.stdout[:60])

    # text_extract section; names remain checks even without an artifact.
    with section(check, results, *_axes('text_extract:')):
        # Extract actual body content from the artifact.
        with zipfile.ZipFile(out2) as z:
            sec_xml = z.read("Contents/section0.xml").decode("utf-8", "replace")
        tx = subprocess.run([sys.executable, os.path.join(SCRIPTS, "text_extract.py"),
                             str(out2)], capture_output=True, text=True)
        # Match extraction to text-node presence so an always-empty extractor fails.
        has_text = "<hp:t" in sec_xml
        check("text_extract: extracted output agrees with body-text presence",
              tx.returncode == 0 and bool(tx.stdout.strip()) == has_text,
              f"rc={tx.returncode} section has hp:t={has_text}, extracted={len(tx.stdout.strip())} chars")
        check("text_extract: a missing file is an error",
              subprocess.run([sys.executable, os.path.join(SCRIPTS, "text_extract.py"),
                              str(tmp / "nope.hwpx")],
                             capture_output=True).returncode != 0)

    # rekian_xml section; names remain checks even without an artifact.
    with section(check, results, *_axes('rekian_xml:')):
        # Verify the XML parse round trip.
        xml_path = tmp / "probe.xml"
        xml_path.write_bytes(b'<?xml version="1.0"?><a><b/><b/></a>')
        tree = rekian_xml.parse_xml(xml_path)
        check("rekian_xml: parses XML from a path and returns a tree",
              tree is not None and len(list(tree.getroot())) == 2)

    # office pack/unpack round-trip section; names remain checks without artifacts.
    with section(check, results, *_axes('office/unpack:')):
        # office/unpack pairs with pack.py and imports lxml, so it runs after the
        # gate. The delta axis covers safe_destination; this checks entry preservation.
        _ud = Path(tempfile.mkdtemp())
        try:
            _src = Path(_make_probe(_ud / "rt.hwpx", neutral_preview=True))
            _r = _run_py(os.path.join(SCRIPTS, "office", "unpack.py"),
                         _src, _ud / "out")
            check("office/unpack: extracts hwpx into a directory (rc=0)",
                  _r.returncode == 0 and (_ud / "out" / "mimetype").is_file(),
                  _r.stderr.strip()[:80])
            _rp = _run_py(os.path.join(SCRIPTS, "office", "pack.py"),
                          _ud / "out", _ud / "rt2.hwpx")
            check("office/unpack: unpacking and repacking preserves entries",
                  _rp.returncode == 0
                  and set(zipfile.ZipFile(_ud / "rt2.hwpx").namelist())
                  == set(zipfile.ZipFile(_src).namelist()),
                  _rp.stderr.strip()[:80])
        finally:
            shutil.rmtree(_ud, ignore_errors=True)

    # analyze_template section; names remain checks even without an artifact.
    with section(check, results, *_axes('analyze_template:')):
        # Read real data from the base template.
        hdr = (BASE / "Contents" / "header.xml")
        check("analyze_template: base template header.xml exists", hdr.is_file())
        hroot = etree.parse(str(hdr)).getroot()
        fonts = analyze_template.analyze_fonts(hroot)
        # An empty-list implementation must fail; actual font rows are required.
        check("analyze_template: reads actual font definitions from the base template",
              len(fonts) > 1, f"{len(fonts)} rows")

    # batch_convert section; names remain checks even without an artifact.
    with section(check, results, *_axes('batch_convert:')):
        # Exercise the filename-to-title rule.
        check("batch_convert: strips numeric prefixes and changes underscores to spaces",
              batch_convert.infer_title(Path("01_제안_개요.md")) == "제안 개요",
              batch_convert.infer_title(Path("01_제안_개요.md")))
        check("batch_convert: converter path points inside this skill",
              "md_to_hwpx" in str(batch_convert.CONVERTER), str(batch_convert.CONVERTER))

    # Measure once for all three axes. Checks added before the consumers have
    # excluded prefixes, so the value is stable and cannot drift between copies.
    live_ran = sum(1 for r in results
                   if not r[0].startswith(("자기검사:", "계약 커버리지:",
                                           "스크립트 계약:")))

    # Script-contract axis: measured number of checks broken by emptying each script.
    check_script_contracts(check, __file__, ROOT, runner=_runner_for(provider),
                           live_ran=live_ran,
                           scripts={
                               "scripts/analyze_template.py": 2,
                               "scripts/batch_convert.py": 3,
                               # Covers both the allowlist constant at runtime and
                               # argparse enforcement in source before the gate.
                               "scripts/build_hwpx.py": 49,
                               "scripts/md_to_hwpx.py": 58,
                               "scripts/rekian_xml.py": 54,
                               "scripts/text_extract.py": 2,
                               # 38: 19 validator checks, 18 diagnostic checks, and
                               # one check_no_constant_assertions source check.
                               "scripts/validate_hwpx.py": 38,
                               # Three additions and shared code, all measured before
                               # the gate and independent of lxml availability.
                               "scripts/fix_borders.py": 5,
                               "scripts/sanitize_template.py": 5,
                               # Shared ZIP code; emptying it breaks both consumers.
                               "scripts/hwpx_zip.py": 12,
                               "hooks/hwpx_guard.py": 3,
                               # Formerly absent from both the dictionary and checks.
                               "scripts/office/pack.py": 8,
                               "scripts/office/unpack.py": 4,
                           })
    check_contract_coverage(check, __file__, ROOT, runner=_runner_for(provider), per_file={
        "SKILL.md": 19,
        "agents/openai.yaml": 3,
        "scripts/ensure_hwpx.sh": 3,
        "references/com-windows-guide.md": 3,
        "references/example-flow.md": 3,
        "references/hitl-review.md": 3,
        "references/hwpx-format.md": 15,
        "references/markdown-proposal-rules.md": 3,
        "references/style-intake.md": 3,
        "references/troubleshooting.md": 4,
        "references/validation-rules.md": 3,
        "references/workflows.md": 3,
        "references/xml-structure.md": 3,
        "references/hangul-practice.md": 5,
        "references/render-checklist.md": 3,
        "references/kordoc-public-doc.md": 3,
    }, live_ran=live_ran)

    check_body_deletion(check, __file__, ROOT, runner=_runner_for(provider), minimum=19,
                        extra_strip=(),
                        live_ran=live_ran)


    # Verify that [SKIP] names represent checks that really disappear by forcing
    # one fallback child and subtracting its emitted names. Do not do this in
    # deleted copies, which would add another child to each of roughly 20 runs.
    if not in_deleted_run():
        _fb = subprocess.run([sys.executable, os.path.abspath(__file__)],
                             capture_output=True, text=True,
                             env=dict(os.environ, **{_FORCE_NO_LXML: "1"}),
                             cwd=os.getcwd())
        # Do not truncate names at ` — ` because some names contain it. Match a
        # complete name or the same name followed by a detail separator.
        _fb_lines = re.findall(r"(?m)^\[(?:PASS|FAIL)\] (.+)$", _fb.stdout)

        def _ran_in_fallback(n):
            return any(ln == n or ln.startswith(n + " — ") for ln in _fb_lines)
        _fb_skips = len(re.findall(r"(?m)^\[SKIP\] ", _fb.stdout))
        _self_name = "자기검사: [SKIP] list names every disappearing check"
        _full = {r[0] for r in results} | {_self_name, TOTAL_NAME}
        _lost = {n for n in _full
                 if not _ran_in_fallback(n)
                 and n != _self_name and not n.startswith("자기검사: 검사 총수")}
        _missing = sorted(_lost - set(SKIPPED_AXES))
        _stale = sorted(set(SKIPPED_AXES) - _lost)
        check(_self_name,
              _fb.returncode == 2 and _fb_skips == len(SKIPPED_AXES)
              and not _missing and not _stale,
              f"fallback rc={_fb.returncode}, {_fb_skips} [SKIP] lines, "
              f"{len(_lost)} disappearing checks"
              + (f" · missing from list {_missing}" if _missing else "")
              + (f" · only in list {_stale}" if _stale else ""))

    # Lock the total count. Review 10 deleted a reference together with its
    # contracts, floors, and frozen copy, losing four checks without failure.
    check_total(check, results, TOTAL_EXPECTED)
    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n{passed}/{len(results)} 통과")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    _rc = main()
    # Leave independent proof for the uv parent that the suite really ran. A
    # crashing child never reaches this line, so the parent will distrust it.
    _write_child_mark(_rc)
    sys.exit(_rc)
