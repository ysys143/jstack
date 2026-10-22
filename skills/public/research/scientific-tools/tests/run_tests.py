#!/usr/bin/env python3
"""Science regression suite.

Usage: python3 tests/run_tests.py (from skills/science)

## This skill vendors imported material: what to lock

All 209 source documents belong to others (kdense MIT, gdm Apache-2.0, academic
CC BY-NC). We added only NOTICE and this suite. Therefore the contract asks
**whether the imported material is intact and its attribution remains**, rather
than whether we wrote it well.

1. **Source integrity:** do the three repositories in `_sources.json` exist, with
   each complete license text imported? Losing notice violates MIT and Apache
   notice duties and CC BY attribution duties.
2. **NC notice:** does NOTICE retain the academic repository's noncommercial term?
   Without it, a later contributor may use that material in procurement output.
3. **Routing table to files:** do referenced catalog files exist? An incomplete
   import leaves the router pointing nowhere.
4. **Boundary:** does it identify local owners (`office`, `hwpx`, `deck`,
   `diagram`) for document deliverables?
"""
import importlib.util
import json
import os
import re
import shutil
import sys
import tempfile

sys.dont_write_bytecode = True
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
from _suite_lib import (check_skill_body, content_bytes, check_contract_coverage, check_no_constant_assertions, check_script_contracts, check_total,  # noqa: E402
                        split_frontmatter, check_body_deletion, _ref_axes, section)  # noqa: E402
ROOT = os.path.dirname(HERE)
REFS = os.path.join(ROOT, "references")
REPOS = os.path.join(ROOT, "repos")

# **Measured content volume of reference documents.** These are `content_bytes`,
# not raw bytes. A previous `len(t.encode())` measure let **blank-line padding pass**:
# replacing 39 files with `출처: x\n0 skills.\n` plus blank lines stayed 55/55 green
# while removing all content from the 110 KB catalog (review 12). `content_bytes`
# exists to block exactly that attack, yet the new contract reverted to raw bytes.
# Science also called neither `check_contract_coverage` nor `check_ref_contracts`,
# so making all 39 references **zero bytes** stayed 43/43 green (review 10), the
# only one of 11 work-layer skills with this gap. This covers repository-authored
# `references/`, not imported `repos/`.
REF_BYTES = {
    "_kdense-catalog.md": 110366,
    "academic-paper-pipeline.md": 710,
    "agent-frameworks.md": 304,
    "analysis-methodology.md": 2170,
    "autonomous-research-optimization-frameworks.md": 371,
    "bioinformatics-genomics.md": 3208,
    "biological-databases-deepmind.md": 6051,
    "cheminformatics-drug-discovery.md": 1277,
    "clinical-documentation-decision-support.md": 736,
    "cloud-platforms-for-genomics-biomedical-data.md": 398,
    "data-analysis-visualization.md": 1400,
    "data-management-infrastructure.md": 645,
    "decision-scenario-analysis.md": 662,
    "document-processing-conversion.md": 1141,
    "electronic-lab-notebooks-eln.md": 523,
    "engineering-simulation.md": 1066,
    "healthcare-ai-clinical-machine-learning.md": 377,
    "laboratory-automation-equipment-control.md": 379,
    "laboratory-automation.md": 544,
    "laboratory-information-management-systems-lims-r-d-platforms.md": 418,
    "machine-learning-deep-learning.md": 2531,
    "materials-science-chemistry.md": 609,
    "medical-imaging-digital-pathology.md": 751,
    "microscopy-bio-image-data.md": 377,
    "neuroscience-electrophysiology.md": 658,
    "pharmacology-pharmacometrics.md": 374,
    "phylogenetics-evolutionary-biology.md": 532,
    "preclinical-research-animal-welfare.md": 400,
    "protein-engineering-design.md": 893,
    "proteomics-mass-spectrometry.md": 423,
    "protocol-management-sharing.md": 390,
    "regulatory-standards-evidence-preparation.md": 592,
    "research-methodology-proposal-writing.md": 1114,
    "scientific-communication-publishing.md": 1877,
    "scientific-databases-data-access.md": 1562,
    "tool-discovery-computational-resources.md": 552,
    "uncategorized.md": 354,
    "web-search-information-retrieval.md": 491,
    "workflow-platforms-cloud-execution.md": 647,
}

# **Measure locally authored references on a separate axis.** The 39 files above
# are generated catalogs with a common shape: attribution, `N skills.` declaration,
# entries, and paths. Those four properties are stronger than needles. The three
# below are **repository-authored judgments** with a different form. Applying the
# catalog check creates false positives, while omitting them leaves them outside
# the contract, which was exactly the review 10 defect.
#
# `check_ref_contracts` is unsuitable because its completeness guard requires
# **every** `references/` file in the contract list. `REF_BYTES` plus
# `check_science_refs` already measure the 39 catalogs. Call the three axis
# functions directly, with the "files match declared list" check owning population.
OWN_REFS = {
    "stats-corrections.md": (
        [
            "**Always default to Welch without a pretest.**",
            "MWU's null is `P(X > Y) = P(Y > X)`, not equality of medians.",
            "Tukey HSD **already controls familywise error (FWER)** through the studentized range distribution and needs no preliminary gate.",
        ],
        6524,
    ),
    "tier-a-verdicts.md": (
        [
            "**The tier A roster lists skill names, and each name directly consumes the top-level budget.**",
            "**That description is true for five and false for seven.**",
            "**존치 6 · 배제 10.**",
        ],
        6380,
    ),
    "reproducibility.md": (
        [
            "**None of the 159 imported skills is dedicated to reproducibility.**",
            "These pins are a dated direct-dependency snapshot, not a transitive lockfile.",
            "**Direct dependency pins do not establish reproducibility.**",
        ],
        4643,
    ),
}


# Measured NOTICE content volume (excluding needles), with zero slack.
NOTICE_FLOOR = 1628

