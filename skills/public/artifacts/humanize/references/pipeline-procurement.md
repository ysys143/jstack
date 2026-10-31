# Pipeline: Korean Procurement Style

A four-agent pipeline correcting style, formatting, and text/visual integration
against the Korean public-procurement commitment register (`조달-확약 레지스터`).
Preserve content while correcting register drift, traceability-role confusion,
caption violations, broken text/visual integration, and Hard Rule violations.

**Scope:** RFP proposals for central ministries, local governments, public
institutions, and national/public research institutes.
**Outside scope:** Use proposal mode for academic research or grant proposals.

**Execution mode:** hybrid: sequential pipeline with parallel team verification.

## Phase 0: Check context

1. Check `_workspace/`.
2. Branch:
   - No `_workspace/` or new input: **new run**. Generate `run_id` as `YYYY-MM-DD-NNN`.
   - "특정 카테고리만", "2차 윤문", "{장}만", or "이 절만": **partial rerun**.
3. Verify loading of `procurement-taxonomy.md`, `caption-headnouns.md`, and `procurement-playbook.md`.
4. Collect project parameters, confirming with the user where possible:
   - RFP requirement-code system, such as `SFR`/`CNR`/`PER` or project-specific codes.
   - Chapter numbering: Roman, Arabic, Chinese characters, or custom.
   - Additional project-specific Hard Rules.

## Phase 1: Receive and normalize input

1. Save input to `_workspace/{run_id}/01_input.txt`.
2. Determine whether it is a whole file or a specific section.
3. Defaults:
   - `min_severity: S2`
   - `include_document_level: true`
   - `strict_hard_rule: true` (category O is always S1).

## Phase 1.5: Requirement traceability gate (stop gate)

When an RFP requirement-ID list is available, check coverage before detection or
rewriting. Style detection cannot find an ID absent from the text: there is no
string to match. Category L rule 4 corrects IDs used as grammatical subjects;
it does not detect missing requirements.

```
node ${JSTACK_PLUGIN_ROOT}/skills/humanize/scripts/req_coverage.js \
  --requirements <RFP ID list> --proposal _workspace/{run_id}/01_input.txt
```

- Exit 0: full coverage; proceed to Phase 2.
- Exit 1: uncovered requirements exist. **Stop the pipeline and report missing
  IDs first.** Rewriting cannot fill omissions; do not deliver it as complete.

  Still provide corrected text for covered requirements, explicitly labeled
  provisional, with `[미작성]` placeholders for missing IDs. The gate prevents
  mistaken completion; it does not make existing corrections worthless.
  Weakened commitments and unsupported modifiers remain defects. Fixing them
  allows the missing sections to be joined later.

  This behavior follows measurements: stopping after the gate report scored
  below the baseline without a gate (delta −0.67). In one turn the baseline
  supplied corrections, omission reporting, and placeholders. The earlier stop
  had incorrectly eliminated useful output.
- Exit 2: file error; check paths.

