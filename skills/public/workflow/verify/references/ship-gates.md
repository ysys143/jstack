# Shared ship gates

This procedure produces a pre-merge verdict on one concrete HEAD. It does not
push or merge. Stop when a preceding step fails.

1. Require `git status --short` to be empty. Uncommitted changes are not the subject.
2. Run the repository's own check command. Zero passing checks is not a pass.
3. Check mergeability against the selected base. If resolving a conflict changes
   the source, run the affected review and fresh checks again before proceeding.
4. Establish a concrete rollback path before reporting a passing verdict.

Bind the verdict to repository, HEAD, base, check output and relevant inputs.
Changed inputs invalidate it. An unavailable checker, interrupted run or uncertain
outcome remains incomplete. Preserve the existing optional acceptance walkthrough
when invoked from the Claude ship command; that offer is not an additional gate.
