#!/usr/bin/env python3
"""
load_guidelines.py - Inject coding guidelines into CLAUDE.md

Usage:
  python3 ${CLAUDE_PLUGIN_ROOT}/skills/setup/scripts/load_guidelines.py \
      [--target PATH] [--karpathy] [--kentbeck] [--cherny] [--cherny-full]

Flags:
  --target PATH    Target file (default: ./CLAUDE.md)
  --karpathy       Inject Karpathy coding guidelines
  --kentbeck       Inject Kent Beck TDD/Tidy First guidelines
  --cherny         Inject Boris Cherny guidelines (abbreviated, 5 principles - for combined use)
  --cherny-full    Inject Boris Cherny guidelines (full, 8 principles - for standalone use)
"""

import argparse
import os

# ---------------------------------------------------------------------------
# Guideline content
# ---------------------------------------------------------------------------

KARPATHY = """\

---

## Karpathy Coding Guidelines

> Behavioral guidelines to reduce common LLM coding mistakes. These apply to every agent that writes code in this repository.

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

### 5. Commit Often

**Keep work units small and commit frequently.**

- Don't mix multiple intentions in a single commit.
- Cut at the point where "I'd want to be able to revert to here."
- If modifying multiple files or working on a feature unit, create a branch.

> Branch names, commit messages, and PR format are the `gitrules` skill's;
> follow what it declares rather than a convention invented here.

---

*These guidelines are working if: fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.*
"""

KENTBECK = """\

---

## Kent Beck Coding Guidelines

> TDD and Tidy First principles. Maintain code quality through test-driven development and structure/behavior separation.
> These apply to every agent that writes code in this repository.

### 1. Red → Green → Refactor

**Failing test → Make it pass → Clean up. Follow this order.**

- Write a failing test first for each small unit of functionality.
- Implement only the minimum code needed to make the test pass.
- Refactor only after the test is passing.
- Re-run the tests after refactoring; only a green run shows the behavior was preserved.

### 2. Tidy First

**Never mix structural changes with behavioral changes.**

- Structural changes (renaming, extracting methods, moving code) → behavior stays the same
- Behavioral changes (adding features, modifications) → structure stays the same
- If both are needed: structure first, behavior second
- Separate each into its own commit

### 3. Make It Work, Make It Right, Make It Fast

**Work → Clean up → Optimize. Never skip steps.**

- First make it work (simplest thing that works)
- Then clean up the code (remove duplication, reveal intent)
- Optimize only when necessary (don't optimize speculatively)

### 4. Commit Discipline

**Only commit when tests pass.**

- Commit only after all tests pass and linter warnings are resolved
- One commit = one logical unit of change
- State in the commit message whether it is a structural or behavioral change

> Branch names, commit messages, and PR format are the `gitrules` skill's;
> follow what it declares rather than a convention invented here.

### 5. FIRST Principles

Every test must be:
- **Fast**: milliseconds, not seconds
- **Independent**: no shared state between tests
- **Repeatable**: same result regardless of environment
- **Self-validating**: pass/fail, no manual inspection
- **Timely**: written just before the code it tests

### 6. AAA Pattern

Structure every test as:
```
// Arrange — set up test data and dependencies
// Act     — execute the function/method
// Assert  — verify expected outcome
```

### 7. Test Pyramid

- 70% Unit Tests: fast, isolated, numerous
- 20% Integration Tests: module boundaries
- 10% Acceptance Tests: user-facing scenarios

Don't invert the pyramid. Integration-heavy suites are slow and fragile.

---

*These guidelines are working if: tests are written before implementation, structural and behavioral changes never appear in the same commit, and "make it work" always precedes "make it right".*
"""

