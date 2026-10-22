# Layers — sizing, and what each one breaks when misused

## Sizing

| Layer | Practical size | Signal that it is too big |
| --- | --- | --- |
| Description | One sentence plus two or three trigger phrases, at most 100 display columns | It explains how to do the work, or runs past the column limit |
| SKILL.md | Roughly one screen of judgement | It contains a table nobody reads inline |
| A reference file | One subject, read start to finish | It has sections belonging to different decisions |
| A script | One deterministic job | It asks the caller to make a choice |

The description is the one layer the host lists to the model, and all listed
descriptions share a budget of about 1% of the context window. Its limit is
counted in display columns (a Korean character counts 2). Only the single most
confusable neighbour boundary goes in it; every other boundary goes in SKILL.md.

## What each misuse costs

| Misuse | Cost |
| --- | --- |
| Procedure in the description | Paid on every turn of every session, used almost never |
| Reference material inline in SKILL.md | The skill fires and dumps a taxonomy the reader did not ask for |
| Judgement pushed into a reference | The reader decides before reaching the file, so the judgement never applies |
| Determinism left in prose | The model re-derives it each time and gets it slightly different each time |

The middle two are the common ones, and they push in opposite directions:
material moves down a layer to save context, and judgement moves up because it
must be seen before the decision. Ask which side of the decision the text is on.

## What belongs in a script

A rule belongs in `scripts/` when the answer does not depend on the situation —
counting, formatting, checking a shape, comparing two files. Anything a script
can settle should not be a paragraph asking the model to settle it, because
prose gets a slightly different answer each time it is read.

The inverse also holds: a script that has to ask "which convention applies here?"
is encoding judgement, and judgement belongs in SKILL.md where the reader can
see it.

## Reference files are read whole

A reference is loaded because SKILL.md named it, and then it is read from the
top. So it holds one subject, and the whole file is relevant to the decision
that pulled it in. Two subjects in one file means half of it is always noise.

Name it after the decision it serves, not after its format — `layers.md` because
the reader arrived asking which layer, not `tables.md`.
