# Plugin Design Patterns

This guide describes six common plugin patterns for organizational plugin development. Use these patterns to determine the best component composition and bundle coherence principles for your use case.

## Pattern Decision Tree

```
START: What is your primary goal?

├─ "Configure or manage system/project settings"
│  └─> Configuration Pattern
│
├─ "Connect to external service/API"
│  └─> Integration Pattern
│
├─ "Analyze, investigate, or understand code/data"
│  └─> Analysis Pattern
│
├─ "Automate development workflow or process"
│  └─> Development Workflow Pattern
│
├─ "Generate or maintain documentation"
│  └─> Documentation Pattern
│
└─ "Check quality, enforce standards, validate"
   └─> Validation & Quality Pattern
```

---

## 1. Configuration Pattern

### Purpose
Manage system settings, project configurations, or environment setup with guided wizards and automation.

### When to Use
- Setting up MCP servers
- Configuring development environments
- Managing API credentials or connection settings
- Initializing project-specific configurations

### Typical Component Composition

| Component Type | Count | Examples |
|----------------|-------|----------|
| **Commands** | 2-4 | `setup`, `configure`, `update-config`, `validate-config` |
| **Skills** | 0-2 | Configuration helper skills (optional) |
| **Hooks** | 1-3 | PostToolUse hooks for auto-updating config files |
| **Agents** | 0-1 | Configuration analyzer (optional) |

### Bundle Coherence Principles
- All components relate to the **same configuration domain** (e.g., MCP servers, database connections)
- Commands guide users through multi-step setup
- Hooks automate routine config updates
- Agents validate or analyze configuration correctness

### Example Structure (stitch Plugin)

```
stitch/
├── commands/
│   ├── setup-mcp.md         # Wizard for MCP server setup
│   ├── design.md            # Create UI designs
│   └── to-react.md          # Convert designs to React
├── hooks/
│   └── hooks.json           # (none in this example)
└── agents/
    └── (none)
```

**Coherence**: All commands relate to Google Stitch service integration - setup, design creation, React conversion.

---

## 2. Integration Pattern

### Purpose
Connect to external services (GitHub, Slack, Jira, databases) with authentication, data fetching, and action automation.

### When to Use
- Integrating with third-party APIs
- Automating external service interactions
- Fetching data from remote sources
- Posting updates to external platforms

### Typical Component Composition

| Component Type | Count | Examples |
|----------------|-------|----------|
| **Commands** | 3-6 | `auth`, `fetch-data`, `post-update`, `sync` |
| **Skills** | 1-3 | Domain-specific automation skills |
| **Hooks** | 1-2 | Notification hooks (PostToolUse) |
| **Agents** | 0-2 | Data extraction or formatting agents |

### Bundle Coherence Principles
- All components interact with the **same external service**
- Commands handle authentication and primary operations
- Hooks trigger notifications or sync operations
- Agents process or transform external data

### Example Structure (Hypothetical: slack-integration)

```
slack-integration/
├── commands/
│   ├── auth.md              # OAuth setup
│   ├── post-message.md      # Send messages
│   └── fetch-channel.md     # Retrieve channel data
├── hooks/
│   └── hooks.json           # PostToolUse: notify on deploy
└── agents/
    └── message-formatter.md # Format messages for Slack
```

**Coherence**: All components facilitate Slack integration - auth, messaging, notifications.

---

## 3. Analysis Pattern

### Purpose
Deep investigation, debugging, or understanding of code, data, or system behavior through specialized agents and orchestrated workflows.

### When to Use
- Debugging complex issues
- Understanding unfamiliar codebases
- Analyzing data patterns
- Investigating system behavior

### Typical Component Composition

| Component Type | Count | Examples |
|----------------|-------|----------|
| **Commands** | 1-3 | `analyze`, `investigate`, `debug` |
| **Skills** | 0-1 | Orchestration skill (optional) |
| **Hooks** | 0-1 | Audit hooks (optional) |
| **Agents** | 3-8 | Specialized analyzers (critical) |

### Bundle Coherence Principles
- All agents analyze the **same domain** (e.g., prompts, code quality, test coverage)
- Command orchestrates agent execution (sequential or parallel)
- Agents have clear, non-overlapping responsibilities
- Output is synthesized into cohesive report

### Example Structure (log-prompt-context Plugin)

```
log-prompt-context/
├── commands/
│   └── wrap.md              # Orchestrate 5 agents
├── agents/
│   ├── doc-updater.md       # Analyze doc update needs
│   ├── automation-scout.md  # Detect automation opportunities
│   ├── learning-extractor.md # Extract learnings
│   ├── followup-suggester.md # Suggest next tasks
│   └── duplicate-checker.md  # Phase 2 validation
└── hooks/
    └── (none)
```

**Coherence**: All agents analyze conversation logs to extract wisdom - docs, automation, learnings, follow-ups.

---

## 4. Development Workflow Pattern

### Purpose
Automate repetitive development tasks (commits, PRs, releases, testing) with conventions and quality checks.

### When to Use
- Git workflow automation
- Pull request management
- Release processes
- Continuous testing

### Typical Component Composition

| Component Type | Count | Examples |
|----------------|-------|----------|
| **Commands** | 2-5 | `commit`, `pr`, `release`, `test` |
| **Skills** | 2-4 | Convention skills (commit messages, PR templates) |
| **Hooks** | 2-5 | PreToolUse validation, PostToolUse formatting |
| **Agents** | 1-2 | Quality reviewers (optional) |