CHERNY_ABBREVIATED = """\

---

## Boris Cherny Coding Guidelines

> Workflow orchestration principles. Improve task quality through divide-and-conquer, learning, elegance, and autonomy.
> Applies complementarily alongside Karpathy (code quality) and Kent Beck (TDD).
> These apply to every agent that writes code in this repository.
>
> **Classification — Agent Orchestration Practices.** All five below govern how
> work is divided, verified, and learned from; none of them is a rule about the
> code itself. Filing them under a code-discipline heading is the misplacement
> this note exists to stop.

### 1. Divide and Conquer

**Break complex problems down and tackle them in parallel.**

- Use a subagent when a task would otherwise fill the main context with reading.
- Delegate research, exploration, and analysis to subagents.
- One subagent = one focused goal.
- **Broad, parallelizable, or repository-wide tasks** (full codebase analysis, multi-module changes, parallel research) → delegate to a subagent or team. Simple multi-step sequences (read → edit → verify) stay in the main context.

### 2. Learn from Every Mistake

**After a user correction, record the lesson where the next session will read it.**

- Write rules to prevent the same mistake from happening again.
- Iteratively refine lessons until the error rate drops.
- Review relevant project lessons at the start of each session.

### 3. Demand Elegance, But Know When to Stop

**For non-trivial changes, ask: "Is there a more elegant solution?"**

- If something feels hacky: "Synthesize everything learned so far and implement an elegant solution."
- Skip this process for simple, obvious fixes — no over-engineering.
- Challenge your own work before submitting.

### 4. Fix Bugs Autonomously

**When given a bug report within the current task's scope, fix it. Don't ask the user how.**

- Point to logs, errors, and failing tests — then resolve them.
- Keep the user's context switching at zero.
- Fix CI failures on your own without being told.
- If a fix would touch code outside the current task's scope, flag it rather than silently modifying it.

### 5. Pick the Right Parallelization Primitive

**Context isolates cleanly → spawn subagents. Agents need to challenge each other → use an agent team whose members message each other, where the host supports one.**

- Task scope is bounded by a directory, module, or investigation target → spawn a subagent per scope.
- Cross-validation, competing hypotheses, or findings that need debate → use an agent team so agents message each other directly.
- Cross-layer work (frontend + backend + tests) with coordination needed → use an agent team.
- Subagents: lower cost, results flow back to main context. One focused goal per subagent.
- Agent Teams: higher cost, agents communicate directly — use only when inter-agent communication adds value.

---

*These guidelines are working if: complex tasks are divided among subagents, mistakes lead to documented lessons, and bugs are fixed autonomously without asking the user how.*
"""

CHERNY_FULL = """\

---

## Boris Cherny Coding Guidelines

> Workflow orchestration, task management, and core principles. Maintain quality through plan-execute-verify cycles.
> These apply to every agent that writes code in this repository.
>
> **Classification.** Seven of the eight below are Agent Orchestration Practices;
> only "7. Core Principles" is a rule about the code itself. The two answer to
> different reviewers, so do not read the seven as code rules.

### 1. Plan Before You Build

**For architectural decisions or work whose order matters, write the plan down before editing** so it can be reviewed.

- Write a detailed spec before implementing to reduce ambiguity.
- If the plan goes off track, stop and replan immediately — don't push through.
- Include verification steps in the plan. Don't plan only the build.

### 2. Divide and Conquer

**Break complex problems down and tackle them in parallel.**

- Use a subagent when a task would otherwise fill the main context with reading.
- Delegate research, exploration, and analysis to subagents.
- One subagent = one focused goal.
- **Broad, parallelizable, or repository-wide tasks** (full codebase analysis, multi-module changes, parallel research) → delegate to a subagent or team. Simple multi-step sequences (read → edit → verify) stay in the main context.

### 3. Learn from Every Mistake

**After a user correction, record the lesson where the next session will read it.**

- Write rules to prevent the same mistake from happening again.
- Iteratively refine lessons until the error rate drops.
- Review relevant project lessons at the start of each session.

### 4. Prove It Works

**Before claiming completion, prove the functionality works.**

- Don't say "done" without running tests, checking logs, or demonstrating correctness.
- Compare behavior between main branch and the changes.
- Ask yourself: "Would a senior engineer approve this?"

### 5. Demand Elegance, But Know When to Stop

**For non-trivial changes, ask: "Is there a more elegant solution?"**

- If something feels hacky: "Synthesize everything learned so far and implement an elegant solution."
- Skip this process for simple, obvious fixes — no over-engineering.
- Challenge your own work before submitting.

### 6. Fix Bugs Autonomously

**When given a bug report within the current task's scope, fix it. Don't ask the user how.**

- Point to logs, errors, and failing tests — then resolve them.
- Keep the user's context switching at zero.
- Fix CI failures on your own without being told.
- If a fix would touch code outside the current task's scope, flag it rather than silently modifying it.

### 7. Core Principles

- **Simplicity First**: Make every change as simple as possible. Modify only the minimum code necessary.
- **Root causes over workarounds**: fix the cause. If a temporary fix is unavoidable, say so and record what remains.
- **Minimal Impact**: Modify only what is needed. Don't introduce bugs.

### 8. Pick the Right Parallelization Primitive

**Context isolates cleanly → spawn subagents. Agents need to challenge each other → use an agent team whose members message each other, where the host supports one.**

- Task scope is bounded by a directory, module, or investigation target → spawn a subagent per scope.
- Cross-validation, competing hypotheses, or findings that need debate → use an agent team so agents message each other directly.
- Cross-layer work (frontend + backend + tests) with coordination needed → use an agent team.
- Subagents: lower cost, results flow back to main context. One focused goal per subagent.
- Agent Teams: higher cost, agents communicate directly — use only when inter-agent communication adds value.

---

*These guidelines are working if: tasks start with a plan before implementation, completion claims come with verification evidence, and bugs are fixed autonomously without asking the user how.*
"""

