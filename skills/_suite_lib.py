#!/usr/bin/env python3
"""Shared tools for skill regression suites.

## Why the regex linter was removed

The earlier `shadow_audit()` extracted `"..." in skill` patterns from suite
sources to find needles also present in frontmatter. A review tested 11 forms:
it caught only 2 and missed 9, including single quotes, variables, `.find()`,
`re.search()`, `any(...)`, and three-character needles (common in Korean).

The limitation is structural: a regex linter occupies the same expression space
as the code it checks. Code has unbounded expression forms, allowing bypasses.

## What replaces it: body-deletion regression

Measure the defect directly. A dead document contract means its check still
passes after the SKILL.md body is deleted. Make that deletion and run the suite:

    Copy SKILL.md, retaining only frontmatter.
      -> Rerun the suite in that copy.
      -> It must fail, or the document contract is not enforced.

This does not depend on needle syntax. A check that ignores the body is exposed;
to resist the probe it must actually inspect the body, which is the intended
behavior.
"""

import difflib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

# Prevent recursion: deletion copies must not invoke another deletion run.
RECURSION_GUARD = "_SUITE_BODY_DELETED"

# Name prefixes for self-checks omitted in copies; exclude them from both counts.
# The survival threshold has one constant. Its value, verdict, and actual use
# must be independently measurable; duplicate literals allow one-sided weakening.
SURVIVAL_FLOOR = 0.70

SELF_CHECK_PREFIXES = ("자기검사:", "계약 커버리지:")


def split_frontmatter(text):
    """Split SKILL.md into (frontmatter, body).

    Without frontmatter, return ("", full_text). Contract checks must use body.
    """
    m = re.match(r"^---\n(.*?)\n---\n(.*)$", text, re.S)
    if not m:
        return "", text
    return m.group(1), m.group(2)


DELETED_MARKER = ".suite-body-deleted"


def in_deleted_run(root=None):
    """Return whether this is a body-deletion copy.

    Do not trust an environment variable alone. A true result disables blob
    binding, contract coverage, deletion regression, and total-count markers.
    Previously `_SUITE_BODY_DELETED=1` was a kill switch in the real tree:
    `56/56 통과` silently became `43/43 통과`, while the same switch disabled
    `check_total`, concealing the 13 missing checks (review 18). Selected runs
    and `inspect` returned rc=0; only the full tree's expected floor count of
    77 stopped the bypass.

    Require all three: the variable, a marker at the copy root, and a tree
    outside Git. The copy builder establishes these together; setting only
    the variable in the real repository cannot enable this mode.
    """
    if not os.environ.get(RECURSION_GUARD):
        return False
    base = root or os.getcwd()
    marker = os.path.join(base, DELETED_MARKER)
    if not os.path.isfile(marker):
        return False
    # Disabled in a real repository. shutil.copytree copies contain no .git.
    return not _in_git_repo(base)


#: Reachability collection is enabled only by $JSTACK_REACH_OUT; otherwise no work.
#:
#: Deletion regressions copy the tree and rerun the suite for each reference.
#: Their output already names failed checks. Retaining those names, rather than
#: only the failure count, identifies checks untouched by any mutation without
#: another run (DESIGN-enforcement motivation 1).
#:
#: Measured rerun cost: one commands case set required 13 runs x 50 inner deletion
#: regressions = 650 copies. Disk bandwidth limited four-way parallel speedup to
#: 1.58x on a 14-core machine.
_REACH_RED: set = set()


def _reach_collect(stdout: str) -> None:
    """Collect complete [FAIL] lines emitted by copies.

    Do not split names here. The previous `(?: — |$)` stopped at the first
    separator, but check() prints `name — detail` and names can themselves
    contain ` — ` (for example, the connector-rules.md reference contract).
    The truncated fragment could never match the live name, making that check
    appear unreachable under every mutation. This instrumentation error
    accounted for 182 of 1,967 measured unreachable checks.

    reach_dump performs matching with the actual live names available.
    """
    if not os.environ.get("JSTACK_REACH_OUT"):
        return
    _REACH_RED.update(re.findall(r"(?m)^\[FAIL\] (.+)$", stdout or ""))


def reach_dump(live_names) -> None:
    """Write live and reached names when collection is enabled.

    Match only once names are known. Output is either `name` or `name — detail`.
    Comparing with the live name as a prefix handles embedded separators;
    hwpx fallback self-checks use the same approach for the same reason.
    """
    out = os.environ.get("JSTACK_REACH_OUT")
    if not out:
        return
    live = sorted(live_names)
    reached = sorted(
        n for n in live
        if any(ln == n or ln.startswith(n + " — ") for ln in _REACH_RED)
    )
    try:
        os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
        with open(out, "w", encoding="utf-8") as f:
            json.dump({"live": live, "reached": reached}, f, ensure_ascii=False)
    except OSError:
        pass


#: Deletion-skip mode: JSTACK_SKIP_DELETION=1 returns a sentinel without copying.
#: Callers retain each verdict name in [SKIP] output and offset it in totals,
#: matching proof/hwpx SKIPPED_AXES: a skipped check must not count as a pass.
#:
#: Why: red_suite runs a full suite per case; each suite copies the tree for every
#: reference. Thirteen cases x fifty inner copies = 650 copies. This product
#: accounted for most of a five-hour run; disk, not CPU, was the bottleneck
#: (measured speedup: 1.58x with four workers on 14 cores). Deletion regression
#: measures suite-to-contract binding rather than the mutated tree, so measure
#: it once on the control rather than again for every mutation.
#:
#: Measured loss: logs from 32 case sets and 341 cases contained zero cases
#: detected solely through deletion-regression verdicts. This is an upper bound
#: because logs retain only the first two FAIL lines per case. At zero, skipping
#: does not reduce measured detection. Recompute with a full sweep when recording
#: another round.
#:
#: Self-measurement: check_total adds skipped names back. A stale skip list
#: (a removed call with its name retained, or the reverse) immediately changes
#: the total, using the existing marker rather than adding another axis.
_SKIP_ENV = "JSTACK_SKIP_DELETION"
_DELETION_SKIPPED = object()
_SKIPPED_NAMES = []


def deletion_skipped():
    """Return whether this run skips deletion regressions."""
    return os.environ.get(_SKIP_ENV) == "1"


def _skip_named(*names):
    """Retain each skipped verdict by name; do not collapse to a summary (class A)."""
    for n in names:
        _SKIPPED_NAMES.append(n)
        print(f"[SKIP] {n} — deletion regression skipped (measured in the control)")


def body_deletion_regression(
    suite_file, skill_root, *, extra_strip=(), only=None, runner=None, extra_skip=()
):
    """Run the suite in a body-deleted copy and count failures.

    Return failure/output measurements, or None during recursion.
    extra_strip also empties the named reference files, allowing checks of
    contracts that exist only in reference documents.
    """
    if in_deleted_run():
        return None
    if deletion_skipped():
        return _DELETION_SKIPPED

    work = tempfile.mkdtemp()
    try:
        # Copy the entire plugin root. Copying one skill loses _suite_lib;
        # copying only skills also loses external files such as commands/.
        # Import/early crashes otherwise appear as zero failures, reversing
        # the measurement into a false pass.
        # Do not infer the root by blindly moving up two levels. That works
        # only for <plugin>/skills/<name>. With the plugin root itself (command
        # or agent suites), or red_suite's work/skill layout, it can select
        # $TMPDIR and recursively copy it into a new child temp directory.
        # Review 6 caught growth of 1.7 GB per ten seconds and reclaimed 24 GB.
        # A directory containing skills/ is itself the plugin root.
        if os.path.isdir(os.path.join(skill_root, "skills")):
            plugin_root = skill_root
        else:
            plugin_root = os.path.dirname(os.path.dirname(skill_root))
        rel = os.path.relpath(skill_root, plugin_root)
        # Stop if the copy would be inside the source. This final guard
        # prevents recursive copying even if root detection is wrong.
        if os.path.commonpath(
            [os.path.realpath(plugin_root), os.path.realpath(work)]
        ) == os.path.realpath(plugin_root):
            raise RuntimeError(
                f"Copy target is inside source; copying would recurse: {plugin_root} ⊃ {work}"
            )
        dst_plugin = os.path.join(work, os.path.basename(plugin_root))
        # Copy upstream repos/ only when the owning suite checks them.
        # A copy is 38 MB; repeated full copies across 29 suites accumulated
        # gigabytes and exhausted disk, causing later hwpx/image copies to die.
        # science contracts inspect imported material: excluding it reduced
        # checks from 31 to 20. author checks the full package surface, so its
        # normal copy also fails without imports. Preserve them for both owners.
        # Do not broadly exclude tmp*: legitimate references/tmpl.md vanished
        # and lost all its contracts, producing false positives (review 6).
        # commonpath already blocks recursion; exclude only $TMPDIR's exact name.
        skips = ["__pycache__", "*.pyc", ".omc", "results", ".git", "node_modules"]
        _tmp_base = os.path.basename(os.path.realpath(tempfile.gettempdir()))
        if _tmp_base and _tmp_base not in (".", "/"):
            skips.append(_tmp_base)
        if os.path.basename(skill_root) not in {"science", "author"}:
            skips.append("repos")
        shutil.copytree(plugin_root, dst_plugin, ignore=shutil.ignore_patterns(*skips))
        dst = os.path.join(dst_plugin, rel)

        if only is not None:
            # Empty one file to measure enforcement of its own contracts.
            _strip_one(dst, only)
        else:
            _strip_one(dst, "SKILL.md")
            for extra in extra_strip:  # Do not overwrite the outer rel.
                _strip_one(dst, extra)

        suite_rel = os.path.relpath(suite_file, skill_root)
        # Mark the copy root; an environment variable alone cannot establish
        # a deletion copy (see in_deleted_run).
        with open(os.path.join(dst, DELETED_MARKER), "w") as _mk:
            _mk.write("This directory is a copy created by body_deletion_regression.\n")
        env = dict(os.environ, **{RECURSION_GUARD: "1", "PYTHONDONTWRITEBYTECODE": "1"})
        # Use the suite's dependency-aware runner. Plain python3 can return
        # early with missing dependencies and execute zero contracts (hwpx).
        cmd = (list(runner) if runner else [sys.executable]) + [
            os.path.join(dst, suite_rel)
        ]
        r = subprocess.run(cmd, capture_output=True, text=True, cwd=dst, env=env)
        fails = len(re.findall(r"(?m)^\[FAIL\]", r.stdout))
        # Exclude self-checks omitted in the copy by name, not by subtracting
        # a constant; a constant granted three checks of slack and hid losses.
        # Both sides must use the same prefix exclusions as live_ran. A mismatch
        # grants unearned slack that hides real losses (six checks in review 5).
        ran = len(
            [
                ln
                for ln in re.findall(r"(?m)^\[(?:PASS|FAIL)\] (.+)$", r.stdout)
                if not ln.startswith(tuple(SELF_CHECK_PREFIXES) + tuple(extra_skip))
            ]
        )
        _reach_collect(r.stdout)
        return {
            "fails": fails,
            "ran": ran,
            "rc": r.returncode,
            # Detect crashes before truncating stderr to 600 display characters.
            # A long stack can push the Traceback header outside that suffix.
            # In research, deleting cite_check.py caused FileNotFoundError after
            # check 5, but the completion axis passed; only the survival guard
            # caught the loss of 88 checks (copy 5 / live 93). Truncation is a
            # presentation choice, not a verdict input.
            "crashed": "Traceback (most recent call last)" in r.stderr,
            "stderr": r.stderr[-600:],
            "stdout": r.stdout,
        }

    finally:
        shutil.rmtree(work, ignore_errors=True)


def _strip_one(dst, rel):
    """Empty one copied file, retaining frontmatter for SKILL.md."""
    p = os.path.join(dst, rel)
    if not os.path.exists(p):
        return False
    if os.path.basename(rel) == "SKILL.md":
        with open(p, encoding="utf-8") as f:
            fm, _ = split_frontmatter(f.read())
        with open(p, "w", encoding="utf-8") as f:
            f.write(f"---\n{fm}\n---\n" if fm else "")
    else:
        open(p, "w", encoding="utf-8").close()
    return True


