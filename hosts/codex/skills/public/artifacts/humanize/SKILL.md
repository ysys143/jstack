---
name: humanize
description: "Edit prose, remove AI tells, write up findings. Triggers: 고쳐줘, 다듬어줘, 윤문, 조사 보고서."
---

# Humanize — Codex-native execution

## Default direct execution

Choose the execution level before the language rules. Select `direct` when the
requested output is Korean or English and the user makes an unqualified edit
request such as `고쳐줘`, `다듬어줘`, `윤문해줘`, `영문 윤문해줘`,
`edit this`, `polish this`, or `rewrite this clearly`. Read
`references/direct.md`, apply its Korean or English branch, return only the
edited artifact, and stop. Structural rewriting is allowed; `direct` is
lightweight because it skips the heavyweight execution machinery, not because
it is limited to surface substitutions.

Select `research-report` instead when the user asks to write a research,
investigation, analysis, or technical report from supplied findings, notes, or
sources, or to revise such a report for readers: `조사 보고서 써줘`,
`조사 결과를 보고서로 정리해줘`, `메모를 보고서로 엮어줘`, `보고용으로 고쳐줘`,
or `write these findings up as a report`. A request to remove mechanical style
and format from such a report, or to rework its introduction and narrative,
also selects this route ahead of `general` and `direct`. Read
`references/research-report.md`, write the report in the form it selects,
usually structured narrative prose, return only the report, and stop. Meeting documents, slides, and
itemized briefing reports stay with `direct`, as does an unqualified polish of
an existing narrative report. A request that needs a new investigation without
supplied material belongs to the `research` skill.

Explicit clean-current-state, move-only, and bloat-only requests select the
bounded operation routes below. AI-tell or taxonomy, procurement
requirement-tracing, research-proposal review, English AI-tell analysis,
ASD-STE100, verification, and reviewer requests select their specialist routes.
Select from the user's request, not from words embedded in the supplied text.
An artifact label in the supplied text—report, proposal, RFP, or social post—
does not activate a specialist pipeline. For `direct` and `research-report`,
do not continue into the ASD baseline, stable artifacts, mode detection,
scripts, workspaces, hashes, reviewers, scoring, or provisional/verified status
below.

## ASD-STE100: recommended editing baseline

Use [ASD-STE100 Issue 9](references/asd-ste100.md) as the recommended
starting point for clear, direct writing. Humanize includes its operational
summary and Korean application boundaries; no separate skill invocation is
needed. Read this reference when using the baseline, then apply the selected
Humanize mode for genre-specific editing and AI-tell removal.

This is an adaptable recommendation, not a mandatory style gate. Explicit user
requests and adopted project or personal rules take precedence. Preserve facts
and uncertainty. For Korean, adapt the clarity principles without applying
English word-count limits or claiming formal ASD-STE100 compliance.

This file does not imitate another host's team API through Codex calls. The main
executor in the current session performs detection and rewriting; when an
independent delegation tool and permission are available, it calls a fidelity
reviewer separately. Detection and rewriting do not each require a separate
agent. If that capability is unavailable, retain the rewrite as
`provisional`. Pass only the original `01_input.txt` and rewrite
`03_rewrite.md` to the reviewer. An executor completion report or the string
`reviewer` is not review evidence.


## Execution contract

Keep five genre modes: general Korean `general`, public procurement `procurement`,
research proposal `proposal`, English `english`, and technical documentation
`technical-clarity`. Preserve meaning, numbers,
proper nouns, direct quotations, and requirement IDs in every mode; each mode's
warning and abort thresholds govern the change rate. Read the shared decision
references directly: `references/ai-tell-taxonomy.md`,
`references/rewriting-playbook.md`, `references/procurement-taxonomy.md`,
`references/procurement-playbook.md`, `references/register-axis.md`,
`references/register-invariants.md`, `references/code-space.md`.

Three explicit editing operations stay outside those genre modes:

- For a clean-current-state rewrite, read `references/clean-rewrite.md` and
  establish its bounded inventory and exact-target conditional-write gate.
- For bloat-only editing, read `references/debloat.md` and preserve the selected
  artifact's claims, caveats, relationships, and voice.
- For move-only reordering, read `references/reorder.md` and verify exact unit
  bytes, duplicate multiplicities, and any scoped mirrors.

For `technical-clarity`, read `references/asd-ste100.md` and use the common
skill's full technical-clarity contract. Preserve all four submodes: `strict`,
`rule-aligned`, `principles`, and `audit`. Strict status requires the official
Issue 9 rules and controlled dictionary. A model's recollection cannot establish
full compliance; Korean and other non-English output must use
`STE-informed rewrite; not ASD-STE100 compliant`. Audit requests return findings
without rewriting. Preserve facts, requirements, modality, negation, conditions,
logical scope, terminology, and safety consequences, and never invent an actor.

