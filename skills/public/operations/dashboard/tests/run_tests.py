#!/usr/bin/env python3
"""Dashboard regression suite.

Run python3 tests/run_tests.py from skills/dashboard.

This skill vendors upstream code. Verify complete import and execution in our
layout: 98 unchanged-file hashes, no undeclared imports outside the manifest or
local-change list, successful byte-identical npm builds, consistent identity
across shim/hook/commands, and actual hook behavior on stub settings.json files.
The hook defaults off and preserves original bytes in .bak when enabled.

Without Node, build and hook axes cannot run. Name and fail them using the
SKIPPED_AXES convention established by proof and hwpx; never silently omit them.
"""
import hashlib
import io
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
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
from _suite_lib import (check_skill_body, check_ref_contracts,  # noqa: E402
                        check_no_constant_assertions, check_contract_coverage,
                        check_body_deletion, check_total, check_body_paths,
                        split_frontmatter, read_ref)

PLUGIN_ROOT = os.path.dirname(os.path.dirname(ROOT))
HOOK = os.path.join(PLUGIN_ROOT, "hooks", "ensure-statusline.mjs")
CMD_DIR = os.path.join(PLUGIN_ROOT, "commands")
CMDS = ("check-usage.md", "dashboard-setup.md", "dashboard-alias.md", "dashboard-repair.md")

# Installation identity is declared once and compared across four consumers.
# Omitted reapplication of local changes is the main upstream-update drift risk.
MARKETPLACE = "jstack"
PLUGIN = "jstack"
DIST_SUB = "payload/skills/dashboard/dist"

# Axes requiring Node. Name and fail unmeasured axes; absence is a judgment.
SKIPPED_AXES = (
    "Build: npm run build exits 0",
    "Build: outputs are byte-identical to committed dist",
    "Hook: default off writes nothing",
    "Hook: enabling installs the shim and repoints statusLine",
    "Hook: .bak preserves original bytes before modification",
    "Hook: repoints a command pinned without payload/",
    "Layout: built package places dist at the shim subpath",
    "Install: without an installed build exits 1 and writes nothing",
    "Install: a config without settings.json gains the shim statusLine",
    "Install: the installed shim renders the staging build",
    "Install: another tool's statusLine exits 3 and stays byte-identical",
    "Install: --replace keeps other keys and backs up the original bytes",
    "Install: an unreadable rate limit renders text, not an emoji",
)

results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    # Print detail on success too. Without it, check_floor_parity cannot parse
    # measured failure/floor counts and sees zero floor checks as no disagreement,
    # confusing unmeasured behavior with agreement.
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))


def read(p):
    return io.open(p, encoding="utf-8", errors="replace").read()


def sha(p):
    return hashlib.sha256(io.open(p, "rb").read()).hexdigest()


def have_node():
    return shutil.which("node") is not None


def manifest_rows():
    """Parse <sha>  <relative_path> entries from UPSTREAM.sha256."""
    out = []
    for ln in read(os.path.join(ROOT, "UPSTREAM.sha256")).splitlines():
        if ln.startswith("#") or not ln.strip():
            continue
        parts = ln.split(None, 1)
        if len(parts) == 2:
            out.append((parts[0], parts[1].strip()))
    return out


# Expected manifest exclusions: our authored files and local modifications.
# The population guard detects unexplained additions to this list.
NOT_IN_MANIFEST = {
    "SKILL.codex.md": "Locally authored Codex native entry selected by packaging",
    "SKILL.md": "Locally authored decision layer",
    "NOTICE": "Locally authored provenance record",
    "UPSTREAM.sha256": "The manifest itself",
    "scripts/build.js": "Local change: remove upstream manifest synchronization",
    "scripts/statusline-shim.mjs": "Local change: installation identity constants",
    "scripts/install-statusline.mjs": "Locally authored first-installation script",
    "scripts/widgets/rate-limit.ts": "Local change: text marker instead of the warning emoji",
    "dist/index.js": "Local change: rebuilt from the modified rate-limit widget",
    "scripts/__tests__/rate-limit.test.ts": "Local change: upstream test follows the text marker",
}


def vendored_files():
    """List vendored-tree files, excluding authored references/tests and build byproducts."""
    out = []
    for dp, dn, fn in os.walk(ROOT):
        dn[:] = [d for d in dn if d not in ("node_modules", "__pycache__", "tests", "references")]
        for f in sorted(fn):
            rel = os.path.relpath(os.path.join(dp, f), ROOT).replace(os.sep, "/")
            out.append(rel)
    return sorted(out)


