#!/usr/bin/env python3
"""Workspace regression suite.

Run: python3 tests/run_tests.py (from skills/workspace)

Locks account separation, target verification before writes, the ID/cell-address
source of truth, and the first-user setup path. Target verification is the most
important contract because reads can be retried while overwritten records cannot.
"""
import io
import os
import re
import shutil
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"

HERE = os.path.dirname(os.path.abspath(__file__))
# Skill Common Tool — frontmatter Prevents shadow defects on a class-by-class basis
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
from _suite_lib import (check_skill_body, check_no_constant_assertions, check_script_contracts, check_total, check_ref_contracts, split_frontmatter, check_body_deletion,
                        check_contract_coverage, content_bytes)  # noqa: E402
ROOT = os.path.dirname(HERE)
REFS = os.path.join(ROOT, "references")
ENSURE = os.path.join(ROOT, "scripts", "ensure_gws.sh")
TOKEN_CHECK = os.path.join(ROOT, "scripts", "token_check.py")
# Source checkouts keep the command under hosts/claude; built packages place it
# directly under commands/.
PLUGIN = os.path.dirname(os.path.dirname(ROOT))
SOURCE_SETUP_REL = "../../hosts/claude/commands/setup-workspace.md"
BUILT_SETUP_REL = "../../commands/setup-workspace.md"
SETUP_REL = (SOURCE_SETUP_REL
             if os.path.isfile(os.path.join(ROOT, SOURCE_SETUP_REL))
             else BUILT_SETUP_REL)
SETUP = os.path.join(ROOT, SETUP_REL)

results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))


