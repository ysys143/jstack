#!/usr/bin/env python3
"""Plan, apply, verify, or roll back an explicitly scoped session migration.

Storage adapters: scripts/session_migration/claude.py and
scripts/session_migration/codex.py. Shared conflict and file primitives live in
scripts/session_migration/common.py.
"""

import argparse
from datetime import datetime, timezone
import json
import os
import sqlite3
from pathlib import Path
import sys

from session_migration import claude, codex
from session_migration.common import (
    MigrationError,
    compatible,
    digest,
    fingerprint,
    load,
    no_writer,
    read,
    records,
    save,
    transform,
    write,
)


def stable(value):
    return digest(json.dumps(value, sort_keys=True, separators=(",", ":")).encode())


def rows_equal(a, b):
    return all(
        sorted(map(stable, a[t])) == sorted(map(stable, b[t])) for t in a
    ) and set(a) == set(b)


def bounded(path, profile):
    path = Path(path)
    if not path.is_relative_to(profile) or path.resolve() != path:
        raise MigrationError(
            f"Path escapes its explicit profile or uses a symlink: {path}"
        )
    return path


def create_plan(host, profiles, destination, old, project):
    destination = Path(destination).expanduser().resolve()
    profiles = list(
        dict.fromkeys(str(Path(p).expanduser().resolve()) for p in profiles)
    )
    old, project = (
        str(Path(old).expanduser().resolve()),
        str(Path(project).expanduser().resolve()),
    )
    if not Path(project).is_dir() or not destination.is_dir():
        raise MigrationError(
            "The new project and initialized destination profile must exist"
        )
    adapter = claude if host == "claude" else codex
    actions, guards, identities, db_rows, db_guards = {}, {}, {}, {}, {}
    history_sources = {}
    for profile in profiles:
        profile_path = Path(profile)
        for source, relative, identity in adapter.discover([profile], old, project):
            bounded(source, profile_path)
            target = bounded(destination / relative, destination)
            data = read(source)
            guards[str(source)] = digest(data)
            incoming = (
                transform(data, host, old, project)
                if source.suffix == ".jsonl"
                else data
            )
            existing = read(target)
            current = (
                actions[str(target)]["data"] if str(target) in actions else existing
            )
            if (
                identity
                and identity in identities
                and identities[identity] != str(target)
            ):
                raise MigrationError(
                    "One Codex ID has multiple rollout paths; reconcile before migration"
                )
            if identity:
                identities[identity] = str(target)
            if current is not None:
                normalized = (
                    transform(current, host, old, project)
                    if target.suffix == ".jsonl"
                    else current
                )
                if source.suffix == ".jsonl":
                    incoming = compatible(normalized, incoming)
                elif current != incoming:
                    raise MigrationError(f"Conflicting ancillary file: {relative}")
            if host == "codex":
                db_path = str(codex.database(profile))
                db_guards.setdefault(db_path, {})[identity] = codex.snapshot(
                    db_path, [identity]
                )
                prepared = codex.prepare(
                    profile, destination, identity, source, target, project
                )
                previous = db_rows.get(identity)
                if previous and not rows_equal(previous, prepared):
                    raise MigrationError(
                        "Conflicting Codex metadata for the same session ID"
                    )
                db_rows[identity] = prepared
                history_path = str(codex.database(profile, "history"))
                db_guards.setdefault(history_path, {})[identity] = codex.snapshot(
                    history_path, [identity]
                )
                history_sources.setdefault(identity, []).append((profile, source))
            actions[str(target)] = {
                "target": str(target),
                "source": str(source),
                "sourceSha256": digest(data),
                "before": None if existing is None else digest(existing),
                "after": digest(incoming),
                "data": incoming,
            }
    if not actions:
        raise MigrationError(
            "No sessions matched the explicit project paths and profiles"
        )
    plan = {
        "schemaVersion": 1,
        "host": host,
        "oldProject": old,
        "project": project,
        "profiles": profiles,
        "destination": str(destination),
        "sourceGuards": guards,
        "sourceDatabases": db_guards,
        "files": [],
    }
    if host == "codex":
        ids = sorted(identities)
        target_db = codex.database(destination)
        before = codex.snapshot(target_db, ids)
        after = {t: [] for t in before}
        for identity in ids:
            for table, rows in db_rows[identity].items():
                after[table].extend(rows)
        # An existing destination thread may contain newer state; never replace it by size.
        for row in before["threads"]:
            candidate = next(r for r in after["threads"] if r["id"] == row["id"])
            # Associations already in the destination refer to its own sidebar.
            for key in codex.LOCAL_ASSOCIATIONS:
                if key in candidate:
                    candidate[key] = row[key]
            allowed = dict(row, cwd=project, rollout_path=identities[row["id"]])
            if allowed != candidate:
                raise MigrationError(
                    "Existing destination thread metadata differs; no automatic overwrite"
                )
        existing_ids = {row["id"] for row in before["threads"]}
        for table, key in codex.RELATED.items():
            retained = [row for row in after[table] if row[key] in existing_ids]
            if sorted(map(stable, before[table])) != sorted(map(stable, retained)):
                raise MigrationError(
                    "Existing destination session dependencies differ; no automatic overwrite"
                )
        parents = {r["parent_thread_id"] for r in after["thread_spawn_edges"]} - set(
            ids
        )
        if parents:
            with codex.connect(target_db) as connection:
                present = {
                    r["id"]
                    for r in connection.execute(
                        "SELECT id FROM threads WHERE id IN ("
                        + ",".join("?" for _ in parents)
                        + ")",
                        sorted(parents),
                    )
                }
            if parents != present:
                raise MigrationError(
                    "Parent sessions are missing from destination; include their source profiles"
                )
        index = destination / "session_index.jsonl"
        plan["database"] = {
            "path": str(target_db),
            "ids": ids,
            "before": before,
            "after": after,
        }
        history_db = codex.database(destination, "history")
        history_before = codex.snapshot(history_db, ids)
        history_after = {t: [] for t in history_before}
        for identity in ids:
            prepared_history = None
            for profile, source in history_sources[identity]:
                candidate = codex.prepare_history(
                    profile, destination, identity, read(source),
                    actions[identities[identity]]["data"],
                )
                if prepared_history is not None and not rows_equal(prepared_history, candidate):
                    raise MigrationError("Conflicting Codex paginated history for the same session ID")
                prepared_history = candidate
            existing_history = {
                t: [r for r in history_before[t] if r["thread_id"] == identity]
                for t in history_before
            }
            if any(existing_history.values()):
                original_target = read(identities[identity])
                if original_target is None:
                    raise MigrationError("Existing destination history has no rollout to verify")
                normalized_existing = codex.prepare_history(
                    destination, destination, identity, original_target,
                    actions[identities[identity]]["data"],
                )
                if not rows_equal(normalized_existing, prepared_history):
                    raise MigrationError("Existing destination paginated history differs; no automatic overwrite")
            for table in history_after:
                history_after[table].extend(prepared_history[table])
        plan["history"] = {
            "path": str(history_db), "ids": ids,
            "before": history_before, "after": history_after,
        }
        destination_entries = {r["id"]: r for r in records(read(index) or b"")}
        imported_entries = {}
        for profile in profiles:
            source_index = Path(profile) / "session_index.jsonl"
            source_data = read(source_index)
            if source_data is None:
                continue
            guards[str(source_index)] = digest(source_data)
            for entry in records(source_data):
                identity = entry.get("id")
                if identity not in ids or identity in destination_entries:
                    continue
                previous = imported_entries.get(identity)
                if previous is not None and previous != entry:
                    raise MigrationError(
                        "Conflicting source index entries; reconcile session names first"
                    )
                imported_entries[identity] = entry
        entries = []
        for row in after["threads"]:
            entries.append(
                destination_entries.get(row["id"])
                or imported_entries.get(row["id"])
                or {
                    "id": row["id"],
                    "thread_name": row["title"],
                    "updated_at": datetime.fromtimestamp(
                        row["updated_at"], timezone.utc
                    )
                    .isoformat()
                    .replace("+00:00", "Z"),
                }
            )
        plan["index"] = {
            "path": str(index),
            "before": fingerprint(index),
            "entries": entries,
        }
    # Rollout bytes are recomputed from guarded sources. The private plan includes
    # selected database history rows so verification and rollback remain exact.
    for action in actions.values():
        action.pop("data")
        plan["files"].append(action)
    return plan


