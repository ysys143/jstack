---
type: llm
weight: 1
---

# Grading criteria — actual axis system

**Both passing conditions are required.**

## 1. There are 10 axes

Equivalent wording is acceptable. **The count must be exact.**

## 2. The closed list for Axis 8 and its exception

Require all five items in the closed list, especially the exception that a
**`wrapper for a single call site` is reported under 5, not 8**.
This exception cannot be guessed.

## Failure (FAIL) — every case below fails

- **The response says it does not know.** Failure to reach the source is failure.
- **The response fabricates an answer.** It offers a generic code-smell list (SOLID, DRY, etc.).
- The axis count differs.
