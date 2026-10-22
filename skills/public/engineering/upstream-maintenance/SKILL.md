---
name: upstream-maintenance
description: "Import or update third-party code with license and provenance. Triggers: 업스트림 반영, 외부 코드."
---

# Upstream — decide, then copy

## Copy by default; record what you copied

**The default is to bring it in.** Something published openly, small enough to
read in one sitting, and functional rather than expressive — a converter, a
linter, a zip utility — gets copied. Waiting on a grant that will never arrive
costs more than it protects.

Record the class you found anyway, including `none`. The record is not
permission-seeking; it is so the next reader knows what they inherited without
re-deriving it. `references/license-classes.md` has the classes.

**What still needs a decision before the copy** is the narrow set where the
grant puts obligations on *other people* — strong copyleft reaching the whole
distributed work, non-commercial restricting every downstream user, and
vendor-internal material under an actual contract. Those are not about our risk;
they change what our users may do, and they cannot be undone by deleting the
file later.

**Reimplementation is always open.** Copyright covers expression, not the idea,
the algorithm, or the function. Reading something and writing your own is
unconditional — `diagram` took archify that way ("rewrite everything in Python"). Reach for
it when the upstream is large, when its structure does not fit ours, or when the
grant would put obligations on our users. Not because a file was missing.

## Record the path, not the line

A citation that says `SKILL.md:263` and not which `SKILL.md` cannot be checked
by anyone, including you a week later. Line numbers move on the next upstream
commit; paths do not. Record, for every imported asset:

| Field | Why it is not optional |
| --- | --- |
| Source path or URL | Without it the citation cannot be resolved at all |
| Licence class, as measured | "Measured" means you opened the licence file, not that you recognised the project |
| Version or commit id | The licence and the content are both version-specific |
| Local path in this repository | So the next reader finds the copy from the record, and the record from the copy |

The record lives next to the files, not in a plan document. Plans get archived;
the copy does not.

## Copy bytes, change nothing in the same commit

Vendor the file byte-identical, then make local changes in a **separate**
commit. One commit that both imports and edits cannot be diffed against
upstream, which is the only way to answer "what did we change?" later.

Write a hash manifest at import time and check it in the suite. A manifest
generated from the copy proves nothing about upstream; generate it from the
fetched original, before any edit.

## Bring the test with the tool

If you vendor a verifier, vendor its tests. A verifier without its tests rots
silently: it keeps exiting zero while its judgement quietly stops working, and
nothing in your repository can tell the difference between "found nothing" and
"checks nothing". This is the failure mode that makes a vendored checker worse
than no checker — it produces a green signal you did not earn.

## Do not vendor a maintained CLI

If a well-maintained tool already does the job, depend on it and document how to
install it. A reimplementation inherits the bugs the upstream already fixed and
none of the fixes it makes next month. Vendor when the asset is *content* —
rules, prompts, reference material, a small verifier — not when it is a program
with a release cadence.

When a dependency is missing, say what to install and stop; installing on the
user's behalf is a separate decision that belongs to them.

## Updating an import

1. Re-fetch the same asset at the new version.
2. Diff it against the recorded manifest — that diff is the upstream change.
3. Re-apply the recorded local changes on top, as their own commit.
4. Update the version field and the manifest together, in that commit.

If step 3 has no record to re-apply, the original import was made wrong, and the
fix is to re-import from upstream rather than to guess which lines were local.

## Boundary

Whether the copied code is any good is the `audit` skill. Removing what the
import made redundant is the `cleanup` skill. This skill covers the decision,
the record, and the bytes.
