# User skill storage and host connections

When saving work as a skill, ask project/global scope once if unspecified. With
no answer, prepare only a draft and do not write to the user home. Do not ask again
when scope is already specified. Write the common body first and describe only
actual host invocation differences separately.

Requests such as “make the lessons from this session a project skill” already
specify project scope. Place them through this interface without asking again.
Never write separate `.claude` and `.codex` copies: the project source belongs in
`.agents/skills`, and host discovery is a connection to that source. Before placing,
review session-derived tool names, agent calls, permission assumptions, hooks and
runtime paths. Keep a host-specific procedure conditional when no verified common
operation exists.

Prepare SKILL.md with name/description frontmatter and required assets in a draft
directory. Do not include external symlinks. Declare support boundaries when
host-specific tools are required. Never claim compatibility without verification.

## Default local project storage

```bash
node "${JSTACK_PLUGIN_ROOT}/runtime/skill_store.js" place --scope project \
  --project "<project>" --name <skill-name> --source "<prepared skill directory>"
```

The canonical source is `.agents/skills/<name>` at the Git top level. Create a
relative symlink at `.claude/skills/<name>` pointing to it. Exclude only those two
exact paths in a jstack-managed block in the file returned by
`git rev-parse --git-path info/exclude`. Never exclude other skills or entire
parent directories. Disclose the scope when other worktrees share that exclude.

Exclude cannot hide already tracked files. Never untrack automatically; obtain a
new name or explicit edit scope. Non-Git projects use local storage without a
guarantee that later git init will exclude it. Local authoring alone does not
modify tracked AGENTS.md or CLAUDE.md. Preserve existing real directories, other
links, and same-name skills. Placement never removes anything.

## Global storage

```bash
node "${JSTACK_PLUGIN_ROOT}/runtime/skill_store.js" place --scope global \
  --claude-home "<active Claude config directory>" \
  --name <skill-name> --source "<prepared skill directory>"
```

The canonical source is `~/.agents/skills/<name>`. Create a relative link in the
active Claude config's skills directory. Do not add another copy to Codex's shared
discovery path or change every Claude profile together. If linking is impossible,
do not silently substitute a copy.

## Sharing and maintenance

Suggest sharing when team reuse is clear. Only after the user selects sharing:

```bash
node "${JSTACK_PLUGIN_ROOT}/runtime/skill_store.js" share --scope project \
  --project "<project>" --name <skill-name>
```

Remove only jstack-owned exclude entries. If another ignore rule blocks sharing,
restore the previous state and report the blocking boundary. Make the canonical
source and relative link eligible for Git inclusion without stage, commit, or
push. The `local` operation for reverting shared skills also rejects tracked files.

Setup uses `connect` for missing host connections to healthy canonical sources.
Connect preserves local/shared state, exclude, and index; it repairs links only.
Never overwrite other or broken links. Inspect ownership and the existing target
first, make explicitly authorized corrections, then rerun connect. Doctor runs
`inspect` only.

Report canonical and linked paths, local/shared scope, and verification level.
This tool checks files and Git. Separately verify that Claude and Codex discover
each exposed skill exactly once and global skills across projects. A healthy link
does not establish semantic host compatibility or model execution success.

Git project placement records locks, state, and exact excludes in metadata paths
returned by `git rev-parse --git-path`. If the host sandbox blocks writing, use
its approval procedure limited to this project's changes. If unapproved, preserve
the draft and report incomplete placement. Never disable the sandbox or move
`.git` paths to bypass it.
