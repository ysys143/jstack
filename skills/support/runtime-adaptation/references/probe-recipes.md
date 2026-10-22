# Probe recipes

## The shape

A probe answers one question — is this capability usable right now — and exits
0, 1, or 2. It prints what it found; it does not fix anything.

| Check | What it settles | What it does not |
| --- | --- | --- |
| The binary resolves on PATH | It is installed | That it runs, or which version |
| It runs and reports a version | It executes here | That its runtime dependencies are present |
| A minimal real invocation succeeds | The happy path works | That credentials or network are present |
| An authenticated call succeeds | It is usable for real work | Anything about quota |

Each row is strictly stronger than the one above it, and strictly slower. Pick
the weakest check that would actually catch the failure you care about — a probe
that costs a network round trip on every call gets removed by whoever is
debugging something else.

## Phrasing per state

| State | Say |
| --- | --- |
| 0 | Nothing. A working tool needs no announcement |
| 1 | Which capability is unavailable, and what the result will lack because of it |
| 2 | What is missing, and the exact install command |

State 0 printing nothing is deliberate. A probe that announces success on every
call trains the reader to skip its output, and then state 1 goes unread too.

## Version floors

Record a floor only where a real incompatibility was observed, and record what
was observed next to it. A floor invented for safety silently blocks working
environments, and nobody can tell later whether it was measured or guessed.

Compare versions numerically, field by field. String comparison puts 10 before
9, which fails exactly once — at the release that matters most.

## Authentication is not installation

They fail differently and they are fixed differently, so they are separate
states even when both are missing. Reporting "not installed" for a tool that is
installed but signed out sends the user to reinstall something that was never
the problem.

## `gh` — the worked example

`validate_pr_label.py` implements this recipe. The commands below are the
canonical ones; a caller that prints its own install string will drift from
this file on the next packaging change.

| State | Probe | Exit |
| --- | --- | --- |
| Ready | `gh auth status` returns 0 | 0 |
| Signed out | binary resolves, `gh auth status` returns non-zero | 1 |
| Absent | binary does not resolve on PATH | 2 |

Signed-out is state 1, not 2, because a caller can still run on the reduced
path — anything cached locally keeps working, and only the calls that need the
API are lost. Saying "not installed" here sends the user to reinstall something
that was never the problem.

**Install (state 2)**

```bash
brew install gh                      # macOS
sudo apt install gh                  # Debian/Ubuntu
sudo dnf install gh                  # Fedora/RHEL
winget install --id GitHub.cli       # Windows
```

**Authenticate (state 1 and after install)**

```bash
gh auth login
gh auth status                       # confirm
```

**What state 1 costs, named** — for the PR label policy: the repository's label
set and its PR history cannot be read, so a policy cannot be discovered and a
change to one cannot be detected. A policy already registered still enforces.
Name the lost capability like that, in the caller's own terms; "limited mode"
names nothing.
