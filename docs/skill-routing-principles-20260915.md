# Skill routing when multiple workflow packs coexist

## Objective

Design routing that remains predictable when host-native skills, jstack, OMC, and
Superpowers are installed together. The system must select one procedure owner
for a request, load supporting capabilities only when needed, and keep discovery
cost and instruction conflicts bounded.

## The governing model

Treat installed components as four different kinds of things. Do not place all
of them in one flat list and ask the model to reconcile them at runtime.

| Kind | Responsibility | Discovery policy |
| --- | --- | --- |
| Public workflow | Own a recognizable user outcome from intake through verification | Directly discoverable |
| Capability | Perform work on a concrete surface such as PDF, browser, Google Sheets, or React | Discoverable when the surface is available |
| Conditional support | Supply delegation, model selection, parallel execution, or another internal procedure | Hidden until its owner loads it |
| Runtime or compatibility surface | Hooks, state, aliases, migration shims, and old names | Never compete for automatic routing |

The central invariant is:

> One user request has one procedure owner at a time.

Other components may be tools, conditional support, or later reviewers. They do
not start a second lifecycle over the same request.

## Authority and selection order

Routing follows this order:

1. **Higher instructions:** system, direct user instruction, and applicable
   project instructions constrain every skill.
2. **Explicit selection:** when the user names jstack, OMC, Superpowers, or a
   specific skill, that choice selects the workflow family unless it violates a
   higher instruction.
3. **Required surface:** an artifact or environment with one native owner selects
   that capability, such as Google Sheets for an existing Google Sheet or the
   browser policy for web interaction.
4. **Configured default workflow:** if the user did not select a family, use the
   one default procedure owner configured for that intent.
5. **Conditional support:** load internal procedures only after the owner reaches
   the relevant condition.
6. **Fallback:** fall back only through a declared edge. Absence or failure must
   not silently activate another full workflow family.

Specificity breaks ties. An exact user selection outranks a keyword; an existing
artifact outranks a generic creation skill; a project rule outranks a global
default. Cost or model preference breaks ties only after authority and fitness.

## Collision classes

Each overlap must be classified before choosing an activation policy.

| Collision | Example | Treatment |
| --- | --- | --- |
| Duplicate | Two PDF skills with the same create/read/render lifecycle | Keep one owner; remove or disable the other |
| Competing workflow | jstack `plan`, OMC `plan`, Superpowers `writing-plans` | Pick one workflow family; make the others manual, name-only, or disabled |
| Nested method | jstack research optionally expanding into Hyperresearch | Keep the outer owner; load the method only at its threshold |
| Complementary capability | jstack workflow using a Google Sheets or browser capability | Keep both and declare the handoff |
| Sequential review | One workflow writes and another independently reviews | Allow only as distinct phases with different evidence roles |
| Compatibility alias | `author` forwarding to `skill-creator` | Keep a short non-automatic alias with one canonical body |
| Hard conflict | Two packs both demand control before every response | Select one bootstrap owner and disable the other bootstrap rule |

Superpowers' `using-superpowers` illustrates a hard conflict: it claims every
conversation and requires skill invocation before any action. It cannot safely
coexist as a second automatic bootstrap beside another global workflow router.

## Activation states

Use more than enabled and disabled. A useful registry has these states:

- **full:** description and automatic selection are available.
- **manual:** callable by exact name but excluded from automatic routing.
- **name-only:** only a short discovery label is injected; the body loads on
  explicit invocation.
- **support:** not public; a named owner loads it under a declared condition.
- **disabled:** retained in installation metadata but excluded from routing.
- **alias:** a non-automatic compatibility entry forwarding to one canonical
  owner.

These states control context cost as well as collision behavior. Shortening every
description after the context budget is exceeded preserves names but weakens
selection. Reducing the automatic candidate set is more reliable.

## Processing pipeline

### 1. Observe the effective host

Inventory what the running host actually exposes: enabled plugins, public skills,
hooks, imported instruction blocks, profile roots, versions, and discovery paths.
Filesystem presence alone does not mean active routing.

### 2. Normalize the inventory

For every entry record:

- stable owner ID and displayed name;
- provider and host;
- user outcome or concrete surface;
- component kind;
- automatic triggers and explicit invocation name;
- state, hooks, state directory, and side effects;
- dependencies, fallback, and conflicts;
- description size and whether the body is lazy-loaded.

