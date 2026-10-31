# Digest contract

`package_identity.js` computes identity for one package directory. The package
is the unit, so an installed copy is checked from its own bytes and does not
need `.git`, a worktree, or a repository checkout.

## Five independent signals

| Signal | Covers | Meaning |
| --- | --- | --- |
| `runtime` | invokable skill/docs/scripts/hooks/commands/agents | behaviour surface may differ |
| `test` | tests, evals, contracts, frozen verification material | verification contract moved |
| `assets` | package assets and examples | bundled non-code inputs moved |
| `metadata` | manifest, README, CHANGELOG, license/notice | package description or release record moved |
| `tree` | every accepted package file, with raw bytes | any package byte moved |

These signals are reported together and are never collapsed. A test-only change
must not look like a runtime change. A version-only change is identified by a
changed raw tree/metadata signal with an unchanged normalised runtime signal
and unchanged `versionNeutralTree`; a README or routing field change therefore
cannot be mislabeled as version-only.

## Canonical bytes

1. Paths are relative POSIX paths sorted by Python Unicode codepoint order.
2. Each record is `path UTF-8 + NUL + mode + NUL + sha256(raw-or-normalised-bytes) + NUL`.
3. `mtime`, locale, and checkout identity are excluded. Permission bits remain
   part of the record, so removing executable mode is an identity change.
4. Runtime normalisation is narrow: only the `metadata.version` value in a
   `SKILL.md` frontmatter block becomes `@VERSION@`. Version strings in prose,
   references, JSON, tests, and all other metadata remain byte-sensitive.
5. Relative symlinks whose resolved file or directory target stays inside the
   package are accepted. Their link spelling and current target bytes are
   included in the digest. Absolute, broken, special-file, and package-
   escaping links are rejected. `node_modules`, `.git`, and bytecode/cache
   directories are excluded before inventory.

The previous broad rule of replacing every version-looking string was unsafe:
it could hide a real runtime or reference change. Expanding the normalisation
scope requires a new contract version and a focused test.

## Identity receipts

The JSON schema is `jstack.package-identity/v1` with algorithm
`sha256/canon-v2`. A receipt contains package name/version, role counts, and the
five primary digests plus `versionNeutralTree`. `preflight.js --identity-receipt` and
`package_check.js --identity-receipt` recompute current bytes and fail on any
mismatch. A receipt is a comparison record, not an authenticity statement:
`provenance` fields are rejected and no source, commit, or author is trusted by
the identity verifier.

## Consumers and commands

```bash
node scripts/package_identity.js <package> --json
node scripts/package_identity.js <package> --receipt identity.json --json
node scripts/preflight.js <package> --identity-receipt identity.json
node scripts/package_check.js <package> --identity-receipt identity.json
```

Keep `identity.json` outside the package directory being hashed. Storing the
receipt inside the package makes the next digest self-referential.

Codex installation bundles prefer `.codex-plugin/plugin.json`, while Claude
packages prefer `.claude-plugin/plugin.json`, for package name and version.
Only when neither manifest exists may compatibility code inspect `plugin.json`
or `SKILL.md` frontmatter. `classify_change()` labels a receipt pair as
`version-only`, `test-only`, `runtime`, `mixed`, or `unchanged`; this is a byte
comparison, not provenance authentication or a signature.

Native source roots and installed package roots use the same functions. The
source/install mode remains `preflight.js`'s separate surface contract; the
identity digest does not infer support or release authenticity.

## Three digests, never one

The runtime, verification, and tree questions remain distinct even though the
identity receipt additionally reports assets and metadata. **Do not merge these into one.** The older three-name vocabulary is retained here for reports and
fixtures: `runtime` is behaviour, `verification` is the test signal, and `tree`
is the raw package signal. The implementation maps `verification` to the
receipt's `test` role and keeps assets/metadata visible rather than hiding them.

## Canonicalization v2

**1. Codepoint order.** Sort paths by Unicode codepoint, never by locale
collation. `LC_ALL` differences reorder any path set containing case variants
or non-ASCII names, and this repository ships Korean filenames. Sort the raw
`str` in Python, or the raw bytes — both are codepoint order for UTF-8. Do not
call a locale-aware sort.

**2. NUL framing.** Join path and content with `\0`, never with a printable
separator. A path and its content hash are framed separately so two distinct
trees cannot share a digest through concatenation.
The separator `\0` cannot appear in a POSIX path, so it is safe framing.

**3. mtime and mode are excluded.** A fresh clone rewrites every mtime, and
umask differences rewrite modes. Including either makes the digest a property
of the checkout instead of the content. Symlink and special-file mode are not
normalised: those entries are rejected before hashing.

**4. `metadata.version` becomes `@VERSION@`.** This clause applies only to the
`metadata.version` field inside a `SKILL.md` frontmatter block in the runtime
signal. It does not replace every version-looking string in every file. The
raw tree and metadata signals retain the original bytes, so a version-only
change remains visible and a version in prose cannot be silently erased.

## Reporting a digest

State the algorithm, the clause version, and which signal it is. A bare hex
string is not readable evidence:

```
runtime  sha256/canon-v2  <digest>  (behaviour surface)
test     sha256/canon-v2  <digest>  (verification-only surface)
assets   sha256/canon-v2  <digest>  (bundled inputs)
metadata sha256/canon-v2  <digest>  (package records)
tree     sha256/canon-v2  <digest>  (raw package bytes)
versionNeutralTree sha256/canon-v2  <digest>  (version fields neutralised)
```

Under the claim labels, a digest comparison is at best scope-limited verified:
it settles that bytes moved, and never that the change was correct. A receipt
also never authenticates its producer; current bytes must be read again.

## Failure modes seen

| Symptom | Cause |
| --- | --- |
| Digest differs between CI and a laptop, no diff in `git status` | mtime or mode included (clause 3) |
| Digest differs only under a non-C locale | Locale collation instead of codepoint order (clause 1) |
| Version bump alone changes the content digest | Missing `@VERSION@` substitution (clause 4) |
| Two distinct trees share a digest | Missing NUL framing (clause 2) |
| Cache not invalidated after a real behaviour change | One digest doing three jobs |
| Receipt passes after a package byte changed | Receipt was not recomputed against current bytes |
| Installed package differs from native source | Non-deterministic path order or an unclassified file |
| A package follows a user-owned file | Symlink or path escape was accepted |

A check that did not run falls under [the missing-check rule](../SKILL.md#a-missing-check-is-not-a-pass). Identity proves byte
correspondence within the declared scope; it does not prove runtime support,
review quality, or provenance.

## Upstream reference

The role split and narrow runtime normalisation were adapted conceptually from
Skillstead `84a534376e26880651a6d2de2f646d876a5e7000`'s package and runtime
contracts. No Skillstead source code or license text is copied here; this file
records the local adaptation and its narrower package scope.

Digest computation uses the shipped Node runtime.
