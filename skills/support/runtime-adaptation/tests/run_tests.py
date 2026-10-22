#!/usr/bin/env python3
"""bridge contract suite.

Run: python3 tests/run_tests.py   (from skills/bridge)

## What this locks

1. **Three states, and code 1 in particular** — a boolean probe hides exactly
   the information the user needs, and code 1 is the state that gets dropped.
2. **The probe never installs** — it changes a machine this session did not
   scope. The script is run against real cases to prove it.
3. **Numeric version comparison** — string comparison fails once, at the 9-to-10
   release. Proved with a stub, not asserted in prose.
4. **State 0 is silent** — a probe that announces every success trains the
   reader to skip its output, and then state 1 goes unread.
5. **The three P0 install.py contracts** — upward marker search, self-exclusion,
   and `${CLAUDE_PLUGIN_ROOT}` substitution. All three can fail silently, so the
   suite runs a real install against an isolated synthetic marketplace.
6. **Quoted literals in rules.json** — notation substitution must not rewrite a
   quoted forbidden string and make the document disagree with its checker.
"""
import hashlib
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
from _suite_lib import (check_no_constant_assertions, check_total, check_skill_body,
                        check_ref_contracts, split_frontmatter, check_body_deletion,
                        check_contract_coverage, check_script_contracts)  # noqa: E402
ROOT = os.path.dirname(HERE)
SKILLS = os.path.dirname(ROOT)
PROBE = os.path.join(ROOT, "scripts", "probe.sh")
INSTALL = os.path.join(ROOT, "scripts", "install.py")
RULES_JSON = os.path.join(ROOT, "scripts", "rules.json")
# Compare the documented canonical install commands with the hook delivered by
# the current tree. Source checkouts keep it under hosts/claude; built packages
# place the same file directly under hooks/.
PACKAGE_ROOT = os.path.dirname(SKILLS)
SOURCE_HOOK = os.path.join(PACKAGE_ROOT, "hosts", "claude", "hooks",
                           "validate_pr_label.py")
BUILT_HOOK = os.path.join(PACKAGE_ROOT, "hooks", "validate_pr_label.py")
HOOK = SOURCE_HOOK if os.path.isfile(SOURCE_HOOK) else BUILT_HOOK

# Skill body template for planting in a synthetic marketplace.
FM = "---\nname: {n}\ndescription: {n} description\n---\n\n{b}\n"

results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))


def read(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


def rows(text, head):
    """Return table data rows below `## head`, or an empty list if absent."""
    if head not in text:
        return []
    body = text.split(head, 1)[1].split("\n## ", 1)[0]
    return [r for r in re.findall(r"(?m)^\| (?!---)(.+?) \|", body)
            if r.strip() not in ("Exit", "Check", "State")]


def probe(*args, path_extra=None):
    """Run probe.sh and return (rc, stdout)."""
    env = dict(os.environ)
    if path_extra:
        env["PATH"] = path_extra + os.pathsep + env["PATH"]
    r = subprocess.run(["bash", PROBE, *args], capture_output=True,
                       text=True, env=env)
    return r.returncode, r.stdout


def stub(tmp, name, version_line):
    """Create a fake executable that emits only a version line."""
    p = os.path.join(tmp, name)
    with open(p, "w", encoding="utf-8") as f:
        f.write(f'#!/usr/bin/env bash\necho "{version_line}"\n')
    os.chmod(p, 0o755)
    return tmp


def _compiles(pattern):
    try:
        re.compile(pattern)
        return True
    except re.error:
        return False


def read_or_empty(p):
    """Return an empty string when the path is absent after a failed install."""
    try:
        with open(p, encoding="utf-8") as f:
            return f.read()
    except OSError:
        return ""


def marketplace(tmp, skills, *, with_marker=True, depth=("staging", "jstack-dev"),
                owner="bridge", extra=None, marker_rel=None):
    """Build an isolated synthetic marketplace.

    Keep the installer deeply nested so finding the marker actually requires
    an upward search and differs from fixed parent-count arithmetic.
    """
    root = os.path.join(tmp, "mkt")
    plug = os.path.join(root, *depth)
    for name, body in skills.items():
        d = os.path.join(plug, "skills", name)
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "SKILL.md"), "w", encoding="utf-8") as f:
            f.write(body)
    for name, files in (extra or {}).items():
        d = os.path.join(plug, "skills", name)
        os.makedirs(d, exist_ok=True)
        for fn, body in files.items():
            with open(os.path.join(d, fn), "w", encoding="utf-8") as f:
                f.write(body)
    bs = os.path.join(plug, "skills", owner, "scripts")
    os.makedirs(bs, exist_ok=True)
    shutil.copy(INSTALL, bs)
    shutil.copy(RULES_JSON, bs)
    if with_marker:
        # **You can obtain the location of the marker from the document.** Follow the path claimed in the text.
        # You have to actually drop the file to see if the document and script point to the same thing.
        rel = marker_rel or os.path.join(".claude-plugin", "marketplace.json")
        mp = os.path.join(root, *rel.replace("\\", "/").split("/"))
        os.makedirs(os.path.dirname(mp), exist_ok=True)
        with open(mp, "w", encoding="utf-8") as f:
            json.dump({"name": "t", "plugins": [
                {"name": "jstack-dev", "source": "./" + "/".join(depth)}]}, f)
    codex = os.path.join(tmp, "codex")
    os.makedirs(os.path.join(codex, "skills"), exist_ok=True)
    return root, os.path.join(bs, "install.py"), codex


def install(script, codex, *args):
    """Run install.py and return (rc, stdout)."""
    r = subprocess.run([sys.executable, script, "--codex-home", codex, *args],
                       capture_output=True, text=True)
    return r.returncode, r.stdout


# **A set of patterns for running an installation.** The previous version was `^\s*(brew|apt|npm|pip3?|uv|cargo)\s+install`
# It was a single line — it is attached to the beginning of the line and must be followed by an administrator and `install` for it to work. hostility
# Verification put in one line `uv tool install` (token in between) and received an abstract. actually
# Other forms of changing the machine include `npm i -g`, `sudo <pkg> install`,
# `brew reinstall`, `curl ... | There is sh` and it can appear anywhere on the line.
INSTALL_PATTERNS = (
    r"\b(brew|apt|apt-get|dnf|yum|pacman|apk|port|snap|choco|winget|npm|pnpm"
    r"|yarn|pip|pip3|uv|cargo|gem|nix-env|asdf|mise)\b[^\n]{0,24}"
    r"\b(install|reinstall)\b",
    r"\b(npm|pnpm|yarn)\s+(i|add)\b",
    r"\bsudo\b[^\n]{0,24}\binstall\b",
    r"\b(curl|wget)\b[^\n|]*\|\s*(ba|z)?sh\b",
)


def installs_here(text):
    """Return machine-changing installation commands found in the text."""
    return [m.group(0) for p in INSTALL_PATTERNS for m in re.finditer(p, text)]


def says(text, sentence):
    """Match a complete sentence while ignoring line breaks and repeated spaces.

    A fragment needle survives negation: ``silent downgrade`` is still present
    in ``is not a silent downgrade``. Measuring subject and predicate together
    catches that reversal while tolerating paragraph reflow.
    """
    return " ".join(sentence.split()) in " ".join(text.split())


def table(text, head):
    """Return all cells below `## head`, excluding the header and divider.

    ``rows()`` returns only the first cell. Full rows are required to compare
    the documented code-to-meaning mapping with observed behavior.
    """
    if head not in text:
        return []
    body = text.split(head, 1)[1].split("\n## ", 1)[0]
    out = []
    for line in body.splitlines():
        t = line.strip()
        if not t.startswith("|") or set(t) <= set("|- "):
            continue
        out.append([c.strip() for c in t.strip("|").split("|")])
    return out[1:]


def literal_of(pattern):
    """Derive a literal sample that actually matches the regex, or return None.

    Synthetic fixtures derive their strings from the rules so rule and sample
    cannot drift independently. Verify the derivation with ``re.search``.
    """
    alt = pattern.split("|")[0]
    lit = re.sub(r"\(\?<[=!][^)]*\)", "", alt)      # Remove lookbehind.
    lit = re.sub(r"\\(.)", r"\1", lit)               # \( -> (
    return lit if lit and re.search(pattern, lit, re.I) else None


