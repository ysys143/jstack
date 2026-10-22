# jstack capability catalog

Public names and support ownership are declared in
[`contracts/skill-catalog.json`](contracts/skill-catalog.json). Use `jst catalog list`
for the grouped public inventory, and `jst catalog resolve OLD_NAME --host codex`
(or `claude`) to resolve an old name. Lookup aliases are not native slash aliases.
The table preserves source-owner identities so verification ownership remains clear.


Claude Code uses `jstack:<skill>` and public `/commands`. Codex entry points in the
same package provide only `jstack:<skill>`. Slash commands, automatic hooks, and
Claude agents are not registered in Codex. Check the dependencies below only when
actually using the corresponding capability.

| Source owner | Public entry / role | Example request | Claude Code | Codex | Optional dependencies and limits | Verification scope |
|---|---|---|---|---|---|---|
| `agent-maintenance` | `operations/agent-maintenance` | “Migrate Claude or Codex project sessions” | Skill·five compatibility commands | Skill | Explicit target homes; Node 20; native migration engine and schema/writer checks | Owning branch contracts; recall engine migration tests; host discovery checked separately |
| `audit` | `workflow/review` | “Review code with confirmed defects first” | Skill and audit agent | Skill | Repository checkers; security requests add static finding contracts; reviews touching a security surface read the OWASP Cheat Sheet map | Includes security contracts and fixtures; comparison with the previous product is separate |
| `author` | `engineering/skill-creator` | “Write a new skill contract” | Skill | Skill | Codex has limits on Claude command, agent, and hook registration | Covered by the owning suite's contracts and deletion regressions |
| `bridge` | Support: `runtime-adaptation` | “Export a native package” | Conditional support; existing commands/agents retained | Conditional support; no native skill | `codex plugin` | Covered by the owning suite's contracts and deletion regressions |
| `cleanup` | `engineering/refactor` | “Remove duplicate and dead code” | Skill and cleanup agent | Skill | Language checkers | Covered by the owning suite's contracts and deletion regressions |
| `consult` | `workflow/second-opinion` | “Request an independent opinion” | Skill | Skill | Other host CLI and valid authentication | Covered by the owning suite's contracts and deletion regressions |
| `dashboard` | `operations/dashboard` | “Check usage status” | Skill·`/dashboard*`·opt-in hooks | Native statusline configuration skill | Host-specific entry selected at build/install; Codex CLI uses `/statusline` and `tui.status_line`, not the Claude command renderer | Covered by owning contracts and host-entry packaging checks; actual footer rendering requires host evidence |
| `disk-manager` | `operations/disk-manager` | “Diagnose disk growth and reclaim selected space” | Common skill and Node CLI | Common skill and Node CLI | macOS collection, private SQLite history, opt-in launchd; no automated deletion | Behavior fixtures and installed-path checks; personal scheduling requires separate activation |
| `decide` | `workflow/record-decision` | “Write an ADR” | Skill | Skill | None | Covered by the owning suite's contracts and deletion regressions |
| `deck` | `artifacts/slides` | “Create presentation slides” | Skill | Skill | Marp path in the actual SKILL | Covered by the owning suite's contracts and deletion regressions |
| `delegate` | Support: `task-delegation` | “Delegate implementation to Codex” | Conditional support; existing commands/agents retained | Conditional support; no native skill | Codex CLI, valid authentication, and actual tool events; security delegation only adds task evidence field forwarding | Includes security contracts and fixtures; comparison with the previous product is separate |
| `diagram` | `artifacts/svg-diagram` | “Create a Korean diagram” | Skill·`/convert` | Skill | SVG renderer | Covered by the owning suite's contracts and deletion regressions |
| `emoji` | Support: `emoji-policy` | “Remove prohibited emoji” | Conditional support; existing commands/agents retained | Conditional support; no native skill | No automatic Codex hooks | Covered by the owning suite's contracts and deletion regressions |
| `gitrules` | Support: `git-conventions` | “Check Git and PR conventions” | Conditional support; existing commands/agents retained | Conditional support; no native skill | git; optional gh | Covered by the owning suite's contracts and deletion regressions |
| `help` | Support: `catalog-help` | “Find the right skill” | Conditional support; existing commands/agents retained | Conditional support; no native skill | None | Covered by the owning suite's contracts and deletion regressions |
| `humanize` | `artifacts/humanize` | “Polish Korean or apply ASD-STE100 technical clarity” | Skill·`/validate` | Skill | Procurement mode requires a requirements file; technical-clarity strict mode requires the official Issue 9 rules and controlled dictionary, while Korean uses a non-compliance principles submode | Covered by the owning suite's contracts and deletion regressions; model quality is measured separately |
| `hwpx` | `artifacts/hwpx-document` | “Create and validate HWPX” | Skill and delivery hook | Skill | Python·HWPX | Covered by the owning suite's contracts and deletion regressions |
| `image` | `artifacts/image-generation` | “Generate or edit images” | Skill | Skill | Host image generation; Gemini requires a separate key | Covered by the owning suite's contracts and deletion regressions |
| `issue-report` | `operations/issue-report` | “Report a jstack malfunction with a redacted issue draft” | Skill·`/report`·Node CLI | Skill and Node CLI | Local state under `~/.jstack/reports`; submission needs `gh` with repository access and explicit `--confirm`; otherwise the draft path is the delivery | Behavior fixtures with temporary homes and a stubbed `gh`; no network in tests |
| `journey-qa` | `workflow/journey-qa` | “Walk the install and onboarding journey as a new team” | Skill | Skill | Python 3.10+, `uv`, `tesseract`, `rsvg-convert`, the DejaVu Sans Mono font and Node.js 18+; terminal steps need `tmux` 3.2+; run mode also needs `ego-browser` or Playwright; real-account login stays with the user | Pinned upstream copy; the owning suite checks the entry contract and tree digest and runs the upstream checks |
| `host-audit` | Support: `host-audit` | “Check my Claude/Codex setup before installing” | Conditional support; `jst host-audit` Node CLI | Conditional support; no native skill; Node CLI | Reads host profiles, plugin folders and settings; changes nothing; `--verify-docs` fetches the cited documentation | Rules file validated against its schema and rule ids; behavior fixtures with temporary homes; no test uses the network |
| `models` | Support: `model-selection` | “Select a model tier” | Conditional support; existing commands/agents retained | Conditional support; no native skill | Models available in the host | Covered by the owning suite's contracts and deletion regressions |
| `office` | `artifacts/office-documents` | “Create DOCX or XLSX” | Skill | Skill | Document backend transition pending; current SKILL still mentions OfficeCLI | Covered by the owning suite's contracts and deletion regressions |
| `plan` | `workflow/plan` | “Write a verifiable plan” | Skill·`/brainstorming`·`/consensus-plan` | Skill | Threat model and task specification linked only for security requests | Includes security contracts and fixtures; comparison with the previous product is separate |
| `proof` | `artifacts/korean-proofread` | “Check spelling and character counts” | Skill·`/validate` | Skill | Optional spelling tool | Covered by the owning suite's contracts and deletion regressions |
| `prune` | `engineering/remove-capability` | “Remove components safely” | Skill | Skill | git | Covered by the owning suite's contracts and deletion regressions |
| `react` | `engineering/react-performance` | “Review React performance” | Skill | Skill | React/Next.js code | Covered by the owning suite's contracts and deletion regressions |
| `recall` | `operations/session-memory` | “Find previous sessions” | Skill·`/setup-recall` | Skill | Export search needs a configured corpus; native migration supports both hosts with compatible schemas | Covered by the owning suite's contracts and deletion regressions |
| `requirements-interview` | `workflow/requirements-interview` | “Interview me about this change” | Skill·`/interview`·`/grill-me` | Skill | None | Covered by the owning suite's contracts and deletion regressions |
| `research` | `research/research` | “Research primary sources in depth” | Skill | Skill | Network; optional hyperresearch | Covered by the owning suite's contracts and deletion regressions |
| `science` | `research/scientific-tools` | “Route to scientific tools” | Skill | Skill | Packages and authentication for each subtool | Covered by the owning suite's contracts and deletion regressions |
| `sdlc` | `workflow/sdlc` | “Use jstack:sdlc for this change” | Explicit-only skill | Explicit-only skill | Git code tasks; native host observations; GitHub CLI for PR readback; selected local-commit or pr-and-ship endpoint | Owning state, compatibility, release and packaging fixtures; model behavior and live provider writes need separate evidence |
| `secrets` | `engineering/credential-response` | “Respond to exposed keys” | Skill | Skill | Optional repository scanner | Covered by the owning suite's contracts and deletion regressions |
| `setup` | `engineering/repository-setup` | “Set up development conventions” | Skill | Skill | Repository-specific tools | Covered by the owning suite's contracts and deletion regressions |
| `tdd` | `workflow/test-driven-development` | “Implement starting with tests” | Skill | Skill | Project test runner | Covered by the owning suite's contracts and deletion regressions |
| `team` | Support: `parallel-execution` | “Distribute independent scopes in parallel” | Conditional support; existing commands/agents retained | Conditional support; no native skill | Host parallel tools and actual tool events | Covered by the owning suite's contracts and deletion regressions |
| `ui` | `engineering/web-interface` | “Review accessibility and forms” | Skill | Skill | Optional browser verification | Covered by the owning suite's contracts and deletion regressions |
| `upstream` | `engineering/upstream-maintenance` | “Import external sources” | Skill | Skill | git and original license text | Covered by the owning suite's contracts and deletion regressions |
| `verify` | `workflow/verify` | “Verify completion independently” | Skill and verification agent | Skill | Repository checkers and actual verifier events; stage/oracle binding only for security tasks | Includes security contracts and fixtures; comparison with the previous product is separate |
| `wrapup` | `operations/wrapup` | “개인 일·주간 보고서를 요청한 기간에 맞춰 작성” | Skill | Skill | Optional convenience surface over the shared local work-report core; any workflow may call the core directly | Evidence-separated local bundle; publication receipts are adapter-specific |
| `workspace` | `operations/google-workspace` | “Set up Google Workspace” | Skill·`/init`·`/setup-workspace`·`/gws` | Skill | gws, user approval, and authentication | Covered by the owning suite's contracts and deletion regressions |

