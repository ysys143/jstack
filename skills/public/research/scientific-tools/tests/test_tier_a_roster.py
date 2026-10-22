#!/usr/bin/env python3
"""Bind the tier-A roster to **real files** (density ledger G-1 · G-20, integration-6).

The roster table in `references/tier-a-verdicts.md` is authoritative. This checker
parses it and compares it with three sources.

1. **`repos/` files** — Does every referenced SKILL.md exist? A keep/drop
   decision for a missing skill is not a decision.
2. **`references/_sources.json`** — Is the source tag a real repository, and is
   the path below that tag? A mismatch makes license attribution false.
3. **`references/analysis-methodology.md`** — Are all 12 promotion candidates
   in the roster? If one is missing, it remains listed without a decision.

**This is fail-closed.** Failure to read the table is a failure, not a pass.
Parsing zero rows and having every decision correct must produce different output.

`tests/run_tests.py` calls `run(check, root)`. The checker can also run standalone.
"""
import json
import os
import re
import sys

sys.dont_write_bytecode = True

# One roster-table row. All six cells are required.
ROW = re.compile(
    r"^\|\s*`([a-z0-9_-]+)`\s*\|\s*`([a-z]+)`\s*\|\s*`(repos/[^`]+/SKILL\.md)`\s*"
    r"\|\s*(존치|배제)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*$",
    re.M,
)
# An entry line from `analysis-methodology.md`. The suite locks the catalog format separately.
ENTRY = re.compile(r"^- \*\*([a-z0-9_-]+)\*\* \(`([a-z]+)`\)", re.M)
# Skill names marked "이 저장소" in the replacement cell.
IN_TREE = re.compile(r"`([a-z][a-z-]+)`\(이 저장소\)")

# Five skills excluded for direct overlap with ours; the integration-6 (e) list.
DUPLICATES = (
    "literature-review",
    "peer-review",
    "scientific-brainstorming",
    "scientific-visualization",
    "scientific-writing",
)
ROSTER_SIZE = 16        # tier A: 15 skills + one pipeline literature-search skill
KEEP_MIN, KEEP_MAX = 5, 6

# **Authoritative decisions — one value per row.**
#
# The previous version measured `존치`/`배제` **only by count** (5–6 kept;
# five duplicates excluded). Swapping six keep and six drop rows preserved both
# counts and duplicate decisions, so the suite stayed silent while ten decisions
# flipped. Counts are not decisions; pin a value for every name.
VERDICTS = {
    "experimental-design": "존치",
    "statistical-power": "존치",
    "statistical-analysis": "존치",
    "scientific-critical-thinking": "존치",
    "hypothesis-generation": "존치",
    "literature_search_openalex": "존치",
    "exploratory-data-analysis": "배제",
    "hypogenic": "배제",
    "literature-review": "배제",
    "peer-review": "배제",
    "scientific-brainstorming": "배제",
    "scientific-visualization": "배제",
    "scientific-writing": "배제",
    "citation-management": "배제",
    "venue-templates": "배제",
    "market-research-reports": "배제",
}

# **Replacements** for the five duplicates. If only exclusion is checked, any
# skill can fill the slot; an incorrect replacement makes exclusion useless.
REPLACEMENTS = {
    "literature-review": "`research`(이 저장소)",
    "peer-review": "`proposal-review`(플러그인 밖)",
    "scientific-brainstorming": "`consult`(이 저장소)",
    "scientific-visualization": "`dataviz`(내장)",
    "scientific-writing": "`sciwrite`(플러그인 밖)",
}


def _read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


