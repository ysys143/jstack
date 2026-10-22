#!/usr/bin/env python3
"""Proof regression suite.

Run python3 tests/run_tests.py from skills/proof.

The two functions have opposite properties: counting is local and deterministic;
spelling sends text to an external service and is forbidden by default for
procurement documents. Preserve this warning and the reversal of upstream's
exception framing into our default boundary. Also lock the NEIS profile used by
public-form byte limits: passing default counting can still fail submission.
"""
import json
import os
import re
import tempfile
import shutil
import subprocess
import sys

sys.dont_write_bytecode = True
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"

HERE = os.path.dirname(os.path.abspath(__file__))
# Shared skill helpers prevent frontmatter shadowing as a defect class.
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
from _suite_lib import (check_skill_body, check_no_constant_assertions, check_script_contracts, check_total, check_ref_contracts, split_frontmatter, check_body_deletion,
                        check_contract_coverage, in_deleted_run,
                        content_bytes)  # noqa: E402
ROOT = os.path.dirname(HERE)
SCRIPTS = os.path.join(ROOT, "scripts")
COUNT_PY = os.path.join(SCRIPTS, "korean_character_count.py")
COUNT_JS = os.path.join(SCRIPTS, "korean_character_count.js")
SPELL_PY = os.path.join(SCRIPTS, "korean_spell_check.py")

results = []

# Axes requiring Node. Print each skipped name with [SKIP] rather than hiding
# missing execution in a summary (the hwpx SKIPPED_AXES convention).
# [SKIP] does not match the failure or PASS/FAIL counting expressions,
# so it does not interfere with deletion-copy counts.
SKIPPED_AXES = (
    "자기검사: both implementations produce identical results (py ↔ node)",
)
# Track missing Node separately from contract failure (exit 1).
node_absent = False


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))