### 3. Build an intent and ownership matrix

Map user intents to candidate owners. Classify each overlap using the collision
table. Assign exactly one default owner per intent and record why every losing
candidate remains manual, support-only, aliased, or disabled.

### 4. Select one workflow family per request

Create a request-scoped routing decision before running workflow steps. The
decision contains the owner, selected capabilities, permitted support modules,
fallback edges, and completion authority. Do not let downstream keyword matches
start another planner or orchestrator.

### 5. Hand off through contracts

A workflow owner may call a capability or support module with a bounded brief:
inputs, authorized actions, expected artifact, evidence, failure result, and
return point. The callee returns control to the owner; it does not claim the
whole request.

### 6. Fail closed

If the selected owner is unavailable, report that state or follow its declared
fallback. Never substitute another framework merely because it has a similarly
named skill. Unknown external writes must be read back before retry.

### 7. Verify at three separate layers

1. **Discovery:** the effective public roster equals the configured roster.
2. **Routing:** positive, negative, ambiguous, explicit-selection, and unavailable
   cases select the expected owner.
3. **Behavior:** representative tasks show that only one lifecycle ran, required
   capabilities were invoked, and completion evidence belongs to the selected
   owner.

Also measure total description cost, cold-start context, accidental trigger rate,
and the effect of a plugin update or profile restart.

## Recommended coexistence policy

### Host-native and specialist skills

Keep artifact- and environment-specific capabilities available. They own their
surface, not the whole development lifecycle. Examples include PDF, spreadsheets,
Google Drive, browser automation, Hugging Face, and React performance.

### jstack

Use jstack as the default public workflow catalog when the user wants its shared
Claude/Codex behavior. Expose only the public entry points that earn their
native listing cost. Keep narrower procedures behind those entry points as
conditional support, and load them from the package only after the public owner
has been selected. Keep model selection, delegation, runtime adaptation, and
parallel execution as conditional support. Use aliases only for compatibility.

### OMC

Use OMC as Claude's orchestration runtime when explicitly requested or when the
profile designates it as the workflow family. Its `plan -> execute -> review ->
verify` lifecycle must not run alongside the equivalent jstack lifecycle. OMC agents
can serve as bounded executors or reviewers only when the selected owner declares
that handoff.

### Superpowers

Keep Superpowers disabled by default in a jstack- or OMC-owned profile, or expose its
individual methods as manual/name-only entries. Enabling `using-superpowers` makes
Superpowers the bootstrap workflow family for that profile; in that mode,
overlapping jstack and OMC process skills must stop automatic activation.

## Example routing decisions

| Request | Procedure owner | Supporting capability | Suppressed competitor |
| --- | --- | --- | --- |
| “jstack로 기능 계획하고 구현해” | jstack `plan`, then jstack implementation/verification boundary | Domain and repository tools | OMC plan; Superpowers brainstorming/writing-plans |
| “OMC team으로 이 변경 처리해” | OMC team lifecycle | jstack domain capability only if explicitly handed off | jstack planner/orchestrator; Superpowers subagent workflow |
| “Superpowers 방식으로 이 버그 디버깅해” | Superpowers systematic debugging | Language/runtime tools; one later verifier | jstack TDD lifecycle and OMC debug lifecycle |
| “이 Google Sheet 수정해” | Google Sheets capability, unless a broader workflow was explicitly selected | Drive discovery when needed | Generic spreadsheet creator |
| “깊이 조사해” under jstack | jstack research | Hyperresearch only when its breadth threshold is met | OMC research and unrelated deep-research workflow |
| “PDF 양식 채워줘” | The retained PDF capability | Visual renderer and form validator | Removed duplicate PDF skill |

## Minimal routing record

```yaml
intent: implement-feature
defaultOwner: jstack:test-driven-development
explicitOverrides:
  omc: oh-my-claudecode:execute
  superpowers: superpowers:executing-plans
capabilities:
  browser: ego-browser
  spreadsheet-file: spreadsheets
support:
  delegation:
    owner: jstack:task-delegation
    when: bounded-independent-subtask
conflicts:
  - [jstack:plan, oh-my-claudecode:plan, superpowers:writing-plans]
fallback:
  ego-browser: agent-browser
completionAuthority: selected-owner
```

The data format is secondary. The required properties are one default owner,
explicit overrides, typed support conditions, declared conflicts and fallbacks,
and one completion authority.

