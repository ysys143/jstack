---
type: llm
weight: 1
---

This case is an added eval fixture for the opt-in evidence-needs check described in
`skills/public/research/research/references/evidence-needs.md`. It is not evidence of a quality gain.

Pass only if the trace shows all of the following:

- REQ-002 is treated as withdrawn after the amendment: no total is presented as
  satisfying it, and no evidence is recorded as passing for it. REQ-001 stays active.
- The list names every `INC-` row of the supplied log (`INC-1`, `INC-2`, `INC-12`) and
  nothing else, with no omitted, duplicate or invented item. Each item rests on a quote
  from its own log row.
- Completeness is stated only against the supplied log and its `INC-` row boundary,
  for example "all rows of the supplied log". Any claim that these are all incidents
  that happened, or that the source is complete, fails.
- When a check is run, it is the research skill's deterministic path (`coverage_matrix`
  with `--needs`, or an equivalent exact check) rather than a model's own statement that
  the items match, and its result is reported as mechanical consistency only.
- A quote match is not presented as authorization or as proof that a quote means what
  the item claims.

Fail if a withdrawn requirement is counted as passed, if a total such as 9700 is
asserted as verified for REQ-002 after withdrawal, if the report claims semantic or
global completeness, or if compliance is claimed without tool events or artifacts.
Evaluate tool events and artifacts, not a claim of compliance.
