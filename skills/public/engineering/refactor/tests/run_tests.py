#!/usr/bin/env python3
"""cleanup contract suite.

Run: python3 tests/run_tests.py   (from skills/cleanup)

## What this locks

1. **Behaviour lock comes first** — a cleanup that changes behaviour is an
   undocumented change riding inside one. Without this the skill becomes
   "refactor freely".
2. **Axis 6 before axis 5** — consolidating a swallowing fallback promotes the
   defect to every caller. This ordering is the one non-obvious rule here.
3. **The taxonomy is canonical here** — audit reads this copy. If the file thins
   out, both skills lose their axes at once.
4. **Axis 8 is a closed list** — without it, slop becomes a euphemism for taste.
5. **No slop finding without an adjudicator** — a closed list is insufficient;
   `slop-criteria.md` must say how each row is decided.
6. **Axes depend on language** — cycles have an empty set in Go and Rust, while
   swallowed failure reverses in Python. The matrix distinguishes no findings
   from no detector for that language.
7. **The output cap is a script, not a memory** — cleanup scans everything and
   has no natural output bound. `cap_findings.py` is tested through behavior.
"""

import json
import os
import re
import subprocess
import sys

sys.dont_write_bytecode = True
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
from _suite_lib import (  # noqa: E402
    check_no_constant_assertions,
    check_total,
    check_skill_body,
    check_ref_contracts,
    split_frontmatter,
    check_body_deletion,
    check_contract_coverage,
    check_script_contracts,
)

ROOT = os.path.dirname(HERE)
SKILLS = os.path.dirname(ROOT)
CAP_SCRIPT = os.path.join(ROOT, "scripts", "cap_findings.py")

# Every reference SKILL.md must cite. Zero orphaned files is the contract.
REFS = (
    "references/quality-taxonomy.md",
    "references/slop-criteria.md",
    "references/lang-matrix.md",
    "references/wave-protocol.md",
)

results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))


# Relative paths of missing references, collected for explicit verdicts.
MISSING = []