def read(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


def count(text, profile="default"):
    """Return counts using Python so this works without Node.

    Parse failures return None instead of erasing later checks. Emptying the
    JavaScript file previously caused exactly that false-success condition.
    """
    r = subprocess.run([sys.executable, COUNT_PY, "--text", text,
                        "--profile", profile, "--format", "json"],
                       capture_output=True, text=True)
    if r.returncode != 0:
        return None
    try:
        return json.loads(r.stdout)
    except json.JSONDecodeError:
        return None


def main():
    _skill_raw = read(os.path.join(ROOT, "SKILL.md"))
    skill_fm, skill = split_frontmatter(_skill_raw)
    spell_src = read(SPELL_PY)

    # (1) External-transmission warnings: the first contract of this skill.
    check("Warning: SKILL.md discloses external transmission",
          "nara-speller.co.kr" in skill and "sends input text" in skill)
    check("Warning: procurement transmission is forbidden by default",
          "Do not send procurement proposals" in skill)
    check("Warning: upstream exception becomes the default boundary here",
          "here they define the default boundary" in skill)
    check("Warning: obtain consent",
          "obtain consent" in skill)
    check("Warning: redact where possible",
          "Redact them where possible before sending" in skill)

    # Does the table contrast the two functions?
    check("Distinction: table contrasts local and external computation",
          "Local and deterministic" in skill and "Sends text to an external web service" in skill)

    # (2) Tool behavior: this is not an official API.
    check("Behavior: webpage imitation is disclosed",
          "not an official API" in skill)
    for label, needle in [("User-Agent imitation", "User-Agent"),
                          ("Origin header", "Origin"),
                          ("HTML regex parsing", "regular expressions")]:
        check(f"Behavior: evidence for {label}", needle in skill)
    # Compare documented behavior with the actual script.
    check("Behavior: script sets browser headers",
          "User-Agent" in spell_src and "Origin" in spell_src)
    check("Behavior: script parses HTML with regex",
          "re.compile" in spell_src and "urlopen" in spell_src)
    # Compare the documented numeric parameters with code.
    m_chars = re.search(r"DEFAULT_MAX_CHARS\s*=\s*(\d+)", spell_src)
    m_thr = re.search(r"DEFAULT_THROTTLE_SECONDS\s*=\s*([\d.]+)", spell_src)
    check("Behavior: documented chunk size matches code",
          bool(m_chars) and m_chars.group(1) in skill,
          m_chars.group(1) if m_chars else "missing")
    check("Behavior: documented throttle matches code",
          bool(m_thr) and m_thr.group(1) in skill,
          m_thr.group(1) if m_thr else "missing")

    # (2b) Executable guard: prose can disappear through compaction or direct calls.
    # Intercept urlopen to measure actual network attempts. Use a temporary
    # directory, never live tests/: interrupted probes would otherwise remain
    # and contaminate later coverage copies.
    probe_dir = tempfile.mkdtemp(prefix="proof-probe-")
    probe = os.path.join(probe_dir, "_probe_transmission.py")
    with open(probe, "w", encoding="utf-8") as f:
        f.write(
            "import sys, urllib.request\n"
            "calls=[]\n"
            "def spy(*a, **k):\n"
            "    calls.append(1); raise RuntimeError('NET')\n"
            "urllib.request.urlopen = spy\n"
            "sys.path.insert(0, sys.argv[1])\n"
            "import korean_spell_check as m\n"
            "try:\n"
            "    rc = m.main(sys.argv[2:])\n"
            "except Exception:\n"
            "    rc = 'EXC'\n"
            "print('EXIT', rc, 'CALLS', len(calls))\n")
    def run_probe(*extra):
        r = subprocess.run([sys.executable, probe, SCRIPTS, "--text", "가나다", *extra],
                           capture_output=True, text=True, stdin=subprocess.DEVNULL)
        return r.stdout.strip()

    out = run_probe()
    check("Guard: noninteractive calls without consent do not network",
          "CALLS 0" in out and "EXIT 2" in out, out)
    # Enforce the gate at transmission, not only main(). Review demonstrated
    # that direct check_text/fetch library calls bypass an entry-point-only gate.
    lib_probe = os.path.join(probe_dir, "_probe_lib.py")
    with open(lib_probe, "w", encoding="utf-8") as f:
        f.write(
            "import sys, urllib.request\n"
            "calls=[]\n"
            "def spy(*a, **k):\n"
            "    calls.append(1); raise RuntimeError('NET')\n"
            "urllib.request.urlopen = spy\n"
            "sys.path.insert(0, sys.argv[1])\n"
            "import korean_spell_check as m\n"
            "for fn in (lambda: m.check_text('대외비'),\n"
            "           lambda: m.fetch_spell_check_html('대외비')):\n"
            "    try: fn()\n"
            "    except Exception: pass\n"
            "print('CALLS', len(calls))\n")
    r = subprocess.run([sys.executable, lib_probe, SCRIPTS],
                       capture_output=True, text=True, stdin=subprocess.DEVNULL)
    check("Guard: direct library calls are blocked (check_text/fetch)",
          "CALLS 0" in r.stdout, r.stdout.strip() or r.stderr[-60:])

    out = run_probe("--consent-external-transmission")
    check("Guard: consent permits a transmission attempt",
          "CALLS 1" in out, out)
    shutil.rmtree(probe_dir, ignore_errors=True)

    src_main = spell_src
    check("Guard: notice reports destination and bytes before transmission",
          "External transmission notice" in src_main and "Payload" in src_main)
    check("Guard: SKILL.md documents the consent flag",
          "--consent-external-transmission" in skill)
    check("Guard: library opt-in API is documented",
          "allow_external_transmission()" in skill and "Otherwise raises ExternalTransmissionDenied" in skill)

    # (3) Local deterministic counting requires no Node. count() runs Python.
    # Previously an unguarded node --version call raised FileNotFoundError
    # and killed the suite: 51 of 71 checks never ran, yet the output showed
    # zero failures. This erased contracts in the environment Python exists
    # to support. Only the parity axis below needs Node; guard it with shutil.which.
    d = count("본 컨소시엄은 요구사항을 충족합니다.")
    check("Counting: default profile works", d is not None)
    # Do not wrap these checks in if d:. A broken counter must fail both checks,
    # not remove them. Failure-only script checks missed this disappearance:
    # emptying the counter reduced the measured population from 62 to 60.
    c = (d or {}).get("counts", d) or {}
    check("Counting: includes counts with and without whitespace",
          "characters" in c and "characters_without_whitespace" in c)
    check("Counting: identical input gives identical output",
          d is not None and count("본 컨소시엄은 요구사항을 충족합니다.") == d)

    # NEIS uses Hangul 3B and ASCII 1B, as required by public forms.
    n = count("가나다", "neis")
    u = count("가나다", "default")
    nb = (n.get("counts", n) or {}).get("bytes") if n else None
    ub = (u.get("counts", u) or {}).get("bytes") if u else None
    check("Counting: NEIS exists and uses Hangul 3B", nb == 9, f"neis={nb}")
    # Pure Hangul uses 3B in both profiles. Newlines distinguish them:
    # NEIS 2B versus UTF-8 1B. Use discriminating input to prove both axes.
    nl_n = count("가나\n다라", "neis")
    nl_u = count("가나\n다라", "default")
    nbn = (nl_n.get("counts", nl_n) or {}).get("bytes") if nl_n else None
    nbu = (nl_u.get("counts", nl_u) or {}).get("bytes") if nl_u else None
    check("Counting: newline distinguishes profiles (NEIS 2B)",
          nbn is not None and nbu is not None and nbn == nbu + 1,
          f"neis={nbn} / default={nbu}")
    a = count("abc", "neis")
    ab = (a.get("counts", a) or {}).get("bytes") if a else None
    check("Counting: NEIS ASCII 1B", ab == 3, f"ascii={ab}")

    # Does the documentation explain why NEIS is required?
    check("Counting: documents NEIS for public forms",
          "NEIS counting" in skill)
    check("Counting: warns default can exceed submission limits",
          "can still exceed the submission limit" in skill)

    # (4) Boundaries: route other tasks to the owning skill.
    check("Boundary: style routes to humanize",
          "| Style, AI-tell removal, translationese, excessive passive voice |" in skill)
    check("Boundary: layout routes to deck", "`deck` (layout)" in skill)
    check("Chain: humanize → proof → hwpx order and rationale",
          "humanize → proof → hwpx" in skill and "Rewriting changes length" in skill)

    # (4b) Self-contained execution without Node. Without Python the whole skill
    # fails in that environment, invalidating installation-only readiness.
    PY_COUNT = os.path.join(SCRIPTS, "korean_character_count.py")
    check("Self-contained: Python counter exists", os.path.exists(PY_COUNT))
    # Include all five line-break forms. The previous LF-only cases missed
    # CRLF disagreement (Python 4 characters/10B versus Node 3 characters/8B),
    # even though the reference CLI example used that very input.
    CASES = ["한글 abc", "", "가나다\n라마바", "안녕\U0001f468\u200d\U0001f469\u200d\U0001f467",
             "REQ-001 요구사항", "０１２ 전각", "ㄱㄴㄷ", "café", "혼합 mix 混合",
             "가\r\n나", "첫 줄\r\n둘째 줄\U0001f642", "가\r나",
             "가\u2028나", "가\u2029나", "\r\n", "가\r\n\r\n나"]
    py_ok = True
    for text in CASES:
        for prof in ("default", "neis"):
            r = subprocess.run([sys.executable, PY_COUNT, "--text", text,
                                "--profile", prof, "--format", "json"],
                               capture_output=True, text=True)
            if r.returncode != 0:
                py_ok = False
                break
    check(f"Self-contained: Python completes {len(CASES)} inputs across 2 profiles", py_ok)

    # Compare both implementations only when Node exists. Keep the established
    # self-check prefix so an unavailable parity axis does not distort counts.
    if shutil.which("node"):
        mismatch = []
        for text in CASES:
            for prof in ("default", "neis"):
                a = subprocess.run([sys.executable, PY_COUNT, "--text", text,
                                    "--profile", prof, "--format", "json"],
                                   capture_output=True, text=True)
                b = subprocess.run(["node", os.path.join(SCRIPTS, "korean_character_count.js"),
                                    "--text", text, "--profile", prof, "--format", "json"],
                                   capture_output=True, text=True)
                # Do not abort on an exception. Record unreadable output as a mismatch;
                # otherwise later checks disappear without being counted as failures.
                try:
                    ja = json.loads(a.stdout)["counts"]
                except (json.JSONDecodeError, KeyError, TypeError):
                    mismatch.append(f"{text[:8]!r}/{prof}(py unreadable)")
                    continue
                try:
                    jb = json.loads(b.stdout)["counts"]
                except (json.JSONDecodeError, KeyError, TypeError):
                    mismatch.append(f"{text[:8]!r}/{prof}(node unreadable)")
                    continue
                if ja != jb:
                    mismatch.append(f"{text[:8]!r}/{prof}")
        check("자기검사: both implementations produce identical results (py ↔ node)",
              not mismatch, f"mismatches {mismatch[:3]}")
    else:
        # Do not count absence as success. Name missing axes and record failure
        # to keep both populations equal and expose unmeasured Node behavior.
        global node_absent
        node_absent = True
        for _axis in SKIPPED_AXES:
            print(f"[SKIP] {_axis} — not run because Node is unavailable")
        check("자기검사: Node-dependent axes executed", False,
              f"Node unavailable: {len(SKIPPED_AXES)} axes unmeasured (all Python checks ran)")

    # The JavaScript implementation also carries contracts. Excluding it after
    # adding Python would let parity pass despite losing one implementation.
    JS = os.path.join(SCRIPTS, "korean_character_count.js")
    js_src = read(JS)
    check("Counter(js): NEIS rules are grapheme-based",
          "Hangul grapheme=3B" in js_src and "ASCII grapheme=1B" in js_src)
    check("Counter(js): documents UTF-8 fallback",
          "falls back to UTF-8 bytes" in js_src,
          "Without this clause, emoji ZWJ sequences can diverge from Python")
    check("Counter(js): emits both profiles (bytes_utf8 / bytes_neis)",
          "bytes_neis" in js_src and "bytes_utf8" in js_src)
    check("Counter(js): counts graphemes with Intl.Segmenter", "Intl.Segmenter" in js_src)

    # (5) Provenance and licensing.
    check("Provenance: MIT and original skill name are disclosed",
          "MIT" in skill and "korean-spell-check" in skill)
    # Preserve original text, substantive obligations, and nontrivial content.
    # Needles alone accepted references reduced from 4463B/3468B to 38B/39B
    # with all 42 checks passing in the review probe.
    check_ref_contracts(check, ROOT, [
        ("spell-check.md", "Transmission policy, service name, chunk size",
         ["license: MIT", "Bareun Hangul", "1500", "chunks"], 3212),
        ("character-count.md", "Counting method and NEIS byte rules",
         ["license: MIT", "Intl.Segmenter", "3B", "1B", "neis"], 2407),
    ], label_prefix="출처")

    # (5b) Measure reference contracts directly. Historically check_ref_contracts
    # returned from the entire function outside Git after the first contract,
    # instead of continuing (shared _suite_lib.py, outside this suite).
    # Deletion copies are always outside Git, so the second reference was
    # unmeasured: emptying character-count.md produced zero failures.
    # Read both files here and measure content plus volume symmetrically.
    ref_cc = read(os.path.join(ROOT, "references", "character-count.md"))
    ref_sp = read(os.path.join(ROOT, "references", "spell-check.md"))

    # Terms-of-use density: deleting all prose once passed. Lock each obligation
    # with a needle; the contract concerns permitted scope, not just availability.
    TERMS = ["noncommercial", "free access only for individuals or students", "robots.txt",
             "/test_speller/", "user-directed final review", "low-frequency requests",
             "bulk batches", "SaaS backend", "resale", "a paid API agreement"]
    _t_missing = [n for n in TERMS if n not in ref_sp]
    check("Reference contract: spell-check.md policy density (noncommercial/robots/no resale)",
          not _t_missing, f"missing {_t_missing}")
    check("Reference contract: spell-check.md explicitly prohibits disallowed uses",
          "Do not use it" in ref_sp and "provider permission" in ref_sp)

    # Counting parameters: deleting documented values removes the implementation target.
    CC_TERMS = ["empty string => `0`",
                "Count CRLF as one line break, not two",
                "Hangul grapheme => 3B", "ASCII grapheme => 1B",
                "line-break sequence => 2B",
                "Other characters fall back to UTF-8 byte length",
                "U+2028, and U+2029 each count as one line break",
                "Node 18+"]
    _c_missing = [n for n in CC_TERMS if n not in ref_cc]
    check("Reference contract: character-count.md values (empty=0/CRLF=1/Enter=2B/fallback)",
          not _c_missing, f"missing {_c_missing}")

    # Volume uses measured zero-slack floors. The previous 39% slack accepted
    # deletions of 1424B and 1064B from the two documents.
    for _fn, _body, _needles, _floor in (
            ("spell-check.md", ref_sp, TERMS, 3065),
            ("character-count.md", ref_cc, CC_TERMS, 2289)):
        _got = content_bytes(_body, _needles)
        check(f"Reference contract: {_fn} volume (>= {_floor}B, zero slack)",
              _got >= _floor, f"{_got}B")

    # (5c) Measure whether code produces documented values. Needles only protect
    # documents and cannot detect divergence: CRLF was documented as one break
    # but Python counted two, giving 4 characters/10B versus Node 3 characters/8B.
    # The suite stayed green because that input was absent from parity cases.
    def _c(text, profile="default"):
        r = count(text, profile)
        return (r or {}).get("counts", {})

    check("Measured contract: empty string has zero lines", _c("").get("lines") == 0,
          f"lines={_c('').get('lines')}")
    _crlf = _c("가\r\n나")
    check("Measured contract: CRLF is one break/grapheme (2 lines/3 characters)",
          _crlf.get("lines") == 2 and _crlf.get("characters") == 3,
          f"lines={_crlf.get('lines')} chars={_crlf.get('characters')}")
    _crlf_n = _c("가\r\n나", "neis")
    check("Measured contract: Enter/newline is NEIS 2B (3+2+3)",
          _crlf_n.get("bytes") == 8, f"neis={_crlf_n.get('bytes')}")
    _ls, _ps = _c("가\u2028나"), _c("가\u2029나")
    check("Measured contract: U+2028/U+2029 each count as one break",
          _ls.get("lines") == 2 and _ps.get("lines") == 2,
          f"LS={_ls.get('lines')} PS={_ps.get('lines')}")
    _ls_n, _ps_n = _c("가\u2028나", "neis"), _c("가\u2029나", "neis")
    check("Measured contract: U+2028/U+2029 each use NEIS 2B",
          _ls_n.get("bytes") == 8 and _ps_n.get("bytes") == 8,
          f"LS={_ls_n.get('bytes')} PS={_ps_n.get('bytes')}")
    # Fallback preserves UTF-8 length per grapheme. This emoji ZWJ sequence
    # is one grapheme containing five code points and 18 UTF-8 bytes.
    _fam = "\U0001f468\u200d\U0001f469\u200d\U0001f467"
    _fam_n = _c(_fam, "neis")
    check("Measured contract: NEIS falls back to UTF-8 for other characters",
          _fam_n.get("characters") == 1
          and _fam_n.get("bytes") == len(_fam.encode("utf-8")),
          f"chars={_fam_n.get('characters')} neis={_fam_n.get('bytes')} "
          f"utf8={len(_fam.encode('utf-8'))}")

    # (5d) Single source for line-break forms. Previously three separate lists
    # coexisted with an unused constant; changing one silently caused drift.
    # Require one literal list and actual use of the constant by the counter.
    py_src = read(PY_COUNT)
    _lb_literals = re.findall(r'\(\s*"\\r\\n"\s*,\s*"\\n"\s*,\s*"\\r"', py_src)
    check("Counter(py): line breaks have one source (LINE_BREAKS)",
          len(_lb_literals) == 1
          and py_src.count("LINE_BREAKS") >= 2
          and "for br in LINE_BREAKS" in py_src,
          f"literals={len(_lb_literals)} / references={py_src.count('LINE_BREAKS')}")
    check("Counter(py): constant contains all five break forms",
          all(x in py_src.split("def line_break_at")[0]
              for x in ['"\\r\\n"', '"\\n"', '"\\r"', '"\\u2028"', '"\\u2029"']))

    # (5e) Lock the minimum Node version numerically. JavaScript raised an error,
    # but deleting its requirement or changing 18 previously passed the suite.
    _min = re.search(r"Node\.js (\d+) or newer", js_src)
    check("Counter(js): requires a numeric minimum Node version",
          bool(_min) and "Intl.Segmenter is required" in js_src,
          _min.group(1) if _min else "missing")
    check("Counter(js): version matches reference requirement",
          bool(_min) and f"Node {_min.group(1)}+" in ref_cc,
          f"js={_min.group(1) if _min else 'missing'}")

    # Run the suite on a body-deleted copy and require failures. Regex linting
    # could not prevent syntactic evasions. minimum is measured: setting it
    # to 1 allowed 18 contracts to disappear. Update it only for legitimate
    # contract changes. Use measured per-file floors: an aggregate permits
    # one file to offset another and hides references contributing zero checks.
    # Zero is forbidden; declaring an unprotected reference must fail.

    # Forbid constant assertions. Review 7 exposed ... if cond else True: it
    # looks plausible yet cannot fail. Inspect the AST. Needles alone accepted
    # mechanical reduction to needle-bearing lines, deleting 67-85% of content
    # in review 10. The defect fixed in the dev layer during review 12 remained in
    # nine work-layer skills. Line survival (70%), volume, and blob binding detect it.
    check_skill_body(check, ROOT, needles=[
        'korean_character_count.py',
        'Character counting',
        'Spelling check',
        'procurement',
    ], floor=4003)

    check_no_constant_assertions(check, __file__)

    # No provenance axes are exempt from disappearance guards. Two were once
    # excluded because the shared helper returned after its first contract
    # outside Git, dropping the second reference in deletion copies.
    # _suite_lib.py now continues, so those axes survive. Remove the obsolete
    # exemption; retaining it would introduce unearned slack.
    _live_ran = sum(1 for r in results
                    if not r[0].startswith(("자기검사:", "계약 커버리지:")))

    check_contract_coverage(check, __file__, ROOT, per_file={
        "SKILL.md": 28,
        "references/character-count.md": 6,
        "references/spell-check.md": 6,
    }, live_ran=_live_ran)

    check_body_deletion(check, __file__, ROOT, minimum=40,
                        extra_strip=["references/spell-check.md", "references/character-count.md"],
                        live_ran=_live_ran)


    # Lock the total count. Review 10 deleted a reference together with its
    # contracts, floors, and frozen copy, losing four checks without failure.

    # Measure scripts separately: document-deletion regressions cannot protect
    # script behavior because those checks should survive empty documents.
    # Review 12 replaced all three ensure outcomes with tautologies and passed.
    # Enable disappearance guards: counting failures alone missed the observed
    # 62-to-60 population drop after emptying a script. Use the same _live_ran
    # as coverage/body deletion: all preceding non-self-check judgments. Only
    # check_total follows, so the copy population matches. Exclude the established
    # script-contract prefix on both sides because in_deleted_run() returns
    # from this helper before producing those judgments in deletion copies.
    check_script_contracts(check, __file__, ROOT, scripts={
        "scripts/korean_character_count.js": 7,
        "scripts/korean_character_count.py": 15,
        "scripts/korean_spell_check.py": 7,
    }, live_ran=_live_ran, extra_skip=("스크립트 계약:",))

    # Validate SKIPPED_AXES on every run. A handwritten list can drift silently.
    # The hwpx guard caught 31 mismatches among 95 names after refreezing renamed
    # checks. Without this guard, proof drift would appear only without Node.
    # Run one child with a restricted PATH, collect live names missing there,
    # and require equality with SKIPPED_AXES. Skip this probe in deletion copies
    # to avoid recursive child execution.
    if not in_deleted_run() and not node_absent:
        _fb = subprocess.run(
            [sys.executable, os.path.abspath(__file__)],
            capture_output=True, text=True, cwd=os.getcwd(),
            env=dict(os.environ, PATH="/usr/bin:/bin"),
        )
        _fb_names = re.findall(r"(?m)^\[(?:PASS|FAIL)\] (.+)$", _fb.stdout)

        def _ran_in_fb(n):
            # Names can contain the detail separator themselves; do not split them.
            return any(ln == n or ln.startswith(n + " — ") for ln in _fb_names)

        _gone = [n for n, _, _ in results if not _ran_in_fb(n)]
        _only_declared = [n for n in SKIPPED_AXES if n not in _gone]
        _only_measured = [n for n in _gone if n not in SKIPPED_AXES]
        check(
            "자기검사: [SKIP] list names every missing judgment",
            not _only_declared and not _only_measured,
            f"fallback rc={_fb.returncode}, missing judgments={len(_gone)}; "
            f"declared only={_only_declared[:2]}; measured only={_only_measured[:2]}",
        )

    check_total(check, results, 80)
    passed = sum(1 for _, ok, _ in results if ok)
    if node_absent:
        print(f"\n{passed}/{len(results)} 통과, {len(SKIPPED_AXES)} judgments skipped "
              "— Node unavailable (suite verdict: failure)")
        # Deletion copies must not return 2. _suite_lib accepts only 0 or 1 for
        # copy completion; missing Node is not an abnormal termination of a copy.
        return 1 if in_deleted_run() else 2
    print(f"\n{passed}/{len(results)} 통과")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
