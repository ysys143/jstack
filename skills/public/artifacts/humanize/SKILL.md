---
name: humanize
description: "Edit prose, remove AI tells, write up findings. Triggers: 고쳐줘, 다듬어줘, 윤문, 조사 보고서."
---

# Humanize — editing orchestrator

## Default direct execution

Choose the execution level before the language rules. Select `direct` when the
requested output is Korean or English and the user makes an unqualified edit
request such as `고쳐줘`, `다듬어줘`, `윤문해줘`, `말투 다듬어줘`, `영문 윤문해줘`,
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
do not continue into the ASD baseline, mode detection, scripts, workspaces,
hashes, reviewers, scoring, or status labels below.

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


## Phase 0: detect the mode

Analyze the input and request, then select one of five modes. Identify language
before genre: Korean taxonomy does not fire on English body text.

| Signal | Selected mode |
|----------|----------|
| "ASD-STE100", "Simplified Technical English", "STE로 써줘", "STE 준수 검사", "STE 원칙으로 다듬어줘", or "controlled technical English" | `technical-clarity` |
| "RFP", "조달", "제안서", "본 컨소시엄", "요구사항 ID", "캡션", "삼단 정박", "발주기관", "공공기관", category codes "K-1" through "O-" | `procurement` |
| "연구계획서", "grant", "연구비", "methodology", "논증", "심사위원", "research proposal", "신청서" | `proposal` |
| English body text for a non-direct request, or "humanize this English text", "remove AI tells", "make this sound human", "영어 AI 티", category prefix "EN-" | `english` |
| Other requests to remove AI tells from Korean text | `general` |

If ambiguous, ask which text type applies: technical clarity, general Korean
AI-tell removal, public procurement proposal editing, research proposal review,
or English AI-tell removal.

## Run the selected mode

Load and execute only the selected pipeline.

- **clean-current-state**: read `references/clean-rewrite.md`. Establish the
  bounded fact inventory and occurrence plan before mutation. Commit a verified
  candidate only through the reference's exact-target conditional-write gate.
- **bloat-only**: read `references/debloat.md`. Compress only the selected
  artifact while preserving its claims, caveats, relationships, and voice.
- **move-only**: read `references/reorder.md`. Apply the requested stable
  permutation to exact units; verify their bytes and multiplicities afterward.
- **general**: `${JSTACK_PLUGIN_ROOT}/skills/humanize/references/pipeline-general.md`, Phases 0–6.
- **procurement**: `${JSTACK_PLUGIN_ROOT}/skills/humanize/references/pipeline-procurement.md`, Phases 0–6.
- **proposal**: `${JSTACK_PLUGIN_ROOT}/skills/humanize/references/pipeline-proposal.md`.
- **english**: `${JSTACK_PLUGIN_ROOT}/skills/humanize/references/en-body.md`; detection rules are in `${JSTACK_PLUGIN_ROOT}/skills/humanize/references/en-taxonomy.md`.
- **technical-clarity**: `${JSTACK_PLUGIN_ROOT}/skills/humanize/references/asd-ste100.md`; follow the mode and conformance contract below.

### Technical-clarity contract

Use this mode to make technical information unambiguous. Do not use the
standard's name as a vague request for concise prose.

| Input and request | Submode | Permitted status |
| --- | --- | --- |
| English technical procedure or description, with the official Issue 9 rules and controlled dictionary available for checking | `strict` | `ASD-STE100 checked` after all checks pass |
| English technical text without complete dictionary verification | `rule-aligned` | `ASD-STE100 rule-aligned; vocabulary unverified` |
| Korean, another language, or general-purpose prose | `principles` | `STE-informed rewrite; not ASD-STE100 compliant` |
| Review without an edit request | `audit` | Findings only; do not rewrite |

Read `references/asd-ste100.md` for every submode. For each section, identify
whether it is procedural, descriptive, or a safety instruction and apply the
rules for that text type instead of flattening the document into one style.

