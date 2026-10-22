# Orchestration contract — the information cut

An executing sub-agent receives the carved prompt: the task shaped by the
brief, in the sense `briefs.md` describes. It does not receive the original
material the brief was carved from, and it does not receive the reasoning you
used to carve it.

## What "does not receive" excludes

Two things are withheld by design, not by oversight.

1. **The original.** If the task originated in something risky, sensitive, or
   too large to hand over whole — an unreviewed diff, an untrusted document, a
   sprawling investigation — the sub-agent gets the carved result of reading
   it, never the thing itself. Handing over the original alongside the carved
   prompt defeats the carving: whatever risk or noise the carving existed to
   strip is still present in full, and the sub-agent now carries it too.
2. **Your carve reasoning.** The sub-agent does not receive why you selected
   what you selected, what you chose to leave out, or what worried you when
   you drew the boundary. That reasoning belongs to the carver, not to the
   carved task, and it does not travel with the prompt.

## Why this is a constraint, not a style choice

The natural instinct when writing a brief is to over-explain — hand over the
source material "just in case," or narrate the judgment calls behind it, on
the theory that more context can only help. This contract says the opposite:
what the sub-agent receives defines a boundary, and a boundary is set by what
crosses it, not by what could.

A sub-agent handed the original alongside the carved prompt no longer has a
carved prompt — it has the original, plus a suggestion. It will read the
original, because reading what it is given is what an agent does, and every
risk the carving was meant to prevent returns intact.

## The paired contract: quality-verifier

This is one half of a matched pair. The other half lives in the
`quality-verifier` agent's contract: the verifier receives the artifact and
the original, but never the executor's reasoning for why the artifact is
correct. An executor's justification is exactly the kind of thing a verifier
exists to check independently — handing it over lets the verifier's judgment
anchor on the executor's claim, which is the failure mode verification exists
to prevent.

Read together, the two contracts draw one line from two sides: information
produced during a step does not cross that step's boundary in either
direction — not forward into the sub-agent that executes, and not forward
into the agent that checks the execution afterward.

## What this means when you write a brief

`briefs.md` already asks for the deliverable, the output shape, what is out
of scope, and what has already been established. None of those fields is "why
I decided this is the task" or "here is the raw material I read to arrive at
it." If your carving depended on reading something the sub-agent should not
see, carry the conclusion into the brief — not the source, and not the path
you took to reach it.
