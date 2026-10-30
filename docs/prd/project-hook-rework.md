# Project hook rework

Status: design proposal, 2026-09-28. This document does not authorize hook installation, project configuration, or creation of a repository `.jstack/` directory.

## User stories

- As a user starting a new session, I want jstack to reuse a valid project hook decision without running setup checks merely because a session started.
- As a user entering a project for the first time, I want to approve either project hook setup or an explicit choice to work without it. Silence is neither approval nor rejection.
- As a user editing code in any supported language, I want lint and other configured checks selected for the changed files and their subproject, without launching unrelated language tools on research, documentation, or daily tasks.
- As a Codex user, I want bundled hooks to be registered, trusted, and proved through real Codex tool events, including `apply_patch` and `exec_command`.
- As a maintainer, I want one measurable dispatch path and a focused local feedback loop before broad CI or host installation checks.
- As a dashboard user, I want an explicitly enabled status line to recover from configuration drift without replacing a value I chose myself or depending on a particular installation identifier or operating system.
- As an experimenter, I want to compare bounded Jev judgments with jstack's current decisions at selected points, without changing behavior or sending project content merely because an API key is present.

## Baseline and scope

The current source registration is `hosts/claude/hooks/hooks.json`: nine `PreToolUse` handlers match `Bash`, one `PostToolUse` handler matches `Write|Edit`, two handlers run on `SessionStart`, and one runs on `Stop`. A benign Bash call can start nine Node processes before any internal predicate rejects it. The September 2026 local audit measured about 324 ms of summed child CPU time for those nine handlers on a `pwd` input; this is a baseline for comparison, not a host latency claim. The Ruff post-edit handler starts on non-Python Claude edits and does not understand Codex's canonical `apply_patch` input. Some existing pre-tool blockers use exit code 1 or plain stdout; those are not reliable Codex blocking signals.

This proposal covers project setup decisions, status persistence, language-aware validation, event dispatch, and host registration. Existing policy hooks, HWPX delivery checks, release checks, and optional session features need explicit migration or retirement decisions during implementation; they must not disappear by accident. The project setup decision does not grant permission for automatic file rewrites, dependency installation, network calls, or host hook trust.

## Acceptance criteria

### 1. Project decision and state

