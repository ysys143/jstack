#!/usr/bin/env python3
"""Agent contract suite (work layer).

Usage: python3 tests/test_agents.py (from the staged work package).

## What this locks

An agent description is **L0**: it is always read and sends the model to the path
it names. This tree had no agent contract, and meanwhile the description for
`korean-procurement-detector` pointed to a **missing `taxonomy.md`**. In ablation,
the model actually searched for that name and failed.

1. **Do named files exist?** — This is why the suite exists.
2. **Is the inventory correct?** — 9 agents.
3. **Format** — name matches the filename and a description exists.
"""
import os
import re
import sys

sys.dont_write_bytecode = True
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "skills"))
from _suite_lib import (check_no_constant_assertions, check_total,
                        split_frontmatter)  # noqa: E402
AG = os.path.join(ROOT, "agents")
WANT = (
    "ai-tell-detector", "content-fidelity-auditor", "korean-ai-tell-taxonomist",
    "korean-procurement-detector", "korean-procurement-fidelity-auditor",
    "korean-procurement-naturalness-reviewer", "korean-procurement-rewriter",
    "korean-style-rewriter", "naturalness-reviewer",
)

results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))


def read(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


def main():
    all_names = sorted(f[:-3] for f in os.listdir(AG) if f.endswith(".md"))
    check("Inventory: the unified agent count is 17", len(all_names) == 17, f"{len(all_names)}")
    names = sorted(WANT)

    for n in names:
        raw = read(os.path.join(AG, n + ".md"))
        fm, body = split_frontmatter(raw)
        check(f"Format: {n} name matches its filename",
              bool(re.search(rf"(?m)^name:\s*{re.escape(n)}\s*$", fm)))
        check(f"Format: {n} has a description",
              bool(re.search(r"(?m)^description:\s*\S", fm)))
        check(f"Body: {n} contains procedure or judgment", len(body.strip()) > 400,
              f"{len(body.strip())}B")

        # **Do referenced files exist?** Descriptions are L0 and always read; the
        # model follows their paths. A missing name makes the search fail with
        # "cannot access" (observed in ablation).
        refs = set(re.findall(
            r"\$\{CLAUDE_PLUGIN_ROOT\}/([A-Za-z0-9_./-]+\.[a-z]+)", raw))
        missing = sorted(r for r in refs if not os.path.exists(os.path.join(ROOT, r)))
        check(f"References: all plugin paths named by {n} exist",
              not missing, f"missing {missing}")

        # A filename without a path prefix makes the model search aimlessly.
        # `\w` is Unicode, so the Korean possessive particle in `taxonomy.md의`
        # counts as a word character and satisfies the negative lookahead; use ASCII.
        bare = set(re.findall(r"(?<![-A-Za-z0-9_/])([a-z][a-z0-9_-]*\.md)"
                              r"(?![A-Za-z0-9_/])", raw))
        bare -= {os.path.basename(r) for r in refs}
        bare = {b for b in bare if b != n + ".md"}
        check(f"References: {n} has no pathless filename citations", not bare, f"{sorted(bare)}")

    check_no_constant_assertions(check, __file__)
    check_total(check, results, 48)

    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n{passed}/{len(results)} 통과")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
