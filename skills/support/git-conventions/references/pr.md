# PR convention — upstream source (reference; label table reduced to an example)

Source: `plugins/session-and-git/skills/pr-convention/SKILL.md`
(commit `539406b`) — inherited with frontmatter removed.

**This document is not authoritative for label rules.** Each repository has a
`.claude/pr-policy.json`, which `validate_pr_label.py` reads and enforces when
`gh pr create` runs; see "## PRs — the repository owns the label rule" in
`SKILL.md`. The table below was an organization-wide rule upstream. Here it is
only **an example of the values currently observed in this repository**. When
values change, update `.claude/pr-policy.json` or the GitHub labels shown by
`gh label list`. Editing this table does not change enforcement; policy-file
rediscovery supplies updates.

**`@package` was removed.** The upstream Position-label table included it, but
this repository's `.claude/pr-policy.json` lists it under `phantom_labels`. It
appeared in organization documentation but was never defined as a GitHub label
for this repository, as confirmed against `gh label list`.

## Constraints (CRITICAL)
- NEVER include phrases like `Generated with Claude Code` or `Co-Authored-By: Claude` in PR messages
- MUST include at least one position label AND one category label via `--label` flag when creating PRs

## Format

### Title (Required)

Write a clear, free-form title in English that describes the changes.

Examples:
- `Add user profile image upload`
- `Fix infinite loading on the login page`
- `Move order processing into the service layer`

### Body (Optional)

#### Issue Linking
```
closed #123
```

#### PR Dependency
```
depends on #456
```

## Labels — current repository values (example, not authoritative)

**2 labels required per PR:**

### Position Labels
| Label | Description |
|-------|-------------|
| @web | Web/Frontend related work |
| @server | Backend feature addition or modification |
| @infra | Infrastructure related work |
| @database | Database related work |
| @agent | AI Agent related work |
| @docs | Documentation related work |

### Category Labels
| Label | Description |
|-------|-------------|
| feature | Add new feature |
| bug | Fix functional errors |
| remove | Remove unnecessary code or files |
| performance | Performance improvement |
| refactoring | Code refactoring |
| ci/cd | CI/CD related work |
| testing | Add or modify test code |
| dependencies | Dependency management |
| security | Security fixes |
| development | Development environment setup |
| documentation | Add or modify documentation |
| ignore-for-release | Exclude from release changelog |

## Command Usage

```bash
# Feature PR
gh pr create \
  --title "Add user profile image upload" \
  --body "closed #42" \
  --label "feature" \
  --label "@web"

# Edit existing PR
gh pr edit \
  --add-label "feature" \
  --add-label "@web"
```