def check_contract_coverage(
    check,
    suite_file,
    skill_root,
    *,
    runner=None,
    per_file,
    live_ran=None,
    measure=True,
    completeness=True,
    extra_skip=(),
):
    """Measure contract coverage with per-file floors.

    A single aggregate minimum allowed two bypasses:
    1. Offsetting totals: losing A's contracts while adding B's preserved the sum.
       deck measured 21 against a floor of 4, so deleting seven contracts passed.
    2. Invisible uncovered files: 19 references could contribute zero while others
       filled the total. All nine hwpx references were outside measurement.

    Empty each file separately and measure its failures. per_file values of zero
    are forbidden: declaring a reference without contracts must fail.
    """
    if in_deleted_run():
        return

    # Verify the handwritten declarations against the filesystem; otherwise
    # new references silently escape measurement and zero contracts stay green.
    declared = set(per_file)
    # Do not restrict the population to an allowlist. Flat references/*.md
    # scanning missed references/sub/, docs/, .mdx, and root GUIDE.md in probes.
    # deck already keeps its NOTICE contract at the root, disproving the premise
    # that all contracts live in references/.
    # Scan everything and exclude only non-contract directories. New layouts
    # fail by default until an exclusion is documented here.
    NON_CONTRACT_DIRS = {
        "scripts",
        "tests",
        "assets",
        "scheduler",
        "templates",
        "__pycache__",
        # Dependencies and generated bundles are not contract documents.
        # dashboard introduced imported TypeScript: node_modules is an ignored
        # installation, and dist/ is generated. Its suite checks reproducibility
        # by comparing npm run build output byte-for-byte with committed bundles.
        # A failure floor on minified bundles would not measure that property.
        "node_modules",
        "dist",
        ".omc",
        "results",
        ".git",
        # ruff caches include non-dot filenames (CACHEDIR.TAG and hashes),
        # which would otherwise enter the document population.
        ".ruff_cache",
        # Imported upstream sources are not contracts authored here.
        # langs was removed from this exclusion: it contained 1,672 lines of
        # locally authored Korean prose. While excluded, only a 400-character
        # check covered it; replacing all six files with 500-character dummies
        # still passed 36/36 in an external review.
        "repos",
    }
    NON_CONTRACT_SUFFIX = (
        ".py",
        ".js",
        # mjs/ts code belongs outside the document population, like js.
        # check_script_contracts measures executable contracts. dashboard's ESM
        # hooks and TypeScript exposed the earlier js-only exclusion.
        ".mjs",
        ".cjs",
        ".ts",
        ".sh",
        ".ps1",
        ".json",
        ".jsonl",
        ".txt",
        ".plist",
        ".service",
        ".toml",
        ".pyc",
    )
    expected = set()
    for dirpath, dirnames, filenames in os.walk(skill_root):
        # Exclude templates only directly beneath the skill root. Applying
        # it at every depth hid all 15 author/references/templates/ files from
        # every suite while leaving a green but incomplete population check.
        dirnames[:] = [
            d
            for d in dirnames
            if not (
                d in NON_CONTRACT_DIRS and (d != "templates" or dirpath == skill_root)
            )
        ]
        # Keep the flat skills/ level; exclude only individual skill directories.
        # Each skill scans its own directory. Excluding all of skills/ left flat
        # files unowned: an undeclared skills/CONVENTIONS.md passed all checks
        # in review 6.
        if os.path.basename(dirpath) == "skills" and dirpath != skill_root:
            dirnames[:] = [
                d
                for d in dirnames
                if not os.path.isfile(os.path.join(dirpath, d, "SKILL.md"))
            ]
        for n in filenames:
            if n.startswith(".") or n.endswith(NON_CONTRACT_SUFFIX):
                continue
            rel = os.path.relpath(os.path.join(dirpath, n), skill_root)
            expected.add(rel.replace(os.sep, "/"))
    missing = sorted(expected - declared)
    # Check the reverse direction by existence, not population membership;
    # otherwise legitimate root contracts such as NOTICE appear nonexistent.
    stale = sorted(
        r for r in declared if not os.path.exists(os.path.join(skill_root, r))
    )
    # completeness=False delegates the population guard to another suite.
    # Multiple suites may split ownership, but one must inspect the population.
    if completeness:
        check(
            "계약 커버리지: 선언 목록이 실제 파일과 일치한다",
            not missing and not stale,
            (f"미선언 {missing} " if missing else "")
            + (f"없는파일 {stale}" if stale else ""),
        )

    # Completeness-only mode lets one suite own population checks for a shared
    # tree. Separate directory allowlists would leave root documents unowned.
    if not measure:
        return

    for rel, floor in sorted(per_file.items()):
        if floor < 1:
            check(
                f"계약 커버리지: {rel} 의 바닥값이 1 이상이다",
                False,
                f"{floor} — 계약 없는 파일을 선언했다",
            )
            continue
        res = body_deletion_regression(
            suite_file, skill_root, only=rel, runner=runner, extra_skip=extra_skip
        )
        if res is None:
            continue
        if res is _DELETION_SKIPPED:
            _skip_named(f"계약 커버리지: {rel}")
            continue
        if (
            res["rc"] not in (0, 1)
            or res["crashed"]
        ):
            check(
                f"계약 커버리지: {rel} 비운 사본이 완주한다",
                False,
                res["stderr"].strip().splitlines()[-1][:80] if res["stderr"] else "",
            )
            _floor_unmeasured(check, rel, floor, "copy did not complete")
            continue
        # Allow no slack: subtracting one would permit a check to disappear.
        # Disappearance is not a failure and cannot be seen in failure counts.
        if live_ran is not None and res["ran"] < live_ran:
            check(
                f"계약 커버리지: {rel} 비워도 검사가 소멸하지 않는다",
                False,
                f"사본 {res['ran']}건 / 실제 {live_ran}건",
            )
            _floor_unmeasured(
                check, rel, floor, f"소멸 가드가 걸렸다 (사본 {res['ran']}/{live_ran})"
            )
            continue
        check(
            f"계약 커버리지: {rel}",
            res["fails"] >= floor,
            f"{res['fails']}건 실패 (하한 {floor})",
        )


def _floor_unmeasured(check, rel, floor, why):
    """Emit a verdict when a floor could not be measured.

    Earlier early exits for incomplete copies and survival-guard failures simply
    continued, removing the floor verdict entirely. Without its name neither a
    person nor check_total could tell that the check had not run.

    Reproduction (adversarial round 3, C-5, models): swapping only two data rows
    in tiers.md broke frozen binding and increased live checks from 80 to 82,
    mismatching the copy's 80. The false survival alarm then skipped all three
    floor verdicts. One legitimate reference edit disabled all floor measurement.

    Keep every skipped name in output; a combined summary loses names (class A).
    """
    check(f"계약 커버리지: {rel}", False, f"측정 불가 (하한 {floor}) — {why}")


def check_body_deletion(
    check,
    suite_file,
    skill_root,
    *,
    runner=None,
    minimum,
    extra_strip=(),
    live_ran=None,
    extra_skip=(),
):
    """Check SKILL.md body deletion alongside per-file checks.

    Require all three; earlier versions checked them separately and failed:
    1. At least minimum failures, pinned to actual measurements.
    2. Completion: both ordinary failure and traceback can exit 1, so inspect
       stderr for traceback as well as the return code.
    3. No disappeared checks: body-dependent conditionals can remove checks
       rather than fail them. Compare execution counts to detect that loss.
    """
    res = body_deletion_regression(
        suite_file,
        skill_root,
        extra_strip=extra_strip,
        extra_skip=extra_skip,
        runner=runner,
    )
    if res is None:
        return
    if res is _DELETION_SKIPPED:
        # Count the exact emitted names. These fixed names do not depend on
        # res, so skipped and executed modes have matching counts.
        _names = ["자기검사: 본문 삭제 사본이 완주한다 (비정상 종료 아님)"]
        if live_ran is not None:
            _names.append("자기검사: 사본에서 검사가 소멸하지 않았다")
        _names.append("자기검사: SKILL.md 본문 삭제 시 계약 검사가 실패한다")
        _skip_named(*_names)
        return

    crashed = res["crashed"]
    ok_rc = res["rc"] in (0, 1) and not crashed
    check(
        "자기검사: 본문 삭제 사본이 완주한다 (비정상 종료 아님)",
        ok_rc,
        ("traceback: " + res["stderr"].strip().splitlines()[-1][:80])
        if crashed
        else f"rc={res['rc']}",
    )

    if live_ran is not None:
        # Both counts exclude self-checks. Arithmetic offsets create slack
        # that hides losses (three each in deck, office, and image).
        check(
            "자기검사: 사본에서 검사가 소멸하지 않았다",
            res["ran"] >= live_ran,
            f"사본 {res['ran']}건 / 본문검사 {live_ran}건",
        )

    check(
        "자기검사: SKILL.md 본문 삭제 시 계약 검사가 실패한다",
        res["fails"] >= minimum,
        f"{res['fails']}건 실패 (하한 {minimum})",
    )


class _Section:
    """Turn missing artifacts into verdicts rather than disappeared checks.

    Construct through section(), not directly.
    """

    def __init__(self, check, results, names):
        self._check, self._results, self._names = check, results, names

    def __enter__(self):
        self._at = len(self._results)
        return self

    def __exit__(self, exc_type, exc, tb):
        emitted = {r[0] for r in self._results[self._at:]}
        why = f"{exc_type.__name__}: {exc}" if exc_type else "missing artifact"
        for n in self._names:
            if n not in emitted:
                self._check(n, False, why[:120])
        return True  # Continue through remaining sections and check_total.


def read_ref(path):
    """Read a reference, returning None when absent instead of raising.

    Direct open() previously crashed with FileNotFoundError after deletion,
    preventing summary output. Tools counting ^[FAIL] saw zero, making total
    contract loss indistinguishable from success. Deleting audit's
    references/rubric.md reproduced a traceback without a summary.

    A caller receiving None must fail every contract for that file and retain
    each name. This matches section(), but avoids rather than catches errors.
    secrets and upstream had byte-identical four-line copies; this repository
    already learned from duplicated _suite_lib.py copies that copies diverge.
    """
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as f:
        return f.read()


def section(check, results, *names):
    """Declare section verdict names and retain them if execution stops.

        with section(check, results, "axis 1", "axis 2"):
            ...  # A crash fails both names, then the next section runs.

    Why shared: the same remedy emerged independently three times: read_ref
    (secrets/upstream, missing references), SKIPPED_AXES (proof/hwpx, missing
    external tools), and _Section (humanize/hwpx, early gate returns on absent
    artifacts). All require absence to become a verdict: retain missing axis
    names, fail them, and finish. _Section itself was duplicated in humanize
    and hwpx; duplicated _suite_lib.py copies had already shown divergence.

    Self-measurement: stale declarations fail by name during a normal run.
    Incomplete declarations reduce verdict counts in deletion copies, triggering
    the survival guards in check_contract_coverage/check_script_contracts.
    Both directions are measured, preventing declared but disabled axes.

    Use only where execution can stop. A green tree already establishes that
    emptying declared files does not crash suites. Adding declarations across
    all 23 skills preemptively adds unmeasured declarations. Apply when adding
    instrumentation or when a survival guard exposes a gap.
    """
    return _Section(check, results, names)



def _criteria_values(text):
    """Extract answer-like values from criteria.md's passing-conditions section.

    The earlier suffix filter, len(x) > 12 and x.endswith("다"), systematically
    excluded Korean prose answers. It removed diagram's discriminating rule
    `화살표를 상자보다 먼저 그린다`, yielding zero extracted values exactly where
    prose/table answers needed protection (review 13).

    Filter by location instead: exclude the section starting with `## 실패`
    so failure-condition prose is removed while rules remain. Include numbers
    in table cells, where row numbers appear.

    Use only for discriminating cases. Regression/parity prompts are input text
    itself, so their prompts legitimately contain tokens from the criteria.
    """
    body = re.split(r"^##+\s*(?:실패|Failure)", text, maxsplit=1, flags=re.M)[0]
    out = set()
    for x in (re.findall(r"\*\*([^*\n]{2,60})\*\*", body)
              + re.findall(r"`([^`\n]{2,60})`", body)):
        x = x.strip().strip("*`").strip()
        if re.match(r"^\d+\.\s", x) or "/" in x or x.startswith(("통과 조건", "Both passing conditions", "One passing condition")):
            continue
        if len(x) > 20 and x.endswith(("다.", "다")):
            continue                      # Long prose describes conditions rather than values.
        if len(x) < 3:
            continue                      # One or two characters occur in any prompt.
        out.add(x)
    for row in re.findall(r"^\|(.+)\|$", body, re.M):
        for cell in row.split("|"):
            c = cell.strip().strip("*`").strip()
            if 3 <= len(c) <= 40 and re.search(r"\d", c) and not c.startswith("-"):
                out.add(c)
    return out


