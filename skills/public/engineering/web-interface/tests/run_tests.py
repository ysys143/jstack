#!/usr/bin/env python3
"""ui regression suite.

Usage: python3 tests/run_tests.py   (from skills/ui)

The rules preserve the **upstream source** (Vercel Web Interface Guidelines, MIT; see `NOTICE`).
Our single change replaced fetching with vendoring, so that is the behavior to lock.

  (1) Import integrity: `UPSTREAM.sha256` matches the bytes
  (2) Rules survive: all sections, 103 rules, and the anti-pattern section
  (3) **Vendoring has not reverted to fetching.** The skill does not instruct the
      agent to download rules. A reversion breaks offline use and leaves the contract
      with nothing to measure; because it takes one line, this axis is required.
"""
import hashlib
import io
import os
import re
import sys

sys.dont_write_bytecode = True
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
from _suite_lib import (check_skill_body, check_ref_contracts,  # noqa: E402
                        check_no_constant_assertions, check_contract_coverage,
                        check_body_deletion, check_total, check_body_paths,
                        split_frontmatter, read_ref)

GUIDE = os.path.join(ROOT, "references", "web-interface-guidelines.md")

#: Upstream-authored sections. Removing one silently removes its rules.
SECTIONS = (
    "Accessibility", "Focus States", "Forms", "Animation", "Typography",
    "Content Handling", "Images", "Performance", "Navigation & State",
    "Touch & Interaction", "Safe Areas & Layout", "Dark Mode & Theming",
    "Locale & i18n", "Hydration Safety", "Hover & Interactive States",
    "Content & Copy", "Anti-patterns (flag these)",
)

results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))


def read(p):
    return io.open(p, encoding="utf-8", errors="replace").read()


def main():
    # ---- (1) Import integrity --------------------------------------------------
    rows = [ln.split(None, 1) for ln in read(os.path.join(ROOT, "UPSTREAM.sha256")).splitlines()
            if ln.strip() and not ln.startswith("#")]
    check("import: manifest has one row", len(rows) == 1, f"{len(rows)} rows")
    ok_hash = False
    if rows:
        h, rel = rows[0][0], rows[0][1].strip()
        p = os.path.join(ROOT, rel)
        ok_hash = (os.path.isfile(p)
                   and hashlib.sha256(io.open(p, "rb").read()).hexdigest() == h)
    check("import: rule source matches the manifest hash", ok_hash)

    # ---- (2) Rules survive ----------------------------------------------
    g = read_ref(GUIDE) or ""
    missing = [s for s in SECTIONS if f"### {s}" not in g]
    check("rules: all 17 sections are present", not missing, f"missing {missing[:3]}")
    n = len(re.findall(r"(?m)^- ", g))
    check(f"rules: contains {RULE_COUNT} entries", n == RULE_COUNT, f"{n} entries")
    check("rules: anti-pattern section survives", "### Anti-patterns (flag these)" in g)
    check("rules: output-format section survives", "## Output Format" in g)

    # ---- (3) Vendoring did not revert to fetching -------------------------------------
    body_all = read(os.path.join(ROOT, "SKILL.md"))
    fetchy = re.findall(r"(?mi)^[^|>]*(?:WebFetch|fetch the (?:latest|fresh))[^\n]*", body_all)
    check("import: SKILL.md does not tell the agent to fetch rules",
          not fetchy, f"{fetchy[:2]}")
    check("import: rule source is a local file", os.path.isfile(GUIDE))
    # Keep the upstream URL as provenance; vendoring must not erase the source.
    notice = read_ref(os.path.join(ROOT, "NOTICE")) or ""
    for frag in ("vercel-labs/web-interface-guidelines", "e3d624b", "MIT"):
        check(f"provenance: NOTICE names '{frag}'", frag in notice)
    check("provenance: NOTICE gives three reasons for vendoring instead of fetching",
          notice.count("\n1. ") and notice.count("\n2. ") and notice.count("\n3. "))
    check("provenance: SKILL.md includes the upstream link",
          "https://github.com/vercel-labs/web-interface-guidelines" in body_all)
    # Adversarial validation found four defects. The next three concern counts and
    # direction rather than sentences, so needles cannot enforce them.
    #
    # 1. The advertised rule count could drift from the files silently; changing 103
    #    to 100 kept all eight axes green, letting documentation misstate reality.
    # 2. The fetch guard matched only `WebFetch` and `fetch the latest|fresh`, missing
    #    "Ours fetches it too." Reverting our only upstream change is the largest
    #    regression for this skill, yet the sentence was unbound.
    claimed = re.findall(r"(?m)^(\d+) rules across", body_all)
    check("import: the rule count claimed by SKILL.md matches the files",
          claimed and int(claimed[0]) == RULE_COUNT,
          f"document {claimed} / files {RULE_COUNT}")
    check("import: SKILL.md says to read the local file rather than fetch",
          "Ours reads a file." in body_all,
          "evidence that vendoring reverted to fetching")

    # ---- Standard axes -----------------------------------------------------------
    fm, body = split_frontmatter(body_all)
    check_body_paths(check, ROOT, body, fm_of_skill=fm)
    check_skill_body(check, ROOT, needles=[
        "The rules are not ours.",
        "**What we changed is one thing: we vendored them.**",
        "**Do not\nparaphrase it from memory**",
        "a review that says \"no findings\" means a person or a model\n  read the files",
        # Adversarial validation found that a needle in the following sentence left the
        # preceding claim mutable. Bind the sentence rather than the paragraph.
        "**No machine checks this.**",
        # Downgrading anti-patterns to preferences makes findings negotiable.
        "these are findings, not preferences",
        # Removing the boundary applies web-platform rules to React Native code.
        "React Native is out of scope.",
    ], floor=SKILL_FLOOR)
    check_ref_contracts(check, ROOT, [
        ("web-interface-guidelines.md", "upstream rule source (vendored unaltered)",
         ["Icon-only buttons need `aria-label`",
          "### Anti-patterns (flag these)",
          "## Output Format"], GUIDE_FLOOR),
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


# Measured value.
# Re-pinned after adding three needles (2098 -> 2073). `content_bytes` excludes
# the needles themselves, preventing a shell containing only needles from satisfying
# the floor. The document did not shrink; the metric changed. This is remeasurement.
SKILL_FLOOR = 2073
GUIDE_FLOOR = 6147
BODY_MIN = 16
TOTAL = 41
RULE_COUNT = 103
PER_FILE = {"SKILL.md": 16, "NOTICE": 4, "UPSTREAM.sha256": 2,
            "references/web-interface-guidelines.md": 8}

if __name__ == "__main__":
    sys.exit(main())
