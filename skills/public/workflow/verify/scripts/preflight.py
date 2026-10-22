#!/usr/bin/env python3
"""Pre-install check: determine whether a package tree is deployable.

The check pins one of two modes and fails on files outside the declared surface:

    source-development   A working copy containing `.git` or `tests/`.
    installed-runtime    A delivered copy containing neither.

The tree determines the mode. `--mode` may only request a stricter mode; a
request for a looser mode exits 2 without running checks. This prevents an
operator from bypassing installed-runtime checks under pressure.

Both modes enforce a closed rule for links and special files. A relative
symlink is accepted only when its resolved target exists inside the package.
Broken and escaping links, sockets, FIFOs, and device files are rejected.

Surface membership fails closed. One unclassified file is a failure. The
authoritative definition is `author/references/package-surface.yaml`; when it
is unavailable, use `FALLBACK_SURFACE` and report that fallback explicitly.

Expected format, mapping roles to glob lists:

    runtime:
      - SKILL.md
      - references/**/*.md
    verification:
      - tests/**

Usage:
    preflight.py <package-root> [--mode MODE] [--surface PATH] [--json]

Exit codes:
    0  clean
    1  violations found
    2  unexecutable: missing path or rejected looser mode
"""

from __future__ import annotations

import argparse
import fnmatch
import json
import os
import re
import stat
import sys

from package_identity import IdentityError, compute_identity, symlink_payload, verify_receipt

SOURCE, INSTALLED = "source-development", "installed-runtime"
# Strictness order. Larger values are stricter; --mode compares these values.
STRICTNESS = {SOURCE: 0, INSTALLED: 1}

EXIT_CLEAN, EXIT_VIOLATIONS, EXIT_UNRUNNABLE = 0, 1, 2

# Use only when the authoritative surface is missing. This remains a closed list.
FALLBACK_SURFACE = {
    "runtime": [
        "SKILL.md",
        "references/**",
        "scripts/**",
        "langs/**",
        "assets/**",
        "templates/**",
        "commands/**",
        "agents/**",
        "hooks/**",
    ],
    "verification": ["tests/**"],
    "metadata": [
        "NOTICE",
        "LICENSE",
        "LICENSE.*",
        "README.md",
        "CHANGELOG.md",
        "UPSTREAM.*",
        "*.json",
        "*.toml",
        "*.yaml",
        "*.yml",
    ],
}

# Development artifacts rejected only in installed-runtime mode.
DEV_ARTIFACTS = [
    ".git",
    "__pycache__",
    ".ruff_cache",
    ".DS_Store",
    ".pytest_cache",
    "*.pyc",
    "*.pyo",
    "*.orig",
    "*.rej",
]

# References that escape the package and are absent or user-owned after installation.
ESCAPE_PATTERNS = [
    (re.compile(r"(?<!\w)~/\.claude"), "hard-coded home path"),
    (re.compile(r"(?<!\w)/Users/[A-Za-z0-9_.-]+/"), "absolute home path"),
    (re.compile(r"\$\{CLAUDE_PLUGIN_ROOT\}/\.\./"), "reference outside the plugin root"),
]


def load_surface(path):
    """Return role-to-glob lists; the two-level format is readable without PyYAML."""
    with open(path, encoding="utf-8") as f:
        raw = f.read()
    try:
        import yaml  # noqa: PLC0415

        data = yaml.safe_load(raw) or {}
        # The authoritative file puts roles under categories and out-of-surface
        # runtime residue under ignore. Treat ignore as a role to preserve closed classification.
        if isinstance(data, dict) and isinstance(data.get("categories"), dict):
            surface = {
                k: [str(x) for x in (v or [])]
                for k, v in data["categories"].items()
                if isinstance(v, list)
            }
            ig = data.get("ignore")
            if isinstance(ig, list):
                surface["ignored"] = [str(x) for x in ig]
            return surface
        if isinstance(data, dict) and all(isinstance(v, list) for v in data.values()):
            return {k: [str(x) for x in v] for k, v in data.items()}
    except Exception:  # noqa: BLE001 -- missing parser and malformed input both use fallback
        pass
    surface, role = {}, None
    for line in raw.splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        m = re.match(r"^([A-Za-z0-9_-]+):\s*$", line)
        if m:
            role = m.group(1)
            surface[role] = []
            continue
        m = re.match(r"^\s+-\s+(.+?)\s*$", line)
        if m and role:
            surface[role].append(m.group(1).strip().strip("\"'"))
    return surface


def find_surface(explicit, target_root=None):
    """Find the authoritative surface and return `(path | None, origin)`.

    Use an automatic candidate only when the target belongs to that candidate
    plugin. Applying one plugin's globs to a fixture or another tree would
    misclassify every file and turn a different surface into a violation.
    """
    if explicit:
        return (
            (explicit, "argument") if os.path.isfile(explicit) else (None, "argument path missing")
        )
    here = os.path.dirname(os.path.abspath(__file__))
    cands = []
    root = os.environ.get("CLAUDE_PLUGIN_ROOT")
    if root:
        cands.append(
            os.path.join(root, "skills", "author", "references", "package-surface.yaml")
        )
    cands.append(
        os.path.normpath(
            os.path.join(
                here, "..", "..", "author", "references", "package-surface.yaml"
            )
        )
    )
    for c in cands:
        if not os.path.isfile(c):
            continue
        plugin_root = os.path.realpath(
            os.path.normpath(os.path.join(os.path.dirname(c), "..", "..", ".."))
        )
        if target_root is not None:
            t = os.path.realpath(os.path.abspath(target_root))
            if os.path.commonpath([plugin_root, t]) != plugin_root:
                continue
        return c, c
    return None, "authority missing; using FALLBACK_SURFACE globs"