def check_eval_cases(check, plugin_root, repo, tag_reader, *,
                     tag, discriminating, answer_tokens):
    """Enforce evaluation tag membership and answer location as contracts.

    Why shared: two trees nearly duplicated 224 lines. _suite_lib.py, read_ref,
    and _Section had already demonstrated divergence three times. Only constants
    differ between trees, so only constants remain local.

    Review 7 exposed unbound tags: promotion condition 4 applies its delta floor
    only to ablation-discriminating cases. case.yaml was excluded from population,
    volume, line survival, and blob checks, and no suite read it. Removing a tag
    silently excluded a poor-performing case, letting the subject choose its own
    measured population after seeing results.

    Require:
    1. Exactly the declared discriminating set; adding or removing tags fails.
    2. The promotion gate's own tag parser, injected as tag_reader.
    3. Every case.yaml matches its Git commit, preventing working-tree tag edits.
    4. Answers appear in grading criteria, not prompts.
    5. Eligibility (answer tokens) and tags determine each other, preventing
       case removal by editing only one handwritten list.
    """
    base = os.path.join(plugin_root, "evals")
    all_cases = []
    for dirpath, _, filenames in os.walk(base):
        if "case.yaml" in filenames:
            all_cases.append((
                os.path.relpath(dirpath, base).replace(os.sep, "/"),
                os.path.join(dirpath, "case.yaml"),
            ))
    all_cases.sort()
    check("평가 케이스가 존재한다", len(all_cases) > 0, f"{len(all_cases)}건")

    # Measure triggering separately from guidance compliance. Content-only
    # grading cannot distinguish skill invocation from finding the same answer
    # through Read/Grep in plugin files, an available path under allowed_tools.
    # Broken routing can therefore leave evaluation green while users get no skill.
    # Measured example: humanize-general fired in 5/5 runs, but content passed
    # with 1/5 versus without 4/5. Without the invocation metric, this could be
    # misdiagnosed as failure to trigger, suggesting the opposite intervention.
    # Require invocation metrics for every case. The harness treats tool_used
    # as withOnly: true, scored: false, so it does not score the baseline arm or
    # inflate delta (verified in artifacts).
    for rel, path in all_cases:
        gdir = os.path.join(os.path.dirname(path), "graders")
        fired = []
        if os.path.isdir(gdir):
            for gn in sorted(os.listdir(gdir)):
                if not gn.endswith(".md"):
                    continue
                gt = read_ref(os.path.join(gdir, gn)) or ""
                if re.search(r"(?m)^type:\s*tool_used\s*$", gt):
                    fired.append((gn, gt))
        check(f"발동 계측: {rel} 에 tool_used 채점기가 있다",
              bool(fired), "only content grading is present; invocation cannot be distinguished")
        for gn, gt in fired:
            # A weight would score this metric, assign the baseline zero, and
            # artificially widen delta. Keep it as an unscored metric.
            check(f"발동 계측: {rel}/{gn} 이 점수가 아니라 지표다",
                  not re.search(r"(?m)^weight:", gt),
                  "declared weight inflates delta")
            check(f"발동 계측: {rel}/{gn} 이 Skill 도구를 겨냥한다",
                  re.search(r"(?m)^tool:\s*Skill\s*$", gt) is not None,
                  "tool: Skill is required")

    # Regex graders run in JavaScript. Python syntax can silently measure the
    # wrong property and misattribute that verdict to a skill defect.
    # Four humanize-general absence checks used \A(?!...). JavaScript reads
    # \A as literal A, not an anchor, so only the three of ten answers containing
    # A passed; seven outputs without prohibited expressions falsely failed.
    # The explanation accounted for all 10 runs and prevented a false finding.
    # A false-positive checker is worse than none (class H): engine differences
    # invalidate the meaning of the measurement.
    _JS_UNSAFE = (
        (r"\\A", "JavaScript has no `\\A` anchor; it reads literal A. Use `^`"),
        (r"\\Z", "JavaScript reads `\\Z` as literal Z. Use `$`"),
        (r"\\z", "JavaScript reads `\\z` as literal z. Use `$`"),
        (r"\(\?P<", "JavaScript named groups use `(?<name>...)`"),
        (r"\(\?[a-z]+\)", "JavaScript has no inline `(?s)` flags; use `flags:`"),
        (r"\(\?#", "JavaScript has no `(?#...)` comment groups"),
    )
    for rel, path in all_cases:
        gdir = os.path.join(os.path.dirname(path), "graders")
        if not os.path.isdir(gdir):
            continue
        for gn in sorted(os.listdir(gdir)):
            if not gn.endswith(".md"):
                continue
            gt = read_ref(os.path.join(gdir, gn)) or ""
            if not re.search(r"(?m)^type:\s*regex\s*$", gt):
                continue
            m = re.search(r'(?m)^pattern:\s*"(.*)"\s*$', gt)
            check(f"정규식 채점기: {rel}/{gn} 이 pattern 을 선언한다",
                  m is not None, "pattern line is missing or not double-quoted")
            if not m:
                continue
            hits = [why for pat, why in _JS_UNSAFE if re.search(pat, m.group(1))]
            check(f"정규식 채점기: {rel}/{gn} 이 JS 에서 같은 뜻이다",
                  not hits, "; ".join(hits))

    found, untagged = set(), []
    for rel, path in all_cases:
        with open(path, encoding="utf-8") as f:
            tags = tag_reader(f.read())
        if not tags:
            untagged.append(rel)
        if tag in tags:
            found.add(rel)
    check("모든 케이스가 tags 를 선언한다", not untagged, f"{untagged}")

    # Check both directions; one-way comparison misses tag removal.
    check(f"판별 케이스가 정확히 {len(discriminating)}개다",
          found == set(discriminating),
          f"빠짐 {sorted(set(discriminating) - found)} / "
          f"추가 {sorted(found - set(discriminating))}")

    # Block working-tree bypasses: tag edits require commits and remain in diffs.
    for rel, path in all_cases:
        # Check tracking first. git diff HEAD on an untracked path returns zero,
        # which otherwise lets an uncommitted case.yaml appear committed and
        # turns the intended bypass guard into a bypass route.
        _tracked = subprocess.run(
            ["git", "ls-files", "--error-unmatch", "--", path],
            cwd=repo, capture_output=True,
        )
        p = subprocess.run(["git", "diff", "--quiet", "HEAD", "--", path],
                           cwd=repo, capture_output=True)
        # rc 128 means outside Git: explicitly fail instead of claiming binding.
        if p.returncode == 128:
            check(f"case.yaml 이 git 에 있다: {rel}", False, "git 밖")
        else:
            check(f"case.yaml 이 커밋본과 같다: {rel}",
                  p.returncode == 0 and _tracked.returncode == 0,
                  "untracked; not committed" if _tracked.returncode != 0
                  else "modified in the working tree; changing tags can bypass the gate")

    # Answers must be in criteria rather than prompts. No suite read prompt.md;
    # truncating it to zero bytes escaped all checks in review 9. A root guard
    # that checks existence alone is insufficient.
    for _rel, _toks in sorted(answer_tokens.items()):
        _b = os.path.join(base, _rel)
        _pr = read_ref(os.path.join(_b, "prompt.md")) or ""
        _cr = read_ref(os.path.join(_b, "graders", "criteria.md")) or ""
        # Empty token lists previously went unnoticed: retaining their keys
        # kept check counts unchanged, bypassing check_total (review 11).
        check(f"정답 위치: {_rel} 정답 토큰이 선언돼 있다",
              len(_toks) >= 2 and all(len(t) >= 2 for t in _toks), f"{_toks}")
        _auto = _criteria_values(_cr)
        _leak = sorted({t for t in list(_toks) + sorted(_auto) if t and t in _pr})
        _missing = [t for t in _toks if t not in _cr]
        # Expose automatically extracted values missing from the handwritten list.
        _uncovered = sorted(v for v in _auto
                            if not any(v in t or t in v for t in _toks))
        check(f"정답 위치: {_rel} 프롬프트가 정답을 흘리지 않는다",
              not _leak, f"프롬프트에 있다: {_leak}")
        check(f"정답 위치: {_rel} 채점 기준이 정답을 담는다",
              not _missing, f"기준에 없다: {_missing}")
        check(f"정답 위치: {_rel} 선언이 기준의 값을 빠짐없이 덮는다",
              not _uncovered, f"손목록 밖: {_uncovered}")

    # Eligible cases must be tagged. Review 10 showed that consistently editing
    # both case.yaml tags and the handwritten list, then committing, excluded
    # low-delta cases without even making assertions tautological.
    # Bind eligibility to a separate fact: answer_tokens declares answers that
    # require references, and owning skill suites compare tokens with actual
    # documents. Removing a tag must also remove its token entry, which removes
    # three checks and is caught by check_total.
    _untagged_eligible = sorted(set(answer_tokens) - found)
    check("자격: 정답 토큰을 가진 케이스는 전부 태그를 단다",
          not _untagged_eligible, f"태그 없음: {_untagged_eligible}")
    _tagged_ineligible = sorted(found - set(answer_tokens))
    check("자격: 태그가 붙은 케이스는 전부 정답 토큰을 갖는다",
          not _tagged_ineligible, f"토큰 없음: {_tagged_ineligible}")


