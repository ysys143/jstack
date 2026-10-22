# Organizational Governance Guide

This guide defines naming conventions, file organization, versioning, and quality standards for organization plugin development.

## Naming Conventions

### Plugin Names

**Format**: `{domain}-{purpose}`

**Rules**:
- Use kebab-case (lowercase with hyphens)
- Be specific but concise (2-3 words max)
- Indicate domain/scope clearly
- Avoid generic names ("utils", "helpers")

**Examples**:
- [OK] `git-master` - Git workflow automation
- [OK] `plugin-generator` - Plugin/skill creation
- [OK] `model-version-checker` - Version validation
- [FAIL] `git-utils` - Too generic
- [FAIL] `MyPlugin` - Wrong case
- [FAIL] `really-long-plugin-name-for-thing` - Too long

### Skill Names

**Format**: `{action}-{object}` or `{domain}-{action}`

**Rules**:
- Use verb-noun or domain-verb pattern
- Match plugin name prefix when possible
- Indicate action clearly
- Keep under 20 characters

**Examples**:
- [OK] `generate-skill` - Create new skill
- [OK] `add-hook` - Add hook to plugin
- [OK] `validate-plugin` - Check plugin correctness
- [OK] `git-commit` - Git commit action
- [FAIL] `skill_generator` - Use hyphens not underscores
- [FAIL] `gen` - Too abbreviated

### Hook Names

**Format**: `{event}_{action}`

**Rules**:
- Use snake_case (lowercase with underscores)
- Start with lifecycle event
- Describe what the hook does
- Be specific about trigger

**Examples**:
- [OK] `pre_commit_validate_pr_labels`
- [OK] `post_generate_format_json`
- [OK] `on_skill_add_check_coherence`
- [FAIL] `validate-hook` - Use underscores
- [FAIL] `hook1` - Not descriptive

### Agent Names

**Format**: `{role}-{specialization}-agent`

**Rules**:
- Describe agent's role/responsibility
- Use kebab-case
- End with `-agent` suffix
- Indicate scope/domain

**Examples**:
- [OK] `plugin-analyzer-agent` - Analyzes plugins
- [OK] `skill-extractor-agent` - Extracts skills
- [OK] `coherence-validator-agent` - Validates coherence
- [FAIL] `agent1` - Not descriptive
- [FAIL] `PluginAgent` - Wrong case

### Command Names

**Format**: `{action}` or `{action}-{object}`

**Rules**:
- Use verb or verb-noun
- Use kebab-case
- Be concise (1-2 words)
- Match skill name if 1:1

**Examples**:
- [OK] `design` - Start design session
- [OK] `add-skill` - Add skill to plugin
- [OK] `validate` - Run validation
- [OK] `inspect` - Inspect plugin
- [FAIL] `add_skill` - Use hyphens
- [FAIL] `doTheThing` - Wrong case

## File Organization

### Standard Plugin Structure

```
plugin-name/
├── .claude-plugin/
│   ├── plugin.json           # Plugin metadata
│   ├── hooks.json            # Hook definitions (optional)
│   └── agents/               # Agent prompts (optional)
│       ├── analyzer-agent.md
│       └── validator-agent.md
├── commands/
│   ├── main-command.md       # Primary command
│   ├── add-thing.md          # Sub-commands
│   └── validate.md
├── scripts/
│   ├── main_script.sh        # Core automation
│   ├── helper_functions.sh   # Shared utilities
│   └── validators/           # Validation scripts
│       └── validate_schema.py
├── references/               # Documentation
│   ├── organizational-guides/
│   │   ├── design-patterns.md
│   │   └── architecture.md
│   └── templates/            # Reusable templates
│       ├── hook-template/
│       └── command-template.md
└── tests/                    # Test files (optional)
    ├── test_commands.sh
    └── test_hooks.py
```

### File Naming Rules

