# Validation Hook Template

This Node.js 20+ template provides the validator interface, diagnostics,
configuration loading, and hook input handling. Its `validate` and `auto_fix`
methods are extension points: the supplied skeleton does not validate a project
until you add rules.

## Template Structure

- `validate_template.ts`: editable TypeScript source.
- `validate_template.js`: compiled implementation in the jstack package.
- `toml.mjs` and `toml.LICENSE`: bundled TOML parser and its BSD license.
- `package.json`: enables JavaScript modules when the directory is copied.
- `hooks.json`: native Claude hook declaration.

## Usage

Copy the entire packaged template directory into your plugin's
`hooks/validation-hook-template/`. Keep `package.json`, `toml.mjs`, and
`toml.LICENSE` beside the compiled script. The package already contains runnable
JavaScript; users do not compile TypeScript. Contributors who customize the
TypeScript must compile their edited source before distribution.

The hook command is:

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "Bash",
      "hooks": [{
        "type": "command",
        "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/validation-hook-template/validate_template.js\""
      }]
    }]
  }
}
```

Claude triggers hooks around tool use. `Bash` is the tool matcher, not the
implementation language. There are no native `pre_commit` or `post_generate`
events. To target commits, inspect `tool_input.command` and return immediately
for unrelated commands. A hook declaration has no per-hook `name` or `config`.

Run the compiled script with an explicit target for a manual check:

```text
node hooks/validation-hook-template/validate_template.js .
```

An explicit argument takes precedence over `tool_input.file_path` in stdin JSON.
Without either, the target is the current directory. There is no executable-bit
requirement because the host invokes Node explicitly. The process returns 0
when no error diagnostics remain and 1 when validation fails.

## Implement Validation Logic

Customize `validate` inside `Validator`; the following illustrates a plugin
manifest check. A warning does not enter the error collection.

```typescript
validate(targetPath: string): boolean {
  this.check_json_schema(
    join(targetPath, '.claude-plugin/plugin.json'),
    ['name', 'version', 'description'],
  );
  this.check_naming_convention(
    basename(targetPath), '[a-z0-9]+(?:-[a-z0-9]+)*', 'plugin directory name',
  );
  return this.errors.length === 0;
}
```

Import `join` and `basename` from `node:path` when adding these examples.
Diagnostics include a stable rule, readable message, location, and concrete fix.
`add_error` uses configured severity unless you provide one explicitly.

## Common Validation Patterns

### Schema Validation

`check_json_schema(path, requiredFields)` first checks file existence, then JSON
syntax, then required top-level fields. Extend it for field types, enum values,
or nested schemas; required-field presence alone does not prove semantic
validity. Invalid JSON remains untouched. Avoid embedding private field values
in error messages.

### File Structure Validation

Use `check_file_exists` for each required file and report all missing files in
one run. Resolve paths against the selected target rather than the process
working directory. Reject paths outside the target when a rule accepts
user-provided relative paths. Keep checks read-only unless an explicit fix
mode owns the mutation.

### Naming Convention Validation

`check_naming_convention` matches from the start of a name. Include `$` in a
pattern when the entire name must match. Keep the rule description distinct
from the expression so users see both the intent and the required syntax.

### Coherence Validation

Cross-check declared commands against skill references and declared files
against their actual paths. Missing required assets are errors; a reference to
an optional integration can be a warning if the contract permits it. Collect
all findings before returning, rather than stopping at the first mismatch.

## Configuration Options

The template reads `[tool.claude-hooks]` from `pyproject.toml` using the bundled
parser. A missing or invalid optional file uses defaults. Environment settings
`HOOK_SEVERITY` and `HOOK_AUTO_FIX` override the file. Accepted true values for
`HOOK_AUTO_FIX` are `1`, `true`, and `yes`, ignoring case and surrounding space.

```toml
[tool.claude-hooks]
severity = "error"
auto_fix = false

[tool.claude-hooks.rules]
max_file_size = 1048576
allowed_extensions = [".md", ".json", ".js", ".ts"]
```

`severity` defaults to `error`; other severities enter the warning collection.
`rules` is available to project-specific checks without being interpreted by
the skeleton. For example, read `this.rules.max_file_size` and validate its
numeric type before applying it.

### Auto-fix

The default implementation returns false. Implement only bounded fixes whose
outputs you can validate, such as adding an explicitly specified missing field.
Do not silently invent required values. Return true only after the intended
edits succeed; `main` then creates a fresh validator and rechecks the target.
Keep a failed edit recoverable and preserve unrelated file contents.

## Testing Validation Hooks

Use Node's test runner to exercise successful rules, invalid input, warning
severity, and diagnostic details. For example:

```javascript
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Validator } from './validate_template.js';

test('required file failure has a repair instruction', () => {
  const validator = new Validator({ severity: 'error' });
  assert.equal(validator.check_file_exists('/missing-fixture/file.json'), false);
  assert.equal(validator.errors[0].rule, 'file_exists');
  assert.match(validator.errors[0].fix, /^Create file:/);
});
```

For integration tests, spawn the compiled script with `process.execPath`, pass
synthetic hook JSON on stdin, and check status, stdout, stderr, and file changes.
Run both a valid project and a project missing a required asset after adding
project rules. Include argument-over-stdin precedence and auto-fix revalidation.

## Troubleshooting

If the hook does not run, check its registered event, matcher, command path,
Node availability, and the host's hook trust setting. If rules produce false
positives, reproduce the reported input and inspect rule configuration before
changing severity. For expensive checks, restrict the target population and
cache only data whose invalidation is explicit; never skip required checks
merely to reduce runtime.

Related templates: [formatting](../formatting-hook-template/README.md) and
[notification](../notification-hook-template/README.md). Native hook schema and
plugin configuration are described in the owning author skill references.


## Connect Validation Results to Tool Execution

The `PreToolUse` lifecycle events occur before the matched tool operation. This
skeleton returns a validator result. Connect that result to the host's documented
blocking protocol and exercise a rejected tool call before treating the hook as
an enforcement control. A successful manual validation command only establishes
that the validator accepted its input; it does not establish host interception.

When validating a tool command, first decide whether the payload represents the
operation your rule owns. Parse the JSON envelope, inspect the relevant tool
fields, and return without modifying unrelated operations. Do not execute the
command from the payload to determine whether it is safe. Keep an explicit
mapping from each rejected condition to its diagnostic and repair instruction.

Use isolated fixture directories when developing project-specific rules. Put a
known valid manifest in one directory and remove one required field in a second.
Run the same compiled entry point against each directory and compare both the
result and the original file bytes. Then repeat with a synthetic stdin payload
that points at each fixture, including a payload whose target conflicts with an
explicit command argument. This verifies the documented argument precedence.

For auto-fix rules, preserve a copy of the fixture, apply the bounded repair,
and run a fresh validator over the result. Verify that unrelated files and
unrelated keys remain unchanged. Include an unsuccessful repair case: returning
true from a repair function must never substitute for the subsequent validation.
Keep configuration parsing and project validation separately testable so a
missing optional configuration file cannot hide a missing required project file.

Retain the failing fixture alongside its expected diagnostic. A regression case
should identify the rule it exercises and fail when that rule is removed, so a
new success message cannot hide a validator that stopped inspecting the target.

The packaged template includes `references/templates/validation-hook-template/toml.mjs` and
`references/templates/validation-hook-template/toml.LICENSE` for its standalone
TOML parser. Copy both files with `validate_template.js`; they require no npm install.
