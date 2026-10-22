---
description: List jstack's public workflows and support boundaries
---

# /skills — read the declared catalog

## Procedure

Read the public groups from the installed catalog. Do not infer public visibility
from every source directory or maintain a copied inventory: a copy silently becomes stale.

```
node ${CLAUDE_PLUGIN_ROOT}/runtime/catalog_cli.js list
```

For each public workflow, report its native name, task, and exclusion boundary.
Keep conditional support separate. Resolve previous names with
`node ${CLAUDE_PLUGIN_ROOT}/runtime/catalog_cli.js resolve NAME --host claude`.
Aliases are lookup compatibility, not additional native slash commands.

For source maintenance, `skills/*/SKILL.md` still identifies owning bodies and
tests. That inventory includes hidden support and is not the public skill list.

## Contract status

`scripts/inspect.js <skill-name>` reports layers, frozen references, and check
counts. A skill with no contract returns **exit code 1**: absence of a contract
must not appear as success.

## Outside this plugin

```
scripts/search_api.js skills <query>
scripts/search_api.js plugins <query>
```

These query the public marketplace (claude-plugins.dev). **They answer a different
question:** this command lists this plugin's contents; marketplace search finds
what exists elsewhere. Confusing these roles previously lost the search capability
during migration.

If `curl` is absent, return exit code 2 and print installation instructions without
installing it.

To install a result this finds, use `/install-skill <namespace>`. Searching
only looks; that command is the one that writes.

## Choosing a skill

The `skills/help/SKILL.md` support body provides the situation-based map when
needed. This command answers **what exists**; that body helps with **what to use**.
