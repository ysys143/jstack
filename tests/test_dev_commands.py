#!/usr/bin/env python3
"""Command contract suite.

Usage: python3 tests/test_commands.py (from the staged developer package).

## What this locks

Commands are **flow, not routing**. Ending with "use that skill" gives the user
nothing; the description already names the skill.

1. **Can it execute?** — doctor, validate, and inspect have runnable scripts.
2. **Do exit codes match the documentation?** — changing docs alone creates lies.
3. **Does it avoid hard-to-reverse actions?** — pushes, merges, and installs are outside commands.
4. **Do named targets exist?** — skill names and script paths.
"""

import concurrent.futures
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
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "skills"))
from _suite_lib import (  # noqa: E402
    check_no_constant_assertions,
    check_total,
    check_ref_contracts,
    check_contract_coverage,
    split_frontmatter,
)  # noqa: E402

CMD = os.path.join(ROOT, "commands")
SCRIPTS = os.path.join(ROOT, "scripts")
SKILLS = os.path.join(ROOT, "skills")

WANT = (
    "brainstorming",
    "branch",
    "commit",
    "consensus-plan",
    "daily-wrapup",
    "doctor",
    "inspect",
    "install-skill",
    "log",
    "pr",
    # `recall` says the first three items belong to `/setup`, and its suite locked
    # that sentence, but **the command was absent**. The contract checked nothing.
    # The imported legacy command is `session-search/commands/setup-recall.md` (176 lines, 9 steps).
    "setup-recall",
    "ship",
    "skills",
    "tidy",
    "test-plugin",
    "weekly-wrapup",
    "wrap",
)

# Only commands whose intent no public skill carries have a description; the rest cost
# nothing in the model-facing listing and show their first body line in the `/` menu.
DESCRIBED = (
    "branch",
    "commit",
    "convert",
    "doctor",
    "init",
    "inspect",
    "install-skill",
    "log",
    "pr",
    "project-checks",
    "ship",
    "skills",
    "test-plugin",
    "validate",
    "wrap",
)
DESCRIPTION_COLUMNS = 60

results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))


