# macOS storage diagnosis

Use `df -k /System/Volumes/Data` for a timestamped filesystem observation and
`diskutil info /` for APFS container context. `du -sk PATH` reports allocated
blocks; a sparse VM file's apparent size is a different measurement. APFS clones,
snapshots, cloud placeholders and concurrent writers make simple sums misleading.

Inspect home, Library/Containers, Library/Application Support, Library/Caches,
Library/Mobile Documents, Downloads, Movies, Pictures and Desktop as needed.
Limit each scan and expose permission failures; do not escalate automatically.
Use `dust` or `fd` optionally when installed; their absence must not block `du`.
For files, inspect allocated and logical size separately. An archive and an
extracted directory are only duplicate candidates until content is verified.

Docker Desktop and Colima can coexist with separate VM disks. Colima's presence
does not establish that Docker Desktop or a UTM VM is unused. Confirm its owner,
contents and recovery path before proposing removal. Application Support usually
contains persistent profiles, not just caches: Chrome profiles are distinct from
Chrome cache; Google DriveFS must be inspected separately.

iCloud removal and local eviction are different operations. Deleting a synced
file may propagate to other devices. Confirm sync completion and cloud availability
before a supported local eviction. Optimize Storage is a user preference, not a
universal recommendation. Preserve original timestamps when interpreting cloud
downloads: mtime alone cannot prove that no download happened. Placeholder flags
and sync activity are corroborating observations, not a complete causal diagnosis.

If deletion does not reclaim space, inspect Trash, snapshots, open files and
concurrent writes. A shell `rm` wrapper may move files to Trash; inspect `type -a rm`
and respect that policy. Do not bypass it with `/bin/rm`. An apparently empty
Finder view is not proof of missing files; verify without bypassing TCC. Restarting
Finder disrupts the user's desktop and is a separate action, not a default remedy.
Preserve OS update snapshots unless an applicable supported recovery procedure
and the user's scope justify removal.