def check_no_constant_assertions(check, suite_file):
    """Scan the suite AST for verdicts that evaluate to constants.

    Review 7 found a source-splitting assertion with an `else True` fallback.
    The source had two triple-quote delimiters while the condition required
    at least three, so it literally returned True without inspecting the target.

    The initial scanner covered only ast.Constant and ast.IfExp. Review 8
    tested five forms and caught one; constants stored in variables, or True,
    len([]) == 0, and globals()["check"](...) escaped. Like the abandoned regex
    linter, the detector shares the code's expression space.

    Expand node coverage without relying on it alone. Body-deletion regression
    covers the same defect independently: a constant assertion still passes
    after deletion and contributes no failure, exposing it under measured floors.
    """
    import ast

    # Scan the shared library too. Parsing only the suite excluded 19 verdicts
    # here, directly allowing 13/14 True mutations to preserve identical output
    # in review 7. Self-inspection includes the detector's own verdicts.
    # Also scan sibling Python tests, which are part of the invoked suite.
    # Scanning only run_tests.py and this library let science's roster checker,
    # audit's self-rebuttal checker, and five humanize checkers become constant
    # passing stubs. Adversarial science D-2 replaced all 13 verdicts with True
    # and still passed 82/82.
    _tests_dir = os.path.dirname(os.path.abspath(suite_file))
    _siblings = [os.path.join(_tests_dir, n)
                 for n in sorted(os.listdir(_tests_dir))
                 if n.endswith(".py") and n != os.path.basename(suite_file)] \
        if os.path.isdir(_tests_dir) else []
    srcs = [suite_file, __file__] + _siblings

    def _src(x):
        with open(x, encoding="utf-8") as f:
            return f.read()

    tree = ast.parse("\n".join(_src(x) for x in dict.fromkeys(srcs)))

    BUILTIN_OK = {
        "len",
        "list",
        "set",
        "dict",
        "tuple",
        "str",
        "int",
        "bool",
        "sorted",
        "any",
        "all",
        "sum",
        "abs",
        "min",
        "max",
        "range",
        "True",
        "False",
        "None",
    }

    # Collect names assigned constants at module/function level. Reassigned
    # names are not constants: initializing ok=True then setting ok=False in a
    # loop is legitimate. Misclassifying this caused false positives in proof's
    # comparison of two implementations.
    assigned: dict[str, int] = {}
    const_candidates = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Assign, ast.AugAssign, ast.AnnAssign)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            for t in targets:
                if isinstance(t, ast.Name):
                    assigned[t.id] = assigned.get(t.id, 0) + 1
                    if (
                        isinstance(node, ast.Assign)
                        and isinstance(node.value, ast.Constant)
                        and bool(node.value.value)
                    ):
                        const_candidates.add(t.id)
        elif isinstance(node, (ast.For, ast.comprehension)):
            tgt = node.target
            for n in ast.walk(tgt):
                if isinstance(n, ast.Name):
                    assigned[n.id] = assigned.get(n.id, 0) + 2  # Loop variables are mutable.
    const_names = {n for n in const_candidates if assigned.get(n, 0) == 1}

    def const_true(node):
        """Return whether this expression is true independently of the input.

        The axis is target reference: without free variables (excluding builtins
        and constant names), an expression is input-independent.

        Explicit limit: tautologies that reference the target are outside this
        axis, such as skill is not None, len(skill) >= 0, skill.count("zzz") >= 0,
        and not [x for x in [] if x in skill]. Executing the target to establish
        values would place the guard inside the target's trust boundary.

        Do not rely on this check alone. With measured minimum floors, replacing
        a verdict with a tautology reduces deletion-copy failures. Removing floor
        slack exposed such mutations in red_suite. AST scanning is a secondary
        guard for easily overlooked forms such as an else True fallback.

        Fallback direction matters: previously, failure to fold a variable-free
        expression meant nonconstant, leaving an implicit node allowlist that
        missed eight forms (membership, a constant lambda call, repetition, etc.).
        Now no free variables means constant even if folding fails: the conclusion
        is input independence, not a known truth value. Folding only filters out
        constants that evaluate False, which already fail visibly.
        """
        names = {n.id for n in ast.walk(node) if isinstance(n, ast.Name)}
        # Names bound inside comprehensions/lambdas are not free. Otherwise
        # x in [x for x in [1]] appears to reference a target, allowing an
        # input-independent expression to escape.
        bound = set()
        for n in ast.walk(node):
            if isinstance(
                n, (ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp)
            ):
                for gen in n.generators:
                    bound |= {
                        t.id for t in ast.walk(gen.target) if isinstance(t, ast.Name)
                    }
            elif isinstance(n, ast.Lambda):
                bound |= {a.arg for a in n.args.args}
        free = names - BUILTIN_OK - const_names - bound
        if free:
            # The expression references the target, but X or True remains
            # true regardless of other operands. Handle that case separately.
            if isinstance(node, ast.BoolOp) and isinstance(node.op, ast.Or):
                return any(const_true(v) for v in node.values)
            return False
        folded = _fold(node)
        return folded is not False  # Treat an un-foldable result (None) as constant.

    def _fold(node):
        """Fold an expression without free variables; unknown is None, not False.

        Never eval target source. That would share its trust boundary and allow
        expressions such as [0]*10**10 to execute inside the linter.
        """
        try:
            return bool(ast.literal_eval(node))
        except (ValueError, SyntaxError, TypeError):
            pass
        if isinstance(node, ast.Name):
            return True if node.id in const_names or node.id == "True" else None
        if isinstance(node, ast.BoolOp):
            vals = [_fold(v) for v in node.values]
            if any(v is None for v in vals):
                return None
            return all(vals) if isinstance(node.op, ast.And) else any(vals)
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.Not):
            inner = _fold(node.operand)
            return None if inner is None else (not inner)
        if isinstance(node, ast.Compare) and len(node.ops) == 1:
            return _fold_compare(node)
        return None

    def _fold_compare(node):
        """Fold one comparison, evaluating only the selected operator lazily.

        Eagerly building a dictionary of six comparisons evaluated every operator.
        A simple 1 is not None then raised TypeError and killed the linter before
        the guarded code could run.
        """
        try:
            left = ast.literal_eval(node.left)
        except (ValueError, SyntaxError, TypeError):
            left = _fold_len(node.left)
            if left is None:
                return None
        try:
            right = ast.literal_eval(node.comparators[0])
        except (ValueError, SyntaxError, TypeError):
            return None
        op = node.ops[0]
        ops = {
            ast.Eq: lambda: left == right,
            ast.NotEq: lambda: left != right,
            ast.Lt: lambda: left < right,
            ast.LtE: lambda: left <= right,
            ast.Gt: lambda: left > right,
            ast.GtE: lambda: left >= right,
            ast.In: lambda: left in right,
            ast.NotIn: lambda: left not in right,
            ast.Is: lambda: left is right,
            ast.IsNot: lambda: left is not right,
        }
        for kind, fn in ops.items():
            if isinstance(op, kind):
                try:
                    return bool(fn())
                except TypeError:
                    return None
        return None

    def _fold_len(node):
        """Fold a call with constant arguments, such as len([...])."""
        if not (isinstance(node, ast.Call) and getattr(node.func, "id", "") == "len"):
            return None
        try:
            return len(ast.literal_eval(node.args[0]))
        except (ValueError, SyntaxError, TypeError, IndexError):
            return None

    def _always_positive(node):
        """Return whether the expression is provably at least one (help T-3/T-4)."""
        if (isinstance(node, ast.Call) and getattr(node.func, "id", "") == "max"
                and any(isinstance(a, ast.Constant) and isinstance(a.value, (int, float))
                        and a.value > 0 for a in node.args)):
            return True
        if (isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add)
                and isinstance(node.right, ast.Constant)
                and isinstance(node.right.value, (int, float))
                and node.right.value > 0):
            return _always_nonneg(node.left)
        return False

    def _always_nonneg(node):
        # A sum of nonnegative constant terms is nonnegative (adversarial help T-2).
        if (isinstance(node, ast.Call) and getattr(node.func, "id", "") == "sum"
                and node.args and isinstance(node.args[0], (ast.GeneratorExp, ast.ListComp))
                and isinstance(node.args[0].elt, ast.Constant)
                and isinstance(node.args[0].elt.value, (int, float))
                and node.args[0].elt.value >= 0):
            return True
        # max(len(x), 1) and len(x) + 1 are nonnegative (workspace F05/F11).
        if (isinstance(node, ast.Call) and getattr(node.func, "id", "") == "max"
                and node.args and any(
                    isinstance(a, ast.Constant) and isinstance(a.value, (int, float))
                    and a.value >= 0 for a in node.args)):
            return True
        if (isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add)
                and isinstance(node.right, ast.Constant)
                and isinstance(node.right.value, (int, float))
                and node.right.value >= 0):
            return _always_nonneg(node.left)
        """Return whether the expression is provably nonnegative; unknown is False."""
        if isinstance(node, ast.Call):
            fn = node.func
            if getattr(fn, "id", "") == "len":
                return True
            if isinstance(fn, ast.Attribute) and fn.attr == "count":
                return True
            # x.count("") is always at least one: every position counts.
            # Adversarial cleanup B6 bypassed the rule with str(rc).count("") >= 1.
        return False

    # Expand one level of local names. Top-level shape checks otherwise see
    # only Name for natural forms such as _ok = isinstance(thin, list), silently
    # disabling detection even without bypass intent (review 15). Remember the
    # right-hand side of singly assigned names and substitute it for inspection.
    # const_true already does this for constants; here nonconstant expressions
    # are expanded too.
    single_assign = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and len(node.targets) == 1:
            t = node.targets[0]
            if isinstance(t, ast.Name) and assigned.get(t.id, 0) == 1:
                single_assign[t.id] = node.value

    def tautological_shape(node, _depth=0):
        """Detect input-independent shapes that nevertheless reference a target.

        const_true cannot detect isinstance(x, list), len(x) >= 0, or x is not
        None because they have free variables. Reviews 8 through 13 repeatedly
        used these forms to disable coverage, science, test_evals, and output-style
        contracts while suites stayed green.

        Establishing values would require execution, but these forms are not
        meaningful contract verdicts here: no contract merely asks whether a
        value is a list, has nonnegative length, or is non-None. Ban the finite
        set of enumerated shapes rather than evaluating values.

        Inspect only the verdict's top-level shape to avoid false positives:
        other terms within and/or expressions may measure actual content.
        """
        # Empty-string membership, x in x, and x in x + "y" are tautological.
        # In escaped the earlier axis (delegate C-10 and bridge C-7).
        # Adversarial help T-1 through T-18 additions (2026-09-02).
        if isinstance(node, ast.Compare) and len(node.ops) == 1:
            _hop, _hc = node.ops[0], node.comparators[0]
            _hv = (_hc.value if isinstance(_hc, ast.Constant)
                   and isinstance(_hc.value, (int, float)) else
                   (-_hc.operand.value if isinstance(_hc, ast.UnaryOp)
                    and isinstance(_hc.op, ast.USub)
                    and isinstance(_hc.operand, ast.Constant)
                    and isinstance(_hc.operand.value, (int, float)) else None))
            # T-3/T-4: compare a provably positive expression against a trivial floor.
            if _hv is not None and _always_positive(node.left) and (
                    (isinstance(_hop, ast.Gt) and _hv <= 0)
                    or (isinstance(_hop, ast.GtE) and _hv <= 1)):
                return "trivial floor comparison of a provably positive expression (always true)"
            # T-9: find has minimum -1; these comparisons below its range always pass.
            if (isinstance(node.left, ast.Call)
                    and isinstance(node.left.func, ast.Attribute)
                    and node.left.func.attr in ("find", "rfind")
                    and _hv is not None and (
                        (isinstance(_hop, ast.GtE) and _hv <= -1)
                        or (isinstance(_hop, ast.Gt) and _hv <= -2)
                        or (isinstance(_hop, ast.NotEq) and _hv <= -2))):
                return "comparison outside the find result range (always true)"
            # T-5/T-6: is not None / != None on regexes matching even an empty string.
            if (isinstance(_hop, (ast.IsNot, ast.NotEq))
                    and isinstance(_hc, ast.Constant) and _hc.value is None
                    and isinstance(node.left, ast.Call)
                    and isinstance(node.left.func, ast.Attribute)
                    and node.left.func.attr in ("search", "match", "fullmatch")
                    and node.left.args
                    and isinstance(node.left.args[0], ast.Constant)
                    and isinstance(node.left.args[0].value, str)):
                try:
                    import re as _re2
                    if _re2.compile(node.left.args[0].value).search("") is not None:
                        return "regex matching even an empty string (always true)"
                except Exception:                      # noqa: BLE001
                    pass
        # T-7/T-8: an empty string in a startswith/endswith tuple always matches.
        if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                and node.func.attr in ("startswith", "endswith") and node.args):
            _a0 = node.args[0]
            if isinstance(_a0, ast.Call) and getattr(_a0.func, "id", "") == "tuple" \
                    and _a0.args:
                _a0 = _a0.args[0]
            if isinstance(_a0, (ast.Tuple, ast.List)) and any(
                    isinstance(e, ast.Constant) and e.value == "" for e in _a0.elts):
                return "startswith/endswith tuple containing an empty string (always true)"
        # T-18: a local helper returning True bypassed both axes: const_true
        # saw a free variable and single_assign did not expand FunctionDef.
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) \
                and node.func.id in const_funcs:
            return f"call to always-true helper {node.func.id}() (always true)"

        # Adversarial recall T-1 through T-5 additions (2026-09-02).
        if isinstance(node, ast.Compare) and len(node.ops) == 1:
            _rop, _rc = node.ops[0], node.comparators[0]
            # T-1: x.count("") is always at least one.
            if (isinstance(_rop, (ast.GtE, ast.Gt))
                    and isinstance(node.left, ast.Call)
                    and isinstance(node.left.func, ast.Attribute)
                    and node.left.func.attr == "count"
                    and node.left.args
                    and isinstance(node.left.args[0], ast.Constant)
                    and node.left.args[0].value == ""
                    and isinstance(_rc, ast.Constant)
                    and isinstance(_rc.value, (int, float))
                    and _rc.value <= (1 if isinstance(_rop, ast.GtE) else 0)):
                return "trivial lower bound on empty-string count (always true)"
            # T-2: x not in [] always holds for an empty literal container.
            if (isinstance(_rop, ast.NotIn)
                    and isinstance(_rc, (ast.List, ast.Tuple, ast.Set))
                    and not _rc.elts):
                return "not in an empty literal container (always true)"
            # T-4: x in x * 2 tests membership in a repetition containing itself.
            if (isinstance(_rop, ast.In) and isinstance(_rc, ast.BinOp)
                    and isinstance(_rc.op, ast.Mult)):
                try:
                    _ls = ast.unparse(node.left)
                    if _ls in (ast.unparse(_rc.left), ast.unparse(_rc.right)):
                        return "membership in a repetition containing itself (always true)"
                except Exception:                      # noqa: BLE001
                    pass
            # T-5: != None is the comparison counterpart of is not None.
            if (isinstance(_rop, ast.NotEq) and isinstance(_rc, ast.Constant)
                    and _rc.value is None
                    and isinstance(node.left, ast.Call)
                    and isinstance(node.left.func, ast.Attribute)
                    and node.left.func.attr in ("search", "match", "fullmatch")
                    and node.left.args
                    and isinstance(node.left.args[0], ast.Constant)
                    and node.left.args[0].value in ("", ".*", "(?s).*")):
                return "!= None on an always-matching regex (always true)"
        # T-3: all over an empty population is always true.
        if (isinstance(node, ast.Call) and getattr(node.func, "id", "") == "all"
                and node.args
                and isinstance(node.args[0], (ast.GeneratorExp, ast.ListComp))
                and node.args[0].generators):
            _it = node.args[0].generators[0].iter
            if isinstance(_it, (ast.List, ast.Tuple, ast.Set)) and not _it.elts:
                return "all over an empty population (always true)"

        # Adversarial workspace F01 through F14 additions (2026-09-02).
        # Strip double negation first; not (not isinstance(x, str)) bypassed the rule.
        _n = node
        while (isinstance(_n, ast.UnaryOp) and isinstance(_n.op, ast.Not)
               and isinstance(_n.operand, ast.UnaryOp)
               and isinstance(_n.operand.op, ast.Not)):
            _n = _n.operand.operand
        if _n is not node:
            _inner = tautological_shape(_n, _depth)
            if _inner:
                return f"after double negation: {_inner}"
        # Negating nonnegative < 0 or nonnegative <= -1 is always true.
        if (isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.Not)
                and isinstance(node.operand, ast.Compare)
                and len(node.operand.ops) == 1):
            _in = node.operand
            _iop, _ic = _in.ops[0], _in.comparators[0]

            def _nv(c):
                if isinstance(c, ast.Constant) and isinstance(c.value, (int, float)):
                    return c.value
                if (isinstance(c, ast.UnaryOp) and isinstance(c.op, ast.USub)
                        and isinstance(c.operand, ast.Constant)
                        and isinstance(c.operand.value, (int, float))):
                    return -c.operand.value
                return None

            _v = _nv(_ic)
            if _v is not None and _always_nonneg(_in.left) and (
                    (isinstance(_iop, ast.Lt) and _v <= 0)
                    or (isinstance(_iop, ast.LtE) and _v < 0)):
                return "negation of an always-false comparison (always true)"
        # Excluded middle: bool(P) or not P, and P or not P.
        if isinstance(node, ast.BoolOp) and isinstance(node.op, ast.Or) and len(node.values) == 2:
            def _bare(e):
                if isinstance(e, ast.Call) and getattr(e.func, "id", "") == "bool" and e.args:
                    e = e.args[0]
                return e
            _a, _b = node.values
            for _x, _y in ((_a, _b), (_b, _a)):
                if isinstance(_y, ast.UnaryOp) and isinstance(_y.op, ast.Not):
                    try:
                        if ast.unparse(_bare(_x)) == ast.unparse(_bare(_y.operand)):
                            return "excluded middle P or not P (always true)"
                    except Exception:                  # noqa: BLE001
                        pass
        # x.startswith(x) / x.endswith(x) ask whether a value starts/ends with itself.
        if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                and node.func.attr in ("startswith", "endswith") and len(node.args) == 1):
            try:
                if ast.unparse(node.func.value) == ast.unparse(node.args[0]):
                    return "startswith/endswith itself (always true)"
            except Exception:                          # noqa: BLE001
                pass
        # Empty regex patterns always match. Do not ban is not None in general,
        # which would produce false positives; target literal patterns whose
        # match is unconditional.
        if (isinstance(node, ast.Compare) and len(node.ops) == 1
                and isinstance(node.ops[0], ast.IsNot)
                and isinstance(node.comparators[0], ast.Constant)
                and node.comparators[0].value is None
                and isinstance(node.left, ast.Call)
                and isinstance(node.left.func, ast.Attribute)
                and node.left.func.attr in ("search", "match", "fullmatch")
                and node.left.args
                and isinstance(node.left.args[0], ast.Constant)
                and node.left.args[0].value in ("", ".*", "(?s).*")):
            return "is not None on an always-matching regex (always true)"
        # find/rfind have minimum -1, so a >= -1 check is tautological.
        if (isinstance(node, ast.Compare) and len(node.ops) == 1
                and isinstance(node.ops[0], ast.GtE)
                and isinstance(node.left, ast.Call)
                and isinstance(node.left.func, ast.Attribute)
                and node.left.func.attr in ("find", "rfind")
                and isinstance(node.comparators[0], ast.UnaryOp)
                and isinstance(node.comparators[0].op, ast.USub)
                and isinstance(node.comparators[0].operand, ast.Constant)
                and node.comparators[0].operand.value == 1):
            return "find >= -1 (always true)"

        # Adversarial cleanup B1 through B9 additions (2026-09-02).
        # Cover nine bypasses that changed only operator, direction, or shape.
        if isinstance(node, ast.Compare) and len(node.ops) == 1:
            _op, _cmp = node.ops[0], node.comparators[0]

            def _numv(c):
                if isinstance(c, ast.Constant) and isinstance(c.value, (int, float)):
                    return c.value
                if (isinstance(c, ast.UnaryOp) and isinstance(c.op, ast.USub)
                        and isinstance(c.operand, ast.Constant)
                        and isinstance(c.operand.value, (int, float))):
                    return -c.operand.value
                return None

            # B1/B2: handle trivial nonnegative/negative comparisons with either operand order.
            for _side, _other, _rev in ((node.left, _cmp, False), (_cmp, node.left, True)):
                _v = _numv(_other)
                if _v is None or not _always_nonneg(_side):
                    continue
                _o = _op
                if _rev:   # Reverse the comparison when the constant is on the left.
                    _o = {ast.Lt: ast.Gt, ast.Gt: ast.Lt,
                          ast.LtE: ast.GtE, ast.GtE: ast.LtE}.get(type(_o), type(_o))()
                if isinstance(_o, ast.NotEq) and _v < 0:
                    return "nonnegative != negative (always true)"
                if isinstance(_o, ast.GtE) and _v <= 0:
                    return "nonnegative >= a nonpositive bound (always true)"
                if isinstance(_o, ast.Gt) and _v < 0:
                    return "nonnegative > negative (always true)"
            # B3: identical operands also make >= and <= true (Eq/Is handled separately).
            if isinstance(_op, (ast.GtE, ast.LtE)):
                try:
                    if ast.unparse(node.left) == ast.unparse(_cmp):
                        return "identical operands in >=/<= (always true)"
                except Exception:                      # noqa: BLE001
                    pass
            # B4: membership in a literal container containing the expression itself.
            if isinstance(_op, ast.In) and isinstance(_cmp, (ast.List, ast.Tuple, ast.Set)):
                try:
                    _lsrc = ast.unparse(node.left)
                    if any(ast.unparse(e) == _lsrc for e in _cmp.elts):
                        return "membership in a literal container containing itself (always true)"
                except Exception:                      # noqa: BLE001
                    pass
        # B5 — `x.startswith("")` · `x.endswith("")`
        if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                and node.func.attr in ("startswith", "endswith")
                and len(node.args) == 1 and isinstance(node.args[0], ast.Constant)
                and node.args[0].value == ""):
            return "startswith/endswith an empty string (always true)"
        if isinstance(node, ast.Compare) and len(node.ops) == 1:
            op, comp = node.ops[0], node.comparators[0]
            if isinstance(op, ast.In):
                if isinstance(node.left, ast.Constant) and node.left.value == "":
                    return "empty-string membership (always true)"
                try:
                    lsrc = ast.unparse(node.left)
                    if lsrc == ast.unparse(comp):
                        return "membership in itself (always true)"
                    if (
                        isinstance(comp, ast.BinOp)
                        and isinstance(comp.op, ast.Add)
                        and (
                            lsrc == ast.unparse(comp.left)
                            or lsrc == ast.unparse(comp.right)
                        )
                    ):
                        return "membership in concatenation containing itself (always true)"
                except Exception:  # noqa: BLE001
                    pass
        # Negated empty-population comprehensions are the form D limitation
        # documented by const_true. A literally empty population can nevertheless
        # be recognized by shape alone (adversarial delegate C-15).
        if (
            isinstance(node, ast.UnaryOp)
            and isinstance(node.op, ast.Not)
            and isinstance(node.operand, (ast.ListComp, ast.SetComp, ast.GeneratorExp))
        ):
            it = node.operand.generators[0].iter
            if isinstance(it, (ast.List, ast.Set, ast.Tuple)) and not it.elts:
                return "empty-population comprehension (always true)"
        # One tautological or term makes the entire verdict tautological:
        # <real check> or len(x) >= 0 bypassed bridge C-8. Use any, unlike and.
        if isinstance(node, ast.BoolOp) and isinstance(node.op, ast.Or):
            for v in node.values:
                s = tautological_shape(v, _depth)
                if s:
                    return f"tautological or term: {s}"
        # len(x) >= 0 and x.count(...) >= 0 are always true.
        # Do not ban x is not None generally: re.search(...) is not None is a
        # legitimate pattern-match verdict. Whether it is tautological depends
        # on the left operand and cannot be inferred from this shape alone.
        # False-positive rules train people to ignore the detector.
        if isinstance(node, ast.Compare) and len(node.ops) == 1:
            op, comp = node.ops[0], node.comparators[0]

            # Require a provably nonnegative left operand. Ignoring it falsely
            # flagged the legitimate _margin >= 0 floor check: margins can become
            # negative when documents shrink below a floor (review 15).
            # Cover comparison constants <= 0, not only zero; changing count >= 0
            # to count >= -1 escaped delegate C-10. Negative literals are AST
            # UnaryOp(USub, Constant), not plain Constant nodes.
            def _num(c):
                if isinstance(c, ast.Constant) and isinstance(c.value, (int, float)):
                    return c.value
                if (
                    isinstance(c, ast.UnaryOp)
                    and isinstance(c.op, ast.USub)
                    and isinstance(c.operand, ast.Constant)
                    and isinstance(c.operand.value, (int, float))
                ):
                    return -c.operand.value
                return None

            cv = _num(comp)
            if (
                cv is not None
                and _always_nonneg(node.left)
                and (
                    (isinstance(op, ast.GtE) and cv <= 0)
                    or (isinstance(op, ast.Gt) and cv < 0)
                )
            ):
                return "len/count above a trivial lower bound (always true)"
            # x == x compares an expression with itself. No legitimate contract needs it;
            # review 16 confirmed no false-positive case.
            if isinstance(op, (ast.Eq, ast.Is)):
                try:
                    if ast.unparse(node.left) == ast.unparse(comp):
                        return "identical operands (always true)"
                except Exception:  # noqa: BLE001
                    pass
        # A verdict consisting solely of isinstance(x, T).
        if isinstance(node, ast.Call) and getattr(node.func, "id", "") == "isinstance":
            return "isinstance only"
        # The same applies to not isinstance(...).
        if (
            isinstance(node, ast.UnaryOp)
            and isinstance(node.op, ast.Not)
            and isinstance(node.operand, ast.Call)
            and getattr(node.operand.func, "id", "") == "isinstance"
        ):
            return "isinstance only"
        # An and expression is meaningless when every term has one of these shapes.
        if isinstance(node, ast.BoolOp) and isinstance(node.op, ast.And):
            shapes = [tautological_shape(v, _depth) for v in node.values]
            if shapes and all(shapes):
                return "; ".join(dict.fromkeys(shapes))
        # Expand a singly assigned local name one level to its right-hand side.
        if isinstance(node, ast.Name) and _depth < 1 and node.id in single_assign:
            inner = tautological_shape(single_assign[node.id], _depth + 1)
            if inner:
                return f"{inner}; stored in variable {node.id}"
        return None

    # Collect aliases such as _ck = check. Even literal True escaped after
    # aliasing in adversarial recall B-1.
    check_aliases = {"check"}
    for _n in ast.walk(tree):
        if isinstance(_n, ast.Assign) and isinstance(_n.value, ast.Name) \
                and _n.value.id in check_aliases:
            for _t in _n.targets:
                if isinstance(_t, ast.Name):
                    check_aliases.add(_t.id)

    def is_check_call(node):
        """Recognize check(), aliases, and indirect globals()["check"] calls."""
        if not isinstance(node, ast.Call):
            return False
        f = node.func
        if getattr(f, "id", "") in check_aliases:
            return True
        if isinstance(f, ast.Subscript):  # Form 5: indirect call.
            sl = f.slice
            return isinstance(sl, ast.Constant) and sl.value == "check"
        if isinstance(f, ast.Attribute) and f.attr == "check":
            return True
        return False

    # Local functions returning constant True (adversarial help T-18).
    const_funcs = set()
    for _fn in ast.walk(tree):
        if isinstance(_fn, ast.FunctionDef) and len(_fn.body) == 1 \
                and isinstance(_fn.body[0], ast.Return) \
                and isinstance(_fn.body[0].value, ast.Constant) \
                and _fn.body[0].value.value is True:
            const_funcs.add(_fn.name)

    bad = []
    # results.append((name, True, "")) bypasses check() entirely (recall B-2).
    # A constant-True second element declares success instead of measuring it.
    for node in ast.walk(tree):
        if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                and node.func.attr == "append" and len(node.args) == 1
                and isinstance(node.args[0], ast.Tuple) and len(node.args[0].elts) >= 2):
            _v = node.args[0].elts[1]
            if isinstance(_v, ast.Constant) and _v.value is True:
                bad.append("inserted a constant-true verdict via results.append")
    for node in ast.walk(tree):
        if not is_check_call(node):
            continue
        kw = {k.arg: k.value for k in node.keywords if k.arg}
        # Include keyword arguments such as check(name=..., ok=True);
        # positional-only inspection would allow this one-line bypass.
        verdict = (
            node.args[1]
            if len(node.args) >= 2
            else kw.get("ok") or kw.get("passed") or kw.get("result")
        )
        if verdict is None:
            continue
        name_node = node.args[0] if node.args else kw.get("name")
        # Recover f-string source rather than reporting only ?, which made
        # diagnostics unable to identify the verdict (review 7).
        if isinstance(name_node, ast.Constant):
            label = name_node.value
        elif name_node is not None:
            try:
                label = ast.unparse(name_node)[:60]
            except Exception:  # noqa: BLE001
                label = "?"
        else:
            label = "?"
        if const_true(verdict):
            bad.append(f"{label}(constant)")
        elif isinstance(verdict, ast.IfExp) and (
            const_true(verdict.body) or const_true(verdict.orelse)
        ):
            bad.append(f"{label}(constant-true ternary branch)")
        else:
            shape = tautological_shape(verdict)
            if shape:
                bad.append(f"{label}({shape})")
    check("자기검사: 상수로 평가되는 판정이 없다", not bad, "; ".join(bad)[:160])


