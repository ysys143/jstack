# Merge worktree

Squash-merge the current worktree branch back into the target branch with a
comprehensive, structured commit message.

Inherited from the former `merge-worktree` command. Two things changed on the
way in: the commit trailer template was removed — `gitrules` owns trailers, and
a second copy of it here would drift — and the dynamic `!git ...` context block
became plain commands, because a reference is read, not executed.

## Current context

Gather these before anything else. Every later phase reads one of them.

| What | Command |
| --- | --- |
| Git dir | `git rev-parse --git-dir` |
| Current branch | `git branch --show-current` |
| Recent commits | `git log --oneline -20` |
| Working tree status | `git status --short` |

## Instructions

Follow these phases exactly, in order. Do NOT skip phases.

---

### Phase 1: Validation

1. **Verify worktree**: Check `git rev-parse --git-dir` contains `/worktrees/`. If not, stop:
   > "This must be run from inside a git worktree. Create one first."

2. **Identify current branch**: `git branch --show-current`

3. **Resolve target branch**: Use the target-branch argument if provided, else detect `main` or `master`.

4. **Identify original repo path**: Use `git rev-parse --git-common-dir` to find main repo root.

5. **Clean working tree**: Run `git status --porcelain`. If uncommitted changes exist, stop.

---

### Phase 2: Research

1. **Commit history**: `git log --oneline <target>..HEAD`
2. **File change summary**: `git diff <target>...HEAD --stat`
3. **Full diff**: `git diff <target>...HEAD`
4. **Read key files**: read the significantly changed files
5. **Categorize**: feat / fix / refactor / test / docs / chore
6. **Identify dominant conventional commit type**

---

### Phase 3: Target branch preparation

1. Check target branch state: `git -C <original-repo-path> log --oneline -10 <target>`
2. Detect stray WIP commits (messages starting with `wip:`, `WIP`) -- warn user
3. Fetch latest: `git -C <original-repo-path> fetch origin <target> 2>/dev/null`

---

### Phase 4: Squash merge

1. Checkout target in original repo: `git -C <original-repo-path> checkout <target>`
2. Squash merge: `git -C <original-repo-path> merge --squash <worktree-branch>`
3. If conflicts: list files, show markers, **stop and report** -- do NOT auto-resolve

---

### Phase 5: Craft commit message and commit

Structure:
```
<type>: <concise summary in imperative mood, under 72 chars, no period>

<2-4 sentence paragraph explaining what was done and WHY.>

Changes:
- <grouped bullet points>
```

Trailers are not written here. `gitrules` owns the trailer set for this
repository; copying a template into this file would give the repository two
answers to the same question, and the stale one wins whenever someone reads
this page instead of that skill.

Commit using heredoc:
```bash
git -C <original-repo-path> commit -m "$(cat <<'EOF'
<commit message>
EOF
)"
```

---

### Phase 6: Verification

1. Confirm: `git -C <original-repo-path> log --oneline -3`
2. Report: commit hash, summary, target branch
3. Remind: worktree branch still exists; delete with `git worktree remove <path>` if done
4. Remind: `git push` to push to remote

---

## Important notes

- Never force-push or use destructive git operations without explicit user confirmation
- Never skip pre-commit hooks (`--no-verify`)
- If anything unexpected happens, stop and explain rather than guessing
