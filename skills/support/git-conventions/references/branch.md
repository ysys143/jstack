# Branch naming — upstream source (reference)

Source: `plugins/session-and-git/skills/branch-name-convention/SKILL.md`
(commit `539406b`) — inherited with frontmatter removed.

**`SKILL.md` is authoritative.** This reference preserves the format defined
upstream, which differs from the format used in practice. `SKILL.md` explains
the difference and evidence under "[Source correction]." In brief, upstream
requires the three-part `<folder>/<category>/<description>` format below, and
**7 of this repository's 79 remote branches actually use it** (the newest is
from 2026-03-15). An earlier version incorrectly said there were none. The
dominant form is the two-part `<type>/<kebab-case>` format (70 of 79, including
`docs/add-development-guide`). That is also the form made authoritative by
`CLAUDE.md` and enforced by `scripts/check_commit.js --branch`.

## Format
`<folder>/<category>/<description-in-kebab-case>`
- All branch names must be in English
- Use kebab-case for description

## Folder (Work Area)
| Folder | Description |
|--------|-------------|
| infra | Infrastructure work |
| server | Backend work |
| web | Frontend work |

## Category
| Category | Description |
|----------|-------------|
| feature | Add new feature |
| refactor | Modify existing code |
| bug | Fix bugs |
| test | Add or modify tests |
| docs | Documentation work |
| chore | Non-code changes (build, config, etc.) |
| hotfix | Urgent fixes (direct to master) |

## Examples
- `web/feature/email-verification-workflow`
- `web/bug/fix-login-error`
- `server/feature/add-user-profile`
- `server/feature/2fa-auth`
- `server/refactor/board-query-performance`
- `infra/test/build-performance`
- `infra/chore/ci-cd`