def content_bytes(text, needles=()):
    """Measure unique content bytes, excluding needles, markup, repeats, and blanks.

    Why not line counts: hwpx once used minimum lines, items, and code fences.
    Padding with blank lines, repeated list items, and empty fences met all three
    floors after deleting 94% of content and still passed 54/55 checks.

    Exclude blanks (no content), repeated lines (padding rather than new content),
    and the needles themselves (letting a needle-only shell meet its own floor
    would be circular). What remains is actual prose, table content, and values.
    """
    # Root-variable spelling is a host notation, not retained semantic content.
    # Normalize both forms to the historical width before applying the existing
    # floors; changing the host name must neither lose nor invent prose bytes.
    text = text.replace("${JSTACK_PLUGIN_ROOT}", "${CLAUDE_PLUGIN_ROOT}")
    needles = tuple(n.replace("${JSTACK_PLUGIN_ROOT}", "${CLAUDE_PLUGIN_ROOT}") for n in needles)
    seen, total = set(), 0
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped in seen:
            continue
        seen.add(stripped)
        body = re.sub(r"^```.*$", "", stripped)
        body = re.sub(r"^[#\->*|:\s]+|[|\s]+$", "", body)
        for n in needles:
            body = body.replace(n, "")
        body = re.sub(r"[\s\-|*`]+", "", body)
        total += len(body.encode("utf-8"))
    return total