## Current-profile reading

The current Claude profile already demonstrates part of this design:

- OMC is enabled.
- OMC `plan`, `review`, `verify`, and `research` are `name-only`.
- jstack is enabled.
- Superpowers is disabled.

This reduces direct competition, but it is still profile-specific configuration.
A complete implementation should generate the policy from one reviewed routing
registry, apply host adapters, and test the effective inventories after every
install, update, and restart.

## Acceptance criteria

- Every automatic intent has exactly one default workflow owner.
- Explicit user selection is deterministic and preserved through the task.
- No hidden support module is independently discoverable.
- No compatibility alias contains a second maintained workflow body.
- No fallback silently changes workflow family.
- Discovery, routing, and behavior are verified separately.
- Representative tasks start one lifecycle and produce one authoritative
  completion decision.
- Total automatic descriptions stay below the host budget without truncation.
- Any search layer demonstrably reduces the native roster; a search skill that
  leaves all searchable skills in the host listing does not satisfy this criterion.

## Review notes: host mechanics and gaps

This section adds a second perspective from the 2026-09-15 profile audit.
A second review of these notes on the same day accepted six points, asked for two
to be stated with less certainty, and found an OMC version drift. Those changes are applied below.

Evidence labels:

- *observed*: reproduced on this machine against a named version, with a
  reproduction anchor where the source is a binary;
- *case record*: a single operational incident, kept separate from the general
  principles and linked to its receipt;
- unlabeled: design judgment.

Versions: Claude Code 2.1.272, Superpowers 6.3.0 (plugin cache),
jstack 0.9.3-staging, and OMC as described in note 7 (versions differ by surface).

### Agreement

The one-owner invariant, collision classes, and three-layer verification are
the right frame. In particular, reducing the automatic candidate set is more reliable
than tolerating truncation. That matches what the audit found.

### 1. The registry model needs a channel model beneath it

The document treats routing as a decision recorded in a registry. The host
does not consult that record. Routing inputs reach the model through three kinds
of channel (*observed* for the mechanisms listed):

| Class | Channel | Mechanism | Effect |
| --- | --- | --- | --- |
| Structural gate | Plugin enablement | `enabledPlugins`, read once at process start | Absent components cannot be chosen |
| Structural gate | Listing override | `skillOverrides` `off` / `user-invocable-only` | Removes the skill from model selection |
| Structural gate | Direct invocation | User types `/name` | Host runs the named skill; blocked only by `off` |
| Pre-injection | Bootstrap hook | Superpowers `SessionStart` injects the full `using-superpowers` body on startup, clear, and compact | Instruction text present before the first request |
| Pre-injection | Prompt hook | OMC `UserPromptSubmit` runs `keyword-detector` and `skill-injector` | Instruction text added to each matching request |
| Pre-injection | Imported instructions | OMC's managed `CLAUDE.md` block names `plan -> execute -> review -> verify` and its agents | Standing instruction text |
| Selection signal | Skill listing | Names and descriptions under a character budget; `name-only` | Evidence the model weighs against the request |

Structural gates decide what can be selected. Pre-injection runs before the
model reads the request and places instruction text in context. That text is
not given authority above direct user instructions or higher-priority rules. It is
a strong prior, not a guaranteed win. Selection signals are the weakest input.

Consequence for the pipeline: the activation states in this document act on
structural gates and selection signals only. A competitor demoted in the
listing can still be steered into use by pre-injected text that names it.
Classify every component by channel class before step 3. For each overlap in the
intent matrix, record whether a pre-injection channel favors a losing candidate.

### 2. Activation states do not map one-to-one to host states

Claude Code `skillOverrides` accepts `on`, `name-only`, `user-invocable-only`,
and `off` (*observed*, settings schema text: `"name-only" lists the skill
without its description; "user-invocable-only" hides it from the model but keeps
/name; "off" hides it from both`). The mapping is:

| Document state | Claude host state | Note |
| --- | --- | --- |
| full | `on` | |
| manual | `user-invocable-only` | Hidden from the model; `/name` still works |
| name-only | `name-only` | **Still model-selectable**; only the description is removed |
| disabled | `off` or `enabledPlugins: false` | |
| support | none | Packaging construct: no native entry is generated |
| alias | none | Packaging construct: `disable-model-invocation: true` entry |

