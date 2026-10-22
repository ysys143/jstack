# Development dependencies and caches

Inspect project environments, node_modules, package caches and model stores only
under selected project roots. Preserve filenames with spaces and avoid shell
interpolation. Directory mtime is not last access; access times and old commits
are weak inactivity signals. Check active processes, dirty worktrees, local edits,
lockfiles and dependency availability. A manifest alone is not a recovery test.
Do not delete project source or ignored assets under the label "dependencies".

Inspect HuggingFace, Ollama, PyTorch, uv, pip, npm and build caches separately.
Some contain expensive or unavailable models, credentials, installed runtimes or
active search indexes. Never treat every child of ~/.cache, ~/.bun, ~/.pyenv or
an editor profile as regenerable cache. Match actual content before classifying it.
Model names, tags and identical sizes do not prove duplicate bytes; shared blobs
and hardlinks affect recovery estimates. Use supported tool operations for
selected versions, after checking active consumers and redownload availability.

Stop or coordinate cache writers when needed. App caches and app profiles differ;
deleting browser Cache and Code Cache during active writes can race. A third-party
cleanup tool's whitelist is version- and configuration-dependent, not jstack policy.
Inspect its current dry-run output before selecting any cleanup. Do not introduce
sudo or install Mole, Docker, Ollama, dust or fd merely to inspect disk usage.

For tracked large files, resolve paths relative to the actual repository root.
Git tracking is not proof of recoverability for ignored files or uncommitted
changes. Explain recovery cost and selected targets before deletion. If a policy
blocks a command, investigate the reason; do not substitute raw deletion to evade it.
