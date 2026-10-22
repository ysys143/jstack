# Taxonomy code allocation ledger

`references/code-space.md` defines allocation conventions and procedures. This
ledger records only which codes are allocated where. A code absent from the
allocation table has not been issued.

## 1. Namespaces

| Prefix | Namespace | Canonical document | Code range |
|---|---|---|---|
| `AT-` | Korean AI-tell taxonomy | `references/ai-tell-taxonomy.md` | A ~ L |
| `PR-` | Procurement proposal taxonomy | `references/procurement-taxonomy.md` | K ~ O |
| `EN-` | English AI-tell taxonomy | `references/en-taxonomy.md` | EN-1 onward |

`EN-` already had a prefix and no collision. The other two shared the same
alphabetic code space.

## 2. Old-to-new code mapping

These entries used the same letters in different namespaces. The left column is
the old notation; the allocation column gives the assigned code.

| Old notation | Title | Allocation | Canonical location |
|---|---|---|---|
| `L` | Abstract metaphor lexicon | `AT-L` | `ai-tell-taxonomy.md` |
| `L` | Requirements traceability collapse | `PR-L` | `procurement-taxonomy.md` |
| `K` | Procurement-commitment register deviation | `PR-K` | `procurement-taxonomy.md` |
| `M` | Table/figure caption format violation | `PR-M` | `procurement-taxonomy.md` |
| `N` | Text–visual discourse anchoring failure | `PR-N` | `procurement-taxonomy.md` |
| `O` | Procurement hard-rule violation | `PR-O` | `procurement-taxonomy.md` |

Categories A ~ J in `AT-` do not overlap with the other taxonomy and need no
remapping. Still add the prefix in output schemas to prevent future collisions.

## 3. Why the measurement failed first

Counting upstream rule IDs with `\b([A-Z]-\d{1,2})\b` reported an "upstream-only
rule C-14". It was a string cited in C-8's provenance line, not a rule. Counting
headings instead found 0 upstream-only rules.

The density ledger's `C-14` and the taxonomy's `C-14` refer to different things.
A person can distinguish them by context; that regex cannot. Trusting the first
result would have recorded a nonexistent missing rule and created unnecessary work.

Two conventions follow:

- Count rule headings, not body citations, using `^###\s+([A-Z]-\d{1,2})\.`.
- Before using a command's output as a count, test what it counts with one counterexample.

## 4. Unresolved codes

Handle unprefixed `[A-Z]-\d+` as follows:

1. For an internal document cross-reference, use that document's namespace.
2. In an output schema's `category` field, treat it as unresolved and require a prefix.
3. If the letter exists in both namespaces, escalate to a person; do not guess.
