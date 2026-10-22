# Bundle Coherence Guide

Decision framework for determining when to bundle components into a single plugin vs. separating them into multiple plugins.

---

## Table of Contents

1. [Coherence Principles](#coherence-principles)
2. [Bundle vs Separate Decision Tree](#bundle-vs-separate-decision-tree)
3. [When to Split](#when-to-split)
4. [When to Merge](#when-to-merge)
5. [Anti-Patterns](#anti-patterns)
6. [Practical Examples](#practical-examples)

---

## Coherence Principles

A plugin has **strong coherence** when:

### 1. Single Responsibility Principle
All components serve **one clear organizational need** or domain.

**Good**: `git` plugin with commit, PR, branch naming, label validation
**Bad**: `dev-tools` plugin with git, database, PDF export, Slack notify

---

### 2. Shared Domain
All components operate on the **same domain or system**.

**Good**: `slack-integration` plugin with auth, post-message, fetch-channel
**Bad**: `notifications` plugin with Slack, email, SMS, push notifications (unless they share common infrastructure)

---

### 3. Interaction Benefit
Components are **more useful together** than separately.

**Good**: `stitch` plugin with setup-mcp, design, to-react (all require Stitch setup)
**Bad**: Bundling independent utilities that never interact

---

### 4. Maintenance Unity
Components have the **same update cadence** and ownership.

**Good**: All components updated when external API changes
**Bad**: Mixing stable components with experimental prototypes

---

### 5. User Mental Model
Users think of components as **one cohesive thing**.

**Good**: "I need the git workflow plugin"
**Bad**: "I need the commit thing... and also that PR thing... wait, are they separate?"

---

## Bundle vs Separate Decision Tree

```
START: Should components be in the same plugin?

├─ Q1: Do they operate on the same external system/domain?
│  ├─ No -> SEPARATE (different domains)
│  └─ Yes -> Continue to Q2
│
├─ Q2: Do they share configuration, credentials, or state?
│  ├─ Yes -> BUNDLE (shared state)
│  └─ No -> Continue to Q3
│
├─ Q3: Are they used together >80% of the time?
│  ├─ Yes -> BUNDLE (usage pattern)
│  └─ No -> Continue to Q4
│
├─ Q4: Do they have the same update cadence?
│  ├─ No -> SEPARATE (maintenance burden)
│  └─ Yes -> Continue to Q5
│
├─ Q5: Would separating create duplicated code/logic?
│  ├─ Yes -> BUNDLE (reduce duplication)
│  └─ No -> Continue to Q6
│
└─ Q6: Is there a clear, shared organizational need?
   ├─ Yes -> BUNDLE (coherent need)
   └─ No -> SEPARATE (independent utilities)
```

---

## When to Split

### Reason 1: Different Update Cycles

**Symptom**: Some components change frequently, others are stable.

**Example**: `dev-tools` with stable linting + experimental AI code review
**Solution**: Split into `code-quality` (stable) and `ai-review` (experimental)

---

### Reason 2: Rarely Used Components

**Symptom**: 80% of users only use 20% of components.

**Example**: `utils` with 50 unrelated helper commands
**Solution**: Extract popular commands into focused plugins

---

### Reason 3: Different Owners

**Symptom**: Components maintained by different teams.

**Example**: `platform` with frontend tools + backend tools
**Solution**: Split into `frontend-tools` and `backend-tools`

---

### Reason 4: Unrelated Domains

**Symptom**: Components operate on completely different systems.

**Example**: `automation` with git, database, Slack, PDF
**Solution**: Split by domain: `git-automation`, `db-automation`, etc.

---

### Reason 5: Security Boundaries

**Symptom**: Some components need restricted access, others don't.

**Example**: `admin-tools` with public reports + sensitive user management
**Solution**: Split into `reports` and `admin-user-mgmt` (restricted)

---

## When to Merge

### Reason 1: Always Used Together

**Symptom**: Users install both plugins 100% of the time.

**Example**: `slack-auth` + `slack-post` + `slack-fetch` (all require auth)
**Solution**: Merge into `slack-integration`

---

### Reason 2: Share 80%+ Knowledge

**Symptom**: Understanding one component requires understanding the other.

**Example**: `git-commit` + `git-pr` + `git-branch` (all use git conventions)
**Solution**: Merge into `git` plugin

---

### Reason 3: Duplicated Code

**Symptom**: Multiple plugins contain identical utility functions.

**Example**: `jira-fetch` and `jira-update` both have auth logic
**Solution**: Merge into `jira-integration` with shared auth

---

### Reason 4: Fragmented User Experience

**Symptom**: Users confused about which plugin to use for related tasks.

**Example**: `pr-creator`, `pr-labeler`, `pr-reviewer` (3 separate PR plugins)
**Solution**: Merge into `pr-workflow`

---

### Reason 5: Shared Configuration

**Symptom**: Plugins share config files or credentials.

**Example**: Multiple AWS plugins sharing `~/.aws/credentials`
**Solution**: Merge into `aws-toolkit` with unified config

---

## Anti-Patterns

### 1. Kitchen Sink Plugin

**Problem**: Bundling unrelated components "just in case".

**Example**:
```
dev-productivity/
├── skills/
│   ├── git-commit.md
│   ├── pdf-export.md
│   ├── slack-notify.md
│   └── db-backup.md
```

**Why Bad**: No shared domain, confusing user experience, high maintenance burden.

**Fix**: Split into `git`, `pdf-tools`, `slack-integration`, `database-tools`.

---

### 2. Premature Bundling

**Problem**: Combining components before usage patterns emerge.

**Example**: Creating `api-tools` with 20 commands on day one.

**Why Bad**: Unknown which components are actually used together.

**Fix**: Start with individual plugins, merge after observing usage patterns.

---

### 3. Forced Separation

**Problem**: Over-splitting components that clearly belong together.

**Example**:
```
slack-auth/        (handles OAuth)
slack-post/        (posts messages, requires auth)
slack-fetch/       (fetches data, requires auth)
```

**Why Bad**: Users must install 3 plugins, auth duplicated, fragmented UX.

**Fix**: Merge into `slack-integration`.

---

### 4. Cross-Concern Mixing

**Problem**: Mixing different plugin patterns inappropriately.

**Example**:
```
git/
├── commands/
│   ├── commit.md
│   ├── pr.md
│   └── backup-database.md  <-- Wrong domain!
```

**Why Bad**: Violates single responsibility, confusing.

**Fix**: Move `backup-database.md` to `database-tools` plugin.

---

### 5. Micro-Plugins

**Problem**: Creating tiny plugins with 1-2 trivial components.

**Example**:
```
uppercase-converter/
└── skills/
    └── uppercase.md  (converts text to uppercase)
```

**Why Bad**: Installation overhead exceeds value, plugin proliferation.

**Fix**: Merge into `text-utils` or similar utility plugin.

---

## Practical Examples

### Example 1: git Plugin (Strong Coherence)

**Components**:
- `commands/commit.md` - Create commits
- `commands/pr.md` - Create PRs
- `commands/commit-push-pr.md` - Full workflow
- `skills/commit-message-convention.md` - Commit format
- `skills/pr-convention.md` - PR templates
- `skills/branch-name-convention.md` - Branch naming
- `hooks/check_pr_labels.py` - PR label validation

**Coherence Analysis**:
- [X] Single responsibility: Git workflow automation
- [X] Shared domain: All operate on git
- [X] Interaction benefit: Conventions used by commands, hooks validate
- [X] Maintenance unity: All updated when git best practices change
- [X] User mental model: "I need git workflow automation"

**Verdict**: STRONG COHERENCE - Keep bundled.

---

### Example 2: Hypothetical notifications Plugin (Weak Coherence)

**Components**:
- `commands/notify-slack.md`
- `commands/notify-email.md`
- `commands/notify-sms.md`
- `commands/notify-push.md`

**Coherence Analysis**:
- [?] Single responsibility: All send notifications (but to different systems)
- [X] Shared domain: NO - Slack, email, SMS, push are separate systems
- [X] Interaction benefit: NO - Users rarely need all notification types
- [X] Maintenance unity: NO - Each has different API update cycle
- [X] User mental model: UNCLEAR - Users think "I need Slack integration", not "I need notifications"

**Verdict**: WEAK COHERENCE - Split into `slack-integration`, `email-integration`, etc.

---

### Example 3: stitch Plugin (Strong Coherence)

**Components**:
- `commands/setup-mcp.md` - Configure MCP server
- `commands/design.md` - Create UI designs
- `commands/to-react.md` - Convert to React

**Coherence Analysis**:
- [X] Single responsibility: Google Stitch integration
- [X] Shared domain: All use Google Stitch service
- [X] Interaction benefit: Design and to-react require setup-mcp
- [X] Maintenance unity: All updated when Stitch API changes
- [X] User mental model: "I need Stitch integration"

**Verdict**: STRONG COHERENCE - Keep bundled.

---

### Example 4: Hypothetical utils Plugin (Kitchen Sink)

**Components**:
- `skills/uppercase.md` - Convert to uppercase
- `skills/lowercase.md` - Convert to lowercase
- `skills/base64-encode.md` - Base64 encoding
- `skills/json-format.md` - Format JSON
- `skills/hash-file.md` - Generate file hash

**Coherence Analysis**:
- [?] Single responsibility: "Utilities" is too vague
- [X] Shared domain: NO - Text, encoding, JSON, hashing are different
- [X] Interaction benefit: NO - Rarely used together
- [X] Maintenance unity: UNCLEAR - Independent update cycles
- [X] User mental model: UNCLEAR - Too generic

**Verdict**: WEAK COHERENCE - Options:
1. Split by category: `text-utils`, `encoding-utils`, `json-tools`
2. If all trivial: Keep bundled as `dev-utils` BUT add coherent grouping

---

## Decision Checklist

Before creating/merging plugins, verify:

### Bundle Checklist (all should be YES)
- [ ] Components serve ONE clear organizational need
- [ ] Components operate on the SAME domain/system
- [ ] Components used together >50% of the time
- [ ] Components share configuration, credentials, or state
- [ ] Components have the same update cadence
- [ ] Separation would create duplicated code/logic
- [ ] Users think of this as ONE cohesive thing

### Separate Checklist (any YES = consider splitting)
- [ ] Components have different update cycles
- [ ] Some components rarely used (<20% of users)
- [ ] Components maintained by different teams
- [ ] Components operate on unrelated domains
- [ ] Components have different security requirements
- [ ] Users install plugins but only use subset of features
- [ ] Plugin description contains "and also does..."

---

## Applying This Guide

### During Design Phase
Use `/plugin-generator:design` and reference this guide when determining plugin boundaries.

### During Implementation
Use `/plugin-generator:add-skill` (etc.) with coherence check to warn about unrelated components.

### During Validation
Use `/plugin-generator:validate` to check bundle coherence automatically.

### During Review
Reference this guide in PR reviews to challenge bundle decisions.

---

## Next Steps

1. Use this guide during `/plugin-generator:design` workflow
2. Reference coherence principles when adding components
3. Run `/plugin-generator:validate` to check coherence
4. Review existing plugins against these principles

---

**Last Updated**: v0.3.0 (2025-02)
