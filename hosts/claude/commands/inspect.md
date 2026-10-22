---
description: Inspect one skill's layers, references and check counts
---

# /inspect — examine one skill

## Run

```
scripts/inspect.js <skill-name>
```

## Output

| Item | Interpretation |
|---|---|
| L1 SKILL.md line count | More than one screen suggests moving detail to L2 |
| L2 count (references/ and langs/) | Zero with a long SKILL.md means incorrect layering. **Do not count only `references/`**; tdd stores L2 in `langs/` |
| L3 script count | Check whether prose is handling deterministic operations |
| Frozen-reference count | Must match the contract file count |
| Contract results | Total and passing checks |

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Contracts exist and pass |
| 1 | Contracts fail or **do not exist** |
| 2 | The skill does not exist |

Returning 1 for absent contracts is intentional. Returning 0 would give an
untested skill the same signal as a passing skill.

## Next

For incorrect layering, use the `author` skill. For new contracts, read that
skill's section on shipping a suite alongside the behavior.