# **Original list of rules.json.** If you just count the numbers, it will not be revealed even if the rules change.
# If you create a fixture in rules.json, **the check itself will disappear** when you empty the file.
# (Not failure, but evaporation) The floor value is filled for free. So here is the expectations list
# Write it down, make the fixtures into this list, and compare them all with rules.json.
EXPECT_BLOCKERS = [
    r"Task\(",
    "subagent_type",
    "AskUserQuestion",
    "ExitPlanMode|EnterPlanMode",
    "mcp__claude|claude-in-chrome",
    "oh-my-claudecode",
]
EXPECT_SUBS = [
    (r"CLAUDE\.md", "AGENTS.md"),
    (r"~/\.claude/settings\.local\.json", "~/.codex/config.toml"),
    (r"~/\.claude/settings\.json", "~/.codex/config.toml"),
    (r"\.claude/settings\.local\.json", "~/.codex/config.toml"),
    (r"\.claude/settings\.json", "~/.codex/config.toml"),
    (r"~/\.claude/skills", "~/.codex/skills"),
    (r"~/\.claude/plugins", "~/.codex/plugins"),
    ("`skillOverrides`", "`[[skills.config]]` (config.toml, path + enabled)"),
    ("`/plugin`", '`config.toml` 의 `[plugins."<name>"]`'),
    ("/plugin marketplace add", "config.toml 의 [marketplaces.*] 항목 추가"),
    ("(?<!Generated with )Claude Code", "Codex"),
    ("Claude가 ", "Codex가 "),
    ("Claude는 ", "Codex는 "),
]


def install_block(rec):
    """Extract canonical install-command lines from the reference code fence."""
    if "**Install (state 2)**" not in rec:
        return []
    parts = rec.split("**Install (state 2)**", 1)[1].split("```")
    body = parts[1] if len(parts) > 1 else ""
    out = []
    for line in body.splitlines():
        t = line.split("#")[0].strip()
        if t and t != "bash":
            out.append(t)
    return out


