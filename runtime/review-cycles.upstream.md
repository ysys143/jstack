# Review repetition provenance

- Upstream: <https://github.com/JinHo-von-Choi/anti-samcheonpo>
- Inspected commit: `e829be8deac411e6802a32c62cae318c92ec6b42`.
- Inspected source: `internal/detect/engine.go` (`reviewRepeat`, `IsReview`),
  `internal/config/config.go`, `internal/policy/rollout.go`, and
  `internal/detect/detect_test.go` (workspace/purpose repeat cases).
- License class: permissive with notice. The inspected root `LICENSE` is MIT,
  copyright 2026 Jinho Von Choi (최진호).
- Local implementation: `runtime/review_cycles.ts`; owning executable tests:
  `runtime/review_cycles.test.ts` and the verify workflow integration tests.

jstack independently implements the workspace-input plus review-purpose counting
idea. No upstream source bytes or tests are copied, and no Go CLI, daemon,
installer, or hook registration is bundled. jstack hashes every declared input,
including Markdown, normalizes scope order, and binds counters to the task's
requirements. Broad review counts survive edits and changing file subsets;
stable unresolved finding IDs identify stalled correction attempts. Duplicate
delivery IDs do not count as separate executions. Findings, purpose, mode, and
actual review execution remain coordinator reports, not authenticated facts.

The adapter supplies advice through explicit review records. It does not infer
reviews from shell text, claim automatic host interception, relax required
checks, or mark incomplete work complete. These boundaries differ from upstream.