def preflight(plan):
    for path, expected in plan["sourceGuards"].items():
        if fingerprint(path) != expected:
            raise MigrationError("Source changed after planning; make a new plan")
    for path, sessions in plan["sourceDatabases"].items():
        for identity, expected in sessions.items():
            if not rows_equal(codex.snapshot(path, [identity]), expected):
                raise MigrationError("Source session metadata changed after planning")
    for action in plan["files"]:
        bounded(Path(action["target"]), Path(plan["destination"]))
        if fingerprint(action["target"]) != action["before"]:
            raise MigrationError("Destination changed after planning; make a new plan")
        if action["before"] is not None and action["before"] != action["after"]:
            no_writer(action["target"])
    if "database" in plan:
        for key in ("database", "history"):
            db = plan[key]
            if not rows_equal(codex.snapshot(db["path"], db["ids"]), db["before"]):
                raise MigrationError("Destination database changed after planning")
        if fingerprint(plan["index"]["path"]) != plan["index"]["before"]:
            raise MigrationError("Destination index changed after planning")


def materialize(plan):
    rebuilt = create_plan(
        plan["host"],
        plan["profiles"],
        plan["destination"],
        plan["oldProject"],
        plan["project"],
    )
    if rebuilt != plan:
        raise MigrationError("Plan no longer matches the current inputs")
    # Reconcile all sources again, including prefix extensions in other profiles.
    chosen = {}
    adapter = claude if plan["host"] == "claude" else codex
    for profile in plan["profiles"]:
        for source, rel, _ in adapter.discover(
            [profile], plan["oldProject"], plan["project"]
        ):
            target = str(Path(plan["destination"]) / rel)
            data = read(source)
            if source.suffix == ".jsonl":
                data = transform(
                    data, plan["host"], plan["oldProject"], plan["project"]
                )
                prior = chosen.get(target, read(target))
                if prior is not None:
                    data = compatible(
                        transform(
                            prior, plan["host"], plan["oldProject"], plan["project"]
                        ),
                        data,
                    )
            chosen[target] = data
    return chosen