def read(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


def run_ensure(path, home):
    r = subprocess.run(["bash", ENSURE], capture_output=True, text=True,
                       env={"PATH": path, "HOME": home})
    return r.returncode, r.stdout



# ── Actual execution fixture (daily_draft_mail.sh) ──────────────────────────────────
# **The pipeline is not reproduced within the test.** The previous version only removed `in_scope`.
# The test was measured using a find pipeline written by the test itself. Then, the gate of the actual loop is
# Even if you take it out entirely, it's green — the adversary is the mtime sweep.
# Even though the salary statement was actually leaked by deleting `in_scope "$GITHUB_DIR/$(dirname "$f")"`
# I passed all of the suites.
#
# So run `bash scripts/daily_draft_mail.sh --no-send` as is.**
# The LLM caller (`claude -p`) is intercepted by a shell function injected into BASH_ENV and the **prompt text** is returned.
# Receive it as a file — that's "getting it out there." In which loop is the gate
# Regardless of whether it is left out or not, secrets appear in that file.
GIT_ENV = dict(os.environ, GIT_AUTHOR_NAME="t", GIT_AUTHOR_EMAIL="t@e",
               GIT_COMMITTER_NAME="t", GIT_COMMITTER_EMAIL="t@e",
               GIT_CONFIG_GLOBAL="/dev/null", GIT_CONFIG_SYSTEM="/dev/null")

# Secrets leak through **two paths**. Divide the token to determine which loop has been opened.
SECRET_FILE = "급여명세"          # Korean filename collected by the mtime sweep
SECRET_COMMIT = "비공개저장소-커밋제목"   # Korean title collected by the Git loop
NORMAL_FILE = "normal.md"
NORMAL_COMMIT = "정상저장소-커밋제목"


def _git(repo, *args):
    return subprocess.run(["git", "-C", repo, *args],
                          capture_output=True, text=True, env=GIT_ENV)


def _mail_fixture():
    """Create a GITHUB_DIR fixture with a nested repo and a three-level file."""
    fx = tempfile.mkdtemp()
    wa = os.path.join(fx, "work-a")
    sec = os.path.join(wa, "private-secret")
    deep = os.path.join(sec, "sub")
    os.makedirs(deep)
    for rel, body in ((os.path.join(wa, NORMAL_FILE), "정상 작업 파일\n"),
                      (os.path.join(sec, "직접.txt"), "x\n"),
                      (os.path.join(deep, SECRET_FILE + ".txt"), "x\n")):
        with io.open(rel, "w", encoding="utf-8") as f:
            f.write(body)
    # Create the inner repository first — if you do the outer one first, `add -A` will swallow the secret files.
    _git(sec, "init", "-q")
    _git(sec, "add", "-A")
    _git(sec, "commit", "-q", "-m", SECRET_COMMIT)
    _git(wa, "init", "-q")
    _git(wa, "add", NORMAL_FILE)
    _git(wa, "commit", "-q", "-m", NORMAL_COMMIT)
    return fx


def _mail_run(mail_sh, fx, home, repos="", exclude=""):
    """Run the real script and return (exit, complete LLM prompt, stderr)."""
    stub = os.path.join(home, "bash_env.sh")
    with io.open(stub, "w", encoding="utf-8") as f:
        # `claude` may not be in the PATH, and even if it is, it should not be called. `gws` is
        # --no-send will not be called on the path, but the search should succeed.
        f.write('claude() { cat > "$SCRUM_TEST_PROMPT"; printf "테스트 초안\\n"; }\n'
                'gws() { printf \'{"id":"test"}\\n\'; }\n')
    pout = os.path.join(home, "prompt.txt")
    if os.path.exists(pout):
        os.remove(pout)
    env = dict(os.environ, HOME=home, GITHUB_DIR=fx,
               SCRUM_MAIL_TO="scrum-test@example.invalid",
               SCRUM_LOG_DIR=os.path.join(home, "log"),
               SCRUM_REPOS=repos, SCRUM_EXCLUDE=exclude,
               BASH_ENV=stub, SCRUM_TEST_PROMPT=pout)
    r = subprocess.run(["bash", mail_sh, "--no-send"],
                       capture_output=True, text=True, env=env)
    sent = io.open(pout, encoding="utf-8").read() if os.path.exists(pout) else ""
    return r.returncode, sent, r.stderr[-300:]


def main():
    _skill_raw = read(os.path.join(ROOT, "SKILL.md"))
    skill_fm, skill = split_frontmatter(_skill_raw)
    setup = read(SETUP)
    cells = read(os.path.join(REFS, "scrum-cells.md"))
    ids = read(os.path.join(REFS, "gdrive-ids.md"))

    # (1) Account separation
    check("Account separation: CONFIG_DIR contract is documented in SKILL.md",
          "GOOGLE_WORKSPACE_CLI_CONFIG_DIR" in skill)
    check("Account separation: documents the consequence of omitting CONFIG_DIR",
          "personal account, or the reverse" in skill)
    check("Onboarding: scripts must not use shell aliases",
          "Aliases exist only in\ninteractive shells" in setup)

    # (2) Check the target before writing — the heaviest contract
    for label, needle, where, text in [
        ("SKILL.md verification rule", "reread the target cell's name column", "SKILL.md", skill),
        ("SKILL.md stop rule", "Stop if it differs", "SKILL.md", skill),
        ("SKILL.md rationale", "overwritten records are not", "SKILL.md", skill),
        ("scrum-cells verification rule", "read the name cell again", "scrum-cells", cells),
        ("scrum-cells quiet-success warning", "silently overwrite another person's cell", "scrum-cells", cells),
    ]:
        check(f"Write safety: {label}", needle in text)

    # (3) No assumptions—are both failure modes recorded?
    check("No guessing: measured tab-name calculation failure",
          "calculated fifth-week tab" in cells and "used the fourth week" in cells)
    check("No guessing: row spacing depends on headcount",
          "team roster" in cells or "five-person layout" in cells)
    # `"12" in cells and "13" in cells` was a dead prosecutor — the entire table
    # I passed by deleting only “12 items, line 13” (reviewer verification).
    # **Parse the table rows to see if the values ​​in the two rows are actually different**.
    rows = re.findall(
        r"(?m)^\|[^|]*\|" + r"\s*\**(\d+)\**\s*\|" * 5, cells)
    check("No guessing: two weekday rows have five cells (assumed row 4 versus actual row 5)",
          len(rows) >= 2, f"{len(rows)} rows")
    check("No guessing: the two row intervals actually differ",
          len(rows) >= 2 and rows[0] != rows[1],
          f"{rows[0] if rows else '-'} vs {rows[1] if len(rows)>1 else '-'}")

    # (4) There is no real ID in the public document, only the local profile is authentic.
    id_re = re.compile(r"`(?:0A|1)[A-Za-z0-9_-]{20,}`")
    check("SSOT: gdrive-ids.md explains local profiles and discovery fields",
          "~/.jstack/profiles/<name>/workspace.json" in ids and
          "reportFolderId" in ids and "scrumFolderId" in ids)
    embedded = [fn for fn in os.listdir(REFS) if fn.endswith(".md") and
                id_re.search(read(os.path.join(REFS, fn)))]
    check("SSOT: shared reference does not contain production-shaped IDs", not embedded, str(embedded))
    check("SSOT: scrum-cells points to the local ID authority",
          "~/.jstack/profiles/<name>/workspace.json" in cells and "authoritative" in cells)

    # (5) Tool trap of the same name — the first trap in the installation phase
    check("Tool trap: SKILL.md warns about the namesake tool",
          "two conflicting tools named `gws`" in skill
          and "not the other `gws` package" in skill)
    # Are the commands in the installation **step** correct? If you look at the presence of the phrase, the problem solving table says the same thing
    # So even if the installation steps are wrong, it passes — it actually worked that way.
    install_step = setup.split("## Stage 1", 1)[-1].split("## Stage 2", 1)[0]
    check("Tool trap: setup step 1 names the correct package",
          "brew install googleworkspace-cli" in install_step)
    check("Tool trap: setup step 1 explicitly rejects the wrong package",
          "Wrong: this is the git workspace tool" in install_step)
    ensure_src = read(ENSURE)
    check("Tool trap: ensure distinguishes the tool through its auth subcommand",
          "auth" in ensure_src and "same-name tool" in ensure_src)

    # (6) Onboarding — three points where first-time users get stuck
    for label, needle in [
        ("Test users registration", "Test users"),
        ("client_secret location", "~/.config/gws-work/"),
        ("mode 600", "chmod 600"),
        ("credential repository ban", "Never put `client_secret.json` or tokens in a repository"),
        ("credential sharing ban", "Do not share credentials"),
        ("verification command", "auth status"),
    ]:
        check(f"Onboarding: {label}", needle in setup)

    # 403 must have **a cause and a solution**. Just having numbers doesn't help.
    tbl = re.search(r"\|[^|\n]*403[^|\n]*\|([^|\n]*)\|([^|\n]*)\|", setup)
    check("Onboarding: 403 is paired with this cause/resolution",
          bool(tbl) and "Test users" in (tbl.group(1) + tbl.group(2)),
          (tbl.group(1).strip()[:40] if tbl else "table row missing"))

    # Didn't you leave your private path as a reference — the actual flaw in the upstream README
    check("Onboarding: does not reference a personal local path",
          "Documents/Github/gws_cli_setup" not in setup)
    # **setup-workspace.md was outside the contract population** — outside the skills directory (`commands/`)
    # It is not caught in the walk of `check_contract_coverage`. The above tests only check the existence of words.
    # As you can see, even if it was reduced to a skeleton with only the needle remaining, it all passed (hostile verification). Take the volume.
    _setup_needles = ["Test users", "chmod 600",
                      "Never put `client_secret.json` or tokens in a repository",
                      "Do not share credentials", "auth status",
                      "brew install googleworkspace-cli", "Wrong:",
                      "Aliases exist only in"]
    _setup_vol = content_bytes(setup, _setup_needles)
    check("Onboarding: setup-workspace.md volume (>= 2986B)", _setup_vol >= 2986, f"{_setup_vol}B")

    # (7) ensure 3 values
    gws_bin = None
    for p in os.environ.get("PATH", "").split(":"):
        if os.path.exists(os.path.join(p, "gws")):
            gws_bin = p
            break
    if gws_bin:
        rc, _ = run_ensure(f"{gws_bin}:/usr/bin:/bin", os.path.expanduser("~"))
        check("ensure: Installation + Setup → exit 0", rc == 0, f"exit={rc}")
        rc, out = run_ensure(f"{gws_bin}:/usr/bin:/bin", "/tmp/__no_home__")
        check("ensure: No setting → exit 1", rc == 1 and "authentication" in out,
              f"exit={rc}")
    else:
        # **Do not enter a space-filling constant.** In the previous version, fill one space with `check(..., True)`.
        # Filled — “We measured everything even in this environment” by only measuring the total amount of tests without measuring anything.
        # Make it look like What cannot be measured is left as unmeasured.
        print("[SKIP] ensure: 0/1 verdict — gws is unavailable (2 checks not run)")
    rc, out = run_ensure("/usr/bin:/bin", os.path.expanduser("~"))
    check("ensure: No installation → exit 2", rc == 2, f"exit={rc}")
    check("ensure: missing-install guidance names the correct package",
          "googleworkspace-cli" in out)

    # (8) New port — commit ac25a57 (automatic sending) · adb6b55 (judgment rule)
    judg = read(os.path.join(REFS, "report-judgment.md"))
    auto = read(os.path.join(REFS, "daily-draft-automation.md"))

    # Commit->Performance Promotion Rule. Without this, things that never happened will be uploaded to the team document.
    check("Judgment: commit messages are not treated as facts",
          "A Commit Message Is Not a Verified Fact" in judg)
    kws = ["confirmed", "completed", "agreed", "approved", "deployed", "delivered"]
    missing = [k for k in kws if k not in judg.lower()]
    check("Judgment: all six review keywords are present", not missing, f"missing {missing}")
    check("Judgment: SKILL.md contains the same keywords",
          all(k in skill for k in ["확정", "완료", "합의", "승인", "배포", "전달"]))
    check("Judgment: final decision requires user confirmation",
          "user confirmation remains the reliable source" in judg)
    check("Judgment: cell style uses fragments and forbids formal sentence endings",
          "terse Korean bullet style" in judg and "formal sentence endings" in judg)
    check("Judgment: commit count does not equal importance",
          "Commit count does not determine importance" in judg)
    check("Judgment: personal work cannot be identified automatically",
          "Personal work cannot be classified reliably" in judg)

    # Automatic sending — don't put the address in the script
    mail_sh = read(os.path.join(ROOT, "scripts", "daily_draft_mail.sh"))
    check("Automatic delivery: recipient is supplied by environment variable",
          "SCRUM_MAIL_TO" in mail_sh)
    check("Automatic delivery: address is not hard-coded",
          not re.search(r'TO="[^$"]*@[^"]*"', mail_sh))
    check("Automatic delivery: --no-send supports dry verification",
          "--no-send" in mail_sh and "--no-send" in skill)
    check("Automatic delivery: produces a draft and does not write to the sheet",
          "remains a draft and never writes to the sheet" in skill)
    # Are the four environment schedulers real?
    sched = os.path.join(ROOT, "scheduler")
    have = set(os.listdir(sched)) if os.path.isdir(sched) else set()
    for label, fn in [("launchd", "scrum-draft.plist"),
                      ("systemd service", "scrum-draft.service"),
                      ("systemd timer", "scrum-draft.timer"),
                      ("cron", "crontab.txt"),
                      ("Windows", "register-task.ps1")]:
        check(f"Automatic delivery: {label} scheduler exists", fn in have)
    check("Automatic delivery: Windows script exists",
          os.path.exists(os.path.join(ROOT, "scripts", "daily_draft_mail.ps1")))

    # **Five types of schedulers were outside the contract population.** `check_contract_coverage` is
    # Remove `scheduler/` as a non-contract directory, and `.txt`·`.plist`·`.service`·`.ps1`
    # Also remove the extension. So even if all five files are made to 0 bytes, the above "real"
    # As long as it passed the test, it was green (hostile verification). Here **parse according to the file format**
    # Measure what you call and when — a shell of just a name dies in the parsing.
    sched_txt = {fn: read(os.path.join(sched, fn)) for fn in sorted(have)
                 if os.path.isfile(os.path.join(sched, fn))}

    # (a) cron — Split into 5 fields
    cron_line = next((ln for ln in sched_txt.get("crontab.txt", "").splitlines()
                      if "daily_draft_mail.sh" in ln and not ln.startswith("#")), "")
    cron_fields = cron_line.split()[:5]
    check("Scheduler: crontab runs the script at 17:00 on weekdays",
          cron_fields == ["0", "17", "*", "*", "1-5"], str(cron_fields))
    check("Scheduler: crontab sets PATH because cron lacks the login environment",
          any(ln.startswith("PATH=") for ln in
              sched_txt.get("crontab.txt", "").splitlines()))

    # (b) launchd — Actual parsing with plistlib. Read by replacing only the placeholders
    import plistlib as _plist
    _praw = sched_txt.get("scrum-draft.plist", "").replace(
        "__HOME__", "/Users/x")
    try:
        pl = _plist.loads(_praw.encode("utf-8"))
    except Exception as e:                      # noqa: BLE001 — parseability is the contract
        pl = None
        _plerr = str(e)[:60]
    else:
        _plerr = ""
    check("Scheduler: plist parses as a valid property list", pl is not None, _plerr)
    _args = (pl or {}).get("ProgramArguments", [])
    check("Scheduler: plist passes daily_draft_mail.sh as an argument",
          any(str(x).endswith("scripts/daily_draft_mail.sh") for x in _args),
          str(_args)[:60])
    _cal = (pl or {}).get("StartCalendarInterval", [])
    check("Scheduler: plist covers all five weekdays at 17:00",
          sorted(d.get("Weekday") for d in _cal) == [1, 2, 3, 4, 5]
          and all(d.get("Hour") == 17 and d.get("Minute") == 0 for d in _cal),
          str(_cal)[:60])
    check("Scheduler: plist passes SCRUM_MAIL_TO without embedding an address",
          "SCRUM_MAIL_TO" in (pl or {}).get("EnvironmentVariables", {}))

    # (c) systemd — Parse as INI
    import configparser as _cp

    def _ini(text):
        c = _cp.ConfigParser(strict=False, interpolation=None)
        c.optionxform = str
        try:
            c.read_string(text)
        except _cp.Error:
            return None
        return c
    svc = _ini(sched_txt.get("scrum-draft.service", ""))
    check("Scheduler: service is parsed into a valid unit file",
          svc is not None and svc.has_section("Service"))
    check("Scheduler: ExecStart of service calls daily_draft_mail.sh",
          svc is not None and svc.has_option("Service", "ExecStart")
          and svc.get("Service", "ExecStart").endswith("scripts/daily_draft_mail.sh"),
          svc.get("Service", "ExecStart", fallback="")[-50:] if svc else "")
    tmr = _ini(sched_txt.get("scrum-draft.timer", ""))
    check("Scheduler: timer sets weekday 17:00 in OnCalendar",
          tmr is not None and tmr.get("Timer", "OnCalendar", fallback="").strip()
          == "Mon..Fri 17:00",
          tmr.get("Timer", "OnCalendar", fallback="") if tmr else "")
    check("Scheduler: timer makes up for missed runs (Persistent)",
          tmr is not None
          and tmr.get("Timer", "Persistent", fallback="").strip() == "true")
    check("Scheduler: timer is installed in timers.target",
          tmr is not None
          and tmr.get("Install", "WantedBy", fallback="").strip() == "timers.target")

    # (d) Windows registration script — Since there is no pwsh, it cannot be run. Measure with needle
    _ps = sched_txt.get("register-task.ps1", "")
    _ps_miss = [n for n in ("Register-ScheduledTask", "Unregister-ScheduledTask",
                            "daily_draft_mail.ps1", "-At '17:00'",
                            "Monday,Tuesday,Wednesday,Thursday,Friday",
                            "-StartWhenAvailable") if n not in _ps]
    check("Scheduler: register-task.ps1 supports weekday 17:00 registration and removal",
          not _ps_miss, f"missing {_ps_miss}")

    # (e) Bulk — Block the shell leaving only the needle. actual measurement
    for fn, floor in [("crontab.txt", 366),
                      ("scrum-draft.plist", 1987),
                      ("scrum-draft.service", 546),
                      ("scrum-draft.timer", 184),
                      ("register-task.ps1", 1313)]:
        got = content_bytes(sched_txt.get(fn, ""))
        check(f"Scheduler: {fn} volume (>= {floor}B)", got >= floor, f"{got}B")
    check("Automatic delivery: installation guide covers four environments",
          all(k in auto for k in ("launchd", "systemd", "cron", "Windows")))

    # (9) Separation of tool knowledge/work data
    # D-2: Judging by the presence of the phrase, it passes **even if you delete the entire grade column in the table** (reviewer verification).
    # This is because the same words exist in prose. View it as a table row structure.
    ref_rows = re.findall(r"`(?:references/)?([a-z][a-z0-9-]+\.md)`", skill)
    check("Separation: reference table has grade columns per row",
          len(set(ref_rows)) >= 9,
          f"{len(set(ref_rows))} references")
    check("Separation: reference table header declares grade column",
          "tool knowledge, work data, procedures, judgment, and incident handling" in skill)
    grades = {x for x in ("tool knowledge", "work data", "procedures",
                           "judgment", "incident handling") if x in skill}
    check("Separation: grade is actually of several types",
          len(grades) >= 3, str(sorted(grades)))

    # D-5: What and Where Auto Dispatch Sends — Range Control and Default Off
    mail_sh2 = read(os.path.join(ROOT, "scripts", "daily_draft_mail.sh"))
    # In terms of string existence, `if false; Even if disabled with then`, it passes (verification).
    # **Remove the function from the real thing and measure it in motion**. The entire execution is slow using claude -p.
    m_fn = re.search(r"(?ms)^in_scope\(\) \{.*?^\}", mail_sh2)
    # **Prevents the check from disappearing even if the function is not found.** The previous version used `else:`
    # After wrapping, and emptying the script, the 9 cases below did not fail but were **destroyed** —
    # Since expiration is not seen as a failure number, the contract quietly disappears.
    check("Automatic delivery: in_scope function exists", m_fn is not None,
          "" if m_fn else "function not found")
    fn = m_fn.group(0) if m_fn else ""

    def scope(name, repos="", exclude=""):
        script = (f'SCRUM_REPOS="{repos}"; SCRUM_EXCLUDE="{exclude}"\n'
                  f'{fn}\nin_scope "{name}/" && echo IN || echo OUT')
        r = subprocess.run(["bash", "-c", script], capture_output=True, text=True)
        return r.stdout.strip()
    check("Automatic delivery: whitelist excludes entries outside the list",
          scope("alpha", repos="alpha beta") == "IN"
          and scope("gamma", repos="alpha beta") == "OUT",
          f'alpha={scope("alpha", repos="alpha beta")} gamma={scope("gamma", repos="alpha beta")}')
    check("Automatic delivery: exclusion list actually excludes entries",
          scope("gamma", exclude="gamma") == "OUT"
          and scope("alpha", exclude="gamma") == "IN")
    check("Automatic delivery: empty include and exclude lists include all by default",
          scope("anything") == "IN")

    # **Nested storage.** If you only measure the function, you won't be able to catch it — if the parent passes, the child
    # There was actually a hole that went in (verified by reviewer). Measure by relative path.
    def scope_path(rel, repos="", exclude=""):
        script = (f'GITHUB_DIR=/gh\nSCRUM_REPOS="{repos}"; SCRUM_EXCLUDE="{exclude}"\n'
                  f'{fn}\nin_scope "/gh/{rel}" && echo IN || echo OUT')
        r = subprocess.run(["bash", "-c", script], capture_output=True, text=True)
        return r.stdout.strip()
    check("Automatic delivery: exclusion list can block a nested repository",
          scope_path("work-a/private", exclude="private") == "OUT"
          and scope_path("work-a", exclude="private") == "IN",
          f'nested={scope_path("work-a/private", exclude="private")}')
    check("Automatic delivery: exclusion wins beneath a whitelisted path",
          scope_path("work-a/private", repos="work-a", exclude="private") == "OUT")
    # Is it also hung in the call section? — It is meaningless if only the function is correct and it is not hung in a loop.
    check("Automatic delivery: nested loop is guarded by in_scope",
          re.search(r'for repo in "\$d" "\$d"\*/;.*?in_scope "\$repo"',
                    mail_sh2, re.S) is not None)

    # **Create a fixture and measure whether it is actually leaking.** Only the presence of the caller is a regular expression.
    # If confirmed, it will be quietly opened when a new path is created, like the second loop —
    # In fact, the pay stub was leaked in the mtime sweep loop (reviewer verification).
    fx = tempfile.mkdtemp()
    try:
        # **Allow up to 3 levels of overlap.** If the fixture is shallow, you will not be able to see the deep outflow —
        # When I left only depth 1, `private-secret/sub/payslip.txt` was leaked.
        secret_dir = os.path.join(fx, "work-a", "private-secret")
        deep_dir = os.path.join(secret_dir, "sub")
        os.makedirs(os.path.join(secret_dir, ".git"))
        os.makedirs(deep_dir, exist_ok=True)
        with open(os.path.join(deep_dir, "급여명세.txt"), "w") as f:
            f.write("x")
        os.makedirs(os.path.join(fx, "work-a", ".git"), exist_ok=True)
        with open(os.path.join(secret_dir, "직접.txt"), "w") as f:
            f.write("x")
        with open(os.path.join(fx, "work-a", "normal.md"), "w") as f:
            f.write("x")

        # **F3 symlink.** `pwd -P` If there is no real path resolution, it is bypassed by an alias.
        # Without this test, even if the revisions were completely reversed, 92/92 abstracts were obtained (reviewer verification) —
        # If the defect is corrected and no measurement is added, it will quietly return to the next round.
        #
        # **Pick the vector in the actual loop.** At first I measured it with a `find` sweep.
        # find does not follow symlinks, so it was **green** in any implementation —
        # Even without `pwd -P`, 96/96 passed. Where you actually step on the symlink
        # This is glob(`"$d"*/`) in the storage loop. Measure it in that shape.
        os.symlink("private-secret", os.path.join(fx, "work-a", "harmless"))
        alias_script = (
            f'GITHUB_DIR="{fx}"\nSCRUM_EXCLUDE="private-secret"\nSCRUM_REPOS=""\n'
            f'{fn}\nd="{fx}/work-a/"\n'
            'for repo in "$d" "$d"*/; do '
            'in_scope "$repo" && printf "%s " "$(basename "${repo%/}")"; done')
        alias = subprocess.run(["bash", "-c", alias_script],
                               capture_output=True, text=True).stdout
        check("Leak prevention: symlink aliases are blocked using physical paths",
              "harmless" not in alias, f"loop output = {alias.strip()[:60]}")

        # **F4 Names with spaces.** If only space separation is supported, "my repo" is divided into two patterns.
        # It breaks down and cannot be blocked by any settings.
        os.makedirs(os.path.join(fx, "my repo"), exist_ok=True)
        with open(os.path.join(fx, "my repo", "sec.txt"), "w") as f:
            f.write("x")

        def scope_ws(target, exclude):
            script = (f'GITHUB_DIR="{fx}"\nSCRUM_REPOS=""\n'
                      f'SCRUM_EXCLUDE={exclude}\n{fn}\n'
                      f'in_scope "{fx}/{target}" && echo IN || echo OUT')
            r = subprocess.run(["bash", "-c", script], capture_output=True, text=True)
            return r.stdout.strip()
        check("Leak prevention: a single name containing spaces is blocked",
              scope_ws("my repo", "'my repo'") == "OUT",
              scope_ws("my repo", "'my repo'"))
        check("Leak prevention: newline-separated multiple entries remain blocked",
              scope_ws("my repo", "$'my repo\\nother'") == "OUT"
              and scope_ws("work-a", "$'my repo\\nother'") == "IN",
              scope_ws("my repo", "$'my repo\\nother'"))
        # Do not silently pass whitespace blends — must be fail-closed
        check("Leak prevention: whitespace-mixed list does not silently broaden scope",
              scope_ws("my repo", "'my repo other'") == "OUT",
              scope_ws("my repo", "'my repo other'"))

    finally:
        shutil.rmtree(fx, ignore_errors=True)

    # ── **Actual execution leak gate.** The above tests only measure the `in_scope` function. function
    # Even if it is correct, if it is left out of the call book, it will all leak as green — the hostility of mtime sweep
    # Delete `in_scope "$GITHUB_DIR/$(dirname "$f")"` to actually view the pay stub.
    # I leaked it and passed the entire suite. Checking the caller using regular expressions is also possible.
    # Changing only surface wording must not bypass the scope guard.
    #
    # So, **run** the script and read the full text of the prompt to LLM.
    # Take it. Secrets leak in two ways —
    # (1) git repository loop -> commit title in nested repository
    # (2) mtime sweep -> file names under nested directory 3 levels
    # Divide the tokens and let the decision directly say which loop was broken.
    MAIL_SH = os.path.join(ROOT, "scripts", "daily_draft_mail.sh")
    lfx = _mail_fixture()
    lhome = tempfile.mkdtemp()
    try:
        rc, base, err = _mail_run(MAIL_SH, lfx, lhome)
        check("Physical leakage: script completed and gave LLM prompt (baseline)",
              rc == 0 and len(base) > 200, f"exit={rc} {len(base)}B {err.strip()[:60]}")
        check("Physical leak: nested-repository commit reaches the prompt without controls (baseline)",
              SECRET_COMMIT in base and NORMAL_COMMIT in base,
              f"secret={SECRET_COMMIT in base} normal={NORMAL_COMMIT in base}")
        check("Physical leak: a file three levels deep reaches the prompt without controls (baseline)",
              SECRET_FILE in base and "직접" in base,
              f"secret={SECRET_FILE in base}")

        for label, kw in [("basename exclusion", dict(exclude="private-secret")),
                          ("relative-path exclusion", dict(exclude="work-a/private-secret")),
                          ("whitelist plus exclusion",
                           dict(repos="work-a", exclude="private-secret"))]:
            rc, out, err = _mail_run(MAIL_SH, lfx, lhome, **kw)
            check(f"Physical leak blocked: {label} excludes nested-repository commits (git loop)",
                  rc == 0 and SECRET_COMMIT not in out and NORMAL_COMMIT in out,
                  f"exit={rc} secret={SECRET_COMMIT in out} normal={NORMAL_COMMIT in out}")
            check(f"Physical leak blocked: {label} excludes the three-level file (mtime sweep)",
                  rc == 0 and SECRET_FILE not in out and "직접" not in out
                  and NORMAL_FILE in out,
                  f"exit={rc} secret={SECRET_FILE in out} direct={'직접' in out} "
                  f"normal={NORMAL_FILE in out}")
    finally:
        shutil.rmtree(lfx, ignore_errors=True)
        shutil.rmtree(lhome, ignore_errors=True)

    check("Automatic delivery: raw attachment is off by default",
          re.search(r"(?m)^ATTACH_RAW=0", mail_sh2) is not None)
    check("Automatic delivery: only --attach-raw enables attachment",
          "--attach-raw" in mail_sh2 and "--attach-raw" in skill)
    check("Automatic delivery: SKILL.md discloses LLM transmission",
          "claude -p" in skill and "LLM" in skill)
    check("Automatic delivery: warns that an unspecified scope scans everything",
          "Without a narrowed scope, it scans" in skill)
    # Parse the four-stage table in the skill body so deleting the body makes
    # every destination contract fail.
    flow = re.findall(r"(?m)^\|\s*(\d[^|]*)\|([^|]*)\|([^|]*)\|([^|]*)\|", skill)
    check("Automatic delivery: destination table covers all four stages", len(flow) >= 4,
          f"{len(flow)} stages")
    check("Automatic delivery: table includes the LLM transmission stage",
          any("LLM" in row[2] or "claude -p" in row[2] for row in flow))
    check("Automatic delivery: table says attachment is off by default",
          any("Off by default" in row[3] for row in flow))
    check("Automatic delivery: logs are not written into the skill directory",
          "SCRUM_LOG_DIR" in mail_sh2 and "REPO_ROOT/reports" not in mail_sh2)

    check("Separation: SKILL.md distinguishes evidence grades",
          "tool knowledge" in skill and "work data" in skill)
    check("Separation: explains different refresh cadences",
          "update cycles differ" in skill)

    # Run this suite on a copy with the text deleted and see if it fails.
    # If it doesn't appear, the document contract is not locked (regex linters use
    # Changed to this method to prevent phenotypic bypass).
    # minimum is **actual value**. If set to 1, it will pass even if 19 contracts die.
    # This number is updated when the contract is duly increased or decreased — maintenance costs are a measurement.
    # 5 references without contracts - a file-by-file floor check revealed this.
    # Aim not at a single word, but at **the substance of the document**.
    REF_CONTRACTS = [
        ("report-judgment.md", "rules for promoting commit intent into reported results",
         ["A Commit Message Is Not a Verified Fact", "confirmed", "agreed",
          "Scrum Cell Style", "Ambiguous Projects"], 2671),
        ("scrum-cells.md", "team-size-dependent row spacing and write safety",
         ["Never Calculate the Target", "team roster", "Immediately before every write",
          "sheet ID"], 1846),
        ('collect-all-projects.md', 'two-stage collection supplements Git with mtime',
         ['collect_git', 'collect_by_mtime', 'mtime'], 4320),
        ('draft-first-workflow.md', 'draft-first flow leaves a recoverable Markdown record',
         ['draft', '.md', 'recoverable', 'Create the Draft'], 3509),
        ('gws-cli.md', 'same-name tool trap and per-account CONFIG_DIR separation',
         ['googleworkspace-cli', 'GOOGLE_WORKSPACE_CLI_CONFIG_DIR', 'Multiple Accounts'], 3369),
        ('report-troubleshooting.md', 'observed missing-project, ABORT, and sheet-ID failures',
         ['An Entire Project Is Missing', 'ABORT', 'The Monthly Sheet Changed', 'clone'], 3759),
        ('sheets-troubleshooting.md', 'CLI surface changes and Hangul-tab parsing traps',
         ['--spreadsheetId', 'Tab Name', '+read', 'Parallel Updates'], 3018),
        ('daily-draft-automation.md', 'four scheduler environments and configuration',
         ['launchd', 'systemd', 'cron', 'SCRUM_MAIL_TO'], 5257),
        ('gdrive-ids.md', 'authoritative Drive IDs and replacements for unbundled scripts',
         ['Drive', 'Scripts That Are Not Bundled'], 3116),
    ]
    check_ref_contracts(check, ROOT, REF_CONTRACTS)

    # **Floor value per file — actual value.** If you measure the total as one, two things stand out:
    # (1) Total offset — If A's contract dies and B increases, the sum is maintained and passes.
    # (2) Unlocked files not visible — 0 Contributing references are covered by other files
    # A value of 0 is prohibited. The moment you declare a reference without a contract, it fails.

    # **Judges evaluated as constants are prohibited.** The final blow of the 7th review is
    # It was a constant check of the form `... if cond else True` — to the human eye,
    # It is invisible and there is no failure. Browse with AST.
    # Is the correct answer in the judgment case (5-line spacing/tab calculation failure case) the same as the actual one?
    ev = os.path.join(os.path.dirname(os.path.dirname(ROOT)), "evals",
                      "discriminating", "workspace-scrum-rows", "graders", "criteria.md")
    check("Eval: discriminating-case criteria exist", os.path.isfile(ev))
    if os.path.isfile(ev):
        crit = io.open(ev, encoding="utf-8").read()
        cells = io.open(os.path.join(ROOT, "references", "scrum-cells.md"),
                        encoding="utf-8").read()
        # The actual product is written in bold (`**8**`), so the table cell format is different — it is measured in a series of numbers.
        row = next((l for l in cells.splitlines()
                    if l.startswith("|") and "five-person layout" in l.lower()), "")
        nums = re.findall(r"\d+", row)
        check("Eval: five-row interval numbers match the fixture",
              nums == ["8", "13", "18", "23", "28"]
              and all(f"| {n} |" in crit for n in (8, 13, 18, 23, 28)),
              f"observed {nums}")
        check("Eval: tab-calculation failure matches the fixture",
              "fifth-week tab" in cells and "fourth week" in cells
              and "2026-08-27" in crit and "8월 5주" in crit and "8월 4주" in crit)
        # **The grading criteria were also outside the contract population** — outside the skill directory (`evals/`)
        # It is not caught in walk, and the above two tests only look at numbers and dates, so only those few lines are left.
        # Even if it was reduced to a shell, it passed (hostile verification). The scoring criteria is based on the volume of the substance.
        _crit_needles = ["8월 5주", "8월 4주", "2026-08-27"]
        _crit_vol = content_bytes(crit, _crit_needles)
        check("Eval: criteria volume (>= 758B)", _crit_vol >= 758, f"{_crit_vol}B")

    # **The skeleton passes through with only the needle.** Only the line containing the needle is left.
    # Even if 67-85% of the text was erased through mechanical reduction, it was still abstract (10th review verification).
    # The defects fixed in the dev layer in the 12th round were still present in the 9 skills of the work layer.
    # Line survival rate (70%%), volume, and blob binding control the reduction.
    check_skill_body(check, ROOT, needles=[
        'daily draft mail',
        'gws',
        'tab',
        'row',
        'do not treat unknown as pass',
    ], floor=5374)

    check_no_constant_assertions(check, __file__)
    # **Outputs that were outside the population are brought here.** `check_contract_coverage`
    # `scheduler/` as the non-contract directory, `.txt`·`.plist`·`.service`·`.ps1`
    # Exclude non-contract extensions, and do not look at anything outside the skill directory (`commands/`·`evals/`)
    # No. So, even if the seven outputs were made with 0 bytes, they were all green.
    # `per_file` is a list that **measures what is declared**, so if you write it here, it will be measured.
    check_contract_coverage(check, __file__, ROOT, per_file={
        "SKILL.md": 30,
        "references/collect-all-projects.md": 3,
        "references/daily-draft-automation.md": 5,
        "references/draft-first-workflow.md": 3,
        "references/gdrive-ids.md": 4,
        "references/gws-cli.md": 3,
        "references/report-judgment.md": 9,
        "references/report-troubleshooting.md": 3,
        "references/scrum-cells.md": 12,
        "references/sheets-troubleshooting.md": 3,
        "scheduler/scrum-draft.plist": 5,
        "scheduler/crontab.txt": 3,
        "scheduler/register-task.ps1": 2,
        "scheduler/scrum-draft.service": 3,
        "scheduler/scrum-draft.timer": 4,
        SETUP_REL: 11,
        "../../evals/discriminating/workspace-scrum-rows/graders/criteria.md": 3,
    }, live_ran=sum(1 for r in results
                                      if not r[0].startswith(("자기검사:", "계약 커버리지:"))))

    check_body_deletion(check, __file__, ROOT, minimum=59,
                        extra_strip=["references/scrum-cells.md", "references/gdrive-ids.md", "references/report-judgment.md", "references/daily-draft-automation.md"],
                        live_ran=sum(1 for r in results
                                      if not r[0].startswith(("자기검사:", "계약 커버리지:"))))


    # **Crack the number of prosecutors.** One reference and the contract, floor value, and frozen copy.
    # When erased together, 4 contracts disappear without anything turning red (10th verification).

    # **Measure the `scripts/` contract separately.** Document deletion regression changes script behavior.
    # Ash doesn't catch the prosecutor — because emptying the document doesn't actually cause it to fail.
    # The 12th review changed all ensure 3-value contracts to progressive contracts and received abstracts.
    # **3 types of collection scripts that were not measured.** Even when empty, there were 0 failures —
    # If there is no inspection at all, the file will not receive any contracts.
    # Each bets on actually losing.
    # Does SKILL.md **instruct** this procedure. There is only a script and a place to call
    # If you don't have it, no one will call you — an orphaned script is not a contract.
    check("SKILL.md: requires token expiry check before writing",
          "token_check.py" in skill and "Before writing, check token expiry again" in skill)
    check("SKILL.md: does not treat indeterminate status as pass",
          "do not treat unknown as pass" in skill)

    # **Token expiration pre-check (Y-5).** Expiration occurs in the middle of execution and by then
    # A partial record remains. So the value of this script is not "0 when valid"
    # It lies in **not giving 0 when you don’t know** — If you read ‘unable to pass’ as ‘pass’, the dictionary
    # Now that it has been confirmed, nothing can stop it. Create 6 states with fixtures.
    import datetime as _dt
    import json as _json

    tokdir = tempfile.mkdtemp()

    def _mkacct(name, files):
        d = os.path.join(tokdir, name)
        os.makedirs(d, exist_ok=True)
        for fn, body in files.items():
            with io.open(os.path.join(d, fn), "w", encoding="utf-8") as f:
                f.write(body)
        return d

    def _iso(minutes):
        t = _dt.datetime.now(_dt.timezone.utc) + _dt.timedelta(minutes=minutes)
        return t.strftime("%Y-%m-%dT%H:%M:%SZ")

    def run_token(base, *extra):
        r = subprocess.run([sys.executable, TOKEN_CHECK, "--config-base", base,
                            *extra], capture_output=True, text=True)
        return r.returncode, r.stdout

    SECRET = "ya29.SECRET-TOKEN-VALUE"
    _mkacct("gws-valid", {"token.json": _json.dumps(
        {"access_token": SECRET, "expiry": _iso(600)})})
    _mkacct("gws-expired", {"token.json": _json.dumps(
        {"access_token": SECRET, "expiry": _iso(-5)})})
    _mkacct("gws-soon", {"token.json": _json.dumps(
        {"access_token": SECRET, "expiry": _iso(3)})})
    _mkacct("gws-none", {"README": "인증 전 디렉토리"})
    _mkacct("gws-enc", {"credentials.enc": "\x00binary"})
    _mkacct("gws-epoch", {"token.json": _json.dumps(
        {"access_token": SECRET,
         "expires_at": int((_dt.datetime.now(_dt.timezone.utc)
                            + _dt.timedelta(minutes=600)).timestamp())})})
    _mkacct("gws-epochms", {"token.json": _json.dumps(
        {"access_token": SECRET,
         "expiry_date": int((_dt.datetime.now(_dt.timezone.utc)
                             + _dt.timedelta(minutes=600)).timestamp()) * 1000})})

    # **Anomalous forms are placed together.** The above 7 types are all normal, so the antagonism has no meaning.
    # Even if you reverse it in nine places (Unknown->Pass · Broken JSON->Pass · `--json` is unconditionally 0 ·
    # Pattern default `*` · Shrink TOKEN_FILES · Change default margins · Broken RFC3339
    # "valid forever" · naive expiration tz offset · isdir filter removal) It was all green.
    # fail-closed **cannot be measured with normal input.**
    def _iso_naive(minutes):
        t = _dt.datetime.now(_dt.timezone.utc) + _dt.timedelta(minutes=minutes)
        return t.strftime("%Y-%m-%dT%H:%M:%S")          # no timezone

    def _iso_off(minutes, hours):
        tz = _dt.timezone(_dt.timedelta(hours=hours))
        t = (_dt.datetime.now(_dt.timezone.utc)
             + _dt.timedelta(minutes=minutes)).astimezone(tz)
        return t.isoformat(timespec="seconds")          # ...+09:00

    _mkacct("gws-nofield", {"token.json": _json.dumps({"access_token": SECRET})})
    _mkacct("gws-badjson", {"token.json": '{"access_token": "' + SECRET + '", 깨짐'})
    _mkacct("gws-badiso", {"token.json": _json.dumps(
        {"access_token": SECRET, "expiry": "2026-13-45T99:99:99Z"})})
    _mkacct("gws-naive-ok", {"token.json": _json.dumps(
        {"access_token": SECRET, "expiry": _iso_naive(20)})})
    _mkacct("gws-naive-past", {"token.json": _json.dumps(
        {"access_token": SECRET, "expiry": _iso_naive(-20)})})
    _mkacct("gws-offset-ok", {"token.json": _json.dumps(
        {"access_token": SECRET, "expiry": _iso_off(20, 9)})})
    _mkacct("gws-offset-past", {"token.json": _json.dumps(
        {"access_token": SECRET, "expiry": _iso_off(-20, 9)})})
    _mkacct("gws-soon7", {"token.json": _json.dumps(
        {"access_token": SECRET, "expiry": _iso(7)})})
    _mkacct("gws-ok20", {"token.json": _json.dumps(
        {"access_token": SECRET, "expiry": _iso(20)})})
    _mkacct("gws-cred", {"credentials.json": _json.dumps(
        {"access_token": SECRET, "expiry": _iso(600)})})
    _mkacct("gws-oauth", {"oauth_token.json": _json.dumps(
        {"access_token": SECRET, "expiry": _iso(600)})})

    # Since _only/_base produces a new mkdtemp each time, each call leaves behind a directory.
    # Collect them here and close them together when cleaning tokdir below (if not closed, gws-*
    # About 10 symbolic link directories of the same name are accumulated for each execution).
    _only_dirs = []

    def _only(*names):
        """Create a temporary base exposing only named accounts via symlinks."""
        b = tempfile.mkdtemp()
        _only_dirs.append(b)
        for n in names:
            os.symlink(os.path.join(tokdir, n), os.path.join(b, n))
        return b

    def _base(links=(), files=()):
        """Create a base with renamed links or entries that are not directories."""
        b = tempfile.mkdtemp()
        _only_dirs.append(b)
        for name, target in links:
            os.symlink(os.path.join(tokdir, target), os.path.join(b, name))
        for name in files:
            with io.open(os.path.join(b, name), "w", encoding="utf-8") as f:
                f.write("이것은 디렉토리가 아니다\n")
        return b

    empty = tempfile.mkdtemp()
    _only_dirs.append(empty)
    rc, out = run_token(empty)
    check("Token: zero accounts is not a pass (exit 2)", rc == 2 and "[2]" in out,
          f"exit={rc}")

    rc, out = run_token(_only("gws-valid"))
    check("Token: token with sufficient time returns exit 0", rc == 0 and "[0]" in out, f"exit={rc}")

    rc, out = run_token(_only("gws-expired"))
    check("Token: expired token returns exit 1", rc == 1 and "expired" in out, f"exit={rc}")

    rc, out = run_token(_only("gws-soon"))
    check("Token: expiry within the margin returns exit 1", rc == 1 and "soon" in out,
          f"exit={rc}")
    # The same fixture must pass if it closes the margin — the imminent verdict is on `--margin`
    # See if it's actually tied up. If it is a constant, these two give the same value.
    rc0, _ = run_token(_only("gws-soon"), "--margin", "1")
    check("Token: imminent verdict depends on --margin", rc0 == 0, f"exit={rc0}")

    rc, out = run_token(_only("gws-none"))
    check("Token: missing token file returns unauthenticated exit 1", rc == 1 and "none" in out,
          f"exit={rc}")

    rc, out = run_token(_only("gws-enc"))
    check("Token: encrypted storage is indeterminate exit 2",
          rc == 2 and "unknown" in out, f"exit={rc}")

    # **Confirmed expiration precedes impossible roll.** When the two are mixed, a 2 is given.
    # All that remains is “Check for yourself,” and already confirmed measures are buried.
    rc, out = run_token(_only("gws-expired", "gws-enc"))
    check("Token: confirmed expiry (1) takes precedence over indeterminate (2)", rc == 1, f"exit={rc}")

    rc, out = run_token(_only("gws-valid", "gws-epoch", "gws-epochms"))
    check("Token: all three valid accounts return exit 0", rc == 0 and "All 3 accounts" in out,
          f"exit={rc}")
    check("Token: reads epoch seconds and milliseconds",
          out.count("ok") >= 3, out.splitlines()[:3])

    # This output is logged and sent by email. If token values ​​are mixed, it itself is a leak.
    rc, out = run_token(_only("gws-valid", "gws-expired", "gws-enc", "gws-none"))
    check("Token: output does not leak token values", SECRET not in out,
          "output contains access_token")


    # ── fail-closed 9 axes. Each axis is measured in a format that turns red when the meaning is reversed.
    rc, out = run_token(_only("gws-nofield"))
    check("Token: missing expiry field is indeterminate, not pass (exit 2)",
          rc == 2 and "unknown" in out, f"exit={rc}")

    rc, out = run_token(_only("gws-badjson"))
    check("Token: malformed JSON does not pass (exit 2)",
          rc == 2 and "unknown" in out, f"exit={rc}")

    rc, out = run_token(_only("gws-badiso"))
    check("Token: malformed RFC3339 is not treated as valid forever (exit 2)",
          rc == 2 and "unknown" in out, f"exit={rc}")

    # `--json` is an expression format, not a judgment bypass. If you unconditionally set 0, automation will occur.
    # I start writing without seeing the expiration date.
    json_rc = {}
    json_out = {}
    for _acct in ("gws-valid", "gws-expired", "gws-enc"):
        json_rc[_acct], json_out[_acct] = run_token(_only(_acct), "--json")
    check("Token: --json preserves exit-code verdicts",
          (json_rc["gws-valid"], json_rc["gws-expired"], json_rc["gws-enc"])
          == (0, 1, 2), str(json_rc))
    def _json_block(txt):
        """Extract only the leading JSON array from stdout.

        `--json` currently appends guidance and a `[1]` marker after the array,
        so the complete stdout is not valid JSON. Preserve that known defect here
        and inspect only the array to test whether it carries the verdict.
        """
        lines = txt.splitlines()
        for i, ln in enumerate(lines):
            if ln.rstrip() == "]":
                try:
                    return _json.loads("\n".join(lines[: i + 1]))
                except ValueError:
                    return None
        return None

    _parsed = [_json_block(t) for t in json_out.values()]
    check("Token: --json output contains verdicts without token values",
          all(isinstance(x, list) and x and "verdict" in x[0] for x in _parsed)
          and not any(SECRET in t for t in json_out.values()),
          str(_parsed)[:70])

    # If the basic pattern is widened to `*`, directories unrelated to gws are mixed in the decision.
    pat_base = _base(links=[("gws-valid", "gws-valid"),
                            ("other-expired", "gws-expired")])
    rc, out = run_token(pat_base)
    check("Token: default pattern is gws-*, not *",
          rc == 0 and "All 1 accounts" in out, f"exit={rc}")
    rc, out = run_token(pat_base, "--pattern", "other-*")
    check("Token: --pattern actually changes the target",
          rc == 1 and "other-expired" in out, f"exit={rc}")

    # If TOKEN_FILES is reduced, the account saved under that name will be misjudged as 'unverified'.
    tok_rc = {n: run_token(_only(n))[0] for n in ("gws-cred", "gws-oauth")}
    check("Token: reads credentials.json and oauth_token.json as token files",
          set(tok_rc.values()) == {0}, str(tok_rc))

    # Nail the basic margin **on both sides** — 7 minutes close, 20 minutes to spare.
    rc7, _ = run_token(_only("gws-soon7"))
    rc20, _ = run_token(_only("gws-ok20"))
    check("Token: default margin is 10 minutes (7 imminent, 20 safe)",
          rc7 == 1 and rc20 == 0, f"7min={rc7} 20min={rc20}")

    # If you read the naive expiration in local time, it will be completely off by the offset.
    rcn, _ = run_token(_only("gws-naive-ok"))
    rcnp, _ = run_token(_only("gws-naive-past"))
    check("Token: timezone-naive expiry is interpreted as UTC",
          rcn == 0 and rcnp == 1, f"+20min={rcn} -20min={rcnp}")
    rco, _ = run_token(_only("gws-offset-ok"))
    rcop, _ = run_token(_only("gws-offset-past"))
    check("Token: converts offset notation (+09:00) to an instant",
          rco == 0 and rcop == 1, f"+20min={rco} -20min={rcop}")

    # If the isdir filter is omitted, one file becomes an 'unauthenticated account' and becomes exit 1.
    file_base = _base(links=[("gws-valid", "gws-valid")], files=["gws-notadir"])
    rc, out = run_token(file_base)
    check("Token: does not count non-directory entries as accounts",
          rc == 0 and "All 1 accounts" in out, f"exit={rc}")

    shutil.rmtree(tokdir, ignore_errors=True)
    for _d in _only_dirs:
        shutil.rmtree(_d, ignore_errors=True)

    CG = read(os.path.join(ROOT, "scripts", "collect_git.sh"))
    check("Collection: collect_git accepts GITHUB_DIR from the environment",
          'GITHUB_DIR="${GITHUB_DIR:-' in CG)
    check("Collection: collect_git requires SINCE",
          'SINCE="${1:?' in CG, "must print usage and stop without an argument")
    check("Collection: collect_git supports author filtering",
          "GIT_COLLECT_AUTHOR" in CG)
    check("Collection: collect_git reports a missing target directory",
          "Collection directory does not exist" in CG)

    CM = read(os.path.join(ROOT, "scripts", "collect_by_mtime.sh"))
    check("Collection: collect_by_mtime accepts GITHUB_DIR from the environment",
          'GITHUB_DIR="${GITHUB_DIR:-' in CM)
    check("Collection: collect_by_mtime accepts the cutoff date", "SINCE_DATE=" in CM)
    check("Collection: both scripts use the same default path",
          'GITHUB_DIR:-$HOME/Documents/GitHub' in CG
          and 'GITHUB_DIR:-$HOME/Documents/GitHub' in CM)

    # ── **Measured by executing the collection script.** The above four tests are called string grep.
    # Even if you replace them with stubs containing the same word, they all pass (hostile verification). the script
    # Losing is “what you collect and what you don’t collect,” so it’s spinning in the fixture.
    cfx = tempfile.mkdtemp()
    try:
        repo_a = os.path.join(cfx, "repo-a")
        plain_c = os.path.join(cfx, "plain-c")
        os.makedirs(repo_a)
        os.makedirs(plain_c)
        with io.open(os.path.join(repo_a, "a.txt"), "w", encoding="utf-8") as f:
            f.write("x\n")
        _git(repo_a, "init", "-q")
        _git(repo_a, "add", "-A")
        _git(repo_a, "commit", "-q", "-m", "내커밋-제목")
        with io.open(os.path.join(repo_a, "b.txt"), "w", encoding="utf-8") as f:
            f.write("y\n")
        _git(repo_a, "add", "-A")
        _git(repo_a, "-c", "user.name=남", "-c", "user.email=other@e",
             "commit", "-q", "-m", "남의커밋-제목",
             "--author", "남 <other@e>")
        with io.open(os.path.join(plain_c, "README.md"), "w", encoding="utf-8") as f:
            f.write("플레인 프로젝트 설명\n둘째 줄\n셋째 줄\n넷째 줄\n")
        with io.open(os.path.join(plain_c, "새작업.md"), "w", encoding="utf-8") as f:
            f.write("z\n")

        today = _dt.date.today()
        d_yest = (today - _dt.timedelta(days=1)).isoformat()
        d_tomorrow = (today + _dt.timedelta(days=1)).isoformat()

        def run_cg(*args, github_dir=cfx, author=None):
            env = dict(os.environ, GITHUB_DIR=github_dir)
            if author is None:
                env.pop("GIT_COLLECT_AUTHOR", None)
            else:
                env["GIT_COLLECT_AUTHOR"] = author
            r = subprocess.run(["bash", os.path.join(ROOT, "scripts", "collect_git.sh"),
                                *args], capture_output=True, text=True, env=env)
            return r.returncode, r.stdout, r.stderr

        rc, out, err = run_cg()
        check("Collection runtime: collect_git stops without a cutoff date",
              rc != 0 and "Usage:" in err, f"exit={rc} {err.strip()[:50]}")

        rc, out, err = run_cg(d_yest, github_dir=os.path.join(cfx, "__없다__"))
        check("Collection runtime: missing target directory returns exit 2",
              rc == 2 and "Collection directory does not exist" in err, f"exit={rc}")

        rc, out, err = run_cg(d_yest)
        check("Collection runtime: collects Git commits and skips non-Git directories",
              rc == 0 and "## repo-a" in out and "내커밋-제목" in out
              and "## plain-c" not in out, out.strip()[:70])

        rc, out, err = run_cg(d_yest, author="남")
        check("Collection runtime: author filter retains only matching commits",
              rc == 0 and "남의커밋-제목" in out and "내커밋-제목" not in out,
              out.strip()[:70])

        rc, out, err = run_cg(d_tomorrow)
        check("Collection runtime: excludes commits before the cutoff date",
              rc == 0 and "내커밋-제목" not in out and "남의커밋-제목" not in out,
              out.strip()[:70])

        def run_cm(since, github_dir=cfx):
            r = subprocess.run(["bash", os.path.join(ROOT, "scripts",
                                                     "collect_by_mtime.sh"), since],
                               capture_output=True, text=True,
                               env=dict(os.environ, GITHUB_DIR=github_dir))
            return r.returncode, r.stdout

        rc, out = run_cm(d_yest)
        check("Collection runtime: collect_by_mtime supplements non-Git projects",
              "## plain-c" in out and "새작업.md" in out, out.strip()[:70])
        check("Collection runtime: collect_by_mtime skips Git repositories",
              "## repo-a" not in out, out.strip()[:70])
        check("Collection runtime: collect_by_mtime quotes the README opening",
              "> 플레인 프로젝트 설명" in out, out.strip()[:70])
        rc, out = run_cm(d_tomorrow)
        check("Collection runtime: excludes projects unchanged since the cutoff date",
              "## plain-c" not in out and "## repo-a" not in out, out.strip()[:70])
        check("Collection runtime: both scripts share the default GITHUB_DIR",
              subprocess.run(["bash", "-c",
                              f'unset GITHUB_DIR; HOME=/__no_home__ bash '
                              f'"{os.path.join(ROOT, "scripts", "collect_git.sh")}" '
                              f'{d_yest} 2>&1 | tail -2'],
                             capture_output=True, text=True).stdout
              .find("/__no_home__/Documents/GitHub") >= 0,
              "collect_git default must be $HOME/Documents/GitHub")
    finally:
        shutil.rmtree(cfx, ignore_errors=True)

    PS = read(os.path.join(ROOT, "scripts", "daily_draft_mail.ps1"))
    check("Automatic delivery: ps1 survives a partial failure",
          "$ErrorActionPreference = 'Continue'" in PS,
          "one blocked source must not prevent other collection")
    check("Automatic delivery: ps1 accepts SCRUM_MAIL_TO without embedding an address",
          "SCRUM_MAIL_TO" in PS)
    check("Automatic delivery: ps1 and sh use the same environment variable names",
          all(v in PS for v in ("SCRUM_MAIL_TO", "GITHUB_DIR")),
          "different variable names would make the shared documentation false")
    # **pwsh does not exist in this environment.** Since it cannot be measured by execution, it is locked with needle + volume —
    # The three tests above passed even when replaced with a stub containing only three words (hostile verification).
    _ps_needles = ["param(", "-NoSend", "Find-Bin", "Write-Log",
                   "$ErrorActionPreference = 'Continue'", "gmail +send",
                   "claude", "Get-ChildItem"]
    _ps_miss = [n for n in _ps_needles if n not in PS]
    check("Automatic delivery: ps1 contains the collect, draft, and send flow",
          not _ps_miss, f"missing {_ps_miss}")
    _ps_vol = content_bytes(PS, _ps_needles)
    check("Automatic delivery: ps1 volume (>= 6361B)", _ps_vol >= 6361, f"{_ps_vol}B")

    # **Enable the deletion guard.** This axis previously inspected only `fails`, so
    # it missed checks that **disappeared** when a script copy was emptied: deletion
    # evaporated verdicts instead of adding failures, and failure counts hid the loss.
    # This call is at the end of the suite, followed only by `check_total`, so the
    # `live_ran` measured here matches the full suite executed for a deleted copy.
    # Calling it earlier would turn every later check into unmeasured free margin.
    # Exclude `script contract:` because `check_script_contracts` returns early under
    # `in_deleted_run()`, so those verdicts do not exist on the copy side. Both live
    # and copy counts must subtract the same prefixes to enforce zero margin.
    _OFF = ("자기검사:", "계약 커버리지:", "스크립트 계약:")
    check_script_contracts(check, __file__, ROOT, scripts={
        "scripts/daily_draft_mail.sh": 21,
        "scripts/collect_git.sh": 10,
        "scripts/collect_by_mtime.sh": 5,
        "scripts/daily_draft_mail.ps1": 5,
        "scripts/ensure_gws.sh": 4,
        "scripts/token_check.py": 20,
    }, live_ran=sum(1 for r in results if not r[0].startswith(_OFF)),
        extra_skip=("스크립트 계약:",))
    check_total(check, results, 207)
    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n{passed}/{len(results)} 통과")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
