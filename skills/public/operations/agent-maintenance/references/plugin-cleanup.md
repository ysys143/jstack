# Claude plugin ghost entries

Capture the exact `plugin@marketplace` key and error from the affected host. Resolve
that host's configuration root from its launcher; do not assume the current process
uses the user's target profile. Discover other profiles only when comparison is needed.

Read the installed registry, configured marketplace paths/catalogue and applicable
user/project/local enabledPlugins layers as structured data. A marketplace may be
outside `plugins/marketplaces`. An empty directory or missing registry alone does not
prove stale enablement. Use the installed CLI's supported listing interface as evidence.

Distinguish a confirmed stale key from a missing installation, moved marketplace,
unavailable catalogue, scope mismatch or malformed registry. Uncertain diagnosis stays
unresolved; do not disable an intended plugin to hide an installation problem.

For authorized cleanup of a confirmed stale key:

1. Stop settings writers and save original bytes, mode and hash to a private backup.
2. Construct a candidate removing only the exact key from the affected layer. Preserve
   all other keys, including disabled false entries, hooks and permissions.
3. Parse and compare the candidate, recheck the original hash, then atomically replace
   through a same-directory temporary file. A hash check is not a lock; if writers
   cannot be stopped, keep the candidate for later application.
4. Read back the diff and JSON, then check the affected host's plugin manager after
   reload. A file edit alone does not prove the error disappeared. Record the backup
   and reverse change; rollback must preserve later unrelated edits.

Do not delete caches, marketplace registrations, credentials or package sources as a
shortcut. Finding the same key in other profiles does not authorize changing them.
General installation repair is a separate operation determined by the diagnosis.