# **Canonical row values for the application summary.** Lock all three cells:
# situation, upstream, and local rule.
#
# The demonstrated attack reversed the Welch default in 17 places. Changing 17
# lines in a 91-line frozen copy leaves 81% survival, above the 70% floor, while
# three needles outside those lines survive. Those checks measured existence,
# not **direction**. The table's two columns point in opposite directions, so
# swapping them reverses the document without changing bytes; volume and survival
# cannot detect it.
STATS_SUMMARY = [
    ("Two-group mean comparison", "Welch only after significant Levene", "**Always Welch**"),
    ("Three or more groups", "ANOVA, then Welch ANOVA if equal variance is violated", "**Always Welch ANOVA**"),
    ("Nonparametric two-group comparison", "MWU followed by median reporting", "**Stochastic superiority + rank-biserial**"),
    ("Post-hoc pairwise comparisons", "omnibus p < .05 gate", "**Tukey HSD without a gate**"),
    ("Bayesian two-group comparison", "Shared sigma, normal likelihood", "**Group-specific sigma, StudentT (BEST)**"),
]

# First sentence of the **local action** for each correction; these sentences are
# the reason the document exists.
STATS_VERDICTS = (
    "**Always default to Welch without a pretest.**",
    "**Describe stochastic superiority.**",
    "**Delete the gate.**",
    "**Use BEST as the default example.**",
)

# Rule 2 lockfile table: requirement, artifact, and acceptance criterion. Swapping
# required/recommended reverses the rule without changing rows or bytes.
REPRO_LOCK = [
    ("**Required**", "One of `uv.lock`, `poetry.lock`, or `requirements.txt --require-hashes`", "Must pin hashes as well"),
    ("**Required**", "Python interpreter version (`.python-version` or a declaration in the lockfile)", "The pinned-version table already requires 3.12+"),
    ("Recommended", "Container image digest (`sha256:`, not a tag)", "Tags can move"),
    ("Recommended", "OS, CPU architecture, and BLAS implementation", "These can affect floating-point results"),
]


def table_rows(text, head):
    """Return the first table's data rows under `## head` as cell lists."""
    if head not in text:
        return []
    body = text.split(head, 1)[1].split("\n## ", 1)[0]
    out = []
    for line in body.splitlines():
        s = line.strip()
        if not s.startswith("|") or set(s) <= set("|-: "):
            continue
        cells = [c.strip() for c in s.strip("|").split("|")]
        out.append(cells)
    return out[1:] if out else out          # Drop the header row.


def check_stats_direction(check):
    """Measure the **direction** of `stats-corrections.md`.

    Needles see only whether sentences exist. This checks which value occupies
    each cell. Swapping two columns preserves needles, volume, and line survival
    while reversing the document's instruction.
    """
    fp = os.path.join(REFS, "stats-corrections.md")
    if not os.path.isfile(fp):
        check("Correction direction: stats-corrections.md exists", False, "file missing")
        return
    t = read(fp)

    heads = re.findall(r"(?m)^## Correction (\d+):", t)
    check("Correction direction: four blocks are numbered 1 through 4",
          heads == ["1", "2", "3", "4"], f"{heads}")
    decl = re.search(r"Corrections to (\d+) upstream `statistical-analysis` recommendations", t)
    check("Correction direction: title count matches block count",
          bool(decl) and int(decl.group(1)) == len(heads),
          f"declared {decl.group(1) if decl else 'missing'} / blocks {len(heads)}")

    for cell in ("Upstream instruction", "Error", "Evidence", "Local action"):
        n = len(re.findall(r"\| \*\*" + cell + r"\*\* \|", t))
        check(f"Correction direction: field '{cell}' appears in every block",
              n == len(heads), f"{n} fields / {len(heads)} blocks")

    # Without the third field, the document says this is preference, not correction.
    proofs = re.findall(r"\| \*\*Evidence\*\* \| (.+?) \|\n", t + "\n")
    undated = [i + 1 for i, c in enumerate(proofs) if not re.search(r"\(\d{4}[,)]", c)]
    check("Correction direction: every evidence field cites a dated source",
          len(proofs) == len(heads) and not undated, f"missing year {undated}")

    verdicts = re.findall(r"\| \*\*Local action\*\* \| (\*\*[^*]+\*\*)", t)
    check("Correction direction: four local actions match canonical sentences",
          tuple(verdicts) == STATS_VERDICTS, f"{verdicts}")

    rows = [r for r in table_rows(t, "## Application summary") if len(r) == 3]
    got = [tuple(r) for r in rows]
    check("Correction direction: application summary cells match canonical rows",
          got == [tuple(r) for r in STATS_SUMMARY],
          f"{[r for r in got if tuple(r) not in map(tuple, STATS_SUMMARY)][:2]}")

    # Code examples must point in the same direction; upstream values stay in comments.
    check("Correction direction: code example uses correction=True",
          "pg.ttest(group1, group2, correction=True)" in t)
    auto = [ln for ln in t.splitlines() if "correction='auto'" in ln]
    check("Correction direction: correction='auto' remains only in an upstream comment",
          all(ln.lstrip().startswith("#") for ln in auto) and len(auto) == 1,
          f"{auto}")
    check("Correction direction: precedence over upstream remains declared",
          "**This document takes precedence over upstream.**" in t)


