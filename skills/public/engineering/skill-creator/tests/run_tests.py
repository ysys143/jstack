#!/usr/bin/env python3
"""author contract suite.

Run: python3 tests/run_tests.py   (from skills/author)

## What this locks

1. **The description is the only always-on cost** — every layering rule in this
   skill follows from that one fact. If it thins out, the rules read as taste.
2. **Floors are measured** — a floor with slack is exactly the amount of body
   that can be deleted with the suite still green. This plugin learned that the
   expensive way.
3. **No router skills** — the plugin's stated purpose is that installing it is
   enough; a skill that points elsewhere silently reverses that.
4. **A named neighbour must exist** — the boundary sentence is the only part of
   the description that is machine-checkable, so it has to be checked.
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

results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))


def read(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


def rows(text, head):
    """Return data rows beneath `## head`, or an empty list when absent."""
    if head not in text:
        return []
    body = text.split(head, 1)[1].split("\n## ", 1)[0]
    return [r for r in re.findall(r"(?m)^\| (?!---)(.+?) \|", body)
            if r.strip() not in ("Layer", "Build a", "Misuse")]


def trow(text, *cells):
    """Return whether `cells` occur **in one table row, in this order**.

    Row counts cannot detect swapped columns or rotated rows. Both preserve byte
    volume, and swapped tables retain every needle. Lock which value belongs in
    which cell of which row.
    """
    for line in text.splitlines():
        s = line.strip()
        if not s.startswith("|"):
            continue
        i = 0
        for col in s.strip("|").split("|"):
            if i < len(cells) and cells[i] in col:
                i += 1
        if i == len(cells):
            return True
    return False


def seq(text, *marks):
    """Return whether `marks` appear in the body **in this order**.

    Set membership accepts reversed order, but order is substantive in procedures.
    """
    at = -1
    for m in marks:
        i = text.find(m, at + 1)
        if i < 0:
            return False
        at = i
    return True


def numbered_heads(text):
    """Return numbered level-two headings in document order.

    The former Korean guides exposed numbered tables of contents, so this helper
    compared each TOC with the actual headings in both directions: changing only
    either side had to fail. The English guides no longer carry those TOCs, but
    they still teach progressive disclosure through their own structure.
    Binding each number to its heading preserves that executable example and
    rejects deleted, reordered, or retitled sections.
    """
    return re.findall(r"(?m)^## (\d+)\. (.+?)\s*$", text)


def main():
    fm, skill = split_frontmatter(read(os.path.join(ROOT, "SKILL.md")))
    layers = read(os.path.join(ROOT, "references", "layers.md"))
    native_path = os.path.join(ROOT, "SKILL.codex.md")
    native = read(native_path) if os.path.isfile(native_path) else ""
    check("native: common judgment and native call semantics have separate owners",
          "canonical SKILL.md" in native and "native tools actually exposed" in native)
    check("native: checks use actual artifacts and keep host enforcement explicit",
          "actual artifact" in native and "does not claim" in native
          and "equivalent tool interception" in native)
    check("placement: one canonical SKILL.md owns shared judgment",
          "shared judgment and content in the owning `SKILL.md`" in skill
          and "must not copy shared" in skill)
    check("placement: host overrides are limited to invocation-semantic differences",
          all(x in skill for x in ("invocation", "tool arguments", "permission handling", "lifecycle"))
          and "only when those semantics" in skill)
    check("placement: imports and references are portable within the package",
          "references\nand imports inside this package" in skill
          and "outside the source checkout" in skill)
    check("native: does not mistake Claude command paths for Codex tool names",
          all(x in native for x in ("/jstack:test-plugin", "/jstack:validate", "/jstack:doctor author"))
          and "not names for Codex tools" in native)

    # (1) The only always-on cost.
    check("cost: states that only name and description are always loaded",
          "every turn of every session" in skill)
    check("cost: states that the cost is paid even when the skill does not fire",
          "whether or not the skill ever fires" in skill)
    check("cost: states that everything else loads on demand", "loaded on demand" in skill)
    lay = rows(skill, "## One cost, four layers")
    check("cost: four-layer table has four rows", len(lay) == 4, f"{len(lay)} rows")
    for tag, why in (("L0", "description"), ("L1", "SKILL.md"),
                     ("L2", "references"), ("L3", "scripts")):
        check(f"cost: {tag} ({why}) row exists", tag in skill)
    check("cost: states that layer rules follow from the cost",
          "follows from the cost" in skill)
    check("cost: gives a one-sentence criterion for description content",
          "not needed to decide\nwhether to fire" in skill
          or "not needed to decide whether to fire" in skill)

    # (2) Layer sizing and misuse costs.
    size = rows(layers, "## Sizing")
    check("layers: sizing table has four rows", len(size) == 4, f"{len(size)} rows")
    mis = rows(layers, "## What each misuse costs")
    check("layers: misuse-cost table has four rows", len(mis) == 4, f"{len(mis)} rows")
    check("layers: states that two common misuses push in opposite directions",
          "push in opposite directions" in layers)
    check("layers: gives the decision question in one sentence",
          "which side of the decision the text is on" in layers)
    check("layers: gives the criterion for script content",
          "does not depend on the situation" in layers)
    check("layers: explains that prose produces a different answer each time",
          "slightly different answer each time" in layers)
    check("layers: states that a script encoding judgment reverses the boundary",
          "is encoding judgement" in layers)
    check("layers: states that reference files are read whole",
          "read from the\ntop" in layers or "read from the top" in layers)
    check("layers: states that combining two topics makes half the file noise",
          "half of it is always noise" in layers)
    check("layers: requires names based on decisions rather than format",
          "not after its format" in layers)

    # (3) Distinguish skills, commands, and agents.
    kinds = rows(skill, "## Skill, command, or agent")
    check("type: three-kind decision table has three rows", len(kinds) == 3, f"{len(kinds)} rows")
    check("type: agent criterion is a separate context", "its own context window" in skill)
    check("type: a skill that only runs one script is classified as a command",
          "should be a command" in skill)
    check("type: an agent without a separate context is classified as a skill",
          "should be a skill" in skill)

    # (4) The description's two jobs.
    check("description: requires both firing and non-firing conditions",
          "when to fire" in skill and "when not to" in skill)
    check("description: explains that missing boundaries lead to proximity selection",
          "picks by\nproximity" in skill or "picks by proximity" in skill)
    check("description: states that such selection is not an intentional decision",
          "not a decision anybody made" in skill)
    check("description: requires triggers in both languages", "in both languages" in skill)
    check("description: states that one language misses expressions in the other",
          "reverse is equally true" in skill)
    check("description: requires naming neighboring skills explicitly",
          "Name the neighbour explicitly" in skill)
    check("description: states that this makes the boundary machine-checkable",
          "makes the boundary checkable" in skill)
    check("description: naming a nonexistent neighbor fails the contract",
          "does not exist fails the contract" in skill)

    # (5) Ship the suite; floors are measured.
    check("suite: a skill without a contract suite is prose",
          "with no contract suite is prose" in skill)
    check("suite: requires testing claims rather than wording",
          "against the claims, not the wording" in skill)
    check("suite: requires testing each rule's rationale",
          "its **reason** is stated" in skill)
    check("suite: explains that rules without reasons are deleted next",
          "gets deleted next" in skill)
    check("floor: requires measurement rather than selection",
          "**Floors are measured, not chosen.**" in skill)
    check("floor: gives the measurement procedure", "reading the measured value" in skill)
    check("floor: states that slack equals deletable body content",
          "amount of the body that can be deleted" in skill)

    # (6) Prohibited forms.
    nots = re.findall(r"(?m)^- \*\*(.+?)\*\*", skill)
    check("prohibition: at least three prohibited forms are listed", len(nots) >= 3, f"{len(nots)} items")
    check("prohibition: router skills are forbidden", "routes to another skill" in skill)
    check("prohibition: explains that users installed this plugin, not a skill map",
          "not a\nmap of skills they do not have" in skill
          or "map of skills they do not have" in skill)
    check("prohibition: requires absorbing and placing material properly", "place it properly" in skill)
    check("prohibition: forbids reimplementing a maintained CLI", "reimplements a maintained CLI" in skill)
    check("prohibition: forbids descriptions that merely describe a domain",
          "describes the domain" in skill)
    check("prohibition: explains that such descriptions fire on everything and therefore nothing",
          "and therefore on nothing" in skill)

    # (7) Boundaries and languages.
    named = set(re.findall(r"`([a-z][a-z-]{2,})`\s*skill", skill))
    missing = [n for n in named if not os.path.isdir(os.path.join(SKILLS, n))]
    check("boundary: named-neighbor population is nonempty", len(named) >= 3, f"{sorted(named)}")
    check("boundary: every named neighbor exists", not missing, f"missing {missing}")
    check("language: description contains Korean triggers",
          len(re.findall(r"[가-힣]+", fm)) >= 5)
    check("language: description also contains English triggers", "skill" in fm and "command" in fm)
    check("language: description exposes its own always-on cost",
          "always-on cost" in fm)

    # (8) Script layer: measure **behavior**, not documentation. Prose needles
    # stay green when a script is emptied, so execute it and inspect exit codes and output.
    def sh(rel, *args, stdin=""):
        return subprocess.run(["bash", os.path.join(ROOT, rel), *args],
                              input=stdin, capture_output=True, text=True,
                              cwd=ROOT)

    # 8-1 validate_plugin.sh: the fixture suite is the validator's contract. Every
    # negative fixture must fail and the positive fixture must pass. An empty script
    # fails here. One fixture run takes 15 seconds, and rerunning it for every copied
    # deletion candidate takes over eight minutes. Cache by the validator, fixture,
    # and runner **content** hashes. An emptied validate_plugin.sh has a different hash
    # and runs again; bypassing the cache would require identical bytes to behave differently.
    import hashlib
    import json
    fx_dir = os.path.join(ROOT, "scripts", "tests")
    h = hashlib.sha256()
    for dp, dn, fn in sorted(os.walk(fx_dir)):
        dn[:] = sorted(d for d in dn if d != "__pycache__")
        for n in sorted(fn):
            fp = os.path.join(dp, n)
            h.update(os.path.relpath(fp, fx_dir).encode())
            with open(fp, "rb") as f:
                h.update(f.read())
    with open(os.path.join(ROOT, "scripts", "validate_plugin.sh"), "rb") as f:
        h.update(f.read())
    # **A cache is not a temporary file.** An earlier version used `gettempdir()`,
    # leaving one file per run in the system temporary directory where the runner's
    # leak check correctly counted it. It also stopped working once each suite got
    # an empty `TMPDIR`. Store it where caches belong: persistent across runs, outside
    # the leak population, and removable by the user.
    _croot = os.path.join(
        os.environ.get("XDG_CACHE_HOME") or os.path.expanduser("~/.cache"),
        "jstack-plugins", "author-fixtures")
    try:
        os.makedirs(_croot, exist_ok=True)
    except OSError:
        # If the home cache is unavailable, fall back to a temporary directory.
        # This is slower but preserves the verdict; caching is only an optimization.
        _croot = tempfile.gettempdir()
    cache = os.path.join(_croot, f"author-fixtures-{h.hexdigest()[:16]}.json")
    fx_res = None
    if os.path.isfile(cache):
        try:
            with open(cache, encoding="utf-8") as f:
                fx_res = json.load(f)
        except (OSError, ValueError):
            fx_res = None
    if fx_res is None:
        fx = subprocess.run([sys.executable, os.path.join(fx_dir, "run_fixtures.py")],
                            capture_output=True, text=True, cwd=ROOT)
        fx_res = {"rc": fx.returncode, "stdout": fx.stdout, "stderr": fx.stderr}
        with open(cache, "w", encoding="utf-8") as f:
            json.dump(fx_res, f)
    fx_hit = re.search(r"(?m)^(\d+)/(\d+) passed", fx_res["stdout"])
    fx_pass, fx_total = (int(fx_hit.group(1)), int(fx_hit.group(2))) if fx_hit else (0, 0)
    check("script: validate_plugin.sh fixture suite completes", fx_res["rc"] == 0,
          (fx_res["stderr"].strip().splitlines() or ["(no stderr)"])[-1][:80])
    check("script: all fixtures pass (positive passes, negatives fail, mutations detected)",
          fx_pass == fx_total and fx_total >= 31, f"{fx_pass}/{fx_total}")
    for label, rc in (("--help", 0), ("missing path", 2)):
        r = sh("scripts/validate_plugin.sh", label if label == "--help"
               else os.path.join(tempfile.gettempdir(), "author-suite-missing-plugin"))
        check(f"script: validate_plugin.sh {label} exits with {rc}",
              r.returncode == rc, f"rc={r.returncode}")

    # 8-2 The remaining five scripts: argument contracts (`${1:?}` guards) and
    # environment overrides. Hard-coded `~/.claude/plugins` paths caused the legacy issue.
    guarded = ("scripts/list_plugins.sh", "scripts/register_local.sh",
               "scripts/scaffold_plugin.sh")
    for rel in guarded:
        body = read(os.path.join(ROOT, rel))
        check(f"script: {rel} uses strict mode", "set -euo pipefail" in body)
        check(f"script: {rel} has no hard-coded home path",
              "/Users/" not in body and "~/.claude/plugins" not in body)
    for rel in guarded:
        args = ("/nonexistent-marketplace-root",) if rel.endswith("list_plugins.sh") else ()
        r = sh(rel, *args)
        check(f"script: {rel} exits nonzero without arguments or with a missing path",
              r.returncode != 0, f"rc={r.returncode}")
    for rel in ("scripts/list_plugins.sh",):
        check(f"script: {rel} allows JSTACK_MARKETPLACE_DIR to override the marketplace path",
              "JSTACK_MARKETPLACE_DIR" in read(os.path.join(ROOT, rel)))
    with tempfile.TemporaryDirectory() as td:
        bad = sh("scripts/scaffold_plugin.sh", os.path.join(td, "x"), "Bad_Name")
        check("script: scaffold rejects a non-kebab-case name (rc 2)",
              bad.returncode == 2, f"rc={bad.returncode}")
        good = sh("scripts/scaffold_plugin.sh", os.path.join(td, "p"), "probe-plugin")
        manifest = os.path.join(td, "p", ".claude-plugin", "plugin.json")
        check("script: scaffold creates plugin.json",
              good.returncode == 0 and os.path.isfile(manifest), f"rc={good.returncode}")
        check("script: scaffold writes the name into the manifest",
              os.path.isfile(manifest) and '"probe-plugin"' in read(manifest))
        before = read(manifest) if os.path.isfile(manifest) else ""
        if os.path.isfile(manifest):
            with open(manifest, "a", encoding="utf-8") as f:
                f.write("\n")   # Marker: a second run must not erase this modification.
        again = sh("scripts/scaffold_plugin.sh", os.path.join(td, "p"), "probe-plugin-2")
        check("script: scaffold does not overwrite an existing plugin",
              os.path.isfile(manifest) and read(manifest) == before + "\n"
              and '"probe-plugin-2"' not in read(manifest), f"rc={again.returncode}")

    # 8-3 Hook templates: hooks.json must use the real schema, and scripts must not
    # read configuration from it because the real schema has no config field.
    import json as _json
    tpl = "references/templates"
    for name, event, cmd in (("formatting-hook-template", "PostToolUse", "format.sh"),
                             ("notification-hook-template", "PostToolUse", "notify.sh"),
                             ("validation-hook-template", "PreToolUse", "validate_template.py")):
        hj = os.path.join(ROOT, tpl, name, "hooks.json")
        try:
            data = _json.loads(read(hj))
        except (OSError, ValueError):
            data = {}
        ev = (data.get("hooks") or {}).get(event) or []
        check(f"template: {name}/hooks.json declares {event} with the real schema",
              bool(ev) and all("matcher" in e and e.get("hooks") for e in ev))
        cmds = [h.get("command", "") for e in ev for h in (e.get("hooks") or [])]
        check(f"template: {name}/hooks.json invokes {cmd} relative to CLAUDE_PLUGIN_ROOT",
              any("${CLAUDE_PLUGIN_ROOT}" in c and cmd in c for c in cmds), f"{cmds}")
        check(f"template: {name}/hooks.json has no nonexistent name/config fields",
              bool(ev) and not any(("name" in e or "config" in e) for e in ev))
    for rel, env_needle in ((f"{tpl}/formatting-hook-template/format.sh", "HOOK_INDENT"),
                            (f"{tpl}/notification-hook-template/notify.sh", "HOOK_RATE_LIMIT_MAX_PER_HOUR"),
                            (f"{tpl}/validation-hook-template/validate_template.py", "HOOK_SEVERITY")):
        body = read(os.path.join(ROOT, rel))
        check(f"template: {rel} reads configuration from environment variable {env_needle}", env_needle in body)
        check(f"template: {rel} does not read the fake hooks.json config schema",
              "select(.name" not in body and ".hooks[]" not in body and len(body) > 0)
        check(f"template: {rel} reads the hook payload (tool_input) from stdin", "tool_input" in body)
        if rel.endswith(".py"):
            r = subprocess.run([sys.executable, "-c",
                                "import ast, pathlib, sys; ast.parse(pathlib.Path(sys.argv[1]).read_text())",
                                os.path.join(ROOT, rel)], capture_output=True, text=True)
        else:
            r = subprocess.run(["bash", "-n", os.path.join(ROOT, rel)], capture_output=True, text=True)
        check(f"template: {rel} passes syntax validation", r.returncode == 0, r.stderr.strip()[-80:])
    with tempfile.TemporaryDirectory() as td:
        jp = os.path.join(td, "x.json")
        with open(jp, "w", encoding="utf-8") as f:
            f.write('{"a":{"b":1}}')
        env = dict(os.environ, HOOK_INDENT="4")
        r = subprocess.run(["bash", os.path.join(ROOT, tpl, "formatting-hook-template", "format.sh"), "x.json"],
                           cwd=td, env=env, capture_output=True, text=True)
        out = read(jp) if os.path.isfile(jp) else ""
        check("template: format.sh applies four-space indentation with HOOK_INDENT=4",
              r.returncode == 0 and '\n    "a"' in out, f"rc={r.returncode}")

    # 8-4 Package surface: exercise both the declaration and its checker. Prose
    # needles would accept a declaration with one catch-all glob. Verify the live
    # tree, a planted unclassified file, and rejection of a pattern covering everything.
    surf = os.path.join(ROOT, "references", "package-surface.yaml")
    checker = os.path.join(ROOT, "scripts", "check_package_surface.py")
    PLUGIN = os.path.dirname(SKILLS)

    def surface(*args):
        return subprocess.run([sys.executable, checker, *args],
                              capture_output=True, text=True, cwd=ROOT)

    live = surface("--root", PLUGIN, "--surface", surf)
    check("surface: live tree matches the declaration (rc 0)", live.returncode == 0,
          (live.stderr.strip().splitlines() or [f"rc={live.returncode}"])[-1][:120])
    check("surface: success report gives zero unclassified files and a category count",
          "0 unclassified" in live.stdout and "categories" in live.stdout,
          (live.stdout.strip().splitlines() or ["(no output)"])[0][:80])

    surf_text = read(surf)
    check("surface: declaration fails closed on unclassified files",
          "unclassified: fail" in surf_text)
    check("surface: declaration defines a catch-all coverage threshold",
          "max_share_per_pattern" in surf_text)
    for cat in ("skill-doc", "reference", "script", "test", "hook",
                "command", "agent", "manifest", "frozen"):
        check(f"surface: {cat} category is declared", f"\n  {cat}:" in surf_text)

    with tempfile.TemporaryDirectory() as td:
        fx = os.path.join(td, "plug")
        for rel in ("commands/a.md", "agents/b.md", "skills/s/SKILL.md"):
            os.makedirs(os.path.join(fx, os.path.dirname(rel)), exist_ok=True)
            with open(os.path.join(fx, rel), "w", encoding="utf-8") as f:
                f.write("픽스처\n")
        fx_surface = os.path.join(td, "surface.yaml")
        with open(fx_surface, "w", encoding="utf-8") as f:
            f.write('policy:\n  unclassified: fail\n  max_share_per_pattern: 0.5\n'
                    'categories:\n  command:\n    - "commands/*.md"\n'
                    '  agent:\n    - "agents/*.md"\n'
                    '  skill-doc:\n    - "skills/*/SKILL.md"\n')
        clean = surface("--root", fx, "--surface", fx_surface)
        check("surface: fully classified fixture returns rc 0",
              clean.returncode == 0, f"rc={clean.returncode}")
        with open(os.path.join(fx, "stray.txt"), "w", encoding="utf-8") as f:
            f.write("어느 범주에도 없는 파일\n")
        planted = surface("--root", fx, "--surface", fx_surface)
        check("surface: one planted unclassified file returns rc 1",
              planted.returncode == 1, f"rc={planted.returncode}")
        check("surface: reports the unclassified file path", "stray.txt" in planted.stderr)
        hog_surface = os.path.join(td, "hog.yaml")
        with open(hog_surface, "w", encoding="utf-8") as f:
            f.write('policy:\n  unclassified: fail\n  max_share_per_pattern: 0.5\n'
                    'categories:\n  everything:\n    - "**"\n')
        hog = surface("--root", fx, "--surface", hog_surface)
        check("surface: a pattern covering everything returns rc 1",
              hog.returncode == 1, f"rc={hog.returncode}")
        check("surface: reports the catch-all pattern's share", "100%" in hog.stderr)

    # (9) Reference **content** beyond the three shared axes.
    #
    # `check_ref_contracts` checks one needle, absolute volume, and frozen-line
    # survival. None measures the semantic relationships:
    #   - Unique filler on every line can satisfy volume. An adversarial team test
    #     replaced a 10,789-byte document with 30,489 bytes of unique filler and
    #     matched the baseline at the character level.
    #   - Frozen-line survival does not run outside Git.
    #   - Swapping columns or rotating rows preserves bytes and every loose needle.
    # Twenty-three of 26 references therefore had only those three minimum checks,
    # despite totaling 161,437 bytes: files and volume existed, but no verdict
    # measured what they said.
    #
    # Lock at least one defining property per document through row/value bindings,
    # ordered numbered steps, sentence needles, bidirectional tree checks, or closed sets.
    ref = lambda *p: read(os.path.join(ROOT, "references", *p))
    ag_md, cmd_md, hk_md, sk_md = (ref("agent.md"), ref("command.md"),
                                   ref("hook.md"), ref("skill.md"))
    swg, stg = ref("skill-writing-guide.md"), ref("skill-testing-guide.md")
    cdec, plc, bpr = (ref("component-decision.md"), ref("placement.md"),
                      ref("browser-priority.md"))
    dgov = ref("deprecated-governance.md")
    og = lambda n: ref("organizational-guides", n)
    aarch, bcoh, carch = og("agent-architecture.md"), og("bundle-coherence-guide.md"), og("command-architecture.md")
    harch, ogov, pdp = og("hook-architecture.md"), og("organizational-governance.md"), og("plugin-design-patterns.md")
    tpl_dir = os.path.join(ROOT, "references", "templates")
    tp = lambda n: read(os.path.join(tpl_dir, n))

    # 9-1 layers.md: bind each size and misuse cost to the correct layer.
    check("reference content: layers binds the Description row to its oversize symptom",
          trow(layers, "Description", "One or two sentences plus triggers",
               "It explains how to do the work"))
    check("reference content: layers binds the script row to its oversize symptom",
          trow(layers, "A script", "One deterministic job",
               "It asks the caller to make a choice"))
    check("reference content: layers binds procedures in descriptions to always-on cost",
          trow(layers, "Procedure in the description",
               "Paid on every turn of every session"))
    check("reference content: layers binds determinism in prose to repeated derivation",
          trow(layers, "Determinism left in prose", "re-derives it each time"))

    # 9-2 command.md: lock the eight-phase order and template/tree parity.
    check("reference content: command procedure preserves Phase 1 through 8 order",
          seq(cmd_md, "### Phase 1: Context Detection", "### Phase 2: Command Discovery",
              "### Phase 3: Configuration", "### Phase 4: Template Selection",
              "### Phase 5: Generation", "### Phase 6: Integration",
              "### Phase 7: Validation", "### Phase 8: Completion"))
    cmd_tpl = set(re.findall(r"([\w-]+)-command-template\.md", cmd_md))
    cmd_disk = {n[: -len("-command-template.md")] for n in os.listdir(tpl_dir)
                if n.endswith("-command-template.md")}
    check("reference content: command's referenced command templates exactly match the tree",
          cmd_tpl == cmd_disk and bool(cmd_disk),
          f"document {sorted(cmd_tpl)} vs tree {sorted(cmd_disk)}")

    # 9-3 agent.md: bind each role to its input, output, and model, then check templates.
    check("reference content: agent role table binds Analyzer to input, output, and model",
          trow(ag_md, "Analyzer", "Complex data", "Assessment/insights",
               "Sonnet/Opus", "Debugging, code review"))
    check("reference content: agent role table binds Validator to input, output, and model",
          trow(ag_md, "Validator", "Data + rules", "Pass/fail + reasons",
               "Haiku/Sonnet", "Quality checks"))
    ag_tpl = set(re.findall(r"`([\w-]+-agent-template\.md)`", ag_md))
    ag_disk = {n for n in os.listdir(tpl_dir) if n.endswith("-agent-template.md")}
    check("reference content: agent's referenced templates exactly match the tree",
          ag_tpl == ag_disk and bool(ag_disk),
          f"document {sorted(ag_tpl)} vs tree {sorted(ag_disk)}")

    # 9-4 hook.md: bind hook types to triggers and preserve procedure order.
    for kind, trig, why in (("Validation", "PreToolUse", "Block invalid tool calls"),
                            ("Formatting", "PostToolUse", "Transform tool output"),
                            ("Augmentation", "PreToolUse", "Modify tool parameters")):
        check(f"reference content: hook table binds {kind} to {trig}",
              trow(hk_md, kind, trig, why))
    check("reference content: hook procedure preserves Phase 1 through 5 order",
          seq(hk_md, "### Phase 1: Context Detection", "### Phase 2: Hook Discovery",
              "### Phase 3: Hook Configuration", "### Phase 4: Template Selection",
              "### Phase 5: Hook Generation"))
    # Bidirectional document/tree parity: changing either side alone fails.
    wired = re.findall(
        r"(?m)^\| \w+ \| `([\w-]+)/hooks\.json` \| `([\w-]+)/([\w.]+)` \|$", hk_md)
    hk_disk = {n for n in os.listdir(tpl_dir) if n.endswith("-hook-template")
               and os.path.isdir(os.path.join(tpl_dir, n))}
    check("reference content: hook wiring table covers every hook template directory",
          {d for d, _, _ in wired} == hk_disk and bool(hk_disk),
          f"document {sorted(d for d, _, _ in wired)} vs tree {sorted(hk_disk)}")
    bad_wire = []
    for d1, d2, impl in wired:
        hj = os.path.join(tpl_dir, d1, "hooks.json")
        try:
            cmds = [h.get("command", "") for ev in (_json.loads(read(hj)).get("hooks") or {}).values()
                    for e in ev for h in (e.get("hooks") or [])]
        except (OSError, ValueError, AttributeError):
            cmds = []
        if d1 != d2 or not os.path.isfile(os.path.join(tpl_dir, d1, impl)) \
                or not any(impl in c for c in cmds):
            bad_wire.append(f"{d1}/{impl}")
    check("reference content: hook wiring implementations exist and hooks.json invokes them",
          bool(wired) and not bad_wire, f"mismatch {bad_wire}" if bad_wire else f"{len(wired)} rows")

    # 9-5 skill.md: preserve the Step 0-7 order and scope matrix bindings.
    check("reference content: skill procedure preserves Step 0 through 7 order",
          seq(sk_md, "## Step 0: Determine Scope", "## Step 1: Define the Skill",
              "## Step 2: Inspect Existing Components", "## Step 3: Choose Placement",
              "## Step 4: Write `SKILL.md`", "## Step 5: Select Organization Delivery",
              "## Step 6: Deliver", "## Step 7: Report Completion"))
    check("reference content: skill scope table binds locations to Project and Organization",
          trow(sk_md, "Location", "{project}/.claude/skills/", "A plugin marketplace"))
    check("reference content: skill scope table binds reach to Project and Organization",
          trow(sk_md, "Reach", "Current project only", "All projects for installed users")
          and "Recommended: **{1 or 2}**, because {reason}" in sk_md
          and all(p in sk_md for p in ("02-planning-and-design.md", "03-skill-structure.md",
                                       "04-writing-instructions.md", "07-patterns.md")))

    # 9-6 The two guides: lock their numbered section sequences and core contracts.
    check("reference content: skill-writing-guide has numbered sections 1 through 9",
          [n for n, _ in numbered_heads(swg)] == [str(n) for n in range(1, 10)])
    check("reference content: skill-testing-guide has numbered sections 1 through 8",
          [n for n, _ in numbered_heads(stg)] == [str(n) for n in range(1, 9)])
    check("reference content: skill-writing-guide gives routing rules in order",
          seq(swg, "State both what the skill does", "Include a boundary for similar requests",
              "avoid pressuring the model to invoke it")
          and "ALWAYS use pdfplumber" in swg
          and "When tracked changes are required" in swg
          and "All three of three tests create the same helper script" in swg
          and "2095991462416490862" in swg)
    check("reference content: skill-testing-guide binds qualitative and quantitative evaluations",
          trow(stg, "Qualitative", "A user reviews the deliverable", "Style, design")
          and trow(stg, "Quantitative", "Automated assertion scoring", "File creation"))
    check("reference content: skill-testing-guide gives the five-step iteration loop in order",
          seq(stg, "1. Revise the skill.", "2. Rerun every test",
              "3. Show the results", "4. Collect feedback.", "5. Revise and repeat.")
          and "2-3 prompts" in stg and "100% of the time" in stg
          and "20 queries into 60% training" in stg and "40% held-out test sets" in stg)

    # 9-7 component-decision.md: bind each component to its unique ability.
    check("reference content: component-decision binds hooks to blocking execution",
          trow(cdec, "Hook", "Harness invokes on an event", "Can block execution", "Runs on every matching event"))
    check("reference content: component-decision binds agents to a separate context",
          trow(cdec, "Agent", "Delegator invokes it", "Separate context window", "highest unit cost"))
    check("reference content: component-decision gives its two decision axes in order",
          seq(cdec, "1. **When is it invoked?**", "2. **What is the cost of a violation?**")
          and "accumulated 19 layer-0 components" in cdec
          and "9 agent types accounted for about 74%" in cdec)

    # 9-8 placement.md: bind each host-contract row to Claude and Codex values.
    for item, claude, codex in (("User skills", "~/.claude/skills/", "~/.codex/skills/"),
                                ("Instruction file", "CLAUDE.md", "AGENTS.md"),
                                ("Settings", "settings.json", "config.toml")):
        check(f"reference content: placement binds {item} to Claude and Codex values",
              trow(plc, item, claude, codex))
    check("reference content: placement binds shared and host-specific distribution",
          trow(plc, "Shared", "external CLIs, files, or APIs", "Every compatible host directory")
          and trow(plc, "Host-specific", "host tools, configuration, or subagents", "Owning host only")
          and trow(plc, "`Task(` or `subagent_type`", "Claude subagent invocation")
          and trow(plc, "`agents/openai.yaml` or `$skill-name`", "Codex conventions")
          and trow(plc, "Enable/disable", "4-state `skillOverrides`"))
    check("reference content: placement gives all three distribution invariants",
          seq(plc, "Count host-specific real directories", "Require 0 broken links",
              "Require 0 duplicate names"))

    # 9-9 browser-priority.md: lock the closed tool set and each condition/tool binding.
    check("reference content: browser-priority binds the default to agent-browser",
          trow(bpr, "Default", "agent-browser"))
    check("reference content: browser-priority binds authenticated sessions to claude-in-chrome",
          trow(bpr, "Existing authenticated browser session or cookies are required", "claude-in-chrome"))
    check("reference content: browser-priority binds profiling to chrome-devtools",
          trow(bpr, "Performance profiling, Lighthouse, or heap snapshots", "chrome-devtools"))
    bp_tools = {x.lower() for x in re.findall(
        r"(agent-browser|claude-in-chrome|chrome-devtools|playwright)", bpr, re.IGNORECASE)}
    check("reference content: browser-priority covers exactly four tools",
          bp_tools == {"agent-browser", "claude-in-chrome", "chrome-devtools", "playwright"}
          and "additional 23 tool schemas" in bpr
          and "스크린샷|스크랩|폼 채우|E2E|브라우저|크롤|scrape|screenshot" in bpr
          and all(x in bpr for x in ("returned 7 lines", "5 were false positives",
                                     "remaining 2", "measured count was 0")),
          f"{sorted(bp_tools)}")

    # 9-10 deprecated-governance.md: lock all seven retired items to their row numbers.
    dep_body = dgov.split("## Seven Retired Artifacts", 1)[-1]
    dep_rows = re.findall(r"(?m)^\| (\d+) \|", dep_body)
    dep = re.findall(r"(?m)^\| (\d+) \| `([^`]+)`", dep_body)
    check("reference content: deprecated-governance preserves seven numbered retired artifacts",
          dep_rows == [str(n) for n in range(1, 8)]
          and dep == [("1", "plugin-generator/references/anthropic-skills-guide/"),
                      ("2", "generate.md"), ("3", "design.md"),
                      ("4", "from-codebase.md"), ("5", "from-docs.md"),
                      ("6", "from-session.md"), ("7", "sync-guide.md")],
          f"rows {dep_rows}, named {dep}")
    check("reference content: deprecated-governance states the archive boundaries",
          seq(dgov, "gitignored and never shipped", "Nothing inside it is canonical",
              "retirement lifecycle")
          and "decision list, not that archive" in dgov
          and "gitignored and never shipped" in dgov
          and "processed material moves to `completed/`" in dgov
          and "0 invocations" in dgov
          and "nonexistent `toolMatcherRegex` field" in dgov)

    # 9-11 agent-architecture.md: bind model tiers to speed, cost, and use case.
    check("reference content: agent-architecture binds haiku to fastest, lowest cost, and simple extraction",
          trow(aarch, "`haiku`", "Fastest", "Lowest", "Simple extraction"))
    check("reference content: agent-architecture binds opus to slowest, highest cost, and complex reasoning",
          trow(aarch, "`opus`", "Slowest", "Highest", "Complex reasoning"))
    check("reference content: agent-architecture binds model to an optional frontmatter field",
          trow(aarch, "`model`", "No", "Model tier (haiku/sonnet/opus)", "`sonnet` (default)"))

    # 9-12 bundle-coherence-guide.md: preserve the ordered principles, reasons, and antipatterns.
    check("reference content: bundle-coherence gives five cohesion principles in order",
          seq(bcoh, "### 1. Single Responsibility Principle", "### 2. Shared Domain",
              "### 3. Interaction Benefit", "### 4. Maintenance Unity",
              "### 5. User Mental Model"))
    check("reference content: bundle-coherence gives five separation reasons in order",
          seq(bcoh, "### Reason 1: Different Update Cycles",
              "### Reason 2: Rarely Used Components", "### Reason 3: Different Owners",
              "### Reason 4: Unrelated Domains", "### Reason 5: Security Boundaries"))
    check("reference content: bundle-coherence gives five antipatterns in order",
          seq(bcoh, "### 1. Kitchen Sink Plugin", "### 2. Premature Bundling",
              "### 3. Forced Separation", "### 4. Cross-Concern Mixing",
              "### 5. Micro-Plugins"))

    # 9-13 command-architecture.md: lock the command hierarchy and validation table.
    check("reference content: command-architecture gives four command tiers in order",
          seq(carch, "### 1. Wizard Commands (Interactive)",
              "### 2. Generator Commands (Templated)",
              "### 3. Orchestrator Commands (Coordination)",
              "### 4. Utility Commands (Direct)"))
    check("reference content: command-architecture binds Input validation to immediate failure",
          trow(carch, "Input", "Syntax, required fields", "Immediately"))
    check("reference content: command-architecture binds Coherence validation to after execution",
          trow(carch, "Coherence", "Plugin bundle consistency", "After execution"))

    # 9-14 hook-architecture.md: bind exit codes and schema fields to their semantics.
    check("reference content: hook-architecture binds exit code 0 to allowing execution",
          trow(harch, "`0`", "Success", "PreToolUse: Allow tool execution"))
    check("reference content: hook-architecture binds nonzero exit codes to blocking execution",
          trow(harch, "`1-255`", "Failure", "PreToolUse: **BLOCK** tool execution"))
    check("reference content: hook-architecture binds matcher to a tool-name regex",
          trow(harch, "`matcher`", "Hook group", "Yes", "Regex matched against the tool name"))
    check("reference content: hook-architecture binds git commits to Bash plus content inspection",
          trow(harch, "Git commits only", "`Bash`", "git commit"))

    # 9-15 organizational-governance.md: bind naming rules to their examples.
    for kind, conv, ex in (("Commands", "{verb}-{noun}.md", "add-skill.md"),
                           ("Scripts", "{verb}_{noun}.sh", "validate_plugin.sh"),
                           ("Templates", "{type}-template/", "validation-hook-template/")):
        check(f"reference content: organizational-governance binds {kind} naming rule to its example",
              trow(ogov, kind, conv, ex))

    # 9-16 plugin-design-patterns.md: preserve the six patterns and their component mixes.
    check("reference content: plugin-design-patterns gives six patterns in order",
          seq(pdp, "## 1. Configuration Pattern", "## 2. Integration Pattern",
              "## 3. Analysis Pattern", "## 4. Development Workflow Pattern",
              "## 5. Documentation Pattern", "## 6. Validation & Quality Pattern"))
    check("reference content: plugin-design-patterns binds Analysis to 3-8 critical agents",
          trow(pdp, "**Agents**", "3-8", "Specialized analyzers (critical)"))
    check("reference content: plugin-design-patterns binds Configuration to 2-4 commands",
          trow(pdp, "**Commands**", "2-4", "`setup`, `configure`, `update-config`"))

    # 9-17 Six templates: lock their structural and procedural order.
    check("reference content: analyzer template orders role, responsibilities, framework, dimensions, and severity",
          seq(tp("analyzer-agent-template.md"), "## Role", "## Core Responsibilities",
              "## Analysis Framework", "## Analysis Dimensions", "## Severity Levels",
              "## Context Awareness"))
    check("reference content: analyzer template gives four core responsibilities in order",
          seq(tp("analyzer-agent-template.md"), "1. **Analysis**:",
              "2. **Pattern Detection**:", "3. **Assessment**:", "4. **Reporting**:"))
    check("reference content: extractor template gives four extraction phases in order",
          seq(tp("extractor-agent-template.md"), "### 1. Scan Phase", "### 2. Parse Phase",
              "### 3. Validate Phase", "### 4. Transform Phase"))
    check("reference content: extractor template gives four ambiguity rules in order",
          seq(tp("extractor-agent-template.md"), "1. **Check Context**:",
              "2. **Apply Heuristics**:", "3. **Use Defaults**:", "4. **Flag Uncertainty**:"))
    vtpl = tp("validator-agent-template.md")
    check("reference content: validator template binds each rule to severity and auto-fix policy",
          trow(vtpl, "{R001}", "HIGH", "No") and trow(vtpl, "{R002}", "MEDIUM", "Yes")
          and trow(vtpl, "{R003}", "LOW", "Yes"))
    check("reference content: validator template gives four validation categories in order",
          seq(vtpl, "### 1. Schema Validation", "### 2. Convention Validation",
              "### 3. Coherence Validation", "### 4. Quality Validation"))
    check("reference content: generator template gives seven generation steps in order",
          seq(tp("generator-command-template.md"), "### Step 1: Parse Arguments",
              "### Step 2: Check Prerequisites", "### Step 3: Load Template",
              "### Step 4: Apply Transformations", "### Step 5: Generate Files",
              "### Step 6: Post-Generation", "### Step 7: Report Results"))
    check("reference content: orchestrator template gives five phases in order",
          seq(tp("orchestrator-command-template.md"), "### Phase 1: Initialization",
              "### Phase 2: Stage Execution", "### Phase 3: Result Aggregation",
              "### Phase 4: Post-Processing", "### Phase 5: Report"))
    check("reference content: wizard template gives five phases in order",
          seq(tp("wizard-command-template.md"), "### Phase 1: Introduction",
              "### Phase 2: Requirement Gathering", "### Phase 3: Confirmation",
              "### Phase 4: Execution", "### Phase 5: Next Steps"))

    # 9-18 Three hook-template READMEs: cross-check documentation and code both ways.
    for name in ("formatting-hook-template", "notification-hook-template",
                 "validation-hook-template"):
        try:
            cfg = _json.loads(read(os.path.join(tpl_dir, name, "hooks.json")))
            ev = next(iter(cfg["hooks"]))
            matcher = cfg["hooks"][ev][0]["matcher"]
        except (OSError, ValueError, KeyError, StopIteration, TypeError):
            ev = matcher = None
        rm = read(os.path.join(tpl_dir, name, "README.md"))
        check(f"reference content: {name}/README reproduces the live hooks.json event and matcher",
              bool(ev) and f'"{ev}": [' in rm and f'"matcher": "{matcher}"' in rm,
              f"live {ev}/{matcher}")
        check(f"reference content: {name}/README explains whether the event can block",
              bool(ev) and f"`{ev}`" in rm and "lifecycle events" in rm)

    # (10) Citation axis: require a **prefixed relative path**.
    #
    # The shared reachability check accepts a bare basename. Common names such as
    # README.md and hooks.json can therefore appear anywhere and count as reachable.
    # Require at least one directory segment here because _suite_lib.py is outside
    # this skill's ownership.
    cite = {"SKILL.md": read(os.path.join(ROOT, "SKILL.md"))}
    owned = []
    for sub in ("references", "scripts"):
        base = os.path.join(ROOT, sub)
        if not os.path.isdir(base):
            continue
        for dp, dn, fns in os.walk(base):
            dn[:] = [d for d in dn if d not in ("__pycache__", ".ruff_cache")]
            for n in sorted(fns):
                if n.endswith((".pyc", ".lines")):
                    continue
                r = os.path.relpath(os.path.join(dp, n), ROOT).replace(os.sep, "/")
                try:
                    cite[r] = read(os.path.join(ROOT, r))
                except (OSError, UnicodeDecodeError):
                    continue
                if not n.startswith((".", "_")) and "/tests/" not in f"/{r}":
                    owned.append(r)
    stray = []
    for r in owned:
        seg = r.split("/")
        forms = ["/".join(seg[i:]) for i in range(len(seg) - 1)]
        others = "\n".join(v for k, v in cite.items() if k != r)
        if not any(f in others for f in forms):
            stray.append(r)
    check("citation: supporting files use prefixed relative paths (zero orphans)",
          not stray, f"orphans {stray}" if stray else f"{len(owned)} files")

    check_skill_body(check, ROOT, needles=[
        "every turn of every session",
        "**Floors are measured, not chosen.**",
        "Name the neighbour explicitly",
        "routes to another skill",
        "with no contract suite is prose",
    ], floor=6261)

    # Keep freeze_dir outside the default tests/refs. On a case-insensitive macOS
    # volume, skill.md.lines aliases check_skill_body's SKILL.md.lines; sharing the
    # directory lets one FREEZE_REFS run silently overwrite the other answer key.
    check_ref_contracts(check, ROOT, [
        ("layers.md", "layer sizes, misuse costs, script criteria, and reference naming",
         ["push in opposite directions", "does not depend on the situation",
          "half of it is always noise", "not after its format"], 1553),
        ("agent.md", "agent creation from context detection through generation",
         ["Add a new intelligent agent to an existing plugin with guided configuration.",
          "Agent roles (analyzer, extractor, validator, generator)"], 9596),
        ("command.md", "command creation through detection, configuration, templates, and generation",
         ["Interactive wizard for adding commands to plugins.",
          "(wizard|generator|orchestrator|utility)"], 1346),
        ("hook.md", "hook creation covering name, type, trigger, matcher, and language",
         ["Add a new hook to an existing plugin with guided configuration.",
          "(lifecycle event handlers)"], 8896),
        ("skill.md", "skill creation from scope decision through delivery",
         ["Add a skill to an existing plugin or create a plugin to contain it.",
          "## Step 0: Determine Scope"], 5415),
        ("skill-writing-guide.md", "description routing patterns and body style",
         ["A description is a short situation statement used for automatic selection.",
          "Include a boundary for similar requests that should not select it.",
          "When asked only for an audit, report findings and proposed corrections without editing.",
          "Do not repeatedly ask for approval for already authorized, reversible edits.",
          "without editing"], 5220),
        ("skill-testing-guide.md", "with-skill and baseline validation with an iteration loop",
         ["write -> execute -> evaluate -> improve -> retest",
          "Compare With-Skill and Baseline Runs"], 6510),
        ("component-decision.md", "two decision axes and each layer's unique ability",
         ["If the unique-ability cell is empty", "Can block execution",
          "Without a separate-context need, it is an expensive skill."], 2563),
        ("placement.md", "one authority, linked distribution, reach, and host contracts",
         ["Keep one real skill directory", "A sync tool must never replace those directories.",
          "Automatic classification produces false positives and negatives."], 3565),
        ("browser-priority.md", "four browser tools and the reasons for their order",
         ["Do not use the Playwright MCP", "The legacy plugin tree contained no",
          "Inject this guidance only when a prompt concerns"], 2567),
        ("deprecated-governance.md", "seven retired artifacts and negative-corpus limits",
         ["only when a later cycle consumes it as gate input",
          "describe what is true now",
          "Inputs should be arguments;"], 3101),
    ], freeze_dir="tests/refs/references")

    check_ref_contracts(check, ROOT, [
        ("agent-architecture.md", "agent-versus-skill decisions and orchestration patterns",
         ["Comprehensive guide to Claude Code agents: when to use them, how to structure them, and orchestration patterns.",
          "Read-only by default (unless write tools explicitly allowed)"], 9861),
        ("bundle-coherence-guide.md", "criteria for bundling or separating plugins",
         ["Decision framework for determining when to bundle components into a single plugin vs. separating them into multiple plugins.",
          "Users think of components as **one cohesive thing**."], 8438),
        ("command-architecture.md", "wizard, generator, and orchestrator command tiers",
         ["Commands are the primary user interface layer in the plugin system.",
          "Requires domain expertise to choose correctly"], 5753),
        ("hook-architecture.md", "hook lifecycle, matcher, real hooks.json schema, and contracts",
         ["Comprehensive guide to Claude Code hooks: lifecycle, configuration, implementation patterns, and best practices.",
          "`matcher` only ever tests the **tool name**."], 11507),
        ("organizational-governance.md", "naming, file organization, and version policy",
         ["This guide defines naming conventions, file organization, versioning, and quality standards for organization plugin development.",
          "Use verb-noun or domain-verb pattern"], 8180),
        ("plugin-design-patterns.md", "six bundle patterns and component combinations",
         ["This guide describes six common plugin patterns for organizational plugin development.",
          "Manage system settings, project configurations, or environment setup with guided wizards and automation."], 8127),
    ], subdir="references/organizational-guides", freeze_dir="tests/refs/organizational-guides")

    check_ref_contracts(check, ROOT, [
        ("analyzer-agent-template.md", "analyzer agent skeleton",
         ["Template for creating agents that analyze code, plugins, or project structure.",
          "Agent prompt files go in `.claude-plugin/agents/{agent-name}.md`"], 5630),
        ("extractor-agent-template.md", "extractor agent skeleton",
         ["Template for agents that extract structured information from unstructured sources.",
          "Extractor agents parse, interpret, and transform unstructured data (docs, code, conversations) into structured formats."], 3816),
        ("validator-agent-template.md", "validator agent skeleton",
         ["Template for agents that validate correctness, consistency, and compliance.",
          "Validator agents check data, code, or artifacts against rules, schemas, and best practices."], 4867),
        ("generator-command-template.md", "generator command skeleton",
         ["Template for commands that generate files/code from templates.",
          "Generator commands create files by applying templates with variable substitution."], 5229),
        ("orchestrator-command-template.md", "orchestrator command skeleton",
         ["Template for commands that coordinate multiple agents, tools, or workflows.",
          "Orchestrator commands manage complex multi-stage pipelines, delegating work to specialized agents and coordinating results."], 5763),
        ("wizard-command-template.md", "wizard command skeleton",
         ["Template for interactive multi-step commands that guide users through complex workflows.",
          "Wizard commands use progressive disclosure to gather requirements, guide decisions, and execute complex operations."], 5875),
    ], subdir="references/templates", freeze_dir="tests/refs/templates")

    # All three hook templates use README.md. Separate freeze directories prevent
    # a FREEZE_REFS run from overwriting two answer keys with the third.
    check_ref_contracts(check, ROOT, [
        ("README.md", "formatting hook skeleton with hooks.json and format.sh",
         ["This template provides a code/document formatting hook for Claude Code plugins.",
          "Formatting hooks automatically format code, JSON, markdown, or other files according to project standards."], 5092),
    ], subdir="references/templates/formatting-hook-template",
       freeze_dir="tests/refs/templates/formatting-hook-template")

    check_ref_contracts(check, ROOT, [
        ("README.md", "notification hook skeleton with hooks.json and notify.sh",
         ["This template provides event notification hooks for Claude Code plugins.",
          "Notification hooks send alerts, update status, record events, or trigger external integrations when plugin actions occur."], 7324),
    ], subdir="references/templates/notification-hook-template",
       freeze_dir="tests/refs/templates/notification-hook-template")

    check_ref_contracts(check, ROOT, [
        ("README.md", "validation hook skeleton with hooks.json and validate_template.py",
         ["This template provides a complete validation hook implementation for Claude Code plugins.",
          "Validation hooks verify data correctness, enforce constraints, and prevent invalid state."], 7185),
    ], subdir="references/templates/validation-hook-template",
       freeze_dir="tests/refs/templates/validation-hook-template")

    check_script_contracts(check, __file__, ROOT, scripts={
        "scripts/validate_plugin.sh": 3,
        "scripts/list_plugins.sh": 3,
        "scripts/register_local.sh": 2,
        "scripts/scaffold_plugin.sh": 6,
        "references/templates/formatting-hook-template/hooks.json": 6,
        "references/templates/notification-hook-template/hooks.json": 6,
        "references/templates/validation-hook-template/hooks.json": 6,
        "references/templates/formatting-hook-template/format.sh": 4,
        "references/templates/notification-hook-template/notify.sh": 3,
        "references/templates/validation-hook-template/validate_template.py": 3,
        "scripts/check_package_surface.py": 5,
        "references/package-surface.yaml": 13,
    }, live_ran=sum(1 for r in results
                    if not r[0].startswith(("자기검사:", "계약 커버리지:", "스크립트 계약:"))))
    check_contract_coverage(check, __file__, ROOT, per_file={
        "SKILL.md": 49,
        "SKILL.codex.md": 3,
        "references/layers.md": 17,
        "scripts/validate_plugin.sh": 3,
        "scripts/list_plugins.sh": 3,
        "scripts/register_local.sh": 2,
        "scripts/scaffold_plugin.sh": 6,
        "references/agent.md": 6,
        "references/command.md": 5,
        "references/hook.md": 11,
        "references/skill.md": 6,
        "references/skill-writing-guide.md": 5,
        "references/skill-testing-guide.md": 6,
        "references/organizational-guides/agent-architecture.md": 6,
        "references/organizational-guides/bundle-coherence-guide.md": 6,
        "references/organizational-guides/command-architecture.md": 6,
        "references/organizational-guides/hook-architecture.md": 7,
        "references/organizational-guides/organizational-governance.md": 6,
        "references/organizational-guides/plugin-design-patterns.md": 6,
        "references/templates/analyzer-agent-template.md": 5,
        "references/templates/extractor-agent-template.md": 5,
        "references/templates/validator-agent-template.md": 5,
        "references/templates/generator-command-template.md": 4,
        "references/templates/orchestrator-command-template.md": 4,
        "references/templates/wizard-command-template.md": 4,
        "references/templates/formatting-hook-template/README.md": 5,
        "references/templates/notification-hook-template/README.md": 5,
        "references/templates/validation-hook-template/README.md": 5,
        "references/templates/formatting-hook-template/hooks.json": 6,
        "references/templates/notification-hook-template/hooks.json": 6,
        "references/templates/validation-hook-template/hooks.json": 6,
        "references/templates/formatting-hook-template/format.sh": 4,
        "references/templates/notification-hook-template/notify.sh": 3,
        "references/templates/validation-hook-template/validate_template.py": 3,
        "references/component-decision.md": 6,
        "references/placement.md": 8,
        "references/browser-priority.md": 7,
        "references/deprecated-governance.md": 5,
        "references/package-surface.yaml": 13,
        "scripts/check_package_surface.py": 5,
    }, live_ran=sum(1 for r in results
                    if not r[0].startswith(("자기검사:", "계약 커버리지:", "스크립트 계약:"))))
    check_body_deletion(check, __file__, ROOT, minimum=49,
                        live_ran=sum(1 for r in results
                                     if not r[0].startswith(("자기검사:", "계약 커버리지:", "스크립트 계약:"))))
    check_no_constant_assertions(check, __file__)
    check_total(check, results, 323)

    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n{passed}/{len(results)} 통과")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