Claude Code also loads the `stack-viewer` mod, a function-hook module imported unchanged
from [davila7/claude-code-templates](https://github.com/davila7/claude-code-templates)
(`hosts/claude/mods/stack-viewer/NOTICE`). `/stack` opens a side pane that maps each loaded
skill, subagent, command, hook, MCP server, plugin, setting, memory file and output style
to the scope it comes from, and marks what is shadowed or off. The mod only observes,
needs Claude Code 2.1.287 or later, registers `/stack` under that bare name rather than
`/jstack:stack`, and has no Codex counterpart.

Claude Code exposes 35 public commands: `/brainstorming`, `/branch`, `/check-usage`, `/commit`,
`/consensus-plan`, `/convert`, `/daily-wrapup`, `/dashboard-alias`, `/dashboard-repair`, `/dashboard-setup`, `/doctor`, `/grill-me`, `/gws`,
`/claude-profile`, `/migrate-project-sessions`, `/codex-migrate-project-sessions`,
`/claude-project-rename`, `/claude-plugin-ghost-entry-cleanup`, `/init`, `/inspect`, `/install-skill`, `/interview`, `/log`, `/pr`, `/project-checks`, `/report`, `/setup-recall`, `/setup-workspace`, `/ship`,
`/skills`, `/test-plugin`, `/tidy`, `/validate`, `/weekly-wrapup`, and `/wrap`. `/doctor` reports
status and reduced-capability paths. `/validate` checks artifacts; `/test-plugin`
checks plugin contracts. `/brainstorming` and `/consensus-plan` are thin entries
into the `plan` skill's shaping and consensus references. Codex does not provide
these slash commands; there the two procedures can be reached only through the
explicit routing in `plan`'s body (a `consensus-plan` or `plan --consensus`
request, or an explicit brainstorming or design-shaping request) once `plan` is
loaded. The `plan` description does not name them, so whether a Codex request
reaches `plan` is not verified on a host. `/install-skill` writes a marketplace skill
that `/skills` found into the Claude home as a personal skill. It matches a qualified
namespace exactly, downloads only over https from a named host (the check is by name;
a name that resolves to a private address is not caught), and refuses to replace a
same-named skill with different content unless `--force` is passed. It is Claude Code
only: Codex has no slash commands and no counterpart.

