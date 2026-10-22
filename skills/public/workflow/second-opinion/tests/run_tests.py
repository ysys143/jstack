#!/usr/bin/env python3
"""consult contract suite.

Run: python3 tests/run_tests.py   (from skills/consult)

## What this locks

1. **Ask to be refuted** — "does this look right?" reliably returns yes, and the
   phrasing is the whole intervention.
2. **Withhold your reasoning** — a reviewer given your argument tests the
   argument, not the artefact.
3. **A verdict is evidence, not permission** — approval does not transfer
   responsibility or make an unverified claim true.
4. **Different angles, not repeated ones** — repetition finds the same thing
   more times.
5. **The two real backends are wired the way the prose promises** — `agy` for
   a single document reviewer, `agy`+Codex in parallel for a panel, neither
   backend reachable through a path hardcoded to `~/.claude/plugins`.
6. **The panel is read without averaging it away** — role is not a lens,
   disagreement is the deliverable, and no verdict is a consensus of two.
7. **The Codex call in the panel cannot write** — `--sandbox read-only`,
   never `workspace-write`, exercised against a stub binary so a regression
   in the flag actually turns this red.
8. **The temp-file names are actually unique** — every `mktemp` template ends
   in its X run, measured by calling `mktemp` twice, because BSD `mktemp`
   silently returns a fixed name when a suffix follows the X's and that made
   this suite non-deterministic.
9. **The rules the predecessor plugin learned the hard way survive** — no
   `-m` model flag, `--skip-git-repo-check` kept, mode prefixes carried,
   both API keys exported, output through `printf` not `echo`, the headless
   flag kept, and the three-stage `timeout` fallback — each measured against
   stub binaries rather than asserted in prose.
"""
import os
import re
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
from _suite_lib import (  # noqa: E402
    check_no_constant_assertions, check_total, check_skill_body,
    check_ref_contracts, split_frontmatter, check_body_deletion,
    check_contract_coverage, check_script_contracts,
)
ROOT = os.path.dirname(HERE)
SKILLS = os.path.dirname(ROOT)
SCRIPTS = os.path.join(ROOT, "scripts")

results = []

# All floors are measured with zero slack. Slack allows equivalent deletion
# to stay green (ai-council.md once had 39%, enough to lose a whole section).
# Raise floors when documents grow; explain intentional reductions here.
SKILL_FLOOR = 5097
FR_FLOOR = 1469
AC_FLOOR = 4163
GE_FLOOR = 4187
SG_FLOOR = 4250
KO_FLOOR = 27  # Same trigger population; translated the non-trigger label 트리거 to Triggers.
OWNED_MIN = 8
L0_TRIGGERS = ('"코덱스한테 물어봐"', '"제미나이한테 물어봐"', '"AI 의견 모아"',
               '"교차 검증"', '"패널로 돌려"', '"다른 모델한테 물어봐"',
               '"ai council"', '"cross verify"')


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))


