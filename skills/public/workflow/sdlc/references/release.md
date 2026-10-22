# Release — scoped writes and observed outcomes

Release starts only after the selected contract passes Prove. Stage only the
change's own files, preserve unrelated index/worktree changes, and verify again
if staging invalidated the receipt. Never use an automatic commit or stash to
bypass a dirty-tree prerequisite. Prepare the actual diff, target tree, branch,
remote and PR proposal before asking for any missing authority.

For local-commit, record commit authority for the exact parent and staged tree,
record invoke, execute the native commit command, then read back the result.
Run verify again for the new HEAD. Existing unchanged output can use reuse-commit
with its observed HEAD and fresh verification; do not create empty commits.
Remote and ship steps are N/A for this endpoint, with the recipe/endpoint recorded
in run history. A local-commit run makes no PR or merge-readiness claim.

For pr-and-ship, perform the same commit path, then obtain or reuse authorization
for the exact push remote/branch/HEAD and PR repository/head/base. Record each
invoke before the native tool call. On response loss, use readback; do not retry
until it confirms absence. Push only the approved branch without force. Create
or inspect the requested PR without merging. Verify provider CI against the
current repository, HEAD, run/job and attempt; use verify's CI diagnosis only
for diagnosis, never as a passing verification receipt. Bind required CI checks
into the code contract so Prove and final ship cannot omit them.

The run's readback uses local Git for commit, ls-remote for push, and GitHub's PR
API for PR identity. Unknown, mismatched or unavailable evidence remains unknown.
A confirmed present action is not repeated. Read back remote state again before
completion. An old successful observation is not evidence of the current remote.

Obtain or reuse authority for the ship check, then follow verify's shared
[ship gates](../../verify/references/ship-gates.md). Run the repository's check
command recorded at entry. Only after it passes check mergeability and a concrete
rollback commit. Conflict fixes return to Execute/Inspect/Prove as needed; HEAD,
base or file changes invalidate their dependent evidence. A ship verdict performs
no push, merge, deployment or npm publication.

Finally request the `complete` event and read run status. All required acceptance,
review, current receipt and selected Release outcomes must still be valid.
Failure, interruption or handoff preserves remaining gates and uncertain effects.
