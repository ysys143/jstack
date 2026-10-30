# English AI-Tell Taxonomy v1.1 (machine layer)

Machine-readable rule layer for `humanize-en`. Mirrors the prose patterns in `SKILL.md` (IDs `EN-1`..`EN-24`,
where the number = the original SKILL.md pattern number), `EN-25`..`EN-31` **Abstract Metaphor Lexicon**, and
`EN-32`..`EN-42` ported from upstream `blader/humanizer` v2.9.1 (authority tropes, signposting, rhetorical
openers, hyphenated pairs, aphorism formulas, en dash / double hyphen, and five HOLISTIC structure/rhythm rules).
`EN-43`..`EN-45` are HOLISTIC rules for sentence-level crutches (mid-sentence colon, adverb propping a weak verb,
over-compression), adapted from a technical-writing checklist.
`scripts/prescan.js`·`reconcile.js`·`lint_taxonomy.js` parse the `class` / `surface` / `metric` fields below.

## Rule classes and runtime guarantee

- **ANCHORED** — a specific surface form triggers it. Carries a `- surface:` regex. `prescan.js` deterministically
  scans the input and emits **every occurrence** as a candidate; `reconcile.js` forces the rewriter to account for
  each one (fix or keep-with-evidence). English `\b` word boundaries make this precise.
- **COMPUTED** — a deterministic document metric. Carries `- metric: <name> <op> <number>` (available metrics:
  `sentence_len_stdev`, `em_dash_count`, `bullet_ratio`, `sentence_count`, `sentence_len_mean`, `char_count`).
- **HOLISTIC** — irreducibly LLM judgment (structure, variation). `- class: HOLISTIC` or no annotation.

Surface patterns compile as Python `re` (NFC text). `(?i)` prefix = case-insensitive.

---

## Content patterns

### EN-1. Significance / legacy / broader-trend inflation [S2]
- Puffs up importance via "represents/contributes to a broader" statements.
- class: ANCHORED
- surface: `(?i)\b(stands as|serves as|is a testament|a testament to|pivotal moment|evolving landscape|focal point|indelible mark|deeply rooted|marking a|represents a shift|key turning point|setting the stage for|reflects broader)\b`

### EN-2. Notability / media-coverage inflation [S2]
- Lists media outlets and follower counts without context.
- class: ANCHORED
- surface: `(?i)\b(independent coverage|(local|regional|national) media outlets?|active social media presence|written by a leading expert)\b`

### EN-3. Superficial "-ing" analyses [S2]
- Present-participle tails that add fake depth.
- class: ANCHORED
- surface: `(?i)\b(highlighting|underscoring|emphasizing|reflecting|symbolizing|showcasing|fostering|cultivating|encompassing|contributing to)\b`

### EN-4. Promotional / advertisement language [S2]
- class: ANCHORED
- surface: `(?i)\b(boasts a|vibrant|nestled|in the heart of|breathtaking|must-visit|stunning|renowned|groundbreaking|natural beauty|rich cultural heritage)\b`

### EN-5. Vague attributions / weasel words [S2]
- class: ANCHORED
- surface: `(?i)(industry reports|observers have (noted|cited)|experts (argue|believe)|some critics argue|several (sources|publications))`

### EN-6. Formulaic "Challenges / Future Prospects" section [S2]
- class: ANCHORED
- surface: `(?i)(faces (several |various )?challenges|despite these challenges|challenges and legacy|future outlook|despite its[^.]{0,40}challenges)`

### EN-7. Overused "AI vocabulary" words [S2]
- These co-occur far more in post-2023 text.
- class: ANCHORED
- surface: `(?i)\b(additionally|align with|crucial|delve|delving|enduring|enhance|garner|interplay|intricate|intricacies|pivotal|showcase|tapestry|testament|underscore|underscores|leverage|seamless|multifaceted|nuanced)\b`

### EN-8. Copula avoidance (avoiding is/are) [S2]
- class: ANCHORED
- surface: `(?i)\b(serves as|stands as|functions as|boasts|represents a|marks a)\b`

