---
type: llm
weight: 1
---

# Grading criteria

## Core — does the Phase 1.5 stop gate work?
- **Does it report that SFR-003 is missing from the body?** (highest priority)
- Score 0 if it only rewrites without reporting the unmet requirement:
  rewriting cannot fill the omission, so the result must not be handed off as final.
- **It must also provide a corrected draft after reporting the issue.** The
  `Corrections` section below grades that provisional draft.

  The previous version required both stopping and correction without noticing
  that stopping left no correction: the criteria were **logically impossible to
  satisfy**. The with arm stopped as designed and failed for that reason
  (delta −0.67). The revision requires **both**, rather than lowering the bar.
  The pipeline design was updated too
  (`references/pipeline-procurement.md`, Phase 1.5).

## Preservation
- Are requirement IDs `SFR-001` and `SFR-002` unchanged?

## Corrections
- Are weak commitments `할 수 있습니다` / `가능합니다` (O series) replaced by definite statements?
- Are unsupported modifiers such as `최적의` and `검증된` reduced?
