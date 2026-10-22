---
allowed-tools: Bash
---

# /check-usage — usage limits across AI CLIs

Display usage limits for all AI CLIs (Claude, Codex, Gemini, Antigravity, z.ai) and recommend the one with the most available capacity.

## Usage

```bash
# Interactive output with colors
/jstack:check-usage

# JSON output for scripting
/jstack:check-usage --json

# Specify language (en or ko)
/jstack:check-usage --lang ko
/jstack:check-usage --lang en
```

## Output

Shows usage for each installed CLI:
- **Claude**: 5h and 7d rate limits with reset times
- **Codex**: Rate limits with plan info, if installed — each window is labeled by its actual duration (5h + 7d on Plus, a single 7d on Pro)
- **Gemini**: Usage percentage with model info (if installed)
- **Antigravity**: Weekly quota per model family — Gemini vs Claude+GPT (if installed)
- **z.ai**: Token and MCP usage with model info (if configured)

At the bottom, recommends the CLI with the lowest current usage.

## Tasks

### 1. Run the check-usage script

Run the bundle from this plugin's own installation. The script is a sibling of the
status line build, so it is always the same version as the loaded plugin:
```bash
node "${CLAUDE_PLUGIN_ROOT}/skills/dashboard/dist/check-usage.js" $ARGUMENTS
```

This will:
1. Use the installed plugin's own bundle
2. Run the check-usage script
3. Display usage for all CLIs
4. Show recommendation

### 2. Interpret results

If the user wants more details or asks follow-up questions:
- Explain what each metric means
- Suggest when to switch CLIs based on usage
- Note that Codex/Gemini/Antigravity sections only appear if those CLIs are installed