#: Every decision label emitted by this checker. **Prevent early returns and
#: exceptions from making labels disappear.**
#:
#: The previous version returned when the decision document was missing or the
#: table could not be read. The remaining 18 labels then **vanished** rather than
#: failing, indistinguishable from green by failure count (measured: 121 -> 103
#: after emptying a copy of `tier-a-verdicts.md`). It also **died** on a copy when
#: reading `_sources.json` with bare `json.loads`.
#:
#: This repository has already prescribed three fixes for the same disease:
#: `read_ref` (missing reference), `SKIPPED_AXES` (missing tool), and `section`
#: (missing output). One rule applies: **absence is a decision, not an exception.
#: Do not die; record the missing axis, fail it, and finish.**
AXES = (
    "tier A: roster table was read",
    f"tier A: roster has {ROSTER_SIZE} rows (15 skills + one literature search)",
    "tier A: roster has no duplicate skills",
    "tier A: source tags exist in _sources.json",
    "tier A: paths are below their declared source (license attribution)",
    "tier A: every decided skill has a real SKILL.md",
    "tier A: analysis-methodology entries were read",
    "tier A: all 12 analysis-methodology skills are in the roster",
    f"tier A: kept count is {KEEP_MIN}~{KEEP_MAX}",
    "tier A: decisions match the authoritative list row by row",
    "tier A: no rows exist outside the authoritative list",
    "tier A: replacements for five duplicates match the authority",
    "tier A: summary kept/excluded counts match the table",
    "tier A: five direct-overlap exclusions match the list",
    "tier A: budget accounting numbers match the table",
    "tier A: all five duplicates are excluded",
    "tier A: every exclusion row has a replacement and reason",
    "tier A: in-tree replacement skills exist",
    "tier A: kept statistical-analysis requires the correction document",
)


def run(check, root):
    """Emit every `AXES` label, recording missing labels as failures."""
    _seen = []

    def _c(label, ok, detail=""):
        _seen.append(label)
        check(label, ok, detail)

    try:
        _run(_c, root)
    except Exception as e:                       # noqa: BLE001 — keep running
        _why = f"{type(e).__name__}: {e}"[:120]
    else:
        _why = "execution ended early"
    for _n in AXES:
        if _n not in _seen:
            check(_n, False, _why)