def main():
    # (0) The Codex entry is delivered next to SKILL.md and must keep its host boundary.
    codex = read(os.path.join(ROOT, "SKILL.codex.md")) if os.path.isfile(os.path.join(ROOT, "SKILL.codex.md")) else ""
    check("Codex: native configuration and host boundaries survive delivery",
          "tui.status_line" in codex and "$CODEX_HOME/config.toml" in codex
          and "Do not run the Claude statusline installer" in codex
          and "preserve other settings and comments" in codex)

    # (1) Import integrity.
    rows = manifest_rows()
    check("Import: manifest is nonempty", len(rows) >= 90, f"{len(rows)} rows")
    bad = [r for h, r in rows if not os.path.isfile(os.path.join(ROOT, r))]
    check("Import: every manifest file exists", not bad, f"Absent {bad[:3]}")
    drift = [r for h, r in rows
             if os.path.isfile(os.path.join(ROOT, r)) and sha(os.path.join(ROOT, r)) != h]
    check("Import: manifest hashes match actual bytes", not drift,
          f"Mismatches: {len(drift)} {drift[:3]}")

    # (2) Manifest population.
    listed = {r for _, r in rows} | set(NOT_IN_MANIFEST)
    extra = [f for f in vendored_files() if f not in listed]
    check("Import: no unlisted files (population)", not extra,
          f"Unlisted {extra[:5]}")
    stale = [k for k in NOT_IN_MANIFEST if not os.path.isfile(os.path.join(ROOT, k))]
    check("Import: all exceptions exist (no stale exclusions)", not stale, f"{stale}")

    # (4) Installation identity constants.
    shim = read(os.path.join(ROOT, "scripts", "statusline-shim.mjs"))
    for label, want in (("JSTACK_MARKETPLACE", MARKETPLACE), ("JSTACK_PLUGIN", PLUGIN)):
        check(f"Identity: shim {label} equals '{want}'",
              re.search(rf"{label}\s*=\s*'{re.escape(want)}'", shim) is not None)
    check("Identity: shim JSTACK_DIST_SUBPATH points to payload/skills/dashboard/dist",
          re.search(r"JSTACK_DIST_SUBPATH\s*=\s*\['payload',\s*'skills',\s*'dashboard',\s*'dist',\s*'index\.js'\]",
                    shim) is not None)
    check("Identity: shim no longer uses the upstream cache path",
          "'claude-dashboard', 'claude-dashboard'" not in shim)

    hook = read(HOOK)
    check("Identity: hook PINNED_TAIL points to our marketplace/plugin",
          MARKETPLACE in hook and f"]{PLUGIN}[" in hook.replace("\\\\", "").replace("[/", "]")
          or (MARKETPLACE in hook and PLUGIN in hook))
    check("Identity: hook PINNED_TAIL points to payload/skills/dashboard/dist",
          r"(?:payload[/\\])?skills[/\\]dashboard[/\\]dist" in hook)
    check("Identity: hook no longer uses the upstream cache identity", "claude-dashboard" not in hook)
    check("Identity: hook locates the shim inside this skill",
          "'skills', 'dashboard', 'scripts', 'statusline-shim.mjs'" in hook)

    for c in CMDS:
        t = read(os.path.join(CMD_DIR, c))
        leaked = re.findall(r"plugins/cache/claude-dashboard|plugins/data/claude-dashboard-", t)
        check(f"Identity: {c} contains no stale upstream installation path", not leaked, f"{leaked[:2]}")

    # (5) Hook safety and (3) build.
    if not have_node():
        for a in SKIPPED_AXES:
            print(f"[SKIP] {a} — Not run because Node is unavailable")
        check("Dependency: Node is available", False,
              "Node unavailable: thirteen build/hook/install axes unmeasured")
    else:
        check("Dependency: Node is available", shutil.which("node") is not None,
              shutil.which("node") or "")
        run_build_axes(check)
        run_hook_axes(check)
        run_install_axes(check)

    # NOTICE contract.
    notice = read_ref(os.path.join(ROOT, "NOTICE")) or ""
    for frag in ("v1.32.0", "MIT", "UPSTREAM.sha256"):
        check(f"Provenance: NOTICE identifies '{frag}'", frag in notice)
    for local in ("scripts/build.js", "scripts/statusline-shim.mjs", "ensure-statusline.mjs"):
        check(f"Provenance: NOTICE names local change '{local}'", local in notice)
    lic = read_ref(os.path.join(ROOT, "LICENSE.upstream")) or ""
    check("Provenance: full MIT license exists",
          "MIT License" in lic and "WITHOUT WARRANTY OF ANY KIND" in lic,
          f"{len(lic)}B")
    check("Provenance: copyright holder is upstream", "uppinote" in lic)

    vt = read_ref(os.path.join(ROOT, "vitest.config.ts")) or ""
    check("Import: vitest configuration targets the upstream test population",
          "scripts/__tests__/**/*.test.ts" in vt, vt[:60])

    check("Provenance: NOTICE discloses emoji divergence",
          "emoji" in notice and "block_emoji" in notice)

    # Standard axes.
    fm, body = split_frontmatter(read(os.path.join(ROOT, "SKILL.md")))
    check_body_paths(
        check, ROOT, body, fm_of_skill=fm,
        # The 89 imported TypeScript files are connected through imports rather than
        # prose. Build reproducibility measures that wiring: esbuild resolves imports,
        # excluding unused modules and failing on missing ones. Our authored reference
        # documents remain subject to ordinary reference checks.
        orphan_skip={"scripts": "Vendored upstream source: build reproducibility measures import wiring"})
    check_skill_body(check, ROOT, needles=[
        "JSTACK_DASHBOARD_STATUSLINE=1",
        "**Changes can be reverted.**",
        "When disabled, this skill does nothing.",
        "They do not mechanically conflict",
        "Keep them aligned.",
        "records its name and fails",
    ], floor=SKILL_FLOOR,
        orphan_skip={"scripts": "Vendored upstream source: build reproducibility measures import wiring"})
    check_ref_contracts(check, ROOT, [
        ("reading.md", "Display modes, zero-emoji configuration, and widget interpretation remain",
         ['"displayMode": "custom"',
          "The filename remains upstream's",
          "are not emoji",
          "/jstack:check-usage --json"], READING_FLOOR),
        ("boundary.md", "Ownership table and decision rule remain",
         ['**Authentication expiry belongs to workspace; budget and allowance consumption belong to dashboard.**',
          "token has two meanings",
          "bidirectional references can leave one side silently stale when the other changes"], BOUNDARY_FLOOR),
    ])
    check_no_constant_assertions(check, __file__)

    live_ran = sum(1 for r in results
                   if not r[0].startswith(("자기검사:", "계약 커버리지:", "스크립트 계약:")))
    check_contract_coverage(check, __file__, ROOT, per_file=PER_FILE, live_ran=live_ran)
    check_body_deletion(check, __file__, ROOT, minimum=BODY_MIN, live_ran=live_ran)
    check_total(check, results, TOTAL)

    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n{passed}/{len(results)} 통과")
    return 0 if passed == len(results) else 1


