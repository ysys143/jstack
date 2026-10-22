#!/usr/bin/env python3
"""emoji regression suite.

Run: python3 tests/run_tests.py (from skills/emoji)

This skill **owns the rule**; the hook enforces it. Two forms of drift have
already occurred, and this suite locks both:

  (1) **A copied range table.** The old SKILL.md copied the entire pattern,
      creating three copies: two hooks and this skill. The parity checker saw
      only the two hooks, leaving the skill copy unguarded. Copying the table
      again must make this suite fail.
  (2) **Lost rationale for overblocking.** Blocking technical symbols in
      U+2300-23FF is a deliberate tradeoff. Without its rationale, the next
      maintainer may mistake it for a bug and narrow the range.

The documented import path must also work. Nonworking sample code misleads the
reader and encourages another private copy.

## Why this suite also measures the enforcer

An earlier version locked only those two axes. Adversarial validation then
changed the hook's main() to return immediately, yet this suite stayed as green
as its baseline. Declaring ownership without testing the enforcer left a gap:
importing and calling contains_emoji does not establish that the hook is alive.
The function can survive while main() does nothing.

The following five axes therefore feed stub stdin JSON to the actual hook
process and inspect its return code and decision:

  * **Live hook behavior:** all five tool payloads produce rc 0 and decision
    block. A no-op main(), removal of the Bash branch, removal of the
    MultiEdit/NotebookEdit branches, and a reduced _WRITE_SHAPES mapping each
    fail distinct checks.
  * **Blocked ranges:** extract all 18 range entries from the hook's compiled
    pattern and compare them with this file's table to detect removal or
    narrowing. Exercise a representative code point from every range. The ten
    astral ranges also receive another check through the hook process.
  * **Fail-open contract:** non-JSON stdin, null, and an array must each return
    rc 0 without blocking. Replacing except: pass with raise fails here first.
    The existing tests/test_hooks.py fixture {"garbage": True} is valid JSON;
    it returns early with tool_name="" and never reaches the exception handler.
  * **Matcher coverage:** compare hooks.json declarations with code branches.
  * **CONTRACT parity:** compare exit and pass contracts, fail-open behavior,
    matchers, per-tool branch tables, RED anchors, and verification commands
    with actual measurements. Reversing a declaration must fail.

Ownership differs from tests/test_hooks.py: that suite measures registration
and chain order at the hook layer; this suite measures whether the enforcer
actually implements the rule this skill claims to own.
"""

import importlib.util
import json
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
    check_body_deletion,
    check_contract_coverage,
    check_no_constant_assertions,
    check_skill_body,
    check_total,
    split_frontmatter,
)

ROOT = os.path.dirname(HERE)
PLUGIN = os.path.dirname(os.path.dirname(ROOT))
SOURCE_HOOKS_DIR = os.path.join(PLUGIN, "hosts", "claude", "hooks")
BUILT_HOOKS_DIR = os.path.join(PLUGIN, "hooks")
HOOKS_DIR = SOURCE_HOOKS_DIR if os.path.isdir(SOURCE_HOOKS_DIR) else BUILT_HOOKS_DIR
HOOK = os.path.join(HOOKS_DIR, "block_emoji.py")
HOOKS_JSON = os.path.join(HOOKS_DIR, "hooks.json")
CONTRACT = os.path.join(HOOKS_DIR, "CONTRACT.md")

#: One emoji used in payloads. Avoid an emoji literal: this repository bans emoji,
#: and embedding a forbidden character in its checker would be self-defeating.
MARK = chr(0x2705)  # WHITE HEAVY CHECK MARK

#: Stub payloads by tool. The keys are the code-branch inventory and are compared
#: with the hooks.json matcher below.
STUB = {
    "Write": {"content": f"# 완료 {MARK}"},
    "Edit": {"new_string": f"# 완료 {MARK}"},
    "MultiEdit": {"edits": [{"new_string": "ok"}, {"new_string": f"# 완료 {MARK}"}]},
    "NotebookEdit": {"new_source": f"x = 1  # {MARK}"},
    "Bash": {"command": f'echo "{MARK}" > /tmp/emoji-suite-probe.txt'},
}

