# Secret handling — what belongs where

Source: inherited from `plugins/session-and-git/skills/git-ignore-and-secrets`
plus local measurements.

## `.gitignore` vs `.git/info/exclude`

| | `.gitignore` | `.git/info/exclude` |
|---|---|---|
| Scope | **Whole repository** — committed | **Local only** — not committed |
| Use for | Build artifacts, dependencies, shared secret paths | Personal editor settings, local scratch files |

**Do not put personal settings that others do not need in `.gitignore`.** Doing
so imposes your preferences on everyone else's repository rules.

## Secrets already committed

**The response procedure is not duplicated here.** The `secrets` skill owns the
authoritative order and rationale for revocation, history rewriting, and
notification. If the procedure lived in two places, one could change while the
other did not, leaving no way to know which was correct.

This file states only **what Git can and cannot do**.

| What Git can do | What Git cannot do |
|---|---|
| Remove a blob from history (`git filter-repo`, BFG) | Remove it from existing clones |
| Rewrite local refs | Rewrite refs in forks, PRs, or mirrors |
| Move remote refs with a force push | Immediately expire commits cached by the forge |

Because the right column is not empty, **credential revocation comes first**.
The `secrets` skill owns that decision and procedure.


## Toolset — what to choose

| Tool | Purpose | When |
|---|---|---|
| **gitleaks** | **Detect** secrets before commit and in CI | Start here in most cases |
| **SOPS** | **Encrypt and commit** files | When configuration must contain secrets (k8s, Terraform) |
| **git-secret** | Encrypt files with GPG | Older than SOPS and requires GPG key management |

**Detection and encryption solve different problems.** Gitleaks prevents
accidents; SOPS lets a repository intentionally contain encrypted secrets.
They are often used together.

## This repository's rules

- **Do not put credentials** (`client_secret.json`, tokens) in the repository.
  Store them under `~/.config/<tool>-<account>/`.
- Put API keys in `~/.claude/.env.*` or shell environment variables. `.env`
  files are covered by `.gitignore`.
- If a key was committed, follow the `secrets` skill; do not duplicate that
  procedure here.