def index_entries(plan):
    return plan["index"]["entries"]


def apply(plan, receipt):
    preflight(plan)
    data = materialize(plan)
    receipt = Path(receipt).resolve()
    if receipt.is_relative_to(Path(plan["project"])) or any(
        receipt.is_relative_to(Path(p))
        for p in [*plan["profiles"], plan["destination"]]
    ):
        raise MigrationError(
            "Store receipts outside project repositories and host profiles"
        )
    receipt.mkdir(mode=0o700, parents=False, exist_ok=False)
    journal = {
        "schemaVersion": 1,
        "status": "prepared",
        "plan": plan,
        "files": [],
        "indexLines": [],
    }
    for n, action in enumerate(plan["files"]):
        if action["before"] == action["after"]:
            continue
        backup = f"file-{n}.before"
        if action["before"] is not None:
            write(receipt / backup, read(action["target"]))
        journal["files"].append({**action, "backup": backup})
    if "index" in plan and read(plan["index"]["path"]) is not None:
        write(receipt / "index.before", read(plan["index"]["path"]))
    save(receipt / "receipt.json", journal)
    try:
        # Recheck after backups and before the first mutation.
        preflight(plan)
        for action in journal["files"]:
            if digest(data[action["target"]]) != action["after"]:
                raise MigrationError("Prepared content disagrees with the plan")
            if fingerprint(action["target"]) != action["before"]:
                raise MigrationError("Destination changed immediately before writing")
            if action["before"] is not None:
                no_writer(action["target"])
            write(
                action["target"],
                data[action["target"]],
                exclusive=action["before"] is None,
            )
        if "database" in plan:
            db = plan["database"]
            with codex.connect(db["path"], False) as connection:
                connection.execute("ATTACH DATABASE ? AS history", (plan["history"]["path"],))
                connection.execute("BEGIN IMMEDIATE")
                for key in ("database", "history"):
                    block = plan[key]
                    if not rows_equal(codex.snapshot(block["path"], block["ids"]), block["before"]):
                        raise MigrationError("Destination database changed during apply")
                codex.replace_rows(connection, db["ids"], db["after"])
                codex.replace_history(connection, db["ids"], plan["history"]["after"])
                if connection.execute("PRAGMA foreign_key_check").fetchall() or connection.execute("PRAGMA history.foreign_key_check").fetchall():
                    raise MigrationError("Codex foreign-key verification failed")
            index = Path(plan["index"]["path"])
            previous = records(read(index) or b"")
            latest = {r["id"]: r for r in previous}
            journal["indexLines"] = [
                r for r in index_entries(plan) if latest.get(r["id"]) != r
            ]
            save(receipt / "receipt.json", journal)
            if journal["indexLines"]:
                raw = read(index) or b""
                if raw and not raw.endswith(b"\n"):
                    raise MigrationError(
                        "Destination index has an incomplete final line"
                    )
                with index.open("ab") as handle:
                    handle.write(
                        b"".join(
                            (json.dumps(r, ensure_ascii=False) + "\n").encode()
                            for r in journal["indexLines"]
                        )
                    )
                    handle.flush()
                    os.fsync(handle.fileno())
        journal["status"] = "applied"
        save(receipt / "receipt.json", journal)
        verify(receipt)
    except Exception:
        journal["status"] = "interrupted"
        save(receipt / "receipt.json", journal)
        # Keep the journal for deterministic rollback; do not hide partial work.
        raise
    return {
        "receipt": str(receipt),
        "filesChanged": len(journal["files"]),
        "sessions": len(plan.get("database", {}).get("ids", [])),
        "status": "verified",
    }


