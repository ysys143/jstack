#!/usr/bin/env python3
"""delegate contract suite.

Run: python3 tests/run_tests.py   (from skills/delegate)

## What this locks

1. **The calling moment, not the payload, decides the skill** — a request that
   keeps the artefact and asks for a verdict is `consult`; a request that
   hands the artefact over to be finished is `delegate`. Both the prose and the
   sandbox table that makes the write literal are locked.
2. **The bridge never installs, and never hardcodes a path** — the script's
   probe reports three states, prints an install command only for the one
   state that means "absent", and the SKILL.md invokes it through
   `${JSTACK_PLUGIN_ROOT}`, not a search under `~/.claude/plugins` (the
   predecessor's mistake, adapted away deliberately).
3. **The script itself is exercised, not just described** — every probe state
   and the full exec path (args, stdin, sandbox default, ANSI-stripped
   output, timeout/empty/error handling) are run against stub binaries, never
   against a real `codex`, so breaking the script actually turns these red.
"""
import os
import re
import shutil
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
from _suite_lib import (  # noqa: E402
    check_no_constant_assertions, check_total, check_skill_body,
    split_frontmatter, check_body_deletion, content_bytes,
    check_contract_coverage, check_script_contracts,
)

# Literal invocation phrases used by description. A count alone stays green after
# replacement with any ten strings, even though the skill can no longer be invoked.
TRIGGERS = [
    "codex한테 맡겨", "codex로 해결", "ask codex", "codex fix", "codex debug",
    "codex refactor", "codex한테 시켜줘", "코드 수정 위임", "실행 위임",
    "delegate to codex",
]
ROOT = os.path.dirname(HERE)
SKILLS = os.path.dirname(ROOT)
SCRIPT = os.path.join(ROOT, "scripts", "codex-bridge.sh")

results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))