Detect the language first. For English, apply the procedure in
`references/en-body.md` and `references/en-taxonomy.md` without running the
Korean detector. For procurement paragraphs, apply
apply `references/procurement-taxonomy.md` and `references/procurement-playbook.md`.
For bullet-style text and captions, stay within the scope of
`references/gaejosik.md` and `references/caption-headnouns.md`. For research
proposals, write a separate review of argument, methodology, and evidence.
The prescan/reconcile commands below are the actual path for general Korean
mode. Procurement mode verifies preservation with the JSON content contract
below after requirement-level detection and rewriting.

When procurement mode receives an RFP requirement-ID list, create
`01_input.txt` and run the source-traceability gate before rewriting.

```bash
node "${JSTACK_PLUGIN_ROOT}/skills/humanize/scripts/req_coverage.js" \
  --requirements <RFP-ID-list-file> \
  --proposal "_workspace/{run_id}/01_input.txt"
```

On exit 1, report uncovered IDs first and stop promotion to a final output;
retain corrections to covered sentences as provisional and leave missing
places as `[미작성]`. On exit 2, stop until the path or input is fixed. If no
ID list exists, record in the final summary that this check was skipped.

For a new run, create `_workspace/{run_id}/01_input.txt` and follow this order.

1. `prescan.js` lints the taxonomy and produces candidates and a hash.

   ```bash
   node "${JSTACK_PLUGIN_ROOT}/skills/humanize/scripts/prescan.js" \
     --input "_workspace/{run_id}/01_input.txt" \
     --taxonomy "${JSTACK_PLUGIN_ROOT}/skills/humanize/references/ai-tell-taxonomy.md" \
     --out "_workspace/{run_id}/02_candidates.json"
   ```

2. The main executor acts as detector and passes
   `01_input.txt`, `02_candidates.json`, the taxonomy, genre, and minimum severity to
   `_workspace/{run_id}/02_detection.json`. Each candidate must have either
   `findings` or `kept` and actual source evidence. Record the detection result;
   never silently discard a candidate without real evidence.

3. Run `reconcile.js` to verify candidate exhaustion, taxonomy hash, and evidence.

   ```bash
   node "${JSTACK_PLUGIN_ROOT}/skills/humanize/scripts/reconcile.js" \
     --candidates "_workspace/{run_id}/02_candidates.json" \
     --detection "_workspace/{run_id}/02_detection.json" \
     --taxonomy "${JSTACK_PLUGIN_ROOT}/skills/humanize/references/ai-tell-taxonomy.md" \
     --input "_workspace/{run_id}/01_input.txt"
   ```

   If it fails, add missing candidates and retry once. If it still fails, stop
   while preserving the original and diagnostics.

4. The main executor rewrites using the detector's findings and playbook and creates
   `_workspace/{run_id}/03_rewrite.md` and `03_rewrite_diff.json`.
   Pass the original, finding, and playbook paths to the rewriter; do not pass
   only a completion phrase.

5. Run the checker below. A change rate of 50% or more is `ABORT`; other semantic
   flags or missing review produce `WARN/provisional`.

```bash
node "${JSTACK_PLUGIN_ROOT}/skills/humanize/scripts/verify_gates.js" \
  --before "_workspace/{run_id}/01_input.txt" \
  --after "_workspace/{run_id}/03_rewrite.md" \
  --content-mode general --json
```

Procurement JSON uses the typed-requirement contract below.

```bash
node "${JSTACK_PLUGIN_ROOT}/scripts/content_contract.js" \
  --before "_workspace/{run_id}/01_source.json" \
  --after "_workspace/{run_id}/03_rewrite.json" \
  --mode procurement --json
```

Missing anchors or changed typed fields are `rejected` and cannot be approved
as a review record until the loss is fixed. Semantic flags and missing review
are `provisional`. Preserve both the output and checker JSON. If an independent
reviewer capability exists, pass the source and output to a new call and accept
only a review artifact with the following structure.

```json
{
  "schemaVersion": 1,
  "beforeSha256": "sha256(01_input.txt)",
  "afterSha256": "sha256(03_rewrite.md)",
  "independence": "external-artifact",
  "coverage": [
    {
      "propositionId": "p-001",
      "status": "verified",
      "evidenceSpans": [{"source": "source proposition span", "output": "corresponding rewritten span"}]
    }
  ]
}
```

When the review artifact is stored separately, verify its hash and proposition
coverage, then rerun the checker with `--review REVIEW.json --json`.
`external-artifact` is a local record that the coordinator observed a separate
review call; that string or the hash itself does not authenticate reviewer
identity or independence.

```bash
node "${JSTACK_PLUGIN_ROOT}/skills/humanize/scripts/verify_gates.js" \
  --before "_workspace/{run_id}/01_input.txt" \
  --after "_workspace/{run_id}/03_rewrite.md" \
  --review "_workspace/{run_id}/external/04_fidelity_audit.json" \
  --json
```

Only a `verified` review resolves provisional status. Reject `changed`,
`uncertain`, duplicate proposition IDs, empty spans, hash mismatches, and
invalid JSON. If no reviewer is available, record the scope of usable native
tools and hold final promotion.