def verify(receipt):
    journal = load(Path(receipt) / "receipt.json")
    plan = journal["plan"]
    for action in plan["files"]:
        if fingerprint(action["target"]) != action["after"]:
            raise MigrationError("Migrated file changed or is incomplete")
    if "database" in plan:
        for key in ("database", "history"):
            db = plan[key]
            if not rows_equal(codex.snapshot(db["path"], db["ids"]), db["after"]):
                raise MigrationError("Migrated database rows changed or are incomplete")
        latest = {r["id"]: r for r in records(read(plan["index"]["path"]) or b"")}
        if any(latest.get(r["id"]) != r for r in index_entries(plan)):
            raise MigrationError("Migrated index entries are missing or changed")
        for action in plan["files"]:
            meta = records(read(action["target"]))[0]["payload"]
            if meta.get("cwd") != plan["project"]:
                raise MigrationError("Rollout still points at the old project")
    return {"status": "verified", "files": len(plan["files"])}


def rollback(receipt):
    receipt = Path(receipt)
    journal = load(receipt / "receipt.json")
    plan = journal["plan"]
    if journal["status"] == "rolled-back":
        return {"status": "rolled-back"}
    # Check every touched object before restoring anything; preserve later user work.
    for action in journal["files"]:
        if (
            action["before"] is not None
            and fingerprint(receipt / action["backup"]) != action["before"]
        ):
            raise MigrationError("Rollback refused: backup is missing or corrupted")
        if fingerprint(action["target"]) not in {action["before"], action["after"]}:
            raise MigrationError("Rollback refused: migrated file has newer changes")
        no_writer(action["target"])
    if "database" in plan:
        db = plan["database"]
        actuals = {}
        for key in ("database", "history"):
            block = plan[key]
            actuals[key] = codex.snapshot(block["path"], block["ids"])
            if not rows_equal(actuals[key], block["before"]) and not rows_equal(actuals[key], block["after"]):
                raise MigrationError(
                    "Rollback refused: migrated database rows have newer changes"
                )
        index = Path(plan["index"]["path"])
        lines = (read(index) or b"").splitlines(keepends=True)
        latest = {r["id"]: r for r in records(b"".join(lines))}
        before_index = {
            r["id"]: r for r in records(read(receipt / "index.before") or b"")
        }
        for row in journal["indexLines"]:
            if latest.get(row["id"]) not in [row, before_index.get(row["id"])]:
                raise MigrationError(
                    "Rollback refused: session index has newer changes"
                )
        no_writer(index)
        with codex.connect(db["path"], False) as connection:
            connection.execute("ATTACH DATABASE ? AS history", (plan["history"]["path"],))
            connection.execute("BEGIN IMMEDIATE")
            for key in ("database", "history"):
                block = plan[key]
                current = codex.snapshot(block["path"], block["ids"])
                if not rows_equal(current, actuals[key]):
                    raise MigrationError("Database changed while preparing rollback")
            codex.replace_rows(connection, db["ids"], db["before"])
            codex.replace_history(connection, db["ids"], plan["history"]["before"])
        remaining = [
            line
            for line in lines
            if not line.strip() or json.loads(line) not in journal["indexLines"]
        ]
        if remaining or plan["index"]["before"] is not None:
            write(index, b"".join(remaining))
        elif index.exists():
            index.unlink()
    for action in reversed(journal["files"]):
        target = Path(action["target"])
        if action["before"] is None:
            target.unlink(missing_ok=True)
        else:
            write(target, read(receipt / action["backup"]))
    journal["status"] = "rolled-back"
    save(receipt / "receipt.json", journal)
    return {"status": "rolled-back"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    plan = sub.add_parser("plan")
    plan.add_argument("--host", choices=["claude", "codex"], required=True)
    plan.add_argument("--source-data-dir", action="append", required=True)
    plan.add_argument("--data-dir", required=True)
    plan.add_argument("--old-project", required=True)
    plan.add_argument("--project", required=True)
    plan.add_argument("--output", type=Path, required=True)
    run = sub.add_parser("apply")
    run.add_argument("plan", type=Path)
    run.add_argument("--receipt", type=Path, required=True)
    for name in ("verify", "rollback"):
        command = sub.add_parser(name)
        command.add_argument("receipt", type=Path)
    args = parser.parse_args()
    try:
        if args.command == "plan":
            if args.output.resolve().is_relative_to(Path(args.project).resolve()):
                raise MigrationError(
                    "Store private migration plans outside the project repository"
                )
            if args.output.exists():
                raise MigrationError("Plan output already exists")
            result = create_plan(
                args.host,
                args.source_data_dir,
                args.data_dir,
                args.old_project,
                args.project,
            )
            save(args.output, result)
            result = {
                "plan": str(args.output),
                "files": len(result["files"]),
                "mutations": sum(r["before"] != r["after"] for r in result["files"]),
            }
        elif args.command == "apply":
            result = apply(load(args.plan), args.receipt)
        elif args.command == "verify":
            result = verify(args.receipt)
        else:
            result = rollback(args.receipt)
        print(json.dumps(result, indent=2))
        return 0
    except (MigrationError, OSError, ValueError, KeyError, sqlite3.Error) as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