def check_repro_direction(check):
    """Measure `reproducibility.md` through **numeric cross-checks**.

    One seed appears in code, command, and manifest. Reversing the protocol either
    splits those values or swaps required/recommended table rows; both are detected.
    """
    fp = os.path.join(REFS, "reproducibility.md")
    if not os.path.isfile(fp):
        check("Reproducibility direction: reproducibility.md exists", False, "file missing")
        return
    t = read(fp)

    nums = re.findall(r"(?m)^## Rule (\d+):", t)
    check("Reproducibility direction: rules run from 1 through 5", nums == ["1", "2", "3", "4", "5"],
          f"{nums}")

    boxes = re.findall(r"(?m)^- \[ \] ", t)
    check("Reproducibility direction: review checklist has eight items", len(boxes) == 8, f"{len(boxes)} items")

    prov = t.split("## Rule 3", 1)[-1].split("\n## ", 1)[0]
    items = re.findall(r"(?m)^(\d)\. \*\*", prov)
    check("Reproducibility direction: five-field provenance declaration matches item count",
          "Record five fields" in prov and items == ["1", "2", "3", "4", "5"],
          f"{items}")

    seeds = {
        "code": re.search(r"(?m)^SEED = (\d+)", t),
        "command": re.search(r"--seed (\d+)", t),
        "manifest": re.search(r'"seed": (\d+)', t),
    }
    vals = {k: (m.group(1) if m else None) for k, m in seeds.items()}
    check("Reproducibility direction: seed matches in code, command, and manifest",
          None not in vals.values() and len(set(vals.values())) == 1, f"{vals}")

    blocks = re.findall(r"```json\n(.*?)```", t, re.S)
    try:
        man = json.loads(blocks[0]) if blocks else None
    except ValueError as exc:                                   # noqa: BLE001
        man = None
        check("Reproducibility direction: manifest example is valid JSON", False, str(exc)[:60])
    else:
        check("Reproducibility direction: manifest example is valid JSON", man is not None,
              "```json block missing" if man is None else "")
    want_keys = {"run_id", "seed", "env", "data", "code", "outputs"}
    check("Reproducibility direction: manifest contains all six fields",
          isinstance(man, dict) and set(man) == want_keys,
          f"{sorted(man) if isinstance(man, dict) else man}")

    rows = [tuple(r) for r in table_rows(t, "## Rule 2") if len(r) == 3]
    check("Reproducibility direction: lockfile table matches canonical rows",
          rows == [tuple(r) for r in REPRO_LOCK],
          f"{[r for r in rows if r not in [tuple(x) for x in REPRO_LOCK]][:2]}")
    check("Reproducibility direction: partial reproduction is not accepted as reproducible",
          "Partial reproduction does" in t
          and "Do not claim reproducibility if any item is missing" in t)


# Each probe's (label, checker result that must flip). Keep this mapping in
# **one place** so normal and failure paths cannot drift to different names.
PROBE_CASES = (
    ("swap six decision pairs while preserving counts", "tier A: decisions match the authoritative list row by row"),
    ("retain one duplicate", "tier A: all five duplicates are excluded"),
    ("replace an alternative with another skill", "tier A: replacements for five duplicates match the authority"),
    ("delete the roster table", "tier A: roster table was read"),
)


def _probe_unmeasured(check, why):
    """Record every probe result as a failure **under its exact name**.

    A prior version emitted one summary and returned when it could not import the
    checker. Five results then disappeared, hiding the skipped work from both
    readers and the disappearance guard. This is the same class-A failure as
    `_suite_lib._floor_unmeasured`.

    Demonstration: emptying `tests/test_tier_a_roster.py` removed `mod.run`,
    crashed the whole suite with `AttributeError`, and erased 31 results including
    those after the crash (90 in the copy versus 121 live). Failure count hid it.
    """
    check("Mutation probe: every check passes in the unchanged copy", False, why)
    for label, _ in PROBE_CASES:
        check(f"Mutation probe: checker catches {label}", False, why)


def check_roster_probe(check):
    """Measure checker **behavior** by feeding it a reversed document.

    Looking for five names in source cannot detect a weakened predicate; changing
    `!= "배제"` to `is None` leaves every name present. The probe is independent
    of implementation form. Symlink the 38 MB `repos/` tree instead of copying it.
    """
    fp = os.path.join(HERE, "test_tier_a_roster.py")
    spec = importlib.util.spec_from_file_location("_roster_probe", fp)
    mod = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(mod)
    except Exception as exc:                                    # noqa: BLE001
        _probe_unmeasured(check, f"could not import checker — {repr(exc)[:60]}")
        return
    # **Catch missing attributes here too.** An empty file imports successfully
    # and first fails at `mod.run`, which previously killed the suite.
    _absent = [n for n in ("run", "DUPLICATES") if not hasattr(mod, n)]
    if _absent:
        _probe_unmeasured(check, f"checker is missing {_absent}")
        return

    def probe(mutate):
        tmp = tempfile.mkdtemp()
        try:
            os.symlink(REPOS, os.path.join(tmp, "repos"))
            os.mkdir(os.path.join(tmp, "references"))
            for n in ("tier-a-verdicts.md", "_sources.json",
                      "analysis-methodology.md"):
                shutil.copy2(os.path.join(REFS, n),
                             os.path.join(tmp, "references", n))
            vp = os.path.join(tmp, "references", "tier-a-verdicts.md")
            with open(vp, encoding="utf-8") as f:
                doc = f.read()
            with open(vp, "w", encoding="utf-8") as f:
                f.write(mutate(doc))
            got = {}
            mod.run(lambda n, ok, d="": got.__setitem__(n, ok), tmp)
            return got
        finally:
            shutil.rmtree(tmp, ignore_errors=True)

    # Exclude this location-dependent result from isolated-copy evaluation.
    OFF = "tier A: in-tree replacement skills exist"

    def swap6(doc):
        """Flip six retained rows and six nonduplicate exclusions, preserving counts."""
        out, k, d = [], 0, 0
        for ln in doc.splitlines():
            if ln.startswith("| `") and "| 존치 |" in ln and k < 6:
                ln, k = ln.replace("| 존치 |", "| 배제 |"), k + 1
            elif (ln.startswith("| `") and "| 배제 |" in ln and d < 6
                  and not any(f"`{n}`" in ln.split("|")[1] for n in mod.DUPLICATES)):
                ln, d = ln.replace("| 배제 |", "| 존치 |"), d + 1
            out.append(ln)
        return "\n".join(out)

    base = probe(lambda doc: doc)
    bad = sorted(n for n, ok in base.items() if not ok and n != OFF)
    check("Mutation probe: every check passes in the unchanged copy", not bad, f"{bad[:3]}")

    mutators = (
        swap6,
        lambda doc: doc.replace(
            "/scientific-writing/SKILL.md` | 배제 |",
            "/scientific-writing/SKILL.md` | 존치 |"),
        lambda doc: doc.replace(
            "`research`(이 저장소) | One of five direct overlaps.",
            "`hwpx`(이 저장소) | One of five direct overlaps."),
        lambda doc: re.sub(r"(?m)^\| `.+$", "", doc),
    )
    for (label, name), mutate in zip(PROBE_CASES, mutators):
        got = probe(mutate)
        check(f"Mutation probe: checker catches {label}",
              got.get(name) is False, f"{name} = {got.get(name)!r}")