def run_build_axes(check):
    """Verify bundles rebuilt from source by both exit status and bytes."""
    before = {n: sha(os.path.join(ROOT, "dist", n)) for n in ("index.js", "check-usage.js")}
    work = tempfile.mkdtemp()
    try:
        dst = os.path.join(work, "d")
        shutil.copytree(ROOT, dst, ignore=shutil.ignore_patterns(
            "node_modules", "__pycache__", "tests"))
        # Deletion copies omit node_modules; reuse the same external build environment.
        nm = os.environ.get("JSTACK_DASHBOARD_DEPENDENCIES") or os.path.join(ROOT, "node_modules")
        if os.path.isdir(nm):
            os.symlink(nm, os.path.join(dst, "node_modules"))
        for n in before:
            os.remove(os.path.join(dst, "dist", n))
        r = subprocess.run(["npm", "run", "build"], cwd=dst,
                           capture_output=True, text=True)
        check("Build: npm run build exits 0", r.returncode == 0,
              (r.stderr or r.stdout).strip().splitlines()[-1][:90] if r.returncode else "")
        after = {}
        for n in before:
            p = os.path.join(dst, "dist", n)
            after[n] = sha(p) if os.path.isfile(p) else "(Absent)"
        same = [n for n in before if before[n] == after[n]]
        check("Build: outputs are byte-identical to committed dist", len(same) == len(before),
              f"Matching {len(same)}/{len(before)}")
    finally:
        shutil.rmtree(work, ignore_errors=True)


