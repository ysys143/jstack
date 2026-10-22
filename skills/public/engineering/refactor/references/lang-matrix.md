# Language matrix — six properties across seven languages

The axes in `quality-taxonomy.md` are stated as properties rather than as the
tool that finds them. This file is the implementation layer under that decision:
**six properties x seven languages, forty-two cells.** Tools live here, below the
property, never above it.

The reason is one sentence: **a property survives a language change and a tool
does not.** Naming an axis after `knip` or `madge` ties it to one ecosystem and
makes the axis vanish in every language where that tool does not exist — not
"harder to check", *vanish*, because a tool-defined axis has no content apart
from its tool.

## The six properties

```
duplication / unused / cycles / swallowed failure / dead path / excess
```

## The seven languages

Go · Rust · Python · JavaScript · TypeScript · Java · **C**

`tdd/langs/` holds six guides — go, java, javascript, python, rust, typescript.
**C is the seventh, and its guide now lives in `tdd/langs/c.md`.** Earlier
revisions of this file
recorded a real inconsistency — C was counted here with no guide there — and
the discrepancy was written down rather than hidden by dropping the column.
F-10 closed it: the guide exists (gcov / Unity, MC/DC where safety applies),
and this sentence is coupled to the file's presence by the contract suite, so
if the guide disappears this claim goes red instead of going quietly stale.

## Reading the cells

| Cell reads | Means |
|---|---|
| a tool name | A detector exists and the finding is settled by running it |
| **empty set** | The property cannot occur in this language. Not "unchecked" — *cannot occur* |
| read | The property occurs and no standard detector exists. It is found by reading, and the report says so |

**An empty cell is written as "empty set".** A blank cell is indistinguishable
from one nobody filled in, and the two mean opposite things.

## The matrix

### duplication

| Go | Rust | Python | JavaScript | TypeScript | Java | C |
|---|---|---|---|---|---|---|
| `dupl`, PMD CPD | read | `pylint --enable=duplicate-code` | `jscpd` | `jscpd` | PMD CPD | PMD CPD |

### unused — *definitions nothing can reach*

Defined by the property, not by what `knip` catches. A tool-shaped definition
makes the tool's blind spot into non-existence.

| Go | Rust | Python | JavaScript | TypeScript | Java | C |
|---|---|---|---|---|---|---|
| `staticcheck -unused` | rustc `dead_code` | `vulture` | `knip`, `ts-prune` | `knip`, `ts-prune` | read | `gcc -Wunused-function` |

| Language | Blind spot the detector cannot see |
|---|---|
| Go | Implicit interface satisfaction — a method reached only through an interface |
| Python | Dynamic reference: `getattr`, entry points, plugin registries |
| Java | Reflection. This is why the cell reads *read* rather than naming an IDE inspection |
| C | Symbols kept alive only by the linker, and anything reached through a function pointer table |

### cycles

| Go | Rust | Python | JavaScript | TypeScript | Java | C |
|---|---|---|---|---|---|---|
| **empty set** — the compiler forbids import cycles | **empty set** — the module graph is acyclic by construction | `pydeps`, `pylint cyclic-import` | `madge` | `madge` | read — package cycles are legal; JPMS forbids them only between modules | read — include guards let a cyclic include graph compile |

Two of the seven cells are **empty set**. Counting this axis in Go or Rust means
counting something the compiler already made impossible, which is what happens
when an axis is defined by a tool that only ever ran on JS/TS.

### swallowed failure — *swallowing a failure, or raising it with no context*

Not "unwarranted try/catch". That phrasing assumes JS/TS and inverts in Python.

| Go | Rust | Python | JavaScript | TypeScript | Java | C |
|---|---|---|---|---|---|---|
| `errcheck` — ignored `err`, `_ = f()` | clippy `unwrap_used`, `expect_used`, `let _ =` | `bandit B110`, ruff `S110`/`BLE001` | ESLint `no-empty`, `no-useless-catch` | same as JavaScript | PMD `EmptyCatchBlock`, SpotBugs | `cppcheck`, `-Wunused-result` |

**Python inverts and the inversion is the point.** EAFP — try/except as ordinary
control flow — is idiomatic, so "a try block is present" is not evidence of
anything. What is judged is whether the failure was *swallowed*, and that
question reads identically in Go's ignored `err`, Rust's `.unwrap()`, and C's
unchecked return code. Restating the property this way pulls four languages onto
one axis that the tool-shaped phrasing had split.

### dead path — *unreachable branches, serial orchestration, non-atomic updates*

| Go | Rust | Python | JavaScript | TypeScript | Java | C |
|---|---|---|---|---|---|---|
| `go vet` unreachable | rustc `unreachable_code` | mypy `--warn-unreachable` | ESLint `no-unreachable` | ESLint `no-unreachable` | javac — an unreachable statement is a compile error | clang `-Wunreachable-code` |

The detectors above cover the unreachable-branch half only. **The
serial-orchestration and non-atomic-update half has no detector in any of the
seven** — it is found by reading, in every column. That half is on the axis
because it is a structural defect that is also an outage cause, which gives it a
higher incident-prevention value than anything a linter reports.

### excess

| Go | Rust | Python | JavaScript | TypeScript | Java | C |
|---|---|---|---|---|---|---|
| read | read | read | read | read | read | read |

Seven cells, no detector. This row is why `slop-criteria.md` exists: a property
with no tool anywhere needs a closed list and a named adjudicator, or it becomes
a euphemism for taste.

## What the matrix measures about itself

The move from tools to properties is worth making only if the properties still
land on something checkable. The falsification condition stated when the axis was
redefined: **if more than half of the forty-two cells have no detector, the
redefinition renamed things and changed nothing.**

| Cell state | Count |
|---|---|
| Detector named | 29 |
| read (occurs, no standard detector) | 11 |
| empty set (cannot occur) | 2 |
| **Total** | **42** |

Thirteen of forty-two cells name no detector, and two of those thirteen are empty
by construction rather than unchecked. Thirteen is below twenty-one, so the
redefinition survives its own test — but eleven *read* cells is the honest cost,
and the report for a finding in one of them says which cell it came from.