def load_pure(src_path, names, const_names=()):
    """Extract only **pure functions** from a networked script for execution.

    Importing runs the module-level `urlretrieve`. Instead, compile a new module
    from selected AST functions, constants, and top-level imports. This measures
    **behavior**, unlike grepping source.
    """
    import ast
    tree = ast.parse(read(src_path))
    keep = []
    for node in tree.body:
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            keep.append(node)
        elif isinstance(node, ast.FunctionDef) and node.name in names:
            keep.append(node)
        elif (isinstance(node, ast.Assign) and len(node.targets) == 1
              and isinstance(node.targets[0], ast.Name)
              and node.targets[0].id in const_names):
            keep.append(node)
    mod = ast.Module(body=keep, type_ignores=[])
    ns = {"__name__": "_pure", "__file__": src_path}
    exec(compile(ast.fix_missing_locations(mod), src_path, "exec"), ns)
    return ns


def _regen_unmeasured(check, why):
    """Fail each generator-behavior result **under its exact name**.

    An early return erased two results (119 in the copy versus 121 live), which
    the disappearance guard detected. A one-line summary still loses names.
    """
    for _n in ("does not count directory symlinks as real files",
               "does not change a byte outside the table"):
        check(f"Generator behavior: {_n}", False, f"unmeasured — {why}")


def check_regen_behaviour(check):
    """Measure two generator functions by **actually running them**.

    A prior version compared only source strings (upstream URL, output path, and
    pyyaml), allowing two real defects:

    1. `glob('**')` followed directory symlinks and counted four `academic`
       skills as eight, spreading the incorrect total of 209 into four documents.
    2. Using the `## Updating` heading as the routing-table endpoint deleted the
       intervening prose section and its three-row local-decisions table.
    """
    fp = os.path.join(ROOT, "scripts", "rebuild-index.py")
    try:
        ns = load_pure(fp, {"skill_files", "replace_table"}, {"HEAD_ROW"})
    except Exception as exc:                                    # noqa: BLE001
        check("Generator behavior: pure functions can be extracted", False, repr(exc)[:80])
        _regen_unmeasured(check, "could not extract pure functions")
        return
    missing = [n for n in ("skill_files", "replace_table", "HEAD_ROW")
               if n not in ns]
    check("Generator behavior: instrumented functions exist", not missing, f"{missing}")
    if missing:
        _regen_unmeasured(check, f"missing {missing}")
        return

    tmp = tempfile.mkdtemp()
    try:
        real = os.path.join(tmp, "alpha")
        os.makedirs(real)
        with open(os.path.join(real, "SKILL.md"), "w", encoding="utf-8") as f:
            f.write("---\nname: alpha\n---\n")
        os.makedirs(os.path.join(tmp, "skills"))
        os.symlink(real, os.path.join(tmp, "skills", "alpha"))
        got = ns["skill_files"](tmp)
        check("Generator behavior: does not count directory symlinks as real files",
              len(got) == 1, f"{len(got)} items — {[os.path.relpath(g, tmp) for g in got]}")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    tail = "\n## Local decisions\n\nThis section must remain.\n\n## Updating\n"
    doc = ns["HEAD_ROW"] + "| `a.md` | 1 | A |\n| `b.md` | 2 | B |\n" + tail
    out = ns["replace_table"](doc, "| `c.md` | 3 | C |")
    # **Compare the tail byte for byte.** Checking only whether a named section
    # remains missed versions that deleted only the content before `\\n## Updating`.
    check("Generator behavior: does not change a byte outside the table",
          out == ns["HEAD_ROW"] + "| `c.md` | 3 | C |\n" + tail,
          out.replace("\n", "\\n")[:110])


def check_catalog_index(check, skill, sources):
    """Bind the shipped JSON index to routing, catalog content, and source counts."""
    try:
        index = json.loads(read(os.path.join(REFS, '_index.json')))
    except (OSError, ValueError):
        index = None
    valid = isinstance(index, list) and bool(index)
    if valid:
        valid = all(isinstance(row, dict) and set(row) == {'domain', 'file', 'count', 'bytes'}
                    and isinstance(row['domain'], str) and bool(row['domain'])
                    and isinstance(row['file'], str) and re.fullmatch(r'[a-z0-9-]+\.md', row['file'])
                    and type(row['count']) is int and row['count'] > 0
                    and type(row['bytes']) is int and row['bytes'] > 0 for row in index)
    if valid:
        valid = len({row['file'] for row in index}) == len(index) == len({row['domain'] for row in index})
    rows = index if valid else []
    routes = re.findall(r'(?m)^\|\s*`([a-z0-9_.-]+\.md)`\s*\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|', skill)
    check('Index: JSON schema and unique per-domain files are valid', bool(valid))
    check('Index: public routing table matches files, counts, and domains',
          bool(valid) and [(r['file'], r['count'], r['domain']) for r in rows] == [(f, int(n), d) for f, n, d in routes])
    byte_errors, count_errors = [], []
    for row in rows:
        path = os.path.join(REFS, row['file'])
        try:
            with open(path, 'rb') as handle:
                data = handle.read()
            if len(data) != row['bytes']:
                byte_errors.append(row['file'])
            if len(re.findall(r'(?m)^- \*\*', data.decode('utf-8'))) != row['count']:
                count_errors.append(row['file'])
        except (OSError, UnicodeError):
            byte_errors.append(row['file'])
            count_errors.append(row['file'])
    check('Index: files exist and recorded bytes match the catalogs', bool(valid) and not byte_errors, str(byte_errors))
    check('Index: per-domain skill counts match catalog entry counts', bool(valid) and not count_errors, str(count_errors))
    counts = [sources.get(tag, {}).get('skill_count') for tag in ('academic', 'gdm', 'kdense')]
    check('Index: total entries match pinned per-source skill counts',
          bool(valid) and all(type(n) is int and n > 0 for n in counts) and sum(r['count'] for r in rows) == sum(counts))
    check('Index: rows are sorted by descending count and domain name',
          bool(valid) and rows == sorted(rows, key=lambda r: (-r['count'], r['domain'])))