def read(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


def rows(text, head):
    """Return table rows below `## head`, or an empty list if the section is absent."""
    if head not in text:
        return []
    body = text.split(head, 1)[1].split("\n## ", 1)[0]
    return [r for r in re.findall(r"(?m)^\| (?!---)(.+?) \|", body)
            if r.strip() not in ("You are asking for", "Sandbox", "State",
                                 "Parameter")]


def declared_sandbox_defaults(skill_text):
    """Extract every place where SKILL.md declares the sandbox default.

    It appears in four places: the sandbox table, prose, parameter table, and call
    example. Extract them separately because updating only one is also a defect.
    """
    sites = [
        ("sandbox table", r"(?m)^\| `([a-z][a-z-]+)` \(default\) \|"),
        ("prose", r"Default to `([a-z][a-z-]+)`"),
        ("parameter table", r"\| `--sandbox` \| No \| `([a-z][a-z-]+)` \(default\)"),
        ("call example", r"\[--sandbox \"([a-z][a-z-]+)\"\]"),
    ]
    out = []
    for label, pat in sites:
        m = re.search(pat, skill_text)
        if m:
            out.append((label, m.group(1)))
    return out


def script_sandbox_default(src):
    """Return the `${SANDBOX:-...}` default used by the script, or None."""
    m = re.search(r"\$\{SANDBOX:-([a-z][a-z-]+)\}", src)
    return m.group(1) if m else None


def table_cells(text, head):
    """Return each data row below `## head` as a list of cells.

    `rows()` counted rows from the first cell only, so swapping whole rows or
    reversing one cell's meaning left the count unchanged and stayed green.
    """
    if head not in text:
        return []
    body = text.split(head, 1)[1].split("\n## ", 1)[0]
    out = []
    for line in body.splitlines():
        line = line.strip()
        if not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if all(set(c) <= set("-: ") for c in cells):   # separator
            continue
        out.append(cells)
    return out[1:]   # first row is the header


def mkstub(dirpath, name, body):
    """Create an executable stub so tests never invoke the real Codex."""
    p = os.path.join(dirpath, name)
    with open(p, "w", encoding="utf-8") as f:
        f.write(body)
    os.chmod(p, 0o755)
    return p


def run(args, *, path, home, extra_env=None, timeout=10, cwd=None):
    """Run codex-bridge.sh in an isolated environment.

    Pin `HOME` to an empty temporary directory. Otherwise sourcing nvm can restore
    the development machine's PATH and invoke its real Codex binary. Every check
    uses stubs only. Rebuild `env` so host credentials such as OPENAI_API_KEY and
    apikey.env cannot leak into the test.
    """
    env = {"HOME": home, "PATH": path, "TMPDIR": tempfile.gettempdir()}
    if extra_env:
        env.update(extra_env)
    r = subprocess.run(["bash", SCRIPT, *args], capture_output=True, text=True,
                       env=env, timeout=timeout, cwd=cwd)
    return r.returncode, r.stdout, r.stderr


def run_probe(*, path, home, extra_env=None):
    """Extract `_codex_probe` and measure its return value directly.

    The script body folds probe values 1 and 2 into `exit 1`, so process exit status
    cannot prove that the three-state contract survives. Replacing absent (2) and
    unauthenticated (1) with the same constant would pass. Running the extracted
    function is the only way to measure this axis.
    """
    src = read(SCRIPT)
    m = re.search(r"(?ms)^_codex_probe\(\) \{.*?^\}", src)
    if m is None:
        return None, "", "cannot find _codex_probe definition in script"
    env = {"HOME": home, "PATH": path, "TMPDIR": tempfile.gettempdir()}
    if extra_env:
        env.update(extra_env)
    r = subprocess.run(["bash", "-c", m.group(0) + "\n_codex_probe\n"],
                       capture_output=True, text=True, env=env, timeout=10)
    return r.returncode, r.stdout, r.stderr


SAFE_PATH = "/usr/bin:/bin"  # Codex cannot be on this path; negative control for the absent state


def main():
    fm, skill = split_frontmatter(read(os.path.join(ROOT, "SKILL.md")))
    script_src = read(SCRIPT)

    # (1) The calling moment distinguishes the skill
    check('Invocation: description says both execution and not a second opinion',
          "actually executes and writes code" in fm and "not a second opinion" in fm)
    ct = rows(skill, "## The calling moment decides which skill")
    check('Invocation: comparison table has three rows', len(ct) == 3, f"{len(ct)} rows")
    ct_map = {c[1]: c[0] for c in table_cells(
        skill, "## The calling moment decides which skill") if len(c) == 2}
    check('Comparison table: each row maps to its correct skill',
          "possibly one that disagrees" in ct_map.get("`consult`", "")
          and "files edited, under a sandbox and workdir you name"
              in ct_map.get("`delegate`", "")
          and "probing and calling an external tool" in ct_map.get("`bridge`", ""),
          f"{sorted(ct_map)}")
    check('Invocation: defines keeping the artifact while seeking a verdict',
          "keeps the artefact in\nyour hands and asks for a verdict" in skill)
    check('Invocation: defines handing off the artifact',
          "gives the artefact away" in skill)
    check('Invocation: says the consult prism does not apply to delegate',
          "does not review, does not average" in skill
          and "so it does not apply" in skill)

    # (2) What delegation actually does: one shot and sandbox
    check('Execution: says Codex resolves ambiguity because there is no follow-up turn',
          "Codex fills the gap itself rather than asking" in skill)
    sb = rows(skill, "## What actually happens when you delegate")
    check('Sandbox: table has three rows', len(sb) == 3, f"{len(sb)} rows")
    sb_map = {c[0]: c[1] for c in table_cells(
        skill, "## What actually happens when you delegate") if len(c) == 2}
    check('Sandbox table: each value maps to its allowed scope',
          "cannot write" in sb_map.get("`read-only` (default)", "")
          and sb_map.get("`workspace-write`") == "Write inside `--workdir`"
          and sb_map.get("`danger-full-access`") == "Write anywhere the process can reach",
          f"{sorted(sb_map)}")
    check('Sandbox: pins the default to read-only',
          "Default to `read-only`" in skill)
    check('Sandbox: describes the concrete risk of excessive elevation',
          "outside the one directory" in skill)

    # Document-script parity: compare all four documented defaults with the script
    # `${SANDBOX:-...}` value. Changing either side alone must fail. Before this axis,
    # the document said read-only four times while the script used workspace-write,
    # and both opposite claims independently passed.
    decl = declared_sandbox_defaults(skill)
    decl_values = {v for _, v in decl}
    check('Document-script parity: all four documented sandbox defaults agree',
          len(decl) == 4 and len(decl_values) == 1, f"{decl}")
    script_default = script_sandbox_default(script_src)
    check('Document-script parity: script SANDBOX default matches the documented value',
          script_default is not None and decl_values == {script_default},
          f"script {script_default} / document {sorted(decl_values)}")

    # (3) Execution: no hardcoding and complete table
    check('Call site: gives the exact path through CLAUDE_PLUGIN_ROOT',
          '${JSTACK_PLUGIN_ROOT}/skills/delegate/scripts/codex-bridge.sh' in skill)
    check('Call site: says no discovery step is needed',
          "No search step is needed" in skill)
    check('Call site: forbids hardcoding ~/.claude/plugins',
          "Do not hardcode a\npath under `~/.claude/plugins`" in skill)
    check('Call site: identifies hardcoding as the mistake the script rules out',
          "it is the one\nmistake this script is built to rule out" in skill)
    m_doc_to = re.search(r"Seconds before the process is killed \(default (\d+)", skill)
    m_scr_to = re.search(r"(?m)^TIMEOUT=(\d+)$", script_src)
    check('Document-script parity: timeout defaults match in document and script',
          m_doc_to is not None and m_scr_to is not None
          and m_doc_to.group(1) == m_scr_to.group(1),
          f"document {m_doc_to and m_doc_to.group(1)} / script "
          f"{m_scr_to and m_scr_to.group(1)}")

    pt = rows(skill, "## Running it")
    check('Parameter table: has six rows for prompt, sandbox, workdir, model, files, and timeout',
          len(pt) == 6, f"{len(pt)} rows")
    pt_cells = [c for c in table_cells(skill, "## Running it") if len(c) == 3]
    req = {c[0]: c[1] for c in pt_cells}
    desc = {c[0]: c[2] for c in pt_cells}
    check('Parameter table: only --prompt is required',
          req.get("`--prompt`") == "Yes"
          and [req.get(k) for k in ("`--sandbox`", "`--workdir`", "`--model`",
                                    "`--files`", "`--timeout`")] == ["No"] * 5,
          f"{req}")
    check('Parameter table: each row has its key cells in place',
          "no follow-up turn" in desc.get("`--prompt`", "")
          and desc.get("`--sandbox`") == ("`read-only` (default), `workspace-write`, "
                                          "`danger-full-access`")
          and "defaults to the caller's `pwd`" in desc.get("`--workdir`", "")
          and "Model override" in desc.get("`--model`", "")
          and "Comma-separated paths inlined into the prompt" in desc.get("`--files`", "")
          and "default 300" in desc.get("`--timeout`", ""),
          f"{sorted(desc)}")

    # (4) Three-state availability
    check('Availability: says it follows the bridge three-state contract',
          "following the convention `bridge` defines" in skill)
    av = rows(skill, "## Availability — three states, no installs")
    check('Availability table: has three rows', len(av) == 3, f"{av and len(av)} rows")
    av_cells = [c for c in table_cells(
        skill, "## Availability — three states, no installs") if len(c) == 3]
    av_mean = {c[0]: c[1] for c in av_cells}
    av_act = {c[0]: c[2] for c in av_cells}
    check('Availability table: each state means a distinct condition',
          "credentials are present" in av_mean.get("0 — full", "")
          and "no `OPENAI_API_KEY` and no `~/.codex/auth.json`"
              in av_mean.get("1 — partial", "")
          and "does not resolve on `PATH`" in av_mean.get("2 — blocked", ""),
          f"{sorted(av_mean)}")
    check('Availability table: action differs by state and only state 2 shows installation',
          av_act.get("0 — full") == "Says nothing, proceeds"
          and "without authentication" in av_act.get("1 — partial", "")
          and "install" not in av_act.get("1 — partial", "")
          and "Prints the exact install command" in av_act.get("2 — blocked", ""),
          f"{sorted(av_act)}")
    check('Availability: distinguishes state 1 unauthenticated from state 2 absent',
          "no `OPENAI_API_KEY` and no `~/.codex/auth.json`" in skill
          and "does not resolve on `PATH`" in skill)
    check('Availability: explains why the two states must not share a message',
          "sends them to fix the wrong\nthing" in skill)
    check('Availability: says installation appears only for state 2',
          "Only state 2 prints an install command" in skill)

    # (5) Boundary
    check('Boundary: says consult does not touch files',
          "it never\ntouches a file" in skill)
    check('Boundary: says bridge owns the general contract and delegate implements it',
          "implements for one" in skill or "implements for one\nspecific tool" in skill)
    check('Boundary: distinguishes codex-rescue diagnosis and retry from delegate',
          "diagnoses why a Codex run went wrong" in skill
          and "does not diagnose or\nretry" in skill)
    named = set(re.findall(r"`([a-z][a-z-]{2,})`\s*skill", skill))
    missing_skills = [n for n in named if not os.path.isdir(os.path.join(SKILLS, n))]
    check('Boundary: handoff population is nonempty', len(named) >= 2, f"{sorted(named)}")
    check('Boundary: every handoff target exists', not missing_skills, f"absent {missing_skills}")

    # (6) Language and L0
    check('Language: description has Korean triggers',
          len(re.findall(r"[가-힣]+", fm)) >= 5)
    check('Language: description has English triggers',
          '"ask codex"' in fm and '"delegate to codex"' in fm)
    missing_tr = [t for t in TRIGGERS if f'"{t}"' not in fm]
    check('Frontmatter: all ten trigger phrases survive literally',
          not missing_tr, f"missing {missing_tr}")
    fm_bytes = content_bytes(fm, TRIGGERS)
    check('Frontmatter: size is at least 417 bytes excluding trigger phrases',
          fm_bytes >= 417, f"{fm_bytes}B")
    check('L0: description includes the codex-rescue boundary phrase',
          "codex:codex-rescue" in fm
          and "when specifying the working directory, sandbox, and model" in fm)
    check('L0: description includes the invocation flag set',
          "`--sandbox`/`--workdir`/`--model`" in fm)

    # (7) The script never installs; the bridge contract only prints installation.
    check('Installation: the script never installs anything',
          not re.search(r"(?m)^\s*(brew|apt|npm|pip3?|uv|cargo)\s+install", script_src))
    check('Installation: script contains the absent-state installation command',
          "npm install -g @openai/codex" in script_src)

    # ---- Invoke each mktemp template twice ------------------------------------
    # Checking only for `XXXXXXXX` misses BSD mktemp's rule that Xs must end the
    # name. `codex-out-XXXXXXXX.txt` becomes a literal filename on macOS, so one
    # leftover breaks later calls and concurrent runs overwrite each other.
    tpls = re.findall(r'mktemp "([^"]+)"', script_src)
    tdir = tempfile.mkdtemp()
    bad_tpl = []
    try:
        for t in tpls:
            r = subprocess.run(
                ["bash", "-c",
                 f'a=$(mktemp "{t}") && b=$(mktemp "{t}") && printf "%s\n%s\n" "$a" "$b"'],
                capture_output=True, text=True,
                env={"TMPDIR": tdir, "PATH": SAFE_PATH, "HOME": tdir}, timeout=10)
            names = r.stdout.split()
            if (r.returncode != 0 or len(names) != 2 or names[0] == names[1]
                    or "XXXX" in names[0]):
                bad_tpl.append((t, r.returncode, names, r.stderr.strip()[:60]))
    finally:
        shutil.rmtree(tdir, ignore_errors=True)
    check('mktemp: has two templates for output and error', len(tpls) == 2, f"{tpls}")
    check('mktemp: repeated use of each template yields distinct real names',
          len(tpls) == 2 and not bad_tpl, f"{bad_tpl}")
    # Install the trap **before** mktemp so failure between two calls leaves no file.
    _trap_at = script_src.find("trap 'rm -f")
    _mktemp_at = script_src.find('mktemp "')
    check('mktemp: trap is installed before the first mktemp',
          _trap_at != -1 and _mktemp_at != -1 and _trap_at < _mktemp_at,
          f"trap@{_trap_at} mktemp@{_mktemp_at}")

    # ---- Exercise all three states with stubs; never invoke real Codex ------------
    with tempfile.TemporaryDirectory() as home, tempfile.TemporaryDirectory() as stubdir:
        # State 2: absent. PATH is guaranteed to contain no Codex.
        rc, out, err = run(["--prompt", "x"], path=SAFE_PATH, home=home)
        check('Runtime: absent Codex returns rc 1', rc == 1, f"rc={rc}")
        check('Runtime: absent state prints the full installation command',
              "npm install -g @openai/codex" in err, err.strip()[:80])
        check('Runtime: absent state says not found, distinct from unauthenticated',
              "was not found" in err, err.strip()[:80])

        # State 1: present but unauthenticated. Provide a stub, no API key or auth.json.
        mkstub(stubdir, "codex", "#!/usr/bin/env bash\necho should-not-run\nexit 0\n")
        rc, out, err = run(["--prompt", "x"],
                           path=f"{stubdir}:{SAFE_PATH}", home=home)
        check('Runtime: present but unauthenticated returns rc 1', rc == 1, f"rc={rc}")
        check('Runtime: unauthenticated state prints authentication guidance, not install',
              "unauthenticated" in err and "npm install" not in err,
              err.strip()[:80])
        check('Runtime: unauthenticated stub is never executed because probe blocks first',
              "should-not-run" not in out)

        # Alternate state-1 path: auth.json also passes; the probe does not require an API key.
        home2 = tempfile.mkdtemp()
        try:
            os.makedirs(os.path.join(home2, ".codex"))
            with open(os.path.join(home2, ".codex", "auth.json"), "w") as f:
                f.write("{}")
            mkstub(stubdir, "codex",
                  "#!/usr/bin/env bash\ncat >/dev/null\necho ok\nexit 0\n")
            rc, out, err = run(["--prompt", "x"],
                              path=f"{stubdir}:{SAFE_PATH}", home=home2)
            check('Runtime: auth.json alone counts as authenticated and passes probe',
                  "unauthenticated" not in err, err.strip()[:80])
        finally:
            shutil.rmtree(home2, ignore_errors=True)

        # S4: **Are all three states distinct?** The script folds 1 and 2 into `exit 1`,
        # so process status cannot distinguish them. Measure the function return values.
        mkstub(stubdir, "codex", "#!/usr/bin/env bash\nexit 0\n")
        prc_absent, _, perr_absent = run_probe(path=SAFE_PATH, home=home)
        prc_partial, _, _ = run_probe(path=f"{stubdir}:{SAFE_PATH}", home=home)
        prc_full, _, _ = run_probe(path=f"{stubdir}:{SAFE_PATH}", home=home,
                                   extra_env={"OPENAI_API_KEY": "sk-test"})
        check('Runtime: probe returns 2 for absent, distinct from unauthenticated 1',
              prc_absent == 2, f"rc={prc_absent}")
        check('Runtime: probe returns 1 for present but unauthenticated',
              prc_partial == 1, f"rc={prc_partial}")
        check('Runtime: probe returns 0 for a healthy state',
              prc_full == 0, f"rc={prc_full}")
        check('Runtime: healthy probe state is silent',
              run_probe(path=f"{stubdir}:{SAFE_PATH}", home=home,
                        extra_env={"OPENAI_API_KEY": "sk-test"})[2] == "",
              "stderr must be empty in the healthy state")

        # C6: **Never install.** Put recording stubs on PATH and require zero calls in
        # the absent state, the only place installation is tempting. Source checks
        # can be bypassed with eval or variable assembly; this axis counts execution.
        idir = tempfile.mkdtemp()
        try:
            ilog = os.path.join(idir, "install-calls.txt")
            for tool in ("npm", "brew", "pip3", "apt-get", "cargo"):
                mkstub(idir, tool,
                       f'#!/usr/bin/env bash\nprintf "{tool} %s\\n" "$*" >> {ilog}\n'
                       'exit 0\n')
            rc, out, err = run(["--prompt", "x"], path=f"{idir}:{SAFE_PATH}", home=home)
            called = (open(ilog, encoding="utf-8").read()
                      if os.path.exists(ilog) else "")
            check('Runtime: absent state never executes an installation tool',
                  called == "", repr(called[:120]))
            check('Runtime: installation command is printed only, never executed',
                  rc == 1 and "npm install -g @openai/codex" in err,
                  f"rc={rc} {err.strip()[:80]}")
        finally:
            shutil.rmtree(idir, ignore_errors=True)

        # State 0: an API key passes the probe. Calling without --prompt must then fail at
        # the next contract, required-argument parsing.
        rc, out, err = run([], path=f"{stubdir}:{SAFE_PATH}", home=home,
                           extra_env={"OPENAI_API_KEY": "sk-test"})
        check('Runtime: authenticated execution passes probe and reaches argument validation',
              rc == 1 and "--prompt is required" in err, f"rc={rc} {err.strip()[:60]}")

        # ---- Full execution path: sandbox default, stdin, model flag, output cleanup ----
        # Capture argv and stdin separately. Combining them cannot tell which carried the
        # prompt, so changing the script to argv would leave an stdin claim green.
        capture = os.path.join(home, "capture.txt")
        capture_in = os.path.join(home, "capture-stdin.txt")
        mkstub(stubdir, "codex", f"""#!/usr/bin/env bash
printf '%s\\n' "$@" > {capture}
cat > {capture_in}
printf '\\033[31mHELLO\\033[0m  \\n'
""")
        rc, out, err = run(["--prompt", "Fix the bug", "--workdir", "/tmp"],
                           path=f"{stubdir}:{SAFE_PATH}", home=home,
                           extra_env={"OPENAI_API_KEY": "sk-test"})
        check('Runtime: successful execution returns rc 0', rc == 0, f"rc={rc} {err.strip()[:80]}")
        check('Runtime: strips ANSI escape sequences', "\x1b[" not in out and "HELLO" in out,
              repr(out))
        check('Runtime: trims leading and trailing whitespace from each line', out.strip() == "HELLO", repr(out))

        def read_capture():
            # Missing means an empty string. An emptied script never invokes the stub, so the
            # capture file does not exist. Raising would turn this into a suite crash
            # and hide failure counts; empty content lets assertions fail normally.
            if not os.path.exists(capture):
                return ""
            with open(capture, encoding="utf-8") as f:
                return f.read()

        def read_stdin():
            # Treat absence as empty for the same reason as read_capture.
            if not os.path.exists(capture_in):
                return ""
            with open(capture_in, encoding="utf-8") as f:
                return f.read()

        cap = read_capture()
        cap_args = cap.splitlines()
        cap_pairs = list(zip(cap_args, cap_args[1:]))
        check('Runtime: omitted --sandbox passes read-only by default',
              ("-s", "read-only") in cap_pairs, cap_args[:10])
        check('Runtime: omitted --sandbox never elevates to a writable sandbox',
              "workspace-write" not in cap and "danger-full-access" not in cap,
              cap[:120])
        check('Runtime: always adds --skip-git-repo-check',
              "--skip-git-repo-check" in cap, cap[:160])
        check('Runtime: passes workdir through -C', "/tmp" in cap, cap[:160])
        cap_in = read_stdin()
        check('Runtime: passes prompt through stdin',
              "Fix the bug" in cap_in, cap_in[-160:])
        check('Runtime: prompt is absent from argv to avoid quoting problems',
              "Fix the bug" not in cap, cap[:160])
        check('Runtime: passes stdin marker as the prompt argument',
              cap_args[-1:] == ["-"], cap_args[-3:])

        # --model is passed through -m; captured arguments are newline-separated.
        for _c in (capture, capture_in):
            if os.path.exists(_c):
                os.remove(_c)
        rc, out, err = run(["--prompt", "x", "--model", "o3", "--sandbox", "read-only"],
                           path=f"{stubdir}:{SAFE_PATH}", home=home,
                           extra_env={"OPENAI_API_KEY": "sk-test"})
        cap_lines = read_capture().splitlines()
        pairs = list(zip(cap_lines, cap_lines[1:]))
        check('Runtime: passes --model through -m', ("-m", "o3") in pairs, cap_lines[:10])
        check('Runtime: passes --sandbox override through -s',
              ("-s", "read-only") in pairs, cap_lines[:10])

        # --files inlines file content into the prompt.
        for _c in (capture, capture_in):
            if os.path.exists(_c):
                os.remove(_c)
        ref = os.path.join(home, "ref.py")
        with open(ref, "w", encoding="utf-8") as f:
            f.write("def broken(): pass\n")
        rc, out, err = run(["--prompt", "review", "--files", ref],
                           path=f"{stubdir}:{SAFE_PATH}", home=home,
                           extra_env={"OPENAI_API_KEY": "sk-test"})
        cap_in = read_stdin()
        check('Runtime: inlines --files content into the prompt',
              "def broken(): pass" in cap_in and "FILE:" in cap_in, cap_in[-200:])

        # S3/C5: missing files must emit a warning. Silent skipping makes callers believe
        # the referenced file was included.
        for _c in (capture, capture_in):
            if os.path.exists(_c):
                os.remove(_c)
        ghost = os.path.join(home, "no-such-file.py")
        rc, out, err = run(["--prompt", "review", "--files", f"{ref},{ghost}"],
                           path=f"{stubdir}:{SAFE_PATH}", home=home,
                           extra_env={"OPENAI_API_KEY": "sk-test"})
        check('Runtime: missing --files path warns and names that path',
              "WARNING: File not found" in err and ghost in err, err.strip()[:120])
        check('Runtime: existing files are still inlined when another path is missing',
              rc == 0 and "def broken(): pass" in read_stdin(), f"rc={rc}")

        # S1/S2: timeout default matches the document and rc 124 takes its dedicated path.
        for _c in (capture, capture_in):
            if os.path.exists(_c):
                os.remove(_c)
        mkstub(stubdir, "codex", "#!/usr/bin/env bash\ncat >/dev/null\nexit 124\n")
        rc, out, err = run(["--prompt", "x", "--timeout", "7"],
                           path=f"{stubdir}:{SAFE_PATH}", home=home,
                           extra_env={"OPENAI_API_KEY": "sk-test"})
        check('Runtime: rc 124 becomes rc 1 with a timeout message',
              rc == 1 and "timed out after 7s" in err, f"rc={rc} {err.strip()[:80]}")
        check('Runtime: timeout is not reported as exit code 124',
              "exited with code 124" not in err, err.strip()[:80])

        # S7: `_timeout` actually wraps with timeout/gtimeout. A PATH stub records the
        # call; deleting the wrapper leaves no trace and fails.
        for wrapper in ("timeout", "gtimeout"):
            wdir = tempfile.mkdtemp()
            try:
                trace = os.path.join(wdir, "wrap.txt")
                mkstub(wdir, wrapper,
                       f'#!/usr/bin/env bash\nprintf "%s\\n" "$@" > {trace}\n'
                       'shift\nexec "$@"\n')
                mkstub(wdir, "codex",
                       "#!/usr/bin/env bash\ncat >/dev/null\necho ok\n")
                rc, out, err = run(["--prompt", "x"],
                                   path=f"{wdir}:{SAFE_PATH}", home=home,
                                   extra_env={"OPENAI_API_KEY": "sk-test"})
                tr = (open(trace, encoding="utf-8").read().splitlines()
                      if os.path.exists(trace) else [])
                check(f"Runtime: uses {wrapper} wrapper when available",
                      tr[:2] == ["300s", "codex"], f"rc={rc} {tr[:4]}")
            finally:
                shutil.rmtree(wdir, ignore_errors=True)

        # S6/C8: without --workdir, the caller's pwd is passed through -C.
        for _c in (capture, capture_in):
            if os.path.exists(_c):
                os.remove(_c)
        mkstub(stubdir, "codex", f"""#!/usr/bin/env bash
printf '%s\\n' "$@" > {capture}
cat > {capture_in}
echo ok
""")
        cwd_dir = tempfile.mkdtemp()
        try:
            rc, out, err = run(["--prompt", "x"], path=f"{stubdir}:{SAFE_PATH}",
                               home=home, cwd=cwd_dir,
                               extra_env={"OPENAI_API_KEY": "sk-test"})
            wl = read_capture().splitlines()
            wp = list(zip(wl, wl[1:]))
            passed_dir = next((b for a, b in wp if a == "-C"), None)
            check('Runtime: omitted --workdir passes caller pwd through -C',
                  passed_dir in (cwd_dir, os.path.realpath(cwd_dir)),
                  f"{passed_dir} / pwd {cwd_dir}")
        finally:
            shutil.rmtree(cwd_dir, ignore_errors=True)

        # An abnormal Codex exit forwards the error and returns rc 1.
        mkstub(stubdir, "codex",
              "#!/usr/bin/env bash\ncat >/dev/null\necho boom >&2\nexit 3\n")
        rc, out, err = run(["--prompt", "x"], path=f"{stubdir}:{SAFE_PATH}", home=home,
                           extra_env={"OPENAI_API_KEY": "sk-test"})
        check('Runtime: abnormal Codex exit returns rc 1 and reports its code',
              rc == 1 and "exited with code 3" in err, err.strip()[:100])
        check('Runtime: forwards Codex stderr unchanged', "boom" in err, err.strip()[:100])

        # Empty output is a failure; silence must not be read as success.
        mkstub(stubdir, "codex", "#!/usr/bin/env bash\ncat >/dev/null\nexit 0\n")
        rc, out, err = run(["--prompt", "x"], path=f"{stubdir}:{SAFE_PATH}", home=home,
                           extra_env={"OPENAI_API_KEY": "sk-test"})
        check('Runtime: empty output returns rc 1 and reports it',
              rc == 1 and "empty output" in err, err.strip()[:80])

        # Do not silently swallow unknown flags.
        mkstub(stubdir, "codex", "#!/usr/bin/env bash\necho should-not-run\n")
        rc, out, err = run(["--prompt", "x", "--bogus", "y"],
                           path=f"{stubdir}:{SAFE_PATH}", home=home,
                           extra_env={"OPENAI_API_KEY": "sk-test"})
        check('Runtime: unknown flag returns rc 1 and names the flag',
              rc == 1 and "Unknown option: --bogus" in err, err.strip()[:80])

    check_skill_body(check, ROOT, needles=[
        "keeps the artefact in\nyour hands and asks for a verdict",
        "gives the artefact away",
        "does not review, does not average",
        "a reduced path that does not\nsay it is reduced",
        "does not diagnose or\nretry",
    ], floor=4594)

    check_contract_coverage(check, __file__, ROOT, per_file={
        "SKILL.md": 39, "scripts/codex-bridge.sh": 37,
    }, live_ran=sum(1 for r in results
                    if not r[0].startswith(("자기검사:", "계약 커버리지:", "스크립트 계약:"))))
    check_body_deletion(check, __file__, ROOT, minimum=39,
                        live_ran=sum(1 for r in results
                                     if not r[0].startswith(("자기검사:", "계약 커버리지:",
                                                             "스크립트 계약:"))))
    check_script_contracts(check, __file__, ROOT,
                           scripts={"scripts/codex-bridge.sh": 37},
                           live_ran=sum(1 for r in results
                                        if not r[0].startswith(("자기검사:", "계약 커버리지:",
                                                                "스크립트 계약:"))))
    check_no_constant_assertions(check, __file__)
    check_total(check, results, 99)

    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n{passed}/{len(results)} 통과")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
