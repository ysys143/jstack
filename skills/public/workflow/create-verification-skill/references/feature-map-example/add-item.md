# Add an item

A user adds a named item with a quantity from the browser or the CLI, can cancel
an unfinished draft, and can confirm the saved item from a second view.

## Sub-features

- `add-open` opens an empty form from each browser entry point.
- `add-save` stores a name and a quantity.
- `add-cancel` throws away an unfinished browser draft.
- `add-cli` creates an item of the same shape from a terminal.

## How to get to it (user POV)

- Choose the `Add item` button in the browser header.
- Press `a` in the browser while focus is outside a text field.
- Run `pantry add <name> --qty <n>` in a terminal.

## Driving it with drive-pantry

Preconditions:

- Pantry answers at `http://127.0.0.1:5180`.
- No item is named `Flour`.
- `drive-pantry doctor` reports the expected URL and the disposable data directory.

- **Open the form.** Choose `Add item`: `drive-pantry browser click --role button --name "Add item"`. A form named `New item` appears with focus in the `Name` field.
- **Fill it.** `drive-pantry browser fill --role textbox --name "Name" --value "Flour"` then `drive-pantry browser fill --role spinbutton --name "Quantity" --value "2"`. The `Save` button becomes enabled.
- **Save.** `drive-pantry browser click --role button --name "Save"`. A status named `Item saved` appears and the list shows `Flour`.
- **Confirm persistence.** Reload the page: `drive-pantry browser reload`. `Flour` is still listed with quantity 2.
- **Cancel a draft.** Open the form, type `Scratch`, and choose `Cancel`: `drive-pantry browser click --role button --name "Cancel"`. The list has no `Scratch` row.
- **CLI entry.** `drive-pantry cli -- pantry add "Salt" --qty 1 --format json`. Exit code `0`, and stdout holds the new item's ID and name.
- **Proof.** `drive-pantry browser snapshot --aria --path artifacts/add-item/list.aria.txt` and `drive-pantry browser screenshot --path artifacts/add-item/list.png`. Both show `Flour` and `Salt`.

## Gotchas

- Pressing `a` while a text field has focus types the letter and opens nothing.
- Names are trimmed on save. Assert the displayed name, not the text you typed.
- The `Item saved` status alone is not proof. Reload and read the list.
- Remove `Flour` and `Salt` during fixture cleanup, and keep their proof files.
