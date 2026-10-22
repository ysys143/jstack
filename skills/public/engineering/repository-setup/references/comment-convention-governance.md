# Comment convention governance

Use this procedure when a team wants to turn recurring review feedback about
JavaScript or TypeScript comments into a shared lint rule. It prepares a
reviewable proposal. It does not silently edit shared configuration, create a
pull request, request a review, or send a message.

## Read the repository before choosing a rule

Inspect the applicable instruction files and the nearest configuration for each
affected package. At minimum, read:

- the ESLint version, flat or legacy configuration, existing plugins, overrides,
  and lint scripts;
- `package.json`, the package-manager lockfile, `lint-staged` configuration,
  Husky or another Git-hook mechanism, and the CI job that runs lint;
- `.github/CODEOWNERS`, `CODEOWNERS`, or `docs/CODEOWNERS`, including which file
  GitHub will select and whether the named owner can actually review the paths;
- representative comments from current code, recent changes, and review history.

Sample enough files to distinguish an observed convention from one person's
preference. Record exceptions such as generated code, vendored code, license
headers, pragmas, test fixtures, URLs, and tool directives. If the repository
already has a working equivalent, report it and stop. Follow the parent skill's
read, report, then propose order and its shared-configuration approval boundary.

In a monorepo, resolve ESLint, hook, and ownership scope per package. For
`lint-staged`, the closest configuration owns a staged file and configurations
are isolated rather than merged. A root rule is therefore not evidence that a
nested package runs it. Record the working directory and exact config selected
for every proposed command.

## Classify the comment before selecting a checker

Do not apply one prose rule to three different contracts.

| Comment class | Examples | First tools to assess |
| --- | --- | --- |
| General line or block comment | `// Why this cache is retained` | ESLint core `capitalized-comments` for mechanical capitalization; existing project rules |
| JSDoc | `/** Returns the retained entry. */` | `eslint-plugin-jsdoc`, including `informative-docs`, `match-description`, and complete-sentence rules where the repository needs them |
| ESLint directive comment | `// eslint-disable-next-line rule -- reason` | `@eslint-community/eslint-plugin-eslint-comments`, especially directive-description and unused-disable checks |

Check installed and compatible versions before recommending a dependency.
`capitalized-comments` is a frozen core rule, so use it when its existing
behavior is sufficient rather than extending it. Do not build on ESLint core
rule internals: they are not a public extension API. Prefer maintained built-in
or community rules, then configuration, and only then a project-local rule.

Rules that claim to decide whether prose explains *why*, is useful, or repeats
the code are heuristic. Do not present a regex or model judgment as objective
meaning. Start such a rule as a warning or shadow report and preserve examples
where a human reviewer disagrees.

## Build one canonical project rule pack

When existing tools cannot express the demonstrated convention, propose one
repository-owned rule pack rather than a private hook per contributor. Match the
repository's module system and layout; a typical shape is:

```text
tools/eslint-plugin-project/
  index.js
  rules/comment-intent.js
  tests/comment-intent.test.js
  fixtures/
    good.js
    bad.js
    exceptions.js
```

The canonical pack must contain:

- the rule source and stable rule ID;
- good, bad, and exception fixtures copied or reduced from observed cases;
- `RuleTester` cases for every trigger and non-trigger boundary;
- the rationale, scope, false-positive policy, and rollback condition;
- an accountable owner and the paths that CODEOWNERS should cover.

Keep fixtures as the reviewable meaning of the rule. A personal proposal becomes
a project convention only after its examples, exceptions, and owner are reviewed
in a pull request. Avoid publishing a package when a local plugin satisfies one
repository. Never copy or extend ESLint's internal core rule implementation.

## Promote enforcement in measured stages

Use the same representative corpus at each stage and record counts by package.

1. **Proposal:** prepare fixtures, rule code or existing-rule configuration, and
   an exact diff. Do not alter shared config yet.
2. **Warning or shadow:** run without blocking commits. Record true positives,
   false positives, missed cases, runtime, and reviewer disagreements.