FOWLER = """\

---

## Martin Fowler Coding Guidelines

> Refactoring principles. Keep structure and behavior changes separate.
> These apply to every agent that writes code in this repository.

### 0. Prerequisite: Tests Before Refactoring

Refactoring without tests is not refactoring — it's changing code and hoping.
- Before any refactoring, ensure tests cover the code you're about to change.
- If tests don't exist, write characterization tests first (see Feathers preset).
- Run the full test suite before and after every refactoring step.

### 1. Two Hats

Never add function and refactor simultaneously.
- Adding features: don't clean up surrounding code
- Refactoring: don't add new behavior
- Switch hats consciously. Never wear both at once.

### 2. Rule of Three

Tolerate duplication once. Remove it the third time.
- First time: just do it.
- Second time: note the duplication.
- Third time: refactor.

### 3. Code Smells (When to Refactor)

- Long Method → extract methods
- Large Class → split responsibilities
- Long Parameter List → introduce parameter object
- Duplicated Code → extract
- Feature Envy → move method to the class it's interested in

### 4. Preparatory Refactoring

Make the change easy, then make the easy change.
- Before a feature: refactor to create a clean slot for it
- Commit structural cleanup separately from the feature

---

*Working if: structure/behavior always in separate commits, duplication tolerated until third occurrence.*
"""

CLEANCODE = """\

---

## Robert Martin (Clean Code) Guidelines

> SOLID principles and clean code fundamentals.
> These apply to every agent that writes code in this repository.

### 1. SOLID Principles

- S — Single Responsibility: one reason to change per class/module
- O — Open/Closed: open for extension, closed for modification
- L — Liskov Substitution: subtypes must fulfill parent contracts
- I — Interface Segregation: many specific interfaces > one general one
- D — Dependency Inversion: depend on abstractions, not concretions

### 2. Meaningful Names

- Reveal intent. If a name needs a comment, rename it.
- Avoid disinformation (e.g., `accountList` when it's not a List).
- Use searchable, pronounceable names.

### 3. Functions

- ≤20 lines. Do one thing. One level of abstraction.
- ≤3 arguments. Zero is ideal.
- No side effects: a function does exactly what its name says.

### 4. Comments

- Good code is self-documenting. Comments are a last resort.
- Explain *why*, never *what*.
- Delete commented-out code immediately.

---

*Working if: names explain intent without comments, functions fit on one screen.*
"""

