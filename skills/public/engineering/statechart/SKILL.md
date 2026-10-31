---
name: statechart
description: "Check a TLA+ model with TLC and draw its states as a Mermaid statechart. Triggers: 상태도, TLA+."
---

# statechart

Check a TLA+ model of a system that moves between states, such as a product flow, a protocol, or a service, and draw it as a Mermaid statechart in the words of the person who decides whether the behavior is right. The report gives the shortest path to each state that breaks a rule.

This skill is a pinned copy of an upstream project kept under `repos/pstack/skills/statechart/` (see `NOTICE`). This file is the jstack entry; the procedure lives upstream.

## Start

1. Read `repos/pstack/skills/statechart/SKILL.md`: writing the spec, the view module, reading the report, showing the chart and the hand-off. Every relative path it names (`scripts/statechart`, `scripts/statechart.ts`, `references/render.md`) is relative to `repos/pstack/skills/statechart/` in this skill directory, and `<skill dir>` in its commands is that directory. Pass absolute paths to its tools.
2. Check the tools before promising a chart: a TypeScript-capable runtime (Node 22.18 to 22.x, Node 23.6 or later, Bun 1.1.5 or later, or Deno 2.0 or later), Java 11 or later, and TLC. jstack itself needs only Node 20, so the runtime may be missing even where jstack runs. Report what is missing instead of drawing a chart by hand; [the missing-check rule](../verify/SKILL.md#a-missing-check-is-not-a-pass) applies.
3. TLC comes from `TLA2TOOLS` (the path of `tla2tools.jar`) with `JAVA`, or, when they are unset, from a first-run install of Java and TLC 1.7.4 with mise over the network. Ask the user before that install.

## Where things live

- Write the spec, its config and the view module in a scratch folder outside the repository, as upstream says, and give a new `--out` folder for each run. Never write them under this skill directory; a plugin update replaces it.
- Do not edit `repos/pstack/`. A fix belongs upstream and arrives as a new pinned copy.

## Rendering

Show `chart.mmd` as a `mermaid` code block. An SVG follows `repos/pstack/skills/statechart/references/render.md`, which uses the npm package `pele@1.9.0`; installing Pele is an installation, so ask the user first. Other diagrams stay with `svg-diagram`.

## Boundaries

| Need | Owner |
|---|---|
| Choose what to verify in a repository and leave a verify skill behind | `create-formal-verification-skill` |
| Draw an architecture or flow diagram that is not a checked state graph | `svg-diagram` |
| Check that a code change is complete | `verify` |
| Turn a bug path into a regression test | `test-driven-development` |

## Human gates

Installing Java, TLC or Pele, and any change to product code, are the user's decisions. When the model describes code, replay each bug path against the real code as upstream requires before reporting it as a bug.
