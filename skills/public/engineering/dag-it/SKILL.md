---
name: dag-it
description: "Move repeated, deterministic runs into a Dagster DAG. Triggers: 실험 자동화, 반복 실행, DAG."
---

# dag-it

Decide whether repeated, deterministic work (parameter sweeps, benchmarks, regressions, data pipelines) should leave the agent's loop, and if so move it into Dagster. The engine then runs, retries, limits and reports, and an agent is called only to design the experiment, add to it, analyze what the checks cannot judge, or handle a failure no rule covers.

This skill is a pinned copy of an upstream project kept under `repos/just-dag-it/` (see `NOTICE`). This file is the jstack entry; the procedure lives upstream.

## Start

1. Read `repos/just-dag-it/skills/dag-it/SKILL.md`: the decision rungs, the inventory, the build properties, the verification steps and how the agent behaves after the move. Every relative path it names (`references/dagster.md`, `references/template/`, `references/dagster-expert/INDEX.md`, `references/consumer-boundaries.md`) is relative to `repos/just-dag-it/skills/dag-it/` in this skill directory. Pass absolute paths to its tools.
2. Check the tools before promising a DAG: Python 3.13 (the tested version), `uv`, and Dagster. The template was tested with Dagster 1.13.26; check `dagster --version` in the project and say when it differs. Report what is missing instead of skipping a verification step; a check that could not run is not a pass.
3. Start from the decision. When the lightest rung that is enough is running the command directly or a script that skips finished outputs, say so and stop; a DAG is not the default.

## Where things live

- The template is copied into the project that runs the sweep, with its `REPLACE` parts filled in. Never build a project's DAG under this skill directory; a plugin update replaces it.
- `DAGSTER_HOME`, `results/` and `escalations/` belong to that project. Before the first run, check that they are outside version control or ignored, and tell the user what you added to the ignore list.
- Do not edit `repos/just-dag-it/`. A fix belongs upstream and arrives as a new pinned copy.

## Boundaries

| Need | Owner |
|---|---|
| Check that a code change is complete | `verify` |
| Write the tests for a feature | `test-driven-development` |
| Plan the experiment before any code | `plan` |
| Investigate an open research question | `research` |

## Human gates

Agreeing the parameter space and the acceptance checks, starting the full sweep, turning a schedule on, starting the daemon as a service, and configuring `DIAGNOSE_COMMAND` or `REPORT_COMMAND` are the user's decisions, not steps in the build. They cost money, keep running, or call an agent automatically. Stop and ask at each one. A diagnosis command uses a subscription runtime such as `claude -p` or `codex exec`; never configure one that bills an API key unless the user names that path. No automatically called agent may rerun or change anything.