Before editing, record immutable content: facts, numbers, units, identifiers,
proper names, quotations, URLs, code, requirements, modality, negation,
conditions, and uncertainty. Preserve Markdown structure unless changing it
directly improves the requested technical format. Make the actor, action,
object, condition, and result explicit where the source establishes them.
Never invent an actor to force active voice.

Use one term for one item. Give each procedural sentence one action and put a
prerequisite before the action that depends on it. In descriptive prose, split
a sentence only as `references/asd-ste100.md` allows, so that no condition
leaves its claim. Use a vertical list for parallel conditions, choices, or
results that the reader checks one by one. Compare the candidate
with the immutable content. Repair any changed fact, logical scope, requirement
strength, or safety consequence before delivery.

For an edit request, return the edited artifact in the user's requested format.
Keep conformance notes outside that artifact unless the user asked for a report.
If the user asks for only the rewritten body, do not append a status label.

The controlled dictionary is part of ASD-STE100. A model's recollection or a
writing-rules-only pass cannot establish full compliance. Use the current
official Issue 9 document when strict checking is requested, and report any
unverified vocabulary separately. Never describe output as certified by ASD
without an external certification process that actually grants that status.

Do not package, republish, or quote substantial portions of the official PDF.
It is freely obtainable from ASD, but its copyright notice restricts
redistribution. The reference records the official sources and the operational
summary used here. When another Humanize mode or spelling check follows this
mode, preserve its terminology, logic, and safety constraints.

## References by mode (load only as needed)

| File | Mode |
|------|----------|
| `references/clean-rewrite.md` | Explicit clean-current-state rewrite |
| `references/debloat.md` | Explicit bloat-only edit |
| `references/reorder.md` | Explicit move-only reordering |
| `references/research-report.md` | Narrative research, investigation, analysis, or technical report |
| `references/ai-tell-taxonomy.md` | general |
| `references/rewriting-playbook.md` | general |
| `references/procurement-taxonomy.md` | procurement |
| `references/procurement-playbook.md` | procurement |
| `references/caption-headnouns.md` | procurement |
| `references/en-taxonomy.md` | english |
| `references/en-body.md` | english |
| `references/asd-ste100.md` | technical-clarity |
| `references/register-axis.md` | All modes: register classification and the `적용_서법:` field |
| `references/gaejosik.md` | procurement, general: fragment-style thresholds and scope |
| `references/register-invariants.md` | All modes: mutable/immutable boundaries and delta audit |
| `references/improvement-protocol.md` | All modes: improvement measurement and promotion |
| `references/code-space.md` | All modes: code namespace conventions |
| `references/taxonomy-codespace.md` | All modes: code allocation ledger |

## Shared invariants

- Semantic preservation takes precedence. Do not alter content in any mode.
- Numbers, proper names, direct quotations, and requirement IDs are excluded from detection and rewriting.
- Preserve genre; each pipeline defines its genre rules.
- Warn or stop when the edit-rate threshold is exceeded; each pipeline defines its threshold.
- Register precedes genre. Mode selection chooses a pipeline, while paragraph-level
  decisions follow `references/register-axis.md`. Without a rule's `적용_서법:`
  field, defer firing in `개조식-무어미` and `캡션-무어미` registers.
- Read codes with their prefixes. Both taxonomies reuse letters; output category
  codes must follow `references/code-space.md`.

## Records and checks

| Purpose | File |
|------|------|
| Procurement field outcomes, one project per line | `outcomes.jsonl` |
| Full measurement-code re-audit | `scripts/audit_measures.js` |
| Shared taxonomy parsing and normalization | `scripts/taxonomy_rules.js` |
| Register-axis contract | `tests/test_register_axis.js` |
| E-2 exemption contract | `tests/test_e2_exemption.js` |
| Human-voice rule exemption contract | `tests/test_noslop_exemptions.js` |
| Fragment-style attribution contract | `tests/test_gaejosik_attribution.js` |
| Field-outcome schema contract | `tests/test_outcomes_schema.js` |
| Content preservation: anchors, procurement IDs, review binding | `${JSTACK_PLUGIN_ROOT}/scripts/content_contract.js` |
