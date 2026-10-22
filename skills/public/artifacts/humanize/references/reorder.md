# Move-only reordering

Load this reference only when the user explicitly selects reordering a named
artifact or bounded part of one. Reuse authorization already applicable to the
requested edit. A request to review order without editing returns findings
only. An ordinary Humanize request keeps its five genre modes; bloat removal
or content rewriting is a separate selected operation.

## Fix the order and unit boundary first

Read the selected artifact and its applicable instructions. State the user's
ordering principle and identify the list items, table rows, or sections to
move, including each unit's exact byte span and any headings, separators,
links, or attachments that must travel with it. Identify every mirrored copy
inside the authorized scope and map corresponding units across mirrors. Do
not infer a new ranking from topic, style, or model preference. If the order
principle or mirror scope is materially ambiguous after reading full context,
ask only about that fork before editing. Do not silently add another artifact.

## Move units without rewriting them

Record the before-order and a multiset of unit identities for each scoped
artifact: hash the exact bytes of each unit and record every duplicate's
multiplicity. A set is insufficient because it loses repeated identical units.
Apply one stable permutation based on the stated principle. Keep ties in their
original relative order unless the user specified a tie rule. Move the whole
unit byte-for-byte; do not edit its wording, punctuation, whitespace, IDs,
links, or membership. Use the corresponding permutation for each scoped
mirror, retaining that mirror's own byte-exact units. If a mirror's mapping is
uncertain, resolve its scope or stop that move rather than guess. If all units
already satisfy the requested order, return the artifact unchanged.

## Verify the selected result

Compare before and after for every scoped artifact. The ordered unit identities
must reflect the requested permutation, while the multiset and duplicate
multiplicities, exact unit bytes, and non-unit text remain identical. Confirm
that scoped mirrors express the same order and that unrelated files did not
change. If any identity, multiplicity, or mirror check fails, restore the
affected move and report the mismatch. Return the requested artifact in its
requested format; honor a body-only output request. Do not claim a successful
move from a shorter or cleaner-looking result alone.
