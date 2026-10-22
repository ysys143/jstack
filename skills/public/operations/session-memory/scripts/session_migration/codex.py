"""Codex rollout and SQLite adapter, with explicit schema compatibility checks."""

from pathlib import Path
from contextlib import contextmanager
import json
import sqlite3
from .common import MigrationError, records

RELATED = {
    "thread_dynamic_tools": "thread_id",
    "thread_spawn_edges": "child_thread_id",
    "thread_artifacts": "thread_id",
}
HISTORY = {
    "thread_turns": "thread_id",
    "thread_items": "thread_id",
    "thread_history_projection_state": "thread_id",
    "thread_realtime_items": "thread_id",
}
LOCAL_ASSOCIATIONS = (
    "project_id", "thread_section_id", "section_position", "section_entered_at_ms"
)


def database(profile, kind="state"):
    pattern = "thread_history_*.sqlite" if kind == "history" else "state_*.sqlite"
    paths = sorted(Path(profile).glob(pattern))
    if len(paths) != 1:
        raise MigrationError(f"Exactly one initialized Codex {kind} database is required")
    if paths[0].is_symlink():
        raise MigrationError("Resolve database symlinks explicitly before migration")
    return paths[0]


@contextmanager
def connect(path, readonly=True):
    db = sqlite3.connect(
        Path(path).as_uri() + "?mode=ro" if readonly else str(path), uri=readonly, timeout=20
    )
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    try:
        with db:
            yield db
    finally:
        db.close()


def discover(profiles, old, new):
    for profile in profiles:
        directory = Path(profile) / "sessions"
        if not directory.is_dir():
            raise MigrationError(f"Codex sessions directory missing: {directory}")
        for path in sorted(directory.rglob("*.jsonl")):
            with path.open("rb") as handle:
                first = records(handle.readline())
            if not first or first[0].get("type") != "session_meta":
                continue
            meta = first[0].get("payload", {})
            if meta.get("cwd") in {old, new}:
                identity = meta.get("id") or meta.get("session_id")
                if not identity:
                    raise MigrationError(f"Session has no identity: {path}")
                yield path, path.relative_to(profile), identity


def columns(db, table):
    return [r["name"] for r in db.execute(f'PRAGMA table_info("{table}")')]


def snapshot(path, ids):
    with connect(path) as db:
        result = {}
        tables = HISTORY if Path(path).name.startswith("thread_history_") else {"threads": "id", **RELATED}
        for table, key in tables.items():
            if not columns(db, table):
                raise MigrationError(f"Unsupported Codex schema: missing {table}")
            result[table] = [
                dict(r)
                for r in db.execute(
                    f'SELECT * FROM "{table}" WHERE "{key}" IN ({",".join("?" for _ in ids)}) ORDER BY rowid',
                    ids,
                )
            ]
        return result


def prepare(profile, destination, identity, source_path, target, new):
    source_db, target_db = database(profile), database(destination)
    with connect(source_db) as a, connect(target_db) as b:
        if source_db.name != target_db.name or any(
            columns(a, t) != columns(b, t) for t in {"threads", *RELATED}
        ):
            raise MigrationError(
                "Codex database schemas differ; migration is not supported"
            )
    rows = snapshot(source_db, [identity])
    if len(rows["threads"]) != 1:
        raise MigrationError(
            "Indexed metadata missing for rollout; repair the source index first"
        )
    thread = rows["threads"][0]
    if Path(thread["rollout_path"]).resolve() != Path(source_path).resolve():
        raise MigrationError(
            "Duplicate session ID points at a different source rollout"
        )
    if Path(profile) != Path(destination):
        for key in LOCAL_ASSOCIATIONS:
            if key in thread:
                thread[key] = None
    thread["cwd"], thread["rollout_path"] = new, str(target)
    return rows


def prepare_history(profile, destination, identity, original, migrated):
    source_db, target_db = database(profile, "history"), database(destination, "history")
    with connect(source_db) as a, connect(target_db) as b:
        if source_db.name != target_db.name or any(
            not columns(a, t) or columns(a, t) != columns(b, t) for t in HISTORY
        ):
            raise MigrationError("Codex history schemas differ; migration is not supported")
    rows = snapshot(source_db, [identity])
    # Projection cursors and turn ranges are byte offsets into the rollout.
    # Rewriting cwd can change UTF-8 lengths, even when every ordinal is stable.
    old_lines, new_lines = original.splitlines(keepends=True), migrated.splitlines(keepends=True)
    if len(new_lines) < len(old_lines) or any(
        bool(a.strip()) != bool(b.strip()) for a, b in zip(old_lines, new_lines)
    ):
        raise MigrationError("Cannot preserve history ordinals across different JSONL line layouts")
    offsets, old_pos, new_pos = {0: 0}, 0, 0
    for a, b in zip(old_lines, new_lines):
        old_pos += len(a)
        new_pos += len(b)
        offsets[old_pos] = new_pos
    for entries in rows.values():
        for row in entries:
            for key, value in row.items():
                if key.endswith("byte_offset") and value is not None:
                    if value not in offsets:
                        raise MigrationError("History cursor does not align with its source rollout")
                    row[key] = offsets[value]
    return rows


def replace_history(db, ids, rows, schema="history"):
    for table in HISTORY:
        db.execute(
            f'DELETE FROM "{schema}"."{table}" WHERE thread_id IN ({",".join("?" for _ in ids)})',
            ids,
        )
        for row in rows[table]:
            names = list(row)
            fields = ",".join('"' + n + '"' for n in names)
            db.execute(
                f'INSERT INTO "{schema}"."{table}" ({fields}) VALUES ({",".join("?" for _ in names)})',
                [row[n] for n in names],
            )


def replace_rows(db, ids, rows):
    for table, key in RELATED.items():
        db.execute(
            f'DELETE FROM "{table}" WHERE "{key}" IN ({",".join("?" for _ in ids)})',
            ids,
        )
    retained = {row["id"] for row in rows["threads"]}
    for identity in set(ids) - retained:
        db.execute("DELETE FROM threads WHERE id=?", (identity,))
    for table in {"threads": "id", **RELATED}:
        for row in rows[table]:
            names = list(row)
            fields = ",".join('"' + n + '"' for n in names)
            conflict = (
                " ON CONFLICT(id) DO UPDATE SET "
                + ",".join(f'"{n}"=excluded."{n}"' for n in names if n != "id")
                if table == "threads" else ""
            )
            db.execute(
                f'INSERT INTO "{table}" ({fields}) VALUES ({",".join("?" for _ in names)})' + conflict,
                [row[n] for n in names],
            )