Full frozen-reference checks in `/test-plugin` require a development checkout
because they read Git blobs. Installation caches without `.git` can run runtime
checks, but cannot establish that the full source suite passes.

Packaging checks distinguish actual installation, discovery, delivered-file
comparison, and preservation of user assets. The representative model scenario
uses author to create and place a project-local skill. Direct execution through
an installed entry point does not establish model quality or automatic selection
for every skill. The Codex model execution probe links an installation-cache
entry point as a project skill; native plugin discovery is checked in a separate
process.

`packaging/host_probe.js` checks installation, discovery, and paths.
`packaging/lifecycle_probe.js` checks update, removal, reinstallation, and existing
asset preservation. Neither probe labels these results as successful model
inference. Actual writes to organization services, comprehensive model quality
comparisons, and remote publication are outside this local packaging validation.

Request continuity uses the shared `jst task` interface for code, research and documents.
Both hosts use explicit coordinator calls; automatic capture of every message is not
asserted. See [request continuity](runtime/TASKS.md) for evidence and host limits.

Secret-output protection is **unsupported**. The packaged `secret-guard` hook is an
unregistered candidate: no hook registration (`hooks.json`, `claude-hooks.json`,
`codex-hooks.json`) or dispatcher policy runs it, and jstack does not claim that
environment files or other secrets are protected. An original probe record (Claude
Code 2.1.273 and Codex CLI 0.154.0, 2026-09-16) says a literal environment-file
read was blocked when the candidate ran, but both hosts allowed that read when the
hook was absent, failed, timed out, or returned malformed output, and Codex also
when its hook was untrusted. Those reports are not in this tree and were not
reproduced from it. Against this tree's compiled hook, quote splitting, backslash
splitting, paths an interpreter builds at run time and `.envrc` pass, and so does a
case-variant file name on a case-insensitive file system (the macOS and Windows
default; re-run here on macOS only). The candidate reads only a string
`tool_input.command`, while Codex sends `exec_command` with `cmd`, so registered as
a standalone hook command it would deny every Codex `exec_command` call, including
`ls`, instead of inspecting it; `local_shell` and `container.exec` are not in its
tool list and would pass uninspected. It also denies any shell command that
contains `.env` at a word boundary or followed by a dot, such as
`git add .env.example`, and a search without a path in a working tree of more than
10,000 entries, such as this repository's. No trusted exception approval/consume
anchor is available. These results do not
establish ordinary installed-plugin activation or model behavior. See the hook
contract (`hooks/CONTRACT.md`) for the support boundary.

Review repetition is observed through version 2 `record-review` receipts or explicit
`jst review check|record` calls on a captured request. Both hosts share input/purpose
repeat detection, broad-round counting across edits, and stable blocker tracking.
The advice narrows reviews or requests diagnosis; it never waives required checks,
establishes completion, or claims automatic host tool interception. See
[review termination](skills/public/workflow/verify/references/self-check.md#review-termination).

## Explicit SDLC candidate

`jstack:sdlc` selects autonomous-build revision 1 for one Git code change, with
requirements clarification, durable run state and local-commit or PR-and-ship
endpoints. It is opt-in and does not intercept generic build requests or OMC.
Home run records use schema v2; old writers refuse them. Native host observations
are coordinator-recorded provenance, not authenticated approvals. Runtime and
package fixture evidence does not establish model routing or live remote delivery;
those remain separate host/provider acceptance checks. See `contracts/sdlc.md`.
