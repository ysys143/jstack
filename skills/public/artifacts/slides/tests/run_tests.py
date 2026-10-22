#!/usr/bin/env python3
"""Deck regressions for marp, Korean typesetting, and executable scripts.

Run python3 tests/run_tests.py from skills/deck.

The plan requires four marp reference contracts, editable-output routing back
to office, and ensure_marp.sh exit states 0/1/2. Korean typesetting is an original
addition without an upstream counterpart and is especially vulnerable to resync
(§10.10). Execute both scripts as well: document checks alone stay green when
scripts break.

Run two child tests and inspect their actual results: test_style_fonts.py guards
Korean font mappings; test_slop_axes.py checks two cause tags and two axes.
The latter intentionally remained red while C-43 was undecided, with its decision
status in the verdict name. DECISIONS-hardening.md D-1 selected two tags, and the
matching document made the check pass.
"""

import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"

HERE = os.path.dirname(os.path.abspath(__file__))
# Shared suite helpers prevent the frontmatter-shadow defect class.
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
from _suite_lib import (  # noqa: E402
    check_skill_body,
    check_no_constant_assertions,
    check_script_contracts,
    check_total,
    check_ref_contracts,
    split_frontmatter,
    check_body_deletion,
    check_contract_coverage,
)  # noqa: E402

ROOT = os.path.dirname(HERE)
REFS = os.path.join(ROOT, "references")
SCRIPTS = os.path.join(ROOT, "scripts")
ENSURE = os.path.join(SCRIPTS, "ensure_marp.sh")
ASSEMBLE = os.path.join(SCRIPTS, "assemble.py")
PDF2PPTX = os.path.join(SCRIPTS, "pdf2pptx.py")
REQS = os.path.join(ROOT, "requirements.txt")
STYLE_FONTS = os.path.join(HERE, "test_style_fonts.py")
SLOP_AXES = os.path.join(HERE, "test_slop_axes.py")

results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def run_py(argv, env=None):
    """Execute a child script and return (rc, stdout + stderr).

    Exit-code contracts require execution, not source inspection.
    """
    e = dict(os.environ, PYTHONDONTWRITEBYTECODE="1")
    if env:
        e.update(env)
    r = subprocess.run([sys.executable] + argv, capture_output=True, text=True, env=e)
    return r.returncode, (r.stdout or "") + (r.stderr or "")


def run_ensure(script, env=None, cwd=None):
    e = {"PATH": "/opt/homebrew/bin:/usr/bin:/bin", "HOME": os.path.expanduser("~")}
    if env:
        e.update(env)
    r = subprocess.run(["/bin/bash", script], capture_output=True, text=True, env=e, cwd=cwd)
    return r.returncode, r.stdout


