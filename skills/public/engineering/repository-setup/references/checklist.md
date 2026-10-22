# What to read, in order, and what it implies

## The reading order

| Read | It tells you | If absent |
| --- | --- | --- |
| The conventions file | What the project says about itself | The conventions are implicit; read the code instead of assuming there are none |
| Test layout and the command that runs them | Where verification lives, and whether it works today | Ask before adding a framework — the choice is not yours |
| Lint and format configuration | The style that is already enforced | Match the existing code rather than importing a default |
| Recent commit messages | The granularity and the voice expected | Follow the shape of the last twenty, not a standard you prefer |
| CI configuration | What is actually required to pass | Local checks are the only gate; say so |

Read the conventions file first and the CI last: the first says what the project
believes about itself, the last says what it actually enforces. Where they
disagree, report the disagreement rather than picking a side — it is usually
news to somebody.

## Findings worth reporting even when nothing is changed

- **The stated convention and the code disagree.** Someone should decide which
  one is wrong; it is not a setup decision.
- **The test command fails on a clean checkout.** Every later "the tests pass"
  is unverifiable until this is settled.
- **Two tools enforce contradictory formatting.** Whichever runs last wins, and
  the diff churns forever.
- **A checked-in file contains a credential.** Stop and hand it to the `secrets`
  skill; do not fix it as part of a setup pass.

## What is never part of setup

Installing anything on the machine, writing to the user's home directory, and
changing remote state — pushing, creating branches upstream, altering CI — are
outside a setup pass even when they would obviously help. Each of them changes
something the user maintains, and none of them is undone by a `git checkout`.