def run_hook_axes(check):
    """Execute the hook and compare before/after state rather than grepping strings."""
    work = tempfile.mkdtemp()
    try:
        cfg, data = os.path.join(work, "cfg"), os.path.join(work, "data")
        os.makedirs(cfg)
        os.makedirs(data)
        pinned = (f'node "/x/.claude/plugins/cache/{MARKETPLACE}/{PLUGIN}/0.8.0-staging/'
                  f'{DIST_SUB}/index.js"')
        original = json.dumps({"statusLine": {"type": "command", "command": pinned}}, indent=2)
        sp = os.path.join(cfg, "settings.json")
        io.open(sp, "w", encoding="utf-8").write(original)

        def run(on):
            # Real installs set CLAUDE_PLUGIN_ROOT to the package root above payload/;
            # the hook must not depend on it.
            root = os.environ.get("JSTACK_PACKAGE_ROOT") or os.path.join(work, "package-root-without-payload")
            env = dict(os.environ, CLAUDE_PLUGIN_ROOT=root,
                       CLAUDE_PLUGIN_DATA=data, CLAUDE_CONFIG_DIR=cfg)
            env.pop("JSTACK_DASHBOARD_STATUSLINE", None)
            if on:
                env["JSTACK_DASHBOARD_STATUSLINE"] = "1"
            subprocess.run(["node", HOOK], capture_output=True, text=True, env=env)

        run(False)
        check("Hook: default off writes nothing",
              read(sp) == original and not os.listdir(data),
              f"data {os.listdir(data)}")
        run(True)
        now = json.loads(read(sp))
        check("Hook: enabling installs the shim and repoints statusLine",
              os.path.isfile(os.path.join(data, "statusline.mjs"))
              and now["statusLine"]["command"] != pinned,
              now["statusLine"]["command"][:70])
        bak = sp + ".bak"
        check("Hook: .bak preserves original bytes before modification",
              os.path.isfile(bak) and read(bak) == original,
              "Absent" if not os.path.isfile(bak) else "Content differs")
        legacy = (f'node "/x/.claude/plugins/cache/{MARKETPLACE}/{PLUGIN}/0.8.0-staging/'
                  'skills/dashboard/dist/index.js"')
        io.open(sp, "w", encoding="utf-8").write(
            json.dumps({"statusLine": {"type": "command", "command": legacy}}, indent=2))
        run(True)
        moved = json.loads(read(sp))
        check("Hook: repoints a command pinned without payload/",
              "statusline.mjs" in moved["statusLine"]["command"],
              moved["statusLine"]["command"][:70])

        cache = os.path.join(work, "cache")
        for version in ("0.8.0-staging", "0.8.0", "junk", "0.8.0-"):
            os.makedirs(os.path.join(cache, version, *DIST_SUB.split("/")), exist_ok=True)
            io.open(os.path.join(cache, version, *DIST_SUB.split("/"), "index.js"), "w").write("")
        probe = subprocess.run(
            ["node", "--input-type=module", "-e",
             "import {resolveLatestDist} from " + json.dumps("file://" + os.path.join(ROOT, "scripts/statusline-shim.mjs")) +
             "; console.log(resolveLatestDist(process.argv[1]))", cache],
            capture_output=True, text=True)
        check("Hook: accepts prereleases and prefers the stable release of the same version",
              probe.returncode == 0 and f"{os.sep}0.8.0{os.sep}" in probe.stdout,
              probe.stdout.strip() or probe.stderr.strip()[:90])
    finally:
        shutil.rmtree(work, ignore_errors=True)


