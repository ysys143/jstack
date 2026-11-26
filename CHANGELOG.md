# Changelog

## [Unreleased]

## 0.0.2 — 2026-11-26

### Added

- The `reframe` workflow skill: teaches the expert words for what you are
  building, ranks 8 to 12 terms by how much each would change what gets built
  with one link-checked citation each, borrows terms from neighboring fields,
  and rewrites the request. Adapted from pstack (MIT); boundaries against
  `requirements-interview` and `plan` are explicit.
- The `stack-viewer` Claude Code mod: `/stack` opens a side pane that maps every
  component the session loads to the scope it comes from. It is imported unchanged
  from davila7/claude-code-templates (MIT) and loads through `hooks/claude-hooks.json`.
  Its upstream tests that need no engine harness run under Node in CI; all of them run
  in the engine harness at release.
- The build carries Claude Code function-hook modules from `hosts/claude/mods/` without
  compiling them. It refuses more than one module, a module that is not the entry point
  its mod declares, and modules in a hook file that Codex reads.
- `image-generation` has an optional openai path through the OpenAI CLI for controls
  the Codex path lacks, such as `xhigh` and `max` quality tiers or an exact size. Its
  images are billed to the API key rather than a subscription, so each run needs the
  user's approval of the model, quality, size, count, and an estimated cost.
- `research` gains an opt-in check for exhaustive and numeric requests:
  `coverage_matrix.js --needs FILE (--task ID | --req FILE)`. Typed information needs
  (`enumerate`, `count`, `compute` as an exact sum, `lookup`; `compare` and `judge` stay
  manual) bind to current requirement IDs and revisions from `jst task` (or to the
  current requirements file), check quotes against hash-checked source bytes and a
  declared line boundary, recompute sums with exact decimals, and require each item and
  value on its own report row. Missing or empty evidence, stale sources, revised or
  withdrawn requirements, changed constraints and an empty `--cover` set cannot pass,
  and a pass means mechanical consistency only. Adapted in idea from qera4mgln (MIT,
  see the research NOTICE). Without `--needs` the command is unchanged.
- `evals/regression/research-evidence-needs` is an added eval fixture for that check: an
  exhaustive list over a supplied log, a withdrawn amendment, and no whole-population
  claim. It is a case definition, not a measured quality result.
- Linux disk-manager status, explicit category scans and SQLite snapshot/history/diff
  with narrow XDG cache defaults, sequential one-filesystem du, shared collection
  locking, total deadlines and honest partial/unknown results.
- Opt-in systemd user timers alongside macOS launchd, with delayed first collection,
  no boot/catch-up scan, resource controls and no root/cron fallback.

### Changed

- `image-generation` treats nanobanana as a paid path too: each run needs the same
  approval as the openai path. The skill carries a dated price snapshot for all three
  paths and checks that it names the Gemini model the script calls.
- macOS `jst disk scan` output gains `schemaVersion` 2, `skipped`, `complete`,
  `enumerationComplete`, `elapsedMs` and `deadlineMs`; `totalChildren` is null
  when enumeration is incomplete, and an older scan cache is replaced by one fresh
  scan. A fresh scan now takes `snapshot.lock`, so it refuses to run beside a
  snapshot; cached reads take no lock. macOS scan still exits 0 for an incomplete
  result; only Linux exits 1.
- macOS `jst disk snapshot` output gains `runTimeoutSeconds`, null unless the
  profile sets a total collection deadline; without one, macOS keeps only the
  per-category `snapshotTimeoutSeconds` limit as before.

### Fixed

- `CAPABILITIES.md` counts the 35 public commands it lists; it said 36.
- The nanobanana path called a Gemini preview model that Google shut down on
  2026-06-25. It now calls `gemini-nano-banana-2.1` and no longer offers the `512px`
  size, which that model does not support.
- The nanobanana script wrote the API's JPEG bytes under a `.png` name. It now
  re-encodes the image to the format the output extension names. Before it sends the
  billed request, it rejects extensions other than `.png`, `.jpg`, `.jpeg`, and
  `.webp`, and a directory that does not exist.
- The nanobanana key lookup never read the working directory's `.env` and let the
  home file win, the reverse of what the skill said. It now takes the first key from
  the shell environment, the working directory's `.env`, then
  `~/.claude/.env.nanobanana`, and the probe reports the same source.
- Emoji write blocks now identify the support procedure with a JSON-quoted
  absolute path, including relocated installations and unrelated working
  directories, and name an existing file when the skill catalog is missing or
  malformed. The dispatcher prefilter now loads only the import-free emoji
  pattern module. The conditional support description no longer advertises native
  triggers; the user-request procedure and literal hook enforcement are unchanged.

## 0.0.1 — 2026-10-22

The first jstack release.

### Added

- One source tree that builds a single package for Claude Code and Codex: the
  `jstack` plugin and marketplace, skills called as `jstack:<skill>`
  (`/jstack:<command>` in Claude Code), and the `jst` command-line tool. User state
  lives in `~/.jstack` and project state in `.jstack/`; environment variables use
  the `JSTACK_` prefix.
- An MIT license for original jstack material. Imported material keeps its own
  terms, listed in `NOTICE.md` and in each owning directory.
- Attribution for `hwpx-document`, which started from the `hwpx-skill` plugin by
  stevechoi0222.
