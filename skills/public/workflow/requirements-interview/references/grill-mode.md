# Grill mode — attack the assumptions

## Why a separate mode

An interview finds what is not settled. A grill tests what the user believes is
settled. The questions differ, and so does the end: an interview ends when every
item has an answer, a grill ends when every listed assumption has survived a
challenge or been changed.

## Find the assumptions

List them before the first challenge, each with where it came from:

1. The spec's `## Assumptions` section.
2. Assumptions implicit in the diff: a default value, a skipped error path, an
   unbounded loop, a hard-coded limit, a missing permission check.
3. Assumptions the user stated in the conversation ("users never upload more than
   one file", "this only runs at night").

Show the list in one message. Challenge the assumptions in order of cost if wrong,
using the hardest challenge for each.

## Challenge bank

Ask one per turn. Pick the challenge that is hardest for this assumption:

| Challenge | Use when |
|---|---|
| What breaks this? | Always first: name the input, load, or order that defeats it |
| What happens without it? | The assumption justifies a feature or a dependency |
| Who is harmed if it is wrong? | The failure is silent or lands on someone else |
| What evidence would change your mind? | The user holds it from experience, not data |
| What if the opposite were true? | A binary choice was made without comparison |
| What is the simplest version that is still worth having? | The scope grew while answering |

Do not soften a challenge into an option list unless concrete alternatives exist.
A challenge is not an accusation: cite the evidence that raised it.

## Outcome table

Set one outcome per assumption as its status in the spec's `## Assumptions`
section (the skill's Record section defines the line format):

| Outcome | Record |
|---|---|
| held | The assumption stays; write the reason that survived the challenge |
| changed | Write the new decision under `## Decisions` as `settled` |
| dropped | The assumption was not needed; list the code or scope that depended on it as follow-up. Do not edit code here |

## Ending

The grill continues until the user says stop, or every listed assumption has an
outcome. After 8 challenges, give the readiness report and ask whether to go on.
