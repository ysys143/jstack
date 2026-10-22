---
type: llm
weight: 1
---

# Grading criteria — meaning preservation without excessive rewriting

Other graders check individual words (preserving numbers and correcting specific
expressions). **This grader checks only two conditions.** Both must hold to pass.

## Original

> 본 연구는 단순히 데이터를 수집하는 것이 아니라, 수집된 데이터를 체계적으로
> 분석함으로써 유의미한 통찰을 도출하는 것을 목표로 한다. 이러한 접근은 기존
> 방법론과 결이 다르며, 향후 연구의 새로운 지평을 열 것으로 기대된다.
> 분석 대상은 2024년 1월부터 12월까지의 거래 기록 1,284건이다.

## 1. The argument's direction survives

The original claim is **"analysis, rather than collection, is the objective"**.
Pass if the rewrite conveys that direction, regardless of sentence splitting,
word order, or vocabulary changes.

## 2. The change stays within stylistic correction

Pass if it states the same facts and claims **in different sentences**.

Stronger or weaker expression **passes**: removing clichés naturally changes
intensity, and banning that change would make correction impossible.

## Failure (FAIL)

Fail if any condition below applies. **Otherwise, pass.**

- The argument reverses: collection appears to be the objective instead of analysis.
- It introduces **facts or claims absent from the original** (rephrasing does not count).
- One of the original's three sentences disappears entirely.
- The rewrite becomes colloquial ("~거든요", "~죠", "~네요").
- It refuses to rewrite or returns the original unchanged.

<!--
Maintenance notes (not grading criteria)

The six word-level items moved to their own regex graders: `block`,
`keep_period`, `keep_count`, `fix_antithesis`, `fix_metaphor`, `fix_cliche`,
and `fix_means`. When this file graded the six together, the artifacts
contained only three `judgeVotes` booleans, hiding which requirement failed.

**Calibrated with an answer key.** A probe case printed a handwritten ideal
output verbatim for this grader. The first revision rejected the key 3–0,
showing that the instrument, rather than the target, was broken. Three fixes:

  1. Maintenance prose led the document. Grading criteria instruct the judge;
     naming the target expressions leaks answers. Move that prose into a comment.
  2. Every clause referred to what was present or absent in the original,
     but **the original was missing**. Include it.
  3. There were three failure blocks and an abstract passing condition
     ("reads as the same person saying the same thing better"). The working
     `criteria.md` for deck uses concrete passing conditions and one failure
     section. Adopt that form. In particular, remove "fail if another metaphor
     is introduced": removing clichés naturally changes intensity, and
     forbidding that leaves no passing answer.

**The answer-key probe itself was broken three times.** Its prompt said to
"print the following text verbatim", but **the LLM judge sees the prompt as
well as the response**. The judge therefore saw a copying task paired with
rewriting criteria, making any supplied answer fail. Replacing the prompt
with the actual rewriting task gave the same key 0.67 (2 passes in 3 runs;
the remaining run had a max_turns error).

Thus fixes 1–3 were made while using a broken measuring instrument to repair
that instrument. All three fixes were independently valid, but this probe
could not establish which one worked.

When repairing an instrument, first make the answer key pass. If **the key
fails, question the key first**: failure alone does not identify whether the
target, instrument, or key is broken.
-->