The document describes `name-only` as loading the body only on explicit
invocation. On this host, the model can still select a `name-only` skill by
name. It is a weakened automatic state, not a manual one. The current profile
uses `name-only` for OMC `plan`, `review`, `verify`, and `research`. Those skills
are demoted, not excluded. If exclusion is intended, use `user-invocable-only`.

### 3. The current-profile reading overstates the effect

The profile also sets `skill-creator:skill-creator` to `name-only` and
`skillListingBudgetFraction` to `0.015`. More importantly, two pre-injection
channels still favor OMC's lifecycle (*observed*):

- the OMC-managed block in `~/.claude/CLAUDE.md` names the Tier-0 lifecycle and
  its `planner`, `executor`, `reviewer`, and `verifier` roles;
- OMC's keyword detector matches words such as `tdd`, `ralplan`, and `autopilot`.

The keyword path fired in the authoring session. A user message that
**reviewed** this document contained the word "TDD" but requested no test work.
The prompt hook still injected `[TDD MODE ACTIVATED] Write or update tests first
when practical...` (*observed*, hook output on 2026-09-15). The hook matches
vocabulary, not intent, and runs before the model can apply this document's
tie rule that an exact user selection outranks a keyword.

Direct competition is reduced only in the listing. Whether the injected text
actually changes the selected owner has not been measured with representative prompts.

### 4. A request-scoped routing decision has no enforcement point

Step 4 requires a per-request decision that downstream keyword matches cannot
override. No native declarative per-request owner primitive was found in Claude
Code 2.1.272. The host mechanisms that act before the model are the pre-injection
channels. These are the channels the collision table classifies as a hard conflict
when two packs use them.

If jstack installed such a hook, jstack would become a third pre-injection router
beside OMC and Superpowers. The recommendation is to avoid a jstack bootstrap or
prompt hook. Instead:

1. generate structural gates (`skillOverrides`, `enabledPlugins`) from the reviewed registry;
2. require at most one active pre-injection router per profile and check this in step 1;
3. state the default owner in imported instructions without naming suppressed
   competitors as defaults;
4. treat routing as probabilistic and prove it with step 7.2 routing cases.

### 5. The budget criterion depends on the model window

*observed* in Claude Code 2.1.272:

- listing budget = `context window x 4 x skillListingBudgetFraction`, with
  `0.01` as the default fraction and 200000 as the fallback window;
  `SLASH_COMMAND_TOOL_CHAR_BUDGET` replaces the computed value;
- per-skill description cap `skillListingMaxDescChars`, default 1536;
- when the budget is exceeded, bundled skills keep full entries, `name-only`
  entries are listed by name, and remaining descriptions are assigned in order
  of `usageCount x max(0.5^(daysSinceUse/7), 0.1)`;
- usage is keyed by the qualified skill name (for example `jstack:plan`).

Reproduction: the compiled binary is minified and helper names change per build,
so search stable literals rather than function names. In
`~/.local/share/claude/versions/2.1.272`, these strings are present:
`process.env.SLASH_COMMAND_TOOL_CHAR_BUDGET`, `=0.01,` adjacent to `=200000`,
`Math.pow(0.5,` followed by `/7)`, `.usageCount*Math.max(` followed by `,0.1)`,
`source==="bundled"`, and the `skillListingBudgetFraction` schema description
beginning `Fraction of the context window`. Recheck them after every host update.
A controlled experiment at two context windows would upgrade this from code reading to measured behavior.
That experiment has not been run.

Consequences for the acceptance criteria:

- test "below the host budget" at the **smallest supported context window**,
  because a roster that fits a 1M-token session can truncate at 200K;
- test a fresh installation with empty usage history, because a zero score is
  truncated first and the author's own usage can hide truncation.

### 6. Observing the effective host requires process state

*observed*: `enabledPlugins` is read once at process start. A session started
about 21 hours earlier still exposed plugins disabled that morning. jstack, installed
after that session started, was absent from its listing. The later sessions
reflected the file.

Step 1 should record the process start time and the other running host sessions
on the profile. For effective-inventory verification, close or restart every
in-scope existing session, then check the inventory again in a fresh session.

#### Case record: concurrent mutation during the audit

Kept separate from the general principles.

- Usage records purged from `~/.claude.json` reappeared for
  two earlier plugins
  with `lastUsedAt` 13:24 KST. The restarted session began at 13:25:15. Five
  older host processes, the oldest started 2026-09-06, were running. It is
  *inferred*, not proven, that one of them wrote the records.