### Bundle Coherence Principles
- All components support the **same workflow phase** (e.g., git, CI/CD, testing)
- Skills enforce conventions
- Hooks validate before actions, format after actions
- Agents review quality before merging

### Example Structure (git Plugin)

```
git/
├── commands/
│   ├── commit.md            # Create commits
│   ├── pr.md                # Create PRs
│   └── commit-push-pr.md    # Full workflow
├── skills/
│   ├── commit-message-convention.md  # Enforce commit format
│   ├── pr-convention.md              # PR templates
│   └── branch-name-convention.md     # Branch naming
├── hooks/
│   ├── hooks.json           # PreToolUse: validate labels
│   └── check_pr_labels.py   # PR label validation script
└── agents/
    └── (none)
```

**Coherence**: All components automate git workflow - commits, PRs, branch naming, label validation.

---

## 5. Documentation Pattern

### Purpose
Generate, maintain, or sync documentation from various sources (code, APIs, sessions, codebases).

### When to Use
- Auto-generating API docs
- Syncing official library docs
- Extracting insights from sessions
- Creating reference documentation

### Typical Component Composition

| Component Type | Count | Examples |
|----------------|-------|----------|
| **Commands** | 2-4 | `generate-docs`, `sync-docs`, `extract-session` |
| **Skills** | 1-3 | Documentation helper skills |
| **Hooks** | 0-2 | PostToolUse hooks for auto-updating docs |
| **Agents** | 1-3 | Extraction or formatting agents |

### Bundle Coherence Principles
- All components work with the **same documentation domain**
- Commands drive doc generation workflows
- Agents extract or transform content
- Hooks keep docs synchronized automatically

### Example Structure (Hypothetical: api-docs-generator)

```
api-docs-generator/
├── commands/
│   ├── generate.md          # Generate API docs from code
│   └── sync-openapi.md      # Sync with OpenAPI spec
├── agents/
│   ├── endpoint-extractor.md    # Extract API endpoints
│   └── example-generator.md     # Generate usage examples
└── hooks/
    └── hooks.json           # PostToolUse: update docs on code changes
```

**Coherence**: All components generate/maintain API documentation.

---

## 6. Validation & Quality Pattern

### Purpose
Enforce standards, check quality, validate code/structure before actions (commits, deploys, releases).

### When to Use
- Pre-commit code quality checks
- Security vulnerability scanning
- Test coverage enforcement
- Linting and formatting

### Typical Component Composition

| Component Type | Count | Examples |
|----------------|-------|----------|
| **Commands** | 1-3 | `validate`, `review`, `scan` |
| **Skills** | 0-2 | Quality standards skills |
| **Hooks** | 2-6 | PreToolUse validation (critical) |
| **Agents** | 1-4 | Specialized reviewers |

### Bundle Coherence Principles
- All components enforce **related quality standards** (e.g., code quality, security, testing)
- Hooks block actions if validation fails (PreToolUse)
- Agents provide detailed analysis
- Commands offer manual validation triggers

### Example Structure (Hypothetical: code-quality-enforcer)

```
code-quality-enforcer/
├── commands/
│   ├── review.md            # Manual code review
│   └── validate.md          # Run all validations
├── hooks/
│   ├── hooks.json           # PreToolUse: lint before commit
│   ├── lint_check.py        # Linting validation
│   └── test_coverage.py     # Coverage validation
└── agents/
    ├── security-reviewer.md     # Security analysis
    └── code-reviewer.md         # Code quality review
```

**Coherence**: All components enforce code quality - linting, testing, security, review.

---

## Anti-Patterns: What to Avoid

### 1. Kitchen Sink Plugin
**Problem**: Bundling unrelated components into one plugin.

**Example**: A plugin with `commit`, `pdf-export`, `slack-notify`, `db-backup` commands - no shared theme.

**Fix**: Split into separate plugins by domain.

---

### 2. Premature Bundling
**Problem**: Combining components before usage patterns emerge.

**Example**: Creating `dev-tools` plugin with 20 commands on day one.

**Fix**: Start with individual plugins, merge only when clear relationships emerge.

---

### 3. Forced Separation
**Problem**: Over-splitting components that always work together.

**Example**: Separate `slack-auth`, `slack-post`, `slack-fetch` plugins when they share credentials.

**Fix**: Bundle related components that share state or are always used together.

---

### 4. Cross-Concern Mixing
**Problem**: Mixing different patterns inappropriately.

**Example**: A `git` plugin with database migration commands.

**Fix**: Keep plugins focused on one primary pattern.

---

## Choosing the Right Pattern

### Questions to Ask

1. **Domain Question**: What domain does this solve? (git, docs, security, external service)
2. **User Question**: Who uses this and how often? (single user, team, every commit)
3. **Interaction Question**: Do components share state or always run together?
4. **Lifecycle Question**: Do components have the same update cadence?

### Combination Patterns

Some plugins combine patterns when there's clear coherence:

- **Configuration + Integration**: Setup MCP server + interact with service
- **Development Workflow + Validation**: Git workflow + pre-commit checks
- **Analysis + Documentation**: Analyze codebase + generate docs

**Golden Rule**: Combine patterns ONLY if components are **more useful together** than separately.

---

## Next Steps

1. Use this guide during `/plugin-generator:design` workflow
2. Reference specific pattern when creating components
3. Validate bundle coherence with `/plugin-generator:validate`
4. Review coherence principles in `bundle-coherence-guide.md`

---

**Last Updated**: v0.3.0 (2025-02)