### EN-9. Negative parallelism [S2]
- "Not only… but…", "It's not just X, it's Y".
- class: ANCHORED
- surface: `(?i)(it'?s not (just|only|merely)\b|not only\b[^.]{0,60}?\bbut\b)`

### EN-10. Rule-of-three overuse [S2]
- Forced groups of three. Requires judgment.
- class: HOLISTIC

### EN-11. Elegant variation (synonym cycling) [S2]
- class: HOLISTIC

### EN-12. False ranges ("from X to Y") [S2]
- "from X to Y" where X,Y aren't a real scale. Too generic to anchor.
- class: HOLISTIC

## Language / style patterns

### EN-13. Em dash overuse [S3]
- Density phenomenon, not per-occurrence. Overuse = more than a couple per document.
- class: COMPUTED
- metric: em_dash_count > 3

### EN-14. Boldface overuse [S2]
- class: ANCHORED
- surface: `\*\*[^*\n]+\*\*`

### EN-15. Inline-header vertical lists [S2]
- Bullet items starting with a bolded header + colon.
- class: ANCHORED
- surface: `(?m)^\s*[-*]\s*\*\*[^*]+\*\*:`

### EN-16. Title case in headings [S3]
- class: HOLISTIC

### EN-17. Emojis [S1]
- class: ANCHORED
- surface: `[\U0001F300-\U0001FAFF\U00002600-\U000027BF\U0001F000-\U0001F0FF\U00002190-\U000021FF\U00002B00-\U00002BFF]`

### EN-18. Curly quotation marks [S2]
- class: ANCHORED
- surface: `[“”‘’]`

## Communication patterns

### EN-19. Collaborative / chatbot artifacts [S1]
- class: ANCHORED
- surface: `(?i)(i hope this helps|of course!|certainly!|you'?re absolutely right|would you like|want me to|should i continue|let me know if|here is (a|an)\b)`

### EN-20. Knowledge-cutoff disclaimers and speculative gap-filling [S1]
- Also covers gap-filling filler for a subject with no sources (the guess lands on stock phrases).
- class: ANCHORED
- surface: `(?i)(as of my last|up to my last training|while specific details (are|remain) (limited|scarce)|based on available information|not publicly available|maintains a low profile|keeps personal details private|prefers to stay out of the spotlight)`

### EN-21. Sycophantic / servile tone [S2]
- class: ANCHORED
- surface: `(?i)(great question|excellent point|that'?s an? (great|excellent|fantastic))`

## Filler and hedging

### EN-22. Filler phrases [S2]
- class: ANCHORED
- surface: `(?i)(in order to\b|due to the fact that|at this point in time|in the event that|has the ability to|it is important to note that)`

### EN-23. Excessive hedging [S2]
- class: ANCHORED
- surface: `(?i)(could potentially|it could be argued that|might (possibly|have some)|possibly be argued)`

### EN-24. Generic positive conclusions [S2]
- class: ANCHORED
- surface: `(?i)(the future looks bright|exciting times (lie |are )ahead|step in the right direction|journey toward excellence)`

---

## EN-25..EN-31. Abstract Metaphor Lexicon

Concrete-word slots covered by an all-purpose metaphor (the English counterpart of the Korean taxonomy's category L,
from the `benelog` guideline). Each keeps legitimate physical/idiomatic uses.

### EN-25. "heavy / lightweight" abstract [S2]
- Multi-axis property (memory/latency/size) collapsed into one adjective.
- Fix: name the axis — "high inference latency", "uses 40GB of memory".
- class: ANCHORED
- surface: `(?i)\b(heavy|heavyweight|lightweight)\b`
- Keep: literal physical weight.

### EN-26. "lever / linchpin / handle" abstract [S2]
- Control/setting dressed up as a physical handle.
- Fix: state what is adjusted and how.
- class: ANCHORED
- surface: `(?i)\b(the lever|the linchpin|the knob|a lever for|the handle)\b`
- Keep: literal physical lever/handle.

