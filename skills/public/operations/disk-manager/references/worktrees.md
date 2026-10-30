# Git worktrees

Agent sessions leave linked worktrees behind, and each one is a full checkout,
often with its own dependency folder. A large worktree is still not evidence
that it is disposable: it may hold the only copy of unmerged work.

## Audit first, read-only

```bash
node "${JSTACK_PLUGIN_ROOT}/skills/disk-manager/scripts/worktree_audit.js" --repo DIR [--base REF] [--no-gh]
```

The script enumerates `git worktree list`, and for each worktree reports the
branch, whether its HEAD is already in the base ref, how many commits it is
ahead, tracked edits, untracked files (a count and the first few names), commits
not pushed to its upstream, and the pull request state from `gh` when `gh`
answers. It removes, prunes, fetches and writes nothing; it reads status without
refreshing the index. `--no-gh` skips the pull request lookup.

`candidateForUserReview` is `true` only when nothing in the report blocks a
look: not the primary worktree, not locked, directory present, no tracked edits,
no untracked files, nothing unpushed, and either merged into the base ref or
shown merged by a pull request. It means "show this one to the user", never
"delete this one". Every `false` carries its reasons in `blockers`.

## What the signals do not tell you

- **Merged by ancestry misses squash and rebase merges.** Their commits never
  enter the base ref, so such a branch looks unmerged. The pull request state is
  the second signal; `gh` unavailable (`status: unavailable`, with the reason) is
  unknown, not "no pull request". Commits pushed after the merge are not covered
  by either signal, so compare the content before proposing removal.
- **Ignored files are not listed.** Environment files, local databases and build
  output ignored by git do not appear in the untracked count. Check with
  `git -C PATH status --ignored --short` before presenting a worktree as clean.
- **A missing base is reported, not guessed.** Without `origin/HEAD`,
  `origin/main`, `origin/master`, `main` or `master`, every non-primary worktree
  is blocked. Pass `--base REF` to compare against another ref.
- **Size comes from measuring, not from this report.** Measure a chosen path with
  `du` under the SKILL's bounded-scan rule before estimating recoverable space.

## Removal stays with the user

The audit selects nothing. Present the candidates with path, branch, merge and
pull request state, measured size and blockers, then follow step 4 of `SKILL.md`:
act only on worktrees the user names, and recheck each one immediately before
removing it.

- Use `git worktree remove PATH` without `--force`. If it refuses, report the
  refusal; do not retry with `--force` unless the user has read the list of edits
  that would be lost and chose that worktree anyway.
- Deleting the branch is a separate decision from removing the worktree. An
  unmerged branch keeps the only reference to its commits.
- `git worktree prune` clears records whose directory is already gone. Run it
  only for entries the user selected, and not for a worktree on a disconnected
  volume or a locked one.
- Do not unlock a locked worktree; the lock reason belongs to whoever set it.