- At 13:27:03 KST a jstack lifecycle transaction with `"operation": "uninstall"`,
  `"host": "claude"`, `"status": "committed"`, and owner PID 13448 removed the
  Claude installation. Receipt:
  `~/.jstack/transactions/3a6341f8-e96e-4151-8161-26fba01aea7b.json`. Backup of the removed
  target: `~/.jstack/marketplace/plugins/.jstack-lifecycle/9d0c27f6-a521-43a2-a6c8-9472ae0c87c1/removed`.
  The initiating command was not found in session transcripts or shell history.
  The origin remains **unknown**. Recovery used
  `jst install --host claude --source ~/.jstack/versions/0.9.3-staging`, which restored digest
  `9c453b1d6d28d81c53ddb65506f5c5198a339d0cc5395ffad18255118fe0ab31`, matching the Codex host.

This incident motivates checking concurrent sessions in step 1. It does not by
itself establish a general failure rate or cause.

### 7. OMC version drift must be diagnosed before routing analysis

The OMC surfaces on this profile report different versions (*observed*):

| Surface | Version |
| --- | --- |
| Enabled plugin cache (`installed_plugins.json`) | 5.4.0 |
| Managed block in `~/.claude/CLAUDE.md` (`<!-- OMC:VERSION:5.2.0 -->`) | 5.2.0 |
| Global `omc` CLI (`omc --version`) | 4.7.10 |
| `~/.claude/.omc-version.json` | 4.7.10 |

Claims such as "observed in OMC 5.4.0" describe the plugin cache only. The
imported instruction text is a separate channel from 5.2.0. Its lifecycle
wording, skill names, and kill-switch guidance may not match the 5.4.0 hooks
and skills, and the CLI that manages them is older still. A pack's routing
behavior is the combination of all its active surfaces. Step 1 should record
the version of every surface: plugin, hooks, managed instruction block, CLI, and
state file. Resolve drift before building the intent matrix. Otherwise the
matrix describes a pack that is not what actually runs.

### 8. Corrections to the minimal routing record

- `defaultOwner: jstack:test-driven-development` for `implement-feature` contradicts
  `contracts/skill-catalog.md`, which says that `test-driven-development` is not
  advertised as covering every implementation task. Either the catalog needs a
  public implementation owner, or this intent should route to `plan` with a
  declared TDD handoff.
- `owner: jstack:task-delegation` uses a native-looking ID for an entry the
  catalog classifies as `support`, which has no native discovery entry. It also
  calls a support module an owner, which conflicts with this document's
  terminology. Use the catalog owner ID and `consumer` or `loadedBy` for the public owner.

### 9. Suggested additions to the acceptance criteria

- Each profile has at most one active pre-injection router.
- No suppressed competitor is named as a default in an imported instruction file.
- Every active surface of each pack reports a consistent version, or the drift is recorded with its routing impact.
- Budget fit is verified at the smallest supported context window with empty usage history.
- Effective-inventory checks record the process start time, the other running sessions, and a restart of all of them.
- Keyword-triggered injection is included in routing cases: a message that mentions a trigger word without requesting that mode must not switch the procedure owner.

### 10. Search does not remove native listing cost by itself

Search and deferred loading are established solutions for large **tool** catalogs.
Anthropic Tool Search and OpenAI Tool Search keep deferred tool definitions out
of the initial model context and load matching definitions on demand. Microsoft
Semantic Kernel's experimental contextual function selection similarly retrieves
a bounded set of functions from a vector store. These implementations work
because the runtime owns tool registration and can decide which definitions to
advertise for each request.

Agent Skills already defer the full `SKILL.md` body and its resources. They do
not, by default, defer the discovery metadata for model-invocable skills. The
host still places their names and descriptions in the session context so the
model can decide which skill to load. A jstack `find-skill` entry therefore adds a
router without reclaiming that metadata cost if every searchable jstack skill
remains a native entry.

jstack cannot turn this into native search without a host interface for deferred
skill registration, runtime skill search, or dynamic loading of a previously
unregistered skill. Claude Code and Codex are outside jstack's implementation
boundary. Until a host exposes such an interface, jstack should not claim that an
internal search index solves native skill-list growth.

Two concrete projects show that host-independent delivery is possible by
bypassing native skill discovery rather than extending it.

#### `@skills`: explicit references interpreted as file delivery

