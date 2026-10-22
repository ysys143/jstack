# Changelog

## [Unreleased]

### Added

- The `stack-viewer` Claude Code mod: `/stack` opens a side pane that maps every
  component the session loads to the scope it comes from. It is imported unchanged
  from davila7/claude-code-templates (MIT) and loads through `hooks/claude-hooks.json`.
  Its upstream tests that need no engine harness run under Node in CI; all of them run
  in the engine harness at release.
- The build carries Claude Code function-hook modules from `hosts/claude/mods/` without
  compiling them. It refuses more than one module, a module that is not the entry point
  its mod declares, and modules in a hook file that Codex reads.

### Fixed

- `CAPABILITIES.md` counts the 35 public commands it lists; it said 36.

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
