"""Shared, host-independent migration primitives. No implicit profile discovery."""

from pathlib import Path
import hashlib
import json
import os
import shutil
import subprocess
import tempfile


class MigrationError(ValueError):
    pass


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read(path):
    path = Path(path)
    if path.is_symlink():
        raise MigrationError(f"Symlink requires explicit resolution: {path}")
    return path.read_bytes() if path.is_file() else None


def fingerprint(path):
    data = read(path)
    return None if data is None else digest(data)


def write(path, data, *, exclusive=False):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".session-migration-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        if path.exists():
            shutil.copymode(path, temporary)
        if exclusive:
            os.link(temporary, path)
        else:
            os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def save(path, data):
    write(path, (json.dumps(data, ensure_ascii=False, indent=2) + "\n").encode())


def load(path):
    return json.loads(Path(path).read_text())


def records(data):
    try:
        return [json.loads(line) for line in data.splitlines() if line.strip()]
    except (ValueError, UnicodeError) as exc:
        raise MigrationError(
            "Incomplete or malformed JSONL; wait for its writer to finish"
        ) from exc


def transform(data, host, old, new):
    out = []
    for line in data.splitlines(keepends=True):
        if not line.strip():
            out.append(line)
            continue
        row = records(line)[0]
        metadata = (
            row
            if host == "claude"
            else row.get("payload", {})
            if row.get("type") in {"session_meta", "turn_context"}
            else {}
        )
        if isinstance(metadata, dict) and metadata.get("cwd") == old:
            metadata["cwd"] = new
            line = (
                json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n"
            ).encode()
        out.append(line)
    return b"".join(out)


def compatible(current, incoming):
    """Only identical transcripts or strict record-prefix extensions may merge."""
    a, b = records(current), records(incoming)
    shorter = min(len(a), len(b))
    if a[:shorter] != b[:shorter]:
        raise MigrationError(
            "Divergent session histories; preserve both and resolve explicitly"
        )
    return incoming if len(b) > len(a) else current


def no_writer(path):
    """Never atomically replace a file held open by a live session writer."""
    if not Path(path).exists():
        return
    lsof = shutil.which("lsof")
    if not lsof:
        raise MigrationError(
            "Replacing existing session files requires lsof and stopped writers"
        )
    result = subprocess.run(
        [lsof, "-Fpa", "--", str(path)], capture_output=True, text=True
    )
    if result.returncode not in (0, 1):
        raise MigrationError(
            "Cannot determine whether the destination has active writers"
        )
    if any(line in {"aw", "au"} for line in result.stdout.splitlines()):
        raise MigrationError(
            f"Active destination writer; close the session first: {path}"
        )
