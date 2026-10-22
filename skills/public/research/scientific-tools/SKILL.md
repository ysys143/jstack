---
name: scientific-tools
description: "Route science tasks to specialist skills: biology, chemistry, medicine, stats. Triggers: 과학 도구."
---

# Science & Research Skill Router

Organizes 201 child skills hierarchically. Child skills are not registered in the
skill list, so overlapping names do not collide.

**[local] Boundaries within this plugin.** Some child skills produce documents,
but dedicated skills own those outputs: `office` handles Office documents, `hwpx`
handles HWPX, `deck` handles slide typesetting, and `diagram` handles diagrams.
Use this router for **domain-specific scientific tools**: biological, chemical,
and medical databases, simulations, and experimental design.

## Procedure

1. Choose **one** domain file from the routing table that matches the request.
2. Read `references/<file>` to identify candidate skills.
3. Read SKILL.md at the selected skill's `path` and **follow its instructions exactly.**
4. If the domain is unclear, browse the full catalog in `references/_index.json`.

Open only one domain file at a time. Do not preload several files.

## Prefer jstack skills

These requests have a jstack owner. **Use that skill by default**; this router only
supplements it where the last column says so.

| Request | jstack skill | When to use this router |
|---|---|---|
| DOCX, XLSX, or PPTX processing | `office-documents` | Only for parsing specific to scientific papers |
| Deep research and literature review | `research` (it decides when the `hyperresearch` path is warranted) | For a domain database or tool the research needs |

## Routing table

| File | Count | Domain |
|---|---|---|
| `biological-databases-deepmind.md` | 38 | Biological Databases (DeepMind) |
| `bioinformatics-genomics.md` | 24 | Bioinformatics & Genomics |
| `machine-learning-deep-learning.md` | 18 | Machine Learning & Deep Learning |
| `analysis-methodology.md` | 12 | Analysis & Methodology |
| `scientific-communication-publishing.md` | 11 | Scientific Communication & Publishing |
| `cheminformatics-drug-discovery.md` | 9 | Cheminformatics & Drug Discovery |
| `data-analysis-visualization.md` | 9 | Data Analysis & Visualization |
| `scientific-databases-data-access.md` | 9 | Scientific Databases & Data Access |
| `engineering-simulation.md` | 6 | Engineering & Simulation |
| `research-methodology-proposal-writing.md` | 6 | Research Methodology & Proposal Writing |
| `protein-engineering-design.md` | 5 | Protein Engineering & Design |
| `academic-paper-pipeline.md` | 4 | Academic Paper Pipeline |
| `medical-imaging-digital-pathology.md` | 4 | Medical Imaging & Digital Pathology |
| `clinical-documentation-decision-support.md` | 3 | Clinical Documentation & Decision Support |
| `data-management-infrastructure.md` | 3 | Data Management & Infrastructure |
| `decision-scenario-analysis.md` | 3 | Decision & Scenario Analysis |
| `document-processing-conversion.md` | 3 | Document Processing & Conversion |
| `materials-science-chemistry.md` | 3 | Materials Science & Chemistry |
| `neuroscience-electrophysiology.md` | 3 | Neuroscience & Electrophysiology |
| `workflow-platforms-cloud-execution.md` | 3 | Workflow Platforms & Cloud Execution |
| `electronic-lab-notebooks-eln.md` | 2 | Electronic Lab Notebooks (ELN) |
| `laboratory-automation.md` | 2 | Laboratory Automation |
| `phylogenetics-evolutionary-biology.md` | 2 | Phylogenetics & Evolutionary Biology |
| `proteomics-mass-spectrometry.md` | 2 | Proteomics & Mass Spectrometry |
| `regulatory-standards-evidence-preparation.md` | 2 | Regulatory & Standards Evidence Preparation |
| `tool-discovery-computational-resources.md` | 2 | Tool Discovery & Computational Resources |
| `web-search-information-retrieval.md` | 2 | Web Search & Information Retrieval |
| `agent-frameworks.md` | 1 | Agent Frameworks |
| `autonomous-research-optimization-frameworks.md` | 1 | Autonomous Research & Optimization Frameworks |
| `cloud-platforms-for-genomics-biomedical-data.md` | 1 | Cloud Platforms for Genomics & Biomedical Data |
| `healthcare-ai-clinical-machine-learning.md` | 1 | Healthcare AI & Clinical Machine Learning |
| `laboratory-automation-equipment-control.md` | 1 | Laboratory Automation & Equipment Control |
| `laboratory-information-management-systems-lims-r-d-platforms.md` | 1 | Laboratory Information Management Systems (LIMS) & R&D Platforms |
| `microscopy-bio-image-data.md` | 1 | Microscopy & Bio-image Data |
| `pharmacology-pharmacometrics.md` | 1 | Pharmacology & Pharmacometrics |
| `preclinical-research-animal-welfare.md` | 1 | Preclinical Research & Animal Welfare |
| `protocol-management-sharing.md` | 1 | Protocol Management & Sharing |
| `uncategorized.md` | 1 | Uncategorized |