def read(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


def command_description(fm):
    """Return the frontmatter description, or None when the key is absent."""
    m = re.search(r"(?m)^description:[ \t]*(.*)$", fm)
    if not m:
        return None
    raw = m.group(1).strip()
    if raw.startswith('"'):
        try:
            return json.loads(raw)
        except ValueError:
            return raw
    return raw


def menu_contract(name, text):
    """A described command has a short ASCII description; any other command has none
    and opens with `# /<name> — `."""
    fm, body = split_frontmatter(text)
    description = command_description(fm)
    if name in DESCRIBED:
        return bool(
            description
            and len(description) <= DESCRIPTION_COLUMNS
            and re.fullmatch(r"[\x20-\x7e]+", description)
        )
    first = next((line for line in body.splitlines() if line.strip()), "")
    return description is None and first.startswith(f"# /{name} \u2014 ")


def run(script, *args):
    """Run a runner or checker script.

    **Disable deletion regression.** This suite measures the script's **contract**
    (exit code, output shape, population), not skill-suite binding. Calling the
    runner invokes skill suites that copy the tree per reference file, then repeats
    inside this suite's own deletion copy. One `test_commands` run exceeded 30 minutes.

    Omitting this still preserves the runner's exit code and summary because totals
    are preserved. Each skill suite measures its own binding during the full run.
    """
    nested_env = dict(os.environ, JSTACK_SKIP_DELETION="1")
    nested_env.pop("JSTACK_SUITE_EVIDENCE_DIR", None)
    r = subprocess.run(
        ["bash", os.path.join(SCRIPTS, script), *args],
        capture_output=True,
        text=True,
        cwd=ROOT,
        env=nested_env,
    )
    return r.returncode, r.stdout + r.stderr


def main():
    all_names = sorted(f[:-3] for f in os.listdir(CMD) if f.endswith(".md"))
    check("Inventory: the unified command count is 35", len(all_names) == 35, f"{all_names}")
    names = sorted(WANT)

    # **Handwritten counts silently age.** `AGENTS.md` said there were 18 skills
    # while 19 existed (delegate), and no checker measured the number. This plugin's
    # `/skills` command already explains that it avoids copied lists because they
    # silently age, yet `AGENTS.md` was such a copy. Compare all three structural
    # counts with the actual tree.
    _skill_dirs = sorted(
        d for d in os.listdir(os.path.join(ROOT, "skills"))
        if os.path.isfile(os.path.join(ROOT, "skills", d, "SKILL.md"))
    )
    _agent_files = sorted(
        f for f in os.listdir(os.path.join(ROOT, "agents")) if f.endswith(".md")
    )
    for _label, _real, _expected in (
        ("skills", len(_skill_dirs), 41),
        ("commands", len(all_names), 35),
        ("agents", len(_agent_files), 17),
    ):
        check(
            f"Inventory: unified {_label} count matches the fixed inventory",
            _real == _expected,
            f"expected {_expected} / actual {_real}",
        )
    for w in WANT:
        check(f"Inventory: /{w} is present", w in all_names)

    bodies = {}
    for n in names:
        command_text = read(os.path.join(CMD, n + ".md"))
        fm, body = split_frontmatter(command_text)
        bodies[n] = body
        check(
            f"Format: /{n} has a description of at most 60 columns"
            if n in DESCRIBED
            else f"Format: /{n} has no description and opens with its `/` menu line",
            menu_contract(n, command_text),
        )
        # **Reject routing-only commands.** A one-line skill name merely repeats
        # what the description already says.
        check(
            f"Flow: /{n} body contains procedure or judgment, not one routing line",
            len(body.strip()) > 400,
            f"{len(body.strip())}B",
        )

    with_description = [
        name
        for name in all_names
        if command_description(split_frontmatter(read(os.path.join(CMD, name + ".md")))[0]) is not None
    ]
    off_contract = [
        name for name in all_names if not menu_contract(name, read(os.path.join(CMD, name + ".md")))
    ]
    check(
        "Format: exactly the 15 named commands carry a description and every other command opens with `# /<name> \u2014 `",
        sorted(with_description) == sorted(DESCRIBED) and not off_contract,
        f"described {sorted(with_description)} / off contract {off_contract}",
    )

    # (1) Executability — three commands have scripts that actually run.
    for cmd, script in (
        ("doctor", "doctor.sh"),
        ("test-plugin", "run_suites.sh"),
        ("inspect", "inspect.sh"),
    ):
        p = os.path.join(SCRIPTS, script)
        check(
            f"Execution: {script} exists and is executable",
            os.path.isfile(p) and os.access(p, os.X_OK),
        )
        check(f"Execution: /{cmd} points to that script", script in bodies[cmd])

    # (2) Exit-code contracts match behavior; changing only docs creates a lie.
    rc, out = run("inspect.sh", "definitely-no-such-skill")
    check("Measured: inspect returns 2 for a missing skill", rc == 2, f"rc={rc}")
    rc, out = run("inspect.sh", "help")
    check("Measured: inspect returns 0 for a skill with a passing contract", rc == 0, f"rc={rc}")
    check(
        "Measured: inspect output contains layers and contract results",
        "[L1] SKILL.md" in out and "Contract —" in out and "Frozen references —" in out,
    )
    # **Counting only references/ for L2 reports zero for tdd.** The documentation
    # tells readers to interpret zero as a misplaced layer, creating a false defect.
    rc_t, out_t = run("inspect.sh", "tdd")
    check(
        "Measured: inspect counts langs/ as L2",
        rc_t == 0
        and "langs/" in out_t
        and "[L2]" in out_t
        and " 0 items" not in out_t.split("[L3]")[0],
        out_t.split("[L3]")[0].strip().replace("\n", " | "),
    )
    # **`search_api.sh`: measure what can be measured without network access.** The
    # script queries a public marketplace, so the suite cannot run that call. Still,
    # importing an uncontracted shell would leave an empty shell. Do not pretend to
    # measure the network call; measure every locally observable property.
    _sa = os.path.join(SCRIPTS, "search_api.sh")
    check("Execution: search_api.sh exists and is executable",
          os.path.isfile(_sa) and os.access(_sa, os.X_OK))
    _sa_src = read(_sa)
    check("Restraint: search_api.sh does not swallow failures (set -euo pipefail)",
          "set -euo pipefail" in _sa_src)
    check("Restraint: search_api.sh locks two endpoints",
          'ENDPOINT" == "skills"' in _sa_src and 'ENDPOINT" == "plugins"' in _sa_src)
    _rc, _o = run("search_api.sh")
    check("Measured: search_api returns 1 with no arguments and prints usage",
          _rc == 1 and "Usage:" in _o, f"rc={_rc}")
    _rc, _o = run("search_api.sh", "nope", "q")
    check("Measured: search_api returns 1 for an unknown endpoint", _rc == 1, f"rc={_rc}")
    # **Create the blocked state.** `bridge` defines code 2 as blocked; removing a
    # tool distinguishes a declaration from behavior. Keep only bash and python3
    # on `PATH`, excluding curl.
    _box = tempfile.mkdtemp(prefix="sa-noncurl-")
    try:
        for _b in ("/bin/bash", "/usr/bin/python3"):
            if os.path.exists(_b):
                os.symlink(_b, os.path.join(_box, os.path.basename(_b)))
        _r = subprocess.run(["/bin/bash", _sa, "skills", "q"], cwd=ROOT,
                            env={"PATH": _box}, capture_output=True, text=True)
        check("Measured: search_api returns 2 without curl (blocked bridge state)",
              _r.returncode == 2 and "curl" in _r.stderr,
              f"rc={_r.returncode} {_r.stderr.strip()[:60]}")
    finally:
        shutil.rmtree(_box, ignore_errors=True)

    rc, out = run("run_suites.sh", "help")
    check("Measured: validate returns 0 on success", rc == 0, f"rc={rc}")
    check(
        "Measured: validate output reports suite count", "스위트" in out, out.strip()[:80]
    )
    rc, out = run("run_suites.sh", "no-such-skill")
    check(
        "Measured: validate returns 2 when there is nothing to run (not 0)",
        rc == 2,
        f"rc={rc}",
    )
    # **Exercise the empty-tree path.** Testing only a named failure leaves the
    # "nothing to run" branch outside the contract (a measured red escaped). Run the
    # script from a temporary root with no skills.
    with tempfile.TemporaryDirectory() as tmp:
        os.makedirs(os.path.join(tmp, "scripts"))
        os.makedirs(os.path.join(tmp, "skills"))
        shutil.copy(
            os.path.join(SCRIPTS, "run_suites.sh"),
            os.path.join(tmp, "scripts", "run_suites.sh"),
        )
        r = subprocess.run(
            ["bash", os.path.join(tmp, "scripts", "run_suites.sh")],
            capture_output=True,
            text=True,
            cwd=tmp,
        )
        check(
            "Measured: validate returns 2 when no skills exist (not 0)",
            r.returncode == 2,
            f"rc={r.returncode} {r.stdout.strip()}",
        )

    # Measure inspect output for a skill without a contract. Every real skill has
    # one, so this path can be exercised only in a temporary tree.
    with tempfile.TemporaryDirectory() as tmp:
        os.makedirs(os.path.join(tmp, "scripts"))
        os.makedirs(os.path.join(tmp, "skills", "bare"))
        shutil.copy(
            os.path.join(SCRIPTS, "inspect.sh"),
            os.path.join(tmp, "scripts", "inspect.sh"),
        )
        with open(os.path.join(tmp, "skills", "bare", "SKILL.md"), "w") as f:
            f.write("---\nname: bare\ndescription: x\n---\n\nx\n")
        r = subprocess.run(
            ["bash", os.path.join(tmp, "scripts", "inspect.sh"), "bare"],
            capture_output=True,
            text=True,
            cwd=tmp,
        )
        check(
            "Measured: inspect returns 1 for a skill without a contract (not 0)",
            r.returncode == 1,
            f"rc={r.returncode}",
        )
        check(
            "Measured: inspect explicitly reports the missing contract",
            "Contract — none" in r.stdout,
            r.stdout.strip()[:80],
        )

    rc, out = run("doctor-dev.sh")
    check("Measured: doctor returns one of 0, 1, or 2", rc in (0, 1, 2), f"rc={rc}")
    with tempfile.TemporaryDirectory() as tmp:
        scripts = os.path.join(tmp, "scripts")
        os.makedirs(scripts)
        shutil.copy2(os.path.join(SCRIPTS, "doctor.sh"), scripts)
        for name, code in (("doctor-dev.sh", 1), ("doctor-work.sh", 2)):
            path = os.path.join(scripts, name)
            with open(path, "w", encoding="utf-8") as f:
                f.write(f'#!/usr/bin/env bash\necho {name}\nexit {code}\n')
        dispatched = subprocess.run(
            ["bash", os.path.join(scripts, "doctor.sh")],
            capture_output=True, text=True)
        check("Measured: unified doctor calls both diagnostics and propagates the highest rc",
              dispatched.returncode == 2
              and "doctor-dev.sh" in dispatched.stdout
              and "doctor-work.sh" in dispatched.stdout,
              f"rc={dispatched.returncode} {dispatched.stdout.strip()}")
    # **Can half-ready (present but unauthenticated) structurally return code 1?**
    # The previous opt() omitted --auth, so a logged-out tool received a "proceed"
    # signal (external review, gh). Use a stub that answers version but fails auth.
    with tempfile.TemporaryDirectory() as tmp:
        stub = os.path.join(tmp, "gh")
        with open(stub, "w", encoding="utf-8") as f:
            f.write(
                "#!/usr/bin/env bash\n"
                '[ "$1" = "--version" ] && { echo "gh version 2.0.0"; exit 0; }\n'
                "exit 1\n"
            )
        os.chmod(stub, 0o755)
        env = dict(os.environ, PATH=tmp + os.pathsep + os.environ["PATH"])
        r = subprocess.run(
            ["bash", os.path.join(SCRIPTS, "doctor-dev.sh")],
            capture_output=True,
            text=True,
            cwd=ROOT,
            env=env,
        )
        check(
            "Measured: doctor returns code 1 for present-but-unauthenticated (not 0)",
            r.returncode == 1,
            f"rc={r.returncode} {r.stdout.strip()[:60]}",
        )
        check(
            "Measured: output names the functionality that is lost",
            "unauthenticated" in r.stdout and "/pr falls back to browser instructions" in r.stdout,
            r.stdout.strip()[:80],
        )
    check(
        "Measured: doctor emits output even in state 0 because it was explicitly invoked",
        out.strip() != "",
        repr(out[:60]),
    )

    # **Does every skill have a contract suite?** Matching the runner glob prevents
    # a *differently named* suite; this check prevents a skill *without a suite*.
    # They guard different failures (review 9). Otherwise the runner silently skips it.
    _nosuite = []
    for _sk in sorted(os.listdir(SKILLS)):
        _d = os.path.join(SKILLS, _sk)
        if not os.path.isfile(os.path.join(_d, "SKILL.md")):
            continue
        _td = os.path.join(_d, "tests")
        _has = os.path.isdir(_td) and any(
            f.endswith(".py") and not f.startswith("_") for f in os.listdir(_td)
        )
        if not _has:
            _nosuite.append(_sk)
    check("Reachability: every skill has a contract suite", not _nosuite, f"{_nosuite}")

    # **Are the runner's meta-check calls alive?** Review 7 H-3 made missing checker
    # files fail closed but left call sites unguarded. Truncating both runners at
    # `PARITY=` removed 28%% while reporting `suite 20 / failures 0, rc=0`; pair
    # parity passes when both copies shrink identically (review 12). This mirrors
    # the review 6 defect where both `_suite_lib.py` thresholds were lowered.
    #
    # A full run here would recurse. Verify the **selected-run notice** in a live run
    # and verify all three checker **calls** in source. This catches deletion of the
    # whole meta block as well as only its `if` branch.
    _rc, _o = run("run_suites.sh", "help")
    check(
        "Runner: selected execution reports that it skips meta checks",
        "지정 실행" in _o and "건너뛴다" in _o,
        _o.strip()[-80:],
    )
    _src = read(os.path.join(SCRIPTS, "run_suites.sh"))
    check(
        "Runner: missing contract checkers fail closed",
        "contract checker is missing" in _src and "exit 2" in _src,
    )

    # **Does the full-run branch avoid early exits?** Behavioral checks use a
    # temporary tree and cannot see a branch that differs only in the real tree.
    # Adding `[ -d "$ROOT/../../.git" ] && exit 0` made the real tree run zero meta
    # checks while locks stayed green (review 16). Replacing source checks opened it.
    #
    # An inverted condition may still evade this, but it blocks the cheapest real-tree
    # skip. **Source and behavioral checks cover each other's blind spots.** A shell
    # runner can identify synthetic fixtures; branching on `.git` swallowed failures
    # only in the real tree, so behavior passed and parity printed a mismatch while
    # rc remained zero (review 17). Rephrasing can evade source checks, and fixture
    # detection can evade behavior, so retain both.
    #
    # Lock the meta block's **shape**: exactly three failure propagations and one
    # branch (`$# -eq 0`). `|| true` leaves two propagations; a `.git` branch makes two.
    _meta = _src[_src.index("PARITY=") :]
    _meta = _meta[: _meta.index("[ $fail -eq 0 ]")]
    _prop = _meta.count("fail=$((fail + 1))")
    check(
        "Runner: the meta block has three failure propagations",
        _prop == 3,
        "" if _prop == 3 else f"{_prop} found; one checker failure is swallowed",
    )
    _brs = _meta.count("if ") + _meta.count("elif ")
    check(
        "Runner: the meta block has exactly one conditional branch",
        _brs == 1,
        "" if _brs == 1 else f"{_brs} found; a branch may distinguish real tree and fixture",
    )
    for _var, _why in (
        ("$PARITY", "floor parity"),
        ("$BEHAV", "harness behavior"),
        ("$LIBPAR", "copy-pair parity"),
    ):
        check(
            f"Runner: source invokes the {_why} checker", f'python3 "{_var}"' in _meta, _var
        )

    # **Measure effects, not only source.** A source-only check found
    # `python3 "$PARITY"` even when `|| true` swallowed its failure. Parity printed
    # one mismatch but the runner returned rc=0 (review 14). `false &&` also passed.
    #
    # A full run would recurse. Build a **temporary tree** with one minimal skill and
    # three deliberately failing checkers, then inspect runner rc. Fail one checker
    # at a time; failing all three lets other failures hide one swallowed result.
    _CHECKERS = (
        ("check_floor_parity.py", "floor parity"),
        ("check_suite_lib_behaviour.py", "harness behavior"),
        ("check_suite_lib_parity.py", "copy-pair parity"),
    )
    for _target, _why in _CHECKERS:
        with tempfile.TemporaryDirectory() as _tmp:
            _pt = os.path.join(_tmp, "jstack")
            os.makedirs(os.path.join(_pt, "scripts"))
            os.makedirs(os.path.join(_pt, "skills", "only", "tests"))
            shutil.copy(
                os.path.join(SCRIPTS, "run_suites.sh"),
                os.path.join(_pt, "scripts", "run_suites.sh"),
            )
            with open(os.path.join(_pt, "skills", "only", "SKILL.md"), "w") as _f:
                _f.write("---\nname: only\ndescription: x\n---\n\nx\n")
            with open(
                os.path.join(_pt, "skills", "only", "tests", "run_tests.py"), "w"
            ) as _f:
                _f.write("print('1/1 통과')\n")  # Required suite summary protocol.
            for _n, _ in _CHECKERS:
                with open(os.path.join(_pt, "scripts", _n), "w") as _f:
                    _f.write(
                        "import sys\nprint('[ok]')\n"
                        + ("sys.exit(1)\n" if _n == _target else "")
                    )
            _nested_env = os.environ.copy()
            _nested_env.pop("JSTACK_SUITE_EVIDENCE_DIR", None)
            _r = subprocess.run(
                ["bash", os.path.join(_pt, "scripts", "run_suites.sh")],
                capture_output=True,
                text=True,
                cwd=_pt,
                env=_nested_env,
            )
            check(
                f"Runner: propagates {_why} checker failure in its exit code",
                _r.returncode != 0,
                ""
                if _r.returncode != 0
                else f"rc={_r.returncode}; suite passed and only this checker failed, "
                "but the runner returned zero and swallowed the failure",
            )

    # **Does inspect propagate suite failure?** Earlier tests used only passing
    # skills such as `help` and `tdd`; a version that swallowed failures and always
    # returned zero still passed 185/185 (review 9). A command whose purpose is to
    # measure contract status reported a **broken skill as healthy**. Exercise a
    # deliberately failing temporary skill and measure frozen-reference count with
    # the same fixture (one `.lines` file -> one frozen reference).
    with tempfile.TemporaryDirectory() as tmp:
        os.makedirs(os.path.join(tmp, "scripts"))
        _sd = os.path.join(tmp, "skills", "broken")
        os.makedirs(os.path.join(_sd, "tests", "refs"))
        shutil.copy(
            os.path.join(SCRIPTS, "inspect.sh"),
            os.path.join(tmp, "scripts", "inspect.sh"),
        )
        with open(os.path.join(_sd, "SKILL.md"), "w") as f:
            f.write("---\nname: broken\ndescription: x\n---\n\nx\n")
        with open(os.path.join(_sd, "tests", "refs", "SKILL.md.lines"), "w") as f:
            f.write("# blob: 0\nx\n")
        with open(os.path.join(_sd, "tests", "run_tests.py"), "w") as f:
            f.write(
                "import sys\nprint('[FAIL] deliberately broken contract')\n"
                "print('0/1 통과')\nsys.exit(1)\n"
            )
        r = subprocess.run(
            ["bash", os.path.join(tmp, "scripts", "inspect.sh"), "broken"],
            capture_output=True,
            text=True,
            cwd=tmp,
        )
        check(
            "Measured: inspect does not return zero for a skill with a failing contract",
            r.returncode != 0,
            f"rc={r.returncode}",
        )
        check(
            "Measured: inspect exposes the failing line unchanged",
            "deliberately broken contract" in r.stdout,
            r.stdout.strip()[:80],
        )
        check(
            "Measured: inspect's frozen-reference count matches the fixture",
            "Frozen references — 1 items" in r.stdout,
            r.stdout.strip()[:80],
        )

    # **Do inspect counts match the tree?** As with doctor, exit codes and output
    # existed without checking whether L1/L2/L3 matched **actual file counts**. A
    # regression that counted only `references/` and omitted `langs/` passed every
    # behavioral axis. Scan every skill and collect mismatches; sampling one proves
    # only that one. Since `inspect.sh` also runs each skill contract after counting,
    # a serial full scan took 2m05s, so run in parallel without shrinking population.
    _skills = [
        _s
        for _s in sorted(os.listdir(SKILLS))
        if os.path.isfile(os.path.join(SKILLS, _s, "SKILL.md"))
    ]
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as _ex:
        _outs = dict(zip(_skills, _ex.map(lambda n: run("inspect.sh", n)[1], _skills)))
    _mismatch = []
    for _sk in _skills:
        _d = os.path.join(SKILLS, _sk)
        _o = _outs[_sk]
        _want_l2 = sum(
            len(os.listdir(os.path.join(_d, _sub)))
            for _sub in ("references", "langs")
            if os.path.isdir(os.path.join(_d, _sub))
        )
        _want_l3 = (
            len(os.listdir(os.path.join(_d, "scripts")))
            if os.path.isdir(os.path.join(_d, "scripts"))
            else 0
        )
        _want_l1 = len(read(os.path.join(_d, "SKILL.md")).splitlines())
        for _lbl, _want, _pat in (
            ("L1", _want_l1, r"\[L1\][^\n]*?(\d+) lines"),
            ("L2", _want_l2, r"\[L2\][^\n]*?(\d+) items"),
            ("L3", _want_l3, r"\[L3\][^\n]*?(\d+) items"),
        ):
            _m = re.search(_pat, _o)
            _got = int(_m.group(1)) if _m else None
            if _got != _want:
                _mismatch.append(f"{_sk}/{_lbl}: reported {_got} / actual {_want}")
    check(
        "Measured: inspect layer counts match the tree for every skill",
        not _mismatch,
        f"{_mismatch[:6]}",
    )

    # **What doctor measures is also a contract.** Behavioral checks covered status
    # codes and named tools but lacked **coverage**, so reducing the implementation
    # to only `gh` kept the tree green. It returned "all present" and rc=0 without
    # required `python3` or `git` (review 8). `doctor.md` does not enumerate tools,
    # so documentation-to-script comparison cannot detect this.
    #
    # Remove **one tool at a time from PATH** and require the contract response:
    # required means code 2, optional means code 1, and output names the lost tool.
    for tool, want_rc, kind in (
        ("python3", 2, "required"),
        ("git", 2, "required"),
        ("rg", 1, "optional"),
        ("gh", 1, "optional"),
        ("jq", 1, "optional"),
    ):
        with tempfile.TemporaryDirectory() as tmp:
            # Build a minimal PATH with every needed utility except the target.
            # Adding the system PATH wholesale would invalidate the removal.
            for other in (
                "python3",
                "git",
                "rg",
                "gh",
                "jq",
                "bash",
                "env",
                "dirname",
                "sed",
                "awk",
                "head",
            ):
                if other == tool:
                    continue
                src = shutil.which(other)
                if src:
                    os.symlink(src, os.path.join(tmp, other))
            env = dict(os.environ, PATH=tmp)
            r = subprocess.run(
                ["bash", os.path.join(SCRIPTS, "doctor-dev.sh")],
                capture_output=True,
                text=True,
                cwd=ROOT,
                env=env,
            )
            check(
                f"Measured: doctor returns {want_rc} when {kind} tool {tool} is absent",
                r.returncode == want_rc,
                f"rc={r.returncode}",
            )
            check(
                f"Measured: doctor names missing tool {tool}",
                tool in r.stdout,
                r.stdout.strip()[:80],
            )

    # Do declared exit codes exist in the scripts?
    for cmd, script in (
        ("test-plugin", "run_suites.sh"),
        ("inspect", "inspect.sh"),
        ("doctor", "doctor.sh"),
    ):
        src = read(os.path.join(SCRIPTS, script))
        declared = set(re.findall(r"(?m)^\| (\d) \|", bodies[cmd]))
        real = set(re.findall(r"(?:exit|return)\s+(\d)", src))
        # doctor returns the aggregate 0/1/2 rc from child diagnostics.
        if cmd == "doctor" and 'exit "$rc"' in src:
            real.update({"0", "1"})
        check(
            f"Match: /{cmd} has every declared exit code in its script",
            declared and declared <= real,
            f"documented {sorted(declared)} / actual {sorted(real)}",
        )

    # (3) Avoid hard-to-reverse actions.
    check(
        "Restraint: /commit explicitly forbids pushing",
        "Do not push" in bodies["commit"],
    )
    check(
        "Restraint: /commit prevents the --no-verify bypass", "--no-verify" in bodies["commit"]
    )
    check(
        "Restraint: /branch forbids remote creation",
        "Do not create a remote branch" in bodies["branch"],
    )
    check(
        "Restraint: /branch prevents forced movement of existing branches",
        "Do not force-move" in bodies["branch"],
    )
    check(
        "Restraint: /pr forbids merging on the user's behalf",
        "Do not merge on the user's behalf" in bodies["pr"],
    )
    check(
        "Restraint: /ship forbids pushing or merging",
        "Do not push or merge" in bodies["ship"],
    )
    check(
        "Restraint: /ship does not offer verification bypasses",
        "Do not suggest a bypass" in bodies["ship"],
    )
    check(
        "Restraint: /doctor does not install on the user's behalf",
        "Do not install on the user's behalf" in bodies["doctor"],
    )
    check(
        "Restraint: /tidy does not change behavior",
        "Do not change behavior" in bodies["tidy"],
    )
    check(
        "Restraint: /tidy forbids deleting tests to go green",
        "Deleting tests to make them green is not cleanup" in bodies["tidy"],
    )

    # (4) Does each command retain its nontrivial judgments?
    check(
        "Judgment: /commit explains why one commit has one reason",
        "revert only half" in bodies["commit"],
    )
    check(
        "Judgment: /commit requires the repository's message style",
        "last 20" in bodies["commit"] and "not personal preference" in bodies["commit"],
    )
    check(
        "Judgment: /branch explains the cost of branching from a dirty tree",
        "other people's changes" in bodies["branch"] and "carries" in bodies["branch"],
    )
    check(
        "Judgment: /pr forbids restating the diff as prose",
        "Do not rewrite the diff as prose" in bodies["pr"],
    )
    check(
        "Judgment: /pr has at least four required description rows",
        len(re.findall(r"(?m)^\| (?!---)(?!Item)", bodies["pr"])) >= 4,
    )
    check(
        "Judgment: /ship explains stage ordering",
        "only when the preceding step is green" in bodies["ship"],
    )
    check(
        "Judgment: /ship says a gate that does not block is worse",
        "A gate that exists but does not block is worse" in bodies["ship"],
    )
    check(
        "Judgment: /wrap requires listing unfinished work first",
        "Record unfinished work first" in bodies["wrap"],
    )
    check(
        "Judgment: /wrap forbids saving progress",
        "Do not store progress status" in bodies["wrap"],
    )
    check(
        "Judgment: /tidy provides three baseline-lock conditions",
        "git status --short" in bodies["tidy"] and "directly observed" in bodies["tidy"],
    )
    check(
        "Judgment: /tidy orders axis 6 before axis 5",
        "axis 5" in bodies["tidy"] and "**before**" in bodies["tidy"],
    )
    check(
        "Judgment: /log distinguishes chronological from comprehension order",
        "not comprehension" in bodies["log"],
    )
    check("Judgment: /log forbids inventing reasons", "reason unknown" in bodies["log"])
    check(
        "Judgment: /skills explains why it keeps no copied inventory",
        "silently becomes stale" in bodies["skills"],
    )
    check(
        "Judgment: /skills distinguishes its role from help",
        "what exists" in bodies["skills"] and "what to use" in bodies["skills"],
    )
    check(
        "Judgment: /test-plugin explains the danger of zero passing checks",
        "A missing check did not pass" in bodies["test-plugin"],
    )
    check(
        "Judgment: /test-plugin identifies check_total as a change detector",
        "change detector" in bodies["test-plugin"],
    )
    check(
        "Judgment: /inspect explains why a missing contract returns 1",
        "Returning 1 for absent contracts is intentional" in bodies["inspect"],
    )
    check(
        "Judgment: /doctor explains why code 1 is distinct",
        "which exact feature is unavailable" in bodies["doctor"],
    )

    # (5) Do referenced targets exist?
    on_disk = {
        d
        for d in os.listdir(SKILLS)
        if os.path.isdir(os.path.join(SKILLS, d))
        and os.path.exists(os.path.join(SKILLS, d, "SKILL.md"))
    }
    named = {}
    for n, b in bodies.items():
        for m in re.findall(r"`([a-z][a-z0-9-]{2,})`\s*skill", b):
            named.setdefault(m, []).append(n)
    check(
        "References: commands name at least four skills", len(named) >= 4, f"{sorted(named)}"
    )
    check(
        "References: every named skill exists",
        all(m in on_disk for m in named),
        f"missing {[m for m in named if m not in on_disk]}",
    )
    for n, b in bodies.items():
        # **Do not mistake a nested `scripts/` for the plugin root.** A valid
        # `skills/author/scripts/register_local.sh` citation once failed because
        # this axis looked only for root `scripts/register_local.sh`. A path with
        # a preceding component belongs to another layer.
        for path in re.findall(r"(?<![\w/])scripts/([a-z_]+\.sh)", b):
            check(
                f"References: /{n} points to existing scripts/{path}",
                os.path.isfile(os.path.join(SCRIPTS, path)),
            )

    # **Lock three axes of command bodies.** The former suite checked only "400+
    # characters", so replacing branch.md with five lines plus filler still passed
    # 93/93 (external review). Needles cover nontrivial judgments and all floors are measured.
    check_ref_contracts(
        check,
        ROOT,
        [
            (
                "branch.md",
                "base check, naming, and remote prohibition",
                ["other people's changes", "Do not create a remote branch", "Do not force-move"],
                805,
            ),
            (
                "commit.md",
                "one reason per commit, repository style, and no push",
                [
                    "revert only half",
                    "last 20",
                    "Do not push",
                    "--no-verify",
                ],
                993,
            ),
            (
                "daily-wrapup.md",
                "local evidence draft and explicit destination handoff",
                ["shared `runtime/work_report.js`", "Publish only when", "local recovery copy"],
                1000,
            ),
            (
                "doctor.md",
                "three states, no delegated installation, and visible state zero",
                ["Do not install on the user's behalf", "which exact feature is unavailable", "copy and paste"],
                868,
            ),
            (
                "inspect.md",
                "layer interpretation, L2 beyond references, and code 1 for no contract",
                [
                    "Returning 1 for absent contracts is intentional",
                    "incorrect layering",
                    "Do not count only `references/`",
                ],
                620,
            ),
            (
                "install-skill.md",
                "one exact namespace, visible namespace author and home, same-name refusal until --force, no fabricated plugin entry, a privileged-key warning, and an unreviewed-source notice",
                [
                    "installs without a further confirmation step",
                    "Show the namespace, the author and the home",
                    "ask before re-running with",
                    "Do not fabricate a marketplace or plugin-cache entry",
                    "A same-named skill with different content is refused",
                    "passed after the user agrees",
                    "jstack does not review it",
                    "stop and ask which skill is meant",
                    "Do not retry with the bare name",
                    "declares `allowed-tools` or `hooks`",
                ],
                2630,
            ),
            (
                "log.md",
                "topic grouping, reasons, and no invention",
                ["not comprehension", "reason unknown"],
                680,
            ),
            (
                "pr.md",
                "review before opening, description fields, and no merge",
                ["Do not rewrite the diff as prose", "Do not merge on the user's behalf"],
                901,
            ),
            (
                "ship.md",
                "ordering, stop on failure, and no push",
                [
                    "only when the preceding step is green",
                    "gate that exists but does not block is worse",
                    "Do not push or merge",
                    "Do not suggest a bypass",
                ],
                712,
            ),
            (
                "setup-recall.md",
                "installation guidance only, three states, and one real stop condition",
                [
                    "print external installation commands without",
                    "sole exception",
                    "locate a marker without guessing",
                ],
                6477,
            ),
            (
                "skills.md",
                "read the tree directly and distinguish help's role",
                ["silently becomes stale", "what exists", "what to use", "use `/install-skill <namespace>`"],
                578,
            ),
            (
                "tidy.md",
                "three baseline locks, axis order, and invariant behavior",
                [
                    "directly observed",
                    "Do not change behavior",
                    "Deleting tests to make them green is not cleanup",
                ],
                743,
            ),
            (
                "test-plugin.md",
                "three exit codes and the danger of zero passing checks",
                ["A missing check did not pass", "change detector"],
                668,
            ),
            (
                "weekly-wrapup.md",
                "week boundary, local draft, and destination handoff",
                ["Monday through Sunday", "local draft", "C/D-style physical addresses"],
                1000,
            ),
            (
                "wrap.md",
                "unfinished work first and no progress snapshots",
                ["Record unfinished work first", "Do not store progress status"],
                789,
            ),
            (
                "brainstorming.md",
                "plan shaping core read first, depth stated, proposal until accepted, and no code",
                [
                    "Follow the `plan` skill's shaping core: read its brainstorming reference",
                    "Read the repository before asking anything",
                    "do not reopen a design",
                    "It stays a proposal until the user accepts",
                    "Never edit `contract.yaml`",
                ],
                897,
            ),
            (
                "consensus-plan.md",
                "plan consensus recipe read first, fixed limit, independent assessors, and no execution",
                [
                    "Follow the `plan` skill's consensus recipe: read its consensus-plan reference",
                    "Fix the alternatives, the criteria and the finite round limit before any",
                    "never present one author's roleplay as consensus",
                    "Synthesize the answers yourself as the plan's only author",
                    "if their isolation cannot be evidenced, return unverified",
                    "converged, pending approval, partial, unavailable, unverified or cancelled",
                    "approval to execute. Never edit `contract.yaml`",
                ],
                699,
            ),
        ],
        label_prefix="Command contract",
        subdir="commands",
        population={name + ".md" for name in WANT},
    )

    # **Deletion-regression axis.** The three axes protect document *content*, but
    # nobody checked whether the suite **read it**. Replacing all 53 judgments with
    # tautologies still passed (review 4). Every floor is measured.
    _ran = sum(
        1
        for r in results
        if not r[0].startswith(("자기검사:", "계약 커버리지:", "References: /"))
    )
    # **Pass the same list to copy counting.** Excluding items from only one side
    # creates free slack and misses real disappearance (review 5: six items).
    _SKIP = ("References: /",)
    _MINE = {
        "commands/branch.md": 9,
        "commands/commit.md": 10,
        "commands/daily-wrapup.md": 2,
        "commands/doctor.md": 10,
        "commands/inspect.md": 9,
        "commands/log.md": 8,
        "commands/pr.md": 9,
        "commands/ship.md": 10,
        "commands/skills.md": 8,
        "commands/tidy.md": 10,
        "commands/test-plugin.md": 10,
        "commands/weekly-wrapup.md": 2,
        "commands/wrap.md": 8,
    }
    check_contract_coverage(
        check,
        __file__,
        ROOT,
        per_file=_MINE,
        live_ran=_ran,
        completeness=False,
        extra_skip=_SKIP,
    )
    # **This suite owns the population check.** Ownership may be split, but one
    # place must see the population; per-directory whitelists miss root documents
    # (review 5).
    # **The floor of 1 here is a placeholder, not a measured value.** With
    # `measure=False`, this call runs only the population guard; the agent floor is
    # measured by `tests/test_agents.py`. This note prevents reading it as measured
    # (review 6).
    _ALL = dict(_MINE)
    _ALL["evals/discriminating/audit-priority/case.yaml"] = 1
    _ALL["evals/discriminating/audit-priority/graders/burden.md"] = 1
    _ALL["evals/discriminating/audit-priority/graders/criteria.md"] = 1
    _ALL["evals/discriminating/audit-priority/graders/nit_flood.md"] = 1
    _ALL["evals/discriminating/audit-priority/graders/skill_fired.md"] = 1
    _ALL["evals/discriminating/audit-priority/prompt.md"] = 1
    _ALL["evals/discriminating/cleanup-axes/case.yaml"] = 1
    _ALL["evals/discriminating/cleanup-axes/graders/axis8_exception.md"] = 1
    _ALL["evals/discriminating/cleanup-axes/graders/axis_count.md"] = 1
    _ALL["evals/discriminating/cleanup-axes/graders/criteria.md"] = 1
    _ALL["evals/discriminating/cleanup-axes/graders/skill_fired.md"] = 1
    _ALL["evals/discriminating/cleanup-axes/prompt.md"] = 1
    # Hook contracts (section 4.13.2) and AGENTS.md are root documents outside the
    # skill tree, so no skill suite sees them. The population guard sees them here.
    _ALL["hooks/CONTRACT.md"] = 1
    _ALL["AGENTS.md"] = 1
    # `CLAUDE.md` requires README in its required structure, but both plugins lacked
    # one. Root-document binding is measured by `tests/test_contracts.py`; it also
    # once passed while README was absent.
    _ALL["README.md"] = 1
    # Imported legacy `session-search/commands/setup-recall.md`. `recall` states
    # that the first three items belong to `/setup` and its suite locked that text,
    # but the command was absent — the contract checked nothing.
    _ALL["commands/setup-recall.md"] = 1
    # Three contracts, migration/version documents, and archive guidance are root
    # documents outside the skill tree; this is their only population guard. Actual
    # binding is measured by `tests/test_contracts.py`; 1 here is a placeholder
    # because `measure=False` means the value is unused.
    _ALL["contracts/portable-contract.yaml"] = 1
    _ALL["contracts/claims.yaml"] = 1
    _ALL["contracts/change-impact.yaml"] = 1
    _ALL["CHANGELOG.md"] = 1
    _ALL["agents/quality-auditor.md"] = 1
    _ALL["agents/quality-executor.md"] = 1
    _ALL["agents/quality-verifier.md"] = 1
    _ALL["agents/sag-automation-scout.md"] = 1
    _ALL["agents/sag-doc-updater.md"] = 1
    _ALL["agents/sag-duplicate-checker.md"] = 1
    _ALL["agents/sag-followup-suggester.md"] = 1
    _ALL["agents/sag-learning-extractor.md"] = 1
    check_contract_coverage(
        check,
        __file__,
        ROOT,
        per_file=_ALL,
        live_ran=_ran,
        measure=False,
        completeness=False,
        extra_skip=_SKIP,
    )

    check_no_constant_assertions(check, __file__)
    check_total(check, results, 183)

    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n{passed}/{len(results)} 통과")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
