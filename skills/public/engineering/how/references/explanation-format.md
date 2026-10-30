# Explanation format

Use this layout for a full answer to a large question. A small question gets the
smallest complete answer from step 4 of `SKILL.md`, which is just the overview.
Drop every section that does not apply; do not fill one to keep the shape.

## Overview

One or two paragraphs: what this is, what it does, and why it exists. A reader
who stops here should know whether the rest is for them.

## Key concepts

The types, services, or abstractions needed to follow what comes next. Short
definitions, in the order the explanation needs them.
Define a term before the first sentence that uses it.

## How it works

The longest section. Follow the flow: what triggers it, what happens in order,
where the data goes, and where the decisions are. Write prose, and name the files
and functions the reader should open. Quote a snippet only when one line carries
the point.

When three or more components talk to each other, or data changes through
stages, draw it as a series. First the two parts that start the flow. Then the
same picture with the next part added. Then the return path or the next stage.
Each picture is the previous one plus one part.

## Where things live

A short map of the files and directories someone needs to start working here, and
nothing else.

## Gotchas

Behavior that surprises, history that explains an odd choice, and traps. Leave the
section out when there is nothing to warn about.

## Voice

- Plain sentences with the actual names in them.
- Keep one name for each concept from the first mention to the last.
- Say how sure you are once, where it matters, not on every line.
- Do not print framing labels such as "key insight", "the important part", or
  "TL;DR".
- If the readers flagged open questions or untraced paths, list them where they
  affect the reader's next step.
