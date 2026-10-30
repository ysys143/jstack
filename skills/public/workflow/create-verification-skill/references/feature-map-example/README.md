# Pantry verification map

This folder is the maintained source for checking what a user of Pantry can do.
Read this index before you drive the app, then follow the file for the feature
you are checking. Pantry is an invented example: replace every name, port, and
command with what your repository really has.

## Baseline preconditions

- Launch Pantry on `http://127.0.0.1:5180` with a disposable data directory.
- Set `PANTRY_DATA_DIR=$SCRATCH/pantry-$RUN_ID` so parallel runs never share state.
- Seed two items: `Rice` (quantity 3) and `Olive oil` (quantity 1).
- Put the `drive-pantry` harness and the `pantry` CLI on `PATH`.
- Run `drive-pantry doctor` and require the expected URL, data directory, and
  build revision before the first action.
- Never drive an instance that this verification run did not start.

## Driving conventions

- Begin each recipe from the baseline state unless its preconditions say otherwise.
- Choose targets by accessible role and name, not by CSS selector or position.
- Treat every command as literal: keep quoted names and flags unchanged.
- Run browser actions through `drive-pantry browser` and terminal actions through
  `drive-pantry cli -- <command>`.
- Put the data back to the baseline after a mutation. Cleanup never deletes proof
  artifacts.

## Proof and skip reporting

- Capture the user's action and the state after it, not only the final screen.
- Browser proof is an accessibility snapshot plus a screenshot that shows the
  app's name.
- CLI proof is the command, stdout, stderr, and exit code.
- Proof of a change adds a second, read-only view of the stored value.
- Label every artifact with the feature ID and the entry point used.
- Report an unreachable path with the command you tried and the precondition that
  was not met.
- Never report a skipped entry point as verified through a different one.

## Feature entry contract

Each feature file opens with a title and one paragraph on the behavior a user can
see. Four sections follow, in this order and with these headings.

1. `Sub-features`: a short ID and one line for each behavior.
2. `How to get to it (user POV)`: every entry point a user has.
3. `Driving it with <harness>`: a `Preconditions:` list, then labeled steps that
   pair each user action with an exact command and the result you can observe.
4. `Gotchas`: traps that waste a run or invalidate it.

Leave implementation detail out. Name only user paths, stable handles, required
state, commands, and observable proof.

## Features

- [Add an item](./add-item.md): browser and CLI creation, cancelling a draft, and
  confirming that the item persisted.
- [Find an item](./find-item.md): toolbar, keyboard, and CLI lookup with a hit, a
  miss, and a cleared query.
