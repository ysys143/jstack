# /setup-workspace — onboard the Google Workspace CLI

If `$ARGUMENTS` is present, focus on that stage (for example,
`authentication`, `multiple accounts`, or `403`). Otherwise follow the sequence below.

## Role

**Guide a first-time user through completion.** Provide a **verification command
for every stage and inspect its output before continuing**. Instructions alone
are insufficient because the process has three predictable failure points below.

Inspect the current state first and start at the **first required stage**.

```bash
node ${CLAUDE_PLUGIN_ROOT}/skills/workspace/scripts/ensure_gws.js
```

- exit 0 — tool and account configuration exist; continue with organization
  profile setup and verify real access
- exit 1 — installed but **not authenticated**; start at Stage 3
- exit 2 — **installation required**; start at Stage 1

---

## Stage 1: Installation — avoid the other tool with the same name

**Homebrew has two tools associated with the name `gws`.** One manages git
workspaces and is not the tool used here. Installing it is the first pitfall.

```bash
brew install googleworkspace-cli   # Correct
```

```bash
brew install gws                   # Wrong: this is the git workspace tool
```

**Verify:**

```bash
gws --version
```

A printed version confirms installation. If `command not found` appears, check
PATH. If git-related help appears, remove the other tool and reinstall.

---

## Stage 2: Separate accounts before they become mixed

`gws` stores **one account per configuration directory**. Separate personal and
work accounts **from the beginning** when both will be used.

```
~/.config/
├── gws-personal/       # Personal
└── gws-work/           # Work
```

Add shell aliases:

```zsh
# ~/.zshrc
alias gws-personal='GOOGLE_WORKSPACE_CLI_CONFIG_DIR=~/.config/gws-personal gws'
alias gws-work='GOOGLE_WORKSPACE_CLI_CONFIG_DIR=~/.config/gws-work gws'
```

**Do not use aliases in scripts or automation.** Aliases exist only in
interactive shells.

```bash
GOOGLE_WORKSPACE_CLI_CONFIG_DIR=~/.config/gws-work gws <command>
```

**Verify:**

```bash
mkdir -p ~/.config/gws-work && ls -d ~/.config/gws-*
```

---

## Stage 3: Authentication (OAuth2)

Complete these **four Google Cloud Console tasks in order**.

1. **Enable APIs** — APIs & Services → Library → enable **Drive API** and **Sheets API**
2. **Create credentials** — Credentials → OAuth 2.0 Client ID → download `client_secret.json`
3. **Place the file** — put it under `~/.config/gws-work/`

```bash
mv ~/Downloads/client_secret*.json ~/.config/gws-work/client_secret.json
chmod 600 ~/.config/gws-work/client_secret.json
```

4. **Register a test user** — OAuth consent screen → **Test users** → add your
   email. The unverified app **rejects login without this registration**.

Log in:

```bash
gws-jstack auth login
```

**Verify:**

```bash
gws-jstack auth status
```

Seeing `"auth_method": "oauth2"` confirms success.

---

## Three predictable failure points

| Symptom | Cause | Fix |
|---|---|---|
| `Error 403 access_denied` | Test-user registration in Stage 3, Step 4 was skipped | Add the email under OAuth consent screen → Test users and retry |
| `gws` prints git-related help | The same-named tool was installed in Stage 1 | `brew uninstall gws && brew install googleworkspace-cli` |
| Work documents are missing | Command ran without `GOOGLE_WORKSPACE_CLI_CONFIG_DIR` | Retry with the alias or environment variable; use `auth status` to identify the account |

---

## Credential handling

- **Never put `client_secret.json` or tokens in a repository.** Store them only
  under `~/.config/gws-{account}/`.
- Set file permissions to `600`.
- **Do not share credentials.** Each person must issue their own so actions remain attributable.

## Main environment variables

| Variable | Description |
|---|---|
| `GOOGLE_WORKSPACE_CLI_CONFIG_DIR` | Configuration directory; **the key to multiple accounts** |
| `GOOGLE_WORKSPACE_CLI_TOKEN` | OAuth2 access token |

## Next

After setup, the `workspace` skill handles Drive and Sheets work. For detailed
installation and authentication guidance, see
`${CLAUDE_PLUGIN_ROOT}/skills/workspace/references/gws-cli.md` and the official
documentation at https://github.com/googleworkspace/cli.


## Stage 6: Organization profiles — keep work data out of installed files

Following `${CLAUDE_PLUGIN_ROOT}/runtime/ONBOARDING.md`, inspect candidate Drive,
report, and scrum resources for the selected account, then save the profile under
`~/.jstack/profiles/<name>/`. In that document, `JSTACK_PLUGIN_ROOT` means the actual
installation root. Preserve existing manual settings and ask only about ambiguous
targets. Do not copy credentials or perform remote writes or sends in this stage.
Report configured fields, unconfigured fields, and affected features separately.