### EN-27. "lens / axis" abstract [S2]
- Criterion/cause hidden behind "through the lens of" / "along the axis of".
- Fix: "by the criterion of", "the cause".
- class: ANCHORED
- surface: `(?i)(through the lens of|the lens of|along the axis of|on the axis of)`
- Keep: real optical lens, real 2D/graph axis.

### EN-28. "boils down to / in essence" abstract [S2]
- Vague summarizing metaphor.
- Fix: state the conclusion directly.
- class: ANCHORED
- surface: `(?i)(boils down to|in essence|at its core|when you get down to it)`
- Keep: literal boiling.

### EN-29. "fabric / tapestry / woven" abstract [S2]
- Relationship dressed as textile.
- Fix: name the actual relation.
- class: ANCHORED
- surface: `(?i)(the fabric of|woven into|a tapestry of|threads? through)`
- Keep: literal cloth/textile.

### EN-30. "delicate balance / double-edged sword" abstract [S2]
- Cliché tension metaphors.
- Fix: state the specific trade-off.
- class: ANCHORED
- surface: `(?i)(a delicate balance|strikes? a balance|double-edged sword|walks? a fine line)`
- Keep: literal balance/scales.

### EN-31. "intersection / landscape / heart of" abstract [S2]
- Spatial metaphors for position/scope.
- Fix: name the fields or the actual center.
- class: ANCHORED
- surface: `(?i)(at the intersection of|navigate the landscape|navigating the landscape|sits at the heart of|lies at the heart of)`
- Keep: literal geographic intersection/landscape.

---

## EN-32..EN-42. Upstream v2.9.1 patterns

Ported from `blader/humanizer` v2.9.1. EN-32..EN-37 are ANCHORED (surface-triggered); EN-38..EN-42 are
irreducibly HOLISTIC (structure/rhythm, no reliable surface form).

### EN-32. Persuasive authority tropes [S2]
- Ceremony phrases that pretend to cut to a deeper truth before restating an ordinary point.
- Fix: drop the throat-clearing; state the point.
- class: ANCHORED
- surface: `(?i)(the real question is|what really matters|the deeper issue|the heart of the matter|in reality\b|fundamentally,)`

### EN-33. Signposting and announcements [S2]
- Announcing what the text will do instead of doing it (tutorial-script feel).
- Fix: delete the announcement; deliver the content.
- class: ANCHORED
- surface: `(?i)(let'?s (dive in|dive into|explore|break (this|it) down|look at)|here'?s what you need to know|without further ado|now let'?s look at)`

### EN-34. Conversational rhetorical openers [S2]
- Fake-candid hooks that manufacture intimacy before a routine claim.
- Fix: just say the thing.
- class: ANCHORED
- surface: `(?i)(here'?s the thing|the thing is,|let'?s be honest|real talk\b|honestly\?)`
- Keep: "honestly" / "look" used mid-sentence (not as a standalone theatrical opener).

### EN-35. Hyphenated word pair overuse (predicate position) [S2]
- Uniform hyphenation of compound modifiers even after the noun (`the report is high-quality`).
- Fix: drop the hyphen in predicate position; keep attributive-position hyphens (`a high-quality report`).
- class: ANCHORED
- surface: `(?i)\b(is|are|was|were|be|been|being|seems?|remains?|stays?) (third-party|cross-functional|client-facing|data-driven|decision-making|well-known|high-quality|real-time|long-term|end-to-end)\b`
- Keep: attributive position (immediately before the noun it modifies).

### EN-36. Aphorism formulas [S2]
- Ordinary claims dressed as reusable aphorisms that sound profound without adding precision.
- Fix: replace the formula with the concrete claim it gestures at.
- class: ANCHORED
- surface: `(?i)(the language of|the currency of|the architecture of|becomes a trap)`

### EN-37. En dash and double hyphen [S2]
- Companion to EN-13 (em dash density). En dashes (–) and spaced double hyphens ( -- ) are the same tell.
- Fix: replace with a period, comma, or parentheses; restructure if needed. Do not substitute a mid-sentence colon (EN-43).
- class: ANCHORED
- surface: `–|\s--\s`
- Keep: en dash inside a genuine numeric range (e.g. 1990–2000) — mark as kept with the range as evidence.