The `@skills` design separates skill content, persistence, and automatic
triggering into three tiers:

1. a reference such as `@skills:gh:owner/repository/skill` resolves and reads a
   skill for the current use without installing it;
2. `:save` vendors a reviewed copy into the project's `.atskills/` tree without
   making its metadata resident;
3. `:install` adds one line to `.atskills/.autotrigger`, and only that selected
   working set contributes discovery metadata at session start.

Its level-0 adoption path does not require a host patch. A standing instruction
file teaches an agent that can read files and run commands to recognize the
reference, or the agent calls the `atskills` CLI. Corpus-wide search is provided
by an optional hub, while the reference itself remains explicit and
deterministic. This is a real way to make a large corpus reachable with a small
resident set. It does not make Claude Code or Codex perform native semantic
skill search: the user or agent must first produce an `@skills:` reference, and
the standing bridge instruction still occupies a small amount of context.

The paper's quantitative claims need the stated limits attached. Its “fewer
than 100 reliable trigger slots” is a conservative synthesis, not a controlled
skill-count experiment. The authors report that their token measurements came
from one working setup, and they have not isolated trigger reliability by
installation count or compliance by injection position. The author also founded
the company that operates the associated hub. Treat the protocol as an
implemented design and a useful separation model, not as independent proof of a
universal numerical limit.

#### OpenSpace: a bridge skill and an external execution runtime

OpenSpace commit `38277815ed44a53d757973c2bc4454c3b6426698` implements a
different bridge. Its host setup installs two native skills,
`skill-discovery` and `delegate-task`, and registers an MCP server. The native
discovery skill tells the host model when to call `search_skills`; the MCP call
returns ranked names and descriptions rather than full bodies. The host can then
read the selected local `SKILL.md`, or delegate the task through `execute_task`.

Inside OpenSpace's own runtime, `DiscoverSkills` and `Skill` are separate tools.
The former returns candidates without bodies; the latter is the default path
for loading bodies. Large registries are prefiltered with BM25 and embeddings before
an LLM selects a bounded set, after which OpenSpace injects the selected bodies
into its own agent context. That works because OpenSpace owns that delegated
execution context. When used from Claude Code or Codex, it is an MCP-connected
sub-runtime rather than a replacement for the host's native skill selector.

This architecture reduces native listing cost only when the searchable library
is stored outside the host's native skill discovery roots, or when only the two
bridge skills are copied into those roots. Pointing OpenSpace at a directory
whose skills remain natively discovered by the host preserves the original
metadata cost. Its integration guide therefore demonstrates a viable bypass,
but deployment must verify the effective host inventory rather than infer
savings from the presence of `search_skills`.

The resulting host-independent options are:

1. expose a small set of public intent-level entry points and keep specialized
   procedures as non-native package support loaded by the selected owner;
2. mark infrequent or side-effecting skills as explicit-invocation-only where
   the host supports that state;
3. provide profile-specific installation sets so a session discovers only the
   capabilities relevant to that profile;
4. keep exact names or compatibility aliases only when their direct invocation
   value exceeds their recurring listing cost.

The first option can use lexical or semantic search **inside** a selected public
owner to find conditional support. `@skills` uses an explicit reference bridge;
OpenSpace uses a discovery/delegation bridge. All three reduce the native roster
only when the retrieved procedures have no native discovery entries. Search is
secondary to the packaging boundary.

If native deferred skill discovery becomes available, adapt the catalog to it
and verify retrieval recall, wrong-owner selection, no-match behavior, latency,
and actual input-token savings. Until then, the measurable target is the number
and total description cost of native entries, not the size of jstack's internal
package catalog.

References:

- Anthropic, “Tool search tool”: <https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool>
- Anthropic, “Agent Skills”: <https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview>
- Claude Code, “Extend Claude Code”: <https://code.claude.com/docs/en/features-overview>
- OpenAI, “Introducing the Agents API”: <https://openai.com/index/introducing-the-agents-api/>
- Microsoft, “Contextual Function Selection with Semantic Kernel Agents”: <https://learn.microsoft.com/en-us/semantic-kernel/frameworks/agent/agent-contextual-function-selection>
- Yin, “@skills: Attention Is All You Have,” arXiv:2608.12610v1: <https://arxiv.org/abs/2608.12610>
- HKUDS, “OpenSpace”: <https://github.com/HKUDS/OpenSpace>