#: Commands that isolate each `_WRITE_SHAPES` entry. If redirect syntax appears
#: inside a heredoc example, deleting the heredoc entry still passes via redirect,
#: so heredoc, sed -i, and tee examples contain no `>`.
WRITE_SHAPES = {
    "Redirect (> and >>)": (
        f'echo "{MARK}" > /tmp/a.py',
        f'echo "{MARK}" >> /tmp/a.py',
    ),
    "heredoc": (
        f'python3 - <<EOF\nprint("{MARK}")\nEOF',
        f"python3 - <<'EOF'\nprint('{MARK}')\nEOF",
    ),
    "In-place edit (sed -i)": (f'sed -i "" "s/x/{MARK}/" /tmp/a.py',),
    "Branch write (tee)": (f'echo "{MARK}" | tee /tmp/a.py',),
}

#: False-positive guard. Deleting `_NOT_A_WRITE` makes this fail.
READ_ONLY = (
    f'grep "{MARK}" /tmp/a.py',
    f'grep "{MARK}" /tmp/a.py 2>/dev/null',
    f'echo "{MARK}" | wc -c',
    f'echo "{MARK}" > /dev/null',
    f'python3 x.py "{MARK}" 2>&1',
)

#: The 18 hook `EMOJI_PATTERN` entries in order. Comparing this table with the
#: compiled pattern catches a deleted line or narrowed band.
BANDS = (
    (0x1F600, 0x1F64F, "Emoticons"),
    (0x1F300, 0x1F5FF, "Misc Symbols and Pictographs"),
    (0x1F680, 0x1F6FF, "Transport and Map"),
    (0x1F700, 0x1F77F, "Alchemical"),
    (0x1F780, 0x1F7FF, "Geometric Shapes Extended"),
    (0x1F800, 0x1F8FF, "Supplemental Arrows-C"),
    (0x1F900, 0x1F9FF, "Supplemental Symbols and Pictographs"),
    (0x1FA00, 0x1FA6F, "Chess"),
    (0x1FA70, 0x1FAFF, "Symbols and Pictographs Extended-A"),
    (0x1F926, 0x1F937, "Face gestures"),
    (0x2600, 0x26FF, "Misc Symbols"),
    (0x2700, 0x27BF, "Dingbats"),
    (0x2300, 0x23FF, "Misc Technical"),
    (0x2B50, 0x2B50, "Star"),
    (0x3030, 0x3030, "Wavy dash"),
    (0x303D, 0x303D, "Part alternation mark"),
    (0x3297, 0x3297, "Circled congratulation"),
    (0x3299, 0x3299, "Circled secret"),
)

#: Three fail-open paths that actually reach the exception handler. Valid JSON
#: without tool keys returns early and measures nothing.
FAIL_OPEN = (
    ("not JSON", "not json{"),  # json.JSONDecodeError -> silent
    ("null", "null"),  # None.get -> AttributeError -> stderr
    ("array", "[]"),  # list.get -> AttributeError -> stderr
)

results = []