def check_vendor_count(check, src, skill, fm, notice):
    """Count imported skills **on disk** and compare them with declarations.

    `repos/academic/skills/<name>` entries are directory symlinks to `../<name>`.
    `glob('**')` followed them and counted four skills as eight, spreading the
    incorrect total of 209 through the description, body, NOTICE, and
    `_sources.json`. The measured total is 201. **Do not count symlinks as files.**
    """
    measured = {}
    for tag in sorted(src):
        base = os.path.join(REPOS, tag)
        n = 0
        for dp, dns, fns in os.walk(base, followlinks=False):
            dns[:] = [d for d in dns if not os.path.islink(os.path.join(dp, d))]
            if "SKILL.md" in fns:
                n += 1
        measured[tag] = n
    declared = {tag: src[tag].get("skill_count") for tag in src}
    check("Accounting: _sources.json skill counts match disk (excluding symlinks)",
          measured == declared, f"measured {measured} / declared {declared}")

    total = sum(measured.values())
    rows = re.findall(r"(?m)^\|\s*`([a-z0-9_.-]+\.md)`\s*\|\s*(\d+)\s*\|", skill)
    check("Accounting: routing-table total exactly matches disk",
          sum(int(n) for _, n in rows) == total,
          f"table {sum(int(n) for _, n in rows)} / measured {total}")
    declarations = (
        ("description", fm, f"{total} science and research skills"),
        ("body", skill, f"Organizes {total} child skills"),
        ("NOTICE", notice, f"points to {total} skills"),
    )
    for where, text, needle in declarations:
        check(f"Accounting: {where} declared total matches disk",
              needle in text,
              f"{total} missing — " + ", ".join(
                  sorted(set(re.findall(r"\b(\d{3})", text)))))
    # **Names must survive an empty authority.** Iterating over `sorted(src)` made
    # these three results disappear when `_sources.json` was empty. Iterate over
    # the fixed tag set and record a failure for a missing authority entry.
    for tag in ("academic", "gdm", "kdense"):
        if tag not in src:
            check(f"Accounting: NOTICE {tag} skill count matches disk", False,
                  "source missing from _sources.json")
            continue
        n = measured[tag]
        check(f"Accounting: NOTICE {tag} skill count matches disk",
              re.search(r"\| `%s` \|[^|]*\|\s*%d\s*\|" % (tag, n), notice)
              is not None, f"measured {n}")
    check("Generator: does not follow directory symlinks",
          "followlinks=False" in read(os.path.join(ROOT, "scripts",
                                                   "rebuild-index.py"))
          and "islink" in read(os.path.join(ROOT, "scripts",
                                            "rebuild-index.py")))


def check_credit_lines(check, src):
    """Compare every cell of 39 catalog `출처:` lines with `_sources.json`.

    A prior version checked only for 20 or more characters, so arbitrary repository,
    commit, and license values passed. One `academic` catalog shipped with a stale
    nonstandard-license note even after `_sources.json` established CC BY-NC 4.0.
    """
    CRED = re.compile(
        r"`([a-z]+)` = \[([^\]]+)\]\(([^)]+)\) @ ([0-9a-f]{7}) \(([^)]*)\)")
    wrong, silent = [], []
    for n in sorted(REF_BYTES):
        if n == "_kdense-catalog.md":
            continue
        fp = os.path.join(REFS, n)
        if not os.path.isfile(fp):
            continue
        line = re.search(r"(?m)^출처: (.+)$", read(fp))
        if not line:
            silent.append(n)
            continue
        creds = CRED.findall(line.group(1))
        if not creds:
            silent.append(n)
            continue
        for tag, repo, url, commit, lic in creds:
            meta = src.get(tag)
            if meta is None:
                wrong.append(f"{n}: unknown tag {tag}")
            elif (repo, url, commit) != (meta["repo"], meta["url"],
                                         meta["commit"][:7]):
                wrong.append(f"{n}: {tag} repository/commit mismatch")
            elif lic != meta["license"]:
                wrong.append(f"{n}: {tag} license {lic!r} != {meta['license']!r}")
    check("Attribution: every catalog has a machine-readable source line", not silent,
          f"{silent[:4]}")
    check("Attribution: source repository, commit, and license match _sources.json",
          not wrong, f"{wrong[:4]}")