def _in_git_repo(path):
    """Check Git membership to distinguish deletion copies from untracked files."""
    try:
        r = subprocess.run(
            ["git", "rev-parse", "--is-inside-work-tree"],
            capture_output=True,
            text=True,
            cwd=os.path.dirname(path) or ".",
        )
        return r.returncode == 0 and r.stdout.strip() == "true"
    except OSError:
        return False


def _worktree_blob(path):
    """Return the blob hash of current file content using git hash-object."""
    try:
        r = subprocess.run(
            ["git", "hash-object", os.path.abspath(path)],
            capture_output=True,
            text=True,
            cwd=os.path.dirname(path) or ".",
        )
        return r.stdout.strip() if r.returncode == 0 else None
    except OSError:
        return None


def _committed_blob(path):
    """Return the committed blob hash using git rev-parse HEAD:<path>.

    It must not change with working-tree edits. Return None outside Git or for
    untracked files so callers can skip the comparison.
    """
    try:
        repo = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True,
            text=True,
            cwd=os.path.dirname(path) or ".",
        )
        if repo.returncode != 0:
            return None
        # Normalize real paths. macOS /var links to /private/var;
        # --show-toplevel resolves it while abspath retains the link. A mismatch
        # yields ../.. paths and silently fails rev-parse, losing the entire
        # blob axis without a failure verdict.
        rel = os.path.relpath(
            os.path.realpath(path), os.path.realpath(repo.stdout.strip())
        )
        r = subprocess.run(
            ["git", "rev-parse", f"HEAD:{rel}"],
            capture_output=True,
            text=True,
            cwd=repo.stdout.strip(),
        )
        return r.stdout.strip() if r.returncode == 0 else None
    except OSError:
        return None


def ref_lines(text):
    """Return normalized document lines as an ordered survival sequence.

    Preserve order, not a set. Previously a set was dumped with sorted(), so
    pasting tests/refs/*.lines into the document achieved 100% survival (review
    10). The checker shipped its own forgery material inside the skill tree.

    With order preserved, sorted dumps have shorter common subsequences. A dump
    restored to the original order reconstructs the original document, retaining
    its actual contracts.
    """
    out = []
    for line in text.splitlines():
        norm = re.sub(r"\s+", " ", line).strip()
        if norm:
            out.append(norm)
    return out


def survival_rate(live, frozen):
    """Measure the common ordered-subsequence ratio against the frozen sequence.

    Unlike set intersection, the sequence comparison accounts for reordering.
    """
    if not frozen:
        return 0.0
    sm = difflib.SequenceMatcher(None, frozen, live, autojunk=False)
    common = sum(b.size for b in sm.get_matching_blocks())
    return common / len(frozen)


def check_skill_body(check, skill_root, *, needles, floor, freeze_dir="tests/refs",
                     orphan_skip=None):
    """Apply content-volume and line-survival axes to the SKILL.md body.

    check_ref_contracts scans references/ only. SKILL.md previously had only
    needle checks, allowing a shell with 91% of its body deleted to pass review
    12: the boundary table collapsed to one line and Phases 0-4 disappeared.
    Apply the same three axes already added to references in reviews 8-9.
    """
    # A zero floor is tautological. This guard existed for per_file/scripts but
    # was missing here; floor=0 passed after 95% body deletion (office C-12).
    if floor < 1:
        check("본문 계약: SKILL.md 부피 하한이 1 이상이다", False,
              f"하한 {floor} — 계약 없는 본문을 선언했다")
        return
    fn = "SKILL.md"
    fp = os.path.join(skill_root, fn)
    with open(fp, encoding="utf-8") as f:
        fm_text, body = split_frontmatter(f.read())
    # L0 is the only always-read layer; invoking here covers every skill.
    check_description(check, skill_root, fm_text)
    _ref_axes(
        check,
        skill_root,
        fn,
        fp,
        body,
        needles,
        floor,
        freeze_dir,
        label_prefix="본문 계약",
    )
    # Apply path existence to every skill here, blocking the demonstrated
    # green results for dead pointers and nonexistent supporting layers.
    check_body_paths(check, skill_root, body, fm_of_skill=fm_text,
                     orphan_skip=orphan_skip)


def check_description(check, skill_root, fm, *, floor=225):
    """Require nonempty metadata and valid references; byte length is not quality."""
    match = re.search(r"^description:[ \t]*(.*(?:\n[ \t]+.*)*)", fm, re.M)
    description = re.sub(r"^[>|]-?[ \t]*\n?", "", match.group(1)).strip() if match else ""
    valid = bool(re.search(r"^name:[ \t]*[a-z][a-z0-9-]*[ \t]*$", fm, re.M) and description)
    check("L0: description metadata is nonempty", valid,
          "name and a nonempty description are required; length is not quality")
    # Emit nothing for an empty population. Zero-item passes are tautological,
    # as already demonstrated elsewhere (adversarial secrets).
    rels = sorted(set(re.findall(r"`((?:references|scripts|tests)/[\w./-]+)`", fm)))
    if rels:
        missing = [r for r in rels if not os.path.exists(os.path.join(skill_root, r))]
        check("L0: description 이 부르는 경로가 실재한다",
              not missing, f"없는 경로 {missing}" if missing else f"{len(rels)}건")
    skills_dir = os.path.dirname(os.path.abspath(skill_root))
    named = set(re.findall(r"`([a-z][a-z0-9-]{2,})`\s*(?:skill|스킬)", fm))
    if named:
        gone = sorted(n for n in named if not os.path.isdir(os.path.join(skills_dir, n)))
        check("L0: description 이 지목한 이웃 스킬이 실재한다",
              not gone, f"없는 이웃 {gone}" if gone else f"{sorted(named)}")


