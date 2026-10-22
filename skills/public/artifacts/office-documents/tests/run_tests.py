#!/usr/bin/env python3
"""Office regression suite.

Run python3 tests/run_tests.py from skills/office.

The value of this skill is the contracts it enforces when invoking OfficeCLI:
no officecli install (prevent global changes), East Asian font verification
through XML rather than effective.font, three ensure outcomes, and handoffs
to hwpx/deck. Separate network-dependent OfficeCLI checks from local contracts;
installation policy, font verification, and routing remain measurable offline.
"""
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile

sys.dont_write_bytecode = True
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
# Turn import errors into judgments, not suite death. A bare test_router import
# with a syntax or import-time error kills the suite and appears as zero
# failures; the declared fallback was unreachable. A single def run( line
# measured rc=1 and zero FAILs. Retain the reason for the fallback detail.
_ROUTER_IMPORT_ERROR = ""
try:
    import test_router  # noqa: E402  — owns routing contracts
except Exception as _e:  # noqa: BLE001 — preserve the absence reason
    test_router = None
    _ROUTER_IMPORT_ERROR = f"{type(_e).__name__}: {_e}"
# Shared skill helpers prevent frontmatter shadowing as a defect class.
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
from _suite_lib import (check_skill_body, check_no_constant_assertions, check_script_contracts, check_total, split_frontmatter, check_body_deletion,
                        check_contract_coverage)  # noqa: E402
ROOT = os.path.dirname(HERE)
SCRIPTS = os.path.join(ROOT, "scripts")
CHECK = os.path.join(SCRIPTS, "check_cjk_font.py")
ENSURE = os.path.join(SCRIPTS, "ensure_officecli.sh")

# Declare the population emitted by test_router.run. Emptying that file must
# fail these checks, not erase them from failure-only measurement.
ROUTER_CHECKS = 9

# Lock section headings, order, and each section's substantive skeleton.
# A single volume floor allows compensation elsewhere: deleting Phases 2/4/5
# produced only one volume failure, removable with arbitrary padding.
SECTION_SKELETON = (
    ("## Backend: OfficeCLI", ("npx --yes @officecli/officecli@latest", "global\nchange")),
    ("## Phase 0: availability", ("ensure_officecli.sh", "exit 0", "exit 1", "exit 2")),
    ("## Phase 1: choose the format", ("| Signal | Format |", "tests/test_router.py")),
    ("## Phase 2: query the tool's schema", ("help docx", "Quote paths")),
    ("## Phase 3: Korean font contract (required)",
     ("<a:ea>", "check_cjk_font.py", "Pretendard")),
    ("## Phase 4: procurement conventions", ("req_coverage.py", "procurement")),
    ("## Phase 5: save and inspect", ("officecli close", "close")),
    ("## Explicit limitations", (".doc", "refresh")),
)


def split_sections(body):
    """Split the body by ## headings into {heading: section_body}."""
    out, title, buf = {}, None, []
    for line in body.splitlines():
        if line.startswith("## "):
            if title is not None:
                out[title] = "\n".join(buf)
            title, buf = line.rstrip(), []
        elif title is not None:
            buf.append(line)
    if title is not None:
        out[title] = "\n".join(buf)
    return out

results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))