def matches(rel, pattern):
    if fnmatch.fnmatch(rel, pattern):
        return True
    if pattern.endswith("/**"):
        return rel == pattern[:-3] or rel.startswith(pattern[:-2])
    return False


def classify(rel, surface):
    for role, globs in surface.items():
        for g in globs:
            if matches(rel, g):
                return role
    return None


def detect_mode(root):
    """Detect the tree mode; arguments cannot lower this baseline."""
    if (
        os.path.isdir(os.path.join(root, ".git"))
        or os.path.isfile(os.path.join(root, ".git"))
        or os.path.isdir(os.path.join(root, "tests"))
    ):
        return SOURCE
    return INSTALLED


def walk(root):
    """Yield every `(relative, absolute, lstat)`, including directories for symlink checks."""
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        for n in list(dirnames) + filenames:
            p = os.path.join(dirpath, n)
            rel = os.path.relpath(p, root).replace(os.sep, "/")
            yield rel, p, os.lstat(p)


def check_with_identity(root, mode, surface):
    violations = []

    def add(kind, rel, detail=""):
        violations.append({"kind": kind, "path": rel, "detail": detail})

    try:
        identity = compute_identity(root)
    except IdentityError as exc:
        identity = None
        add("identity", ".", str(exc))

    if not os.path.isfile(os.path.join(root, "SKILL.md")):
        add("missing-skill", "SKILL.md", "SKILL.md is missing from the package root")

    for rel, p, st in walk(root):
        # 1. Check links and special files first in both modes.
        if stat.S_ISLNK(st.st_mode):
            try:
                symlink_payload(root, p)
            except IdentityError as exc:
                add("symlink", rel, f"{os.readlink(p)}: {exc}")
            continue
        if not (stat.S_ISREG(st.st_mode) or stat.S_ISDIR(st.st_mode)):
            add("non-regular", rel, f"mode {stat.S_IFMT(st.st_mode):o}")
            continue
        if stat.S_ISDIR(st.st_mode):
            continue

        # 2. Reject development residue in installed-runtime.
        if mode == INSTALLED:
            parts = rel.split("/")
            if any(fnmatch.fnmatch(seg, pat) for seg in parts for pat in DEV_ARTIFACTS):
                add("dev-artifact", rel, "not allowed in an installed package")
                continue

        # 3. Enforce surface membership with fail-closed behavior.
        role = classify(rel, surface)
        if role is None:
            add("unclassified", rel, "file is outside the surface; classify or remove it")
            continue

        # 4. Reject empty runtime files and package escapes in installed-runtime.
        if mode == INSTALLED and role == "runtime":
            if st.st_size == 0:
                add("empty-runtime", rel, "zero bytes")
                continue
            if rel.endswith((".md", ".py", ".sh", ".json", ".yaml", ".yml")):
                try:
                    with open(p, encoding="utf-8", errors="replace") as f:
                        text = f.read()
                except OSError:
                    text = ""
                for pat, why in ESCAPE_PATTERNS:
                    if pat.search(text):
                        add("escapes-package", rel, why)
                        break
    return violations, identity


def check(root, mode, surface):
    """Backward-compatible violation-only API for existing callers."""
    return check_with_identity(root, mode, surface)[0]


def main(argv=None):
    ap = argparse.ArgumentParser(description="Pre-install package-tree check")
    ap.add_argument("root")
    ap.add_argument("--mode", choices=[SOURCE, INSTALLED])
    ap.add_argument("--surface")
    ap.add_argument("--identity-receipt", help="verify a package identity receipt against current bytes")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)

    root = os.path.abspath(a.root)
    if not os.path.isdir(root):
        print(f"[UNRUNNABLE] Not a directory: {root}", file=sys.stderr)
        return EXIT_UNRUNNABLE

    detected = detect_mode(root)
    mode = a.mode or detected
    # Reject a looser mode before producing check output that could be misused as evidence.
    if STRICTNESS[mode] < STRICTNESS[detected]:
        print(
            f"[UNRUNNABLE] Tree was detected as {detected}; "
            f"cannot select the looser mode {mode}",
            file=sys.stderr,
        )
        return EXIT_UNRUNNABLE

    spath, origin = find_surface(a.surface, root)
    surface = load_surface(spath) if spath else dict(FALLBACK_SURFACE)
    if not surface:
        print(f"[UNRUNNABLE] Surface definition is empty: {origin}", file=sys.stderr)
        return EXIT_UNRUNNABLE

    violations, identity = check_with_identity(root, mode, surface)
    if a.identity_receipt:
        ok, problems = verify_receipt(root, a.identity_receipt)
        if not ok:
            for problem in problems:
                violations.append({"kind": "identity-receipt", "path": a.identity_receipt, "detail": problem})

    if a.json:
        print(
            json.dumps(
                {
                    "root": root,
                    "mode": mode,
                    "detected": detected,
                    "surface": origin,
                    "identity": identity,
                    "violations": violations,
                },
                ensure_ascii=False,
                indent=1,
            )
        )
    else:
        print(f"preflight {mode} (detected {detected}) · surface {origin}")
        if identity is not None:
            print(f"identity {identity['package'].get('name')} · tree {identity['digests']['tree']}")
        for v in violations:
            print(
                f"[FAIL] {v['kind']}: {v['path']}"
                + (f" — {v['detail']}" if v["detail"] else "")
            )
        print(f"{len(violations)} violations")
    return EXIT_VIOLATIONS if violations else EXIT_CLEAN


if __name__ == "__main__":
    sys.exit(main())
