# Shared local work-report core

`runtime/work_report.js` is a destination-independent library and CLI. It is
not a public skill and it does not route ordinary requests. A workflow may call
it when the workflow needs a period report from local records; the workflow
that called it keeps ownership of the request and completion decision.

## Interface

- `periodFor('daily' | 'weekly' | 'range', date, since?, until?)` resolves an
  explicit period and rejects reversed dates.
- `collectRecords(period, options)` reads the selected local Git/filesystem
  roots and an optional session export. Missing sources become warnings or a
  clear collection error; they never become a claim that no work occurred.
- `writeBundle(collection, directory)` writes a private, recoverable bundle:
  `evidence.jsonl`, `manifest.json`, `report.md`, and `prompt.md`.

The CLI accepts `--period`, `--date`, `--since`, `--until`, `--output`,
`--projects-root`, `--session-root`, and `--json`. It never publishes remotely.
Publication, account selection, semantic field mapping, and receipts belong to
the selected destination adapter. Evidence IDs and the local manifest are the
handoff boundary.

The existing `wrapup` workflow is one convenient daily/weekly/custom-period
surface for this core. Any selected workflow may call it directly when a local
period report is useful; Google Workspace, email, office, and future adapters
can consume the same bundle without activating `wrapup` or changing the core's meaning.
