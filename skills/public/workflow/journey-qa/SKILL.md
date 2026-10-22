---
name: journey-qa
description: "Persona QA: follow product docs from a clean state, log every gap. Triggers: 온보딩 검증, 클린 설치."
---

# journey-qa

Acceptance QA that walks a product's journeys (first setup, onboarding, everyday use; which apply depends on the product) as fictitious personas from a clean state. A run leaves two things: defects with evidence, and screenshots that are safe to publish.

This skill is a pinned copy of an upstream project kept under `repos/journey-qa/` (see `NOTICE`). This file is the jstack entry; the procedure lives upstream.

## Start

1. Read `repos/journey-qa/SKILL.md`: the modes (explore, codify, run), the phase 0 checklist, the gate commands and the human gates. Every relative path it names (`docs/`, `gates/`, `runners/`, `scenarios/`, `fixtures/`, `capture/`, `templates/`, `adapters/`) is relative to `repos/journey-qa/` in this skill directory. Pass absolute paths to its tools.
2. Check the tools before promising a run: Python 3.10+, `uv`, `tesseract`, `rsvg-convert`, the "DejaVu Sans Mono" font and Node.js 18+. Run mode also needs `ego-browser` or Playwright (`repos/journey-qa/docs/engines.md`), and terminal steps need `tmux` 3.2 or newer (`repos/journey-qa/docs/terminal.md`). Report what is missing instead of skipping the gates that need it; a gate that could not run is not a pass.

## Where things live

- Product adapters belong to the product being tested: `<target repo>/.journey-qa/adapters/<product>/`, or any directory named with `--adapter DIR`. Never add one under this skill directory; a plugin update replaces it. The bundled `repos/journey-qa/adapters/example-app/` is a product-neutral example.
- Runs go to `.journey-qa/runs/<run-id>/` in the target repo. Before the first run there, check `git check-ignore -q .journey-qa/runs/x`; if it is not ignored, add `.journey-qa/` to `.git/info/exclude` and tell the user, because the run's `secrets/` directory holds raw transcripts and real identifiers until wrap-up deletes it.
- Do not edit `repos/journey-qa/`. A fix belongs upstream and arrives as a new pinned copy.

## Boundaries

| Need | Owner |
|---|---|
| Check that a code change is complete | `verify` |
| Accessibility or design review of a page | `web-interface` |
| Write the tests for a feature | `test-driven-development` |
| Review code | `review` |

## Human gates

Real-account login, gate exemptions and acceptance of violations, production data scope, final image approval, and any irreversible publication (push, merge, export, filing an issue) are the user's decisions, not steps in the run. Stop and ask at each one. Do not read or copy credential files.