def lock_of(codex):
    """Read the install lockfile, returning an empty dict when absent or invalid."""
    p = os.path.join(codex, "skills", ".jstack-bridge.json")
    try:
        with open(p, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def counted(out, label):
    """Read `<label> <count>` from a report; return -1 to distinguish absence."""
    m = re.search(label + r"\s+(\d+)", out)
    return int(m.group(1)) if m else -1


def main():
    fm, skill = split_frontmatter(read(os.path.join(ROOT, "SKILL.md")))
    rec = read(os.path.join(ROOT, "references", "probe-recipes.md"))
    probe_src = read(PROBE)

    # (1) Three states
    st = rows(skill, "## Three states, not two")
    check('Status: exit code table has three rows', len(st) == 3, f"{len(st)} rows")
    check('Status: Boolean flagged as wrong shape',
          '"Installed or not" is the wrong shape' in skill)
    check('Status: Gives a real-world example of partial availability',
          "not authenticated" in skill or "runtime is missing" in skill)
    check('Status: Code 1 Identifies the reason for the existence of this protocol',
          "Code 1 is the one that earns the convention" in skill)
    check('Status: Reveal what Boolean hides',
          "exactly which capability is missing" in skill)

    # (2) Do not install instead — actual measurements
    check('Installation: Instead, they criticize you for not installing it.',
          "Never install on the user's behalf" in skill)
    check('Installation: Instructs to print commands but not execute them',
          "Print the command; do not run it" in skill)
    check('Installation: Reveal rationale (machine change not scoped by session)',
          "this session did not scope" in skill)
    # (D) `"is not guidance"` erases "... is not guidance" and replaces "is guidance"
    # Even if it was left behind, it was a living piece. Measure the subject and predicate together.
    check('Installation: Guidance without commands is not guidance.',
          says(skill, "The output on exit 2 is the install command, in full, "
                      "ready to paste.")
          and says(skill, 'Guidance that says "install X" without the command '
                          'is not guidance.'))
    # (C6) One-line regular expression broke into `uv tool install` — admin and `install`
    # Even if there is only one token in between, or it is not the head of a line, it passes. With a set of patterns
    # Expand, **apply the same set to the text** (C12): The text uses the installation command as an example.
    # For example, the contract of “printing but not executing” breaks down within the text.
    hit = installs_here(probe_src)
    check('Installation: No installation execution in script (pattern set)', not hit, f"{hit}")
    hit = installs_here(skill)
    check('Installation: There is no installation command in the text (voice needle)', not hit, f"{hit}")
    # The negative test passes even if the object is empty — it tests separately whether the set itself is alive.
    caught = [p for p in ("uv tool install x", "npm i -g x", "sudo dnf install x",
                          "brew reinstall x", "curl -fsSL u | sh")
              if not installs_here(p)]
    check('Install: pattern set catches five real install forms', not caught,
          f"missed {caught}")

    rc, out = probe("definitely-not-a-real-binary-xyz",
                    "--install", "brew install example")
    check('Actual measurement: Absence is code 2', rc == 2, f"rc={rc}")
    check('Actual measurement: Code 2 prints the full text of the installation command', "brew install example" in out, out.strip())
    rc, out = probe("bash")
    check('Ground truth: Available is code 0', rc == 0, f"rc={rc}")
    check('Actual measurement: Code 0 outputs nothing', out.strip() == "", repr(out))
    rc, out = probe("bash", "--auth", "false")
    check('Actual measurement: No authentication is code 1 (neither 0 nor 2)', rc == 1, f"rc={rc}")
    check('Ground truth: Code 1 indicates missing function', "unauthenticated" in out, out.strip())

    # (C1) **Authentication success path.** If only the failure path is measured, `--auth` will always return 1.
    # Abstract — measure separately whether the authentication axis does not prevent success.
    rc_auth_ok, out_auth_ok = probe("bash", "--auth", "true")
    check('Ground truth: Authentication success stub is code 0 (authentication axis does not prevent success)',
          rc_auth_ok == 0, f"rc={rc_auth_ok} {out_auth_ok.strip()[:40]}")
    check('Ground truth: Authentication success and failure have different codes (0 to 1)',
          rc_auth_ok == 0 and rc == 1, f"success rc={rc_auth_ok} failure rc={rc}")

    # (C8) **State 0 silence is measured independently of rc.** A test that expects `rc == 0`
    # It passes even in empty scripts and does not fall into deletion regression. So the path to success is
    # stdout is **exactly empty**, and the same script says **in states 1 and 2.
    # grouping ** into one decision — “always quiet” (= doing nothing)
    # Do not mistake script) for silence. Please refer to the document page below of the contract.
    # "State 0 printing nothing is deliberate." It's a sentence.
    quiet = [a for a in (("bash",), ("bash", "--auth", "true"),
                         ("bash", "--floor", "1.0"),
                         ("bash", "--floor", "1.0", "--auth", "true"))
             if probe(*a)[1] != ""]
    speaks = out.strip() != "" and probe("definitely-not-a-real-binary-xyz",
                                         "--install", "brew install example")[1].strip() != ""
    check('actual measurement: stdout of success path net is exactly empty and states 1·2 say',
          not quiet and speaks, f"noisy success paths {quiet} / states 1 and 2 speak {speaks}")

    # (K) **Code and code are paired.** Measure by the cover, not the text — `[1] `·`[2] ` —
    # The text is legitimately translated and transcribed, but the cover is a contract that the caller parses.
    rc0, o0 = probe("bash")
    rc1, o1 = probe("bash", "--auth", "false")
    rc2, o2 = probe("definitely-not-a-real-binary-xyz", "--install", "brew install example")
    check('Actual: Status marker matches code (0 no output · 1 is `[1] ` · 2 is `[2] `)',
          (rc0, o0) == (0, "") and rc1 == 1 and o1.startswith("[1] ")
          and rc2 == 2 and o2.startswith("[2] "),
          f"{rc0}{o0[:6]!r} {rc1}{o1[:6]!r} {rc2}{o2[:6]!r}")

    # (A) **Document table ↔ Script actual operation intersection.** Not whether the sentence is in the text,
    # In the text, check whether the **parsed mapping** is attached to the same location as the actual code.
    # If you swap two rows of the table (all strings are alive), they turn red here.
    doc_states = {c[0]: " ".join(c[1:]) for c in table(skill, "## Three states, not two")}
    cross = [(rc0, "Fully available", "Proceed"),
             (rc1, "Partially available", "reduced path"),
             (rc2, "Blocked", "install guidance")]
    bad = [(c, w) for c, w, a in cross
           if w not in doc_states.get(str(c), "") or a not in doc_states.get(str(c), "")]
    check('Intersection: The row in the exit code table is attached to the code that probe.sh actually emits.',
          not bad and len(doc_states) == 3,
          f"mismatches {bad} / table {sorted(doc_states)}")

    # **Check on exit status, not empty status.** After merging stderr
    # If you split it by whether it's empty or not, you'll never be able to reach the runtime broken branch, and there's no `-version` fallback either.
    # It is short-circuited (second review verified). Both paths are actually followed by stubs.
    with tempfile.TemporaryDirectory() as tmp:
        broken = os.path.join(tmp, "brokentool")
        with open(broken, "w", encoding="utf-8") as f:
            f.write('#!/usr/bin/env bash\n'
                    'echo "dyld[1]: Library not loaded: @rpath/libx.dylib" >&2\n'
                    'exit 127\n')
        os.chmod(broken, 0o755)
        rc, out = probe("brokentool", "--install", "brew reinstall brokentool",
                        path_extra=tmp)
        check('Actual measurement: If the binary exists but execution is killed, code 2 (not 0)',
              rc == 2, f"rc={rc} {out.strip()[:60]}")
        check('ground truth: The diagnosis points to runtime dependence', "runtime dependency" in out)

        # **Patch level lower bound.** A sed multi-expression concatenates the versions, resulting in "1.2.3".
        # When it becomes "1.2.31.2.3", the field comparison is misaligned and the patch level is completely ignored.
        # (5th review verification: --floor 2.46.1 passed in git 2.46.0).
        pt = os.path.join(tmp, "patchy")
        with open(pt, "w", encoding="utf-8") as f:
            f.write('#!/usr/bin/env bash\necho "patchy 1.2.3"\n')
        os.chmod(pt, 0o755)
        rc, _ = probe("patchy", "--floor", "1.2.4", path_extra=tmp)
        check('Actual measurement: Patch level lower limit is applied (1.2.3 < 1.2.4)', rc == 2, f"rc={rc}")
        rc, _ = probe("patchy", "--floor", "1.2.3", path_extra=tmp)
        check('Ground truth: Same patch level passes', rc == 0, f"rc={rc}")

        # dyld incompatibility contains the **regular** phrase "requires version X" —
        # Context rules cannot tell. Availability is determined only by termination status.
        dy = os.path.join(tmp, "toola")
        with open(dy, "w", encoding="utf-8") as f:
            f.write('#!/usr/bin/env bash\ncat >&2 <<E\n'
                    'dyld: Library not loaded: /usr/local/lib/libfoo.dylib\n'
                    '  Reason: Incompatible library version: toola requires '
                    'version 10.0.0 or later, but libfoo.dylib provides version 9.0.0\n'
                    'E\nexit 134\n')
        os.chmod(dy, 0o755)
        rc, out = probe("toola", "--install", "brew reinstall toola", path_extra=tmp)
        check('Ground truth: dyld incompatible regular phrase has code 2', rc == 2, f"rc={rc}")

        # Error logs that begin with a timestamp also have a version context.
        lg = os.path.join(tmp, "logtool")
        with open(lg, "w", encoding="utf-8") as f:
            f.write('#!/usr/bin/env bash\n'
                    'echo "2024-01-15 ERROR: cannot load module libx" >&2\nexit 1\n')
        os.chmod(lg, 0o755)
        rc, _ = probe("logtool", path_extra=tmp)
        check('Ground truth: Timestamp error log does not act as a copy', rc == 2, f"rc={rc}")

        # Tool with exit 0 without output. Availability is determined as terminated, so it is **Available**
        # (The tool turns). However, if you use `--floor`, the version cannot be read and is blocked —
        # By nailing the two movements into a contract, it will be revealed even if it is flipped next time (6th review).
        si = os.path.join(tmp, "silenttool")
        with open(si, "w", encoding="utf-8") as f:
            f.write("#!/usr/bin/env bash\nexit 0\n")
        os.chmod(si, 0o755)
        rc, _ = probe("silenttool", path_extra=tmp)
        check('Ground truth: A tool with exit 0 and no output is available.', rc == 0, f"rc={rc}")
        rc, out = probe("silenttool", "--floor", "1.0", path_extra=tmp)
        check('Actual measurement: If you set a lower limit on the tool, it will not be able to read the version and will be blocked.',
              rc == 2 and "cannot read silenttool version" in out,
              f"rc={rc} {out.strip()[:50]}")

        # A tool that outputs the version normally even though `--version` is exit 1. Only in shutdown state
        # If you split, this path dies (3rd review).
        e1 = os.path.join(tmp, "exit1tool")
        with open(e1, "w", encoding="utf-8") as f:
            f.write('#!/usr/bin/env bash\necho "toolz 3.4.5"\nexit 1\n')
        os.chmod(e1, 0o755)
        rc, out = probe("exit1tool", path_extra=tmp)
        # **Known limitation.** This tool is blocked because availability is determined to be closed.
        # In return, dyld, traceback, and timestamps are all closed — the exchange ratio is correct.
        check('Ground truth: output version, but tools with exit 1 are blocked (known limitation)',
              rc == 2, f"rc={rc}")

        # The preceding bait token. 3.9 in “Python 3.9 wrapper for X version 10.2.0”
        # When I pick it up, 10.2.0 is installed, but it is at the lowest limit (3rd review).
        dd = os.path.join(tmp, "dottydecoy")
        with open(dd, "w", encoding="utf-8") as f:
            f.write('#!/usr/bin/env bash\n'
                    'echo "Python 3.9 wrapper for dottydecoy version 10.2.0"\n')
        os.chmod(dd, 0o755)
        rc, out = probe("dottydecoy", "--floor", "10.0.0", path_extra=tmp)
        check('Actual measurement: Pick up the actual version, not the previous decoy token.', rc == 0,
              f"rc={rc} {out.strip()[:60]}")

        java = os.path.join(tmp, "javaish")
        with open(java, "w", encoding="utf-8") as f:
            f.write('#!/usr/bin/env bash\n'
                    '[ "$1" = "-version" ] && { echo "openjdk version 17.0.9"; exit 0; }\n'
                    'echo "Unrecognized option: --version" >&2\nexit 1\n')
        os.chmod(java, 0o755)
        rc, out = probe("javaish", "--floor", "11", path_extra=tmp)
        check('Ground truth: tools that only accept `-version` also read the version (fallbacks are included)',
              rc == 0, f"rc={rc} {out.strip()[:60]}")

    # **Argument parser.** `shift 2` does nothing if there is 1 argument remaining and returns 1.
    # Returns — Without `set -e`, the loop ran forever (6th review actual measurement rc=142).
    # And swallowing the typo flag, `--flooor 99` was rc=0: one-character version
    # The lower limit disappears entirely. “Not responding” is worse than any exit code.
    for args, why in ((["git", "--floor"], "--floor without a value"),
                      (["git", "--auth"], "--auth without a value"),
                      (["git", "--install"], "--install without a value")):
        r = subprocess.run(["bash", PROBE, *args], capture_output=True,
                           text=True, timeout=10)
        check(f"Ground truth: {why} returns code 2 without hanging", r.returncode == 2,
              f"rc={r.returncode}")
    rc, out = probe("git", "--flooor", "99.0.0")
    check('actual measurement: do not swallow unknown flags, code 2', rc == 2, f"rc={rc}")
    rc, out = probe("git", "extra-arg")
    check('Actual measurement: If there are more than two arguments, code 2', rc == 2, f"rc={rc}")

    # (3) Version comparison is numerical — if it was a string comparison, this would be wrong.
    with tempfile.TemporaryDirectory() as tmp:
        d = stub(tmp, "verstub", "verstub 10.0.0")
        rc, out = probe("verstub", "--floor", "9.0.0", path_extra=d)
        check('ground truth: 10.0.0 passes the lower bound 9.0.0 (failure if string comparison)',
              rc == 0, f"rc={rc} {out.strip()}")
        rc, out = probe("verstub", "--floor", "10.1.0", path_extra=d)
        check('ground truth: 10.0.0 falls on the lower bound of 10.1.0', rc == 2, f"rc={rc}")
        rc, out = probe("verstub", "--floor", "10.0.0", path_extra=d)
        check('Ground truth: identical versions pass the lower bound', rc == 0, f"rc={rc}")

        # (C7) Of the three tests above, two of the passing directions **pass even in empty scripts**
        # (bash gives rc 0 for empty files). So the numerical comparison axis is deleted and in regression
        # Not a single case was caught. Measure the blocking direction together at the same location.
        d9 = stub(tmp, "verstub9", "verstub9 9.0.0")
        rc, out = probe("verstub9", "--floor", "10.0.0", path_extra=d9)
        check('ground truth: 9.0.0 falls on the lower limit of 10.0.0 (opposite direction of passage)',
              rc == 2, f"rc={rc} {out.strip()[:50]}")
        # **Second position where string comparison is wrong** — 9 to 10 in the minor version.
        # `2.9.0 >= 2.10.0` is true in alphabetical order, so awk number comparison is disabled.
        # It only differs here. The 10 to 9 above is the first field, so there are several ways to handle it.
        dm = stub(tmp, "minorstub", "minorstub 2.9.0")
        rc, out = probe("minorstub", "--floor", "2.10.0", path_extra=dm)
        check('Actual: 2.9.0 falls on the lower bound of 2.10.0 (string comparison passes)',
              rc == 2, f"rc={rc} {out.strip()[:50]}")
        dM = stub(tmp, "minorstub2", "minorstub2 2.10.0")
        rc, out = probe("minorstub2", "--floor", "2.9.0", path_extra=dM)
        check('Ground truth: 2.10.0 passes the lower bound 2.9.0 (its counterpart)',
              rc == 0, f"rc={rc} {out.strip()[:50]}")
    check('version: Document requires numerical comparison by field',
          says(rec, "Compare versions numerically, field by field."))
    check('version: Specifies when string comparison fails',
          says(rec, "String comparison puts 10 before 9, which fails exactly "
                    "once — at the release that matters most."))
    check('version: Requires lower bounds to be placed only on measured incompatibilities',
          says(rec, "Record a floor only where a real incompatibility was "
                    "observed, and record what was observed next to it."))
    check('version: Revealing what a made-up lower limit prevents\nAt ',
          says(rec, "A floor invented for safety silently blocks working "
                    "environments, and nobody can tell later whether it was "
                    "measured or guessed."))

    # (4) Probe at point of use
    check('Bulk inspection is prohibited at startup',
          "not at startup" in skill)
    check('viewpoint: Revealing the two costs of bulk inspection',
          says(skill, "Checking everything up front makes every session pay for "
                      "tools that session will not touch, and the check goes "
                      "stale the moment the environment changes."))

    # (5) Reduction, naming what has been lost
    # (M) All three fragments survive the insertion of negative words — “is not a silent downgrade”
    # “silent downgrade” is still there. Change it sentence by sentence.
    check('downsizing: not disclosing the downsizing means a quiet demotion',
          says(skill, "A reduced path that does not say it is reduced is a "
                      "silent downgrade"))
    check('Zoom Out: User Reveals That He Reads It All As Money',
          says(skill, "and the user reads the output as if the full tool ran."))
    check('Reduction: Eliminate meaningless expressions like ‘restricted mode’',
          says(skill, 'Say which capability is gone and what that means for the '
                      'result — not "running in limited mode", which names nothing.'))
    ph = rows(rec, "## Phrasing per state")
    check('Degradation: per-state wording table has three rows', len(ph) == 3,
          f"{len(ph)} rows")
    check('Collapse: state 0 states that silence is intent',
          says(rec, "State 0 printing nothing is deliberate."))
    check('Reduction: When notified every time, status 1 is not read.',
          says(rec, "A probe that announces success on every call trains the "
                    "reader to skip its output, and then state 1 goes unread too."))
    # (B) Matches the expression table with **line-level literals**. If the lines are reversed, the above sentences
    # They are all alive, but the votes are directed against them.
    ph_t = {c[0]: " ".join(c[1:]) for c in table(rec, "## Phrasing per state")}
    check("Expression: Status 0 line is 'do not say anything'",
          ph_t.get("0", "").startswith("Nothing"), ph_t.get("0", ""))
    check('Expression: Status 1 line tells you what functionality is missing',
          "Which capability is unavailable" in ph_t.get("1", ""), ph_t.get("1", ""))
    check('Expression: Status line 2 requires exact installation command\nWrapping ',
          "the exact install command" in ph_t.get("2", ""), ph_t.get("2", ""))

    # (6) Do not wrap tools
    check('Reveals that it will be a second interface\nWrapping ',
          says(skill, "When it starts reformatting arguments, reordering flags, "
                      "or re-implementing a subcommand, it has become a second "
                      "interface to maintain"))
    check('Reveals that it is against the next release',
          says(skill, "it will drift from the first one on the tool's next release."))
    check('wrapping: Instructs to pass the argument as is.',
          says(skill, "Pass the user's arguments through."))
    check('Instructs the tool not to substitute its own error message.',
          says(skill, "If the tool's own error message is the clearest thing "
                      "available, show it rather than replacing it with a "
                      "friendlier one that says less."))

    # (7) Probe intensity table
    ch = rows(rec, "## The shape")
    check('Strength: probe-strength table has four rows', len(ch) == 4,
          f"{len(ch)} rows")
    check('Intensity: The lower you go, the stronger and slower it becomes.',
          "strictly stronger" in rec and "strictly slower" in rec)
    check('Strength: Instructs to choose the weakest validation',
          "weakest check that would actually catch" in rec)
    check('Strength: Expensive Probe Reveals Eventually Removal',
          "gets removed by whoever is\ndebugging" in rec
          or "gets removed by whoever is debugging" in rec)
    # (L) Just having 4 rows does not lock the **order**. The intensity table is above.
    # The content itself is what gets stronger downwards, so if you flip the line, it says "The weakest test
    # The instruction “Choose” means the exact opposite.
    sh_t = table(rec, "## The shape")
    check('Strength: The first line is the PATH resolution and the last line is the authentication call (order is strength)',
          len(sh_t) == 4 and "PATH" in sh_t[0][0] and "installed" in sh_t[0][1]
          and "authenticated call" in sh_t[3][0] and "quota" in sh_t[3][2],
          f"{[r[0] for r in sh_t]}")
    check('Certification: Reveals that certification and installation are in different states',
          "Authentication is not installation" in rec)
    # (C13) There was not a single needle in the gh work example clause — even if the clause was deleted entirely,
    # Nothing was red. Lock status 1 row and "Reinstallation is not the answer".
    check("gh Example: State 1 states 'binary exists, no authentication'",
          says(rec, "binary resolves, `gh auth status` returns non-zero"))
    check('gh example: Explain the reason for setting non-authentication to 1 instead of 2',
          says(rec, "Signed-out is state 1, not 2, because a caller can still "
                    "run on the reduced path"))
    gh_t = {c[0]: c[-1] for c in table(rec, "## `gh` — the worked example")}
    check('gh Example: Ready/Signed out/Absent are 0/1/2 respectively\nCross ',
          (gh_t.get("Ready"), gh_t.get("Signed out"), gh_t.get("Absent"))
          == ("0", "1", "2"), f"{gh_t}")
    # (Q) **The original installation commands live only in one place.** Guide to the 4 lines of the document and hooks
    # Actually collating the strings — if either of them changes, this is where they diverge.
    cmds = install_block(rec)
    hook_src = read_or_empty(HOOK)
    drift = [c for c in cmds if c not in hook_src]
    check('The four canonical installation commands match the instructions in validate_pr_label.py',
          len(cmds) == 4 and not drift and bool(hook_src),
          f"{len(cmds)} lines / missing from hook {drift}")
    check('Certification: Reveals the consequences of misclassification (reinstalling something that is not the problem)',
          "never\nthe problem" in rec or "never the problem" in rec)

    # (8) Boundaries/language
    named = set(re.findall(r"`([a-z][a-z-]{2,})`\s*skill", skill))
    missing = [n for n in named if not os.path.isdir(os.path.join(SKILLS, n))]
    check('boundary: Return target population is not empty', len(named) >= 2, f"{sorted(named)}")
    check('Boundary: every named return target exists', not missing,
          f"missing {missing}")
    check('Language: description has Korean trigger',
          len(re.findall(r"[가-힣]+", fm)) >= 5)
    check('Language: English also has trigger', "ensure" in fm and "CLI" in fm)
    # L0 also states a contract — if you step back here, you are already wrong before reading the text.
    check('L0: description declares these three states',
          "three availability states" in fm)
    check('L0: description instead declares not to install',
          "instead of installing anything" in fm)

    # (9) Installation script — Measure the set designated by the director as P0.
    # All three are "quietly wrong": the output is plausible and the exit code is 0.
    check('Installation: SKILL.md quotes script',
          "`scripts/install.py`" in skill and "`scripts/rules.json`" in skill)
    check('Installation: The text nails the root decision rule.',
          "found by marker, not by path arithmetic" in skill)
    check('Installation: Reveals the result of path arithmetic (deletes the installer)',
          "deletes the installed skills while reporting success" in skill)
    check('Installation: The text nails the self-exclusion standard',
          "excludes itself by skill directory, not by plugin name" in skill)
    check('Installation: Token dies on link',
          "does not survive a symlink" in skill)
    check('Installation: Checks runtime references and scripts as well as top-level body',
          "Classification covers the runtime tree, not only `SKILL.md`" in skill)
    check('Installation: The global skill of the same name is said not to cover either side.\nInstall ',
          "If two plugins provide the same skill name, neither\nmay overwrite the other" in skill
          or "If two plugins provide the same skill name, neither may overwrite the other" in skill)
    check('Replace the link after proving ownership with a lock and independence symbol.\nInstall ',
          "matches the lock record to the link target or the\ngenerated-file header" in skill
          or "matches the lock record to the link target or the generated-file header" in skill)
    check('Preserve user-owned links',
          "A user-owned link is preserved" in skill)
    check('Installation: Ensure that quoted strings are not subject to replacement.\nInstall ',
          "Substitution is for notation, never for a quoted literal" in skill)
    check('Reveal the consequences of citation substitution (document-validator mismatch)',
          "keeps enforcing the original" in skill)

    with tempfile.TemporaryDirectory() as tmp:
        root, script, codex = marketplace(tmp, {
            "bridge": FM.format(n="bridge", b="This skill probes and hands back."),
            "gitrules": FM.format(
                n="gitrules",
                b="**Never include** `Generated with Claude Code` in a message.\n"
                  "Run `${CLAUDE_PLUGIN_ROOT}/skills/gitrules/scripts/check.py` first."),
            "plain": FM.format(n="plain", b="Claude Code is the host. See CLAUDE.md."),
            "linky": FM.format(n="linky", b="Nothing host-specific lives here."),
            "agenty": FM.format(n="agenty", b="Delegate with subagent_type=explore."),
        })
        rc, out = install(script, codex)
        dest = os.path.join(codex, "skills")
        got = sorted(n for n in os.listdir(dest) if not n.startswith("."))
        gitr = read_or_empty(os.path.join(dest, "gitrules", "SKILL.md"))
        plainr = read_or_empty(os.path.join(dest, "plain", "SKILL.md"))

        # P0-1 — Marker up search. The path arithmetic board traverses the different trees in this arrangement.
        check('Ground truth: Marker lookup finds marketplace roots even in deep deployments',
              root in out and "link" in out, out.strip()[:70])
        # P0-2 — Self-exclusion to skill directory. Based on the plugin name, bridge comes in.
        check('Ground truth: does not install itself',
              got == ["gitrules", "linky", "plain"], f"{got}")
        check('Actual measurement: Report self-exclusion with reasons',
              "the skill that owns this installer" in out, out.strip()[-70:])
        # P0-3 — ${CLAUDE_PLUGIN_ROOT} dies on link.
        check('Fact: Skills with tokens are not links, but substitution copies.',
              not os.path.islink(os.path.join(dest, "gitrules")) and bool(gitr))
        check('Ground truth: Tokens are replaced with absolute paths',
              "${CLAUDE_PLUGIN_ROOT}" not in gitr
              and os.path.join(root, "staging", "jstack-dev") in gitr,
              gitr.strip()[-70:])
        # rules.json — Quoted prohibited strings remain as is.
        check('Ground truth: quoted prohibited strings are not replaced',
              "Generated with Claude Code" in gitr, gitr.strip()[-70:])
        check('Actual measurement: Notations outside quotations are replaced',
              "Codex is the host" in plainr and "AGENTS.md" in plainr,
              plainr.strip()[-60:])
        check('Actual measurement: Skills with no replacement are symbolic links',
              os.path.islink(os.path.join(dest, "linky")))
        # The three state conventions also apply to this script.
        check('Actual measurement: If there is a blocked skill, the code is 1 (neither 0 nor 2)',
              rc == 1, f"rc={rc}")
        check('Ground truth: Report blocked reason with name',
              "agenty" in out and "subagent selection differs" in out)

    # If the self-exclusion is a **name literal**, it is reversed here: the script
    # It lives in `agent-bridge`, and the name of the neighboring skill that needs to be installed is `bridge`.
    with tempfile.TemporaryDirectory() as tmp:
        _root, script, codex = marketplace(tmp, {
            "agent-bridge": FM.format(n="agent-bridge", b="Owns the installer."),
            "bridge": FM.format(n="bridge", b="A neighbour that happens to be named so."),
        }, owner="agent-bridge")
        rc, out = install(script, codex)
        got = sorted(n for n in os.listdir(os.path.join(codex, "skills"))
                     if not n.startswith("."))
        check('Actual measurement: Even if the name of the skill holding the script is different, it excludes itself.',
              got == ["bridge"], f"{got}")
        check('Ground truth: Then the neighbor named bridge is installed.',
              os.path.lexists(os.path.join(codex, "skills", "bridge")) and rc == 0,
              f"rc={rc}")
        # (X) The **criteria** (skill directory, not the plugin name) mentioned in the text is
        # Is it the same as the actual measured behavior? If it is name-based, `got` above becomes an empty list.
        check('Intersection: Self-exclusion — The standard (directory) declared in the text is the same as the actual measurement',
              says(skill, "The installer excludes itself by skill directory, "
                          "not by plugin name.") and got == ["bridge"], f"{got}")

    # Retrieval Guard — The most expensive mistake in this script is “nothing found”.
    # It is read as “all gone.” Recovery of all lock files cannot be reversed.
    with tempfile.TemporaryDirectory() as tmp:
        root, script, codex = marketplace(tmp, {
            "bridge": FM.format(n="bridge", b="Only this skill exists here."),
        })
        dest = os.path.join(codex, "skills")
        os.makedirs(os.path.join(dest, "oldskill"))
        with open(os.path.join(dest, "oldskill", "SKILL.md"), "w") as f:
            f.write("x")
        lock_path = os.path.join(dest, ".jstack-bridge.json")
        with open(lock_path, "w", encoding="utf-8") as f:
            json.dump({"jstack-dev:oldskill": {"mode": "link"}}, f)
        rc, out = install(script, codex)
        check('Actual measurement: If the scan is empty and the lock file is full, it is not retrieved and code 2 is returned.',
              rc == 2, f"rc={rc}")
        check('Actual measurement: The installation version survives then',
              os.path.isdir(os.path.join(dest, "oldskill")))
        check('Actual measurement: Then the lock file is preserved.',
              json.load(open(lock_path, encoding="utf-8")) == {
                  "jstack-dev:oldskill": {"mode": "link"}})
        # (W) **Confront the claims in the text with actual facts.** It is not whether there is a string, but whether the text is
        # In a situation where you claim to “not collect,” is it actually not collected?
        # Ask for it together — even if only one side is turned over, it turns red.
        doc_refuses = says(skill, "refuses to reclaim anything when an empty "
                                  "scan meets a non-empty lockfile.")
        live_refuses = rc == 2 and os.path.isdir(os.path.join(dest, "oldskill"))
        check("Intersection: Retrieval Guard — Both the text claim and the ground truth behavior are 'not retrieval'",
              doc_refuses and live_refuses,
              f"document {doc_refuses} / observed {live_refuses}")

    # If there is no marker, it stops instead of quietly taking the wrong route.
    with tempfile.TemporaryDirectory() as tmp:
        _root, script, codex = marketplace(
            tmp, {"bridge": FM.format(n="bridge", b="x")}, with_marker=False)
        rc, out = install(script, codex)
        check('Actual measurement: If there is no marker, code 2 (does not take wrong route)',
              rc == 2 and "Marketplace root not found" in out, f"rc={rc}")

    # Target absence and dry-run.
    with tempfile.TemporaryDirectory() as tmp:
        _root, script, codex = marketplace(tmp, {
            "bridge": FM.format(n="bridge", b="x"),
            "linky": FM.format(n="linky", b="Nothing host-specific lives here."),
        })
        rc, out = install(script, os.path.join(tmp, "no-such-home"))
        check('Actual measurement: Code 2 if Codex skills directory does not exist',
              rc == 2 and "Codex skills directory does not exist" in out, f"rc={rc}")
        rc, out = install(script, codex, "--dry-run")
        left = sorted(n for n in os.listdir(os.path.join(codex, "skills")))
        check('actual measurement: dry-run does not install anything',
              left == [] and "dry-run" in out, f"{left}")

    # (C2·C3·C10) **Executes the contents of rules.json.** The previous version has the lower number limit and
    # I only checked whether it compiled — even if I changed one rule to an empty pattern, the `to` was incorrect.
    # Even if I changed the value, nothing turned red. Synthesis with samples planted for each rule
    # Build your skills **run the actual installation** and compare all 6 types of blocker and 13 types of replacement.
    #
    # Fixtures are created from `EXPECT_*` (a canonical list of what the suite has). In rules.json
    # If you create it, when the file is emptied, the check does not fail but **disappears**, so it regresses to deletion.
    # The floor value is filled free of charge.
    with tempfile.TemporaryDirectory() as tmp:
        planted = {"bridge": FM.format(n="bridge", b="Owner of the installer.")}
        for i, pat in enumerate(EXPECT_BLOCKERS):
            planted[f"blk{i}"] = FM.format(
                n=f"blk{i}", b=f"Blocked sample {literal_of(pat) or 'NO-SAMPLE'} end.")
        for i, (frm, _to) in enumerate(EXPECT_SUBS):
            planted[f"sub{i}"] = FM.format(
                n=f"sub{i}", b=f"Notation sample {literal_of(frm) or 'NO-SAMPLE'} end.")
        _r, script, codex = marketplace(tmp, planted)
        rules_rc, rules_out = install(script, codex)
        rdest = os.path.join(codex, "skills")
        check('Actual measurement: If there is a skill with a blocking rule, it is code 1 (rule execution fixture)',
              rules_rc == 1, f"rc={rules_rc}")
        for i, pat in enumerate(EXPECT_BLOCKERS):
            lit = literal_of(pat)
            check(f"Rule execution: skill containing blocker pattern {pat} is blocked",
                  lit is not None and f"jstack-dev:blk{i}" in rules_out
                  and not os.path.lexists(os.path.join(rdest, f"blk{i}")),
                  f"sample {lit!r}")
        for i, (frm, to) in enumerate(EXPECT_SUBS):
            lit = literal_of(frm)
            body = read_or_empty(os.path.join(rdest, f"sub{i}", "SKILL.md"))
            after = body.split("-->", 1)[-1]      # Exclude the provenance header.
            check(f"Rule execution: substitution {frm} becomes {to} in output",
                  lit is not None and to in after and lit not in after,
                  f"sample {lit!r} / output {after.strip()[:50]!r}")

    # (C4) **The actual directory with the same name that is not in the lock belongs to someone else.** If overwritten, a person will have to manually
    # The skill you placed quietly disappears. Preserve it and measure whether it is skipped with a reason.
    with tempfile.TemporaryDirectory() as tmp:
        _r, script, codex = marketplace(tmp, {
            "bridge": FM.format(n="bridge", b="Owner of the installer."),
            "linky": FM.format(n="linky", b="Nothing host-specific lives here."),
        })
        ddir = os.path.join(codex, "skills", "linky")
        os.makedirs(ddir)
        with open(os.path.join(ddir, "SKILL.md"), "w", encoding="utf-8") as f:
            f.write("User-owned content.")
        keep_rc, keep_out = install(script, codex)
        check('Actual measurement: The real directory of the same name that is not in the lock is preserved without covering it.',
              read_or_empty(os.path.join(ddir, "SKILL.md")) == "User-owned content."
              and not os.path.islink(ddir), f"rc={keep_rc}")
        check('Actual measurement: Then report what was skipped with name and reason.',
              "jstack-dev:linky" in keep_out and "cannot prove bridge ownership" in keep_out,
              keep_out.strip()[-70:])

    # Symbolic links that are not in the lock are also your property. Just look at `islink()` and the bridge will be
    # If the link is assumed to be created, the external destination is quietly disconnected.
    with tempfile.TemporaryDirectory() as tmp:
        _r, script, codex = marketplace(tmp, {
            "bridge": FM.format(n="bridge", b="Owner of the installer."),
            "linky": FM.format(n="linky", b="Marketplace version."),
        })
        foreign = os.path.join(tmp, "user-owned-link-target")
        os.makedirs(foreign)
        with open(os.path.join(foreign, "SKILL.md"), "w", encoding="utf-8") as f:
            f.write("user-owned")
        dst = os.path.join(codex, "skills", "linky")
        os.symlink(foreign, dst)
        user_rc, user_out = install(script, codex)
        check('Ground truth: Do not replace user symbolic links that are not in lock.',
              user_rc == 0 and os.path.islink(dst)
              and os.path.realpath(dst) == os.path.realpath(foreign)
              and read_or_empty(os.path.join(dst, "SKILL.md")) == "user-owned",
              f"rc={user_rc} target={os.path.realpath(dst)}")
        check('Ground truth: Report reasons for preserving user links',
              "jstack-dev:linky" in user_out and "cannot prove bridge ownership" in user_out)

    # Even if the top level is clean, if there is a substitution or blocker in the reference, installation is judged.
    with tempfile.TemporaryDirectory() as tmp:
        root, script, codex = marketplace(tmp, {
            "bridge": FM.format(n="bridge", b="Owner of the installer."),
            "dep-rewrite": FM.format(n="dep-rewrite", b="Read references/guide.md."),
            "dep-block": FM.format(n="dep-block", b="Read references/guide.md."),
        })
        base = os.path.join(root, "staging", "jstack-dev", "skills")
        for name, body in (("dep-rewrite", "Follow CLAUDE.md."),
                           ("dep-block", "Use subagent_type=explore.")):
            refdir = os.path.join(base, name, "references")
            os.makedirs(refdir)
            with open(os.path.join(refdir, "guide.md"), "w", encoding="utf-8") as f:
                f.write(body)
        dep_rc, dep_out = install(script, codex)
        dep_dst = os.path.join(codex, "skills", "dep-rewrite")
        guide = read_or_empty(os.path.join(dep_dst, "references", "guide.md"))
        check('Ground truth: Copy instead of link even if only the reference has a substitution token',
              not os.path.islink(dep_dst) and guide == "Follow AGENTS.md.")
        check('Actual measurement: The Claude-only meaning of the reference also pre-blocks the entire skill.',
              dep_rc == 1 and "jstack-dev:dep-block" in dep_out
              and "references/guide.md" in dep_out
              and not os.path.lexists(os.path.join(codex, "skills", "dep-block")),
              f"rc={dep_rc}")
        rec = lock_of(codex).get("jstack-dev:dep-rewrite", {})
        check('Ground truth: Write the tree hash containing the reference to the lock.',
              bool(re.fullmatch(r"[0-9a-f]{64}", rec.get("tree_sha256", ""))))
        with open(os.path.join(base, "dep-rewrite", "references", "guide.md"),
                  "a", encoding="utf-8") as f:
            f.write("\nMore guidance.\n")
        dep2_rc, dep2_out = install(script, codex)
        check('Actual measurement: Reference changes are captured as upstream updates even if the top-level text remains the same.',
              dep2_rc == 1 and counted(dep2_out, "updated") == 1,
              f"rc={dep2_rc} updated={counted(dep2_out, 'updated')}")

    # Even if there are spaces in the path, the token substitution result must be returned to the actual argv.
    with tempfile.TemporaryDirectory() as tmp:
        root, script, codex = marketplace(tmp, {
            "bridge": FM.format(n="bridge", b="Owner of the installer."),
            "runner": FM.format(
                n="runner",
                b=("python3 ${CLAUDE_PLUGIN_ROOT}/skills/runner/scripts/tool.py\n"
                   "bash \"${CLAUDE_PLUGIN_ROOT}/skills/runner/scripts/tool.sh\"")),
        })
        spaced_root = os.path.join(tmp, "market place")
        shutil.move(root, spaced_root)
        script = script.replace(root, spaced_root)
        tool_dir = os.path.join(spaced_root, "staging", "jstack-dev", "skills",
                                "runner", "scripts")
        os.makedirs(tool_dir)
        with open(os.path.join(tool_dir, "tool.py"), "w", encoding="utf-8") as f:
            f.write("print('SPACE_OK')\n")
        with open(os.path.join(tool_dir, "tool.sh"), "w", encoding="utf-8") as f:
            f.write("#!/bin/sh\nprintf 'QUOTED_OK\\n'\n")
        space_rc, _space_out = install(script, codex)
        installed = read_or_empty(os.path.join(codex, "skills", "runner", "SKILL.md"))
        commands = [line for line in installed.splitlines()
                    if line.startswith(("python3 ", "bash \""))]
        # In the deletion regression, if install.py/rules.json is empty, there is no installation copy and no commands.
        # That state is a state in which the three decisions below must fail, resulting in an IndexError.
        # The entire suite is not cut off and the floor value cannot be measured.
        py_run = (subprocess.run(shlex.split(commands[0]), capture_output=True, text=True)
                  if len(commands) > 0 else None)
        sh_run = (subprocess.run(shlex.split(commands[1]), capture_output=True, text=True)
                  if len(commands) > 1 else None)
        check('Actual measurement: unquoted token substitution command with empty root is actually executed',
              space_rc == 0 and py_run is not None and py_run.returncode == 0
              and py_run.stdout.strip() == "SPACE_OK",
              f"rc={py_run.returncode if py_run is not None else 'missing'}")
        check('Actual measurement: Existing quote token replacement commands in blank roots are also actually executed.',
              sh_run is not None and sh_run.returncode == 0
              and sh_run.stdout.strip() == "QUOTED_OK",
              f"rc={sh_run.returncode if sh_run is not None else 'missing'}")
        check('Ground truth: Blank root installation has no outstanding plugin root tokens',
              "${CLAUDE_PLUGIN_ROOT}" not in installed)

    # blocker `Task(` is the correct notation for the Claude tool. Ignoring case,
    # It even blocks `set_task(...)` of domain APIs such as PyHealth.
    with tempfile.TemporaryDirectory() as tmp:
        _root, script, codex = marketplace(tmp, {
            "bridge": FM.format(n="bridge", b="Owner of the installer."),
            "domain-api": FM.format(
                n="domain-api", b="samples = dataset.set_task(MortalityPrediction())"),
            "declared-tool": ("---\nname: declared-tool\n"
                              "allowed-tools:\n  - AskUserQuestion\n---\n\n"
                              "The body contains no harness-specific instruction.\n"),
        })
        domain_rc, domain_out = install(script, codex)
        check('Voice comparison: Lowercase set_task domain API is not blocked with the Claude Task tool.',
              domain_rc == 0
              and os.path.lexists(os.path.join(codex, "skills", "domain-api"))
              and "action required" not in domain_out.lower(),
              f"rc={domain_rc}")
        check('Voice contrast: Do not block frontmatter-allowed tool declarations with execution instructions.',
              domain_rc == 0
              and os.path.lexists(os.path.join(codex, "skills", "declared-tool")),
              f"rc={domain_rc}")

    # Skills/ in the Codex is the global plane. Cover with two sauces of the same name one by one and then rock.
    # It does not allow a two-man state and requires a living owner even in legacy ambiguous locks.
    # Make sure the recall step doesn't erase it.
    with tempfile.TemporaryDirectory() as tmp:
        root, script, codex = marketplace(
            tmp, {"bridge": FM.format(n="bridge", b="Owner of the installer.")})
        marker_path = os.path.join(root, ".claude-plugin", "marketplace.json")
        with open(marker_path, encoding="utf-8") as f:
            marker = json.load(f)
        marker["plugins"] = [
            {"name": "a", "source": "./plugins/a"},
            {"name": "b", "source": "./plugins/b"},
        ]
        for plug in ("a", "b"):
            d = os.path.join(root, "plugins", plug, "skills", "shared")
            os.makedirs(d, exist_ok=True)
            with open(os.path.join(d, "SKILL.md"), "w", encoding="utf-8") as f:
                f.write(FM.format(n="shared", b=f"Owned by {plug}."))
        with open(marker_path, "w", encoding="utf-8") as f:
            json.dump(marker, f)
        collision_rc, collision_out = install(script, codex)
        shared = os.path.join(codex, "skills", "shared")
        check('Actual measurement: The skills of the two plugins with the same name are blocked in advance and neither is installed.',
              collision_rc == 1 and not os.path.lexists(shared)
              and not any(k.endswith(":shared") for k in lock_of(codex)),
              f"rc={collision_rc} lock={sorted(lock_of(codex))}")
        check('Ground truth: Report two sources of homonymous collisions and the global name.',
              "a:shared" in collision_out and "b:shared" in collision_out
              and "global skill-name collision" in collision_out)

        # Configure the Moho lock yourself, which could have been created by an installer in the past. The actual path is b
        # Even if you point to and re-execute after the source a disappears, you must not delete b.
        bdir = os.path.join(root, "plugins", "b", "skills", "shared")
        os.symlink(bdir, shared)
        with open(os.path.join(codex, "skills", ".jstack-bridge.json"),
                  "w", encoding="utf-8") as f:
            json.dump({
                "a:shared": {"source": "plugins/a/skills/shared/SKILL.md", "mode": "link"},
                "b:shared": {"source": "plugins/b/skills/shared/SKILL.md", "mode": "link"},
            }, f)
        shutil.rmtree(os.path.join(root, "plugins", "a"))
        recover_rc, recover_out = install(script, codex)
        check('Ground truth: Retrieving a missing eponymous source does not clear paths for other living owners',
              recover_rc == 0 and os.path.islink(shared)
              and os.path.realpath(shared) == os.path.realpath(bdir)
              and set(lock_of(codex)) == {"b:shared"}
              and counted(recover_out, "removed") == 0,
              f"rc={recover_rc} lock={sorted(lock_of(codex))}")

    # (C9) **override.** Even if you include a blocking pattern, if the plugin gives you a dedicated copy of Codex,
    # Install it. Measures whether the dedicated copy is actually **used** (not the original).
    with tempfile.TemporaryDirectory() as tmp:
        _r, script, codex = marketplace(
            tmp, {"bridge": FM.format(n="bridge", b="Owner of the installer."),
                  "dual": FM.format(n="dual", b="Delegate with subagent_type=explore.")},
            extra={"dual": {"SKILL.codex.md":
                            "# dual — Codex edition\n\nCodex-specific body.\n"}})
        ov_rc, ov_out = install(script, codex)
        ov = read_or_empty(os.path.join(codex, "skills", "dual", "SKILL.md"))
        check('Actual measurement: If there is a dedicated copy, it is installed as override, not blocked.',
              "Codex-specific body." in ov and "subagent_type" not in ov
              and ov_rc == 0, f"rc={ov_rc} {ov.strip()[-50:]!r}")
        check('Actual measurement: override also comes with a source header',
              "generated by the bridge skill from" in ov and "source-sha256:" in ov)
        check('Actual: Do not leave SKILL.codex.md in the copy (the two texts do not live together)',
              not os.path.exists(os.path.join(codex, "skills", "dual", "SKILL.codex.md")))

    # (C11·C5 + H·I·P·O) **Flow that rotates more than twice.** Can be re-executed after installation only once.
    # Even if you quietly retrieve the entire amount or miss upstream changes, it will not be revealed. 1st installation ->
    # Re-execute without change -> Modify 1 byte of original -> Concatenate `--only` in one tree.
    with tempfile.TemporaryDirectory() as tmp:
        root, script, codex = marketplace(tmp, {
            "bridge": FM.format(n="bridge", b="Owner of the installer."),
            "gitrules": FM.format(
                n="gitrules",
                b="Run `${CLAUDE_PLUGIN_ROOT}/skills/gitrules/scripts/check.py` first."),
            "linky": FM.format(n="linky", b="Nothing host-specific lives here."),
        })
        gsrc = os.path.join(root, "staging", "jstack-dev", "skills", "gitrules", "SKILL.md")
        dst_g = os.path.join(codex, "skills", "gitrules", "SKILL.md")
        digest1 = hashlib.sha256(open(gsrc, "rb").read()).hexdigest()

        r1c, _r1o = install(script, codex)
        lock1 = lock_of(codex)
        rec1 = lock1.get("jstack-dev:gitrules", {})
        head1 = read_or_empty(dst_g)
        check('Actual measurement: The lock file records the original sha256 as is.',
              rec1.get("source_sha256") == digest1, f"{rec1.get('source_sha256')}")
        check('Ground truth: lock items have commit and install times',
              bool(rec1.get("commit")) and bool(re.match(
                  r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d", rec1.get("installed_at", ""))),
              f"{rec1.get('commit')} {rec1.get('installed_at')}")
        check('Actual measurement: The source and original sha256 are written in the head of the product.',
              f"source-sha256: {digest1}" in head1
              and "generated by the bridge skill from" in head1
              and "Do not edit this file directly" in head1,
              head1.splitlines()[0][:60] if head1 else "")

        r2c, r2o = install(script, codex)
        strip_time = lambda lk: {k: {a: b for a, b in v.items() if a != "installed_at"}
                                 for k, v in lk.items()}
        check('actual measurement: Re-executing the original without changes has a count of 0 and an update of 0.',
              r2c == 0 and counted(r2o, "removed") == 0 and counted(r2o, "updated") == 0,
              f"rc={r2c} removed={counted(r2o, 'removed')} updated={counted(r2o, 'updated')}")
        check('Actual measurement: The contents of the lock file are the same (except for the installation time).',
              strip_time(lock_of(codex)) == strip_time(lock1) and bool(lock1))

        with open(gsrc, "a", encoding="utf-8") as f:
            f.write("One more line.\n")
        digest2 = hashlib.sha256(open(gsrc, "rb").read()).hexdigest()
        r3c, r3o = install(script, codex)
        rec3 = lock_of(codex).get("jstack-dev:gitrules", {})
        head3 = read_or_empty(dst_g)
        check('Actual measurement: If the original is changed, one case is reported as an upstream change.',
              counted(r3o, "updated") == 1 and r3c == 0,
              f"updated={counted(r3o, 'updated')}")
        check('Actual measurement: Then sha of the lock is changed to a new value.',
              digest2 != digest1 and rec3.get("source_sha256") == digest2)
        check('Actual measurement: Then sha in the product header is also a new value.',
              f"source-sha256: {digest2}" in head3 and "One more line." in head3)

        r4c, r4o = install(script, codex, "--only", "jstack-dev")
        left = sorted(n for n in os.listdir(os.path.join(codex, "skills"))
                      if not n.startswith("."))
        check('Actual measurement: Even if you run only the plugin with --only, the count is 0 and an installed copy remains.',
              r4c == 0 and counted(r4o, "removed") == 0 and left == ["gitrules", "linky"],
              f"rc={r4c} removed={counted(r4o, 'removed')} {left}")

    # **Ownership of a selected range.** `--only a` sets b's lock record and installation path to
    # It should not be overwritten or retrieved by global scan results. Selected source disappears
    # In this case, only a is recovered, and b is preserved even if the selected source is blocked.
    # By declaring the two plugins as separate sources, a skill with the same name accidentally appears in one plugin.
    # Prevents merging into scans.
    with tempfile.TemporaryDirectory() as tmp:
        root, script, codex = marketplace(
            tmp, {"bridge": FM.format(n="bridge", b="Owner of the installer.")})
        marker_path = os.path.join(root, ".claude-plugin", "marketplace.json")
        with open(marker_path, encoding="utf-8") as f:
            marker = json.load(f)
        marker["plugins"] = [
            {"name": "a", "source": "./plugins/a"},
            {"name": "b", "source": "./plugins/b"},
        ]
        for plug, body in (("a", "A skill."), ("b", "B skill.")):
            skill_dir = os.path.join(root, "plugins", plug, "skills", plug)
            os.makedirs(skill_dir, exist_ok=True)
            with open(os.path.join(skill_dir, "SKILL.md"), "w", encoding="utf-8") as f:
                f.write(FM.format(n=plug, b=body))
        with open(marker_path, "w", encoding="utf-8") as f:
            json.dump(marker, f)

        all_rc, _all_out = install(script, codex)
        b_dst = os.path.join(codex, "skills", "b")
        b_record = lock_of(codex).get("b:b", {})
        check('Ground truth: synthetic a,b full installation records two plugins',
              all_rc == 0 and os.path.lexists(os.path.join(codex, "skills", "a"))
              and os.path.lexists(b_dst) and set(lock_of(codex)) == {"a:a", "b:b"},
              f"rc={all_rc} lock={sorted(lock_of(codex))}")

        only_rc, only_out = install(script, codex, "--only", "a")
        check('Actual measurement: --only a preserves the installation path and lock of unselected b',
              only_rc == 0 and os.path.lexists(b_dst)
              and lock_of(codex).get("b:b") == b_record
              and counted(only_out, "removed") == 0,
              f"rc={only_rc} removed={counted(only_out, 'removed')} lock={sorted(lock_of(codex))}")

        shutil.rmtree(os.path.join(root, "plugins", "a"))
        absent_rc, absent_out = install(script, codex, "--only", "a")
        check('Real measurement: When the selected source a disappears, only a is retrieved and b is preserved.',
              absent_rc == 0 and not os.path.lexists(os.path.join(codex, "skills", "a"))
              and os.path.lexists(b_dst) and set(lock_of(codex)) == {"b:b"}
              and counted(absent_out, "removed") == 1,
              f"rc={absent_rc} removed={counted(absent_out, 'removed')} lock={sorted(lock_of(codex))}")

        blocked_dir = os.path.join(root, "plugins", "a", "skills", "a")
        os.makedirs(blocked_dir, exist_ok=True)
        with open(os.path.join(blocked_dir, "SKILL.md"), "w", encoding="utf-8") as f:
            f.write(FM.format(n="a", b="A skill restored before blocking."))
        reinstall_rc, _reinstall_out = install(script, codex, "--only", "a")
        with open(os.path.join(blocked_dir, "SKILL.md"), "w", encoding="utf-8") as f:
            f.write(FM.format(n="a", b="Delegate with subagent_type=explore."))
        blocked_rc, blocked_out = install(script, codex, "--only", "a")
        check('Actual measurement: Even if selected a is blocked, the path and lock of unselected b are preserved.',
              reinstall_rc == 0 and blocked_rc == 1
              and not os.path.lexists(os.path.join(codex, "skills", "a"))
              and os.path.lexists(b_dst)
              and lock_of(codex) == {"b:b": b_record}
              and "a:a" in blocked_out and counted(blocked_out, "removed") == 1,
              f"reinstall rc={reinstall_rc} blocked rc={blocked_rc} removed={counted(blocked_out, 'removed')} "
              f"lock={sorted(lock_of(codex))}")

    # (A·W pair) **Is there actually a root in the marker position claimed in the text?** String
    # Instead of existing, place a marker on the path parsed from the text and run the installation.
    claim = re.search(r"walks upward for `([^`]+)`", " ".join(skill.split()))
    with tempfile.TemporaryDirectory() as tmp:
        _r, script, codex = marketplace(
            tmp, {"bridge": FM.format(n="bridge", b="Owner of the installer."),
                  "linky": FM.format(n="linky", b="Nothing host-specific lives here.")},
            marker_rel=(claim.group(1) if claim else "no-such-marker.json"))
        mk_rc, mk_out = install(script, codex)
        check('Intersection: install.py takes root at the marker position claimed in the text',
              claim is not None and mk_rc == 0
              and os.path.lexists(os.path.join(codex, "skills", "linky")),
              f"claim {claim.group(1) if claim else None} rc={mk_rc} {mk_out.strip()[:40]}")

    # Rules.json's own contract — if the substitution table is empty, all of the above ground truths break down,
    # What the rules file should contain is not specified separately.
    rules_raw = read_or_empty(RULES_JSON)
    try:
        rules = json.loads(rules_raw)
    except ValueError:
        rules = {}
    subs = rules.get("substitutions", [])
    blockers = rules.get("blockers", [])
    check('Rule: There is a guard in the rule to remove unquoted strings',
          "(?<!Generated with )Claude Code" in rules_raw)
    check('rule: The reason for the guard is written in the rules file.',
          "quote literal forbidden strings" in rules_raw
          and "global Claude Code replacement" in rules_raw)
    # **This is an exact value, not a lower limit.** `>= 10` passes even if you delete 3 rules —
    # And since the rule execution fixture above creates `EXPECT_*` , the two lists
    # If there is a difference, this is where we divide. If you legitimately increase or decrease a rule, `EXPECT_*` and
    # We need to correct these numbers together, and that one line remains in the diff.
    check('Rules: there are exactly 13 substitution rules', len(subs) == 13,
          f"{len(subs)} rules")
    check('Rules: there are exactly six blocker rules', len(blockers) == 6,
          f"{len(blockers)} rules")
    check('Rule: The list of blocking patterns is the same as the canonical version of the suite.',
          [b.get("pattern") for b in blockers] == EXPECT_BLOCKERS,
          f'{[b.get("pattern") for b in blockers]}')
    check('Rule: The substitution (from, to) list is the same as the original in the suite.',
          [(x.get("from"), x.get("to")) for x in subs] == EXPECT_SUBS,
          f'{[x.get("from") for x in subs]}')
    check('Rule: All substitution patterns are compiled',
          all(_compiles(s.get("from", "")) for s in subs) and bool(subs))
    check('Rule: Every blocking rule has a reason',
          all(b.get("reason") for b in blockers) and bool(blockers))

    built_native = os.path.join(ROOT, "SKILL.codex.md")
    source_native = os.path.join(PACKAGE_ROOT, "hosts", "codex", "skills",
                                 "bridge", "SKILL.md")
    native = read_or_empty(built_native if os.path.isfile(built_native) else source_native)
    check("native: entry retains point-of-use capability states",
          "Exit 0 means fully available" in native and "scripts/probe.sh" in native)
    check("native: delivery names the actual exporter and host boundary",
          "scripts/export.py" in native and "Claude commands" in native)
    exported = subprocess.run([sys.executable, os.path.join(HERE, "test_export.py")],
                              capture_output=True, text=True)
    check("native: relocated payload and independent failure controls execute",
          exported.returncode == 0, exported.stdout[-200:])

    check_skill_body(check, ROOT, needles=[
        "Code 1 is the one that earns the convention",
        "Never install on the user's behalf",
        "Print the command; do not run it",
        # The two pieces of needle survived the insertion of negative words — subjects and predicates attached.
        # Convert it to a single line (it must be "single line" so that the raw contrast is not broken by paragraph rearrangement).
        "silent downgrade, and the user reads the output as if the full tool ran.",
        "Probe at the point of use, not at startup",
        "found by marker, not by path arithmetic",
        "excludes itself by skill directory, not by plugin name",
        "Substitution is for notation, never for a quoted literal",
    ], floor=4111)

    check_ref_contracts(check, ROOT, [
        ("probe-recipes.md", "strength table, per-state wording, version floor, and auth split",
         # (C13) gh worked example clause was outside the needle population — the entire clause
         # Even if I erased it, this axis did not move. Enter two sentences. The `says()` check below and
         # They overlap, but the axes are different: here is the delete/freeze axis, and there is the sentence axis.
         ["strictly stronger", "state 1 goes unread too",
          "numerically, field by field", "Authentication is not installation",
          "binary resolves, `gh auth status` returns non-zero",
          "Signed-out is state 1, not 2"], 2357),
    ])

    # The lower bound is the actual value — the number of probes that actually break when probe.sh is emptied.
    # The lower bound is the actual value — the number of probes that actually break when probe.sh is emptied.
    # Checks that expect rc==0 pass even in empty scripts, so they are not included in this number.
    check_script_contracts(check, __file__, ROOT,
                           scripts={"scripts/probe.sh": 23,
                                    "scripts/install.py": 68,
                                    "scripts/rules.json": 74,
                                    "scripts/export.py": 1},
                           live_ran=sum(1 for r in results
                                        if not r[0].startswith(("자기검사:", "계약 커버리지:",
                                                                "스크립트 계약:"))))
    # **Reference floor is a remeasurement (2026-09-02).** Previous values ​​were 1 higher for each reference —
    # The line survival axis has been moved to the `Self-Check:` prefix and is missing from the copy failure coefficient, which has a floor value.
    # It was not unloaded together, due to the `return` in the `_suite_lib` reference loop (fixed in e55fe98).
    # The extinction guard always turns red **The floor value check itself is skipped** and the discrepancy is revealed.
    # didn't No contracts were lost — copies were made for each file and a list of failures was cataloged and collated.
    coverage = {
        "SKILL.md": 42, "references/probe-recipes.md": 24, "scripts/probe.sh": 23,
        "scripts/install.py": 68, "scripts/rules.json": 74,
        "scripts/export.py": 1,
    }
    if os.path.isfile(os.path.join(ROOT, "SKILL.codex.md")):
        coverage["SKILL.codex.md"] = 2
    else:
        check("계약 커버리지: Codex source variant is hosted separately",
              os.path.isfile(source_native), source_native)
    check_contract_coverage(check, __file__, ROOT, per_file=coverage,
                            live_ran=sum(1 for r in results
                    if not r[0].startswith(("자기검사:", "계약 커버리지:", "스크립트 계약:"))))
    check_body_deletion(check, __file__, ROOT, minimum=42,
                        live_ran=sum(1 for r in results
                                     if not r[0].startswith(("자기검사:", "계약 커버리지:",
                                                             "스크립트 계약:"))))
    check_no_constant_assertions(check, __file__)
    check_total(check, results, 204)

    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n{passed}/{len(results)} 통과")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