def _run(check, root):
    refs = os.path.join(root, "references")
    verdicts_path = os.path.join(refs, "tier-a-verdicts.md")
    if not os.path.isfile(verdicts_path):
        check("tier A: decision document exists", False, "references/tier-a-verdicts.md missing")
        return
    text = _read(verdicts_path)
    rows = ROW.findall(text)

    # A parse failure is not a pass; otherwise checks below can all be true on an empty list.
    check("tier A: roster table was read", len(rows) >= 15, f"{len(rows)} rows")
    if not rows:
        return
    check(f"tier A: roster has {ROSTER_SIZE} rows (15 skills + one literature search)",
          len(rows) == ROSTER_SIZE, f"{len(rows)} rows")

    names = [r[0] for r in rows]
    dup = sorted({n for n in names if names.count(n) > 1})
    check("tier A: roster has no duplicate skills", not dup, f"{dup}")

    # (1) Source tags — _sources.json is authoritative.
    # An empty file becomes an empty authority; the check below reports that.
    _raw = _read(os.path.join(refs, "_sources.json")).strip()
    src = json.loads(_raw) if _raw else {}
    bad_tag = sorted({t for _, t, _, _, _, _ in rows if t not in src})
    check("tier A: source tags exist in _sources.json", not bad_tag, f"{bad_tag}")
    mis = [f"{n}: {t} != {p}" for n, t, p, _, _, _ in rows
           if not p.startswith(f"repos/{t}/")]
    check("tier A: paths are below their declared source (license attribution)", not mis, f"{mis[:3]}")

    # (2) repos/ files — a decision for a missing skill is not a decision.
    dead = [f"{n}: {p}" for n, _, p, _, _, _ in rows
            if not os.path.isfile(os.path.join(root, p))]
    check("tier A: every decided skill has a real SKILL.md", not dead, f"{dead[:3]}")

    # (3) Did all 12 promotion candidates receive decisions?
    meth = os.path.join(refs, "analysis-methodology.md")
    listed = [n for n, _ in ENTRY.findall(_read(meth))] if os.path.isfile(meth) else []
    check("tier A: analysis-methodology entries were read", len(listed) >= 10, f"{len(listed)} entries")
    unjudged = sorted(set(listed) - set(names))
    check("tier A: all 12 analysis-methodology skills are in the roster",
          bool(listed) and not unjudged, f"undecided {unjudged}")

    keep = [r for r in rows if r[3] == "존치"]
    drop = [r for r in rows if r[3] == "배제"]
    check(f"tier A: kept count is {KEEP_MIN}~{KEEP_MAX}",
          KEEP_MIN <= len(keep) <= KEEP_MAX, f"kept {len(keep)} / excluded {len(drop)}")

    # **Row-value correspondence.** Check each name's value, not just counts.
    verdict_all = {n: v for n, _, _, v, _, _ in rows}
    flipped = sorted(f"{n}: {verdict_all.get(n, '없음')}!={v}"
                     for n, v in VERDICTS.items() if verdict_all.get(n) != v)
    check("tier A: decisions match the authoritative list row by row", not flipped, f"{flipped[:4]}")
    extra = sorted(set(verdict_all) - set(VERDICTS))
    check("tier A: no rows exist outside the authoritative list", not extra, f"{extra}")

    # What fills an excluded slot? A wrong destination makes exclusion unusable.
    alt_of = {n: alt for n, _, _, _, alt, _ in rows}
    bad_alt = sorted(f"{n}: {alt_of.get(n, '없음')!r}"
                     for n, want in REPLACEMENTS.items() if alt_of.get(n) != want)
    check("tier A: replacements for five duplicates match the authority", not bad_alt, f"{bad_alt[:3]}")

    # Declaration versus measurement. Flipping the table while keeping its summary contradicts the document.
    decl = re.search(r"\*\*존치 (\d+) · 배제 (\d+)\.\*\*", text)
    check("tier A: summary kept/excluded counts match the table",
          bool(decl) and (int(decl.group(1)), int(decl.group(2)))
          == (len(keep), len(drop)),
          f"declared {decl.groups() if decl else 'missing'} / measured ({len(keep)}, {len(drop)})")

    # The "direct overlap" cell in the exclusion-reason table versus DUPLICATES.
    dupe_row = re.search(r"\|\s*\*\*정면 중복\*\*\s*\|\s*(.+?)\s*\|", text)
    listed_dup = sorted(re.findall(r"`([a-z-]+)`", dupe_row.group(1))) if dupe_row else []
    check("tier A: five direct-overlap exclusions match the list",
          listed_dup == sorted(DUPLICATES), f"{listed_dup}")

    # Budget accounting block versus measurement. Changing the table while keeping numbers makes the accounting false.
    budget = re.search(r"tier A (\d+)종\s*->\s*존치 (\d+)종\s+(\d+) 슬롯 반환", text)
    check("tier A: budget accounting numbers match the table",
          bool(budget)
          and int(budget.group(1)) == ROSTER_SIZE - 1
          and int(budget.group(2)) == len(keep) - 1
          and int(budget.group(3)) == len(drop),
          f"{budget.groups() if budget else 'block missing'} / measured "
          f"({ROSTER_SIZE - 1}, {len(keep) - 1}, {len(drop)})")

    # The five duplicates cannot be kept; integration-6 forbids two copies in the same layer.
    verdict_of = {n: v for n, _, _, v, _, _ in rows}
    kept_dup = [n for n in DUPLICATES if verdict_of.get(n) != "배제"]
    check("tier A: all five duplicates are excluded",
          not kept_dup, f"not excluded {kept_dup}")

    # Each exclusion has a reason and replacement. An empty cell is omission, not a decision.
    thin = [n for n, _, _, _, alt, why in drop
            if len(why) < 10 or not alt or alt == "—"]
    check("tier A: every exclusion row has a replacement and reason", not thin, f"{thin[:3]}")

    # A skill marked "이 저장소" as replacement must actually exist.
    plugin_root = os.path.dirname(os.path.dirname(root))
    named = sorted({m for _, _, _, _, alt, _ in rows for m in IN_TREE.findall(alt)})
    absent = [s for s in named
              if not os.path.isdir(os.path.join(plugin_root, "skills", s))]
    check("tier A: in-tree replacement skills exist",
          bool(named) and not absent, f"missing {absent}" if absent else f"{named}")

    # Kept statistical-analysis is conditional; the correction document must come first.
    sa = [r for r in rows if r[0] == "statistical-analysis"]
    check("tier A: kept statistical-analysis requires the correction document",
          bool(sa) and sa[0][3] == "존치" and "stats-corrections.md" in sa[0][5],
          f"{sa[0][5][:40] if sa else 'row missing'}")


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out = []

    def check(name, ok, detail=""):
        out.append(ok)
        print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))

    run(check, root)
    print(f"\n{sum(out)}/{len(out)} passed")
    return 0 if all(out) and out else 1


if __name__ == "__main__":
    sys.exit(main())