| Type | Convention | Example |
|------|------------|---------|
| Plugin descriptor | `plugin.json` | Fixed name |
| Hook definitions | `hooks.json` | Fixed name |
| Commands | `{verb}-{noun}.md` | `add-skill.md` |
| Scripts | `{verb}_{noun}.js` | `validate_plugin.js` |
| Agents | `{role}-agent.md` | `analyzer-agent.md` |
| Guides | `{topic}-{type}.md` | `hook-architecture.md` |
| Templates | `{type}-template/` | `validation-hook-template/` |

### Location Conventions

**Commands**: Must be in `commands/` directory
- Claude Code discovers commands here
- Each command = one .md file
- Use subdirectories sparingly (flat is better)

**Scripts**: Must be in `scripts/` directory
- Executable automation (bash, python, etc.)
- Can have subdirectories for organization
- Must have execute permissions (`chmod +x`)

**Hooks**: Defined in `hooks/hooks.json`
- Script implementations alongside it in `hooks/`
- Hook names match JSON keys
- Can be bash or python

**Agents**: In the `agents/` directory
- One markdown file per agent
- YAML frontmatter (name / description / model) plus the system prompt
- Referenced by agent name in commands

**References**: In `references/` directory
- Not loaded by Claude Code directly
- For developer documentation
- Can reference from commands

## Versioning Strategy

### Semantic Versioning

Format: `MAJOR.MINOR.PATCH`

**Rules**:
- MAJOR: Breaking changes (incompatible API)
- MINOR: New features (backward compatible)
- PATCH: Bug fixes (backward compatible)

**Examples**:
- `1.0.0` -> `1.0.1`: Fixed validation bug
- `1.0.1` -> `1.1.0`: Added new command
- `1.1.0` -> `2.0.0`: Changed command interface

### Version Metadata

In `plugin.json`:
```json
{
  "name": "plugin-name",
  "version": "1.2.3",
  "compatibleWith": {
    "claudeCode": ">=0.9.0",
    "dependencies": {
      "git-master": "^2.0.0"
    }
  }
}
```

### Changelog

Maintain `CHANGELOG.md` at plugin root:

```markdown
# Changelog

## [1.2.0] - 2026-02-07

### Added
- New `inspect` command for component discovery
- Agent support for complex analysis tasks

### Changed
- `validate` command now checks hook coherence
- Improved error messages with actionable fixes

### Deprecated
- `list` command (use `inspect` instead)

### Removed
- Old `generate-v1` command

### Fixed
- Hook validation false positives
- Template path resolution on Windows

### Security
- Added input sanitization for script injection
```

## Quality Standards

### Code Quality

**Shell Scripts**:
- Use `#!/usr/bin/env bash` shebang
- Set `set -euo pipefail` for safety
- Quote all variables: `"$var"`
- Use `[[` over `[` for tests
- Add error handling and rollback
- Include usage documentation

**Python Scripts**:
- Use type hints
- Follow PEP 8 style
- Add docstrings
- Handle exceptions properly
- Use pathlib for paths
- Validate inputs

**Markdown Files**:
- Follow CommonMark spec
- Use consistent heading levels
- Include examples for all features
- No emoji (use `[OK]`, `[FAIL]`, `[WARN]`)
- Add table of contents for long docs

### Documentation Standards

Every command must document:
1. **Purpose**: What does it do? (1-2 sentences)
2. **Usage**: How to invoke it (command syntax)
3. **Prerequisites**: What must exist first
4. **Examples**: At least 2 realistic examples
5. **Output**: What files/changes are created
6. **Error Handling**: Common failures and fixes

Every script must include:
1. Header comment with purpose
2. Usage function
3. Input validation
4. Error messages with exit codes
5. Example invocations

### Testing Requirements

**Validation Scripts**:
- Must have exit code 0 for success
- Must have exit code >0 for failure
- Must output actionable error messages
- Should validate inputs before running

**Commands**:
- Test happy path
- Test missing prerequisites
- Test invalid inputs
- Test rollback on failure

