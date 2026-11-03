# Test strength tools

Coverage says a line ran. These checks ask whether the tests would notice the
line being wrong (mutation), whether a changed function is both complex and
untested (CRAP), and whether the change copied code that already exists
(duplication). Each runs the project's own tool; jstack only judges the report,
and only on the lines a change added or the files a requirement owns.

They are optional and heavy. Use one when a project declares it in
`.jstack/verification.json` (see the verify skill), not by default. A metric
used as a gate invites gaming: splitting functions to lower CRAP, or asserting
implementation details to kill mutants. Start in `report` mode and read the
findings before making one a `fail` gate.

## Judge a report

```bash
node ${JSTACK_PLUGIN_ROOT}/skills/tdd/scripts/strength_gates.js mutation \
    --diff <(git diff -U0 "$(git merge-base origin/main HEAD)") --report reports/mutation/mutation.json
node ${JSTACK_PLUGIN_ROOT}/skills/tdd/scripts/strength_gates.js crap \
    --files src/billing.ts --complexity lizard.csv --coverage coverage/lcov.info --threshold 30
node ${JSTACK_PLUGIN_ROOT}/skills/tdd/scripts/strength_gates.js duplication \
    --diff changes.diff --report reports/jscpd/jscpd-report.json
```

Exit 0 means no finding on judged lines, 1 means findings, 2 means the report
could not be read or is not a supported format. A diff that adds no lines passes.

## Mutation reports

| Language | Tool | Report | Run only the change |
|---|---|---|---|
| JavaScript, TypeScript | Stryker | `reports/mutation/mutation.json` (`jsonReporter`) | `--mutate <files>`, `incremental: true` |
| Java | PIT | `target/pit-reports/mutations.xml` (`outputFormats: XML`) | `scmMutationCoverage` or `targetClasses` |
| Rust | cargo-mutants | `mutants.out/outcomes.json` | `--in-diff <diff>` |
| Go | gremlins | `--output gremlins.json` | `--diff <ref>` |
| Python | mutmut | no line numbers in its results; not judged | `paths_to_mutate` |
| C | mull | not supported yet | |

Survived and uncovered mutants on judged lines are findings. A mutant that
cannot change behavior (an equivalent mutant) also survives; record why and
leave it, instead of writing a test that pins the implementation.

## CRAP

`CRAP = c² × (1 − coverage)³ + c` per function, with `c` the cyclomatic
complexity (Savoia and Evans, Crap4j). The default threshold 30 is Crap4j's.
Complexity comes from `lizard --csv` (C, C++, Java, Python, JavaScript,
TypeScript, Go, Rust and more); coverage from lcov, Cobertura, JaCoCo, or a Go
profile. A function with no measured line counts as uncovered. A long
`switch` that answers one question can stay above the threshold; split a
function because it does two jobs, not to move a number.

## Duplication

`jscpd --reporters json` writes `jscpd-report.json`. A clone is a finding when
either copy overlaps the judged lines, so old duplication elsewhere is not
reported until a change touches it.