### EN-38. Negative parallelism tail / tailing negations [S2]
- Clipped tailing-negation fragments tacked on ("…, no guessing", "…, no wasted motion").
- Fix: write the negation as a real clause. Requires judgment — too generic to anchor.
- class: HOLISTIC

### EN-39. Passive voice and subjectless fragments [S2]
- Hidden actor or dropped subject ("No configuration file needed", "The results are preserved automatically").
- Fix: use active voice / name the actor when it makes the sentence clearer.
- class: HOLISTIC

### EN-40. Fragmented headers [S3]
- A heading followed by a one-line paragraph that just restates the heading before real content.
- Fix: delete the warm-up sentence.
- class: HOLISTIC

### EN-41. Diff-anchored writing [S2]
- Prose narrating a change instead of describing the thing as it is (outside version-scoped docs).
- Fix: describe the current state; drop "was added to replace…" framing.
- class: HOLISTIC

### EN-42. Manufactured punchlines and staccato drama [S2]
- A run of short declarative fragments engineered to manufacture drama.
- Fix: merge into normal clauses; keep at most one short sentence for emphasis.
- class: HOLISTIC

### EN-43. Colon as a mid-sentence connector [S2]
- A colon used as a connector inside a sentence, standing in for a verb, "because", or a comparison
  ("If you come from classic automation: you describe conditions instead of registering handlers").
- Fix: write one sentence that states the relation. A colon before a list, a quotation, or an example is fine.
- class: HOLISTIC

### EN-44. Adverb propping a weak verb [S2]
- An adverb that carries the claim the verb should carry ("runs quickly", "significantly improves").
- Fix: use a stronger verb, or state the measured value. Keep an adverb that adds a fact the source supplies.
- class: HOLISTIC

### EN-45. Over-compression [S2]
- Dropped articles, verbless fragments, arrows, symbol shorthand, or abbreviations that make the reader decode
  ("Parser rejects bad date → exit 2, no write").
- Fix: write whole sentences with articles and verbs, and spell out arrows. Keep terse text when the genre
  requires it (commit subjects, changelog lines, table cells, UI strings).
- class: HOLISTIC

---

## Detection output contract (Detector → Rewriter)

Same contract as `references/ai-tell-taxonomy.md` v2.0: every ANCHORED candidate from
`02_candidates.json` must be consumed as a `findings[]` entry (with `candidate_id`) or a `kept[]` entry
(with a verifiable `evidence` token). `meta.taxonomy_hash` echoes the candidates stamp. `reconcile.js` enforces:
(1) hash agreement across taxonomy/candidates/detection, (2) all ANCHORED candidates accounted for,
(3) each triggered COMPUTED rule has a matching finding.

## Version

- **v1.2** (2026-10-30): added EN-43..EN-45 (HOLISTIC: mid-sentence colon, adverb propping a weak verb,
  over-compression). EN-37's fix no longer offers a colon.
- **v1.1** (2026-07-28): ported upstream `blader/humanizer` v2.9.1 patterns. Added EN-32..EN-37 (ANCHORED:
  authority tropes, signposting, rhetorical openers, predicate-position hyphenated pairs, aphorism formulas,
  en dash / double hyphen) and EN-38..EN-42 (HOLISTIC: tailing negations, passive voice, fragmented headers,
  diff-anchored writing, staccato drama). Enhanced EN-19 (new closers) and EN-20 (speculative gap-filling).
- **v1.0** (2026-07-13): initial machine layer for humanize-en. EN-1..EN-24 from SKILL.md patterns +
  EN-25..EN-31 Abstract Metaphor Lexicon. Guarantee scripts shared with the Korean modes (single copy under scripts/).
- Extension: add sub-rules append-only; ANCHORED needs `surface`, COMPUTED needs `metric` (lint enforces).
