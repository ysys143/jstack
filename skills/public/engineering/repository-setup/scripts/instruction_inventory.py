#!/usr/bin/env python3
"""Inventory repository instruction files without executing or changing them."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import stat
import sys
from collections import defaultdict
from pathlib import Path

SCHEMA_VERSION = 1
SKIP_DIRS = {
    ".git", ".hg", ".svn", ".venv", "venv", "node_modules", "__pycache__",
    ".cache", "cache", ".tox", ".mypy_cache", ".pytest_cache", "vendor",
}
CLAUDE_NAMES = {"CLAUDE.md", "CLAUDE.local.md"}
IMPORT_RE = re.compile(r"(?<!\S)@([^\s<>]+)")
LINK_RE = re.compile(r"(?<!!)\[[^\]]+\]\(([^)]+)\)")


def inside(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
        return True
    except ValueError:
        return False


def rel(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix() or "."


def applies_from(path: Path, root: Path, kind: str) -> Path:
    """Return the repository directory whose subtree the instruction governs."""
    if kind == "claude_rule":
        parts = path.relative_to(root).parts
        index = parts.index(".claude")
        return root.joinpath(*parts[:index])
    if path.name == "CLAUDE.md" and path.parent.name == ".claude":
        return path.parent.parent
    return path.parent


def scope_for(path: Path, target: Path, root: Path, kind: str) -> str:
    base = applies_from(path, root, kind)
    if base == target or inside(target, base):
        return "ancestor"
    if inside(base, target):
        return "target_descendant"
    return "unrelated"


def visible_markdown(text: str) -> str:
    """Remove fenced and inline code before recognizing directives and links."""
    lines, fence_char, fence_len = [], None, 0
    for line in text.splitlines():
        marker = re.match(r"^\s{0,3}(`{3,}|~{3,})", line)
        if marker and fence_char is None:
            fence_char, fence_len = marker.group(1)[0], len(marker.group(1))
            continue
        if marker and marker.group(1)[0] == fence_char and len(marker.group(1)) >= fence_len:
            fence_char, fence_len = None, 0
            continue
        if fence_char is None:
            lines.append(re.sub(r"(`+)[^`]*\1", "", line))
    return "\n".join(lines)


def walk(root: Path, exclusions: list[dict], findings: list[dict]):
    def walk_error(exc: OSError) -> None:
        failed = Path(exc.filename) if exc.filename else root
        shown = rel(failed, root) if inside(failed, root) else str(failed)
        findings.append({"kind": "directory_walk_error", "path": shown, "detail": str(exc)})

    for current, dirs, files in os.walk(root, followlinks=False, onerror=walk_error):
        here = Path(current)
        kept = []
        for name in sorted(dirs):
            path = here / name
            if name in SKIP_DIRS:
                exclusions.append({"path": rel(path, root), "reason": "embedded_or_cache_directory"})
            elif path.is_symlink():
                try:
                    resolved = path.resolve(strict=True)
                    if not inside(resolved, root):
                        reason = "symlink_escape"
                    elif resolved == here or inside(here, resolved):
                        reason = "symlink_cycle"
                    else:
                        reason = "symlink_directory_not_followed"
                except (OSError, RuntimeError):
                    reason = "symlink_cycle_or_broken"
                exclusions.append({"path": rel(path, root), "reason": reason})
                findings.append({"kind": reason, "path": rel(path, root)})
            else:
                kept.append(name)
        dirs[:] = kept
        for name in sorted(files):
            yield here / name


def is_claude_rule(path: Path, root: Path) -> bool:
    parts = path.relative_to(root).parts
    return any(parts[i:i + 2] == (".claude", "rules") for i in range(len(parts) - 1)) and path.suffix == ".md"


def candidate(path: Path, root: Path, host: str) -> tuple[bool, str]:
    if host == "claude":
        if path.name in CLAUDE_NAMES:
            return True, "claude_instruction"
        if is_claude_rule(path, root):
            return True, "claude_rule"
    elif path.name in {"AGENTS.md", "AGENTS.override.md"}:
        return True, "codex_instruction"
    return False, ""


def read_file(path: Path, root: Path, findings: list[dict]) -> tuple[str, str] | None:
    shown = rel(path, root)
    try:
        resolved = path.resolve(strict=True)
        if not inside(resolved, root):
            findings.append({"kind": "symlink_escape", "path": shown})
            return None
        if not stat.S_ISREG(resolved.stat().st_mode):
            findings.append({"kind": "non_regular_instruction", "path": shown})
            return None
        data = path.read_bytes()
        return data.decode("utf-8"), hashlib.sha256(data).hexdigest()
    except UnicodeDecodeError:
        findings.append({"kind": "non_utf8_instruction", "path": shown})
    except (OSError, RuntimeError) as exc:
        findings.append({"kind": "unreadable_instruction", "path": shown, "detail": str(exc)})
    return None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True, type=Path)
    parser.add_argument("--target", type=Path)
    parser.add_argument("--host", required=True, choices=("claude", "codex"))
    args = parser.parse_args(argv)

    root = args.root.resolve()
    target_arg = args.target if args.target is not None else root
    target = (target_arg if target_arg.is_absolute() else root / target_arg).resolve()
    if not root.is_dir() or not target.is_dir() or not inside(target, root):
        parser.error("--root and --target must be directories, and target must be under root")

    findings: list[dict] = []
    exclusions: list[dict] = []
    records: dict[Path, dict] = {}
    texts: dict[Path, str] = {}

    for path in walk(root, exclusions, findings):
        yes, kind = candidate(path, root, args.host)
        if not yes:
            continue
        loaded = read_file(path, root, findings)
        if loaded is None:
            continue
        text_value, digest = loaded
        file_scope = scope_for(path, target, root, kind)
        records[path] = {
            "path": rel(path, root), "kind": kind, "scope": file_scope,
            "discovered": True, "host_confirmed_loaded": False,
            "active": file_scope == "ancestor", "inactive_reason": (
                "on_demand_or_other_target" if file_scope == "target_descendant"
                else ("outside_target_chain" if file_scope == "unrelated" else None)
            ),
            "sha256": digest, "symlink": path.is_symlink(),
            "imported_by": [],
        }
        texts[path] = text_value

    if args.host == "codex":
        by_dir: dict[Path, dict[str, Path]] = defaultdict(dict)
        for path in records:
            by_dir[path.parent][path.name] = path
        for pair in by_dir.values():
            if "AGENTS.override.md" in pair and "AGENTS.md" in pair:
                override = pair["AGENTS.override.md"]
                if texts[override].strip():
                    normal = records[pair["AGENTS.md"]]
                    normal["active"] = False
                    normal["inactive_reason"] = "shadowed_by_AGENTS.override.md"
                else:
                    records[override]["active"] = False
                    records[override]["inactive_reason"] = "empty_override_falls_through"

    # Claude rules are discoverable, but applicability depends on host path/scoping rules.
    if args.host == "claude":
        for record in records.values():
            if record["kind"] == "claude_rule":
                record["active"] = False
                record["inactive_reason"] = "host_scope_confirmation_required"

    imports: list[dict] = []
    visiting: list[Path] = []
    visited: set[Path] = set()

    def visit(source: Path) -> None:
        try:
            source_id = source.resolve(strict=True)
        except (OSError, RuntimeError):
            return
        if source_id in visited:
            return
        visiting.append(source_id)
        for raw in IMPORT_RE.findall(visible_markdown(texts[source])):
            token = raw.rstrip(".,;:)")
            # Claude imports are file references. Do not turn @mentions into paths.
            if "/" not in token and not token.startswith(".") and not token.lower().endswith(".md"):
                continue
            edge = {"source": rel(source, root), "target": token}
            try:
                dest = (source.parent / token).resolve(strict=True)
            except FileNotFoundError:
                edge["status"] = "missing"
                findings.append({"kind": "missing_import", **edge})
                imports.append(edge)
                continue
            except (OSError, RuntimeError):
                edge["status"] = "unreadable"
                findings.append({"kind": "unreadable_import", **edge})
                imports.append(edge)
                continue
            if not inside(dest, root):
                edge["status"] = "outside_root"
                findings.append({"kind": "import_outside_root", **edge})
            elif not dest.is_file():
                edge["status"] = "missing"
                findings.append({"kind": "missing_import", **edge})
            elif dest in visiting:
                edge["status"] = "cycle"
                findings.append({"kind": "cyclic_import", **edge, "resolved": rel(dest, root)})
            else:
                edge["resolved"] = rel(dest, root)
                if dest not in texts:
                    loaded = read_file(dest, root, findings)
                    if loaded:
                        text_value, digest = loaded
                        texts[dest] = text_value
                        records[dest] = {
                            "path": rel(dest, root), "kind": "imported_markdown",
                            "scope": scope_for(dest, target, root, "imported_markdown"), "discovered": True,
                            "host_confirmed_loaded": False, "active": True,
                            "inactive_reason": None, "sha256": digest,
                            "symlink": dest.is_symlink(), "imported_by": [rel(source, root)],
                        }
                if dest in texts:
                    imported = records[dest]
                    imported["active"] = True
                    imported["inactive_reason"] = None
                    if rel(source, root) not in imported["imported_by"]:
                        imported["imported_by"].append(rel(source, root))
                    edge["status"] = "loaded"
                    visit(dest)
                else:
                    edge["status"] = "unreadable"
                    findings.append({"kind": "unreadable_import", **edge})
            imports.append(edge)
        visiting.pop()
        visited.add(source_id)

    if args.host == "claude":
        for path, record in list(records.items()):
            if record["active"]:
                visit(path)

    links: list[dict] = []
    for source, text_value in texts.items():
        for raw in LINK_RE.findall(visible_markdown(text_value)):
            pieces = raw.strip().split(maxsplit=1)
            if not pieces:
                continue
            token = pieces[0].strip("<>")
            if not token or token.startswith(("#", "http://", "https://", "mailto:")):
                continue
            if re.match(r"^[A-Za-z][A-Za-z0-9+.-]*:", token):
                continue
            clean = token.split("#", 1)[0]
            try:
                dest = (source.parent / clean).resolve(strict=True)
                status = "ok" if inside(dest, root) else "outside_root"
            except FileNotFoundError:
                status = "missing"
            except (OSError, RuntimeError):
                status = "unreadable"
            item = {"source": rel(source, root), "target": token, "status": status}
            links.append(item)
            if status != "ok":
                findings.append({"kind": "broken_local_link", **item})

    duplicate_lines: dict[str, set[str]] = defaultdict(set)
    for path, record in records.items():
        if not record["active"]:
            continue
        for line in visible_markdown(texts[path]).splitlines():
            line = " ".join(line.strip().split())
            if len(line) >= 20 and not line.startswith(("#", "|", "---")):
                duplicate_lines[line].add(record["path"])
    duplicates = [
        {"line": line, "files": sorted(paths), "classification": "candidate_exact_duplicate"}
        for line, paths in sorted(duplicate_lines.items()) if len(paths) > 1
    ]

    output = {
        "schema_version": SCHEMA_VERSION,
        "status": "findings" if findings else "clean",
        "root": str(root), "target": str(target),
        "host": args.host,
        "host_policy": {
            "loaded_state": "not_runtime_confirmed",
            "fallback_instruction_names": "unknown",
            "user_global_configuration": "unknown_and_not_read",
        },
        "files": sorted(records.values(), key=lambda item: item["path"]),
        "imports": imports, "links": links, "duplicates": duplicates,
        "findings": findings, "exclusions": sorted(exclusions, key=lambda item: item["path"]),
    }
    json.dump(output, sys.stdout, ensure_ascii=False, indent=2, sort_keys=True)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