OSI = """\

---

## OSI 7 Layers Reference

> Network stack reference for debugging, API design, and security thinking.
> These apply to every agent that writes code in this repository.

| Layer | Name         | Protocols / Examples        | Dev Relevance                       |
|-------|--------------|-----------------------------|-------------------------------------|
| 7     | Application  | HTTP, HTTPS, DNS, WebSocket | API design, auth, input validation  |
| 6     | Presentation | TLS, JSON, XML, encoding    | Encryption, serialization           |
| 5     | Session      | Cookies, JWT, OAuth tokens  | Session mgmt, token lifecycle       |
| 4     | Transport    | TCP, UDP                    | Timeouts, ports, connection pooling |
| 3     | Network      | IP, ICMP                    | Routing, firewalls, IP filtering    |
| 2     | Data Link    | Ethernet, MAC               | (infra level)                       |
| 1     | Physical     | Cables, hardware            | (infra level)                       |

### Security by Layer (What Code Owns)

- L7 Application: Validate all input. Enforce auth/authz. HTTPS only.
- L6 Presentation: Never roll your own crypto. Use TLS 1.2+. Validate encoding.
- L5 Session: Short-lived tokens. Invalidate on logout. Rotate secrets.
- L4 Transport: Set timeouts. Don't expose unnecessary ports. Use TLS.
- L3 Network: Infra controls are a safety net — don't rely on them alone.

### Debugging: Identify the Layer First

- Data wrong → L7 | Can't connect → L4/L3 | Handshake failing → L6/L4 | DNS failing → L7/L3

---

*Working if: layer identification is the first step in network debugging, security controls exist at L7 regardless of lower layers.*
"""

FEATHERS = """\

---

## Michael Feathers — Legacy Code Guidelines

> Safe strategies for modifying unfamiliar or legacy code.
> These apply to every agent that changes an existing codebase.

### 1. Characterization Tests First

Before changing any unfamiliar code, write tests that capture its **current behavior** (not desired behavior).
- These are not TDD tests — they document what the code does now, not what it should do.
- Run them before your change. After your change, they reveal unintended side effects.
- Minimum: one characterization test per function you intend to modify.

### 2. Find the Seam

A seam is a point where you can change behavior without editing the source directly.
- Look for: constructor parameters, interfaces, config files, environment variables, dependency injection points.
- Prefer changing behavior at a seam over editing inline logic.
- If no seam exists, create one (extract parameter, introduce interface) — in a separate commit.

### 3. Sprout, Don't Edit

When adding behavior to a complex method you don't fully understand:
- Write the new behavior in a new method (Sprout Method) or new class (Sprout Class).
- Call it from the existing code with minimal changes.
- Do not insert new logic into the middle of existing methods.

### 4. Wrap, Don't Modify

When you must intercept existing behavior:
- Wrap the existing method: call the original, add behavior before or after.
- Keep the wrapper thin — it should not contain business logic.

### 5. Never Change Without a Safety Net

- If code is untestable, make it testable first (separate commit).
- Never modify legacy code without at least one test covering the change point.
- Small steps: one behavioral change per commit.

### 6. Understand Before Changing

- Read the callers, not just the function.
- Check what tests (if any) already exist for this code.
- If you don't understand what a function does, write a characterization test to find out.

---

*Working if: every modification to unfamiliar code is preceded by characterization tests, and new behavior is added via sprout or wrap rather than inline insertion.*
"""

