# Find an item

A user looks an item up by name, opens a hit, and can tell an empty result from a
search that failed.

## Sub-features

- `find-open` opens the search box from every browser entry point.
- `find-hit` lists items whose name contains the query and changes no data.
- `find-open-hit` opens a result in the item view.
- `find-miss` shows a clear empty state for a query with no match.
- `find-clear` removes the query and restores the full list.
- `find-cli` returns the same hits from a terminal.

## How to get to it (user POV)

- Choose the `Search` field in the browser header.
- Press `/` in the browser while focus is outside a text field.
- Run `pantry find <query>` in a terminal.

## Driving it with drive-pantry

Preconditions:

- Pantry answers at `http://127.0.0.1:5180` and holds the seeded `Rice` and `Olive oil`.
- `drive-pantry doctor` reports the expected URL and the disposable data directory.

- **Header entry.** `drive-pantry browser click --role searchbox --name "Search"`. The field takes focus.
- **Keyboard entry.** Click the page body, then `drive-pantry browser press --key "/"`. The same field takes focus and no slash is typed.
- **Hit.** `drive-pantry browser fill --role searchbox --name "Search" --value "oli"`. The `Results` list shows `Olive oil` and not `Rice`.
- **Open a hit.** `drive-pantry browser click --role link --name "Olive oil"`. The item heading reads `Olive oil`.
- **Miss.** Search for `saffron`: `drive-pantry browser fill --role searchbox --name "Search" --value "saffron"`. A status named `No items match` appears once the search settles.
- **Clear.** `drive-pantry browser click --role button --name "Clear search"`. The field is empty and the full list returns.
- **CLI hit.** `drive-pantry cli -- pantry find "oli" --format json`. Exit code `0`, and stdout is a list with one object named `Olive oil`.
- **CLI miss.** `drive-pantry cli -- pantry find "saffron" --format json`. Exit code `0`, and stdout is `[]`.
- **Proof.** `drive-pantry browser snapshot --aria --path artifacts/find-item/hit.aria.txt` and `drive-pantry browser screenshot --path artifacts/find-item/hit.png`. Both show the query and `Olive oil`.

## Gotchas

- Pressing `/` inside the search field or a form types a slash instead of focusing search.
- Results arrive after a short delay. Wait for the list or the empty status, never a fixed sleep.
- Items marked used up are hidden unless `Show used up` is on.
- The CLI prints a table by default. Add `--format json` for assertions that stay stable.
- Opening a hit changes the page. Search again before you check the next query.