def check_catalog_identity(check):
    """Check that catalogs do not count **the same skill twice**.

    Double counting passes entry-count and path-existence checks because the two
    entries have different existing paths, one a symlink. Collapse to real paths.
    """
    dupes, linked = [], []
    for n in sorted(REF_BYTES):
        if n == "_kdense-catalog.md":
            continue
        fp = os.path.join(REFS, n)
        if not os.path.isfile(fp):
            continue
        t = read(fp)
        slugs = [s for s, _ in re.findall(r"(?m)^- \*\*(.+?)\*\* \(`(.+?)`\)", t)]
        dupes += [f"{n}: {s}" for s in sorted({s for s in slugs
                                               if slugs.count(s) > 1})]
        real = set()
        # **Inspect only below the skill root.** Comparing `realpath(ap)` with
        # `abspath(ap)` also catches symlinks in the path prefix. On macOS `/var`
        # itself points to `/private/var`, contaminating every temporary-copy control.
        # Resolve the root first, then compare the relative path below it.
        _root_real = os.path.realpath(ROOT)
        for rel in re.findall(r"`(repos/[^`]+SKILL\.md)`", t):
            ap = os.path.join(ROOT, rel)
            if os.path.realpath(ap) != os.path.join(_root_real, rel):
                linked.append(f"{n}: {rel}")
            real.add(os.path.realpath(ap))
        if len(real) != len(set(re.findall(r"`(repos/[^`]+SKILL\.md)`", t))):
            dupes.append(f"{n}: different paths point to the same file")
    check("Accounting: catalogs do not list the same skill twice", not dupes, f"{dupes[:4]}")
    check("Accounting: catalog paths contain no directory symlinks", not linked, f"{linked[:4]}")


def check_science_refs(check):
    """Bind catalog documents to **files on disk**.

    The 38 generated catalogs share a format: `출처:` attribution, an `N skills.`
    declaration, `- **name** (`source`)` entries, and `repos/.../SKILL.md` paths.
    These properties are stronger than hand-picked needles: declared and actual
    counts must agree, target paths must exist, and license attribution must remain.
    """
    missing_files = [n for n in REF_BYTES
                     if not os.path.isfile(os.path.join(REFS, n))]
    check("References: every declared document exists", not missing_files,
          f"{missing_files}")
    on_disk = sorted(f for f in os.listdir(REFS) if f.endswith(".md"))
    declared = set(REF_BYTES) | set(OWN_REFS)
    check("References: files on disk match the declared list", on_disk == sorted(declared),
          f"undeclared {sorted(set(on_disk) - declared)} / missing {sorted(declared - set(on_disk))}")

    thin, count_off, dead_path, no_src = [], [], [], []
    for n in sorted(REF_BYTES):
        fp = os.path.join(REFS, n)
        if not os.path.isfile(fp):
            continue
        t = read(fp)
        got = content_bytes(t, [])
        if got < REF_BYTES[n]:
            thin.append(f"{n}: {got}B < {REF_BYTES[n]}B")
        if n == "_kdense-catalog.md":
            continue                      # Different shape; measure only volume.
        # A two-character source cannot pass; attribution must identify the
        # repository and license to be meaningful.
        src = re.search(r"^출처: (.+)$", t, re.M)
        if not src or len(src.group(1).strip()) < 20:
            no_src.append(n)
        m = re.search(r"^(\d+) skills\.", t, re.M)
        ents = re.findall(r"^- \*\*(.+?)\*\* \(`(.+?)`\)", t, re.M)
        # **Do not forbid `0 skills.` itself.** It is honest for a new empty
        # category. The volume floor already blocks using zero to bypass entry
        # validation, so another rule would create false positives (review 14).
        if not m or int(m.group(1)) != len(ents):
            count_off.append(f"{n}: declared {m.group(1) if m else 'missing'} / entries {len(ents)}")
        for rel in re.findall(r"`(repos/[^`]+SKILL\.md)`", t):
            if not os.path.isfile(os.path.join(ROOT, rel)):
                dead_path.append(f"{n}: {rel}")

    check("References: no document fell below measured content volume", not thin, f"{thin[:4]}")
    check("References: catalogs retain source attribution", not no_src, f"{no_src[:6]}")
    check("References: declared counts match entry counts", not count_off, f"{count_off[:4]}")
    check("References: every referenced SKILL.md exists", not dead_path, f"{dead_path[:4]}")


def check_own_refs(check):
    """Apply needle, volume, and line-survival axes to three local references.

    They differ from the 39 generated catalogs, whose counts, paths, and sources
    cross-check one another. These judgment documents are prose without that
    binding, so measure what they contain, whether content was deleted, and whether
    it was substituted.
    """
    for fn in sorted(OWN_REFS):
        needles, floor = OWN_REFS[fn]
        fp = os.path.join(REFS, fn)
        if not os.path.isfile(fp):
            check(f"Local reference: {fn} exists", False, "file missing")
            continue
        _ref_axes(check, ROOT, fn, fp, read(fp), needles, floor,
                  "tests/refs", "Local reference")


def check_tier_a_roster(check):
    """**Actually execute** `tests/test_tier_a_roster.py`.

    Merely declaring the checker leaves it unobserved. Run it here, while
    `check_script_contracts` verifies that emptying it causes failures. Removing
    the checker must produce **failures**, not disappearing results.
    """
    fp = os.path.join(HERE, "test_tier_a_roster.py")
    src = read(fp) if os.path.isfile(fp) else ""
    check("tier A 로스터: checker reads tier-a-verdicts.md as authority",
          "tier-a-verdicts.md" in src)
    check("tier A 로스터: checker compares sources with _sources.json",
          "_sources.json" in src)
    check("tier A 로스터: checker names all five duplicates",
          all(n in src for n in ("scientific-writing", "peer-review",
                                 "scientific-brainstorming",
                                 "scientific-visualization",
                                 "literature-review")))
    mod = None
    if src.strip():
        spec = importlib.util.spec_from_file_location("test_tier_a_roster", fp)
        try:
            cand = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(cand)
            mod = cand if hasattr(cand, "run") else None
        except Exception as exc:                      # noqa: BLE001
            check("tier A 로스터: checker can be imported", False, repr(exc)[:80])
            return
    if mod is None:
        check("tier A 로스터: checker exposes run()", False,
              "tests/test_tier_a_roster.py is empty or has no run()")
        return
    mod.run(check, ROOT)


results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" — {detail}" if detail else ""))


