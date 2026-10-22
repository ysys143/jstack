# Reproducibility protocol: seeds, environments, and data snapshots

<!-- sources -->
출처: `kdense` = [K-Dense-AI/scientific-agent-skills](https://github.com/K-Dense-AI/scientific-agent-skills) @ 36d8f13 (MIT)

## Why this document exists

**None of the 159 imported skills is dedicated to reproducibility.** The material
contains only two fragments: item 7 under "Statistical Integrity" in
`statistical-analysis` says to set seeds, report library versions, and keep a
runnable analysis script; `experimental-design` makes randomization schedules
reproducible from a seed. A central requirement for scientific work was left as
an ancillary instruction.

This document turns that instruction into a procedure shared across pipeline
stages: choose seeds during design, fix the environment during analysis, and
produce a manifest during reporting.

## Rule 1: seeds

**Identify every use of randomness and assign a fixed seed to each.** Missing even
one invalidates the claim that seeds were fixed. Common omissions include data
splits, bootstraps, cross-validation folds, initial values, and global state used
internally by libraries.

```python
SEED = 20260901
random.seed(SEED); np.random.seed(SEED)
rng = np.random.default_rng(SEED)      # Use Generator in new code
```

`experimental-design` already applies this discipline correctly: an allocation
schedule produced by `block_randomization(..., seed=42)` can be regenerated from
its seed, and upstream identifies this as a **trial registration requirement**.
Apply the same discipline by default throughout this skill.

**Report the seed alongside the results.** A seed recorded only in code leaves
readers of the report unable to identify the value used.

## Rule 2: pin the environment with a transitive lockfile

Upstream acknowledges this gap. After presenting pinned versions,
`exploratory-data-analysis/SKILL.md:55` states:

> These pins are a dated direct-dependency snapshot, not a transitive lockfile.

**Direct dependency pins do not establish reproducibility.** Installing the same
pandas 3.0.5 can resolve different indirect dependencies at different times.
Those lower layers, including BLAS implementations and compiled kernels, often
change numerical results.

| Requirement | Artifact | Acceptance criterion |
|---|---|---|
| **Required** | One of `uv.lock`, `poetry.lock`, or `requirements.txt --require-hashes` | Must pin hashes as well |
| **Required** | Python interpreter version (`.python-version` or a declaration in the lockfile) | The pinned-version table already requires 3.12+ |
| Recommended | Container image digest (`sha256:`, not a tag) | Tags can move |
| Recommended | OS, CPU architecture, and BLAS implementation | These can affect floating-point results |

`general_scientific_formats.md:230` likewise says to "record a lockfile for a real
analysis". Both places state the requirement without a procedure; the table above
supplies that procedure.

## Rule 3: data snapshots and provenance

**Keep originals immutable and identify copies by hash.** If an analysis script
overwrites the original data, the object to be reproduced is lost.

Record five fields:

1. **Acquisition date**: external databases change daily.
2. **Version or release**: preserve the upstream identifier, such as a UniProt release, ClinVar distribution date, or ChEMBL number.
3. **Content hash**: a `sha256` for each file. Names and sizes are not evidence.
4. **Access path**: the URL or complete query. Saying data was downloaded does not explain how to reproduce it.
5. **Row and column counts**: let the reproducer spot truncated snapshots immediately.

The 38 GDM skills are stronger here: their `No Hallucinations` rule requires tool
outputs and prohibits inventing values from native knowledge. That is a provenance
rule. The five fields above apply the same discipline to data.

## Rule 4: rerun the analysis with one command

A notebook is an artifact, not a procedure. **Results that depend on cell execution
order are not reproducible.** The minimum requirement is that a fresh checkout,
an environment created from the lockfile, and **one command** regenerate the tables
and figures.

```bash
uv sync --frozen && python3 analysis/run_all.py --seed 20260901
```

## Rule 5: collect the evidence in one manifest

The first four rules cannot be audited when their evidence is scattered. Keep one
manifest beside the outputs.

```json
{
  "run_id": "2026-09-01T09:00:00+09:00",
  "seed": 20260901,
  "env": {"lock": "uv.lock", "lock_sha256": "...", "python": "3.12.8"},
  "data": [
    {"path": "data/raw/cohort.csv", "sha256": "...", "acquired": "2026-08-30",
     "source": "https://...", "release": "2026-08", "rows": 12043}
  ],
  "code": {"commit": "...", "entrypoint": "analysis/run_all.py"},
  "outputs": [{"path": "figs/fig1.svg", "sha256": "..."}]
}
```

## Review checklist

- [ ] Every use of randomness has been identified and seeded.
- [ ] The seed value appears in the report body.
- [ ] The lockfile is transitive and includes hashes.
- [ ] The interpreter version is pinned.
- [ ] Every data file has a hash, acquisition date, release, and access path.
- [ ] Analysis does not modify original data.
- [ ] One command reruns the entire analysis.
- [ ] The manifest and outputs belong to the same commit.

**Do not claim reproducibility if any item is missing.** Partial reproduction does
not meet this claim; the wording would give reviewers more confidence than the
evidence supports.

## Value in procurement

Proposal methodology and demonstration data may need substantiation during review.
With this manifest, substantiation requires opening one file. Without it, the
analysis may need to be rerun. **The reproducibility protocol reduces the cost of
substantiating results as well as meeting academic expectations.**