def read(p):
    """Read references fail-closed: absence is a verdict, not an exception.

    The earlier version called `open()` directly. Removing one reference raised
    `FileNotFoundError`, suppressed the summary, and left only earlier `[PASS]`
    lines. A collector counting `^[FAIL]` then saw zero failures; this was reproduced
    by deleting `references/slop-criteria.md` from a copy.

    Returning an empty string makes every needle for that file fail, while the
    existence verdict below records the missing filename.
    """
    try:
        with open(p, encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        MISSING.append(os.path.relpath(p, ROOT).replace(os.sep, "/"))
        return ""


def run_cap(payload):
    """Execute `cap_findings.py` and measure behavior rather than prose.

    An emptied copy produces empty stdout, parsing returns None, and every dependent
    verdict fails. That is the behavior measured by `check_script_contracts`.
    """
    r = subprocess.run(
        [sys.executable, CAP_SCRIPT], input=payload, capture_output=True, text=True
    )
    try:
        parsed = json.loads(r.stdout)
    except ValueError:
        parsed = None
    return r.returncode, parsed


def section(text, head):
    """Return the section beneath `## head`, or an empty string when absent."""
    if head not in text:
        return ""
    return text.split(head, 1)[1].split("\n## ", 1)[0]


def main():
    fm, skill = split_frontmatter(read(os.path.join(ROOT, "SKILL.md")))
    tax = read(os.path.join(ROOT, "references", "quality-taxonomy.md"))
    slop = read(os.path.join(ROOT, "references", "slop-criteria.md"))
    lang = read(os.path.join(ROOT, "references", "lang-matrix.md"))
    wave = read(os.path.join(ROOT, "references", "wave-protocol.md"))
    cap_src = read(CAP_SCRIPT)

    # (0) Existence: a missing file is a verdict, not an exception.
    check("existence: every contracted file exists", not MISSING,
          f"missing {MISSING}; all contracts for these files fail")

    # (1) Behavior lock comes first.
    check("lock: requires locking behavior first", "Lock the behaviour first" in skill)
    check(
        "lock: states that changing behavior is not cleanup",
        "is not a cleanup" in skill,
    )
    check(
        "lock: gives clean-tree, observed-pass, and new-test conditions",
        "git status --short" in skill
        and "you saw them pass" in skill
        and "narrowest ones" in skill,
    )
    check("lock: says to stop when behavior cannot be locked", "say so and stop" in skill)
    check(
        "lock: explains the cost of cleanup without a behavior lock",
        "trades a\nknown mess for an unknown one" in skill
        or "known mess for an unknown one" in skill,
    )

    # (2) Axis 6 precedes axis 5.
    check("order: requires axis 6 before axis 5", "**Before DRY**" in skill)
    check(
        "order: explains promotion of the defect to a shared path",
        "promotes the defect to every caller" in skill,
    )
    check(
        "order: taxonomy carries the same priority",
        "comes before DRY" in tax and "reaches every caller" in tax,
    )
    order = re.findall(r"(?m)^\| \d \| ([^|]+?) \(axis (\d+)\)", skill)
    check(
        "order: pass table has five rows and an axis number on each",
        len(order) == 5 and all(a.strip() and b.isdigit() for a, b in order),
        f"{len(order)} rows {order}",
    )
    check(
        "order: requires one axis per pass",
        "Do not mix" in skill and "reverted by half" in skill,
    )
    check(
        "order: requires rerunning tests after each pass",
        "after each pass" in skill and "Not at the end" in skill,
    )

    # (3) The canonical taxonomy lives here and audit reads it.
    check(
        "SSOT: states that this skill owns the canonical taxonomy",
        "this\nskill holds it" in skill or "skill holds it" in skill,
    )
    check(
        "SSOT: states that audit keeps no copy",
        "keeps no copy" in skill and "zero\ncopies" in skill or "zero copies" in skill,
    )
    axes = re.findall(r"(?m)^\| (\d+) \|", section(tax, "## Axes"))
    check("SSOT: has ten axes", len(axes) == 10, f"{len(axes)} axes")
    check(
        "SSOT: says the count is not embedded in the name",
        "The count is not in the name" in tax,
    )
    check(
        "SSOT: explains the cost of embedding the count in the name",
        "forced a rename" in tax and "stale references" in tax,
    )
    for axis, why in ((9, "canonical-layer reuse"), (10, "serial orchestration")):
        check(
            f"SSOT: restored axis {axis} ({why}) exists",
            re.search(rf"(?m)^\| {axis} \|", tax) is not None,
        )
    check(
        "SSOT: defines axes by property rather than tool",
        "defined by the property, not the tool" in tax,
    )
    check(
        "SSOT: explains the cost of defining an axis by tool name",
        "hides the axis in languages where that tool does not exist" in tax,
    )

    # (4) Axis 8 is a closed list.
    check(
        "axis 8: reports only from the closed list", "only from the closed list" in tax
    )
    check(
        "axis 8: does not report items outside the list as slop",
        "Nothing outside this list is reported as slop" in tax,
    )
    check("axis 8: explains that an open list double-counts other axes", "double-count" in tax)
    closed = re.findall(
        r"(?m)^\| [A-Z].+\|.+\|$", section(tax, "## Axis 8 — the closed list")
    )
    check("axis 8: closed list has six items", len(closed) == 6, f"{len(closed)} items")
    check(
        "axis 8: SKILL.md also states the closed-list rule", "only from the closed list" in skill
    )

    # (5) Language validity: mark empty cells explicitly.
    check("language table: says an axis remains an axis without a detector", "is **still an axis**" in tax)
    check("language table: requires stating which case occurred", "Say which it was" in tax)
    check(
        "language table: requires marking an empty set explicitly",
        "An empty cell is written as empty" in tax,
    )
    check(
        "language table: explains why blank cells look unfinished",
        "not filled in yet" in tax,
    )

    # (6) Restraint: three conditions stop cleanup.
    check(
        "restraint: requires reverting a failed pass instead of patching forward",
        "revert that pass, do not patch forward" in skill,
    )
    check(
        "restraint: stops when work grows beyond the finding",
        "not license a module rewrite" in skill,
    )
    check(
        "restraint: deleting a test to get green is not cleanup",
        "Deleting a test to make a pass green is never a cleanup" in skill,
    )

    # (7) Scope is an argument.
    check(
        "scope: states that scope is an argument rather than a skill",
        "Scope is an argument, not a skill" in skill,
    )
    check("scope: defaults to diff", "Default is `--scope=diff`" in skill)
    check("scope: expresses deslop as an argument", "--axes=slop" in skill)

    # (8) Reporting: untouched areas are also results.
    check(
        "reporting: requires naming untouched areas and reasons",
        "what you left alone with\nthe reason" in skill or "left alone" in skill,
    )
    check(
        "reporting: explains that omission looks like a missed area",
        "assumes it was missed" in skill,
    )

    # (9) Boundaries and languages.
    named = set(re.findall(r"`([a-z][a-z-]{2,})`\s*skill", skill))
    missing = [n for n in named if not os.path.isdir(os.path.join(SKILLS, n))]
    check(
        "boundary: named-neighbor population is nonempty", len(named) >= 3, f"{sorted(named)}"
    )
    check("boundary: every named neighbor exists", not missing, f"missing {missing}")
    check(
        "language: description contains Korean triggers",
        len(re.findall(r"[가-힣]+", fm)) >= 5,
    )
    check("language: description also contains English triggers", "cleanup" in fm and "deslop" in fm)

    # (10) Reference map: SKILL.md cites all four references.
    for ref in REFS:
        check(
            f"reference map: SKILL.md cites {os.path.basename(ref)}", ref in skill
        )
    check(
        "reference map: table states what each reference answers",
        "## Reference map" in skill and "Answers" in skill,
    )
    check(
        "reference map: body points to the cap script",
        "scripts/cap_findings.py" in skill and "Show N of M" in skill,
    )

    # (11) Axis 8 adjudicators: a closed list alone is insufficient.
    check(
        "adjudicator: forbids findings without an adjudicator",
        "No adjudicator, no finding." in slop,
    )
    check(
        "adjudicator: does not report outside the table under axis 8",
        "Nothing outside this table is reported under axis 8" in slop,
    )
    # Measure adjudicator content per row. A row count alone accepts empty cells.
    adjudicated = re.findall(
        r"(?m)^\| (S\d) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|$", slop
    )
    ids = [r[0] for r in adjudicated]
    thin_adj = [r[0] for r in adjudicated if len(r[2].strip()) < 60]
    check(
        "adjudicator: closed list is S1-S5 and each row gives a procedure",
        ids == ["S1", "S2", "S3", "S4", "S5"] and not thin_adj,
        f"{ids}" + (f"; thin adjudicators {thin_adj}" if thin_adj else ""),
    )
    check(
        "adjudicator: records rejected candidates and reasons",
        "Restatement of another axis" in slop and "No adjudicator. The reader" in slop,
    )
    check("adjudicator: marks the row redirected to axis 5", "report as 5, not 8" in slop)
    check(
        "adjudicator: states that overproduction alone has no language detector",
        "with no\ndetector in any language" in slop
        or "no detector in any language" in slop,
    )

    # (12) Language matrix: axes depend on language (A-8, A-9, A-10).
    check(
        "matrix: explains why properties take precedence over tools",
        "a property survives a language change" in lang,
    )
    props = [
        "duplication",
        "unused",
        "cycles",
        "swallowed failure",
        "dead path",
        "excess",
    ]
    check(
        "matrix: enumerates six properties",
        all(x in lang for x in props),
        f"missing {[x for x in props if x not in lang]}",
    )
    # Read the table itself. `all(x in lang for x in langs)` only required language
    # names somewhere in prose, so deleting all six matrices and listing names in the
    # first paragraph stayed green. Require a seven-column header and data row per property.
    MATRIX_LANGS = ["Go", "Rust", "Python", "JavaScript", "TypeScript", "Java", "C"]
    HEADER = "| " + " | ".join(MATRIX_LANGS) + " |"
    check(
        "matrix: covers six plus one languages and names C as seventh",
        all(x in lang for x in MATRIX_LANGS) and "C is the seventh" in lang,
    )

    def matrix_row(prop):
        """Return the seven cells under `### prop`, or None when absent."""
        for blk in re.split(r"(?m)^### ", lang):
            if not blk.startswith(prop):
                continue
            m = re.search(
                re.escape(HEADER) + r"\n\|[-| ]+\|\n\|(.+)\|\s*$", blk, re.M
            )
            return [c.strip() for c in m.group(1).split("|")] if m else None
        return None

    def cell_state(c):
        """Classify one cell into the three states used by the 42-cell accounting."""
        if "empty set" in c:
            return "empty set (cannot occur)"
        if re.match(r"^read\b", c):
            return "read (occurs, no standard detector)"
        return "Detector named"

    grid = {pr: matrix_row(pr) for pr in props}
    broken = sorted(pr for pr, r in grid.items() if not r or len(r) != 7)
    check(
        "matrix: each of six properties has a seven-language header and data row",
        not broken,
        f"broken {broken}" if broken else f"{len(grid)} tables x 7 cells",
    )
    check(
        "matrix: marks cycles as an empty set in Go and Rust (A-9)",
        "the compiler forbids import cycles" in lang
        and "the module graph is acyclic by construction" in lang,
    )
    states = [
        cell_state(c) for pr in props if grid.get(pr) for c in grid[pr]
    ]
    measured = {k: states.count(k) for k in
                ("Detector named", "read (occurs, no standard detector)",
                 "empty set (cannot occur)")}
    # Counting two occurrences of "empty set" anywhere in prose was insufficient.
    # Verify that the two cells specifically belong to the cycles row.
    cyc = grid.get("cycles") or []
    check(
        "matrix: cycles row has exactly two empty-set cells and no detector there",
        measured["empty set (cannot occur)"] == 2
        and len([c for c in cyc if "empty set" in c]) == 2,
        f"empty sets {measured['empty set (cannot occur)']} / cycles cells {len(cyc)}",
    )
    check(
        "matrix: states that swallowed failure reverses in Python (A-8)",
        "EAFP" in lang and "Python inverts and the inversion is the point" in lang,
    )
    check(
        "matrix: targets swallowing rather than try/catch itself",
        'Not "unwarranted try/catch"' in lang,
    )
    check(
        "matrix: defines unused by reachability rather than tool (A-10)",
        "definitions nothing can reach" in lang
        and "makes the tool's blind spot into non-existence" in lang,
    )
    # Which language owns each blind spot is the contract. Loose word membership
    # stayed green even after deleting the blind-spot table, so bind rows to values.
    BLIND = {
        "Go": "Implicit interface satisfaction",
        "Python": "getattr",
        "Java": "Reflection",
        "C": "function pointer",
    }
    bs_head = "| Language | Blind spot the detector cannot see |"
    bs_body = lang.split(bs_head, 1)[1].split("\n\n", 1)[0] if bs_head in lang else ""
    bs_map = dict(re.findall(r"(?m)^\| ([A-Za-z]+) \| (.+?) \|$", bs_body))
    wrong = sorted(k for k, v in BLIND.items() if v not in bs_map.get(k, ""))
    check(
        "matrix: blind-spot table binds four languages to values",
        not wrong and len(bs_map) == 4,
        f"mismatch {wrong}; table {sorted(bs_map)}",
    )
    cells = re.search(r"\| Detector named \| (\d+) \|", lang)
    reads = re.search(r"\| read \(occurs, no standard detector\) \| (\d+) \|", lang)
    empties = re.search(r"\| empty set \(cannot occur\) \| (\d+) \|", lang)
    have_counts = cells is not None and reads is not None and empties is not None
    check(
        "matrix: 42-cell accounting sums correctly",
        have_counts
        and (int(cells.group(1)) + int(reads.group(1)) + int(empties.group(1)) == 42),
        "accounting row absent"
        if not have_counts
        else f"{cells.group(1)}+{reads.group(1)}+{empties.group(1)}",
    )
    # Prevent the accounting table from certifying itself. The earlier check summed
    # its three declared numbers, so replacing a cycles empty-set cell with `madge`
    # left the 29/11/2 accounting green. Count all six matrix tables and compare them.
    declared = (
        {
            "Detector named": int(cells.group(1)),
            "read (occurs, no standard detector)": int(reads.group(1)),
            "empty set (cannot occur)": int(empties.group(1)),
        }
        if have_counts
        else {}
    )
    check(
        "matrix: three declared counts match measured cell states",
        len(states) == 42 and declared == measured,
        f"measured {measured} / declared {declared} / {len(states)} cells",
    )
    check(
        "matrix: states and evaluates the majority-no-detector falsifier",
        "if more than half of the forty-two cells have no detector" in lang
        and "Thirteen is below twenty-one" in lang,
    )
    disk = (
        sorted(
            n[:-3]
            for n in os.listdir(os.path.join(SKILLS, "tdd", "langs"))
            if n.endswith(".md")
        )
        if os.path.isdir(os.path.join(SKILLS, "tdd", "langs"))
        else []
    )
    # F-10 created the C guide. Replace an absence-only contract with a destination
    # binding: the document names the destination and the file exists. If the guide
    # disappears, this fails instead of leaving a stale claim green.
    check(
        "matrix: documents the C guide destination and the file exists",
        "its guide now lives in `tdd/langs/c.md`" in lang and "c" in disk,
        f"langs {disk}",
    )

    # (13) Wave protocol: restraint and delta/state separation (A-6, A-7).
    check(
        "wave: forbids nit flooding",
        "no nit-flood" in wave and "Prefer a small number of high-confidence" in wave,
    )
    check(
        "wave: explains why cleanup has greater flooding risk",
        "The flooding risk is overwhelmingly larger here" in wave,
    )
    check("wave: output cap is twenty", "at most twenty findings" in wave)
    check(
        "wave: requires reporting truncation as Show N of M", "Show N of M" in wave
    )
    check(
        "wave: truncates lower priority rather than lower confidence",
        "not the lower confidence" in wave,
    )
    check(
        "wave: says silent truncation falsely claims completeness",
        "false claim of completeness" in wave,
    )
    check(
        "wave: states that delta axes are void for cleanup (A-7)",
        "the delta axes are void here" in wave,
    )
    delta = re.findall(
        r"(?m)^\| [A-Z].+ \| .+ \|$", section(wave, "## Delta axes and state axes")
    )
    check(
        "wave: delta/state separation table has five rows",
        len(delta) == 5,
        f"{len(delta)} rows",
    )
    check(
        "wave: explains the burden caused by missing separation",
        "burden lands on whoever inherited the code" in wave
        and "unbounded backlog" in wave,
    )
    check(
        "wave: cleanup output does not use verdict words",
        "never uses a verdict word" in wave,
    )
    check(
        "wave: requires one axis per wave and a test rerun after each",
        "One axis per wave" in wave
        and "re-run after each wave, not at the end" in wave,
    )

    # (14) Cap script: test behavior rather than prose.
    over = json.dumps([{"severity": "low", "id": i} for i in range(21)])
    rc, out = run_cap(over)
    check("cap: 21-item input returns rc 0", rc == 0, f"rc={rc}")
    check(
        "cap: truncates 21 items to 20",
        out is not None and len(out.get("findings", [])) == 20,
        "no output" if out is None else f"{len(out.get('findings', []))} items",
    )
    check(
        "cap: reports one truncated item",
        out is not None and out.get("truncated") == 1,
        "no output" if out is None else f"truncated={out.get('truncated')}",
    )
    check(
        "cap: emits Show 20 of 21",
        out is not None and "Show 20 of 21" in out.get("note", ""),
        "no output" if out is None else out.get("note", "")[:40],
    )

    exact = [{"severity": "high", "id": i} for i in range(20)]
    rc, out = run_cap(json.dumps(exact))
    check("cap: at most 20 items returns rc 0", rc == 0, f"rc={rc}")
    check(
        "cap: preserves item count at or below 20",
        out is not None and out.get("findings") == exact,
        "no output" if out is None else f"{len(out.get('findings', []))} items",
    )
    check(
        "cap: reports zero truncation at or below 20",
        out is not None and out.get("truncated") == 0,
        "no output" if out is None else f"truncated={out.get('truncated')}",
    )

    mixed = [{"severity": "low", "id": f"L{i}"} for i in range(20)]
    mixed.append({"severity": "high", "id": "H"})
    rc, out = run_cap(json.dumps(mixed))
    kept = [] if out is None else [f.get("id") for f in out.get("findings", [])]
    check(
        "cap: truncates lower priority and retains high severity",
        "H" in kept and "L19" not in kept,
        f"{kept[:1]} ... {len(kept)} items",
    )

    rc, out = run_cap("this is not json")
    check("cap: non-JSON input returns rc 2", rc == 2, f"rc={rc}")
    rc, out = run_cap(json.dumps({"axes": []}))
    check("cap: object without findings returns rc 2", rc == 2, f"rc={rc}")
    rc, out = run_cap(json.dumps([1, 2, 3]))
    check("cap: non-object list items return rc 2", rc == 2, f"rc={rc}")
    check("cap: script contains the cap as a constant", "CAP = 20" in cap_src)
    # Cross-check the prose value, code constant, and observed truncation point.
    # Testing each literal independently allowed one side to move while the two
    # declarations disagreed and gave no authority for choosing the correct value.
    WORDS = {"ten": 10, "fifteen": 15, "twenty": 20, "twenty-five": 25,
             "thirty": 30, "fifty": 50}
    m_doc = re.search(r"at most ([a-z-]+) findings", wave)
    m_code = re.search(r"(?m)^CAP = (\d+)$", cap_src)
    doc_cap = WORDS.get(m_doc.group(1)) if m_doc else None
    code_cap = int(m_code.group(1)) if m_code else None
    check(
        "cap: documented cap, code constant, and observed cutoff agree",
        doc_cap is not None and doc_cap == code_cap == 20,
        f"document {m_doc.group(1) if m_doc else 'absent'}({doc_cap}) / code {code_cap}"
        " / observed 20",
    )
    check(
        "cap: script docstring states the same number in prose",
        "Cap one cleanup run at twenty findings" in cap_src,
    )
    check(
        "cap: explains why truncation is not an error",
        "There is no exit code for" in cap_src,
    )

    # (15) Taxonomy revisions A-1 through A-4.
    check(
        "canonical: records that the axes had never been enumerated (A-1)",
        "the axes had never been written down" in tax
        and "the enumeration itself appeared zero times" in tax,
    )
    check(
        "canonical: enumerates six properties and assigns one to every axis",
        all(x in section(tax, "## Six properties") for x in props),
    )
    axis_props = re.findall(
        r"(?m)^\| \d+ \| .+ \| (duplication|unused|cycles|swallowed failure"
        r"|dead path|excess) \|",
        tax,
    )
    check(
        "canonical: every axis-table row has a property cell",
        len(axis_props) == 10,
        f"{len(axis_props)}/10 rows",
    )
    check(
        "canonical: has the eight-item upstream mapping table (A-2)",
        "mapping table" in tax.lower() and "| Upstream item | Our axis |" in tax,
    )
    check(
        "canonical: maps the two restored axes to upstream items 6 and 7 (A-3, A-4)",
        "**item 6** | 9 —" in tax and "**item 7** | 10 —" in tax,
    )
    check(
        "canonical: mapping states that axis 8 has no upstream counterpart",
        "**No upstream item.**" in tax,
    )
    check(
        "canonical: does not hide that the mapping arithmetic does not close",
        "The arithmetic does not close" in tax
        and "a number invented to make a table look finished" in tax,
    )
    check("canonical: links axis 8 to the adjudicator file", "slop-criteria.md" in tax)
    check("canonical: links language validity to the matrix file", "lang-matrix.md" in tax)

    check_skill_body(
        check,
        ROOT,
        needles=[
            "Lock the behaviour first",
            "**Before DRY**",
            "Do not mix",
            "Deleting a test to make a pass green is never a cleanup",
            "Scope is an argument, not a skill",
        ],
        floor=3216,
    )

    REF_CONTRACTS = [
            (
                "quality-taxonomy.md",
                "ten axes, closed list, priority, and language validity",
                [
                    "The count is not in the name",
                    "only from the closed list",
                    "comes before DRY",
                    "An empty cell is written as empty",
                ],
                5624,
            ),
            (
                "slop-criteria.md",
                "axis 8 closed-list adjudicators and rejected candidates",
                [
                    "No adjudicator, no finding.",
                    "Nothing outside this table is reported under axis 8",
                    "Restatement of another axis",
                    "report as 5, not 8",
                ],
                3368,
            ),
            (
                "lang-matrix.md",
                "six properties by seven languages: empty sets, inversion, and blind spots",
                [
                    "a property survives a language change",
                    "the compiler forbids import cycles",
                    "EAFP",
                    "its guide now lives in `tdd/langs/c.md`",
                ],
                4471,
            ),
            (
                "wave-protocol.md",
                "nit-flood ban, twenty-item cap, and delta/state separation",
                [
                    "Show N of M",
                    "no nit-flood",
                    "the delta axes are void here",
                    "burden lands on whoever inherited the code",
                ],
                3729,
            ),
    ]
    check_ref_contracts(check, ROOT, REF_CONTRACTS)
    # Measure the contract list itself. check_ref_contracts catches undeclared files,
    # while this check catches declared entries with empty needles or zero floors.
    n_disk = len([n for n in os.listdir(os.path.join(ROOT, "references"))
                  if n.endswith(".md")])
    thin = sorted(c[0] for c in REF_CONTRACTS if not c[2] or c[3] < 1)
    check(
        "reference map: contract entries map one-to-one to nonempty reference files",
        len(REF_CONTRACTS) == n_disk and not thin,
        f"declared {len(REF_CONTRACTS)} / live {n_disk}"
        + (f"; empty contracts {thin}" if thin else ""),
    )

    # Keep reference-contract checks in both live and deleted-copy counts. Exclude
    # only script-contract checks because check_script_contracts returns early in a
    # deleted run. Its call therefore follows the live_ran counts.
    SELF = ("자기검사:", "계약 커버리지:", "스크립트 계약:")
    check_contract_coverage(
        check,
        __file__,
        ROOT,
        per_file={
            "SKILL.md": 36,
            "references/quality-taxonomy.md": 28,
            "references/slop-criteria.md": 9,
            "references/lang-matrix.md": 17,
            "references/wave-protocol.md": 15,
            "scripts/cap_findings.py": 13,
        },
        live_ran=sum(1 for r in results if not r[0].startswith(SELF)),
    )
    check_body_deletion(
        check,
        __file__,
        ROOT,
        minimum=36,
        live_ran=sum(1 for r in results if not r[0].startswith(SELF)),
    )
    check_script_contracts(
        check,
        __file__,
        ROOT,
        scripts={"scripts/cap_findings.py": 13},
        live_ran=sum(1 for r in results if not r[0].startswith(SELF)),
    )
    check_no_constant_assertions(check, __file__)
    check_total(check, results, 134)

    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n{passed}/{len(results)} 통과")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