def read(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


def main():
    skill_all = read(os.path.join(ROOT, "SKILL.md"))
    fm, skill = split_frontmatter(skill_all)
    notice = read(os.path.join(ROOT, "NOTICE"))

    # (0) The frontmatter name must match the roster. Retaining the upstream
    # `science-research` name would diverge from the plugin declaration.
    check("Name: frontmatter matches roster (science)",
          re.search(r"(?m)^name:\s*science\s*$", fm) is not None,
          re.search(r"(?m)^name:\s*(.+)$", fm).group(1) if "name:" in fm else "missing")

    # (1) Source integrity: treat _sources.json as authority and compare files.
    #
    # **Absence is a result, not an exception.** Bare `json.loads` crashed an
    # emptied-copy run with `JSONDecodeError`, reducing 121 results to one. With
    # no summary line, failure-counting tools saw zero failures while all source
    # and license axes disappeared. The NC notice check came immediately after it.
    # **Later sections must still run.** `section` catches exceptions, but names
    # assigned inside it remain undefined. Initialize `src` first so later checks
    # report an empty authority instead of dying again with `UnboundLocalError`.
    src = {}
    _TAGS = ("academic", "gdm", "kdense")
    _SRC_AXES = ["출처: _sources.json contains all three repositories"]
    for _t in _TAGS:
        _SRC_AXES += [f"출처: repos/{_t} exists",
                      f"출처: {_t} complete license text is imported",
                      f"출처: {_t} pinned commit is recorded",
                      f"출처: NOTICE identifies the {_t} repository"]
    for _t, _w in (("kdense", "MIT"), ("gdm", "Apache-2.0"),
                   ("academic", "CC BY-NC 4.0")):
        _SRC_AXES.append(f"라이선스: {_t} matches {_w} across _sources and NOTICE")
    with section(check, results, *_SRC_AXES):
        src = json.loads(read(os.path.join(REFS, "_sources.json")))
        check("출처: _sources.json contains all three repositories",
              set(src) == {"kdense", "gdm", "academic"}, f"{sorted(src)}")
        for tag, meta in sorted(src.items()):
            d = os.path.join(REPOS, tag)
            check(f"출처: repos/{tag} exists", os.path.isdir(d))
            lf = meta.get("license_file", "")
            check(f"출처: {tag} complete license text is imported",
                  bool(lf) and os.path.exists(os.path.join(ROOT, lf)), lf or "undeclared")
            check(f"출처: {tag} pinned commit is recorded",
                  bool(meta.get("commit")), meta.get("commit", "missing"))
            check(f"출처: NOTICE identifies the {tag} repository",
                  meta.get("repo", "\x00") in notice, meta.get("repo", ""))

        # License **types** must agree between NOTICE and _sources.json;
        # changing only one side makes the notice false.
        for tag, want in (("kdense", "MIT"), ("gdm", "Apache-2.0"), ("academic", "CC BY-NC 4.0")):
            got = src.get(tag, {}).get("license", "")
            check(f"라이선스: {tag} matches {want} across _sources and NOTICE",
                  want.split()[0] in got and want in notice, f"_sources={got!r}")

    # (2) NC notice: the hardest failure in this skill to reverse.
    check("NC: NOTICE says academic prohibits commercial use",
          "NC prohibits commercial use" in notice)
    check("NC: NOTICE requires assessment before paid work such as procurement",
          "Assess this before using them for paid work" in notice)
    check("NC: NOTICE says the other two sources lack that restriction",
          "do not have that restriction" in notice)
    lic = read(os.path.join(REPOS, "academic", "LICENSE"))
    check("NC: complete academic LICENSE identifies CC BY-NC",
          "NonCommercial" in lic and "Creative Commons" in lic)

    # (3) Routing table to disk. A row pointing at a missing file breaks routing.
    rows = re.findall(r"(?m)^\|\s*`([a-z0-9_.-]+\.md)`\s*\|\s*(\d+)\s*\|", skill)
    check("Routing: file rows were parsed from the table", len(rows) >= 20, f"{len(rows)} rows")
    missing = [f for f, _ in rows if not os.path.exists(os.path.join(REFS, f))]
    check("Routing: every referenced file exists",
          not missing, f"missing {missing[:3]}")
    check_catalog_index(check, skill, src)
    check_vendor_count(check, src, skill, fm, notice)
    check_regen_behaviour(check)

    # Imported volume: a wholesale deletion otherwise leaves only the router.
    n_ref = len([f for f in os.listdir(REFS) if f.endswith(".md")])
    check("Import: at least 30 reference documents exist", n_ref >= 30, f"{n_ref} files")
    n_repo = sum(len(fs) for _, _, fs in os.walk(REPOS))
    check("Import: at least 2,000 repository files exist", n_repo >= 2000, f"{n_repo} files")

    # (4) Boundary: dedicated local skills own document output.
    check("Boundary: local owners for document output are identified",
          all(s in skill for s in ("`office`", "`hwpx`", "`deck`", "`diagram`")))
    skills_dir = os.path.dirname(ROOT)
    NAME = r"`([a-z][a-z-]{2,})`\s+handles\b"
    referred = sorted(set(re.findall(NAME, skill)))
    missing_s = [n for n in referred if not os.path.isdir(os.path.join(skills_dir, n))]
    check("Boundary: referral population is nonempty", len(referred) >= 3, f"{referred}")
    check("Boundary: every referral target exists", not missing_s, f"missing {missing_s}")

    # (5) Rationale for vendoring rather than pointers.
    check("Import rationale: team machines lack upstream files",
          "do not have those files" in notice)
    check("Import rationale: manual update cost is disclosed",
          "manual tracking of upstream updates" in notice)

    # **Apply all three axes to NOTICE.** Six needles alone allowed replacing the
    # rest of the file, including a forged license table or reversed NC notice.
    # A contract document previously had zero document-level contracts.
    _ref_axes(check, ROOT, "NOTICE", os.path.join(ROOT, "NOTICE"), notice, [
        "**NC prohibits commercial use.**",
        "Assess this before using them for paid work",
        "do not have that restriction",
        "manual tracking of upstream updates",
    ], NOTICE_FLOOR, "tests/refs", "Notice contract")

    # **Include rebuild-index.py in instrumentation.** Declaring a contract axis
    # with zero checks leaves the script unobserved. Because the script uses the
    # network, measure invariants whose divergence is necessarily wrong: upstream
    # URLs and output paths must match the documentation.
    idx = read(os.path.join(ROOT, "scripts", "rebuild-index.py"))
    # The script splits URLs across lines; join adjacent literals before comparison.
    joined = re.sub(r"'\s*\n\s*'", "", idx)
    check("Generator: upstream repositories match SKILL.md",
          "K-Dense-AI/scientific-agent-skills" in joined
          and "K-Dense-AI/scientific-agent-skills" in skill)
    check("Generator: catalog output path is below references/",
          "references/_kdense-catalog.md" in idx)
    check("Generator: catalog output exists",
          os.path.isfile(os.path.join(ROOT, "references", "_kdense-catalog.md")))
    check("Generator: SKILL.md documents this script path",
          "scripts/rebuild-index.py" in skill)
    check("Generator: update instructions require running the suite",
          "tests/run_tests.py" in skill and "NOTICE" in skill)
    check("Generator: missing dependency fails with pyyaml guidance",
          "pyyaml" in idx and "SystemExit" in idx)

    check_science_refs(check)
    check_credit_lines(check, src)
    check_catalog_identity(check)
    check_own_refs(check)
    check_stats_direction(check)
    check_repro_direction(check)
    check_tier_a_roster(check)
    check_roster_probe(check)

    # **Needles alone let a skeleton pass.** Retaining only needle lines deleted
    # 67–85% of the body while staying green (review 10). Line survival (70%),
    # volume, and blob binding catch that reduction.
    check_skill_body(check, ROOT, needles=[
        'vendors shallow clones',
        'follow its instructions exactly',
        'domain-specific scientific tools',
        'Use those existing skills by default.',
    ], floor=6466)

    # **Measure deletion regression last.** Calling it midway counted only 45 live
    # results while the copy ran all 122, giving the disappearance guard 77 free
    # results. Exclude the `스크립트 계약:` protocol prefix from both counts because
    # `check_script_contracts` skips itself in deleted-copy runs.
    _OFF = ("자기검사:", "계약 커버리지:", "스크립트 계약:")

    # 2026-09-07 repack control: unchanged clean copy 0/127 failures;
    # old alias-materializing copy 6/127 failures (academic 8 vs actual 4).
    # Those unrelated baseline failures were incorrectly included in old floors.
    # After six real index-consistency axes: normal 0/133; independently measured
    # deletions 7,18,6,27,9,23,9 and body 17. No count is subtracted at runtime.
    # Evidence: refactor/REPACK-VALIDATION-2026-09-07.md.
    # Script-contract axis: how many checks actually fail when a script is emptied.
    # Every floor is measured. Keep it last for the same reason as deletion
    # regression. Exclude `스크립트 계약:` symmetrically because this function
    # returns early from deleted-copy runs and emits no results under that prefix.
    check_script_contracts(check, __file__, ROOT,
                           # Measured with zero slack. The former value of 12
                           # came from an early return erasing two generator-behavior
                           # results; restoring their names exposes both failures.
                           scripts={"scripts/rebuild-index.py": 7},
                           live_ran=sum(1 for r in results
                                        if not r[0].startswith(_OFF)),
                           extra_skip=("스크립트 계약:",))

    # **Measure the roster checker separately.** Unlike other scripts, this file
    # emits its own results: 19 through `mod.run` and five through the probe.
    # Emptying it necessarily removes those results. Exclude only its prefixes
    # from both `ran` counts while retaining failures against the measured floor.
    #
    # **Per-file floors.** This skill previously had none for NOTICE,
    # `_sources.json`, or the three judgment documents, leaving 83 consuming checks
    # untouched by mutation. Adding them exposed two defects immediately: empty
    # `_sources.json` crashed the suite (121 results to one), and empty
    # `tier-a-verdicts.md` erased 18 results through an early return.
    #
    # **Do not include 39 catalogs here (`completeness=False`).** Generated catalog
    # counts, paths, and attribution cross-check each other, while `check_own_refs`
    # covers the three prose judgments. Each isolated copy also includes 38 MB of
    # `repos/`, about 15 seconds per file; 42 copies would exceed the tree budget.
    check_contract_coverage(
        check, __file__, ROOT,
        per_file={
            # Before the single-jstack path fix, the tier-A replacement check failed
            # in every isolated copy and inflated each floor by one. Count only
            # failures caused by the deletion itself.
            "NOTICE": 18,
            "references/_index.json": 6,
            "references/_sources.json": 27,
            "references/analysis-methodology.md": 9,
            "references/tier-a-verdicts.md": 23,
        },
        completeness=False,
        live_ran=sum(1 for r in results if not r[0].startswith(_OFF)),
        extra_skip=_OFF,
    )

    _ROSTER_OFF = _OFF + ("tier A: ", "tier A 로스터:")
    check_script_contracts(check, __file__, ROOT,
                           # Measured with zero slack. The old floor of 10 came
                           # from an `AttributeError` at the probe; fixing the crash
                           # exposed five additional failures.
                           scripts={"tests/test_tier_a_roster.py": 9},
                           live_ran=sum(1 for r in results
                                        if not r[0].startswith(_ROSTER_OFF)),
                           extra_skip=("스크립트 계약:", "tier A: ",
                                       "tier A 로스터:"))

    check_body_deletion(check, __file__, ROOT, minimum=17,
                        live_ran=sum(1 for r in results
                                     if not r[0].startswith(_OFF)))

    check_no_constant_assertions(check, __file__)
    check_total(check, results, 139)

    passed = sum(1 for _, ok, _ in results if ok)
    print(f"\n{passed}/{len(results)} 통과")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())
