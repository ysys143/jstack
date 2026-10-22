#!/usr/bin/env python3
"""Deterministic identity for one installed or native plugin package.

Conceptually adapted from Skillstead 84a534376e26880651a6d2de2f646d876a5e7000;
no upstream source or license text is copied into this helper.

The package is the input unit.  No Git metadata is required: an installed copy
must produce the same identity as its native source tree.  Digests deliberately
separate runtime, tests, assets, metadata, and the raw tree so a test-only or
version-only change cannot be mistaken for a behaviour change.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import stat
import sys
from pathlib import Path
from typing import Iterable

SCHEMA = "jstack.package-identity/v1"
ALGORITHM = "sha256/canon-v2"
ROLES = ("runtime", "test", "assets", "metadata")
TRANSIENT_DIRS = {".git", ".idea", ".cwf", ".gjc", ".omc", ".senpi", ".venv", ".jstack-artifacts", "__prompts", "uv-cache", "__pycache__", ".pytest_cache", ".ruff_cache", "node_modules"}
TRANSIENT_NAMES = {".DS_Store"}


class IdentityError(ValueError):
    """The package cannot be represented by the closed identity contract."""


def _inside(root: Path, child: Path) -> bool:
    try:
        child.relative_to(root)
    except ValueError:
        return False
    return True


def _framed_digest(entries: Iterable[tuple[str, bytes, int]]) -> bytes:
    framed = bytearray()
    for rel, data, mode in sorted(entries, key=lambda item: item[0]):
        framed.extend(rel.encode("utf-8"))
        framed.append(0)
        framed.extend(f"{mode:04o}".encode("ascii"))
        framed.append(0)
        framed.extend(hashlib.sha256(data).digest())
        framed.append(0)
    return hashlib.sha256(bytes(framed)).digest()


def _directory_payload(root: Path, directory: Path, seen: set[Path]) -> bytes:
    entries: list[tuple[str, bytes, int]] = []

    def visit(current: Path) -> None:
        try:
            scanned = sorted(os.scandir(current), key=lambda entry: entry.name)
        except OSError as exc:
            raise IdentityError(f"cannot read symlink target directory {current}: {exc}") from exc
        for entry in scanned:
            if entry.name in TRANSIENT_NAMES or entry.name.endswith((".pyc", ".pyo")):
                continue
            path = Path(entry.path)
            rel = path.relative_to(directory).as_posix()
            try:
                mode = entry.stat(follow_symlinks=False).st_mode
            except OSError as exc:
                raise IdentityError(f"cannot stat symlink target {rel}: {exc}") from exc
            if stat.S_ISLNK(mode):
                entries.append((rel, symlink_payload(root, path, seen), stat.S_IMODE(mode)))
            elif stat.S_ISDIR(mode):
                if entry.name in TRANSIENT_DIRS:
                    continue
                visit(path)
            elif stat.S_ISREG(mode):
                try:
                    entries.append((rel, path.read_bytes(), stat.S_IMODE(mode)))
                except OSError as exc:
                    raise IdentityError(f"cannot read symlink target {rel}: {exc}") from exc
            else:
                raise IdentityError(f"non-regular symlink target entry: {rel}")

    visit(directory)
    return b"directory\0" + _framed_digest(entries)


def symlink_payload(
    root: str | os.PathLike[str], link: str | os.PathLike[str], _seen: set[Path] | None = None
) -> bytes:
    """Validate an in-package relative link and return its canonical bytes.

    The link spelling is part of the payload as well as the current target
    bytes.  Thus retargeting a link to an identical file remains observable.
    Absolute, broken, and package-escaping links are rejected. Directory
    targets are represented by a deterministic digest of their current
    contents, including nested valid links.
    """
    root_path = Path(root).expanduser().resolve()
    link_path = Path(link)
    if not link_path.is_absolute():
        link_path = Path(os.path.abspath(link_path))
    if not link_path.is_symlink():
        raise IdentityError(f"not a symlink: {link_path}")
    try:
        target = os.readlink(link_path)
    except OSError as exc:
        raise IdentityError(f"cannot read symlink {link_path}: {exc}") from exc
    if os.path.isabs(target):
        raise IdentityError(f"absolute symlink is not allowed: {link_path}")
    resolved = (link_path.parent / target).resolve()
    if not _inside(root_path, resolved):
        raise IdentityError(f"symlink escapes package: {link_path}")
    if not resolved.is_file() and not resolved.is_dir():
        raise IdentityError(f"symlink target is missing or not a regular path: {link_path} -> {target}")
    seen = set(_seen or ())
    if resolved in seen:
        raise IdentityError(f"symlink target cycle: {link_path}")
    seen.add(resolved)
    if resolved.is_dir():
        target_bytes = _directory_payload(root_path, resolved, seen)
    else:
        try:
            target_bytes = resolved.read_bytes()
        except OSError as exc:
            raise IdentityError(f"cannot read symlink target {link_path}: {exc}") from exc
    return b"symlink\0" + target.encode("utf-8", errors="surrogateescape") + b"\0" + target_bytes


def _iter_files(root: Path) -> Iterable[tuple[str, Path, int]]:
    root = root.resolve()
    if not root.is_dir() or root.is_symlink():
        raise IdentityError(f"package root is not a real directory: {root}")
    found: list[tuple[str, Path, int]] = []

    def visit(directory: Path) -> None:
        try:
            entries = sorted(os.scandir(directory), key=lambda e: e.name)
        except OSError as exc:
            raise IdentityError(f"cannot read package directory {directory}: {exc}") from exc
        for entry in entries:
            path = Path(entry.path)
            rel = path.relative_to(root).as_posix()
            if entry.name in TRANSIENT_NAMES or entry.name.endswith((".pyc", ".pyo")):
                continue
            try:
                mode = entry.stat(follow_symlinks=False).st_mode
            except OSError as exc:
                raise IdentityError(f"cannot stat {rel}: {exc}") from exc
            if stat.S_ISLNK(mode):
                symlink_payload(root, path)
                found.append((rel, path, stat.S_IMODE(mode)))
                continue
            if stat.S_ISDIR(mode):
                # These real directories are outside the package inventory;
                # a symlink with the same name is still inspected below.
                if entry.name in TRANSIENT_DIRS:
                    continue
                visit(path)
                continue
            if not stat.S_ISREG(mode):
                raise IdentityError(f"non-regular package entry: {rel}")
            resolved = path.resolve()
            if not _inside(root, resolved):
                raise IdentityError(f"package path escapes root: {rel}")
            found.append((rel, path, stat.S_IMODE(mode)))

    visit(root)
    yield from sorted(found, key=lambda item: item[0])


def classify_path(rel: str) -> str:
    """Return the closed role used by all identity digests."""
    parts = rel.split("/")
    name = parts[-1]
    if (
        rel.startswith("tests/")
        or "/tests/" in rel
        or rel.startswith("evals/")
        or rel.startswith("contracts/")
    ):
        return "test"
    if rel.startswith("assets/") or "/assets/" in rel or rel.startswith("examples/"):
        return "assets"
    if (
        rel == "CHANGELOG.md"
        or rel == "README.md"
        or rel == "README.ko.md"
        or rel == "MIGRATION.md"
        or rel == "AGENTS.md"
        or name in {"plugin.json", "marketplace.json", "host-adapter.json"}
        or name in {"LICENSE", "NOTICE"}
        or name.startswith(("LICENSE.", "NOTICE."))
        or rel.startswith((".claude-plugin/", ".codex-plugin/"))
        or name in {"UPSTREAM.sha256", "package-surface.yaml"}
    ):
        return "metadata"
    return "runtime"


def _normalise_runtime(rel: str, data: bytes) -> bytes:
    """Normalise only frontmatter ``metadata.version`` in SKILL.md."""
    if not rel.endswith("SKILL.md"):
        return data
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return data
    # This is intentionally scoped to the frontmatter metadata mapping.  A
    # version mentioned in prose, JSON, a reference, or a test remains bytes.
    match = re.match(r"\A(---\r?\n.*?\r?\n---\r?\n)(.*)\Z", text, re.S)
    if not match:
        return data
    front, body = match.groups()
    front = re.sub(
        r"(^metadata:\r?\n(?:[ \t]+[^\r\n]*\r?\n)*?[ \t]+version:[ \t]*)[^\r\n]*",
        r"\1@VERSION@",
        front,
        count=1,
        flags=re.M,
    )
    return (front + body).encode("utf-8")


def _normalise_manifest(data: bytes) -> bytes:
    """Keep all manifest fields while neutralising only top-level version."""
    try:
        manifest = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise IdentityError(f"manifest is not valid JSON: {exc}") from exc
    if not isinstance(manifest, dict):
        raise IdentityError("manifest is not a JSON object")
    if "version" in manifest:
        manifest = dict(manifest)
        manifest["version"] = "@VERSION@"
    return json.dumps(manifest, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _version_neutral(rel: str, data: bytes) -> bytes:
    if rel in {".claude-plugin/plugin.json", ".codex-plugin/plugin.json", "plugin.json"}:
        return _normalise_manifest(data)
    return _normalise_runtime(rel, data)


def _digest(entries: Iterable[tuple[str, bytes]], modes: dict[str, int] | None = None) -> str:
    # NUL framing is unforgeable by a POSIX path.  The permission bits are
    # framed as well so removing executable mode changes the identity.
    framed_entries = [
        (rel, data, (modes or {}).get(rel, 0o644)) for rel, data in entries
    ]
    return hashlib.sha256(_framed_digest(framed_entries)).hexdigest()


def _manifest_identity(root: Path, files: dict[str, bytes]) -> tuple[str | None, str | None]:
    for rel in (".claude-plugin/plugin.json", ".codex-plugin/plugin.json", "plugin.json"):
        if rel not in files:
            continue
        try:
            manifest = json.loads(files[rel].decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise IdentityError(f"manifest is not valid JSON: {rel}: {exc}") from exc
        return manifest.get("name"), manifest.get("version")
    skill = files.get("SKILL.md")
    if skill is None:
        for rel, data in files.items():
            if rel.endswith("/SKILL.md"):
                skill = data
                break
    if skill is None:
        return root.name, None
    text = skill.decode("utf-8", errors="replace")
    name = re.search(r"^name:\s*([^\s#]+)", text, re.M)
    version = re.search(r"^\s+version:\s*([^\s#]+)", text, re.M)
    return (name.group(1) if name else root.name, version.group(1) if version else None)


def compute_identity(root: str | os.PathLike[str]) -> dict[str, object]:
    root_path = Path(root).expanduser().resolve()
    raw: dict[str, bytes] = {}
    modes: dict[str, int] = {}
    for rel, path, mode in _iter_files(root_path):
        modes[rel] = mode
        try:
            raw[rel] = symlink_payload(root_path, path) if path.is_symlink() else path.read_bytes()
        except OSError as exc:
            raise IdentityError(f"cannot read package file {rel}: {exc}") from exc
    name, version = _manifest_identity(root_path, raw)
    role_entries: dict[str, list[tuple[str, bytes]]] = {role: [] for role in ROLES}
    for rel, data in raw.items():
        role = classify_path(rel)
        role_entries[role].append((rel, _normalise_runtime(rel, data) if role == "runtime" else data))
    runtime_entries = list(role_entries["runtime"])
    runtime_modes = dict(modes)
    for manifest_rel in (".claude-plugin/plugin.json", ".codex-plugin/plugin.json", "plugin.json"):
        if manifest_rel in raw:
            synthetic_rel = f"@runtime-manifest/{manifest_rel}"
            runtime_entries.append((synthetic_rel, _normalise_manifest(raw[manifest_rel])))
            runtime_modes[synthetic_rel] = modes[manifest_rel]
    digests = {
        role: f"sha256:{_digest(entries, modes)}"
        for role, entries in role_entries.items()
    }
    digests["runtime"] = f"sha256:{_digest(runtime_entries, runtime_modes)}"
    digests["tree"] = f"sha256:{_digest(raw.items(), modes)}"
    neutral_entries = [(rel, _version_neutral(rel, data)) for rel, data in raw.items()]
    digests["versionNeutralTree"] = f"sha256:{_digest(neutral_entries, modes)}"
    return {
        "schema": SCHEMA,
        "algorithm": ALGORITHM,
        "package": {"name": name, "version": version},
        "digests": digests,
        "counts": {role: len(entries) for role, entries in role_entries.items()},
    }


def classify_change(before: dict[str, object], after: dict[str, object]) -> str:
    """Classify a pair of receipts without treating provenance as evidence.

    ``version-only`` is intentionally based on the package version changing
    while all behavioural roles remain byte-equivalent.  ``test-only`` means
    only the verification role changed.  Everything else that changes runtime
    bytes is runtime (or mixed when another role changed too).
    """
    before_digests = before.get("digests", {})
    after_digests = after.get("digests", {})
    if not isinstance(before_digests, dict) or not isinstance(after_digests, dict):
        return "invalid"
    changed = [role for role in (*ROLES, "tree") if before_digests.get(role) != after_digests.get(role)]
    before_package = before.get("package", {})
    after_package = after.get("package", {})
    if (
        isinstance(before_package, dict)
        and isinstance(after_package, dict)
        and before_package.get("name") == after_package.get("name")
        and before_package.get("version") != after_package.get("version")
        and before_digests.get("versionNeutralTree")
        and before_digests.get("versionNeutralTree") == after_digests.get("versionNeutralTree")
        and all(before_digests.get(role) == after_digests.get(role) for role in ("runtime", "test", "assets"))
    ):
        return "version-only"
    if not changed:
        return "unchanged"
    if changed == ["test", "tree"]:
        return "test-only"
    return "runtime" if "runtime" in changed else "mixed"


def verify_receipt(root: str | os.PathLike[str], receipt: str | os.PathLike[str] | dict) -> tuple[bool, list[str]]:
    """Verify a receipt against current bytes; no authenticity is inferred."""
    try:
        data = receipt if isinstance(receipt, dict) else json.loads(Path(receipt).read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        return False, [f"receipt unreadable: {exc}"]
    if not isinstance(data, dict):
        return False, ["receipt is not an object"]
    if "provenance" in data:
        return False, ["provenance is not an authenticity claim and is forbidden in identity receipts"]
    try:
        current = compute_identity(root)
    except IdentityError as exc:
        return False, [str(exc)]
    problems = []
    for key in ("schema", "algorithm", "package", "digests", "counts"):
        if data.get(key) != current.get(key):
            problems.append(f"receipt mismatch: {key}")
    return not problems, problems


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="compute or verify a package identity receipt")
    ap.add_argument("root")
    ap.add_argument("--receipt", help="verify this JSON receipt against current bytes")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args(argv)
    try:
        if args.receipt:
            ok, problems = verify_receipt(args.root, args.receipt)
            result = {"ok": ok, "root": str(Path(args.root).resolve()), "problems": problems}
            print(json.dumps(result, ensure_ascii=False, indent=1) if args.json else ("identity: pass" if ok else "identity: " + "; ".join(problems)))
            return 0 if ok else 1
        result = compute_identity(args.root)
    except IdentityError as exc:
        print(f"[UNRUNNABLE] {exc}", file=sys.stderr)
        return 2
    print(json.dumps(result, ensure_ascii=False, indent=1) if args.json else json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