def check(label, ok, detail=""):
    results.append((label, bool(ok), detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {label}" + (f" — {detail}" if detail else ""))


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def load_hook():
    spec = importlib.util.spec_from_file_location("block_emoji", HOOK)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def run_hook(payload=None, *, raw=None):
    """Run the hook as a process with stdin JSON.

    Return `(rc, decision, stdout, stderr)`. Importing a helper is a separate axis:
    `main()` may be dead while functions remain, so only this path proves the
    executor is live.
    """
    text = raw if raw is not None else json.dumps(payload)
    proc = subprocess.run(
        [sys.executable, HOOK], input=text, capture_output=True, text=True, timeout=120
    )
    out = proc.stdout.strip()
    verdict = None
    if out:
        try:
            verdict = json.loads(out).get("decision")
        except json.JSONDecodeError:
            verdict = "<non-JSON output>"
    return proc.returncode, verdict, proc.stdout, proc.stderr


def declared_bands(pattern_src):
    """Recover the `(start, end)` list from the compiled pattern string.

    Read **`re.Pattern.pattern`**, not hook source text. This ignores cleanup that
    merely moves ranges or removes comments and reacts only when matches change.
    """
    body = pattern_src[pattern_src.index("[") + 1 : pattern_src.rindex("]")]
    chars, out, i = list(body), [], 0
    while i < len(chars):
        if i + 2 < len(chars) and chars[i + 1] == "-":
            out.append((ord(chars[i]), ord(chars[i + 2])))
            i += 3
        else:
            out.append((ord(chars[i]), ord(chars[i])))
            i += 1
    return out


def contract_block(text, heading):
    """Read the ```contract block under `## <heading>` as `key -> value`."""
    if f"\n## {heading}\n" not in text:
        return {}
    seg = text.split(f"\n## {heading}\n", 1)[1]
    if "```contract" not in seg:
        return {}
    body = seg.split("```contract", 1)[1].split("```", 1)[0]
    out = {}
    for line in body.splitlines():
        if ":" in line and not line.startswith((" ", "\t")):
            key, value = line.split(":", 1)
            if key.strip():
                out[key.strip()] = value.strip()
    return out


def main():
    skill = read(os.path.join(ROOT, "SKILL.md"))
    fm, _ = split_frontmatter(skill)

    # ---------------------------------------------------------- identity
    check("Identity: the rename is reflected", "name: emoji" in fm,
          "remove-emoji describes cleanup only; this skill also owns the rules")
    check("Language: description has Korean triggers",
          len(re.findall(r"[가-힣]+", fm)) >= 5)
    check("Language: description has English triggers",
          "remove emoji" in fm.lower() or "strip emoji" in fm.lower())

    # ------------------------------------------------- no copies (core)
    ranges = re.findall(r"U0001F[0-9A-Fa-f]{3}-|u2300-|u26FF|u27BF", skill)
    check("No copies: the body does not duplicate the range table", not ranges,
          f"{len(ranges)} range literals; import the hook's EMOJI_PATTERN")
    check("No copies: explains why duplication is forbidden",
          "third copy" in skill and "parity" in skill.lower())
    check("No copies: provides the import path",
          "importlib" in skill and "block_emoji.py" in skill)

    # --------------------------------------- documented code actually works
    module = load_hook()
    check("Contract: hook exposes EMOJI_PATTERN at module level",
          hasattr(module, "EMOJI_PATTERN"),
          "if confined to a function, the skill must create its own copy")
    check("Contract: hook exposes contains_emoji",
          callable(getattr(module, "contains_emoji", None)))
    check("Contract: SKILL.md uses the two documented names",
          "EMOJI_PATTERN" in skill and "contains_emoji" in skill)

    sample = f"done {chr(0x2705)} and {chr(0x26A0)} remaining"
    check("Behavior: detection finds emoji",
          len(module.contains_emoji(sample)) == 2,
          str(module.contains_emoji(sample)))
    check("Behavior: removal strips only emoji",
          module.EMOJI_PATTERN.sub("", sample).replace("  ", " ").strip()
          == "done and remaining")
    check("Behavior: Korean text is not targeted",
          module.contains_emoji("한글만 있는 문장 ㄱㄴㄷ 가나다") == [])

    # ------------------------------------------ live hook behavior (stub payloads)
    # Imported helpers stay green when `main()` dies; this axis observes the executor.
    fired = {
        tool: run_hook({"tool_name": tool, "tool_input": payload})
        for tool, payload in STUB.items()
    }
    for tool in sorted(STUB):
        rc, verdict, _stdout, _stderr = fired[tool]
        check(f"Hook runtime: {tool} payload returns rc 0 and decision block",
              (rc, verdict) == (0, "block"),
              f"rc={rc} decision={verdict}")

    pass_rc, pass_verdict, pass_out, _ = run_hook(
        {"tool_name": "Write", "tool_input": {"content": "# Complete [OK] -> Next step"}}
    )
    check("Hook runtime: emoji-free writes return rc 0 with no output",
          (pass_rc, pass_verdict, pass_out) == (0, None, ""),
          f"rc={pass_rc} decision={pass_verdict} stdout={pass_out!r}")

    # --------------------------------- Bash write shapes (each _WRITE_SHAPES entry)
    for shape in sorted(WRITE_SHAPES):
        leaks = [
            command
            for command in WRITE_SHAPES[shape]
            if run_hook({"tool_name": "Bash", "tool_input": {"command": command}})[1]
            != "block"
        ]
        check(f"Write shape: {shape} does not let emoji through", not leaks,
              f"commands that passed {leaks}")

    overblocked = [
        command
        for command in READ_ONLY
        if run_hook({"tool_name": "Bash", "tool_input": {"command": command}})[1]
        == "block"
    ]
    check("Write shape: read-only commands are not blocked", not overblocked,
          f"false positives {overblocked}")

    # --------------------------------------------------------- blocked ranges
    live_bands = declared_bands(module.EMOJI_PATTERN.pattern)
    want_bands = [(lo, hi) for lo, hi, _ in BANDS]
    check("Ranges: hook range table matches this table (detects deletion and narrowing)",
          live_bands == want_bands,
          f"hook {len(live_bands)} / table {len(want_bands)} — "
          f"hook only {[b for b in live_bands if b not in want_bands]} "
          f"table only {[b for b in want_bands if b not in live_bands]}")

    for lo, hi, label in BANDS:
        probes = sorted({lo, (lo + hi) // 2, hi})
        missed = [f"U+{cp:04X}" for cp in probes if not module.contains_emoji(chr(cp))]
        check(f"Ranges: representative code points in U+{lo:04X}-{hi:04X} ({label}) are detected",
              not missed, f"missed {missed}")

    # **A fully swallowed band can be deleted without failing any probe.** Pin the one
    # known case so new overlap is visible; exact table parity catches its deletion.
    swallowed = [
        f"U+{lo:04X}-{hi:04X}"
        for i, (lo, hi, _) in enumerate(BANDS)
        if any(j != i and l2 <= lo and hi <= h2 for j, (l2, h2, _) in enumerate(BANDS))
    ]
    check("Ranges: only one declared band is fully swallowed by another",
          swallowed == ["U+1F926-1F937"], f"swallowed bands {swallowed}")

    astral_leak = [
        f"U+{lo:04X}"
        for lo, _hi, _label in BANDS
        if lo > 0xFFFF
        and run_hook({"tool_name": "Write", "tool_input": {"content": f"x {chr(lo)}"}})[
            1
        ]
        != "block"
    ]
    check("Ranges: astral representatives are blocked through the hook process", not astral_leak,
          f"bands that passed {astral_leak}")

    # -------------------------------------------------------- fail-open contract
    fell_open = {label: run_hook(raw=raw) for label, raw in FAIL_OPEN}
    for label, _raw in FAIL_OPEN:
        rc, verdict, _stdout, stderr = fell_open[label]
        check(f"fail-open: {label} stdin returns rc 0 without blocking",
              (rc, verdict) == (0, None),
              f"rc={rc} decision={verdict} stderr={stderr.strip()[:70]}")

    silent = fell_open["not JSON"][3].strip()
    noisy = fell_open["null"][3]
    check("fail-open: JSONDecodeError is silent; other exceptions report to stderr",
          silent == "" and "Hook error" in noisy,
          f"json={silent[:40]!r} other={noisy.strip()[:40]!r}")

    # ---------------------------------------------------------- matcher scope
    registry = json.loads(read(HOOKS_JSON)).get("hooks", {}).get("PreToolUse", [])
    matcher_tools = set()
    commands = []
    for entry in registry:
        if "block_emoji.py" not in json.dumps(entry):
            continue
        matcher_tools |= set(entry.get("matcher", "").split("|"))
        commands += [
            hook.get("command", "")
            for hook in entry.get("hooks", [])
            if "block_emoji.py" in hook.get("command", "")
        ]
    check("Matcher: hooks.json declaration exactly matches the five code branches",
          matcher_tools == set(STUB),
          f"declared {sorted(matcher_tools)} / branches {sorted(STUB)}")
    check("Matcher: registered command points to exactly one existing hook file",
          len(commands) == 1
          and commands[0].split("}/", 1)[-1].rstrip("\"'") == "hooks/block_emoji.py"
          and os.path.isfile(HOOK),
          f"registered {commands}")

    # -------------------------------------------- CONTRACT declaration versus runtime
    contract = read(CONTRACT)
    decl = contract_block(contract, "block_emoji.py")
    check("Contract parity: CONTRACT matcher declaration matches hooks.json",
          bool(decl) and set(decl.get("matcher", "").split("|")) == matcher_tools,
          f"CONTRACT {decl.get('matcher')!r} / hooks.json {sorted(matcher_tools)}")

    blk_rc, blk_verdict, _blk_out, _ = fired["Write"]
    exit_decl = decl.get("exit contract", "")
    check("Contract parity: exit declaration matches the observed blocking path",
          ("exit 0" in exit_decl) == (blk_rc == 0)
          and ("block" in exit_decl) == (blk_verdict == "block"),
          f"declared {exit_decl!r} / observed rc={blk_rc} decision={blk_verdict}")

    pass_decl = decl.get("pass contract", "")
    check("Contract parity: pass declaration matches the observed pass path",
          ("exit 0" in pass_decl) == (pass_rc == 0)
          and ("no stdout" in pass_decl) == (pass_out == ""),
          f"declared {pass_decl!r} / observed rc={pass_rc} stdout={pass_out!r}")

    open_decl = decl.get("fail-open", "")
    all_open = all(r[0] == 0 and r[1] is None for r in fell_open.values())
    check("Contract parity: fail-open declaration matches all three observed paths",
          open_decl.startswith("yes") == all_open,
          f"declared {open_decl[:24]!r} / observed all_pass={all_open}")

    rows = re.findall(
        r"(?m)^\|\s*`(\w+)`\s*\|\s*.+?\s*\|\s*(Present|Absent)\s*\|\s*$", contract
    )
    branch_decl = {tool: state == "Present" for tool, state in rows}
    branch_live = {tool: fired[tool][1] == "block" for tool in STUB}
    check("Contract parity: per-tool branch table matches observed blocking",
          branch_decl == branch_live,
          f"declared {branch_decl} / observed {branch_live}")

    hook_tests = os.path.join(PLUGIN, "tests", "test_work_hooks.py")
    hook_tests_src = read(hook_tests) if os.path.isfile(hook_tests) else ""
    anchors = re.findall(r"\btest_\w+", decl.get("RED", ""))
    check("Contract parity: RED anchors point to existing tests",
          bool(anchors) and all(f"def {n}(" in hook_tests_src for n in anchors),
          f"anchors {anchors} / test file {os.path.isfile(hook_tests)}")

    verify_decl = decl.get("verify", "")
    verify_hit = re.search(r"([\w./-]+\.py)", verify_decl)
    verify_rel = verify_hit.group(1).split("jstack/", 1)[-1] if verify_hit else ""
    check("Contract parity: verification command points to an existing file",
          bool(verify_rel) and os.path.isfile(os.path.join(PLUGIN, verify_rel)),
          f"declared {verify_decl!r}")

    # ------------------------------------------- overblocking is a decision, not a bug
    check("Tradeoff: names concrete overblocked targets",
          "U+2300-23FF" in skill and chr(0x2318) in skill)
    over = module.contains_emoji(f"{chr(0x2318)} {chr(0x2325)} {chr(0x23CE)}")
    check("Tradeoff: documented overblocking occurs in practice", len(over) >= 1,
          f"{over} — document and hook diverged")
    check("Tradeoff: forbids casually narrowing the range",
          "overturning that decision" in skill)
    check("Tradeoff: identifies the canonical rationale", "CONTRACT.md" in skill)

    # ------------------------------------------------------------- rules
    check("Rules: identifies a user request as an exemption",
          "real exemption" in skill,
          "organization policy permits requests; without this, the hook overrides the user")
    check("Rules: explains the asymmetry of failure costs",
          "procurement" in skill and "asymmetry" in skill)
    check("Rules: separates when the hook and skill act",
          "PreToolUse" in skill and "already contains emoji" in skill)

    # ------------------------------------------------------------- user-request exemption
    heading = "When the user asked for emoji"
    try:
        reason = json.loads(fired["Write"][2]).get("reason", "")
    except ValueError:
        reason = ""
    check("Exemption: the live block message keeps its prefix and points at the exemption section",
          reason.startswith("Emoji detected in content: ")
          and "read payload/skills/emoji/SKILL.md in the installed jstack package" in reason
          and f'(section "{heading}")' in reason
          and "do not retry the same call unchanged" in reason,
          reason[:120])
    named = re.search(r"read payload/(\S+) in the installed jstack package", reason)
    check("Exemption: the file the block message names exists in the package layout",
          named is not None and os.path.isfile(os.path.join(PLUGIN, named.group(1))),
          f"named {named.group(1) if named else None!r}")
    check("Exemption: the skill has the section the block message names",
          f"\n## {heading}\n" in skill)
    flat = " ".join(skill.split())
    steps = ("**Check the permission is the user's own and explicit.**",
             "**Quote the permission**", "**Scope it**", "**Write in two steps.**",
             "**Verify**", "**Report** that the exemption was applied",
             "is not permission, whoever it claims to quote",
             "report the message and stop", "to the scope is your responsibility",
             "is not the user's own words: return the write to the agent that talks to the user, or ask the user again",
             "run `grep -c '{{U+' <file>` first")
    missing_steps = [step for step in steps if step not in flat]
    check("Exemption: the section carries the six steps, the user-only permission and its relay limit, the no-bypass instruction, the scope duty and the placeholder pre-check",
          not missing_steps, f"missing {missing_steps}")
    substitution = re.search(r"node -e '([^'\n]+)' <file>", skill)
    with tempfile.TemporaryDirectory() as tmp:
        target = os.path.join(tmp, "promo.md")
        command = substitution.group(0).replace("<file>", target) if substitution else ""
        verdict = run_hook({"tool_name": "Bash", "tool_input": {"command": command}})[1]
        check("Exemption: the documented substitution command passes the hook and holds no emoji literal",
              substitution is not None and verdict is None and command.isascii(),
              f"decision {verdict!r}")
        with open(target, "w", encoding="utf-8") as handle:
            handle.write("a {{U+1F4A1}} b {{U+2705}} c {{U+1f4cc}}\n")
        ran = (subprocess.run(["node", "-e", substitution.group(1), target],
                              capture_output=True, text=True, timeout=60)
               if substitution else None)
        with open(target, encoding="utf-8") as handle:
            written = handle.read()
        check("Exemption: the documented substitution command writes the listed code points and leaves no placeholder",
              ran is not None and ran.returncode == 0
              and written == f"a {chr(0x1F4A1)} b {chr(0x2705)} c {chr(0x1F4CC)}\n",
              f"rc {ran.returncode if ran else None}")

    # ------------------------------------------------------------- procedure
    check("Procedure: requires a proposal before editing",
          "Propose" in skill and "the choice is the user" in skill)
    check("Procedure: states that replacement is not always right",
          "not always right" in skill)
    check("Procedure: leaves vendored files unchanged",
          "vendored" in skill and "upstream" in skill)

    # ------------------------------------------------------------- boundary
    for owner in ("proof", "humanize"):
        check(f"Boundary: says to hand off to {owner}", f"`{owner}`" in skill)

    check_no_constant_assertions(check, __file__)
    # **Needles are full sentences.** A short phrase such as `real exemption` survives
    # negation as `is not a real exemption`; subject and predicate make insertion of
    # a negation break the needle. This once passed after 96% became lorem ipsum.
    check_skill_body(check, ROOT, needles=[
        "`block_emoji.py` stops emoji at write time",
        "The user asking is a real exemption",
        "The cost of a leak is not symmetric",
        "Do not copy the ranges into this file",
        "a third copy is a third thing to forget",
        "Narrowing the range means overturning that decision",
        "Korean is never matched",
        "Removal and replacement are",
        "Replacement is not always right",
        "Emoji inside vendored third-party files are not ours to edit",
    ], floor=3154)
    check_body_deletion(check, __file__, ROOT, minimum=26)
    check_contract_coverage(check, __file__, ROOT, per_file={
        "SKILL.md": 26,
    }, live_ran=True, completeness=True)
    check_total(check, results, 89)

    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n{passed}/{len(results)} 통과")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
