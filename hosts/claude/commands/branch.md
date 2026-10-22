---
description: Create a branch from the right base with a clear name
---

# /branch — check the base first

## Sequence

1. **Check where the branch starts.** Use `git status` for the current branch and
   clean state, and `git log --oneline -1` for the base commit. Branching from a
   dirty tree carries other people's changes into your work.
2. Check that the base is current. An outdated base creates work at merge time.
3. Choose a name **that remains readable later**. Its purpose must be apparent in
   a branch list; `fix-2` conveys nothing a week later.
4. Inspect existing branch naming patterns first. Follow any prefix convention.
   `check_commit.js --conventions` from the `gitrules` skill lists the branch types
   an organization profile allows.

## Judgment

| Create a branch | Do not create one |
|---|---|
| Changes that need independent reversal | A one-line typo fix |
| Changes requiring review | Agreed mechanical changes |
| Several commits that belong together | Settled work rather than an experiment |

## Boundaries

**Do not create a remote branch.** A local branch can be deleted; others see a
remote branch. Do not force-move an existing branch; others may depend on it.
