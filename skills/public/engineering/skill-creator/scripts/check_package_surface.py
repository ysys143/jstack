#!/usr/bin/env python3
"""Enforce package membership declared in references/package-surface.yaml.

## Why a declaration alone is insufficient

A declaration quickly drifts from the tree, leaving an illusion of known
membership without blocking anything. Introduce its executor in the same
commit and stop when even one file is unclassified.

## Three nonzero-exit conditions

1. Zero unclassified files: one file matching no category fails closed. A new
   placement defaults to red until a category and its rationale are declared.
2. No pattern covers half the surface: a catch-all ** makes unclassified counts
   permanently zero, eliminating the first check. Block that tautological
   bypass using policy.max_share_per_pattern as the threshold.
3. Zero dead globs: a pattern matching nothing is residue rather than a fact
   about the surface. A deleted directory's surviving pattern misleads future
   readers about what belongs to the package.

The first matching category in declaration order wins. Put narrow categories
first.

    python3 scripts/check_package_surface.py              # this plugin
    python3 scripts/check_package_surface.py --root DIR --surface FILE
"""
import argparse
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_SURFACE = os.path.join(os.path.dirname(HERE), "references",
                               "package-surface.yaml")
DEFAULT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))


def glob_to_regex(pat):
    """Translate globs so only `**` crosses directory boundaries.

    `fnmatch` lets `*` cross `/`, so skills/*/SKILL.md also matches
    skills/a/b/SKILL.md, weakening the category boundary.
    """
    out, i = ["^"], 0
    while i < len(pat):
        if pat.startswith("**/", i):
            out.append("(?:[^/]+/)*")
            i += 3
        elif pat.startswith("**", i):
            out.append(".*")
            i += 2
        elif pat[i] == "*":
            out.append("[^/]*")
            i += 1
        elif pat[i] == "?":
            out.append("[^/]")
            i += 1
        else:
            out.append(re.escape(pat[i]))
            i += 1
    out.append("$")
    return re.compile("".join(out))


def load_surface(path):
    """Load the surface; missing PyYAML is unexecutable, not a pass."""
    with open(path, encoding="utf-8") as f:
        text = f.read()
    if not text.strip():
        raise ValueError("surface declaration is empty")
    import yaml
    data = yaml.safe_load(text)
    if not isinstance(data, dict):
        raise ValueError("surface declaration root is not a mapping")
    return data


def walk_surface(root, ignore_res):
    files = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if d != ".git")
        for n in sorted(filenames):
            rel = os.path.relpath(os.path.join(dirpath, n), root)
            rel = rel.replace(os.sep, "/")
            if any(r.match(rel) for r in ignore_res):
                continue
            files.append(rel)
    return sorted(files)


def classify(files, categories):
    """Classify by first match; return pattern counts and unclassified paths."""
    compiled = [(cat, p, glob_to_regex(p)) for cat, pats in categories for p in pats]
    owned = {(cat, p): 0 for cat, p, _ in compiled}
    unclassified = []
    for rel in files:
        for cat, p, rx in compiled:
            if rx.match(rel):
                owned[(cat, p)] += 1
                break
        else:
            unclassified.append(rel)
    return owned, unclassified


def main(argv=None):
    ap = argparse.ArgumentParser(description="Check package surface membership with fail-closed behavior")
    ap.add_argument("--root", default=DEFAULT_ROOT, help="plugin root")
    ap.add_argument("--surface", default=DEFAULT_SURFACE, help="surface declaration YAML")
    ap.add_argument("--quiet", action="store_true", help="suppress the summary on success")
    args = ap.parse_args(argv)

    if not os.path.isfile(args.surface):
        print(f"surface declaration does not exist: {args.surface}", file=sys.stderr)
        return 2
    if not os.path.isdir(args.root):
        print(f"plugin root does not exist: {args.root}", file=sys.stderr)
        return 2
    try:
        data = load_surface(args.surface)
    except Exception as exc:
        print(f"could not read surface declaration: {exc}", file=sys.stderr)
        return 2

    policy = data.get("policy") or {}
    cats = data.get("categories") or {}
    if not cats:
        print("categories is empty; the declaration declares nothing",
              file=sys.stderr)
        return 2
    if str(policy.get("unclassified", "")).lower() != "fail":
        print("policy.unclassified is not fail; closed behavior is disabled",
              file=sys.stderr)
        return 2
    try:
        max_share = float(policy.get("max_share_per_pattern", 0.5))
    except (TypeError, ValueError):
        print("policy.max_share_per_pattern is not numeric", file=sys.stderr)
        return 2
    if not 0 < max_share <= 1:
        print(f"policy.max_share_per_pattern is outside (0, 1]: {max_share}",
              file=sys.stderr)
        return 2

    ignore_res = [glob_to_regex(p) for p in (data.get("ignore") or [])]
    categories = [(k, list(v or [])) for k, v in cats.items()]
    files = walk_surface(args.root, ignore_res)
    if not files:
        print(f"surface contains no files: {args.root}", file=sys.stderr)
        return 2
    owned, unclassified = classify(files, categories)

    rc, total = 0, len(files)
    if unclassified:
        rc = 1
        print(f"{len(unclassified)} unclassified / {total} surface files; "
              "not in any category:", file=sys.stderr)
        for rel in unclassified:
            print(f"  {rel}", file=sys.stderr)

    hogs = [(cat, p, n) for (cat, p), n in owned.items() if n >= max_share * total]
    if hogs:
        rc = 1
        print(f"{len(hogs)} overbroad patterns; a pattern covers at least {max_share:.0%} of the surface, "
              "which defeats the unclassified check:", file=sys.stderr)
        for cat, p, n in sorted(hogs, key=lambda x: -x[2]):
            print(f"  {cat}: {p} -> {n}/{total} ({n / total:.0%})", file=sys.stderr)

    dead = sorted((cat, p) for (cat, p), n in owned.items() if n == 0)
    if dead:
        rc = 1
        print(f"{len(dead)} dead globs; no files matched:", file=sys.stderr)
        for cat, p in dead:
            print(f"  {cat}: {p}", file=sys.stderr)

    if rc == 0 and not args.quiet:
        print(f"{total} surface files · {len(categories)} categories · 0 unclassified · "
              f"largest pattern {max(owned.values()) / total:.0%} (limit {max_share:.0%})")
        for cat, pats in categories:
            print(f"  {cat}: {sum(owned[(cat, p)] for p in pats)}")
    return rc


if __name__ == "__main__":
    sys.exit(main())