## Local decisions: three overrides to upstream guidance

The imported material belongs to its authors and is mostly sound, but three areas
require overrides. In the following situations, read the local reference
**before reading the upstream SKILL.md**.

| When | Read | What it overrides |
|---|---|---|
| Group comparisons, post-hoc tests, or Bayesian t-tests | `references/stats-corrections.md` | Four errors in upstream `statistical-analysis`: remove variance-pretest branching (always default to Welch); describe Mann-Whitney U as stochastic superiority; remove the omnibus gate; use Kruschke BEST for Bayesian t-tests |
| Handing off or substantiating an analysis | `references/reproducibility.md` | None of the 201 imported skills is dedicated to reproducibility. This reference supplies procedures for seeds, a transitive lockfile, data snapshots, and a manifest |
| Deciding which child skills to keep readily available | `references/tier-a-verdicts.md` | Tier A promotion was category-wide. Individual assessment of 15 skills retains only 5–6 and excludes five that directly overlap with local skills |

`tests/test_tier_a_roster.js` checks roster consistency against actual files under
`repos/` and the source tags in `_sources.json`.

## Updating

**[local] The imports cannot be updated with `git pull`.** Their `.git`
directories were removed during import (38M, 2681 files). To follow upstream
updates, clone the three repositories again, rebuild the index, and replace the
imported content in this skill with the result.

```bash
# 1) Clone upstream repositories into a temporary location (see NOTICE for pinned commits)
git clone --depth 1 https://github.com/K-Dense-AI/scientific-agent-skills /tmp/u/kdense
git clone --depth 1 https://github.com/google-deepmind/science-skills        /tmp/u/gdm
git clone --depth 1 https://github.com/Imbad0202/academic-research-skills    /tmp/u/academic

# 2) Rebuild the index using the imported scripts/
node ${JSTACK_PLUGIN_ROOT}/skills/science/scripts/rebuild-index.js
```

After updating, run `tests/run_tests.js`. It fails if the routing table diverges
from the actual references. Update the pinned commits in `NOTICE` as well.

## Sources and licenses

This skill **vendors shallow clones** of the following repositories. Their
content belongs to the original authors. This skill adds only the router
(`SKILL.md`), index (`references/`), and regeneration scripts (`scripts/`).

| Tag | Repository | Skills | Pinned commit | License |
|---|---|---|---|---|
| `kdense` | [K-Dense-AI/scientific-agent-skills](https://github.com/K-Dense-AI/scientific-agent-skills) | 159 | `36d8f13` (2026-08-24) | MIT |
| `gdm` | [google-deepmind/science-skills](https://github.com/google-deepmind/science-skills) | 38 | `0b42509` (2026-07-07) | Apache-2.0 |
| `academic` | [Imbad0202/academic-research-skills](https://github.com/Imbad0202/academic-research-skills) | 4 | `9469fc4` (2026-08-27) | CC BY-NC 4.0 |

The full original license texts are preserved in each repository:

- `repos/kdense/LICENSE.md`
- `repos/gdm/LICENSE`
- `repos/academic/LICENSE`

GitHub did not recognize `repos/academic` as having a standard license, but reading
its complete `LICENSE` confirmed **CC BY-NC 4.0** (Copyright (c) 2026 Cheng-I Wu).
NC prohibits commercial use; assess this before using it for paid work. See
`NOTICE` for the supporting evidence.

`repos/academic/skills/<name>` entries are **directory symlinks** to `../<name>`.
Do not count symlinks as additional skills: there are four actual skills, bringing
the total to 201.

Machine-readable source metadata is in `references/_sources.json`.
