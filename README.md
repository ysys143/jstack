# jstack

A plugin for development, research, and document work in Claude Code and Codex.
One common source produces a single package that both hosts can install.
jstack `0.0.1` is distributed as checked release assets from this repository; no
hosted remote marketplace is configured. See the [capability catalog](CAPABILITIES.md)
for features and limitations and [notices](NOTICE.md) for imported material and its terms.

jstack is named after [gstack](https://github.com/garrytan/gstack) and Cursor's
[pstack](https://cursor.com/marketplace/cursor/pstack), which inspired it. Original
jstack material is under the [MIT license](LICENSE); imported material keeps the
terms listed in [NOTICE.md](NOTICE.md).

## Node.js compatibility

The jstack TypeScript runtime requires Node.js **20 or newer**, with no upper-version
restriction. CI defines jobs for Node 20 through 26, the 20.0.0 minimum, and the
latest Node release; configured jobs are not execution evidence. Run `npm ci` followed by `npm test` to compile and execute the runtime
and installer tests. Optional integrations retain their own runtime requirements.

## Getting started

| Request | Starting skill |
|---|---|
| “Break these requirements into implementable tasks” | plan |
| “Reproduce and fix this bug” | tdd, verify |
| “Review the problems without changing code” | audit |
| “Reproduce this security flaw and test bypasses after the fix” | plan, audit, tdd, verify |
| “Fix only the defects confirmed in the review” | cleanup |
| “Resume the interrupted task using the current files” | recall |
| “Clean up outdated instructions in CLAUDE.md or AGENTS.md” | setup |
| “Save this workflow as a project skill” | author |
| “Rewrite this technical procedure using ASD-STE100” | asd-ste100 |
| “Polish this sentence while preserving facts and numbers” | humanize |
| “Turn these research notes into a report for readers” | humanize |
| “Research the evidence and write a report” | research |
| “Request a personal daily or weekly report from local records” | wrapup (convenience surface; workflows may call the shared runtime core directly) |
| “Turn this content into a document, slides, or diagram” | office, hwpx, deck, diagram |
| “Tell me which capability to use” | help |

Run only the checks needed for a small change. Tasks that require requirement
tracking, delegation, or recovery store contracts and verification evidence in
`.jstack/tasks/` inside the project. Audit requests are read-only; preserve user files
unrelated to the applicable instructions.

## Installation

You need Node.js 20 or newer and Claude Code, Codex, or both.

### Ask your coding agent (recommended)

Give your coding agent, in Claude Code or Codex, this request:

```text
Install the latest jstack release from https://github.com/ysys143/jstack following its README.
```

Use the same request with "Update" for a later release. The agent follows the
instructions below and asks before it installs into another profile or removes
anything.

#### Instructions for the agent

Follow these steps in order. Do not clone the repository to install: `master`
is the source tree, not a marketplace. Install only the checked assets of a
published release.

1. **Check prerequisites.** Find the latest release and its assets with
   `gh release view -R ysys143/jstack --json tagName,assets` or
   `curl -s https://api.github.com/repos/ysys143/jstack/releases/latest`; the
   repository is public, so no sign-in is needed. Confirm Node.js 20 or newer and
   which host CLIs (`claude`, `codex`) are on PATH.
2. **Find the profile.** The current host profile is `CLAUDE_CONFIG_DIR` (default
   the user's `.claude` directory) or `CODEX_HOME` (default `.codex`). Install
   into the current profile only. List other profile directories you find and ask
   before repeating the steps there, passing the variable explicitly each time.
3. **Inventory before changing anything.** For each selected profile and host, run
   `claude plugin list --json` and `claude plugin marketplace list`, or
   `codex plugin list --json` and `codex plugin marketplace list`. Also run
   `command -v jst` and `jst status` if a `jst` CLI exists. Classify what you find
   with the cleanup table below and show it to the user before step 7.
4. **Download and verify.** Download `jstack-marketplace-<version>.zip` and `SHA256SUMS`
   of the latest release into a new temporary directory (`gh release download` or
   `curl -LO https://github.com/ysys143/jstack/releases/download/<tag>/<file>`),
   check the ZIP against `SHA256SUMS` (`shasum -a 256 -c` on macOS, `sha256sum -c`
   on Linux and Git Bash), and extract it there.
5. **Audit the host setup.** Read `skills/host-audit/SKILL.md` inside the extracted
   `jstack-marketplace/plugins/jstack/payload` folder and follow it. For each selected
   profile, with its `CLAUDE_CONFIG_DIR` or `CODEX_HOME` set, run `skills/host-audit/scripts/main.js` with Node and
   `--package <extracted>/jstack-marketplace/plugins/jstack --verify-docs --measure`
   (add `--project <dir>` when installing for a repository). It reads the existing
   plugins, skills, commands, subagents, MCP servers and hooks, projects the
   model-facing description listing with jstack added against the hosts' documented
   budgets, re-checks the official documentation it relies on, and changes
   nothing. Show its output as it is before step 7. Exit 1 is a blocker (two jstack
   plugins) to resolve with the cleanup table first; warnings are for the user
   to weigh.
6. **Place the marketplace.** Claude Code loads a local marketplace in place, so it
   needs a permanent folder. Use the local folder already registered as `jstack` if
   there is one; otherwise use a `jstack` folder under a `marketplaces` folder in the
   user's jstack state directory (`.jstack` in the home directory). Move the old
   contents aside, move the extracted `jstack-marketplace` contents in, and keep the
   old copy until step 9 succeeds.
7. **Install or update.**
   - Claude Code, first install: `claude plugin marketplace add <folder>`, then
     `claude plugin install jstack@jstack --scope user`.
   - Claude Code, update: `claude plugin marketplace update jstack`
     (this also updates the installed plugin).
   - Codex, first install: `codex plugin marketplace add <folder>`; install and
     update with `codex plugin add jstack@jstack`.
   - If the profile uses the jstack-managed route instead (`jst status` reports it, and
     the plugin id is `jstack@jstack`), keep that route: run
     `jst update --source <folder>/plugins/jstack --host claude|codex` with the
     profile's variable set, rather than adding a second jstack.
8. **Clean up remnants the user approved** (table below), one item at a time with
   the host's own commands.
9. **Verify and report.** Each profile lists exactly one enabled jstack plugin at the
   release version. Run `jst host-audit --verify-docs --measure` once more with
   each profile's variable set and report what it still warns about. The PATH
   hook runs at the next session start, so in the installing session `jst` may
   not be on PATH yet; then run
   `node <marketplace folder>/plugins/jstack/payload/skills/host-audit/scripts/main.js --verify-docs --measure [--project <dir>]`
   with the folder from step 6. Then remove the old marketplace copy from step 6 and the
   temporary download. Tell the user to restart open sessions, and in Codex to
   review and trust the jstack hooks in `/hooks`. Report what was installed, cleaned
   up, and left in place.

#### Cleaning up earlier versions

| Found | Action |
|---|---|
| Another jstack plugin (a `jstack-dev` build, or `jstack@jstack` from a second marketplace) | Two enabled plugins that share hooks run every hook twice. Ask which one to keep and uninstall the other with `claude plugin uninstall <id> --scope <scope>` or `codex plugin remove <id>`. An unmanaged Claude installation can instead move to the managed route with `jst migrate --from <id> --host claude`. |
| A marketplace no installed plugin uses | Offer to remove it with `claude plugin marketplace remove <name>` or `codex plugin marketplace remove <name>`, after the new registration works. |
| Skills the step 5 audit reports as listed by name only (`listing-over-budget`, `jstack-descriptions-dropped`) | Show the audit's figures and options. The user decides; plugin skills, jstack's included, cannot be demoted with `skillOverrides`, so the choices are the user's own large skills, plugins they do not use (`/plugin`), synced claude.ai skills they do not use, or a larger `skillListingBudgetFraction`. Change settings only with approval. |
| `skillOverrides` entries that name plugin skills (`ineffective-override`) | They have no effect. Offer to remove them, with approval. |
| `skillOverrides` entries under the bare name of a synced claude.ai skill when another command holds that name: the user's own skill or command, or a plugin skill or command whose frontmatter names it (`override-misses-synced-skill`) | The synced skill keeps its listing. Offer the `anthropic-skills:<name>` key, which always applies to it, with approval; offer to remove the bare entry too when only plugin entries hold the name. |
| The user's own commands or skills with a jstack name (`name-collision`) | Keep them. Tell the user that the short name runs their own and jstack's answers as `/jstack:<name>`. |
| Folders that earlier updates left next to the marketplace copy (names with `pre-stable` or `previous`) | Offer to move them to the trash after step 9 succeeds. |
| A hand-made `jst` wrapper or link on PATH that points into an older package | Report it and replace or remove it only with consent. The plugin provides `jst` now, and an installed CLI package takes precedence. |
| Older version folders in a host's plugin cache | Leave them. Hosts keep them for sessions that are still open and remove them themselves; deleting them by hand can break a running session. |

Never delete or edit, as part of cleanup: the jstack state under the `.jstack` directory
(reports, disk history, profiles, backups), user-authored skills, other plugins and
their settings, credentials, or session history. Do not hand-edit host settings
files when a host command can make the change. If a step fails, stop, keep the
backup, and report the exact command and error.

### Install from inside your host CLI

Open the host with the profile where you want jstack installed. Native plugin
installation uses that host's active configuration; repeat it in another profile
if needed. The plugin works without the jstack npm CLI and ships a launcher for its
packaged CLI at `payload/bin/jst`, which skills that run `jst ...` commands use.
In Claude Code, a jstack SessionStart hook adds that directory to the Bash tool's
PATH for each session, after your own entries; restart the session after
enabling. In Codex, a jstack SessionStart hook links `~/.local/bin/jst` to it after
you trust that hook in `/hooks`; `~/.local/bin` must be on your PATH.
`JSTACK_NO_PATH_LINK=1` turns both hooks off. Hooks and MCP servers do not get this
command, and on claude.ai and in Cowork the plugin installs without a `jst`
command. On Windows the launcher runs in Claude Code's Git Bash, while Codex gets
no link and needs the CLI package. The CLI package from the next section (its
`npm install -g` step only) still works, takes precedence when it is on PATH (the
Codex hook then removes a `~/.local/bin/jst` link into a jstack plugin cache), and is
required for scheduled disk snapshots.

The `0.0.1` release is distributed as a checked local marketplace, not a
hosted remote marketplace. Download `jstack-marketplace-0.0.1.zip` from the
[GitHub release](https://github.com/ysys143/jstack/releases/tag/v0.0.1),
extract it to a persistent location, and open your terminal in its parent folder.
The folder must contain
`.claude-plugin/marketplace.json`, `.agents/plugins/marketplace.json`, and
`plugins/jstack/`; the source checkout itself is not this marketplace.

**Claude Code**

Start `claude` from that parent folder using your usual profile launcher. Enter
these commands in the Claude Code prompt:

```text
/plugin marketplace add ./jstack-marketplace
/plugin install jstack@jstack
```

Choose **User** scope to use jstack across projects in the current profile. Open
`/plugin` and check the **Installed** tab for jstack. Follow the installation summary
if a reload or restart is required.

**Codex**

Register the local marketplace once in your terminal, using the same `CODEX_HOME`
setting as the profile you intend to start:

```bash
codex plugin marketplace add ./jstack-marketplace
```

Start Codex with that profile, then enter this command in its prompt:

```text
/plugins
```

Find jstack in the configured marketplace and select its install action. After
installation, use `/plugins` to check its state and `/hooks` to review and trust
the hook definitions you intend to enable. Installation alone does not grant
hook trust. If jstack is not listed, check that marketplace registration and the
running session use the same profile.

See the official [Claude Code plugin guide](https://code.claude.com/docs/en/discover-plugins)
and [Codex plugin browser guide](https://developers.openai.com/codex/cli/slash-commands#browse-plugins-with-plugins).

### Alternative: manage installation with the jstack CLI

Use this route for jstack-managed install, update, and rollback. Choose one route
per profile: the jstack installer rejects conflicting unmanaged jstack installations.
The `0.0.1` release is not published to npm.

**Get the package first.** Download `ysys143-jstack-0.0.1.tgz` from the
[GitHub release](https://github.com/ysys143/jstack/releases/tag/v0.0.1); it is not
on the npm registry.

Open a terminal in the directory containing the downloaded tarball and the
extracted `jstack-marketplace` folder, then run:

```bash
npm install -g ./ysys143-jstack-0.0.1.tgz
jst install --source ./jstack-marketplace/plugins/jstack --host all
jst status
```

For an existing jstack-managed installation, update from the same checked bundle:

```bash
jst update --source ./jstack-marketplace/plugins/jstack --host all
```

The bare `jst update` command selects the npm registry's `latest` version. Keep
using `--source` for this GitHub-release route because `0.0.1` is not published
to npm. Use `jst status --json` when you need machine-readable output.

Use `--host claude` or `--host codex` when only one host is installed. Installing
the npm CLI does not activate plugins or grant hook trust. jstack keeps managed
versions under `~/.jstack` and reports host discovery and restart requirements.
After choosing which app/plugin skills Codex should hide, save that choice as a
portable personal default and reapply it after plugin updates or on another
profile:

```bash
jst init --capture-app-defaults --host codex
jst init --host codex
```

The first command stores plugin and skill names under `~/.jstack/preferences`
without absolute paths or versions. Repeated initialization preserves explicit
`enabled = true` overrides and unrelated `config.toml` content. It controls local
skill discovery only; account and workspace app permissions remain separate.
`jst rollback` restores the previous managed version. `jst uninstall` preserves
private profiles and user-authored skills and defers destructive removal when
active sessions cannot be ruled out. On macOS and Linux, replacing or rolling
back session-history files requires `lsof` to detect active writers; minimal
Linux installations may need it installed separately. Optional Python features
use `jst optional setup <feature>` and isolated, pinned environments.

Contributors run the following from the repository root. `npm pack` writes the
package file into the temporary release directory; the release command creates
a checked local marketplace in a new `jstack-marketplace` folder outside the source checkout:

```bash
RELEASE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/jstack-release.XXXXXX")"
npm ci --ignore-scripts
npm run build
npm pack --pack-destination "$RELEASE_DIR"
node dist/packaging/release.js --source . --output "$RELEASE_DIR/jstack-marketplace"
```

The generated marketplace is named `jstack` and contains the jstack package. Keep
it at a persistent path if registering it with a host. Creating local assets does
not publish them. The Windows Node compatibility matrix passes; feature-specific
Windows evidence is collected after canonical release. Host installation,
discovery and actual model execution are tracked as separate evidence.

## Choose a host profile

For native installation, start Claude Code or Codex with your usual profile
launcher, then follow the host instructions above. The examples and installer
limitations below apply to the alternative jstack-managed route.

With no host-root environment overrides, jstack uses `~/.claude` for Claude Code
and `~/.agents` for Codex. `jst install` installs both hosts by default.
`CLAUDE_CONFIG_DIR` and `CODEX_HOME` override the respective roots for all
installation lifecycle commands. `--home DIRECTORY` instead uses
`DIRECTORY/.claude` and `DIRECTORY/.agents`, ignoring those overrides.
jstack passes the selected roots to its host subprocesses; to launch Codex against
jstack's default installation yourself, use `CODEX_HOME="$HOME/.agents" codex`.
This does not change Codex's own default configuration directory.

Install the npm CLI once. To select an existing host profile, set its configuration
directory when running jstack and when starting that host. The examples below use
profiles named `.claude-work` and `.codex-work`; substitute the directories you
already use.

On macOS or Linux, choose the example for your host:

```bash
# Claude Code: work profile
CLAUDE_CONFIG_DIR="$HOME/.claude-work" jst install --host claude
CLAUDE_CONFIG_DIR="$HOME/.claude-work" jst status --host claude
CLAUDE_CONFIG_DIR="$HOME/.claude-work" claude
```

```bash
# Codex: work profile
CODEX_HOME="$HOME/.codex-work" jst install --host codex
CODEX_HOME="$HOME/.codex-work" jst status --host codex
CODEX_HOME="$HOME/.codex-work" codex
```

In PowerShell, set the corresponding variable for the terminal session first:

```powershell
# Claude Code: work profile
$env:CLAUDE_CONFIG_DIR = Join-Path $env:USERPROFILE ".claude-work"
jst install --host claude
jst status --host claude
claude
```

```powershell
# Codex: work profile
$env:CODEX_HOME = Join-Path $env:USERPROFILE ".codex-work"
jst install --host codex
jst status --host codex
codex
```

Use the same profile setting for later `jst update`, `jst rollback`, and
`jst uninstall` commands. Host authentication belongs to the selected profile;
jstack does not copy it from another profile.

**Current limitation:** the installer keeps one managed deployment per host in
`~/.jstack/installation.json`, not a separate record for each host profile. These
commands select a profile for that deployment; they do not support independently
managed personal and work installations of the same host. Changing Claude's
configuration directory after installation is rejected when it differs from the
recorded target. Codex also shares one deployment record and marketplace across
profiles. Do not switch profiles as a way to create a second managed installation.

`--home` selects an entire alternate user home and overrides both host-directory
variables; it is not a host-profile selector. jstack organization profiles under
`~/.jstack/profiles/` hold organization settings and do not select a Claude or Codex
installation. Native Windows feature feedback is planned after canonical release;
the CI Node matrix does not validate every Windows installation behavior.

## Hosts and personal settings

Claude uses plugin skills, commands, agents, and hooks. `/jstack:doctor` checks
dependencies and installation status; `/jstack:validate <file>` validates artifacts.
`/jstack:test-plugin` lets plugin developers run contract suites.

Codex uses its discovered jstack skill entries. Claude slash commands, agent registrations,
and automatic hooks are not registered in Codex. Request the relevant skill in
natural language and follow its explicit checks. Skill discovery or file checks
do not prove that an actual model task succeeds.

Organization configuration is stored in `~/.jstack/profiles/<name>/` after reading
and confirming candidates from the selected account. Use `/jstack:init` in Claude;
in Codex, ask workspace or setup to initialize organization configuration. This
is separate from task `workflow.js init`. Authentication tokens are not copied;
public packages contain no work IDs or default recipients.

Choose project or global scope before creating a user skill. Project skills use
`.agents/skills/` as the canonical source, with relative links in
`.claude/skills/`. They are local-only by default; sharing requires an explicit
request. Global canonical sources live in `~/.agents/skills/`. Do not bulk-migrate
existing instruction files or unrelated skills.

Automatic session commits and status line configuration are opt-in. Request
session search and Google Workspace setup through `/jstack:setup-recall` and
`/jstack:setup-workspace`, respectively. Diagnostics do not automatically install all
optional dependencies.

## Task model routing

`jst route plan --request request.json` selects a supported model for authorized
work. `jst route run --decision decision.json` reserves and executes a CLI attempt
or returns instructions for native delegation. Record independent verification
with `jst route record --decision decision.json --result result.json`.

Routing preserves explicit model choices and host permissions, prefers native
execution, and allows at most one transition after a verification failure.
No model name implies a permanent tier. See [the routing contract](runtime/ROUTING.md)
for request fields, evidence, capability limits, and private state storage.

## Contributing and validation

Sources live in `skills/`, `runtime/`, `hosts/`, and `packaging/` at the repository
root. Do not edit generated installation entry points. Follow
[AGENTS.md](AGENTS.md) for validation commands and contribution rules.

```bash
node dist/packaging/run_contracts.js --output /tmp/jstack-contracts
node dist/packaging/run_contracts.js setup workspace --output /tmp/jstack-selected-contracts
```

The full owning run requires the isolated specialist test dependencies listed in
[the CI workflow](.github/workflows/validate.yml). The runner builds a new
package and runs contracts and deletion regressions in a temporary Git snapshot. Development records and promotion checks read the original
checkout. Its index is not staged or committed; a full run fails if required
source-only checkers are missing. An installation cache alone cannot establish
that full source validation has run.

## Security validation support

Security requests first establish the threat model and finding evidence. For
executable projects, task verification connects the original reproduction, the
same input after the fix, regression checks, and variant inputs. The project
supplies the verdict method; execution currently supports reviewed
`trusted-local` targets. An OS isolation adapter is not yet available, so
`isolated` execution is blocked.

Task requests, amendments, actual execution and requirement evidence are connected by
`jst task capture|observe|assess|status|resume`. See [request continuity](runtime/TASKS.md).