OWASP = """\

---

## OWASP Security Guidelines

> Concrete vulnerability prevention rules for code-writing agents.
> Complements the OSI preset (layer-based thinking) with specific do/don't rules.
> These apply to every agent that writes code in this repository.

### 1. Injection Prevention

- **SQL/NoSQL**: Always use parameterized queries or ORMs. Never concatenate user input into queries.
- **Command injection**: Never pass user input to shell commands. Use safe APIs with argument arrays.
- **General**: Treat all external input as untrusted. Validate type, length, and range at every boundary.

### 2. XSS Prevention

- Encode all output rendered in HTML. Use framework auto-escaping — never disable it.
- Never inject raw user-supplied strings into the DOM or templates.
- Content-Security-Policy headers are the safety net, not the primary defense.

### 3. Authentication & Secrets

- Hash passwords with bcrypt or argon2. Never MD5/SHA1 for passwords. Never plaintext.
- No hardcoded credentials, API keys, or secrets in source code.
- Secrets belong in environment variables or a secrets manager.

### 4. Broken Access Control

- Check permissions server-side on every request — never rely on client-side checks.
- Default deny: start with no access, grant explicitly.
- Validate that the authenticated user owns the resource they're accessing.

### 5. Security Misconfiguration

- No debug mode, verbose errors, or stack traces in production.
- No default credentials. Change or disable all defaults.
- Minimize exposed endpoints and installed packages.

### 6. Unsafe Deserialization

- Never deserialize untrusted data using pickle, eval, yaml.load (unsafe), or Java native deserialization.
- Use safe alternatives: `yaml.safe_load`, `json.loads`, schema-validated parsers.

### 7. SSRF Prevention

- Never make server-side HTTP requests to URLs supplied by users without strict validation.
- Allowlist target hosts/IPs. Block internal/metadata service ranges (169.254.x.x, 10.x, etc.).

### 8. Secure by Default

- Deny by default: allowlists over blocklists. Define what IS allowed, not what isn't.
- Bind to localhost, not 0.0.0.0, unless explicitly serving external traffic.
- Restrict CORS origins explicitly — never `*` for credentialed requests.

### 9. Defensive Code Robustness

- Guard clauses: validate preconditions at function entry. Return early on invalid input.
- Never return null/None silently. Use Optional types, Result types, or raise explicitly.
- Fail fast: surface errors at the point of cause, not silently downstream.

---

*Working if: no string concatenation in queries, no hardcoded secrets, all output encoded, and default deny is the starting position for all access control.*
"""

HEADERS = {
    "karpathy": "## Karpathy Coding Guidelines",
    "kentbeck": "## Kent Beck Coding Guidelines",
    "cherny": "## Boris Cherny Coding Guidelines",
    "fowler": "## Martin Fowler Coding Guidelines",
    "cleancode": "## Robert Martin (Clean Code) Guidelines",
    "osi": "## OSI 7 Layers Reference",
    "feathers": "## Michael Feathers — Legacy Code Guidelines",
    "owasp": "## OWASP Security Guidelines",
}

# One-line descriptions used by the `load auto` skill to reason about preset selection.
# The skill reads these and matches them against project nature using Claude's judgment.
DESCRIPTIONS = {
    "karpathy":  "Apply to all code authoring: avoid assumptions, write the minimum, and define success criteria first",
    "kentbeck":  "Long-lived code rather than one-off scripts: TDD, structure/behavior separation, FIRST, AAA, and the Test Pyramid",
    "cherny":    "Always apply: Claude Code agent practices for orchestration, planning, execution, and verification",
    "fowler":    "When refactoring or preparing a safe slot for structural change: Two Hats, Code Smells, and Preparatory Refactoring",
    "cleancode": "Projects where code structure, naming, and function design matter: SOLID, meaningful names, and small functions",
    "osi":       "Projects with API servers or network code: security responsibility and debugging by layer",
    "feathers":  "When changing untested legacy code or breaking dependencies in unfamiliar code: characterization tests, seams, and Sprout Method",
    "owasp":     "Projects handling user input, authentication, or external data: SQL injection, XSS, and secure defaults",
}

# ---------------------------------------------------------------------------

def has_header(content: str, key: str) -> bool:
    return HEADERS[key] in content