1. A missing state file means **undecided**, and undecided means **off**: hooks run no project checks and never ask. Checks start only after the user turns them on with the project-checks command (amended 2026-10-30 at the maintainer's request; an unasked question on every coding action was noise in projects that never enabled the feature).
2. The user can explicitly approve **configure this project** or **work in this project without jstack project setup**. Both are approvals. Until one is given, jstack leaves `.jstack/` absent, does not infer a rejection from silence, and may continue unrelated work. It reports any validation it could not provide.
3. Choosing no setup records the choice locally and does not ask again every session. A user command can reopen or change the choice. A new clone or machine asks independently because local consent is not portable.
4. The state file lives in the current worktree's Git directory at `jstack/hook-state.json`, resolved through Git rather than by assuming `.git` is a directory. It is never staged or packaged. A non-Git workspace uses a keyed user-local cache, not a new project directory.
5. Repository `.jstack/` contains only approved, project-shared jstack configuration. It is not used as an implicit cache or created to record a no-setup decision. Project state must not be confused with organization profiles under `~/.jstack` or jstack task records.
6. State has a schema version, decision (`undecided`, `configured`, or `without-setup`), approval provenance sufficient to distinguish an explicit choice from an inference, observed host and jstack version, diagnostic result, and fingerprints for the relevant hook manifest, project configuration, lockfiles, and selected tool availability. Store no prompts, credentials, transcripts, or private file contents. Write atomically; malformed or incompatible state is treated as undecided, with a visible explanation.
7. A matching fingerprint reuses a successful diagnostic. Relevant configuration, dependency, hook definition, host, or executable changes invalidate the diagnostic. An unsuccessful or incomplete diagnostic is never cached as success; retries are bounded to relevant events or an explicit command, not every read-only shell call. The explicit no-setup choice persists until changed by the user, even when diagnostic inputs change.
8. A hook cannot manufacture user approval, and it does not ask for one. The project-checks command presents the two choices when the user invokes it and records only the user's actual answer. An undecided project authorizes no project-specific checker execution or setup.

### 2. Selection and execution

1. A single cheap dispatcher receives only necessary event classes, normalizes Claude and Codex inputs, and rejects irrelevant events before loading language packages or reading project configuration. It must not spawn one process per language or eagerly load the HWPX parser for unrelated commands.
2. The dispatcher distinguishes read-only shell activity from edits and commits. A `Bash` or Codex `exec_command` matcher still launches the dispatcher for matching calls, so implementation must measure and minimize that residual startup cost rather than claim zero overhead.
3. Validation uses actual changed or staged paths and the nearest owning subproject. Configuration file existence alone does not decide whether a language is present. Mixed-language repositories can select more than one checker, but only for affected subprojects.
4. Use the project's existing lint command and configuration first. Python may use Ruff for `.py` and `.pyi`; JavaScript and TypeScript use configured ESLint, Biome, or package scripts; Go and Rust use configured project checks such as `go vet` and Clippy. Extend through an explicit project adapter rather than global per-language hooks. Formatting, lint, type checking, and tests remain distinct actions.
5. If a genuine Python project has no `pyproject.toml`, offer to create an appropriate one after examining existing Python version, package files, dependencies, and source layout. Equivalent missing setup in other languages is offered through that ecosystem's normal manifest or configuration. A standalone script does not force package scaffolding. Creating files requires the user's authorization; lack of a manifest never silently means “lint passed.”
6. Batch validation after a coherent group of edits and at a commit boundary. A single edit does not repeatedly invoke Ruff, Pyright, or every other available checker. Checks operate on affected paths where the underlying tool permits it. Automatic format or restage behavior requires a separate explicit opt-in.
7. Documentation, research, and daily tasks do not invoke language-specific checks unless they actually change relevant files. Existing document checks can still run when their own trigger matches.
8. Preserve fail-closed behavior where an existing hook is meant to block a dangerous action. A failure to discover or run an optional lint tool is reported as an unknown result, never presented as a pass. Avoid duplicate host and repository registrations that cause the same check to run twice.

### 3. Correct host registration

1. Build one authoritative package hook definition from canonical source. Claude consumes the packaged `hooks/hooks.json`. Codex discovers `hooks/hooks.json` in an enabled plugin by default when its plugin manifest does not override hooks. If an explicit Codex manifest hook path is introduced, it replaces default discovery and must be tested as such. Do not add a second user or project hook registration solely to compensate for a broken bundled hook.
2. A Codex installation check distinguishes package presence, enabled plugin, enabled hook feature, current hook-definition trust, and actual event execution. Installing or enabling a plugin does not itself establish trust. Do not write trusted hashes or bypass Codex's review flow on behalf of the user.
   Project setup consent and Codex hook trust are separate decisions: one does not imply the other.
3. Normalize Codex `exec_command` as `Bash` for matcher purposes and parse its `tool_input.command`. Normalize `apply_patch` as a patch-bearing edit while retaining its actual `tool_name: "apply_patch"` and `tool_input.command`. `Edit|Write` matcher aliases alone do not make Claude-specific input branches work. Cover additions, modifications, deletions, and multiple files in a patch; reject uncertain path extraction rather than claim a successful check.
4. Codex pre-tool denials use its documented `hookSpecificOutput.permissionDecision: "deny"` shape, the supported legacy JSON block shape, or exit code 2 with stderr. Do not use exit code 1 or plain stdout as the sole blocking mechanism. Claude receives its documented equivalent through a host-specific output adapter. Post-tool results do not claim to undo an edit already performed.
5. Package path resolution is explicit and works from any project subdirectory. Codex plugin commands can use its `PLUGIN_ROOT`/`PLUGIN_DATA` environment; compatibility variables are available for shared packages. The built hook manifest must reference only files included by `packaging/package-files.json`.
6. Remove project discovery from `SessionStart`. Review the two existing start handlers separately: recent-change context is a product feature, while status-line repair is opt-in. Neither should become a hidden project setup check. Review the opt-in `Stop` auto-commit handler separately and preserve explicit opt-in semantics.

### 4. Evidence and rollout

1. Before changing the manifest, inventory every existing handler with its owner, trigger, side effects, block contract, and disposition. Keep an explicit migration map so a consolidated dispatcher cannot silently drop a policy.
2. Use synthetic host payloads for cheap local checks, including benign Bash, write-shaped Bash, Claude Edit/Write, Codex `apply_patch`, a staged commit, a mixed-language monorepo, missing manifests, malformed state, and both user decisions. A denial case must prove the guarded tool did not execute.
3. Test a disposable built package in isolated Claude and Codex homes. For Codex, review and trust the current hook definition through the host flow, then observe a real `exec_command` and a real `apply_patch` event. Confirm a changed hook definition requires renewed trust. A static manifest or installed-file check is insufficient evidence of execution.
4. Compare before/after child CPU and wall time on matched benign tool calls with the same host, Node version, and input. Record the dispatcher startup cost and expensive checker count separately. Run affected suites locally, then widen to the full suite and CI only after focused failures are resolved. Bind evidence to the tested source/package hash.
5. Update `hosts/claude/hooks/CONTRACT.md`, packaging membership, host probes, and user setup documentation alongside behavior. No release, installation on user homes, or remote publishing is implied by approval of this design document.

### 5. Opt-in dashboard health and recovery

Dashboard recovery is separate from the project hook setup decision above. It remains **off by default** and requires its own explicit opt-in through dashboard setup or repair. A repository decision to use jstack project checks does not authorize changes to a user's host status line. The existing `SessionStart` status-line hook may remain as an opt-in recovery trigger; it must not become a project discovery hook.

1. Diagnose the disappearance by **cause type**: whole-file restoration from an older snapshot, ownership contention over the status-line slot, installation identifier or build-path mismatch, removal of an installed version or compatibility path during cache cleanup, an unconfigured additional host profile, or loss of Codex `tui.status_line` during configuration rewrite. Report the observed type and evidence rather than naming a particular external tool or machine.
2. Remove fixed marketplace/plugin identity assumptions from the Claude renderer. Resolve the installed package from host installation metadata such as `installed_plugins.json` and/or a bounded search of actual plugin cache entries, then locate the dashboard build beneath that package. A temporary compatibility link is not a repair. Align the installer, SessionStart hook, `NOTICE`, and owning contracts with the resolver.
3. Classify each effective status-line value as `ours`, `empty`, `known-managed-by-another-tool`, or `user`. Repair `empty` and broken `ours` only after dashboard opt-in. Preserve `user` unconditionally. Replace a known managed value only when the user has explicitly opted that class or identity into replacement; do not hardcode external tool names as a substitute for consent.
4. Provide an idempotent health check in `/jstack:dashboard-repair`. It verifies the effective configuration, installed shim, and resolvable build. A healthy run performs no write and emits no routine log. A write triggered by a file watcher must converge to a no-op on the next run. Parse failures defer repair and retry later; they do not overwrite the damaged file.
5. Layer optional triggers: use the existing opt-in `SessionStart` path for ordinary recovery; optionally allow a file-change watcher with a periodic fallback because replacement-by-rename may escape a watcher. Scheduler and watcher integrations are adapters or examples only, with no required OS service. After a change event, wait briefly for the writer to finish, then reread. Back up before an atomic temp-file-and-rename write and preserve file permissions.
6. Allow an **off-by-default** option to synchronize user-specified sibling snapshot/backup glob patterns when those files are known future restore sources. Never scan arbitrary backups or change them without explicit selection. Iterate only the configured host configuration directories; with no list, inspect the current home. A setting in one home is not proof that other homes are configured.
7. For Codex, preserve any existing `tui.status_line`, including a layout selected through `/statusline`. When the user has opted into repair and the key is missing, add it within the existing `[tui]` table or create one table. Do not append a duplicate table. Validate TOML before saving and verify the effective configuration afterward. The Claude command renderer is not installed as a Codex footer.
8. Keep emitted status, diagnostics, and logs free of emoji. An unrecoverable state must return a clear diagnostic without repeatedly writing or logging on each session or render.
9. Validate missing/valid/broken renderer paths, all ownership classes, opt-in boundaries, whole-file restoration, malformed JSON/TOML, multiple homes, and repeat no-op runs. Rebuild the dashboard distribution reproducibly and prove the new resolver finds a real packaged installation without a compatibility link. Check newly changed dashboard source, scripts, and tests for environment-specific names and paths.

### 6. Experimental judgment points

Jev is a typed external judgment service, not an execution or authorization provider. Its `Choice`, `Score`, and `Noul` answers can be compared with a current jstack decision. This is a proposed experiment, not evidence that Jev is better. The first stage is **off by default and shadow-only**; any active use requires a separate reviewed decision for that point.

The OMC v5.5.0 source at commit `9fd35ec` is a design reference, not a production benchmark. It declares ten Jev points, but its registered `hooks/hooks.json` executes `scripts/run.cjs` and `scripts/*.mjs`, while the Jev calls are in a TypeScript bridge that those hook scripts do not import. Its active set is empty, and the source call sites either discard the Jev result or await it before returning the existing decision. Four recorders are absent from the inspected bridge bundles. No local shadow log or enabled environment was observed. Therefore copying its declarations or unit tests would not prove that jstack's installed hooks actually call Jev.

| Point | jstack decision to compare | Boundary |
| --- | --- | --- |
| Skill trigger / intent | Recommend a public workflow from the user request | Host-native discovery and exact catalog aliases remain authoritative; do not select from quoted document text |
| Model routing | Rank already eligible candidates when comparable reviewed measurements are absent | Keep authorization, capability, transport, explicit model, cost-cap, and native-preference filters in `runtime/routing.ts`; never let Jev add an excluded candidate |
| Context pruning | Recommend which prior task facts or memories merit rechecking or retaining | Do not alter host compaction or delete evidence; repository facts and user constraints remain authoritative |
| Task size | Recommend local, single delegation, or separately checkable parallel work | Delegation still requires user/session authorization and a valid brief |
| Loop continuation | Flag whether another bounded attempt seems useful | User stop, attempt limits, timeout, and task status remain deterministic |
| Completion verdict | Flag a claim that merits further verification | `verify` receipts and required human review, not Jev confidence, decide completion |
| Learner extraction | Suggest a reusable correction or decision for review | Do not persist raw sessions or infer consent to record memory |
| Slop warning | Suggest a finding for the closed refactor or Humanize taxonomy | A warning is not a finding until its owning adjudicator and evidence agree |
| Simplifier trigger | Suggest a later bounded cleanup pass from a diff summary | Never rewrite files or start a refactor from the score alone |
| Project initialization and checks | Recommend jstack setup, existing-tool use, or a question; rank lint/formatter proposals | Existing manifests and commands are discovered locally; both setup and no-setup choices need explicit user approval; formatting is separately authorized |

Use a shared resolver with a named judgment point, typed question, current deterministic or human-guided twin, bounded state schema, and host-neutral result. The initial implementation points are **model-routing**, **task-size**, and **project initialization/check recommendation**. Other rows are candidates for later shadow coverage, not a requirement to add always-on hooks. A point is eligible only at its natural decision boundary; there is no Jev call on every tool use, every session start, or every prompt by default. A `Choice` must name current candidate IDs or approved actions, not assume that model names encode fixed quality tiers.

Environment contract: `TYPESAFE_API_KEY` authenticates but never enables a point. `JSTACK_JEV=off` or an unset value makes zero requests; `JSTACK_JEV=model-routing,task-size` explicitly selects points. Selected points default to shadow. A future `JSTACK_JEV_ACTIVE_POINTS=<reviewed-point-list>` may enable only specifically implemented active consumers; an env value alone must not activate a recorder whose result is discarded. Unknown point names and unsupported active requests fail visibly and make no request. Timeouts, invalid responses, HTTP errors, and an open circuit return the twin result. Enforce a bounded request count across hook processes in the selected session or workspace, not merely an in-process counter that resets for each event.

Initial state schemas contain only derived task features, enumerated eligible candidate IDs and capabilities, or project tool/config presence. Exclude prompt text, file contents, absolute paths, organization profiles, credentials, and raw session logs. A later content-bearing point needs separate informed approval of its exact fields and destination; truncating strings is not de-identification. Shadow records point, input schema version and hash, twin result, Jev result, latency, degradation reason, and outcome evidence without raw state. They live in a private user-local location, outside the package and repository. A shadow call must not delay a blocking hook or change its output; if the host process cannot safely finish an asynchronous call after returning, perform the experiment outside that hook path.

For routing, compare Jev only after `runtime/routing.ts` has validated the request and built its eligible set. Preserve the existing measured-success ordering when comparable reviewed evidence exists; study Jev against the inherited/priority fallback when it does not. The shadow comparison must use the **actual emitted route**, including user settings, rather than a simplified twin with default thresholds. Active ranking, if later approved, must still return an eligible ID and preserve the existing fallback on uncertainty.

For task size, the parallel-execution skill records the shape it already chose through `jst jev task-size`. The CLI accepts only enumerated work type, impact, constraints, counts, and delegation permission. It rejects a delegated answer when delegation is disallowed and a parallel answer with fewer than two independent parts. A point with only one permissible choice makes no external request. This path runs only for an explicitly enabled experiment at the task-splitting boundary; the skill never sends the task prompt or file names. The recorded suggestion does not launch agents or alter the chosen shape.

#### Test and evaluation plan

1. **Pure resolver tests, no network:** Inject a fake transport. Assert unset key, key-only, `JSTACK_JEV=off`, unknown point, and absent per-point opt-in each produce zero requests and no log. Assert a shadow response leaves the twin decision and host hook bytes unchanged. Test each answer type, malformed response, timeout, HTTP failure, circuit opening, fallback, and failures in the twin itself. Assert no raw state or credentials appear in reports or logs.
2. **Decision-boundary tests:** For routing, create fixtures for every exclusion reason and prove an excluded candidate can never be selected or sent as an available choice. Test explicit model requests, comparable measurement present/absent, inherited candidate, priority, and the two-attempt budget. For project setup, test an absent `.git/jstack` state, approved setup, approved no-setup, silence, existing configuration, and missing `pyproject.toml`; Jev never creates `.jstack/`, changes lint rules, formats files, or supplies approval. For task size, test all three actual choices, permission and independence bounds, and the unchanged chosen shape when Jev disagrees or fails.
3. **Cross-process resource tests:** Run multiple fresh CLI processes against one isolated session state. Prove the request cap, circuit state, locking, and session boundary survive process restarts and concurrent calls. Measure zero-call overhead, shadow wall time, child CPU, request count, and timeout behavior against the same jstack input hash. Initial Jev points run outside blocking hooks; a hook-event negative control must show zero Jev calls even when an experiment is enabled.
4. **Packaged reachability and host execution:** Build the disposable package through reviewed `packaging/package-files.json` membership. Invoke each enabled Jev decision through its packaged CLI or skill boundary, observe a local stub receive exactly one sanitized request, and prove the emitted twin decision is unchanged. Include a Jev-off negative control and a deliberately disconnected recorder; the reachability check must fail on the disconnected build. Separately, in isolated Claude and Codex homes, review and trust the bundled hooks through each host's real flow and observe actual tool events. Source imports, bundled symbols, and resolver unit tests alone prove neither path.
5. **Evaluation before activation:** Pre-register a sample, outcome labels, acceptable error costs, latency ceiling, and decision threshold for each point. Compare twin and Jev against later observed task outcomes, not agreement with each other. For routing, stratify tasks by whether comparable reviewed measurements existed; record verification pass, retries, wall time, and actual cost. Review disagreement examples and data-egress records manually. No point becomes active from confidence alone, a small agreement rate, or an OMC claim. Keep broad CI runs until focused offline and host checks pass.

## Edge cases

- Linked Git worktrees have a `.git` file and distinct worktree Git directories; a shared repository common directory would incorrectly share local decisions. Resolve the worktree-specific Git directory.
- An existing `.jstack/` directory is evidence of files, not proof of consent for new hook setup. Preserve and inspect its contents before proposing changes.
- A user who declines setup can still explicitly request a one-off lint command. That request does not convert the project decision to configured.
- A no-setup choice can coexist with an already configured non-jstack linter. Running an explicitly requested checker is separate from registering persistent jstack hooks.
- A hook or checker unavailable on a machine yields an actionable diagnostic; it does not mutate lockfiles or install dependencies automatically.
- Concurrent first actions must not overwrite one another's state or duplicate prompts. Use an atomic write and lock or compare-and-swap scheme, then re-read the decision before committing it.
- A repository without Git uses the user-local cache; moving or copying it does not silently carry old consent to a different path.
- When a tool bypasses the documented hook path, report the coverage limit. A hook is a guardrail, not a complete enforcement boundary.

## Constraints and implementation order

Keep source in the existing root/host layout; never edit generated `entries/`. Preserve unrelated working-tree and index changes. Keep technical documentation in English. Favor narrow local checks and measured evidence over repeated broad CI runs.

1. Inventory and freeze the existing hook contract and baseline measurements.
2. Implement state schema, explicit decision flow, invalidation, and the diagnostic command without creating `.jstack/` during development or installation.
3. Implement the cheap dispatcher and host input/output adapters; migrate policies one at a time with contract evidence.
4. Add language-aware lint selection and batched validation, then remove redundant per-edit Ruff registration.
5. Repair dashboard package discovery and implement opt-in, ownership-aware health checks without tying project setup to status-line repair.
6. Add the experimental judgment resolver behind zero-egress defaults and point-level environment switches. Connect only named decisions, and validate their actual emitted twins before any shadow comparison.
7. Build and inspect package membership; prove Claude and Codex registration, trust, and actual hook execution in isolated homes, including any selected Jev recorder.
8. Compare resource measurements, run affected local suites, then full local validation and CI once the bounded checks pass. Evaluate Jev shadow outcomes separately before considering point-specific activation.

## Source references

- [Codex hooks](https://learn.chatgpt.com/docs/hooks): plugin hook loading, trust, matchers, input/output contracts, and supported tool paths.
- [OpenAI plugin packaging](https://developers.openai.com/plugins/build/plugins): default hook discovery, manifest override, and plugin environment variables.
- [TypeSafe System One API](https://api.typesafe.ai/docs): external typed-judgment request surface.
- OMC v5.5.0 source at `9fd35ec`: `hooks/hooks.json`, `src/hooks/bridge.ts`, `src/hooks/jev/{config,resolver,points,client}.ts`, and `scripts/jev-eval.mjs`. This is source inspection, not jstack or OMC production effectiveness evidence.
- Repository source: `hosts/claude/hooks/hooks.json`, `hosts/claude/hooks/CONTRACT.md`, `packaging/build.ts`, `packaging/host_probe.ts`, `skills/public/operations/dashboard/scripts/statusline-shim.mjs`, and `hosts/claude/commands/dashboard-repair.md`.