def check_body_paths(check, skill_root, body, *, label_prefix="본문 계약",
                     fm_of_skill="", orphan_skip=None):
    """Check that backticked skill-relative paths in the SKILL.md body exist.

    Adversarial setup T-2/T-5 and audit C1/C5 stayed green after pointers were
    changed to missing files, other skill trees, or fictional supporting layers.
    Needles check strings; volume/survival miss equal-length substitutions.
    No code resolved body paths against the filesystem.

    scripts/check_plugin_paths.py has this axis, but only integrators run it.
    Skills must own it as a contract so it remains effective after distribution.

    Scope is deliberately narrow: skill-relative references/, scripts/, and
    tests/ paths. Parent paths, absolute paths, plugin-root tokens, and user
    project examples are outside this axis to avoid false-positive rules.
    """
    # Check exclusion reasons before the empty-body early return; otherwise
    # this verdict disappears in deletion copies (measured copy 51 / live 52).
    orphan_skip = dict(orphan_skip or {})
    for _sub, _why in sorted(orphan_skip.items()):
        check(f"{label_prefix}: 고아 모집단에서 {_sub} 를 뺀 사유가 있다",
              bool(str(_why).strip()), "no reason provided")

    # An empty body cannot pass. These axes derive populations from the body;
    # deleting it makes not missing vacuously true. All four then passed with
    # zero items in help's deletion copy, and 30 skills emitted these axes.
    # Apply the same no-work-is-not-success rule used by runners and science's
    # parser population guard. Retain names and fail them; conditional omission
    # instead causes disappearance and false survival alarms.
    if not body.strip():
        _why = "empty body; no population to measure"
        for _n in ("본문이 부르는 스킬 안 경로가 전부 실재한다",
                   "실행 경로가 실재하는 스킬을 가리킨다",
                   "실행 경로의 대상 파일이 실재한다",
                   "부속 파일이 전부 어디선가 인용된다 (고아 0)",
                   # There are five axes. Listing only four dropped the fifth
                   # in copies and triggered survival (copy 71 / live 72),
                   # immediately exposing a stale declaration list.
                   "플러그인 루트 토큰이 지원하는 호스트 표기다"):
            check(f"{label_prefix}: {_n}", False, _why)
        return

    rels = sorted(set(re.findall(r"`((?:references|scripts|tests)/[\w./-]+)`", body)))
    missing = [r for r in rels
               if not os.path.exists(os.path.join(skill_root, r))]
    check(f"{label_prefix}: 본문이 부르는 스킬 안 경로가 전부 실재한다",
          not missing, f"없는 경로 {missing}" if missing else f"{len(rels)}건")

    # Execution paths use a plugin-root token followed by skills/name/path.
    # Diagram H8/H9 showed that skill-name typos or entirely renamed tokens
    # stayed green even though the documented commands could not run.
    own = os.path.basename(os.path.abspath(skill_root))
    skills_dir = os.path.dirname(os.path.abspath(skill_root))
    runs = re.findall(r"\$\{(?:JSTACK|CLAUDE)_PLUGIN_ROOT\}/skills/([\w.-]+)/([\w./-]+)", body)
    # Sibling calls are legitimate: office actually invokes humanize/hwpx.
    # Office's probe exposed this false positive. Check existence, not ownership.
    bad_skill = sorted({sk for sk, _ in runs
                        if not os.path.isdir(os.path.join(skills_dir, sk))})
    # Check target files in siblings too. The earlier sk == own restriction
    # let references redirected to another skill's nonexistent file silence all
    # three axes (adversarial secrets R-3).
    bad_rel = set()
    for sk, rel in runs:
        base = skill_root if sk == own else os.path.join(skills_dir, sk)
        if os.path.isdir(base) and not os.path.exists(os.path.join(base, rel)):
            bad_rel.add(f"{sk}/{rel}")
    # Root-level runtime and hook files share the same target-existence gate.
    # Keeping one unconditional result preserves the population after deletion.
    plugin_root = os.path.dirname(skills_dir)
    root_rels = sorted({m for m in re.findall(
        r"\$\{(?:JSTACK|CLAUDE)_PLUGIN_ROOT\}/([\w./-]+)", body) if not m.startswith("skills/")})
    bad_rel.update(r for r in root_rels
                   if not os.path.exists(os.path.join(plugin_root, r)))
    bad_rel = sorted(bad_rel)
    # Emit unconditionally. An if runs guard drops these two axes after body
    # deletion and falsely triggers survival (office). Report zero when empty.
    check(f"{label_prefix}: 실행 경로가 실재하는 스킬을 가리킨다",
          not bad_skill, f"없는 스킬 {bad_skill}" if bad_skill else f"{len(runs)}건")
    check(f"{label_prefix}: 실행 경로의 대상 파일이 실재한다",
          not bad_rel, f"없는 대상 {bad_rel}" if bad_rel else f"{len(runs)}건")
    # Reverse reachability: existing supporting files must be referenced by the
    # body or another reference. Research R-1/R-2/R-4/R-5/S-1 and deck R2/R3/R14
    # removed pointers, leaving orphans without any failing axis; a 91%-deleted
    # SKILL.md shell matched baseline verdicts. Forward existence alone missed it.
    # Population: references Markdown and script files, excluding internal
    # underscore helpers, tests, and caches. References may link to other
    # references (two hops).
    # Search description, body, references, and sibling scripts: bridge links
    # probe.sh only from L0; humanize metrics_v1.py reads baseline.json through
    # code, without needing a document link. Do not count self-citations, which
    # would make a filename in its own docstring sufficient and tautological.
    reach_parts = {"__fm__": fm_of_skill, "__body__": body}
    for sub in ("references", "scripts"):
        root0 = os.path.join(skill_root, sub)
        if not os.path.isdir(root0):
            continue
        for dp, dn, fnames in os.walk(root0):
            dn[:] = [d for d in dn if d not in ("__pycache__", ".ruff_cache")]
            for n in fnames:
                if n.endswith((".pyc", ".lines")):
                    continue
                fp2 = os.path.join(dp, n)
                try:
                    with open(fp2, encoding="utf-8", errors="replace") as f:
                        reach_parts[os.path.relpath(fp2, skill_root)] = f.read()
                except OSError:
                    pass
    # Imported source trees are connected through imports rather than prose.
    # dashboard's 89 TypeScript files use extensionless imports, which filename
    # matching misses. Stripping extensions would falsely match common prose
    # words such as types, measuring word occurrence instead of actual references.
    # Exclude explicitly with reasons and a replacement axis: build reproducibility
    # uses esbuild to resolve imports, omit unused modules, and fail missing ones.
    # Emit an exclusion verdict; silent omission would be class A.
    owned = []
    for sub in ("references", "scripts"):
        if sub in orphan_skip:
            continue
        root = os.path.join(skill_root, sub)
        if not os.path.isdir(root):
            continue
        for dp, dn, fnames in os.walk(root):
            # Apply the internal-underscore convention to directories too.
            # Imported scripts/__tests__/ otherwise added 25 dashboard test files
            # to the orphan population. Listing 25 test names in prose adds noise;
            # disabling the axis loses real orphans. Inconsistent exclusion scope
            # caused the problem.
            dn[:] = [d for d in dn
                     if d not in ("__pycache__", "tests", ".ruff_cache")
                     and not d.startswith(("_", "."))]
            for n in sorted(fnames):
                if n.startswith((".", "_")) or n.endswith((".pyc", ".lines")):
                    continue
                owned.append(os.path.relpath(os.path.join(dp, n), skill_root))
    # A reference fragment must identify exactly one file. Count every path
    # suffix, from basename through partial paths to the full relative path;
    # accept only suffixes unique within this skill.
    def _suffixes(rel):
        parts = rel.split("/")
        return ["/".join(parts[i:]) for i in range(len(parts))]

    _suffix_counts = {}
    for _r in owned:
        for _s in _suffixes(_r):
            _suffix_counts[_s] = _suffix_counts.get(_s, 0) + 1

    def _mentions(text, rel):
        """Check whether the text unambiguously references rel.

        Ambiguity, not syntax, determines reachability: a unique path suffix
        suffices. Full paths are unique; partial paths such as
        validation-hook-template/hooks.json may be unique, while five copies
        of hooks.json make its basename alone ambiguous.

        Previously any basename mention (except URL lines) counted. Adversarial
        round 3 left three README.md and three hooks.json files in author templates
        orphaned but green, while unique zz-orphan.md was correctly detected.
        Duplicate names cannot identify which file a mention refers to.

        Requiring full relative paths would be excessive: science's SKILL.md
        routing table lists 44 unique basenames and establishes the directory
        in a column. Prefixing every entry adds noise; rejecting them creates
        false positives (class H).

        Lines containing :// refer to external URLs, not local files. Replacing
        a pointer with an external URL previously retained its basename and
        incorrectly counted reachability (upstream C-3).
        """
        lines = [ln for ln in text.splitlines() if "://" not in ln]
        for suffix in _suffixes(rel):
            if _suffix_counts.get(suffix, 0) != 1:
                continue           # Multiple files share this suffix; it is ambiguous.
            if any(suffix in ln for ln in lines):
                return True
        return False

    orphan = []
    for r in owned:
        others = "\n".join(v for k, v in reach_parts.items() if k != r)
        if not _mentions(others, r):
            orphan.append(r)
    orphan = sorted(orphan)
    check(f"{label_prefix}: 부속 파일이 전부 어디선가 인용된다 (고아 0)",
          not orphan, f"고아 {orphan}" if orphan else f"{len(owned)}건")

    # Validate token spelling; the harness cannot resolve renamed tokens.
    stray = sorted(set(re.findall(r"\$\{([A-Z_]*PLUGIN_ROOT)\}", body)) - {"CLAUDE_PLUGIN_ROOT", "JSTACK_PLUGIN_ROOT"})
    check(f"{label_prefix}: 플러그인 루트 토큰이 지원하는 호스트 표기다",
          not stray, f"다른 토큰 {stray}")