def read(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


def rows(text, head):
    """Return table data rows under `## head`; a missing section returns an empty list."""
    if head not in text:
        return []
    body = text.split(head, 1)[1].split("\n## ", 1)[0]
    return [r for r in re.findall(r"(?m)^\| (?!---)(.+?) \|", body)
            if r.strip() not in ("Ask", "Send", "Instead of")]


# ---------------------------------------------------------------------------
# Script measurement never invokes actual agy/codex. Stub binaries and isolated
# HOME/PATH measure available, unauthenticated, and missing states plus execution
# paths, following delegate/tests/run_tests.py.
# ---------------------------------------------------------------------------

def mkstub(dirpath, name, body):
    p = os.path.join(dirpath, name)
    with open(p, "w", encoding="utf-8") as f:
        f.write(body)
    os.chmod(p, 0o755)
    return p


def run_script(name, args, *, path, home, extra_env=None, timeout=10, input_text=None):
    """Run a script in an isolated environment.

    Pin HOME to an empty temporary directory so nvm sourcing and apikey.env
    cannot restore this machine's GEMINI_API_KEY or real nvm node. Rebuild
    PATH completely to keep actual agy/codex binaries out.
    """
    env = {"HOME": home, "PATH": path, "TMPDIR": tempfile.gettempdir()}
    if extra_env:
        env.update(extra_env)
    r = subprocess.run(["bash", os.path.join(SCRIPTS, name), *args],
                       capture_output=True, text=True, env=env, timeout=timeout,
                       input=input_text)
    return r.returncode, r.stdout, r.stderr


SAFE_PATH = "/usr/bin:/bin"  # Missing-state control: agy/codex are not installed here.


def mktemp_templates(src):
    """Extract mktemp templates as (is_directory, template) from script source."""
    return [(bool(d.strip()), t)
            for d, t in re.findall(r'mktemp(\s+-d)?\s+"([^"]+)"', src)]


def minimal_bin(dirpath):
    """Build a PATH directory linking only utilities explicitly invoked by name.

    Measuring _timeout's three-stage fallback (timeout, gtimeout, direct)
    requires a PATH without either timeout command. /usr/bin always exposes
    timeout on coreutils installations (normally Linux), hiding stage three
    and making BUG-6's contract machine-specific. Include only required tools.
    """
    need = ("bash", "cat", "sed", "mktemp", "rm", "dirname", "xargs", "python3")
    roots = ("/usr/bin", "/bin", "/usr/local/bin", "/opt/homebrew/bin")
    linked = []
    for n in need:
        for r in roots:
            c = os.path.join(r, n)
            if os.path.exists(c):
                os.symlink(c, os.path.join(dirpath, n))
                linked.append(n)
                break
    return linked


def mktemp_twice(is_dir, template, tmpdir):
    """Invoke actual mktemp twice per template and return both resulting paths.

    BSD mktemp on macOS does not replace X placeholders followed by a suffix:
    name-XXXXXXXX.txt always names one file, so the second call fails with
    File exists. Multiple bridge runs per suite exposed this collision as
    nondeterministic counts (oscillating between 148 and 141). Preserve empty
    strings from failed calls so the verdict sees them.
    """
    got = []
    for _ in range(2):
        r = subprocess.run(
            ["bash", "-c", 'mktemp %s "%s"' % ("-d" if is_dir else "", template)],
            capture_output=True, text=True,
            env={"PATH": SAFE_PATH, "TMPDIR": tmpdir})
        got.append(r.stdout.strip() if r.returncode == 0 else "")
    return got


def read_nul_capture(path):
    """Read NUL-delimited argv captures; missing captures return an empty list.

    Newline-delimited captures break when prompts contain newlines. Council
    and gemini bridges pass prompts as agy arguments instead of stdin. NUL
    cannot occur inside a prompt string, making it a safe delimiter.
    """
    if not os.path.exists(path):
        return []
    with open(path, "rb") as f:
        data = f.read()
    return [p.decode("utf-8", "replace") for p in data.split(b"\0") if p != b""] \
        if data else []


def main():
    fm, skill = split_frontmatter(read(os.path.join(ROOT, "SKILL.md")))
    fr = read(os.path.join(ROOT, "references", "framing.md"))
    ac = read(os.path.join(ROOT, "references", "ai-council.md"))
    ge = read(os.path.join(ROOT, "references", "gemini.md"))
    sg = read(os.path.join(ROOT, "references", "synthesis-guide.md"))

    # (1) Require refutation.
    check('Request: states that asking whether it looks right invites yes',
          "gets you a yes" in skill)
    check('Request: identifies framing as the cause',
          "The framing does the work" in skill)
    check('Request: identifies finding nothing as the implied reviewer task',
          "finding nothing" in skill)
    check('Request: provides a concrete opposing question',
          "What is wrong with this, and what would prove" in skill)
    check('Request: explains how it makes silence expensive',
          "makes silence expensive" in skill)
    check('Request: treats finding nothing as a claim that must stand',
          "has to stand" in skill)
    tbl = rows(skill, '## "Does this look right?" gets you a yes')
    check('Request: question/response comparison has 4 rows', len(tbl) == 4, f"{len(tbl)} rows")

    # (2) Withhold the author's argument.
    check('Framing: requires withholding the argument',
          "withhold why you believe it works" in skill)
    check('Framing: explains that supplying an argument elicits argument evaluation',
          "evaluates the argument" in skill)
    check('Framing: identifies defects outside the supplied argument',
          "your argument does not cover" in skill)
    check('Framing: requires supplying facts the reviewer cannot obtain',
          "cannot obtain" in skill)
    sp = rows(fr, "## The split")
    check('Framing: send/withhold comparison has 4 rows', len(sp) == 4, f"{len(sp)} rows")
    check('Framing: supply inaccessible facts and withhold inferable conclusions',
          "**inaccessible**" in fr and "**inferable**" in fr)
    check('Framing: identifies the conclusion as the test subject',
          "thing being tested" in fr)
    check('Framing: supplying the conclusion replaces the test with argument review',
          "replaces the test with a review" in fr)

    # (3) A verdict is evidence, not permission.
    check('Verdict: explicitly denies permission',
          "A verdict is evidence, not permission" in skill)
    check('Verdict: scopes approval to one reviewer and one framing',
          "one reviewer found nothing under one framing" in skill)
    check('Verdict: responsibility does not transfer',
          "does not\ntransfer responsibility" in skill
          or "does not transfer responsibility" in skill)
    check('Verdict: requires running testable verdicts',
          "rather than filing it" in skill)
    check('Verdict: a disputed rejection is also evidence',
          "also evidence" in skill)
    check('Verdict: the artifact or its presentation is wrong and both are worth fixing',
          "both are\nworth fixing" in skill or "both are worth fixing" in skill)

    # (4) Reviewers without isolation function as one reviewer.
    check('Independence: reviewers who read one another agree by construction',
          "agree by construction" in skill)
    check('Independence: each reviewer receives no other reviewer output',
          "no access to the others" in skill)
    check('Independence: repeated angles find the same thing more times',
          "finds the same thing more times" in skill)
    check('Independence: supplies examples of distinct angles',
          "what a hostile user does" in skill)

    # (5) Require testable refutations.
    check('Specificity: requires concrete failures instead of categories',
          "rather than a\ncategory" in fr or "rather than a category" in fr)
    check('Specificity: illustrates why category claims cannot be acted on or dismissed',
          "cannot be acted on or dismissed" in fr)
    check('Specificity: supplies an executable example',
          "with the lock released" in fr)
    check('Specificity: records categories as unverified instead of findings',
          "as unverified rather than as a finding" in fr)
    check('Specificity: explains their different failure modes',
          "a category gets forgotten" in fr)

    # (6) When the reviewer is a model.
    check('Model: fluent answers can lack grounds',
          "whether or not it has grounds" in fr)
    check('Model: requires evidence with the verdict',
          "ask\nfor the evidence with the verdict" in fr
          or "ask for the evidence with the verdict" in fr)
    check('Model: an unsupported verdict is a different object from a weak finding',
          "a different kind of object" in fr)
    check('Model: explains half-fixes caused by treating unsupported verdicts as weak findings',
          "get half-fixed" in fr)
    ph = rows(fr, "## Phrasings that make refutation the default")
    check('Model: phrasing comparison has 4 rows', len(ph) == 4, f"{len(ph)} rows")
    check('Model: identifies the shared property of the right-hand alternatives', "has to\nsay so explicitly" in fr
          or "say so explicitly" in fr)
    check('Model: no issue is a claim whereas silence is not',
          "silence is not" in fr)

    # (7) Do not consult merely to postpone a decision.
    check('Restraint: consultation is ceremony if the answer cannot change the path',
          "the consultation is\nceremony" in skill or "consultation is ceremony" in skill)
    check('Restraint: first asks what the answer would change',
          "what the answer would change first" in skill)

    # (8) Boundaries and language.
    named = set(re.findall(r"`([a-z][a-z-]{2,})`\s*skill", skill))
    missing = [n for n in named if not os.path.isdir(os.path.join(SKILLS, n))]
    check('Boundary: redirect target population is nonempty', len(named) >= 2, f"{sorted(named)}")
    check('Boundary: all redirect targets exist', not missing, f"missing {missing}")
    ko = re.findall(r"[가-힣]+", fm)
    check(f'Language: description contains at least {KO_FLOOR} Korean tokens',
          len(ko) >= KO_FLOOR, f"{len(ko)} tokens")
    check('Language: includes English triggers', "proposal" in fm and "Triggers:" in fm)
    check('L0: description carries three contracts (refutation, framing, evidence)',
          "refutation rather than review" in fm
          and "inheriting your framing" in fm
          and "evidence rather than permission" in fm)
    # Backend invocation phrases cannot route here unless L0 advertises them.
    # A request to ask Codex belongs here, but a description missing those
    # terms prevents the harness from even considering this skill. That is a
    # reachability gap, not a wording preference.
    miss_t = [t for t in L0_TRIGGERS if t not in fm]
    check('L0: description includes literal backend invocation triggers',
          not miss_t, f"missing {miss_t}")
    check('L0: description advertises backend names (agy, codex, panel)',
          "`agy`" in fm and "`codex`" in fm and "council panel" in fm)
    check('L0: description identifies reviewers as external to internal subagents',
          "not internal subagents" in fm)

    # (9) SKILL.md actually cites each backend document and script.
    check('References: SKILL.md cites gemini.md',
          "references/gemini.md" in skill)
    check('References: SKILL.md cites ai-council.md',
          "references/ai-council.md" in skill)
    check('References: SKILL.md cites synthesis-guide.md',
          "references/synthesis-guide.md" in skill)
    check('References: SKILL.md cites council-bridge.sh',
          "scripts/council-bridge.sh" in skill)
    check('References: SKILL.md cites check-cli.sh',
          "scripts/check-cli.sh" in skill)
    check('References: SKILL.md cites parse-output.sh',
          "scripts/parse-output.sh" in skill)
    check('References: SKILL.md cites framing.md',
          "references/framing.md" in skill)
    check('References: SKILL.md cites gemini-bridge.sh within one hop',
          "scripts/gemini-bridge.sh" in skill)
    check('References: synthesis-guide.md redirects to framing.md within two hops',
          "references/framing.md" in sg)
    # Substring checks miss dead pointers: references/gemini.md.bak passes
    # the six checks above. Extract every backticked path and verify existence,
    # then check the reverse direction for uncited orphan files.
    cited = set(re.findall(r"`((?:references|scripts)/[A-Za-z0-9._-]+)`", skill))
    dead = sorted(c for c in cited if not os.path.exists(os.path.join(ROOT, c)))
    check('References: all backtick paths in SKILL.md exist (no dead pointers)',
          len(cited) >= OWNED_MIN and not dead, f"{len(cited)} citations / dead {dead}")
    owned = {f"references/{n}"
             for n in os.listdir(os.path.join(ROOT, "references"))} | \
            {f"scripts/{n}" for n in os.listdir(os.path.join(ROOT, "scripts"))}
    orphan = sorted(owned - cited)
    check('References: all references/ and scripts/ files are cited by SKILL.md (no orphans)',
          not orphan and len(owned) >= OWNED_MIN, f"orphans {orphan} / owned {len(owned)} files")
    check('Boundary: distinguishes the single backend (agy) from the panel (agy+Codex)',
          "one reviewer, one lens, no panel" in skill)
    check('Boundary: SKILL.md also states the three panel-reading rules',
          "role is not a lens, disagreement is the deliverable a panel" in skill)
    check('Boundary: SKILL.md fixes Codex panel invocation to read-only',
          "--sandbox read-only" in skill)
    check('Boundary: explains redirection to delegate because the panel does not write',
          "Handing Codex an actual\nwrite" in skill
          or "Handing Codex an actual write" in skill)
    check('Boundary: states that consultation cannot quietly become delegated work',
          "quietly become that" in skill)

    # (10) ai-council.md: panel backend documentation.
    check('Panel document: council-bridge.sh invocation uses the exact CLAUDE_PLUGIN_ROOT path',
          '${JSTACK_PLUGIN_ROOT}/skills/consult/scripts/council-bridge.sh' in ac)
    # A path inside a comment passes the check above; require an executable line.
    check('Panel document: council-bridge.sh invocation is executable rather than commented',
          any(ln.lstrip().startswith("bash ")
              for ln in ac.splitlines() if "council-bridge.sh" in ln),
          [ln for ln in ac.splitlines() if "council-bridge.sh" in ln])
    check('Panel document: forbids hardcoded ~/.claude/plugins paths',
          "do not\nhardcode a path under `~/.claude/plugins`" in ac
          or "do not hardcode a path under `~/.claude/plugins`" in ac)
    check('Panel document: explains why Codex is fixed to read-only',
          "it never touches a file" in ac)
    check('Panel document: records the previous workspace-write setting and its reason',
          "workspace-write" in ac and "read-only" in ac)
    check('Panel document: redirects to synthesis-guide to distinguish roles from lenses',
          "references/synthesis-guide.md" in ac)
    check("Panel document: does not install missing tools on the caller's behalf",
          "nothing is\ninstalled on the caller's behalf" in ac
          or "nothing is installed on the caller's behalf" in ac)

    # (11) gemini.md: single-backend documentation (actual backend: agy).
    check('Single-backend document: identifies agy as the backend and gemini-cli as deprecated',
          "successor to `gemini-cli`" in ge and "deprecated as of 2026-06-18" in ge)
    check('Single-backend document: gemini-bridge.sh invocation uses the exact CLAUDE_PLUGIN_ROOT path',
          '${JSTACK_PLUGIN_ROOT}/skills/consult/scripts/gemini-bridge.sh' in ge)
    check('Single-backend document: gemini-bridge.sh invocation is executable rather than commented',
          any(ln.lstrip().startswith("bash ")
              for ln in ge.splitlines() if "gemini-bridge.sh" in ln),
          [ln for ln in ge.splitlines() if "gemini-bridge.sh" in ln])
    check('Single-backend document: prohibits the -m model flag (BUG-5)',
          "Never pass a `-m` model flag" in ge
          and "must be a string" in ge)
    check('Single-backend document: output-processing step 1 reviews quality',
          "Review the quality first" in ge)
    check('Single-backend document: step 2 leaves adoption to the caller and does not edit files',
          "the caller's decision" in ge and "changes nothing" in ge)
    check('Single-backend document: step 3 reports failures too',
          "failures included" in ge)
    check('Single-backend document: documents the --print/--prompt token-consumption trap',
          "consumes the next token as its value" in ge)
    check('Single-backend document: identifies the GEMINI_API_KEY autoload path',
          "~/.oh-my-zsh/custom/apikey.env" in ge)
    check('Single-backend document: redirects to the panel (ai-council) and synthesis guide',
          "references/ai-council.md" in ge and "references/synthesis-guide.md" in ge)

    # (12) synthesis-guide.md: ported three-rule prism contract.
    check('prism: identifies taking the median as the failure mode',
          "taking the median of the models' opinions" in sg)
    check('prism: includes the role-versus-lens rule', "Role ≠ lens" in sg)
    check('prism: includes the disagreement-as-deliverable rule',
          "Disagreement is the deliverable" in sg)
    check('prism: forbids averaging', "Never average" in sg)
    check('prism: requires one resolving question per disagreement',
          "the single question that would resolve it" in sg)
    check('prism: explains why the final section is not named Recommendation',
          "not called \"Recommendation.\"" in sg)
    check('prism: identifies defaulting to the stricter side as hidden averaging',
          "is itself a hidden" in sg)
    st = rows(sg, "## The three rules")
    check('prism: three-rule section has no table (three prose items)', st == [])

    # (13) Five rules the bridge cannot enforce, inherited from legacy Critical Rules.
    check('Rules: prohibits bypassing bridges through direct agy/codex calls',
          "Never invoke `agy` or `codex` directly" in skill)
    check('Rules: explains lost sandbox, flag, and isolation guarantees when bypassed',
          "drops all three at once" in skill)
    check('Rules: internal Agent/Task cannot replace external AI',
          "Do not substitute an internal subagent for an external AI" in skill)
    check('Rules: explains the same-opinion-with-framing rationale',
          "the same opinion with the" in skill)
    check('Rules: records that hook gates were not inherited and why (session lock)',
          "deliberately **not** carried over" in skill
          and "strands the session" in skill)
    check('Rules: prohibits the -m model flag', "Never pass a `-m` model flag" in skill)
    check('Rules: records the reason for -m prohibition (v0.31.0 undefined model)',
          "undefined model inside its own SDK" in skill)
    check('Rules: reports exact stderr instead of improvising after bridge failure',
          "reported, not improvised around" in skill and "exact stderr" in skill)
    check('Rules: failure diagnosis points to check-cli.sh',
          'scripts/check-cli.sh" agy' in skill)
    check('Rules: unspecified targets use git diff --name-only HEAD for candidates',
          "git diff --name-only HEAD" in skill)
    check('Rules: empty candidates trigger a user question (no whole-repository transmission)',
          "ask the user which files to send" in skill
          and "send the whole repository" in skill)

    check_skill_body(check, ROOT, needles=[
        "gets you a yes",
        "withhold why you believe it works",
        "A verdict is evidence, not permission",
        "agree by construction",
        "what the answer would change first",
        "role is not a lens, disagreement is the deliverable a panel",
        "quietly become that",
        "reported, not improvised around",
    ], floor=SKILL_FLOOR)

    check_ref_contracts(check, ROOT, [
        ("framing.md", "Send/withhold, refutation phrasing, specificity, model reviewers",
         ["**inaccessible**", "silence is not",
          "as unverified rather than as a finding", "a different kind of object"],
         FR_FLOOR),
        # At least one needle per section. Four per file previously allowed
        # whole-section deletion within 39–48% volume slack. Bind sentences
        # inside each section so retaining headings while removing prose
        # cannot bypass the checks.
        ("ai-council.md", "Panel invocation, read-only rationale, model-flag prohibition, availability, boundaries",
         ['${JSTACK_PLUGIN_ROOT}/skills/consult/scripts/council-bridge.sh',
          "--sandbox read-only", "it never touches a file",
          "Council: N/M AIs responded\nsuccessfully.",
          "Both backends see",
          "expensive to act on unchecked",
          "resolved to an undefined model",
          "installed on the caller's behalf",
          "Handing Codex a write to actually execute"], AC_FLOOR),
        ("gemini.md", "Actual backend (agy), invocation, known pitfalls, output processing, boundaries",
         ['${JSTACK_PLUGIN_ROOT}/skills/consult/scripts/gemini-bridge.sh',
          "successor to `gemini-cli`", "deprecated as of 2026-06-18",
          "consumes the next token as its value",
          "Technical specification writing",
          "Never pass a `-m` model flag",
          "Review the quality first",
          "not to referee two"], GE_FLOOR),
        ("synthesis-guide.md", "Three prism rules, reading procedure, output format, code-review/research synthesis",
         ["Role ≠ lens", "Disagreement is the deliverable", "Never average",
          "taking the median of the models' opinions",
          "the panel's highest-confidence output",
          "A disputed point with no resolving question",
          "not automatically weaker",
          'not called "Recommendation."',
          "is itself a hidden",
          "grounds to check it, not grounds to trust it"], SG_FLOOR),
    ])

    # Measure distinct mktemp names on BSD too.
    for sname, want in (("gemini-bridge.sh", 2), ("council-bridge.sh", 2)):
        src = read(os.path.join(SCRIPTS, sname))
        tmpls = mktemp_templates(src)
        check(f'mktemp: {sname} contains {want} templates',
              len(tmpls) == want, f"{len(tmpls)} templates {[t for _, t in tmpls]}")
        check(f'mktemp: {sname} templates end in X placeholders (BSD substitution requirement)',
              len(tmpls) == want and all(re.search(r"X{6,}$", t) for _, t in tmpls),
              [t for _, t in tmpls])
        with tempfile.TemporaryDirectory() as mtd:
            pairs = [(t, mktemp_twice(d, t, mtd)) for d, t in tmpls]
        bad = [(t, g) for t, g in pairs
               if not (g[0] and g[1] and g[0] != g[1] and "XXXXXXXX" not in g[0])]
        check(f'mktemp: invoking {sname} templates twice produces distinct names',
              len(pairs) == want and not bad, f"collisions {bad}")
        # Install the trap before the first mktemp. If the second mktemp
        # fails, the first artifact otherwise remains forever. Council leaked
        # over 1000 temporary directories this way. Ignore comments; only
        # assignment lines containing $( count as mktemp calls.
        slines = src.splitlines()
        trap_at = next((i for i, ln in enumerate(slines)
                        if ln.lstrip().startswith("trap ")
                        and ln.rstrip().endswith("EXIT")), None)
        mk_at = next((i for i, ln in enumerate(slines)
                      if "mktemp" in ln and "$(" in ln), None)
        check(f'mktemp: {sname} installs its trap before the first mktemp',
              trap_at is not None and mk_at is not None and trap_at < mk_at,
              f"trap={trap_at} first_mktemp={mk_at}")

    # Execute all four scripts against stubs, never actual agy/codex.
    with tempfile.TemporaryDirectory() as home:

        # ===== check-cli.sh =====
        rc, out, err = run_script("check-cli.sh", ["agy"], path=SAFE_PATH, home=home)
        check('check-cli: missing agy returns rc=1 and its installation command',
              rc == 1 and "npm install -g @google/agy" in err, err.strip()[:80])
        rc, out, err = run_script("check-cli.sh", ["codex"], path=SAFE_PATH, home=home)
        check('check-cli: missing codex returns rc=1 and its installation command',
              rc == 1 and "npm install -g @openai/codex" in err, err.strip()[:80])
        rc, out, err = run_script("check-cli.sh", ["gemini"], path=SAFE_PATH, home=home)
        check('check-cli: gemini deprecation notice directs installation of agy',
              rc == 1 and "deprecated" in err and "npm install -g @google/agy" in err,
              err.strip()[:80])
        rc, out, err = run_script("check-cli.sh", ["totally-unknown-cli"],
                                  path=SAFE_PATH, home=home)
        check('check-cli: unknown CLI produces general guidance',
              rc == 1 and "No install instructions" in err, err.strip()[:80])
        with tempfile.TemporaryDirectory() as stubdir:
            mkstub(stubdir, "agy", "#!/usr/bin/env bash\nexit 0\n")
            rc, out, err = run_script("check-cli.sh", ["agy"],
                                      path=f"{stubdir}:{SAFE_PATH}", home=home)
            check('check-cli: available agy returns rc=0 without output',
                  rc == 0 and err.strip() == "", f"rc={rc} err={err.strip()[:60]}")

        # ===== parse-output.sh =====
        rc, out, err = run_script("parse-output.sh", ["text"], path=SAFE_PATH, home=home,
                                  input_text="\x1b[31mHELLO\x1b[0m  \n")
        check('parse-output: text mode strips ANSI and trims surrounding whitespace',
              out == "HELLO", repr(out))
        rc, out, err = run_script("parse-output.sh", ["json-extract"], path=SAFE_PATH,
                                  home=home, input_text='{"result": "extracted value"}')
        check('parse-output: json-extract extracts the result key',
              out.strip() == "extracted value", repr(out))
        rc, out, err = run_script("parse-output.sh", ["json-extract"], path=SAFE_PATH,
                                  home=home, input_text='{"other": "nope"}')
        check('parse-output: missing known keys pretty-prints the entire JSON',
              '"other": "nope"' in out, repr(out))
        rc, out, err = run_script("parse-output.sh", ["json-extract"], path=SAFE_PATH,
                                  home=home, input_text="not json at all")
        check('parse-output: non-JSON falls back to the original with ANSI removed',
              out.strip() == "not json at all", repr(out))
        rc, out, err = run_script("parse-output.sh", [], path=SAFE_PATH, home=home,
                                  input_text="  raw text  ")
        check('parse-output: omitted arguments default to text', out == "raw text", repr(out))

        # ===== gemini-bridge.sh =====
        rc, out, err = run_script("gemini-bridge.sh", [], path=SAFE_PATH, home=home)
        check('gemini-bridge: missing --prompt returns rc=1', rc == 1 and "--prompt is required" in err,
              err.strip()[:80])
        rc, out, err = run_script("gemini-bridge.sh",
                                  ["--prompt", "x", "--bogus", "y"],
                                  path=SAFE_PATH, home=home)
        check('gemini-bridge: unknown flag returns rc=1 and identifies the flag',
              rc == 1 and "Unknown option: --bogus" in err, err.strip()[:80])
        rc, out, err = run_script("gemini-bridge.sh", ["--prompt", "x"],
                                  path=SAFE_PATH, home=home)
        check('gemini-bridge: missing agy returns rc=1 and its installation command',
              rc == 1 and "npm install -g @google/agy" in err, err.strip()[:80])

        with tempfile.TemporaryDirectory() as gstub:
            cap = os.path.join(home, "agy_capture.bin")
            mkstub(gstub, "agy", f"""#!/usr/bin/env bash
    printf '%s\\0' "$@" > {cap}
    printf 'AGY_STUB_RESPONSE\\n'
    """)
            rc, out, err = run_script("gemini-bridge.sh",
                                      ["--task", "write", "--prompt", "HELLO PROMPT"],
                                      path=f"{gstub}:{SAFE_PATH}", home=home)
            check('gemini-bridge: normal execution returns rc=0 and the agy response',
                  rc == 0 and out.strip() == "AGY_STUB_RESPONSE", f"rc={rc} out={out!r}")
            argv = read_nul_capture(cap)
            check('gemini-bridge: prompt is the value of --prompt rather than a positional argument',
                  "--prompt" in argv and argv[argv.index("--prompt") + 1].startswith("Task: write")
                  and "HELLO PROMPT" in argv[argv.index("--prompt") + 1], argv[:6])
            check('gemini-bridge: --print-timeout remains an intact flag after the prompt',
                  "--print-timeout" in argv, argv)

            # Preserve prompt bytes exactly. HELLO PROMPT contained no backslash,
            # so mutating printf %s to %b escaped all axes. %b expands backslash-n
            # into a newline, silently corrupting code or paths in prompts.
            # Replacing printf with echo is not a regression: bash with xpg_echo
            # disabled leaves backslashes unchanged, while command substitution
            # strips trailing newlines. Five measured forms matched, so the
            # negative control uses %b instead.
            os.remove(cap) if os.path.exists(cap) else None
            _raw = r"line1\nline2\ttab C:\path"
            rc, out, err = run_script("gemini-bridge.sh",
                                      ["--task", "write", "--prompt", _raw],
                                      path=f"{gstub}:{SAFE_PATH}", home=home)
            _argv2 = read_nul_capture(cap)
            _sent = _argv2[_argv2.index("--prompt") + 1] if "--prompt" in _argv2 else ""
            check('gemini-bridge: prompt backslashes pass through without interpretation',
                  _raw in _sent, f"sent value {_sent[-40:]!r}")
            check('gemini-bridge: introduces no newlines absent from the prompt',
                  _sent.count("\n") == _raw.count("\n") + 2,
                  f"newlines {_sent.count(chr(10))} (2 header lines + 0 body lines)")

            os.remove(cap) if os.path.exists(cap) else None
            ref = os.path.join(home, "ref.md")
            with open(ref, "w", encoding="utf-8") as f:
                f.write("REFERENCE FILE CONTENT")
            rc, out, err = run_script("gemini-bridge.sh",
                                      ["--prompt", "review this", "--files", ref],
                                      path=f"{gstub}:{SAFE_PATH}", home=home)
            argv = read_nul_capture(cap)
            prompt_val = argv[argv.index("--prompt") + 1] if "--prompt" in argv else ""
            check('gemini-bridge: --files contents are inlined into the prompt',
                  "REFERENCE FILE CONTENT" in prompt_val and "FILE:" in prompt_val,
                  prompt_val[-200:])

            os.remove(cap) if os.path.exists(cap) else None
            mkstub(gstub, "agy", f"""#!/usr/bin/env bash
    printf '%s\\0' "$@" > {cap}
    printf '{{"result": "json ok"}}\\n'
    """)
            rc, out, err = run_script("gemini-bridge.sh",
                                      ["--prompt", "x", "--output-format", "json"],
                                      path=f"{gstub}:{SAFE_PATH}", home=home)
            check('gemini-bridge: --output-format json uses parse-output json-extract',
                  out.strip() == "json ok", repr(out))

            mkstub(gstub, "agy", "#!/usr/bin/env bash\nexit 0\n")  # Empty output.
            rc, out, err = run_script("gemini-bridge.sh", ["--prompt", "x"],
                                      path=f"{gstub}:{SAFE_PATH}", home=home)
            check('gemini-bridge: empty output returns rc=1',
                  rc == 1 and "agy returned empty output" in err, err.strip()[:80])

            mkstub(gstub, "agy", "#!/usr/bin/env bash\necho boom >&2\nexit 5\n")
            rc, out, err = run_script("gemini-bridge.sh", ["--prompt", "x"],
                                      path=f"{gstub}:{SAFE_PATH}", home=home)
            check('gemini-bridge: agy failure returns rc=1 and forwards exit code and stderr',
                  rc == 1 and "exited with code 5" in err and "boom" in err, err.strip()[:100])

        # ===== council-bridge.sh =====
        rc, out, err = run_script("council-bridge.sh", [], path=SAFE_PATH, home=home)
        check('council-bridge: missing --prompt returns rc=1', rc == 1 and "--prompt is required" in err,
              err.strip()[:80])
        rc, out, err = run_script("council-bridge.sh",
                                  ["--prompt", "x", "--bogus", "y"],
                                  path=SAFE_PATH, home=home)
        check('council-bridge: unknown flag returns rc=1 and identifies the flag',
              rc == 1 and "Unknown option: --bogus" in err, err.strip()[:80])
        rc, out, err = run_script("council-bridge.sh", ["--prompt", "x"],
                                  path=SAFE_PATH, home=home)
        check('council-bridge: both absent returns rc=1 and both installation commands',
              rc == 1 and "npm install -g @google/agy" in err
              and "npm install -g @openai/codex" in err, err.strip()[:120])

        with tempfile.TemporaryDirectory() as cstubdir:
            acap = os.path.join(home, "agy_c_capture.bin")
            ccap = os.path.join(home, "codex_c_capture.bin")
            cstdin = os.path.join(home, "codex_c_stdin.txt")
            mkstub(cstubdir, "agy", f"""#!/usr/bin/env bash
    printf '%s\\0' "$@" > {acap}
    printf 'AGY panel response\\n'
    """)
            mkstub(cstubdir, "codex", f"""#!/usr/bin/env bash
    printf '%s\\0' "$@" > {ccap}
    cat > {cstdin}
    printf 'CODEX panel response\\n'
    """)
            rc, out, err = run_script("council-bridge.sh",
                                      ["--prompt", "check this", "--mode", "review",
                                       "--workdir", "/tmp"],
                                      path=f"{cstubdir}:{SAFE_PATH}", home=home)
            check('council-bridge: both available returns rc=0 and both response blocks',
                  rc == 0 and "=== AGY RESPONSE ===" in out and "AGY panel response" in out
                  and "=== CODEX RESPONSE ===" in out and "CODEX panel response" in out,
                  out[:200])
            codex_argv = read_nul_capture(ccap)
            pairs = list(zip(codex_argv, codex_argv[1:]))
            check('council-bridge: Codex invocation is fixed to --sandbox read-only',
                  ("--sandbox", "read-only") in pairs, codex_argv)
            check('council-bridge: Codex invocation excludes workspace-write',
                  "workspace-write" not in codex_argv, codex_argv)
            check('council-bridge: --workdir is forwarded to Codex as -C',
                  ("-C", "/tmp") in pairs, codex_argv)
            codex_stdin = ""
            if os.path.exists(cstdin):
                with open(cstdin, encoding="utf-8") as f:
                    codex_stdin = f.read()
            check('council-bridge: review prefix reaches the Codex prompt on stdin',
                  "Review the following code for bugs" in codex_stdin, codex_stdin[:120])
            check('council-bridge: user prompt body also reaches Codex',
                  "check this" in codex_stdin, codex_stdin[-80:])
            agy_argv = read_nul_capture(acap)
            agy_prompt = agy_argv[agy_argv.index("--prompt") + 1] if "--prompt" in agy_argv else ""
            check('council-bridge: the same prompt reaches agy as the --prompt value',
                  "check this" in agy_prompt
                  and "Review the following code for bugs" in agy_prompt, agy_prompt[:120])
            check('council-bridge: summary reports 2/2 responses on stderr',
                  "Council: 2/2 AIs responded successfully." in err, err.strip()[-80:])

            for p in (acap, ccap, cstdin):
                os.remove(p) if os.path.exists(p) else None
            mkstub(cstubdir, "agy", "#!/usr/bin/env bash\necho boom >&2\nexit 3\n")
            rc, out, err = run_script("council-bridge.sh", ["--prompt", "x"],
                                      path=f"{cstubdir}:{SAFE_PATH}", home=home)
            check('council-bridge: codex response survives agy failure (partial failure)',
                  rc == 0 and "[ERROR: agy failed with exit code 3]" in out
                  and "CODEX panel response" in out, out[:200])
            check('council-bridge: summary reflects partial failure as 1/2',
                  "Council: 1/2 AIs responded successfully." in err, err.strip()[-80:])

        with tempfile.TemporaryDirectory() as codex_missing_dir:
            mkstub(codex_missing_dir, "agy", "#!/usr/bin/env bash\necho only-agy-here\n")
            rc, out, err = run_script("council-bridge.sh", ["--prompt", "x"],
                                      path=f"{codex_missing_dir}:{SAFE_PATH}", home=home)
            check('council-bridge: missing codex runs only the available backend and counts success',
                  rc == 0 and "[Codex CLI not installed - skipped]" in out
                  and "Council: 1/1 AIs responded successfully." in err, out[:200])

    # Measure contracts recorded in the issue ledger (ISSUES.md).
    with tempfile.TemporaryDirectory() as home2:

        # (C-1 / BUG-5) agy calls exclude -m. In gemini CLI v0.31.0, -m made
        # the SDK model undefined and killed the invocation. Bridges use the
        # default model instead of selecting one. (C-6) The same argv also
        # verifies that headless flags survive.
        with tempfile.TemporaryDirectory() as p2dir:
            acap2 = os.path.join(home2, "agy2.bin")
            ccap2 = os.path.join(home2, "codex2.bin")
            cstdin2 = os.path.join(home2, "codex2.stdin")
            cenv2 = os.path.join(home2, "codex2.env")
            aenv2 = os.path.join(home2, "agy2.env")
            mkstub(p2dir, "agy", f"""#!/usr/bin/env bash
    printf '%s\\0' "$@" > {acap2}
    printf 'GEMINI=%s\\n' "${{GEMINI_API_KEY:-unset}}" > {aenv2}
    printf 'AGY ok\\n'
    """)
            mkstub(p2dir, "codex", f"""#!/usr/bin/env bash
    printf '%s\\0' "$@" > {ccap2}
    printf 'OPENAI=%s\\n' "${{OPENAI_API_KEY:-unset}}" > {cenv2}
    cat > {cstdin2}
    printf 'CODEX ok\\n'
    """)
            P2PATH = f"{p2dir}:{SAFE_PATH}"

            rc, out, err = run_script("council-bridge.sh",
                                      ["--prompt", "P2 body", "--mode", "review"],
                                      path=P2PATH, home=home2)
            a2 = read_nul_capture(acap2)
            c2 = read_nul_capture(ccap2)
            check('C-1: council agy invocation excludes the -m model flag (BUG-5)',
                  rc == 0 and bool(a2) and "-m" not in a2, a2[:6])
            check('C-1: council codex invocation also excludes the -m model flag (BUG-5)',
                  rc == 0 and bool(c2) and "-m" not in c2, c2[:8])
            check('C-2: codex invocation retains --skip-git-repo-check (ISSUE-6)',
                  "--skip-git-repo-check" in c2, c2[:8])
            check('C-6: council agy invocation retains --dangerously-skip-permissions',
                  "--dangerously-skip-permissions" in a2, a2[:6])

            # (C-3) Measure actual prompt prefixes for every mode. Also require
            # other modes' prefixes to be absent, rejecting implementations
            # that concatenate all three prefixes.
            MODE_LEAD = {
                "research": "Answer the following question thoroughly",
                "review": "Review the following code for bugs",
                "debug": "Diagnose the following bug or issue",
            }
            for mode, lead in sorted(MODE_LEAD.items()):
                for f in (acap2, ccap2, cstdin2):
                    os.remove(f) if os.path.exists(f) else None
                rc, out, err = run_script("council-bridge.sh",
                                          ["--prompt", "MODE BODY", "--mode", mode],
                                          path=P2PATH, home=home2)
                av = read_nul_capture(acap2)
                aprompt = av[av.index("--prompt") + 1] if "--prompt" in av else ""
                cin = read(cstdin2) if os.path.exists(cstdin2) else ""
                others = [o for m, o in MODE_LEAD.items() if m != mode]
                check(f'C-3: --mode {mode} prefix reaches both agy and codex prompts',
                      lead in aprompt and lead in cin
                      and "MODE BODY" in aprompt and "MODE BODY" in cin,
                      f"agy={aprompt[:60]!r} codex={cin[:60]!r}")
                check(f'C-3: --mode {mode} does not include other mode prefixes',
                      not any(o in aprompt or o in cin for o in others),
                      f"{[o for o in others if o in aprompt or o in cin]}")

            # (C-4 / ISSUE-9) apikey.env keys reach child processes. Assign
            # without export so the bridge's export is the only route:
            # removing OPENAI_API_KEY from that line must fail.
            with tempfile.TemporaryDirectory() as keyhome:
                os.makedirs(os.path.join(keyhome, ".oh-my-zsh", "custom"))
                with open(os.path.join(keyhome, ".oh-my-zsh", "custom", "apikey.env"),
                          "w", encoding="utf-8") as f:
                    f.write('GEMINI_API_KEY="GKEY-FROM-APIKEY-ENV"\n'
                            'OPENAI_API_KEY="OKEY-FROM-APIKEY-ENV"\n')
                for f in (acap2, ccap2, cstdin2, cenv2, aenv2):
                    os.remove(f) if os.path.exists(f) else None
                # Capture paths stay inside home2 even when HOME points to keyhome.
                rc, out, err = run_script("council-bridge.sh", ["--prompt", "keys"],
                                          path=P2PATH, home=keyhome)
            check('C-4: council exports OPENAI_API_KEY to the codex child (ISSUE-9)',
                  os.path.exists(cenv2)
                  and "OPENAI=OKEY-FROM-APIKEY-ENV" in read(cenv2),
                  read(cenv2).strip() if os.path.exists(cenv2) else "no capture")
            check('C-4: council also exports GEMINI_API_KEY to the agy child',
                  os.path.exists(aenv2)
                  and "GEMINI=GKEY-FROM-APIKEY-ENV" in read(aenv2),
                  read(aenv2).strip() if os.path.exists(aenv2) else "no capture")

        # (C-1 / C-6) The single bridge has the same argv contract.
        gcap2 = os.path.join(home2, "gagy2.bin")
        with tempfile.TemporaryDirectory() as g2dir:
            mkstub(g2dir, "agy", f"""#!/usr/bin/env bash
    printf '%s\\0' "$@" > {gcap2}
    printf 'AGY ok\\n'
    """)
            rc, out, err = run_script("gemini-bridge.sh", ["--prompt", "x"],
                                      path=f"{g2dir}:{SAFE_PATH}", home=home2)
            g2 = read_nul_capture(gcap2)
            check('C-1: gemini-bridge agy invocation excludes the -m model flag (BUG-5)',
                  rc == 0 and bool(g2) and "-m" not in g2, g2[:6])
            check('C-6: gemini-bridge agy invocation retains --dangerously-skip-permissions',
                  "--dangerously-skip-permissions" in g2, g2[:6])

        # (C-5 / ISSUE-18) Output uses printf %s\n. A line containing only -n
        # distinguishes it: bash echo consumes that as an option and prints
        # nothing, while printf prints it. Reverting to echo "$GEMINI_OUTPUT"
        # therefore yields empty output and fails.
        with tempfile.TemporaryDirectory() as dashn:
            mkstub(dashn, "agy", "#!/usr/bin/env bash\nprintf '%s\\n' '-n'\n")
            rc, out, err = run_script("gemini-bridge.sh", ["--prompt", "x"],
                                      path=f"{dashn}:{SAFE_PATH}", home=home2)
            check("C-5: agy output uses printf (reverting to echo loses '-n')",
                  rc == 0 and out.strip() == "-n", f"rc={rc} out={out!r}")

        # (C-7 / BUG-6) Measure all three _timeout fallbacks regardless of coreutils.
        for label, present in (("timeout", ("timeout",)),
                               ("gtimeout", ("gtimeout",)),
                               ("none", ())):
            with tempfile.TemporaryDirectory() as mb, \
                 tempfile.TemporaryDirectory() as sb:
                linked = minimal_bin(mb)
                wraplog = os.path.join(sb, "wrap.log")
                acap3 = os.path.join(sb, "agy3.bin")
                mkstub(sb, "agy", f"""#!/usr/bin/env bash
printf '%s\\0' "$@" > {acap3}
printf 'AGY ok\\n'
""")
                for w in present:
                    mkstub(sb, w, f"""#!/usr/bin/env bash
printf '{w} %s\\n' "$1" >> {wraplog}
shift
exec "$@"
""")
                rc, out, err = run_script("gemini-bridge.sh", ["--prompt", "x"],
                                          path=f"{sb}:{mb}", home=home2)
                log = read(wraplog) if os.path.exists(wraplog) else ""
                ran = read_nul_capture(acap3)
                if present:
                    check(f'C-7: PATH containing only {label} wraps agy with {label} (BUG-6)',
                          rc == 0 and log.startswith(f"{label} ") and bool(ran),
                          f"rc={rc} log={log.strip()!r} linked={len(linked)}")
                else:
                    check('C-7: absence of both timeout/gtimeout runs agy directly (BUG-6)',
                          rc == 0 and log == "" and bool(ran)
                          and out.strip() == "AGY ok",
                          f"rc={rc} log={log.strip()!r} out={out!r}")

    # Floors are measured with zero slack. Council-bridge once had a floor of
    # 13 against 25 measurements, allowing deletion of 12 contracts. Raise
    # floors when adding contracts. Reference floors were remeasured on
    # 2026-09-02: previous floors were one too high after line survival moved
    # to the self-check prefix and left deletion-copy failure counts. An early
    # return in _suite_lib (fixed in e55fe98) kept survival red and skipped the
    # floor checks, hiding the mismatch. No contracts disappeared: separate
    # per-file copies and enumerated failures established this.
    check_contract_coverage(check, __file__, ROOT, per_file={
        "SKILL.md": 58, "references/framing.md": 19,
        "references/ai-council.md": 10, "references/gemini.md": 13,
        "references/synthesis-guide.md": 11,
        "scripts/check-cli.sh": 6, "scripts/parse-output.sh": 11,
        "scripts/gemini-bridge.sh": 23, "scripts/council-bridge.sh": 26,
    }, live_ran=sum(1 for r in results
                    if not r[0].startswith(("자기검사:", "계약 커버리지:"))))
    check_body_deletion(check, __file__, ROOT, minimum=58,
                        live_ran=sum(1 for r in results
                                     if not r[0].startswith(("자기검사:", "계약 커버리지:"))))
    # Preserve forwarding newlines: delegate had this check, consult did not (second RED probe).
    _gb = read(os.path.join(ROOT, "scripts", "gemini-bridge.sh"))
    check('Output: forwarding to the parser preserves newlines through printf', 'printf \'%s\\n\' "$GEMINI_OUTPUT"' in _gb)

    check_script_contracts(check, __file__, ROOT, scripts={
        "scripts/check-cli.sh": 6, "scripts/parse-output.sh": 11,
        "scripts/gemini-bridge.sh": 23, "scripts/council-bridge.sh": 26,
    }, live_ran=sum(1 for r in results
                    if not r[0].startswith(("자기검사:", "계약 커버리지:", "스크립트 계약:"))))
    check_no_constant_assertions(check, __file__)
    check_total(check, results, 199)

    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n{passed}/{len(results)} 통과")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