def main():
    # (1) Inspect discriminating content for each of four marp contracts.
    #     Heading-only checks passed empty sections in version 5.
    marp_md = read(os.path.join(REFS, "marp.md"))
    for label, needles in [
        (
            "1 hard browser dependency",
            ["for PDF, PPTX, and image", "HTML works without a browser"],
        ),
        ("2 non-editable PPTX", ["[EXPERIMENTAL]", "embeds each slide as an image"]),
        (
            "3 allow-local-files",
            ["(NOT SECURE)", "Do not enable it for Markdown of unknown origin"],
        ),
        ("4 missing CJK stack", ["covers\nLatin", "browser-selected fonts"]),
    ]:
        missing = [n for n in needles if n not in marp_md]
        check(f"marp contract {label}", not missing, f"missing {missing}" if missing else "")

    # Require measured evidence in marp.md: original help excerpts.
    check(
        "marp contract: original help excerpts are present",
        "--pptx-editable" in marp_md and "--browser" in marp_md,
    )

    # Inspect the CJK declaration structure, not scattered font-name mentions.
    # Scattered names allowed deletion of one declaration to escape existence checks.
    def cjk_stack(text):
        # Parse the actual contract CSS, not the earlier default-theme example
        # or prose between fences. Punctuation in a translation must not change
        # which font declaration this check measures.
        blocks = re.findall(r"(?ms)^```css\s*\n(.*?)^```", text)
        m = re.search(r"section\s*\{[^}]*?font-family:\s*([^;}]+)", "\n".join(blocks))
        if not m:
            return []
        return [f.strip().strip("\"'") for f in m.group(1).split(",")]

    stack = cjk_stack(marp_md)
    korean = [
        f
        for f in stack
        if re.search(r"Pretendard|Noto Sans KR|Apple SD Gothic|Malgun|Nanum", f, re.I)
    ]
    check(
        "marp contract: CJK fonts occur inside the stack declaration", len(korean) >= 2, f"{korean}"
    )
    check(
        "marp contract: the stack ends with sans-serif fallback",
        bool(stack) and "sans-serif" in stack[-1],
    )

    # (2) Backend routing back to the owning skill.
    _skill_raw = read(os.path.join(ROOT, "SKILL.md"))
    skill_fm, skill = split_frontmatter(_skill_raw)
    # Inspect table rows; the same phrase in another section must not satisfy routing.
    rows = re.findall(r"(?m)^\|\s*\*\*(Yes|No)\*\*[^|]*\|([^|]*)\|", skill)
    routing = {ans: dest for ans, dest in rows}
    check(
        "Backend routing: No routes to marp",
        "marp" in routing.get("No", ""),
        str(routing.get("No", "no row"))[:60],
    )
    check(
        "Backend routing: Yes returns to office",
        "office" in routing.get("Yes", ""),
        str(routing.get("Yes", "no row"))[:60],
    )
    check(
        "Backend routing: marp is the default",
        re.search(r"marp.*default|default.*marp", skill) is not None,
    )
    check(
        "Backend routing: ask the user when ambiguous", "Ask when it is ambiguous" in skill
    )

    # (3) ensure_marp.sh three-state contract.
    check("ensure_marp.sh exists", os.path.exists(ENSURE))
    # Control all availability states without installing optional user tools.
    tmp = tempfile.mkdtemp()
    nb = os.path.join(tmp, "ensure_nb.sh")
    with open(nb, "w", encoding="utf-8") as f:
        f.write(read(ENSURE).replace("/Applications", "/NO_SUCH_APPS"))
    tools = os.path.join(tmp, "bin")
    os.mkdir(tools)
    os.symlink(shutil.which("head"), os.path.join(tools, "head"))
    marp, browser = (os.path.join(tools, name) for name in ("marp", "google-chrome"))
    stub = "#!/bin/sh\nprintf '%s\\n' 'marp-fixture 0.0.0'\n"
    def tool(path):
        with open(path, "w", encoding="utf-8") as f:
            f.write(stub)
        os.chmod(path, 0o755)
    tool(marp)
    tool(browser)
    fixture_env = {"PATH": tools, "HOME": tmp}
    rc_full, out = run_ensure(nb, env=fixture_env)
    check("ensure: marp and browser exit 0", rc_full == 0 and "all formats" in out, f"exit={rc_full}")
    os.unlink(marp)
    rc_none, _ = run_ensure(nb, env=fixture_env)
    check("ensure: missing marp exits 2", rc_none == 2, f"exit={rc_none}")
    tool(marp)
    os.unlink(browser)
    rc_html, out_html = run_ensure(nb, env=fixture_env)
    check("ensure: missing browser exits 1 (HTML only)", rc_html == 1 and "HTML" in out_html, f"exit={rc_html}")
    shutil.rmtree(tmp, ignore_errors=True)

    # (4) Original Korean typesetting contract, vulnerable to upstream resync.
    styles = read(os.path.join(REFS, "styles.md"))
    for label, needle in [
        ("CJK font stack", "Pretendard"),
        ("Word-unit line breaks", "keep-all"),
        ("Minimum body size", "14pt"),
        ("Korean tracking differs from Latin", "tracking"),
        ("Per-style Korean mapping", "D2Coding"),
    ]:
        check(f"Korean typesetting contract: {label}", needle in styles)

    # (5) Preserve 30 -> 3 reduction; restoring more styles restores selection cost.
    heads = re.findall(r"(?m)^### ([A-Z])\. ", styles)
    check("Three styles are retained", len(heads) == 3, f"{heads}")
    check(
        "The reduction rationale is documented",
        "neither orthogonal" in styles and "monochrome print" in styles,
    )

    # (6) Attribution required by MIT.
    notice = read(os.path.join(ROOT, "NOTICE"))
    check(
        "NOTICE: complete MIT terms are preserved",
        "MIT License" in notice and "WITHOUT WARRANTY" in notice,
    )
    check("NOTICE: original author is identified", "corazzon" in notice)
    check(
        "NOTICE: observed absence of an upstream LICENSE file is recorded",
        "has no LICENSE file" in notice or "has no LICENSE file" in notice,
    )

    # (7) Measure script behavior through execution, not source declarations.
    have_pptx = importlib.util.find_spec("pptx") is not None
    tmp2 = tempfile.mkdtemp()
    md = os.path.join(tmp2, "mini.md")
    with open(md, "w", encoding="utf-8") as f:
        f.write(
            "# 사업 개요\n\n- 요구사항 대응표를 먼저 만든다\n\n"
            "---\n\n# 추진 체계\n\n책임자 1인과 실무 3인.\n"
        )
    out_pptx = os.path.join(tmp2, "out.pptx")
    rc, txt = run_py([ASSEMBLE, md, "-o", out_pptx])
    if have_pptx:
        ok = rc == 0 and os.path.exists(out_pptx)
        detail = f"rc={rc} output={os.path.exists(out_pptx)}"
    else:
        # Without python-pptx, measure exit 2 at the same point instead of skipping.
        # Skipping would make this axis disappear in that environment.
        ok = rc == 2 and "requirements.txt" in txt
        detail = f"missing-dependency route rc={rc}"
    check("assemble.py: create PPTX from small Markdown (exit 2 if dependencies are missing)", ok, detail)

    # Independently force missing dependencies with an import-blocking copy path.
    block_dir = os.path.join(tmp2, "block")
    os.makedirs(block_dir, exist_ok=True)
    with open(os.path.join(block_dir, "pptx.py"), "w", encoding="utf-8") as f:
        f.write('raise ImportError("blocked for contract test")\n')
    rc, txt = run_py(
        [ASSEMBLE, md, "-o", os.path.join(tmp2, "x.pptx")],
        env={"PYTHONPATH": block_dir},
    )
    check(
        "assemble.py: missing dependencies exit 2 with installation guidance",
        rc == 2 and "requirements.txt" in txt and "python-pptx" in txt,
        f"rc={rc}",
    )

    # Compare the line-height contract (1.2~1.35) between documents and code.
    # A document-only check would miss code using web line-height defaults.
    m = re.search(r"(\d\.\d+)\s*~\s*(\d\.\d+)", styles)
    src_asm = read(ASSEMBLE)
    m2 = re.search(r"(?m)^LINE_SPACING\s*=\s*([\d.]+)", src_asm)
    lo, hi = (float(m.group(1)), float(m.group(2))) if m else (0.0, 0.0)
    val = float(m2.group(1)) if m2 else -1.0
    check(
        "Line-height contract: assemble.py stays within the styles.md range",
        bool(m) and bool(m2) and lo <= val <= hi,
        f"document {lo}~{hi} / code {val}",
    )

    rc, txt = run_py([PDF2PPTX])
    check("pdf2pptx.py: missing arguments exit nonzero", rc != 0, f"rc={rc}")
    rc, txt = run_py([PDF2PPTX, "--help"])
    check(
        "pdf2pptx.py: help exits 0 and lists flags",
        rc == 0 and "--skip-upscale" in txt,
        f"rc={rc}",
    )

    # Do not duplicate the image generator and create two sources for model IDs.
    src_pdf = read(PDF2PPTX)
    check(
        "pdf2pptx.py: does not define call_gemini locally",
        "def call_gemini" not in src_pdf and "call_gemini" in src_pdf,
    )
    check(
        "pdf2pptx.py: loads the image skill's nanobanana.py by path",
        "nanobanana.py" in src_pdf and '"image"' in src_pdf,
    )
    check(
        "pdf2pptx.py: does not duplicate model IDs",
        "generativelanguage.googleapis.com" not in src_pdf,
    )
    shutil.rmtree(tmp2, ignore_errors=True)

    # (8) requirements.txt combines two legacy lists.
    reqs = [ln.split("#", 1)[0].strip() for ln in read(REQS).splitlines()]
    pkgs = sorted({r for r in reqs if r})
    check("requirements.txt: contains at least two packages", len(pkgs) >= 2, f"{pkgs}")
    # Include every distribution actually required by scripts; a missing entry
    # would leave users seeing exit 2 even after installation.
    # Read only DEPS; scanning every key/value pair also misclassifies state strings
    # such as status/extracted as distribution names.
    needed = set()
    for src in (src_asm, src_pdf):
        blk = re.search(r"(?ms)^DEPS\s*=\s*\{(.*?)^\}", src)
        if blk:
            needed |= {
                v for _k, v in re.findall(r'"(\w+)":\s*"([a-z0-9-]+)"', blk.group(1))
            }
    absent = sorted(n for n in needed if n not in pkgs)
    check(
        "requirements.txt: includes every required distribution",
        bool(needed) and not absent,
        f"missing {absent}" if absent else f"{sorted(needed)}",
    )

    # Require SKILL.md to reference scripts/dependencies, avoiding orphan files.
    orphan = [
        n
        for n in ("scripts/assemble.py", "scripts/pdf2pptx.py", "requirements.txt")
        if n not in skill
    ]
    check(
        "SKILL.md references scripts and requirements",
        not orphan,
        f"orphans {orphan}" if orphan else "",
    )

    # (8b) Require an operational path, not only a reference-table citation.
    # design-slop.md had 17 contracts but no phase instructed opening it;
    # removing the whole reference table caused no failures in reachability probes.
    refs_head, refs_sep, refs_tail = skill.partition("## References")
    check(
        "Operational path: instructions open design-slop.md before the reference table",
        "references/design-slop.md" in refs_head
        and "`input`" in refs_head
        and "`no-verify`" in refs_head,
        "no invocation instruction inside a phase"
        if "references/design-slop.md" not in refs_head
        else "",
    )

    # Derive all supporting-file rows from the filesystem so new files cannot
    # silently escape. ensure_marp.sh once had only one body invocation; changing
    # it triggered neither the orphan guard nor the incomplete reference table.
    ref_table = refs_tail.split("\n## ", 1)[0]
    listed = ["NOTICE", "requirements.txt"]
    listed += [f"references/{n}" for n in sorted(os.listdir(REFS)) if n.endswith(".md")]
    listed += [
        f"scripts/{n}"
        for n in sorted(os.listdir(SCRIPTS))
        if not n.startswith((".", "_"))
    ]
    unlisted = [n for n in listed if n not in ref_table]
    check(
        "The reference table lists all supporting files",
        bool(refs_sep) and bool(listed) and not unlisted,
        f"not listed {unlisted}" if unlisted else f"{len(listed)} files",
    )

    # Listing a name is not an executable invocation. Replacing ensure_marp.sh's
    # sole Phase 1 call escaped all axes (reachability R1). Use filesystem-derived
    # script membership so new scripts cannot escape a handwritten list.
    own_skill = os.path.basename(os.path.abspath(ROOT))
    runnable = set(
        re.findall(
            r"\$\{(?:JSTACK|CLAUDE)_PLUGIN_ROOT\}/skills/" + re.escape(own_skill) + r"/(scripts/[\w.-]+)",
            skill,
        )
    )
    uncalled = [
        f"scripts/{n}"
        for n in sorted(os.listdir(SCRIPTS))
        if not n.startswith((".", "_")) and f"scripts/{n}" not in runnable
    ]
    check(
        "Execution instructions invoke every script through a body path",
        not uncalled,
        f"no invocation {uncalled}" if uncalled else f"{len(runnable)} calls",
    )

    # (8c) Execute script contracts. String matching missed swapped script roles,
    # reversed argument contracts, and swapped exit codes 0/2 (R3-R6).
    # Inspect actual exit codes and stdout separately.
    helps = {}
    for fn_, path_ in (("assemble.py", ASSEMBLE), ("pdf2pptx.py", PDF2PPTX)):
        rc_h, txt_h = run_py([path_, "--help"])
        helps[fn_] = txt_h if rc_h == 0 else ""
        check(f"{fn_}: help exits 0", rc_h == 0, f"rc={rc_h}")

    # Discriminating tokens must appear only in their owning script's help.
    # Swapping both script bodies must fail both checks here.
    for fn_, mark in (("assemble.py", "slide_plan.json"), ("pdf2pptx.py", "--skip-upscale")):
        other = "".join(v for k, v in helps.items() if k != fn_)
        check(
            f"{fn_}: discriminating token `{mark}` occurs only in its own help",
            mark in helps.get(fn_, "") and mark not in other,
        )

    # Phase 6 rows must match actual roles; swapping them fails both checks.
    role_rows = dict(re.findall(r"(?m)^\|\s*`scripts/(\w+\.py)`\s*\|([^|]*)\|", skill))
    check(
        "Phase 6: assemble.py maps manuscript/JSON to PPTX",
        "slide_plan.json" in role_rows.get("assemble.py", "")
        and "PDF" not in role_rows.get("assemble.py", ""),
        role_rows.get("assemble.py", "no row").strip()[:60],
    )
    check(
        "Phase 6: pdf2pptx.py maps PDF to PPTX",
        "PDF" in role_rows.get("pdf2pptx.py", "")
        and "slide_plan.json" not in role_rows.get("pdf2pptx.py", ""),
        role_rows.get("pdf2pptx.py", "no row").strip()[:60],
    )

    tmp3 = tempfile.mkdtemp()
    md3 = os.path.join(tmp3, "a.md")
    with open(md3, "w", encoding="utf-8") as f:
        f.write("# 사업 개요\n\n- 요구사항 대응표\n")

    # Compare argument declarations with execution; either alone would miss
    # changed declarations or changed accepted argument formats.
    rc_opt, txt_opt = run_py([ASSEMBLE, "--input", md3])
    check(
        "Argument contract: positional-input documentation matches execution",
        "Input is a **positional argument**" in skill
        and "not an option such as `--input`" in skill
        and rc_opt != 0
        and "unrecognized arguments" in txt_opt,
        f"rc={rc_opt}",
    )

    # Compare documented and observed meanings of exit codes 0/1/2.
    rc_a1, _ = run_py([ASSEMBLE, os.path.join(tmp3, "missing.md")])
    rc_p1, _ = run_py([PDF2PPTX, os.path.join(tmp3, "missing.pdf")])
    check("assemble.py: missing input exits 1", rc_a1 == 1, f"rc={rc_a1}")
    check("pdf2pptx.py: missing input exits 1", rc_p1 == 1, f"rc={rc_p1}")

    block3 = os.path.join(tmp3, "block")
    os.makedirs(block3, exist_ok=True)
    with open(os.path.join(block3, "fitz.py"), "w", encoding="utf-8") as f:
        f.write('raise ImportError("blocked for contract test")\n')
    dummy_pdf = os.path.join(tmp3, "x.pdf")
    open(dummy_pdf, "w").close()
    rc_dep, txt_dep = run_py([PDF2PPTX, dummy_pdf], env={"PYTHONPATH": block3})
    check(
        "pdf2pptx.py: missing dependencies exit 2 with installation guidance",
        rc_dep == 2 and "requirements.txt" in txt_dep,
        f"rc={rc_dep}",
    )

    m_dep = re.search(r"exit (\d) and installation guidance", skill)
    m_in = re.search(r"Exit (\d) is an input error", skill)
    check(
        "Exit-code contract: dependency/input documentation matches execution",
        bool(m_dep)
        and bool(m_in)
        and int(m_dep.group(1)) == rc_dep
        and int(m_in.group(1)) == rc_a1,
        f"document {m_dep and m_dep.group(1)}/{m_in and m_in.group(1)} / observed {rc_dep}/{rc_a1}",
    )

    # Compare ensure's documented exit list with observations too. Previously
    # runtime-only checks missed documentation swapping codes 0 and 2.
    ensure_decl = dict(re.findall(r"(?m)^- exit (\d) — (.+)$", skill))
    check(
        "ensure three-state contract: documented codes match execution",
        "all available" in ensure_decl.get("0", "")
        and rc_html == 1
        and "HTML only" in ensure_decl.get("1", "")
        and rc_none == 2
        and "marp is unavailable" in ensure_decl.get("2", ""),
        f"document {sorted(ensure_decl)} / observed missing={rc_none} browser-missing={rc_html}",
    )

    # Check that every consumed JSON key is documented and that documented JSON
    # actually assembles; otherwise the entire input format can lack documentation.
    plan_src = re.search(r"(?s)\ndef parse_plan\(.*?\n\ndef ", src_asm)
    plan_keys = sorted(
        set(re.findall(r'(?:s|plan)\.get\("(\w+)"', plan_src.group(0)))
    ) if plan_src else []
    schema_doc = (
        skill.partition("### `slide_plan.json` schema")[2]
        .split("\n### ", 1)[0]
        .split("\n## ", 1)[0]
    )
    undoc = [k for k in plan_keys if f"`{k}`" not in schema_doc]
    check(
        "slide_plan.json: every consumed key is in the SKILL.md schema table",
        bool(plan_keys) and not undoc,
        f"undocumented keys {undoc}" if undoc else f"{plan_keys}",
    )
    plan_path = os.path.join(tmp3, "plan.json")
    with open(plan_path, "w", encoding="utf-8") as f:
        json.dump(
            {
                "slides": [
                    {
                        "slide_num": 1,
                        "title": "사업 개요",
                        "key_points": ["요구사항 대응표를 먼저 만든다"],
                        "image_path": "",
                        "speaker_notes": "발표 노트",
                    }
                ]
            },
            f,
        )
    plan_out = os.path.join(tmp3, "plan.pptx")
    rc_j, txt_j = run_py([ASSEMBLE, plan_path, "-o", plan_out])
    if have_pptx:
        ok_j, det_j = (rc_j == 0 and os.path.exists(plan_out)), f"rc={rc_j}"
    else:
        ok_j, det_j = (
            rc_j == 2 and "requirements.txt" in txt_j,
            f"missing-dependency route rc={rc_j}",
        )
    check("assemble.py: documented slide_plan.json schema assembles", ok_j, det_j)
    shutil.rmtree(tmp3, ignore_errors=True)

    # (9) Execute both child tests.
    rc, txt = run_py([STYLE_FONTS])
    check(
        "test_style_fonts.py passes (Korean font loss guard)",
        rc == 0,
        txt.strip().splitlines()[-1] if txt.strip() else f"rc={rc}",
    )

    # Measure whether the document implements D-1: two tags and impact/cost axes.
    rc, txt = run_py([SLOP_AXES])
    check(
        "[C-43] test_slop_axes.py passes (two tags and two axes)",
        rc == 0,
        txt.strip().splitlines()[-1] if txt.strip() else f"rc={rc}",
    )

    # Run the suite after body deletion; failure establishes actual binding.
    # Regex linting could not block expression-form bypasses. minimum and per-file
    # floors are measured: a floor of one allowed three dead contracts to pass.
    # Update legitimate contract changes visibly. Aggregate totals can offset a
    # dead A with added B and hide zero-contribution files. Zero floors are forbidden.
    # AST scanning also rejects constant verdicts such as an else True fallback
    # (review 7). Needles alone let marp.md shrink from 4,590 to 347 bytes and pass
    # 34/34; whole-file deletion floors cannot detect a needle-only shell either.
    slop = read(os.path.join(REFS, "design-slop.md"))
    # Require the original-work notice; losing it implies an upstream import
    # and could claim license inheritance without an imported source.
    check("slop: declares original authorship", "**Original work.**" in slop)
    check(
        "slop: explains upstream exclusion for its invented license tag",
        "public-observed" in slop,
    )
    check(
        "slop: forbids claiming an unavailable import",
        "cannot claim to have imported\nunavailable material" in slop,
    )
    check(
        "slop: identifies an evaluation checklist rather than an AI detector",
        "not an AI detector" in slop and "potential evaluation deductions" in slop,
    )
    # Read the definition table rather than hardcoding four recognized tag names.
    # A hardcoded regex kept len(set)==4 after a fifth definition was added.
    tags = re.findall(r"(?m)^\| `([a-z][a-z0-9-]*)` \|", slop)
    check(
        "slop: uses the two canonical cause tags (C-43)",
        sorted(set(tags)) == ["input", "no-verify"],
        f"{sorted(set(tags))}",
    )
    # Keep the four-to-two mapping visible for readers of old ledgers, answer
    # keys, and sibling skills, or the updated vocabulary looks contradictory.
    check(
        "slop: retains the C-43 four-to-two migration record",
        all(f"`{t}`" in slop for t in ("median", "underspec", "no-constraint"))
        and "C-43 merged them into `input`" in slop,
    )
    items = re.findall(r"(?m)^\| (\d+) \|", slop)
    check("slop: has at least twenty items", len(items) >= 20, f"{len(items)} items")
    check(
        "slop: numbering is consecutive",
        [int(i) for i in items] == list(range(1, len(items) + 1)),
        f"{items}",
    )
    check("slop: includes procurement reversals", "Reversals in procurement" in slop)
    check(
        "slop: rejects forced exhaustive findings and fixes aggregated causes",
        "Do not force a finding for every item" in slop and "fixing the\ncause" in slop,
    )
    check("slop: accepts no applicable findings", "No findings is a valid result" in slop)
    check("slop: explains the cost of invented findings", "ignore the checklist" in slop)
    check(
        "slop: SKILL.md declares original work rather than an upstream crosswalk",
        "is original work" in skill and "not a crosswalk" in skill,
    )

    check_ref_contracts(
        check,
        ROOT,
        [
            (
                "marp.md",
                "Browser dependency, non-editable PPTX, local-file warning, CJK fonts",
                ["--pptx-editable", "--browser", "--allow-local-files", "font-family"],
                3148,
            ),
            (
                "design-slop.md",
                "21 deduction items, two cause tags, impact/cost axes, procurement reversals, original-work notice",
                [
                    "**Original work.**",
                    "not an AI detector",
                    "`input`",
                    "`no-verify`",
                    "Two axes — deduction x cost",
                    "Reversals in procurement",
                    "No findings is a valid result",
                ],
                4517,
            ),
            (
                "styles.md",
                "Three substantive axes and concrete values for three styles",
                [
                    "Background brightness",
                    "Title typeface",
                    "Decoration density",
                    "Swiss",
                    "#FFFFFF",
                    "monochrome print",
                ],
                3993,
            ),
        ],
    )

    # Bind evaluation section counts and tag vocabulary to the actual document.
    ev = os.path.join(
        os.path.dirname(os.path.dirname(ROOT)),
        "evals",
        "discriminating",
        "deck-design-slop",
        "graders",
        "criteria.md",
    )
    check("eval: discriminating-case criteria exist", os.path.isfile(ev))
    if os.path.isfile(ev):
        crit = read(ev)
        real = {}
        for m in re.finditer(r"(?m)^### (.+)$", slop):
            body = slop[m.end() :].split("\n### ", 1)[0].split("\n## ", 1)[0]
            real[m.group(1).strip()] = len(re.findall(r"(?m)^\| \d+ \|", body))
        declared = {
            k.strip(): int(v)
            for k, v in re.findall(r"(?m)^\| ([^|]+?) \| (\d+) \|\s*$", crit)
        }
        check(
            "eval: criteria section counts match the actual document",
            declared == real,
            f"criteria {declared} / actual {real}",
        )
        # Do not hardcode grading tags: that would accept invented tags and miss
        # the document's transition to two values. Require every criterion tag to
        # exist in the document vocabulary. Pre-C-43 tags remain in its migration
        # history, while invented values fail. Moving criteria themselves to two
        # canonical tags is tree-owned because root eval/command suites also own
        # contracts on the same file.
        crit_tags = sorted(set(re.findall(r"`([a-z][a-z0-9-]*)`", crit)))
        unknown = [t for t in crit_tags if f"`{t}`" not in slop]
        check(
            "eval: every criterion tag is in design-slop.md vocabulary",
            bool(crit_tags) and not unknown,
            f"unknown document tags {unknown}" if unknown else f"{crit_tags}",
        )

    # Needle-only shells passed after deleting 67~85% of body content.
    # Line survival, volume, and blob binding catch that loss.
    check_skill_body(
        check,
        ROOT,
        needles=[
            "until a person opens it",
            "disappear in monochrome print",
            "For procurement, the default is Swiss",
            "Korean font contract",
        ],
        floor=3265,
    )

    check_no_constant_assertions(check, __file__)

    # Exclude script-contract names as well: their checks return early in
    # deletion copies. Although this count precedes that call today, all three
    # consumers must share exclusions or mismatches create unearned slack.
    live_ran = sum(
        1
        for r in results
        if not r[0].startswith(("자기검사:", "계약 커버리지:", "스크립트 계약:"))
    )

    check_contract_coverage(
        check,
        __file__,
        ROOT,
        # Measured floors. Earlier declarations (NOTICE 4, SKILL 10, slop 15,
        # marp 11, styles 13) had never been measured: check_ref_contracts' return
        # bug caused false survival alarms and skipped every floor verdict.
        # These values were remeasured after fixing that bug.
        per_file={
            "NOTICE": 3,
            "SKILL.md": 23,
            "references/design-slop.md": 17,
            "references/marp.md": 10,
            "references/styles.md": 12,
        },
        live_ran=live_ran,
    )

    check_body_deletion(
        check,
        __file__,
        ROOT,
        minimum=48,
        extra_strip=["references/marp.md", "references/styles.md", "NOTICE"],
        live_ran=live_ran,
    )

    # Pin totals: deleting a reference with its contracts/floor/frozen copy
    # silently removed four checks in review 10.
    # Measure script contracts separately: document deletion does not affect
    # legitimate script behavior checks. Review 12 tautologized all three ensure
    # state contracts while staying green. Floors exclude the historical pending
    # C-43 constant failure that inflated all three script measurements by one;
    # otherwise resolving C-43 would break all three floors without code changes.
    check_script_contracts(
        check,
        __file__,
        ROOT,
        scripts={
            "scripts/ensure_marp.sh": 4,
            "scripts/assemble.py": 9,
            "scripts/pdf2pptx.py": 8,
        },
        live_ran=live_ran,
    )
    check_total(check, results, 100)
    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n{passed}/{len(results)} 통과")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