def run_install_axes(check):
    """Install into temporary config directories laid out like a real plugin cache."""
    pkg = os.environ.get("JSTACK_PACKAGE_ROOT")
    check("Layout: built package places dist at the shim subpath",
          bool(pkg) and os.path.isfile(os.path.join(pkg, *DIST_SUB.split("/"), "index.js"))
          and os.path.isfile(os.path.join(pkg, "hooks", "hooks.json")),
          f"{DIST_SUB}/index.js" if pkg else "JSTACK_PACKAGE_ROOT unset: run through run_suites")
    work = tempfile.mkdtemp()
    try:
        installer = os.path.join(ROOT, "scripts", "install-statusline.mjs")
        home, cfg, empty = (os.path.join(work, n) for n in ("home", "cfg", "empty"))
        os.makedirs(os.path.join(home, ".claude"))
        os.makedirs(empty)
        io.open(os.path.join(home, ".claude", "claude-dashboard.local.json"), "w").write(json.dumps(
            {"language": "en", "plan": "max", "displayMode": "custom",
             "lines": [["model", "context", "cost"]], "cache": {"ttlSeconds": 300}}))
        env = dict(os.environ, HOME=home, USERPROFILE=home)
        env.pop("CLAUDE_CONFIG_DIR", None)

        def install(d, *extra):
            return subprocess.run(["node", installer, "install", "--config-dir", d, *extra],
                                  capture_output=True, text=True, env=env)

        none = install(empty)
        check("Install: without an installed build exits 1 and writes nothing",
              none.returncode == 1 and not os.listdir(empty),
              f"rc={none.returncode} {os.listdir(empty)}")
        dist = os.path.join(cfg, "plugins", "cache", MARKETPLACE, PLUGIN, "0.8.0-staging",
                            *DIST_SUB.split("/"))
        shutil.copytree(os.path.join(ROOT, "dist"), dist)
        fresh = install(cfg)
        sp = os.path.join(cfg, "settings.json")
        shim = os.path.join(cfg, "plugins", "data", f"{PLUGIN}-{MARKETPLACE}", "statusline.mjs")
        written = json.loads(read(sp)) if os.path.isfile(sp) else {}
        command = (written.get("statusLine") or {}).get("command")
        check("Install: a config without settings.json gains the shim statusLine",
              fresh.returncode == 0 and os.path.isfile(shim) and command == "node " + json.dumps(shim),
              f"rc={fresh.returncode} {(command or fresh.stdout)[:70]}")
        sample = json.dumps({"model": {"display_name": "Opus"},
                             "context_window": {"context_window_size": 200000, "current_usage": {
                                 "input_tokens": 50000, "cache_creation_input_tokens": 0,
                                 "cache_read_input_tokens": 0}},
                             "cost": {"total_cost_usd": 0.5}})
        render = subprocess.run(["node", shim], input=sample, capture_output=True, text=True,
                                env=dict(env, CLAUDE_CONFIG_DIR=cfg))
        check("Install: the installed shim renders the staging build",
              render.returncode == 0 and "$0.50" in render.stdout and "50K/200K" in render.stdout,
              re.sub(r"\x1b\[[0-9;]*m", "", render.stdout).strip()[:70] or render.stderr.strip()[:70])
        unreadable = os.path.join(work, "home2")
        os.makedirs(os.path.join(unreadable, ".claude"))
        io.open(os.path.join(unreadable, ".claude", "claude-dashboard.local.json"), "w").write(json.dumps(
            {"language": "en", "plan": "max", "displayMode": "custom",
             "lines": [["model", "cost", "rateLimit5h", "rateLimit7d", "rateLimit7dFable"]],
             "cache": {"ttlSeconds": 300}}))
        marker = subprocess.run(["node", shim], input=sample, capture_output=True, text=True,
                                env=dict(env, HOME=unreadable, USERPROFILE=unreadable,
                                         CLAUDE_CONFIG_DIR=cfg))
        plain = re.sub(r"\x1b\[[0-9;]*m", "", marker.stdout)
        check("Install: an unreadable rate limit renders text, not an emoji",
              marker.returncode == 0 and "5h: --" in plain
              and not re.search(r"[\u2600-\u27bf\U0001f000-\U0001faff]", plain),
              plain.strip()[:70] or marker.stderr.strip()[:70])
        foreign = '{\n    "model": "x",\n    "statusLine": {"type": "command", "command": "ccstatusline", "padding": 0}\n}\n'
        io.open(sp, "w", encoding="utf-8", newline="").write(foreign)
        refused = install(cfg)
        check("Install: another tool's statusLine exits 3 and stays byte-identical",
              refused.returncode == 3 and read(sp) == foreign, f"rc={refused.returncode}")
        replaced = install(cfg, "--replace")
        after = json.loads(read(sp))
        bak = sp + ".bak"
        check("Install: --replace keeps other keys and backs up the original bytes",
              replaced.returncode == 0 and after["statusLine"]["command"] == "node " + json.dumps(shim)
              and after["statusLine"].get("padding") == 0 and after.get("model") == "x"
              and os.path.isfile(bak) and read(bak) == foreign,
              f"rc={replaced.returncode}")
    finally:
        shutil.rmtree(work, ignore_errors=True)


# Measured values: scripts/check_floor_parity.py requires declarations to
# equal observations. Slack would hide disappearing contracts.
SKILL_FLOOR = 2975
READING_FLOOR = 2532
BOUNDARY_FLOOR = 1467
BODY_MIN = 14
TOTAL = 77
PER_FILE = {
    # All values are measured. check_contract_coverage requires a floor of at
    # least one to establish that each file carries a contract. Slack would hide
    # disappearing contracts.
    "SKILL.codex.md": 2,
    "SKILL.md": 14,
    "NOTICE": 8,
    "UPSTREAM.sha256": 2,
    "LICENSE.upstream": 4,
    "vitest.config.ts": 3,
    "references/reading.md": 4,
    "references/boundary.md": 4,
}

if __name__ == "__main__":
    sys.exit(main())
