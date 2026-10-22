#!/usr/bin/env python3
"""Native migration fixtures exercise real files and SQLite without user profiles."""

import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "skills/recall/scripts"
sys.path.insert(0, str(SCRIPTS))
import migrate_sessions as migration
from session_migration import common


class MigrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name).resolve()
        self.old = self.base / "missing-old-project"
        self.project = self.base / "project"
        self.project.mkdir()
        self.source = self.base / "source"
        self.source.mkdir()
        self.dest = self.base / "destination"
        self.dest.mkdir()
        # These closed fixture files have no real session writer. The writer detector
        # is separately tested with its actual command response contract below.
        self.writer = patch.object(migration, "no_writer", return_value=None)
        self.writer.start()
        self.addCleanup(self.writer.stop)

    def transcript(self, identity="child", parent="parent"):
        return (
            json.dumps(
                {
                    "type": "session_meta",
                    "payload": {
                        "id": identity,
                        "session_id": parent,
                        "cwd": str(self.old),
                    },
                }
            )
            + "\n"
            + json.dumps(
                {
                    "type": "response_item",
                    "payload": {"text": f"Historical command: cd {self.old}"},
                }
            )
            + "\n"
        ).encode()

    def claude(self, profile=None, text=None):
        profile = profile or self.source
        folder = profile / "projects" / migration.claude.encoded(self.old)
        folder.mkdir(parents=True, exist_ok=True)
        p = folder / "one.jsonl"
        p.write_bytes(
            text
            or (
                json.dumps(
                    {"sessionId": "one", "cwd": str(self.old), "message": str(self.old)}
                )
                + "\n"
            ).encode()
        )
        return p

    def db(self, profile):
        path = profile / "state_5.sqlite"
        with sqlite3.connect(path) as db:
            db.executescript("""
                CREATE TABLE threads(id TEXT PRIMARY KEY, cwd TEXT, rollout_path TEXT, title TEXT, updated_at INTEGER, project_id TEXT, thread_section_id TEXT);
                CREATE TABLE thread_dynamic_tools(thread_id TEXT REFERENCES threads(id), position INTEGER, name TEXT, PRIMARY KEY(thread_id,position));
                CREATE TABLE thread_spawn_edges(child_thread_id TEXT PRIMARY KEY, parent_thread_id TEXT, status TEXT);
                CREATE TABLE thread_artifacts(id TEXT PRIMARY KEY, thread_id TEXT REFERENCES threads(id), payload TEXT);
            """)
        with sqlite3.connect(profile / "thread_history_1.sqlite") as db:
            db.executescript("""
                CREATE TABLE thread_turns(thread_id TEXT, turn_id TEXT, rollout_ordinal INTEGER, status TEXT, error_json TEXT, started_at INTEGER, completed_at INTEGER, duration_ms INTEGER, first_user_item_id TEXT, final_agent_item_id TEXT, rollout_byte_offset INTEGER, rollout_end_ordinal INTEGER, rollout_end_byte_offset INTEGER, PRIMARY KEY(thread_id,turn_id));
                CREATE TABLE thread_items(thread_id TEXT, turn_id TEXT, item_id TEXT, rollout_ordinal INTEGER, created_at_ms INTEGER, item_json TEXT, item_type TEXT, updated_at_ordinal INTEGER, PRIMARY KEY(thread_id,turn_id,item_id));
                CREATE TABLE thread_history_projection_state(thread_id TEXT PRIMARY KEY, next_rollout_byte_offset INTEGER, next_rollout_ordinal INTEGER);
                CREATE TABLE thread_realtime_items(thread_id TEXT, item_id TEXT, rollout_ordinal INTEGER, created_at_ms INTEGER, item_type TEXT, item_json TEXT, PRIMARY KEY(thread_id,item_id));
            """)
        return path

    def codex(self):
        source_db = self.db(self.source)
        self.db(self.dest)
        path = self.source / "sessions/2026/01/01/child.jsonl"
        path.parent.mkdir(parents=True)
        path.write_bytes(self.transcript())
        with sqlite3.connect(source_db) as db:
            db.execute(
                "INSERT INTO threads VALUES (?,?,?,?,?,?,?)",
                ("child", str(self.old), str(path), "Child title", 100, None, None),
            )
            db.execute(
                "INSERT INTO thread_spawn_edges VALUES (?,?,?)",
                ("child", "parent", "completed"),
            )
        with sqlite3.connect(self.dest / "state_5.sqlite") as db:
            db.execute(
                "INSERT INTO threads VALUES (?,?,?,?,?,?,?)",
                ("parent", "other-project", "parent-rollout", "Parent", 50, None, None),
            )
        raw = path.read_bytes()
        body = json.dumps({"text": "History body kept verbatim"})
        with sqlite3.connect(self.source / "thread_history_1.sqlite") as db:
            db.execute("INSERT INTO thread_turns VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", (
                "child", "turn-1", 1, "completed", None, 100, 200, 100,
                "item-1", "item-1", len(raw.splitlines(keepends=True)[0]), 2, len(raw),
            ))
            db.execute("INSERT INTO thread_items VALUES (?,?,?,?,?,?,?,?)", (
                "child", "turn-1", "item-1", 1, 100, body, "userMessage", 1,
            ))
            db.execute("INSERT INTO thread_history_projection_state VALUES (?,?,?)", ("child", len(raw), 2))
            db.execute("INSERT INTO thread_realtime_items VALUES (?,?,?,?,?,?)", (
                "child", "realtime-1", 1, 100, "userMessage", body,
            ))
        return path

    def plan(self, host="claude", profiles=None):
        return migration.create_plan(
            host, profiles or [self.source], self.dest, self.old, self.project
        )

    def test_claude_plan_is_read_only_and_apply_preserves_history(self):
        source = self.claude()
        before = source.read_bytes()
        plan = self.plan()
        self.assertEqual(list(self.dest.iterdir()), [])
        receipt = self.base / "receipt"
        migration.apply(plan, receipt)
        target = Path(plan["files"][0]["target"])
        row = json.loads(target.read_text())
        self.assertEqual(row["cwd"], str(self.project))
        self.assertEqual(row["message"], str(self.old))
        self.assertEqual(source.read_bytes(), before)
        self.assertEqual(migration.verify(receipt)["status"], "verified")
        migration.rollback(receipt)
        self.assertFalse(target.exists())
        self.assertEqual(migration.rollback(receipt)["status"], "rolled-back")

    def test_divergent_larger_transcript_is_rejected(self):
        self.claude()
        target = (
            self.dest
            / "projects"
            / migration.claude.encoded(self.project)
            / "one.jsonl"
        )
        target.parent.mkdir(parents=True)
        target.write_text(
            json.dumps({"sessionId": "one", "message": "different and longer" * 50})
            + "\n"
        )
        with self.assertRaisesRegex(common.MigrationError, "Divergent"):
            self.plan()

    def test_prefix_extension_in_another_profile_is_merged(self):
        source = self.claude()
        second = self.base / "second"
        second.mkdir()
        addition = (
            json.dumps({"sessionId": "one", "cwd": str(self.old), "message": "next"})
            + "\n"
        ).encode()
        self.claude(second, source.read_bytes() + addition)
        plan = self.plan(profiles=[self.source, second])
        migration.apply(plan, self.base / "receipt")
        self.assertEqual(
            len(common.records(Path(plan["files"][0]["target"]).read_bytes())), 2
        )

    def test_destination_extension_is_preserved(self):
        source = self.claude()
        plan = self.plan()
        target = Path(plan["files"][0]["target"])
        target.parent.mkdir(parents=True)
        target.write_bytes(
            common.transform(
                source.read_bytes(), "claude", str(self.old), str(self.project)
            )
            + b'{"message":"newer"}\n'
        )
        plan = self.plan()
        migration.apply(plan, self.base / "receipt")
        self.assertEqual(len(common.records(target.read_bytes())), 2)

    def test_changed_source_or_destination_invalidates_plan(self):
        source = self.claude()
        plan = self.plan()
        source.write_bytes(source.read_bytes() + b'{"message":"later"}\n')
        with self.assertRaisesRegex(common.MigrationError, "Source changed"):
            migration.apply(plan, self.base / "receipt")
        plan = self.plan()
        target = Path(plan["files"][0]["target"])
        target.parent.mkdir(parents=True)
        target.write_bytes(b"{}\n")
        with self.assertRaisesRegex(common.MigrationError, "Destination changed"):
            migration.apply(plan, self.base / "receipt2")

    def test_malformed_tail_is_rejected(self):
        self.claude(text=b'{"cwd":')
        with self.assertRaisesRegex(common.MigrationError, "Incomplete"):
            self.plan()

    def test_ancillary_conflict_is_rejected(self):
        source = self.claude()
        (source.parent / "memory.md").write_text("original")
        target = self.dest / "projects" / migration.claude.encoded(self.project)
        target.mkdir(parents=True)
        (target / "memory.md").write_text("new decision")
        with self.assertRaisesRegex(common.MigrationError, "Conflicting ancillary"):
            self.plan()

    def test_unselected_verification_profile_is_excluded(self):
        self.claude()
        test_profile = self.base / "verification"
        test_profile.mkdir()
        self.claude(test_profile)
        plan = self.plan()
        self.assertEqual(plan["profiles"], [str(self.source)])
        self.assertEqual(len(plan["files"]), 1)

    def test_symlink_escape_is_rejected(self):
        self.claude()
        (self.dest / "projects").symlink_to(
            self.source / "projects", target_is_directory=True
        )
        with self.assertRaisesRegex(common.MigrationError, "symlink"):
            self.plan()

    def test_codex_own_id_metadata_index_and_parent_edge(self):
        source = self.codex()
        original = source.read_bytes()
        plan = self.plan("codex")
        self.assertEqual(plan["database"]["ids"], ["child"])
        receipt = self.base / "receipt"
        migration.apply(plan, receipt)
        self.assertEqual(source.read_bytes(), original)
        target = Path(plan["files"][0]["target"])
        meta = common.records(target.read_bytes())[0]["payload"]
        self.assertEqual(
            meta, {"id": "child", "session_id": "parent", "cwd": str(self.project)}
        )
        with sqlite3.connect(self.dest / "state_5.sqlite") as db:
            self.assertEqual(
                db.execute('SELECT cwd FROM threads WHERE id="child"').fetchone()[0],
                str(self.project),
            )
            self.assertEqual(
                db.execute(
                    "SELECT parent_thread_id FROM thread_spawn_edges"
                ).fetchone()[0],
                "parent",
            )
        self.assertEqual(
            json.loads((self.dest / "session_index.jsonl").read_text())["id"], "child"
        )
        self.assertEqual(migration.verify(receipt)["status"], "verified")

    def test_rollback_preserves_unrelated_later_threads_and_index_entries(self):
        self.codex()
        plan = self.plan("codex")
        receipt = self.base / "receipt"
        migration.apply(plan, receipt)
        with sqlite3.connect(self.dest / "state_5.sqlite") as db:
            db.execute(
                "INSERT INTO threads VALUES (?,?,?,?,?,?,?)",
                ("other", "elsewhere", "file", "Other", 101, None, None),
            )
        index = self.dest / "session_index.jsonl"
        with index.open("a") as f:
            f.write('{"id":"other","thread_name":"Other","updated_at":"later"}\n')
        migration.rollback(receipt)
        with sqlite3.connect(self.dest / "state_5.sqlite") as db:
            self.assertEqual(
                sorted(db.execute("SELECT id FROM threads").fetchall()),
                [("other",), ("parent",)],
            )
        self.assertEqual(json.loads(index.read_text())["id"], "other")

    def test_rollback_refuses_new_user_changes(self):
        self.claude()
        plan = self.plan()
        receipt = self.base / "receipt"
        migration.apply(plan, receipt)
        target = Path(plan["files"][0]["target"])
        target.write_bytes(target.read_bytes() + b'{"message":"new work"}\n')
        with self.assertRaisesRegex(common.MigrationError, "newer changes"):
            migration.rollback(receipt)
        self.assertIn(b"new work", target.read_bytes())

    def test_partial_failure_has_recoverable_receipt(self):
        self.codex()
        plan = self.plan("codex")
        receipt = self.base / "receipt"
        with patch.object(
            migration.codex,
            "replace_rows",
            side_effect=RuntimeError("injected failure"),
        ):
            with self.assertRaisesRegex(RuntimeError, "injected"):
                migration.apply(plan, receipt)
        self.assertEqual(common.load(receipt / "receipt.json")["status"], "interrupted")
        migration.rollback(receipt)
        self.assertFalse(Path(plan["files"][0]["target"]).exists())

    def test_schema_drift_fails_before_writes(self):
        self.codex()
        with sqlite3.connect(self.dest / "state_5.sqlite") as db:
            db.execute("ALTER TABLE threads ADD COLUMN unexpected TEXT")
        with self.assertRaisesRegex(common.MigrationError, "schemas differ"):
            self.plan("codex")
        self.assertFalse((self.dest / "sessions").exists())

    def test_source_local_associations_are_cleared_without_changing_subagent_type(self):
        self.codex()
        for profile in (self.source, self.dest):
            with sqlite3.connect(profile / "state_5.sqlite") as db:
                db.execute("ALTER TABLE threads ADD COLUMN source TEXT")
                db.execute("ALTER TABLE threads ADD COLUMN section_position REAL")
                db.execute("ALTER TABLE threads ADD COLUMN section_entered_at_ms INTEGER")
        with sqlite3.connect(self.source / "state_5.sqlite") as db:
            db.execute("UPDATE threads SET project_id='group', thread_section_id='section', section_position=1, section_entered_at_ms=100, source='subagent' WHERE id='child'")
        plan = self.plan("codex")
        row = plan["database"]["after"]["threads"][0]
        self.assertTrue(all(row[key] is None for key in migration.codex.LOCAL_ASSOCIATIONS))
        self.assertEqual(row["source"], "subagent")
        migration.apply(plan, self.base / "receipt")
        with sqlite3.connect(self.source / "state_5.sqlite") as db:
            self.assertEqual(db.execute("SELECT project_id FROM threads").fetchone()[0], "group")
        with sqlite3.connect(self.dest / "state_5.sqlite") as db:
            db.execute("UPDATE threads SET project_id='destination-group' WHERE id='child'")
        self.assertEqual(self.plan("codex")["database"]["after"]["threads"][0]["project_id"], "destination-group")

    def test_paginated_history_and_offsets_survive_apply_and_rollback(self):
        source = self.codex()
        self.project = self.base / "이관-완료"
        self.project.mkdir()
        original = migration.codex.snapshot(self.source / "thread_history_1.sqlite", ["child"])
        plan = self.plan("codex")
        receipt = self.base / "receipt"
        migration.apply(plan, receipt)
        raw = Path(plan["files"][0]["target"]).read_bytes()
        actual = migration.codex.snapshot(self.dest / "thread_history_1.sqlite", ["child"])
        self.assertEqual(actual["thread_history_projection_state"][0]["next_rollout_byte_offset"], len(raw))
        self.assertEqual(actual["thread_turns"][0]["rollout_byte_offset"], len(raw.splitlines(keepends=True)[0]))
        self.assertEqual(actual["thread_turns"][0]["rollout_end_byte_offset"], len(raw))
        self.assertEqual(actual["thread_items"], original["thread_items"])
        self.assertEqual(actual["thread_realtime_items"], original["thread_realtime_items"])
        self.assertNotEqual(source.read_bytes(), raw)
        with sqlite3.connect(self.dest / "thread_history_1.sqlite") as db:
            db.execute("INSERT INTO thread_history_projection_state VALUES ('unrelated',0,0)")
        migration.rollback(receipt)
        self.assertTrue(all(not rows for rows in migration.codex.snapshot(self.dest / "thread_history_1.sqlite", ["child"]).values()))
        self.assertEqual(migration.codex.snapshot(self.source / "thread_history_1.sqlite", ["child"]), original)
        self.assertEqual(len(migration.codex.snapshot(self.dest / "thread_history_1.sqlite", ["unrelated"])["thread_history_projection_state"]), 1)

    def test_history_schema_mismatch_fails_before_writes(self):
        self.codex()
        with sqlite3.connect(self.dest / "thread_history_1.sqlite") as db:
            db.execute("ALTER TABLE thread_items ADD COLUMN unexpected TEXT")
        with self.assertRaisesRegex(common.MigrationError, "history schemas differ"):
            self.plan("codex")
        self.assertFalse((self.dest / "sessions").exists())

    def test_missing_history_database_fails_before_writes(self):
        self.codex()
        (self.source / "thread_history_1.sqlite").unlink()
        with self.assertRaisesRegex(common.MigrationError, "history database"):
            self.plan("codex")
        self.assertFalse((self.dest / "sessions").exists())

    def test_history_cursor_must_align_with_rollout(self):
        self.codex()
        with sqlite3.connect(self.source / "thread_history_1.sqlite") as db:
            db.execute("UPDATE thread_history_projection_state SET next_rollout_byte_offset=1")
        with self.assertRaisesRegex(common.MigrationError, "cursor does not align"):
            self.plan("codex")

    def test_history_write_failure_rolls_back_both_databases(self):
        self.codex()
        plan = self.plan("codex")
        receipt = self.base / "receipt"
        with patch.object(migration.codex, "replace_history", side_effect=RuntimeError("history write failure")):
            with self.assertRaisesRegex(RuntimeError, "history write failure"):
                migration.apply(plan, receipt)
        self.assertEqual(migration.codex.snapshot(self.dest / "state_5.sqlite", ["child"])["threads"], [])
        self.assertTrue(all(not rows for rows in migration.codex.snapshot(self.dest / "thread_history_1.sqlite", ["child"]).values()))
        migration.rollback(receipt)
        self.assertFalse(Path(plan["files"][0]["target"]).exists())

    def test_history_changes_invalidate_plans_and_block_rollback(self):
        self.codex()
        plan = self.plan("codex")
        with sqlite3.connect(self.source / "thread_history_1.sqlite") as db:
            db.execute("UPDATE thread_items SET item_json='changed source'")
        with self.assertRaisesRegex(common.MigrationError, "Source session metadata changed"):
            migration.apply(plan, self.base / "stale-receipt")
        plan = self.plan("codex")
        receipt = self.base / "receipt"
        migration.apply(plan, receipt)
        with sqlite3.connect(self.dest / "thread_history_1.sqlite") as db:
            db.execute("UPDATE thread_items SET item_json='later user change'")
        with self.assertRaisesRegex(common.MigrationError, "newer changes"):
            migration.rollback(receipt)

    def test_interrupted_cross_database_commit_is_recoverable(self):
        self.codex()
        plan = self.plan("codex")
        receipt = self.base / "receipt"
        with patch.object(migration, "verify", side_effect=RuntimeError("interrupted")):
            with self.assertRaisesRegex(RuntimeError, "interrupted"):
                migration.apply(plan, receipt)
        # Model a crash with the state commit durable but the attached WAL not.
        with migration.codex.connect(plan["history"]["path"], False) as db:
            migration.codex.replace_history(db, plan["history"]["ids"], plan["history"]["before"], schema="main")
        migration.rollback(receipt)
        self.assertEqual(migration.codex.snapshot(plan["database"]["path"], ["child"]), plan["database"]["before"])
        self.assertEqual(migration.codex.snapshot(plan["history"]["path"], ["child"]), plan["history"]["before"])

    def test_missing_indexed_metadata_is_rejected(self):
        self.codex()
        with sqlite3.connect(self.source / "state_5.sqlite") as db:
            db.execute("DELETE FROM threads")
        with self.assertRaisesRegex(common.MigrationError, "metadata missing"):
            self.plan("codex")

    def test_missing_parent_is_rejected(self):
        self.codex()
        with sqlite3.connect(self.dest / "state_5.sqlite") as db:
            db.execute("DELETE FROM threads")
        with self.assertRaisesRegex(common.MigrationError, "Parent sessions"):
            self.plan("codex")

    def test_exclusive_creation_does_not_overwrite_an_intervening_file(self):
        path = self.base / "new-file"
        path.write_bytes(b"user work")
        with self.assertRaises(FileExistsError):
            common.write(path, b"migrated", exclusive=True)
        self.assertEqual(path.read_bytes(), b"user work")

    def test_in_place_migration_restores_original_bytes_on_rollback(self):
        source = self.claude()
        original = source.read_bytes()
        self.dest = self.source
        plan = self.plan()
        receipt = self.base / "receipt"
        migration.apply(plan, receipt)
        migration.rollback(receipt)
        self.assertEqual(source.read_bytes(), original)

    def test_source_index_name_is_preserved(self):
        self.codex()
        entry = {
            "id": "child",
            "thread_name": "User chosen name",
            "updated_at": "2026-01-01T01:00:00Z",
        }
        (self.source / "session_index.jsonl").write_text(json.dumps(entry) + "\n")
        migration.apply(self.plan("codex"), self.base / "receipt")
        self.assertEqual(
            json.loads((self.dest / "session_index.jsonl").read_text()), entry
        )

    def test_failure_after_database_commit_is_recoverable(self):
        self.codex()
        plan = self.plan("codex")
        receipt = self.base / "receipt"
        with patch.object(
            migration, "index_entries", side_effect=RuntimeError("index interrupted")
        ):
            with self.assertRaisesRegex(RuntimeError, "index interrupted"):
                migration.apply(plan, receipt)
        migration.rollback(receipt)
        with sqlite3.connect(self.dest / "state_5.sqlite") as db:
            self.assertEqual(
                db.execute("SELECT id FROM threads").fetchall(), [("parent",)]
            )

    def test_existing_thread_update_preserves_unowned_cascade_rows(self):
        self.codex()
        self.dest = self.source
        with sqlite3.connect(self.source / "state_5.sqlite") as db:
            db.execute("DELETE FROM thread_spawn_edges")
            db.execute("CREATE TABLE unowned(thread_id TEXT REFERENCES threads(id) ON DELETE CASCADE, value TEXT)")
            db.execute("INSERT INTO unowned VALUES ('child', 'preserve')")
        plan = self.plan("codex")
        receipt = self.base / "receipt"
        migration.apply(plan, receipt)
        migration.rollback(receipt)
        with sqlite3.connect(self.source / "state_5.sqlite") as db:
            self.assertEqual(db.execute("SELECT * FROM unowned").fetchall(), [("child", "preserve")])

    def test_claude_encoded_path_collision_is_rejected(self):
        self.claude(text=(json.dumps({"cwd": str(self.base / "other-project"), "message": "private"}) + "\n").encode())
        with self.assertRaisesRegex(common.MigrationError, "Ambiguous Claude"):
            self.plan()
        self.assertEqual(list(self.dest.iterdir()), [])

    def test_existing_destination_dependencies_are_not_overwritten(self):
        self.codex()
        migration.apply(self.plan("codex"), self.base / "receipt")
        with sqlite3.connect(self.dest / "state_5.sqlite") as db:
            db.execute("INSERT INTO thread_dynamic_tools VALUES ('child', 0, 'new-tool')")
        with self.assertRaisesRegex(common.MigrationError, "dependencies differ"):
            self.plan("codex")

    def test_corrupted_backup_blocks_rollback(self):
        source = self.claude()
        target = (
            self.dest
            / "projects"
            / migration.claude.encoded(self.project)
            / "one.jsonl"
        )
        target.parent.mkdir(parents=True)
        target.write_bytes(source.read_bytes())
        plan = self.plan()
        receipt = self.base / "receipt"
        migration.apply(plan, receipt)
        journal = common.load(receipt / "receipt.json")
        (receipt / journal["files"][0]["backup"]).write_bytes(b"corrupted")
        current = target.read_bytes()
        with self.assertRaisesRegex(common.MigrationError, "backup"):
            migration.rollback(receipt)
        self.assertEqual(target.read_bytes(), current)

    def test_writer_detection_fails_closed(self):
        source = self.claude()
        with (
            patch.object(common.shutil, "which", return_value="/usr/bin/lsof"),
            patch.object(common.subprocess, "run") as run,
        ):
            run.return_value.returncode = 0
            run.return_value.stdout = "p123\naw\n"
            with self.assertRaisesRegex(common.MigrationError, "Active destination"):
                common.no_writer(source)
        with patch.object(common.shutil, "which", return_value=None):
            with self.assertRaisesRegex(common.MigrationError, "require.*lsof"):
                common.no_writer(source)


if __name__ == "__main__":
    unittest.main(verbosity=2)
