# Containers and VM allocation

Inspect the selected Docker context first: it may point at a remote daemon.
Use `docker system df -v`, image IDs, container mounts and volume references.
Do not start or restart Colima merely to answer a storage question without
accounting for workload impact. Compose references are hints, not exhaustive
ownership evidence; an absent reference does not make an image disposable.

Image CREATED is build time. Metadata.LastTagTime is not a verified last-use or
universal pull timestamp. Neither is a deletion clock. Shared image layers mean
the sum of image sizes is not recoverable space. Named and anonymous volumes can
both contain valuable data. Current `docker volume prune` defaults to unused
anonymous volumes; `--all` expands the scope. Inspect the installed CLI and exact
targets rather than labeling either operation safe.

`unless-stopped` preserves a manually stopped container across daemon restarts.
Inspect restart policy and orchestrator activity rather than declaring unexplained
containers zombies. Stopped containers still reference their volumes; removing a
container and its writable layer needs its own scope before volume removal.

Guest deletion may not immediately reduce the host's allocated sparse disk.
For a verified running local Colima VM that supports discard, guest
`colima ssh -- sudo fstrim -av` can be considered after observing unused blocks.
Trim output is not host space reclaimed. Measure host allocation and free space
afterward; prune returning zero does not establish that no trim is possible.
Do not repeat destructive pruning just because the host delta is unexpected.

Low-space I/O failures do not prove store corruption, and a daemon restart does
not guarantee repair. Preserve error evidence, free selected regenerable host
space, then reassess. Restart only with workload impact understood. A stale Colima
disk lock needs verified absence of its owner; never delete `in_use_by` merely
because startup failed. Resolve executable paths with the actual installation,
not a hardcoded Intel or Apple Silicon Homebrew prefix.

Sources: [restart policies](https://docs.docker.com/engine/containers/start-containers-automatically/),
[volume prune](https://docs.docker.com/reference/cli/docker/volume/prune/),
[persistent volumes](https://docs.docker.com/engine/storage/volumes/).
