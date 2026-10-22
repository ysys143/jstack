# Font delivery protocol: identity and delivery are separate dimensions

This document defines the protocol enforced by `scripts/subset_fonts.py`.

## Keep the two dimensions separate

Upstream combined **which font** and **how it is shipped** in one
`font-delivery-v1.yaml`. Conflating them lets "rendered with Malgun Gothic" pass as
"the font was delivered", even when a recipient lacking that font sees different output.

| Dimension | Values | Meaning |
|---|---|---|
| **Identity (SSoT)** | `Geist`, `Apple SD Gothic Neo`, `Noto Sans KR`, `Noto Sans Mono CJK KR` | The **intended** typeface |
| **Delivery** | `embedded`, `portable`, `system` | Whether the recipient **actually gets that typeface** |

## Delivery grades: `system` is not acceptance evidence

| Grade | Meaning | Valid acceptance evidence? |
|---|---|---|
| `embedded` | Subset bytes are inside the artifact (PDF/HWPX embedding) | **Yes** |
| `portable` | The package includes font files (repository `fonts/`) | **Yes**, provided the recipient installs them |
| `system` | Uses fonts installed on the rendering machine | **No.** `grade: environment-dependent` |

A screenshot rendered at `system` grade establishes only how it looked on our machine,
not how the submission will render. Procurement submissions require `embedded`.

**Grades are essential to this dimension.** Merely separating dimensions without
grades still lets system-font rendering pass as acceptance evidence, which was the
actual upstream state.

## OFL subsetting creates a Modified Version

Under SIL Open Font License 1.1, **a file with glyphs removed is a Modified Version**.
The Reserved Font Name clause prohibits a Modified Version from retaining the
reserved original name. Creating `NotoSansKR-Regular.subset.otf` while retaining
`Noto Sans KR` internally therefore **violates the license**.

Apply all three requirements:

1. **Enforce an alias**: rewrite family/subfamily entries in the subset's `name`
   table to a local alias such as `jstack Sans KR`, using `subset_fonts.py --alias`.
2. **Record `identity_rewrite`**: write the original-name-to-alias mapping in
   `fonts.manifest.json` beside the output. Losing provenance forces the next user
   to investigate the license again.
3. **Preserve legal notices**: **do not remove** `copyright`, `license`, or
   `licenseURL` name records. RFN requires changing the name, not the notices.

**Listing cases does not enforce the protocol.** Upstream stopped at cataloging
individual RFN cases. Our script enforces the alias and fails if it cannot do so.

## Tool pins and runtime comparison

Changing subset tools changes output bytes. If arbitrary changed bytes become
accepted artifacts, **any executable can produce an accepted artifact**.

| Tool | Pin | Reason |
|---|---|---|
| `fonttools` | `4.53.1` | Subset output bytes differ across versions |
| `brotli` | `1.1.0` | WOFF2 compressor; different versions change hashes |

Do not merely **declare** pins. `subset_fonts.py` reads `fontTools.version` at runtime,
compares it with the pin, and refuses to proceed on mismatch without `--allow-version-drift`.

## Failure policy: fail closed in both cases

| Situation | Action | Exit code |
|---|---|---|
| `on_tool_missing`: fontTools is absent | **Stop without subsetting.** Do not fall back to embedding the original font | `2` plus installation guidance |
| `on_glyph_missing`: the source lacks required glyphs | **Stop.** Do not emit missing-glyph boxes | `1` plus missing-glyph list |

A fallback would make successful subsetting indistinguishable by exit code from
embedding the entire original. A 4–16MB font file can exceed procurement submission
size limits.

## Limitations

- **This protocol does not enforce embedding itself.** No checker opens PDF/HWPX to
  verify embedded fonts. `subset_fonts.py` only produces subsets.
- **Grades are self-reported.** No machine determines whether an artifact is `system`
  or `embedded`; a person records it in the report.
- Pin checks cover only `fontTools` and `brotli`. Font-file hashes are outside this
  protocol. Changed font files can yield different glyphs under the same alias.