Without a requirement list, skip this phase and record the skip in the Phase 5
summary, as [the missing-check rule](../../verify/SKILL.md#a-missing-check-is-not-a-pass) requires.

If original and rewritten requirement data are available as JSON, also run:
```
node ${JSTACK_PLUGIN_ROOT}/scripts/content_contract.js \
  --before _workspace/{run_id}/01_source.json \
  --after _workspace/{run_id}/03_rewrite.json \
  --mode procurement --json
```
Requirement IDs cannot be duplicated, omitted, or added. Preserve required values,
strength, deliverables, and evidence sets for each ID. Array reordering is allowed,
but paraphrases changing value anchors fail. Changed natural language remains
`provisional` without independent review JSON and cannot be promoted to final.

## Phase 2: Detect

Invoke `korean-procurement-detector` with `Agent`.

Output: `_workspace/{run_id}/02_detection.json`.

**Gate:** If `detected_count == 0`, finish with "조달 문체 이탈 없음".

## Phase 3: Rewrite

Invoke `korean-procurement-rewriter`.
Apply categories in order: `O -> M -> L -> K -> N`.

Output: `_workspace/{run_id}/03_rewrite.md` and `03_rewrite_diff.json`.

**Gates:**

- `over_polish_warning: true` (edit rate >= 25%): proceed directly to Phase 4.
- `hard_rule_change: true` (attempted number, ID, or version changes): stop immediately.
- Stop immediately if `content_contract.js` reports altered per-ID typed values or evidence sets. Retain negation/strength reversals as semantic flags and keep output provisional without independent `verified` review.

## Phase 4: Parallel verification (agent team)

Create `procurement-review-team` with `TeamCreate`:

- `korean-procurement-fidelity-auditor` → `04_fidelity_audit.json` (15-item audit).
- `korean-procurement-naturalness-reviewer` → `05_naturalness_review.json` (remaining K–O findings and overediting).

Run `TeamDelete` after completion.

The fidelity-auditor JSON must bind original/rewrite hashes, proposition coverage,
changed ranges, evidence spans, and `verified`/`changed`/`uncertain` verdicts.
Without these bindings, preserve output as `provisional`.

### Phase 4 combined decision

| fidelity | naturalness | Decision | Follow-up |
|---|---|---|---|
| full_pass | accept / accept_with_note | **Final approval** | Phase 5 |
| full_pass | rewrite_round_2 | **Second rewrite** | Recall Phase 3 for target findings only |
| full_pass | rollback_and_rewrite | **Roll back and rewrite** | Instruct the rewriter to revert the edits |
| conditional_pass | - | **Retry only edits marked for rollback** | Recall Phase 3 |
| fail | - | **Complete rework** | Rerun all of Phase 3 |
| hard_rule_violation | - | **Stop** | Request user intervention |

At most 3 iterations.

## Phase 5: Final output

1. Copy the final rewrite to `_workspace/{run_id}/final.md`.
2. Create `_workspace/{run_id}/summary.md`.
3. Deliver:
   - Rewritten body.
   - Detection/correction counts for K/L/M/N/O.
   - 3–5 major before/after highlights.
   - Quality grade (A/B/C/D).
   - Summary of removed Hard Rule violations.

## Phase 6: Collect feedback

Handle feedback by type:

- Individual edit objection: revert and rewrite that edit.
- Category-wide objection: request a taxonomy severity adjustment.
- Project convention conflict: add an exception to `project_params`.

## Data flow

```
01_input.txt
    ↓ [korean-procurement-detector]      detection (K/L/M/N/O)
02_detection.json
    ↓ [korean-procurement-rewriter]      rewriting (O→M→L→K→N)
03_rewrite.md + 03_rewrite_diff.json
    ↓ [parallel team]
    ├→ [korean-procurement-fidelity-auditor]    → 04_fidelity_audit.json
    └→ [korean-procurement-naturalness-reviewer] → 05_naturalness_review.json
    ↓ [orchestrator decision]
    ├→ (rework) return to Phase 3
    └→ (approval) final.md + summary.md
```

## Quality grades

- **A:** 0 S1, at most 2 S2, score improvement 70%+.
- **B:** 0 S1, at most 4 S2, score improvement 50%+.
- **C:** 1–2 S1 or 2 overediting signals: second rewrite.
- **D:** At least 3 S1 or a Hard Rule violation: human review.

## Five categories (details in procurement-taxonomy.md)

| ID | Category | Representative pattern |
|---|---|---|
| K | Procurement/commitment register drift | Repeated `본 컨소시엄은`; mixed `-한다/-함` |
| L | Requirement traceability-role confusion | `{REQ-ID}은 ~로 설계됨` |
| M | Table/figure caption-format violations | Missing bold; endings outside the head-noun set |
| N | Broken text/visual integration | Broken three-part anchoring; C3 used as subject |
| O | Procurement Hard Rule violations | Vague expressions; external SaaS |

Apply rewriting in order: **O → M → L → K → N**.

## Constraints

- **Stop immediately on attempted Hard Rule violations.**
- **Requirement IDs are excluded from detection and rewriting.**
- **Preserve fixed technology-stack values and versions exactly.**
- **Edit rate above 25%: warn; above 40%: force a stop.**
