#!/usr/bin/env python3
"""Compare the package version with the first version in CHANGELOG.

The cache uses version numbers. Editing files without bumping the version can
leave users on stale bytes. This check therefore requires the first released
CHANGELOG version to equal `plugin.json`'s `version`. A version-only update has
no record of what changed; a CHANGELOG-only update does not invalidate caches.

This is a local contract, not an upstream port. It adopts only a package unit
and manifest-selection concept reviewed in pinned Skillstead material. It
implements first-entry comparison and root-CHANGELOG membership without copied
upstream code or license text. Codex `.codex-plugin/plugin.json` follows the
same contract.

Usage:
    package_check.py <package-root> [--root-changelog PATH] [--json]

Exit codes:
    0  match
    1  mismatch or missing required data
    2  unexecutable: missing path or invalid plugin.json
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys

from package_identity import IdentityError, compute_identity, verify_receipt

EXIT_MATCH, EXIT_MISMATCH, EXIT_UNRUNNABLE = 0, 1, 2

# `## [1.2.3] - 2026-01-01` · `## 1.2.3` · `## v1.2.3` · `# 1.2.3 (date)`
VERSION_HEADING = re.compile(
    r"^#{1,3}\s*\[?v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\]?")


def load_manifest(root):
    """Return `(path, dict)` or `(None, reason)`."""
    for rel in (os.path.join(".claude-plugin", "plugin.json"),
                os.path.join(".codex-plugin", "plugin.json"), "plugin.json",
                os.path.join(".claude-plugin", "marketplace.json")):
        p = os.path.join(root, rel)
        if os.path.isfile(p):
            try:
                with open(p, encoding="utf-8") as f:
                    return p, json.load(f)
            except ValueError as e:
                return None, f"{rel} parse failed: {e}"
    return None, "plugin.json is missing"


def top_version(changelog_path):
    """Return the first version heading, skipping non-version `[Unreleased]`."""
    with open(changelog_path, encoding="utf-8") as f:
        for line in f:
            if re.match(r"^#{1,3}\s*\[?Unreleased\]?", line, re.I):
                continue
            m = VERSION_HEADING.match(line)
            if m:
                return m.group(1)
    return None


def root_row(root_changelog, name, version):
    """Return whether root CHANGELOG has name and version on the same row."""
    with open(root_changelog, encoding="utf-8") as f:
        for line in f:
            if name in line and version in line:
                return True
    return False


def check(root, root_changelog=None):
    """Return `(problems, facts)`; an empty problem list passes."""
    problems, facts = [], {}

    try:
        identity = compute_identity(root)
        facts["identity"] = identity
    except IdentityError as exc:
        identity = None
        problems.append(f"cannot compute package identity: {exc}")

    mpath, manifest = load_manifest(root)
    if mpath is None:
        return None, {"error": manifest}
    facts["manifest"] = os.path.relpath(mpath, root)

    version = manifest.get("version")
    name = manifest.get("name")
    facts["name"], facts["version"] = name, version
    if not version:
        problems.append("plugin.json has no version")
    if not name:
        problems.append("plugin.json has no name")

    cpath = os.path.join(root, "CHANGELOG.md")
    if not os.path.isfile(cpath):
        # Missing evidence is not a pass.
        problems.append("CHANGELOG.md is missing; the version has no recorded meaning")
        return problems, facts

    top = top_version(cpath)
    facts["changelog_top"] = top
    if top is None:
        problems.append("no version heading found at the top of CHANGELOG.md")
    elif version and top != version:
        problems.append(
            f"mismatch: first CHANGELOG version {top} vs plugin.json {version}")

    if root_changelog:
        facts["root_changelog"] = root_changelog
        if not os.path.isfile(root_changelog):
            problems.append(f"root CHANGELOG is missing: {root_changelog}")
        elif name and version and not root_row(root_changelog, name, version):
            problems.append(
                f"root CHANGELOG has no ({name}, {version}) row")
    return problems, facts


def main(argv=None):
    ap = argparse.ArgumentParser(description="Compare CHANGELOG with package version")
    ap.add_argument("root")
    ap.add_argument("--root-changelog")
    ap.add_argument("--identity-receipt", help="compare identity receipt with current package bytes")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)

    root = os.path.abspath(a.root)
    if not os.path.isdir(root):
        print(f"[UNRUNNABLE] Not a directory: {root}", file=sys.stderr)
        return EXIT_UNRUNNABLE

    problems, facts = check(root, a.root_changelog)
    if problems is None:
        print(f"[UNRUNNABLE] {facts['error']}", file=sys.stderr)
        return EXIT_UNRUNNABLE
    if a.identity_receipt:
        ok, receipt_problems = verify_receipt(root, a.identity_receipt)
        if not ok:
            problems.extend(receipt_problems)

    if a.json:
        print(json.dumps({"root": root, "facts": facts, "problems": problems},
                         ensure_ascii=False, indent=1))
    else:
        print(f"package_check {facts.get('name')} {facts.get('version')} "
              f"· first CHANGELOG version {facts.get('changelog_top')}")
        for p in problems:
            print(f"[FAIL] {p}")
        print(f"{len(problems)} problems")
    return EXIT_MISMATCH if problems else EXIT_MATCH


if __name__ == "__main__":
    sys.exit(main())
