# Changelog

## [Unreleased]

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