def describe_presets() -> None:
    """Print all preset descriptions for use by the load skill's auto-reasoning."""
    print("Available presets and when to apply them:\n")
    for key, desc in DESCRIPTIONS.items():
        print(f"  --{key:<12} {desc}")
    print()
    print("Usage: pass the selected flags to inject. e.g.:")
    print("  python3 ${CLAUDE_PLUGIN_ROOT}/skills/setup/scripts/load_guidelines.py"
          " --target ./CLAUDE.md --karpathy --cherny --kentbeck")


def main():
    parser = argparse.ArgumentParser(description="Inject coding guidelines into CLAUDE.md")
    parser.add_argument("--target", default="./CLAUDE.md", help="Target file (default: ./CLAUDE.md)")
    parser.add_argument("--karpathy", action="store_true")
    parser.add_argument("--kentbeck", action="store_true")
    parser.add_argument("--cherny", action="store_true", help="Abbreviated version (5 principles)")
    parser.add_argument("--cherny-full", action="store_true", dest="cherny_full", help="Full version (8 principles)")
    parser.add_argument("--fowler", action="store_true")
    parser.add_argument("--cleancode", action="store_true")
    parser.add_argument("--osi", action="store_true")
    parser.add_argument("--feathers", action="store_true")
    parser.add_argument("--owasp", action="store_true")
    parser.add_argument("--describe", action="store_true", help="Print all preset descriptions and exit")
    parser.add_argument("--all", action="store_true", dest="all_presets", help="Inject all presets")
    args = parser.parse_args()

    # --describe: print descriptions for skill-level reasoning and exit
    if args.describe:
        describe_presets()
        return

    # Expand --all
    if args.all_presets:
        args.karpathy = args.kentbeck = args.cherny_full = args.fowler = args.cleancode = args.osi = args.feathers = args.owasp = True

    if not any([args.karpathy, args.kentbeck, args.cherny, args.cherny_full,
                args.fowler, args.cleancode, args.osi, args.feathers, args.owasp]):
        parser.error("At least one guideline flag is required (or use --all / --describe).")

    target = os.path.abspath(args.target)
    existing = ""
    if os.path.exists(target):
        with open(target, "r", encoding="utf-8") as f:
            existing = f.read()

    injected = []
    skipped = []
    content_to_append = ""

    if args.karpathy:
        if has_header(existing, "karpathy"):
            skipped.append("Karpathy")
        else:
            content_to_append += KARPATHY
            injected.append("Karpathy")

    if args.kentbeck:
        if has_header(existing, "kentbeck"):
            skipped.append("Kent Beck")
        else:
            content_to_append += KENTBECK
            injected.append("Kent Beck")

    if args.cherny or args.cherny_full:
        if has_header(existing, "cherny"):
            skipped.append("Boris Cherny")
        else:
            content_to_append += CHERNY_FULL if args.cherny_full else CHERNY_ABBREVIATED
            injected.append("Boris Cherny")

    if args.fowler:
        if has_header(existing, "fowler"):
            skipped.append("Martin Fowler")
        else:
            content_to_append += FOWLER
            injected.append("Martin Fowler")

    if args.cleancode:
        if has_header(existing, "cleancode"):
            skipped.append("Clean Code")
        else:
            content_to_append += CLEANCODE
            injected.append("Clean Code")

    if args.osi:
        if has_header(existing, "osi"):
            skipped.append("OSI 7 Layers")
        else:
            content_to_append += OSI
            injected.append("OSI 7 Layers")

    if args.feathers:
        if has_header(existing, "feathers"):
            skipped.append("Michael Feathers")
        else:
            content_to_append += FEATHERS
            injected.append("Michael Feathers")

    if args.owasp:
        if has_header(existing, "owasp"):
            skipped.append("OWASP")
        else:
            content_to_append += OWASP
            injected.append("OWASP")

    if content_to_append:
        with open(target, "a", encoding="utf-8") as f:
            f.write(content_to_append)

    if injected:
        print(f"Injected into {target}: {', '.join(injected)}")
    if skipped:
        print(f"Already present (skipped): {', '.join(skipped)}")
    if not injected:
        print("Nothing to inject — all guidelines already applied.")


if __name__ == "__main__":
    main()
