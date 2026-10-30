# Exceptions — what the checker reads, and from where

The deprecated-model check runs as a PreToolUse hook on `Write`, `Edit`, and
`Bash`. Two path contracts decide what it does: one file it reads from the
**project**, one database it reads from the **plugin**. Both are here.

## The two switches

The project declares them in `pyproject.toml`, under `[tool.claude-hooks]`.

| Switch | Shape | What it does |
| --- | --- | --- |
| `approved_legacy_models` | list of model ids | Those ids stop warning. Everything else still checks |
| `check_model_versions` | `false` | The whole check is skipped for this project |

```toml
[tool.claude-hooks]
approved_legacy_models = [
    "gpt-4o-mini",   # 15c/1M tokens — high-volume classification, cost decides
    "claude-3-opus", # reproducing the numbers in the 2025 eval, must not drift
]
```

Reach for the list first. `check_model_versions = false` turns off the axis for
every file in the tree, including the ones nobody has looked at in a year, and
nothing later reports what it stopped catching.

## Write the reason next to the entry

An exception is a claim that this old id is right **here**. Without the reason
the next reader cannot tell a considered exception from an id somebody silenced
in a hurry, so nobody ever removes one — the list only grows, and after a while
it is the real model policy of the project.

Two reasons recur and both are legitimate:

- **API-only models.** Some ids are retired from the consumer product but still
  served by the API and still much cheaper. The checker reads the deprecation,
  not your invoice.
- **Reproduction.** A published result is tied to the model that produced it.
  Upgrading the id silently invalidates the comparison.

## The file is read by regex, not by a TOML parser

The hook does not parse TOML. It runs two regexes over the whole file text.
That has four consequences, and every one of them has bitten someone:

| What the regex does | Consequence |
| --- | --- |
| Matches `check_model_versions\s*=\s*(true\|false)` anywhere in the file | The key is **not scoped to `[tool.claude-hooks]`** — the same line under any table, or inside a string, disables the check |
| Returns at the **first** `pyproject.toml` found walking up from the cwd | A nested package's file shadows the repository root's, so the root's exceptions silently do not apply |
| Pulls every quoted string out of the `approved_legacy_models` array | A commented-out entry inside the array is still approved |
| Stops the array at the first `]` | A nested bracket truncates the list, and the entries after it are quietly not approved |

None of these fail loudly. If an exception seems not to be taking effect, check
which `pyproject.toml` was actually found before suspecting the id.

## Fail-open is the design, not an accident

Every failure path allows the operation:

- the database fails to import
- `pyproject.toml` cannot be read or matched
- any unexpected exception anywhere in the hook

A checker that blocks work when its own machinery is broken gets disabled
permanently within a week, and then it protects nothing. The cost is real and
accepted: a broken checker is indistinguishable from a clean tree.

## Where the database lives

The hook resolves the database **relative to itself** — `hooks/` next door to
`scripts/models_database.js` — so the plugin can be renamed, moved, or installed
from a cache and the import still resolves.

**Never locate it by plugin name.** The pattern that shipped in an earlier
plugin was:

```bash
# WRONG — dies the day the plugin is renamed, and dies silently
find ~/.claude/plugins/cache/<marketplace>/<plugin> \
     -name "models_database.js" | sort -V | tail -1
```

`find` on a path that no longer exists prints nothing and exits 0. The variable
holding the destination becomes empty, `cp` fails or writes to the wrong place,
and the sync step reports success. Use the plugin's own root instead:

```bash
DB="${JSTACK_PLUGIN_ROOT}/scripts/models_database.js"
```

The same rule kills the other legacy shape, `Glob **/model-version-checker/hooks/
models_database.js` — a glob over a directory name is the same hardcoded name
wearing a different hat, and it also matches the wrong copy when two versions
are installed side by side.

## Edge cases

| Scenario | Behaviour |
| --- | --- |
| Provider prefix (`anthropic:claude-3-opus`) | Normalised to the bare id before lookup |
| Id not in the database at all | Not blocked, but an `[UNKNOWN]` notice names the id — an unknown id is more likely private or new than retired, and the notice asks for it to be added or corrected |
| Id in `approved_legacy_models` | Allowed, no warning |
| `check_model_versions = false` | Nothing is checked |
| Family pattern (`qwen2.5`) | Caught by pattern even with no exact entry |
| Binary file | Skipped by extension |
| No `pyproject.toml` anywhere above the cwd | Checks normally, with no exceptions |
| `pyproject.toml` unreadable | Allowed (fail-open) |
| Id inside a comment, a doc example, a document (`.md`, `.txt`, `.rst`) or a file outside the project | Still warned — documentation ages the same way code does — but documents and files outside the project are not blocked, since they mention models without calling them |
| Several retired ids in one edit | All of them are reported, not just the first |

The last two are the ones people argue with. Documentation that recommends a
retired id does more damage than code that uses one, because the code stops at
one call site.