3. **Reviewed warning:** adjust triggers and exceptions, then obtain approval for
   the canonical rule pack and affected shared configuration.
4. **Staged-file hook:** after approval, run the narrow lint command through the
   repository's existing hook mechanism. A Husky `pre-commit` may call
   `lint-staged`; do not install a second hook framework beside a working one.
5. **CI enforcement:** make the reproducible CI job the final authority. A local
   hook is fast feedback, but `git commit --no-verify`, disabled Husky, missing
   dependencies, and GUI environment differences can bypass it.

Do not jump from a subjective convention to a commit blocker. State the sample
size, acceptance threshold, maximum false-positive rate, owner, observation
period, and rollback trigger before promotion.

`lint-staged` passes staged filenames, but ESLint normally evaluates the whole
file. A newly enabled error can therefore block a touched file because of old,
unrelated comments. Measure the existing violation inventory before enforcement.
Choose a reviewed rollout such as warning-only legacy findings, a bounded
baseline with an expiry plan, or package-by-package cleanup. Do not silently add
unbounded ignores, auto-fix semantic prose, or claim that staged-file execution
checks only changed lines.

For a monorepo, test at least one matching and one non-matching file under every
closest `lint-staged` configuration. Confirm nested configs include shared
patterns explicitly when intended. Run the local hook command without creating a
commit, then run the same lint behavior in CI or its local equivalent. A green
hook alone is not enforcement evidence.

## Prepare the review packet before external action

Produce this packet before asking for approval to change shared configuration or
performing any external action:

```markdown
## Comment lint proposal

- Observed convention:
- Evidence paths and sample size:
- Comment class: general | JSDoc | ESLint directive
- Proposed rule and rationale:
- Existing tool evaluated:
- Trigger examples:
- Non-trigger examples:
- Exceptions:
- Enforcement stage: proposal | shadow | warning | hook | CI
- Affected files and packages:
- Exact config and hook diff:
- Validation command and measured result:
- Reviewer or accountable owner:
- CODEOWNERS change, if any:
- Known false positives and existing violations:
- Promotion gate:
- Rollback command or diff:
```

CODEOWNERS can request review automatically when a pull request changes owned
paths. Draft pull requests do not trigger those requests; marking a draft ready
does. Treat that behavior as a proposal input, not authorization. The skill may
identify the matching owner and prepare the exact CODEOWNERS line, diff, and
review packet. It must not create or ready a pull request, request a reviewer,
send an external message, or mutate ESLint, hook, CI, or CODEOWNERS configuration
without the user's authorization.

## Rollback

Rollback removes the new rule from the active config and enforcement commands
while preserving its fixtures and shadow evidence for review. If the rule causes
unexpected blocking, revert the hook or CI activation as one bounded change;
do not delete unrelated lint infrastructure. Report whether the failure came
from rule meaning, package scope, dependency/runtime setup, or pre-existing
violations before proposing another rollout.

## Primary documentation

- [ESLint `capitalized-comments`](https://eslint.org/docs/latest/rules/capitalized-comments)
- [ESLint custom rule tutorial and `RuleTester`](https://eslint.org/docs/latest/extend/custom-rule-tutorial)
- [ESLint custom-rule API boundary](https://eslint.org/docs/latest/extend/custom-rules)
- [`eslint-plugin-jsdoc`](https://github.com/gajus/eslint-plugin-jsdoc)
- [`@eslint-community/eslint-plugin-eslint-comments`](https://eslint-community.github.io/eslint-plugin-eslint-comments/)
- [`require-description` for directive comments](https://eslint-community.github.io/eslint-plugin-eslint-comments/rules/require-description.html)
- [`lint-staged` configuration and monorepo behavior](https://github.com/lint-staged/lint-staged/blob/main/README.md)
- [Husky setup](https://typicode.github.io/husky/get-started.html)
- [Git `pre-commit` and `--no-verify`](https://git-scm.com/docs/githooks)
- [GitHub CODEOWNERS](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners)