def _read_text(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


def _freeze_guard(check, fn, fp, frozen_path, raw, label_prefix):
    """Bind frozen references to authentic source evidence through three checks.

    Return (frozen_lines, ok). When ok is False, do not measure survival against
    an untrusted reference.

    This binding originally existed only in check_ref_contracts, not _ref_axes
    (check_skill_body). Duplicated axes diverged: direct reference forgery was
    blocked for references but remained possible for SKILL.md. Replacing a skill
    body with reversed meaning and supplying a handmade .lines with
    # blob:deadbeef still passed 52/52 in external review. Sharing one implementation
    removes this divergence; maintaining parallel copies would recreate it.
    """
    # Deletion copies measure survival but skip binding. Their deliberately empty
    # documents cannot match payloads and are outside Git. Previously returning
    # ok=False here also disabled every one of 40 survival verdicts, placing all
    # outside deletion floors; tautologizing them did not change copy failures
    # (review 16 full sweep). Review 12 had already called this balance accidental.
    # Binding prevents forged references and is unnecessary for our own copies;
    # survival must still fall when their bodies are deleted.
    if in_deleted_run():
        return [ln for ln in raw if ln and not ln.startswith("# blob:")], True
    # A missing hash header indicates a handmade reference. .lines files are
    # generated artifacts, not manually authored files.
    header = next((ln for ln in raw if ln.startswith("# blob:")), None)
    if header is None:
        check(
            f"자기검사: {fn} 동결본에 출처 blob 이 있다",
            False,
            "missing header; handmade frozen references are rejected",
        )
        return [], False
    frozen = [ln for ln in raw if ln and not ln.startswith("# blob:")]

    # Outside Git, four conditional bindings previously vanished, leaving only
    # header existence without checking its value. Marketplace/tarball installs
    # accepted any file with a header; # blob:deadbeef passed 50/50 in review 6.
    # Compare the payload with the document itself outside Git. Commit history
    # is unavailable, but derivation from the current document remains measurable.
    if not _in_git_repo(fp):
        # Measure what remains available: whether the reference derives from
        # this document. A prior version used check(..., True), arguing legitimate
        # refreezing cannot be distinguished from damage. That answers a different
        # question: this axis detects change since freezing, which is measurable.
        # An assertion that can never fail is the tautology guarded since review 12.
        expect = ref_lines(
            split_frontmatter(_read_text(fp))[1] if fn == "SKILL.md" else _read_text(fp)
        )
        same = expect == frozen
        # Use the self-check prefix: this is environmental, not a content axis.
        # label_prefix previously counted it in non-Git live_ran, but deletion
        # copies return above and omit it. One missing check per file falsely
        # triggered survival and skipped every floor in distributions (C-9).
        # SELF_CHECK_PREFIXES excludes it from both counts; ENV_DEPENDENT also
        # removes it from total-count comparisons.
        check(
            f"자기검사: {fn} 동결본이 현재 문서에서 나왔다 (git 밖)",
            same,
            "payload differs from the document; outside Git, commit comparison is unavailable, but "
            "derivation from this document is still checked",
        )
        return frozen, same

    declared = header.split(":", 1)[1].strip()
    committed = _committed_blob(fp)
    if committed is None and _in_git_repo(fp):
        check(
            f"자기검사: {fn} 이 커밋돼 있다",
            False,
            "untracked reference; commit it and freeze with FREEZE_REFS=1",
        )
        return frozen, False

    # Header-only comparison leaves the actual reference payload outside all hashes.
    frozen_committed = _committed_blob(frozen_path)
    if frozen_committed is not None:
        same = _worktree_blob(frozen_path) == frozen_committed
        # Use failure prose only on failure. Repeating failure text on green
        # lines desensitizes human reviewers to it (reviews 7-8).
        check(
            f"자기검사: {fn} 동결본이 커밋된 그대로다",
            same,
            ""
            if same
            else ".lines differs from its commit; commit reference updates to retain a reviewable diff",
        )
        if not same:
            return frozen, False
    elif _in_git_repo(frozen_path):
        check(
            f"자기검사: {fn} 동결본이 커밋돼 있다",
            False,
            "untracked frozen reference; commit it before using it as evidence",
        )
        return frozen, False

    # Verify payload derivation from the declared blob. A HEAD-matching header
    # and committed .lines did not prove payload fidelity. Freezing a damaged
    # working document, inserting the original blob header, and committing only
    # .lines passed audit 54/54 and commands 150/150 (review 2). Retrieve the
    # actual declared blob and compare it with the reference payload.
    src = subprocess.run(
        ["git", "cat-file", "blob", declared],
        capture_output=True,
        text=True,
        cwd=os.path.dirname(os.path.abspath(fp)),
    )
    if src.returncode == 0:
        _fm, sbody = split_frontmatter(src.stdout)
        expect = ref_lines(sbody if fn == "SKILL.md" else src.stdout)
        same_payload = expect == frozen
        # Emit neutral measurements in details. Failure prose printed even on
        # PASS desensitized reviewers (review 7). check prints details regardless
        # of verdict, and check_floor_parity reads measurements from this output;
        # replace prose with measured values rather than suppressing output.
        check(
            f"자기검사: {fn} 동결본 내용이 헤더의 blob 과 일치한다",
            same_payload,
            f"선언 blob {declared[:12]} / 정답지 {len(frozen)}줄",
        )
        if not same_payload:
            return frozen, False
    elif _in_git_repo(fp):
        # Missing blobs in shallow/garbage-collected repositories must fail.
        # Silently skipping retrieval leaves that file unbound (review 4).
        check(
            f"자기검사: {fn} 헤더가 가리키는 blob 을 꺼낼 수 있다",
            False,
            f"git cat-file 실패 — {declared[:12]} 를 이 저장소에서 찾을 수 없다",
        )
        return frozen, False

    if committed is not None:
        ok = declared == committed
        # Avoid mismatch prose when both hashes are equal; details that appear
        # to contradict a PASS verdict mislead readers.
        check(
            f"자기검사: {fn} 동결본이 커밋된 문서에서 나왔다",
            ok,
            ""
            if ok
            else f"동결본은 {declared[:12]} 를 가리키는데 HEAD 는 {committed[:12]} "
            "; after document edits, commit and refreeze with FREEZE_REFS=1",
        )
        if not ok:
            return frozen, False
    if not frozen:
        check(f"{label_prefix}: {fn} 동결본이 비어 있지 않다", False, "0줄")
        return frozen, False
    return frozen, True


def _ref_axes(
    check, skill_root, fn, fp, body, needles, floor, freeze_dir, label_prefix
):
    """Apply needle, volume, and line-survival axes shared with check_ref_contracts."""
    missing = [n for n in needles if n not in body]
    check(
        f"{label_prefix}: {fn} 의 needle 이 살아 있다", not missing, f"누락 {missing}"
    )

    got = content_bytes(body, needles)
    check(f"{label_prefix}: {fn} 부피 (>= {floor}B)", got >= floor, f"{got}B")

    freeze_root = os.path.join(skill_root, freeze_dir)
    frozen_path = os.path.join(freeze_root, fn + ".lines")
    live = ref_lines(body)
    if os.environ.get("FREEZE_REFS"):
        os.makedirs(freeze_root, exist_ok=True)
        payload = "\n".join(live)
        with open(frozen_path, "w", encoding="utf-8") as f:
            f.write(f"# blob:{_worktree_blob(fp) or 'UNTRACKED'}\n" + payload)
        check(
            f"{label_prefix}: {fn} 동결본을 새로 썼다 (FREEZE_REFS)",
            False,
            f"{len(live)}줄 — 갱신을 커밋으로 남기고 재실행하라",
        )
        return
    if not os.path.exists(frozen_path):
        check(
            f"{label_prefix}: {fn} 줄 생존율",
            False,
            f"동결본 부재 ({freeze_dir}/{fn}.lines) — FREEZE_REFS=1 로 동결하라",
        )
        return
    with open(frozen_path, encoding="utf-8") as f:
        raw = f.read().splitlines()
    frozen, ok = _freeze_guard(check, fn, fp, frozen_path, raw, label_prefix)
    if not ok:
        return
    # Outside Git this axis is tautological: successful current-document
    # binding already means live == frozen, hence 100% survival. Adversarial tdd
    # SH-1/SH-3 replaced three documents with word salad and passed. Without an
    # independent committed blob this is unmeasurable, not a pass. ENV_DEPENDENT
    # keeps totals comparable across environments.
    # Deletion copies are different: _freeze_guard deliberately skips binding,
    # so their empty files differ from payloads and survival measures real loss.
    # In workspace, enabling it added exactly one failure per deleted file (0%);
    # unchanged files remain at 100%, without extra false positives.
    if not _in_git_repo(fp) and not in_deleted_run():
        return
    rate = survival_rate(live, frozen)
    check(
        # Use the self-check prefix to exclude this environmental axis from
        # both counts. Ordinary non-Git runs omit it; a content prefix would
        # unbalance live/copy counts and falsely trigger survival.
        f"자기검사: {fn} 줄 생존율 (>= {SURVIVAL_FLOOR:.0%}, 순서 포함)",
        rate >= SURVIVAL_FLOOR,
        f"{rate:.0%} ({int(rate * len(frozen))}/{len(frozen)}줄)",
    )


def check_ref_contracts(
    check,
    skill_root,
    contracts,
    *,
    label_prefix="참조 계약",
    freeze_dir="tests/refs",
    subdir="references",
    population=None,
):
    """Measure reference contracts along three complementary axes.

    Needle checks detect lost values but miss a shell retaining only needles.
    Content bytes detect deletion but miss equal-volume substitution.
    Line survival detects substitution; legitimate substantial edits require
    updating frozen references too.

    Why survival was added: after review 8 introduced volume, review 9 filled
    floors with distinct dummy lines q000000, q000001, etc. All nine hwpx
    references contained zero real content but passed 55/55. Deduplication only
    raised padding cost; 395 lines still met a 3,900-byte floor. Volume measures
    absolute deletion, while substitution requires comparison with original
    content. Freeze original lines and measure their survival.

    Frozen-reference rules match hwpx gold:
    - Absence fails; automatically regenerating and passing would allow rm laundering.
    - Only FREEZE_REFS=1 updates references; that run also fails to require a commit.
    - Legitimate paragraph/typo edits within the survival floor pass.
    """
    freeze_root = os.path.join(skill_root, freeze_dir)
    freezing = bool(os.environ.get("FREEZE_REFS"))

    # Compare handwritten contracts with actual files. Four references (two
    # humanize, two workspace) silently escaped all axes; coverage completeness
    # checks only per_file and could not see this separate list.
    # subdir also covers command/agent bodies. Their former 400-character-only
    # checks allowed wholesale filler replacements (branch.md/sag-followup).
    refs_dir = os.path.join(skill_root, subdir)
    if os.path.isdir(refs_dir):
        declared = {c[0] for c in contracts}
        actual = {n for n in os.listdir(refs_dir) if n.endswith(".md")}
        if population is not None:
            actual &= {f"{name}.md" if not str(name).endswith(".md") else str(name)
                       for name in population}
        gap = sorted(actual - declared)
        check(
            f"{label_prefix}: 계약 목록이 {subdir}/ 전부를 덮는다",
            not gap,
            f"계약 밖 {gap}",
        )

    for fn, desc, needles, floor in contracts:
        fp = os.path.join(skill_root, subdir, fn)
        if not os.path.exists(fp):
            check(f"{label_prefix}: {fn} 실재", False, "파일 없음")
            continue
        with open(fp, encoding="utf-8") as f:
            body = f.read()

        # Axis 1: required content.
        missing = [n for n in needles if n not in body]
        check(f"{label_prefix}: {fn} — {desc}", not missing, f"누락 {missing}")

        # Axis 2: retained volume.
        got = content_bytes(body, needles)
        check(f"{label_prefix}: {fn} 부피 (>= {floor}B)", got >= floor, f"{got}B")

        # Axis 3: retained original sequence.
        live = ref_lines(body)
        frozen_path = os.path.join(freeze_root, fn + ".lines")
        if freezing:
            os.makedirs(freeze_root, exist_ok=True)
            # Preserve source order; sorting turns the dump into forgery material.
            # Record a source hash and bind it to committed evidence outside the
            # mutable tree. Source SHA-256 and reference self-checksums alone
            # proved nothing: a forger could recompute either using the published
            # code. A reference editable without independent evidence is no key.
            # HEAD blobs do not change with working-tree edits; legitimate updates
            # must be committed, leaving a reviewable diff.
            payload = "\n".join(live)
            with open(frozen_path, "w", encoding="utf-8") as f:
                # Hash the actual working content. Writing the old committed
                # hash over a damaged payload would launder the mutation and
                # make header comparison meaningless.
                f.write(f"# blob:{_worktree_blob(fp) or 'UNTRACKED'}\n" + payload)
            check(
                f"{label_prefix}: {fn} 동결본을 새로 썼다 (FREEZE_REFS)",
                False,
                f"{len(live)}줄 — 갱신을 커밋으로 남기고 재실행하라",
            )
            continue
        if not os.path.exists(frozen_path):
            check(
                f"{label_prefix}: {fn} 줄 생존율",
                False,
                f"동결본 부재 ({freeze_dir}/{fn}.lines) — "
                "for an intentional update, rerun with FREEZE_REFS=1",
            )
            continue
        with open(frozen_path, encoding="utf-8") as f:
            raw = f.read().splitlines()
        # Share binding instead of duplicating it inline. Patching only
        # _freeze_guard once left 38 references/commands/agents/langs files
        # unprotected (review 3: rubric.md 55/55; branch.md 152/152). Retaining
        # duplicate implementations would recreate the divergence.
        frozen, ok = _freeze_guard(check, fn, fp, frozen_path, raw, label_prefix)
        if not ok:
            continue
        # Outside Git, successful binding already implies 100% survival
        # (_ref_axes rationale; recall A-1 measured this on word salad).
        # Use continue, never return: the latter dropped every subsequent
        # reference outside Git. cleanup lost nine checks (126 vs 135), and all
        # 18 skills with multiple references suffered false survival alarms and
        # skipped every per-file floor. Skip one axis, not the remaining loop.
        # Deletion copies remain an exception as explained in _ref_axes.
        if not _in_git_repo(fp) and not in_deleted_run():
            continue
        rate = survival_rate(live, frozen)
        check(
            # Match _ref_axes: the self-check prefix excludes this
            # environment-dependent axis from both live and copy counts.
            f"자기검사: {fn} 줄 생존율 (>= {SURVIVAL_FLOOR:.0%}, 순서 포함)",
            rate >= SURVIVAL_FLOOR,
            f"{rate:.0%} ({int(rate * len(frozen))}/{len(frozen)}줄)",
        )


def check_total(check, results, expected):
    """Pin the total number of verdicts emitted by this suite.

    live_ran compares copies with live execution within one run, not removal
    from source. Deleting a reference plus contracts, floors, and frozen data
    reduced 65 to 61 with no failure (review 10). A declared total makes this
    removal a mismatch. Legitimate additions/removals must change the count,
    leaving a visible review diff. expected is measured and includes this check.
    """
    # Omit in deletion copies: skipped coverage/body self-checks always alter
    # totals there. Counting that one failure would give every file a free
    # failure, allowing 24 floor-one references with zero contracts to pass
    # despite the zero-floor prohibition (review 11).
    if in_deleted_run():
        return
    # This is the only point with all emitted names after deletion regressions.
    # Write reachability only when JSTACK_REACH_OUT is set; otherwise do nothing.
    reach_dump([r[0] for r in results])
    # Exclude environment-dependent checks. Blob binding runs only inside Git;
    # running copied suites outside Git is legitimate, including for reviewers.
    # Counting it would detect execution location rather than disappeared contracts.
    ENV_DEPENDENT = (
        "동결본이 커밋된 문서에서 나왔다",
        "이 커밋돼 있다",
        "동결본이 커밋된 그대로다",
        "헤더의 blob 과 일치한다",
        "가리키는 blob 을 꺼낼 수 있다",
        # Non-Git replacement binding is environmental too. Omitting it here
        # would inflate distribution totals by the number of contract files.
        "동결본이 현재 문서에서 나왔다 (git 밖)",
        # Ordinary non-Git runs omit tautological survival. Exclude it here
        # for comparable totals; in-Git runs still measure the real axis.
        "줄 생존율",
    )
    counted = [r for r in results if not any(m in r[0] for m in ENV_DEPENDENT)]
    # Add skipped names back: their measurement moved to the control, rather
    # than disappearing. Otherwise totals merely detect skip mode. A mismatch
    # between recorded names and actual call sites still changes the total.
    got = len(counted) + 1 + len(_SKIPPED_NAMES)
    # This is a diff marker, not independent measurement. Removing checks and
    # updating the count passes; the purpose is a reviewable trace of the change.
    # It cannot automatically prevent contract removal, only make it visible.
    check(
        f"자기검사: 검사 총수가 {expected} 건이다",
        got == expected,
        f"{got}건"
        + (f" (삭제 회귀 생략 {len(_SKIPPED_NAMES)}건 포함)" if _SKIPPED_NAMES else "")
        + " ; update this count when adding or removing contracts",
    )


def _script_floor_unmeasured(check, rel, floor, why):
    """Emit an explicit verdict for an unmeasured script floor.

    Like _floor_unmeasured, retain every name. A bare continue on early exit
    hides nonexecution from both reviewers and check_total (class A).
    """
    check(f"스크립트 계약: {rel}", False, f"측정 불가 (하한 {floor}) — {why}")


def check_script_contracts(
    check, suite_file, skill_root, *, runner=None, scripts, live_ran=None,
    extra_skip=()
):
    """Measure whether script contracts actually depend on their scripts.

    Document deletion checks SKILL.md/references, not script behavior such as
    ensure_*.sh exit codes. Those checks legitimately survive document deletion;
    free variables evade const_true and unchanged counts evade check_total.
    Review 12 replaced all three ensure status contracts with tautologies and
    still passed 44/44, silently losing a mechanism required by the plan.

    Run the suite with the script emptied. This applies the document-deletion
    principle to scripts: checks that execute and inspect the script must fail
    when it breaks.
    """
    if in_deleted_run():
        return
    for rel, floor in sorted(scripts.items()):
        # fails >= 0 always passes, even after deleting the whole script.
        # A zero probe.sh floor allowed all three status checks to become
        # tautologies while passing 72/72 (review 3). Apply the same positive-floor
        # guard already used by check_contract_coverage.
        if floor < 1:
            check(
                f"스크립트 계약: {rel} 하한이 1 이상이다",
                False,
                f"하한 {floor} — 계약 없는 스크립트를 선언했다",
            )
            continue
        res = body_deletion_regression(
            suite_file, skill_root, only=rel, runner=runner, extra_skip=extra_skip
        )
        if res is None:
            continue
        if res is _DELETION_SKIPPED:
            _skip_named(f"스크립트 계약: {rel}")
            continue
        if (
            res["rc"] not in (0, 1)
            or res["crashed"]
        ):
            check(
                f"스크립트 계약: {rel} 비운 사본이 완주한다",
                False,
                res["stderr"].strip().splitlines()[-1][:80] if res["stderr"] else "",
            )
            _script_floor_unmeasured(check, rel, floor, "copy did not complete")
            continue
        # Survival guard: unlike coverage, this axis formerly checked only
        # failures. proof measured 62 -> 60 verdicts after emptying instrumentation
        # without a failure here. Disappearance cannot be seen in failure counts.
        if live_ran is None:
            check(
                f"스크립트 계약: {rel} 소멸 가드가 걸려 있다",
                False,
                "live_ran is missing; the declared axis is effectively disabled",
            )
            _script_floor_unmeasured(check, rel, floor, "survival guard not configured")
            continue
        if res["ran"] < live_ran:
            check(
                f"스크립트 계약: {rel} 비워도 검사가 소멸하지 않는다",
                False,
                f"사본 {res['ran']}건 / 실제 {live_ran}건",
            )
            _script_floor_unmeasured(
                check, rel, floor, f"소멸 가드가 걸렸다 (사본 {res['ran']}/{live_ran})"
            )
            continue
        check(
            f"스크립트 계약: {rel}",
            res["fails"] >= floor,
            f"{res['fails']}건 실패 (하한 {floor})",
        )