**Hooks**:
- Test trigger conditions
- Test with valid/invalid inputs
- Test error handling
- Test performance (< 1s for fast hooks)

## Bundle Coherence Rules

### Skill-Hook Coherence

If a skill generates files, there should be a hook to validate them:

**Example**:
- Skill: `add-hook` (generates hooks.json)
- Hook: `post_add_hook_validate_schema` (validates hooks.json)

### Command-Agent Coherence

If a command requires complex analysis, delegate to an agent:

**Example**:
- Command: `design` (wizard command)
- Agent: `design-advisor-agent` (analyzes requirements)

### Hook-Agent Coherence

If a hook needs intelligence, invoke an agent:

**Example**:
- Hook: `pre_commit_check_coherence`
- Agent: `coherence-validator-agent`

### Template Coherence

Templates should match actual plugin structure:
- Template files should use `{placeholder}` syntax
- Template structure should mirror real plugins
- Template docs should reference real examples

## Dependency Management

### Plugin Dependencies

Declare in `plugin.json`:
```json
{
  "dependencies": {
    "git-master": "^2.0.0",
    "plugin-generator": "~0.3.0"
  },
  "optionalDependencies": {
    "docker-tools": "*"
  }
}
```

**Version Syntax**:
- `^1.2.3` - Compatible with 1.x.x (>= 1.2.3, < 2.0.0)
- `~1.2.3` - Approximately 1.2.x (>= 1.2.3, < 1.3.0)
- `1.2.3` - Exact version
- `*` - Any version (not recommended)

### System Dependencies

Document in `README.md`:
```markdown
## Requirements

- bash >= 4.0
- python >= 3.8
- jq >= 1.6
- git >= 2.30
```

### Runtime Dependencies

Check at execution time:
```bash
check_dependencies() {
    local missing=()

    command -v jq >/dev/null || missing+=("jq")
    command -v python3 >/dev/null || missing+=("python3")

    if [ ${#missing[@]} -gt 0 ]; then
        echo "[FAIL] Missing dependencies: ${missing[*]}"
        echo "Install with: brew install ${missing[*]}"
        exit 1
    fi
}
```

## Migration and Deprecation

### Deprecation Process

1. **Announce**: Add deprecation warning to command
2. **Migrate**: Provide new alternative
3. **Grace Period**: Keep old version for 2 major versions
4. **Remove**: Delete in next major version

**Example**:
```markdown
# old-command

> [WARN] DEPRECATED: This command will be removed in v3.0.0
> Use `/plugin-name:new-command` instead.
```

### Breaking Changes

Document in `CHANGELOG.md` and `MIGRATION.md`:

```markdown
# Migration Guide v2.0.0

## Breaking Changes

### Command Rename: `generate` -> `design`

**Old**:
```
/plugin-generator:generate "My Plugin"
```

**New**:
```
/plugin-generator:design
-> (interactive wizard)
```

### Hook Schema Change

hooks.json now requires `version` field:

```json
{
  "version": "1.0",
  "hooks": [...]
}
```

**Migration Script**:
```bash
/plugin-generator:migrate-hooks
```
```

## Publication Standards

### Organization Repository

Publish to your organization's marketplace repository through its own pull request
process, after the checks above pass locally.

### Pull Request Requirements

PR must include:
- Clear title following conventional commits
- Description of changes
- Test results
- Migration guide (if breaking changes)
- Updated CHANGELOG.md

### Labels

Use these labels:
- `type:feature` - New functionality
- `type:fix` - Bug fix
- `type:docs` - Documentation only
- `type:refactor` - Code restructuring
- `type:test` - Test additions
- `breaking` - Breaking change

## Related Guides

- [Plugin Design Patterns](./plugin-design-patterns.md) - Architecture patterns
- [Command Architecture](./command-architecture.md) - Command design
- [Hook Architecture](./hook-architecture.md) - Hook lifecycle
- [Agent Architecture](./agent-architecture.md) - Agent patterns
- [Bundle Coherence](./bundle-coherence-guide.md) - Validation rules