def read(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


def make_pptx(path, ea=None, text="한글 본문"):
    """Minimal PPTX, with an East Asian font assignment when ea is supplied."""
    ea_tag = f'<a:ea typeface="{ea}"/>' if ea else ""
    slide = (
        '<?xml version="1.0"?>'
        '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
        ' xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
        f'<p:cSld><a:rPr>{ea_tag}</a:rPr><a:t>{text}</a:t></p:cSld></p:sld>'
    )
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types/>')
        z.writestr("ppt/slides/slide1.xml", slide)


def main():
    tmp = tempfile.mkdtemp()

    # (1) No-install contract in both documentation and script.
    _skill_raw = read(os.path.join(ROOT, "SKILL.md"))
    skill_fm, skill = split_frontmatter(_skill_raw)
    ensure_src = read(ENSURE)
    check("Policy: SKILL.md forbids officecli install",
          "Do not run `officecli install`" in skill or "Do not run officecli install" in skill)
    check("Policy: explains global installation into every agent",
          "every detected AI agent" in skill or "global" in skill)
    # Inspect executable lines, excluding comments, for installation calls.
    exec_lines = [l for l in ensure_src.splitlines()
                  if l.strip() and not l.strip().startswith("#")]
    # A variable package name hides the officecli install phrase, so match the
    # install token itself. Exclude printf/echo guidance: showing brew install node
    # is an instruction to the user, not executing an installation.
    offending = [l.strip() for l in exec_lines
                 if re.search(r"(?<![\w-])install(?![\w-])", l)
                 and not re.match(r"\s*(printf|echo|say)\b", l)]
    check("Policy: ensure does not call install",
          not offending, str(offending[:1]))

    # (2) Distinguish three East Asian font cases. effective.font only reports
    # Latin fonts, so inspect XML directly.
    p_ok = os.path.join(tmp, "ok.pptx")
    p_no = os.path.join(tmp, "no.pptx")
    p_lat = os.path.join(tmp, "latin.pptx")
    make_pptx(p_ok, ea="Pretendard")
    make_pptx(p_no, ea=None)
    make_pptx(p_lat, ea=None, text="Latin only body")

    def run_check(path, *extra):
        r = subprocess.run([sys.executable, CHECK, path, *extra],
                           capture_output=True, text=True)
        return r.returncode, r.stdout

    rc, _ = run_check(p_ok)
    check("CJK: Korean file with ea passes", rc == 0, f"exit={rc}")
    rc, out = run_check(p_no)
    check("CJK: Korean file without ea fails", rc == 1 and "assignments (<a:ea> / w:eastAsia): 0" in out, f"exit={rc}")
    rc, out = run_check(p_lat)
    check("CJK: file without Korean is outside scope", rc == 0 and "does not apply" in out,
          f"exit={rc}")
    rc, _ = run_check(p_ok, "--require-font", "NanumGothic")
    check("CJK: required-font mismatch fails", rc == 1, f"exit={rc}")
    # Measure the success path separately. Mismatch-only testing accepted an
    # always-failing --require-font implementation; matching success was unmeasured.
    rc, out = run_check(p_ok, "--require-font", "Pretendard")
    check("CJK: required-font match passes", rc == 0 and "[OK]" in out,
          f"exit={rc} / [OK] {'present' if '[OK]' in out else 'absent'}")
    # The contract requires case-insensitive substring matching. Without this
    # probe, replacing in with == or removing lower() would remain undetected.
    rc, out = run_check(p_ok, "--require-font", "pretend")
    check("CJK: font matching is case-insensitive and accepts substrings",
          rc == 0 and "[OK]" in out, f"exit={rc}")
    rc, _ = run_check(os.path.join(tmp, "nope.pptx"))
    check("CJK: missing file exits 2", rc == 2, f"exit={rc}")

    # Lock the checker's independence from effective.font.
    src = read(CHECK)
    check("CJK: checker inspects XML a:ea",
          "a:ea" in src and "typeface" in src)
    # Prevent a constant assertion. Previously src.count of triple quotes >= 3
    # was always false with only two delimiters (one module docstring), and
    # else True made the entire assertion ignore its target. Remove docstrings
    # and inspect executable code.
    code_only = "".join(part for i, part in enumerate(src.split('"""')) if i % 2 == 0)
    check("CJK: executable code remains after removing docstrings",
          "def main" in code_only, f"{len(code_only)} characters")
    check("CJK: does not rely on effective.font",
          "effective" not in code_only,
          "Executable code contains effective")

    # (3) Three ensure outcomes.
    def run_ensure(script, path):
        r = subprocess.run(["bash", script], capture_output=True, text=True,
                           env={"PATH": path, "HOME": os.path.expanduser("~")})
        return r.returncode

    def stub_bin(**progs):
        """Create a stub directory to prepend to PATH; values are shell bodies."""
        d = tempfile.mkdtemp(dir=tmp)
        for nm, bodysh in progs.items():
            fp = os.path.join(d, nm)
            with open(fp, "w", encoding="utf-8") as f:
                f.write("#!/bin/sh\n" + bodysh + "\n")
            os.chmod(fp, 0o755)
        return d

    check("ensure: missing npx exits 2",
          run_ensure(ENSURE, "/usr/bin:/bin") == 2)
    # Execute exit 1 and exit 0 paths. Merely finding [0][1][2] accepted replacing
    # all exit 1 calls with exit 0 (47/47 passed). Two unmeasured outcomes make
    # this a three-value claim, not a contract. Simulate npx unable to fetch
    # the package with a stub that emits no output.
    _d1 = stub_bin(npx="exit 0")
    check("ensure: npx unable to fetch the package exits 1",
          run_ensure(ENSURE, f"{_d1}:/usr/bin:/bin") == 1)
    # OfficeCLI on PATH returns exit 0 directly without npx.
    _d0 = stub_bin(officecli="echo 9.9.9")
    check("ensure: OfficeCLI on PATH exits 0",
          run_ensure(ENSURE, f"{_d0}:/usr/bin:/bin") == 0)
    check("ensure: all three outcomes are documented",
          all(m in ensure_src for m in ("[0]", "[1]", "[2]")))

    # (4) Inspect routing table structure; repeated words defeat presence-only checks.
    rows = re.findall(r"(?m)^\|([^|]+)\|([^|]+)\|", skill)
    dests = " ".join(d for _, d in rows)
    check("Routing: .hwpx hands off to hwpx", "hwpx` skill" in dests
          or "hwpx" in dests)
    check("Routing: pptx design goes to deck first", "deck" in dests)

    # tests/test_router.py owns routing contracts (section 6-C). Require it to
    # actually emit judgments: an empty file gets the same number of failures
    # from the fallback loop rather than disappearing from measurement.
    _router = getattr(test_router, "run", None)
    check("Router: tests/test_router.py provides run()", callable(_router),
          "" if callable(_router)
          else (_ROUTER_IMPORT_ERROR or "File is empty or run is absent"))
    _before = len(results)
    if callable(_router):
        _router(check, ROOT, skill)
    else:
        _why = _ROUTER_IMPORT_ERROR or "test_router.py does not provide run()"
        for i in range(ROUTER_CHECKS):
            check(f"Router: contract {i + 1}/{ROUTER_CHECKS}", False, _why)
    check("Router: population matches ROUTER_CHECKS",
          len(results) - _before == ROUTER_CHECKS,
          f"{len(results) - _before} judgments / declared {ROUTER_CHECKS}")

    shutil.rmtree(tmp, ignore_errors=True)
    # Run a body-deleted copy and require measured failures; regex linting could
    # not prevent syntactic evasions. Setting minimum to 1 let three contracts
    # disappear. Update it only for legitimate contract changes. Per-file floors
    # prevent aggregate compensation and expose references contributing zero
    # checks. Zero is forbidden: declaring an unprotected reference must fail.

    # Forbid constant assertions with AST checks. Review 7 exposed expressions
    # like ... if cond else True that look plausible but never fail. Review 10
    # retained only needle-bearing lines and deleted 67-85% of content while
    # passing. The review-12 dev-layer fix was absent from nine work-layer skills.
    # Line survival (70%), volume, and blob binding detect this reduction.
    # Require the declared section headings in their declared order.
    _sections = split_sections(skill)
    _titles = [t for t in _sections]
    _want = [t for t, _ in SECTION_SKELETON]
    _gone = [t for t in _want if t not in _sections]
    check("Body skeleton: all declared section headings exist", not _gone, f"missing sections {_gone}")
    _order = [t for t in _titles if t in set(_want)]
    check("Body skeleton: section order matches the declaration", _order == _want,
          f"actual {_order}" if _order != _want else f"{len(_want)} sections")
    # Each section needs its minimum content; headings alone must not pass.
    _thin = []
    for _t, _toks in SECTION_SKELETON:
        _bodytxt = _sections.get(_t)
        if _bodytxt is None:
            continue  # Already caught by the check above.
        _miss = [k for k in _toks if k not in _bodytxt]
        if _miss:
            _thin.append(f"{_t.removeprefix('## ')}: {_miss}")
    check("Body skeleton: every section retains minimum content", not _thin, f"empty sections {_thin}")

    check_skill_body(check, ROOT, needles=[
        'npx --yes @officecli/officecli@latest',
        'ensure_officecli.sh',
        'Final output is `.hwpx`',
        'global\nchange',
        'An unresolved destination fails',
        # Lock directional requirements as whole sentences. Tokens cannot detect
        # negation: reversing the close instruction still passed 47/47. A reversal
        # must mismatch the protected sentence.
        'Always `close` (or `save`) before another program reads the file.',
        'Do not claim the backend is available when it is not.',
        'Do not run `officecli install`.',
        'Do not validate through `effective.font`',
        'Do not duplicate per-format element and property lists here.',
        'Do not call the output complete before a person opens it.',
        'Quote paths to prevent shell bracket expansion.',
    ], floor=3120)

    check_no_constant_assertions(check, __file__)

    # Measure once for three consumers. New judgments between them use excluded
    # prefixes, so the value is invariant. Separate expressions can drift and
    # introduce slack. Also exclude the script-contract prefix: that helper
    # returns early in deletion copies, so live-only counting would falsely
    # trigger disappearance guards.
    live_ran = sum(
        1 for r in results
        if not r[0].startswith(("자기검사:", "계약 커버리지:", "스크립트 계약:"))
    )

    check_contract_coverage(check, __file__, ROOT, per_file={
        "SKILL.md": 20,
    }, live_ran=live_ran)

    check_body_deletion(check, __file__, ROOT, minimum=20,
                        extra_strip=(),
                        live_ran=live_ran)


    # Lock the total count. Review 10 deleted a reference together with its
    # contracts, floors, and frozen copy, losing four checks without failure.

    # Measure scripts separately. Document-deletion checks do not protect script
    # behavior because those checks should survive empty documents. Review 12
    # replaced all three ensure outcomes with tautologies and passed.
    check_script_contracts(check, __file__, ROOT, scripts={
        "scripts/check_cjk_font.py": 8,
        "scripts/ensure_officecli.sh": 3,
        "tests/test_router.py": 10,
    }, live_ran=live_ran)
    check_total(check, results, 51)
    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n{passed}/{len(results)} 통과")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
