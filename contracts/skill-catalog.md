# Skill catalog and discovery contract

Authority: `contracts/skill-catalog.json`, selected by `packaging/product.json`.
The catalog classifies every first-party source owner exactly once. A directory
containing `SKILL.md` does not by itself grant public discovery. Embedded upstream
trees remain resources of their owning workflow and retain their paths and notices.

## Boundaries

- **Public workflows** perform a recognizable user task and own its outcome and
  verification. Categories are workflow, engineering, artifacts, research, and
  operations. Categories are directories, not additional router skills.
- **Support** supplies a conditional procedure to named public owners. Its body,
  scripts, host variants, and owning tests remain in the payload. It has no native
  discovery entry. A public adapter lists only its applicable support conditions;
  the agent loads a body when that condition occurs, never the complete library.
- **Shared contracts and runtime** remain under `contracts/` and `runtime/`.
  Task lifecycle, specification links, observations, assessments, and transitions
  are shared behavior, not additional skill descriptions or another source tree.
  The local work-report core follows the same rule: `runtime/work_report.js` may
  be called by any selected workflow. `wrapup` is one user-facing convenience
  workflow for explicitly requested personal period reports; it is not a global bootstrap
  or a gate before other work.
- **Host adapters** select reviewed host bodies and resolve tools, paths, and
  discovery conventions. A successful installation or discovery probe is not
  model behavior evidence. The catalog does not select a preferred model family.
  Luna, Terra, Sol, Astra, Haiku, Sonnet, Opus, Fable, and future candidates are
  considered through the existing capability/runtime layer when available;
  availability is probed and no family becomes a workflow prerequisite.

Names describe the task or artifact, not an upstream framework or model.
`humanize` retains technical clarity beneath its existing owner.
`agent-maintenance` retains profile, stale-entry, project rename, and both-host
session maintenance. `test-driven-development` is not advertised as covering
every implementation task. `image-generation` includes image editing;
`svg-diagram` owns structured SVG geometry. Neither absorbs the other's contents.

## Delivery and compatibility

The build derives `entries/<host>/<category>/<name>/SKILL.md`, frontmatter names,
Claude's explicit leaf-path list, Codex's recursive entry root, and the receipt's
public roster from the catalog. No support body or category gets an entry.
Portable authoring remains `.agents` first; jstack itself is installed as a native
plugin, not inside any user `skills/` directory. Host overrides remain supported.

Source owners are stable internal identities. Changed public names retain their
old owner as a unique lookup alias in `jst catalog resolve NAME --host HOST`.
The resolver returns the public native ID or the correct support body for that
host. Lookup aliases are not native calls unless explicitly listed in
`nativeAliases`. A reviewed native alias generates a short entry for both hosts,
with `disable-model-invocation: true` and a reference to the same host-selected
payload body. There is no second authored body or workflow owner. Receipts count
all native entries, including compatibility entries. Existing Claude commands
retain their names; do not add a command that collides with a skill alias.
A command carries a `description` only when no public skill carries its intent;
a command that invokes a skill has none, so it costs nothing in the
model-facing listing and its first body line (`# /name — hint`) is what the `/`
menu shows. The `host-audit` suite measures the built package as the host does
and fails when jstack's own share of the Claude listing exceeds 5,000 characters, a
listed skill description exceeds 100 display columns (a Korean character counts
2), or a described command exceeds 60. The share limit does not promise that
every description is shown: Claude Code's own skills use the same budget, about
6,000 characters at the default fraction of a 200K window, so there the host
keeps descriptions by usage until the fraction is raised to about 0.02.
Host honoring of invocation metadata is separate from model behavior evidence.

New catalog packages fail if the catalog is missing, an owner is unclassified,
names or aliases collide, a support consumer is absent, or receipt/manifests/entry
paths differ. Older checked packages without the catalog marker remain readable
for rollback; the presence of a catalog without the marker is an error.

## Migration stages and acceptance

1. **Catalog and delivery:** classify every existing owner; export the public
   hierarchy; preserve all payloads and tests; provide old-name lookup; update
   discovery probes, documentation, and recursive cost measurement.
2. **Source relocation:** move canonical public/support owners into matching
   source directories while updating module/resource paths, suite discovery,
   explicit membership, and frozen-reference ownership together. Do not copy a
   second source tree or claim generated hierarchy is canonical relocation.
3. **Activation:** prepare a new immutable candidate, run full owning contracts,
   probe installation in both hosts, then update the selected real profiles.
   Report model evaluation separately. A source change alone is not installation.

Canonical sources now live in `skills/public/<category>/<name>/` and
`skills/support/<name>/`; Codex-specific source bodies mirror those paths under
`hosts/codex/`. Source frontmatter names match their directory names. There are
no old-path source links or copied compatibility source trees.

`sourceLayout: hierarchical` declares this source arrangement. Explicit package
membership maps each source to a stable internal `payload/skills/<owner>/`
address. The payload is generated, not a second maintained tree. This internal
address preserves existing resource and owning-suite protocols; it is not a
native discovery root. The compiler relocates module imports and static
`new URL(..., import.meta.url)` resources through the same reviewed membership.
Payload frontmatter retains the internal owner identity; public entries retain
the catalog's public identity. Contributor tools resolve logical owner paths
with `runtime/skill_catalog.ts:sourcePath`; installed tools use payload addresses.

Generated entries and payloads are never edited. Counts are derived from JSON,
not used as design targets. Every capability needs a declared boundary.

Acceptance includes behavior tests for invalid catalog states, support exclusion
with retained payload and host body, alias resolution, source-independent nested
entries, tampered discovery rejection, old-package reading, and recursive cost
accounting. Native Claude inventory and Codex `skills/list` must equal the declared
public IDs. Validation evidence records the package source hash and host versions.

## Reference decisions

- [Charness](https://github.com/corca-ai/charness): adopt public/support/shared
  separation. Lifecycle and evidence contracts belong in runtime, not more skills.
- [Paperthin](https://github.com/LilMGenius/paperthin): adopt physical discovery
  hierarchy and explicit leaf exports; avoid unexplained abbreviated names.
- [Skillstead](https://github.com/kyungseo/skillstead): retain complete workflows
  and their owned resources; a folder category alone does not make a useful skill.
- [Cursor Team Kit](https://github.com/cursor/plugins/tree/main/cursor-team-kit):
  prefer recognizable tasks; its flat task list is not a hierarchy specification.
- [Warp common skills](https://github.com/warpdotdev/common-skills/tree/main/.agents/skills):
  adopt portable storage and concrete tasks; exclude organization assumptions,
  redundant workflows, and unsolicited messaging behavior.

These are structural references, not claims of complete framework equivalence.

## Storage operations

`disk-manager` owns filesystem diagnosis, storage history and selected space recovery.
`dashboard` owns model usage and statusline configuration; `usage-status` resolves
to it through catalog lookup only. Disk collection has no automatic deletion and
shares one private state store and opt-in scheduler across hosts. Personal source
logs and databases are excluded from package membership.

## Skill authoring compatibility

The public authoring workflow is `skill-creator`, with stable owner `author`.
At the user's explicit request, `author` remains a real native compatibility
invocation in both hosts. `skill-authoring` is a catalog lookup alias. Creation
and improvement include associated commands, agents and hooks. The existing
`validate` command remains a separate verification task.

Public entries may declare `invocation: explicit`. The build emits Claude
`disable-model-invocation: true` and Codex `agents/openai.yaml` with
`policy.allow_implicit_invocation: false`, includes both in the checked surface,
and rejects tampered policy even if the byte receipt was rewritten. This is
selection metadata; runtime still checks actual explicit selection provenance.
