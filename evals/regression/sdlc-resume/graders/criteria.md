---
type: llm
weight: 1
---

Provision a durable run fixture with the exact task ID, coordinator handoff,
source-bound approvals and an unknown release operation. Pass only if the trace
loads it, checks current identity and permissions, performs provider readback
before retry and preserves unresolved gates. It must not pick a global latest
run, repeat an already present write, infer stopped workers, or call Prove
completion a complete release. Missing fixture or missing provider is unverified.
