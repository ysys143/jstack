/** Codex session migration: schema guards before writes, association rules, and recovery after interrupted or crashed applies. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { codex, rollback, rowsEqual } from '../scripts/migrate_sessions.js';
import { load } from '../scripts/session_migration/common.js';
import { Fixture } from './_fixtures.js';

test('schema drift, missing metadata and missing parents fail before writes', async t => {
  const f = new Fixture(t); await f.codex();
  await f.sql(f.destination, 'ALTER TABLE threads ADD COLUMN unexpected TEXT'); await assert.rejects(f.plan('codex'), /schemas differ/);
  await f.sql(f.source, 'ALTER TABLE threads ADD COLUMN unexpected TEXT; DELETE FROM threads'); await assert.rejects(f.plan('codex'), /metadata missing/);
  assert.equal(existsSync(join(f.destination, 'sessions')), false);
  const g = new Fixture(t); await g.codex(); await g.sql(g.destination, 'DELETE FROM threads'); await assert.rejects(g.plan('codex'), /Parent sessions/);
});

test('history schema/missing database/misaligned cursor fail before writes', async t => {
  const f = new Fixture(t); await f.codex(); await f.sql(f.destination, 'ALTER TABLE thread_items ADD COLUMN unexpected TEXT', 'history'); await assert.rejects(f.plan('codex'), /history schemas differ/);
  const g = new Fixture(t); await g.codex(); rmSync(join(g.source, 'thread_history_1.sqlite')); await assert.rejects(g.plan('codex'), /history database/);
  const h = new Fixture(t); await h.codex(); await h.sql(h.source, 'UPDATE thread_history_projection_state SET next_rollout_byte_offset=1', 'history'); await assert.rejects(h.plan('codex'), /cursor does not align/);
  assert.equal(existsSync(join(h.destination, 'sessions')), false);
});

test('foreign local associations clear while source type and destination associations survive', async t => {
  const f = new Fixture(t); await f.codex();
  for (const profile of [f.source, f.destination]) await f.sql(profile, 'ALTER TABLE threads ADD COLUMN source TEXT; ALTER TABLE threads ADD COLUMN section_position REAL; ALTER TABLE threads ADD COLUMN section_entered_at_ms INTEGER');
  await f.sql(f.source, "UPDATE threads SET project_id='group',thread_section_id='section',section_position=1,section_entered_at_ms=100,source='subagent' WHERE id='child'");
  const plan = await f.plan('codex'), row = plan.database!.after.threads![0]!;
  for (const key of codex.LOCAL_ASSOCIATIONS) assert.equal(row[key], null); assert.equal(row.source, 'subagent');
  await f.run(plan); await f.sql(f.destination, "UPDATE threads SET project_id='destination-group' WHERE id='child'");
  assert.equal((await f.plan('codex')).database!.after.threads![0]!.project_id, 'destination-group');
});

test('state/history transaction failure restores both DBs, and file journal rolls back', async t => {
  const f = new Fixture(t); await f.codex(); const plan = await f.plan('codex');
  await assert.rejects(f.run(plan, 'receipt', { ...f.options, fault: phase => { if (phase === 'before-history-write') throw new Error('history write failure'); } }), /history write failure/);
  assert.equal(load(join(f.receipt(), 'receipt.json')).status, 'interrupted');
  assert.equal((await codex.snapshot(plan.database!.path, ['child'], f.options)).threads!.length, 0);
  assert.ok(Object.values(await codex.snapshot(plan.history!.path, ['child'], f.options)).every(rows => rows.length === 0));
  await rollback(f.receipt(), f.options); assert.equal(existsSync(plan.files[0]!.target), false);
});

test('failure after DB commit or after journaled index intent is recoverable', async t => {
  for (const phase of ['after-database-commit', 'before-index-write', 'before-verify']) {
    const f = new Fixture(t); await f.codex(); const plan = await f.plan('codex');
    await assert.rejects(f.run(plan, 'receipt', { ...f.options, fault: current => { if (current === phase) throw new Error('injected crash'); } }), /injected crash/);
    await rollback(f.receipt(), f.options); assert.equal((await codex.snapshot(plan.database!.path, ['child'], f.options)).threads!.length, 0);
  }
});

test('mixed durable state/history blocks after a WAL crash are restored independently', async t => {
  const f = new Fixture(t); await f.codex(); const plan = await f.plan('codex'); await f.run(plan);
  const history = await f.connection(f.destination, 'history'); try { await history.transaction(() => codex.replaceHistory(history, plan.history!.ids, plan.history!.before, 'main')); } finally { await history.close(); }
  await rollback(f.receipt(), f.options);
  assert.ok(rowsEqual(await codex.snapshot(plan.database!.path, ['child'], f.options), plan.database!.before));
  assert.ok(rowsEqual(await codex.snapshot(plan.history!.path, ['child'], f.options), plan.history!.before));
});

test('in-place update preserves unowned cascade rows and exact original rollout bytes', async t => {
  const f = new Fixture(t), source = await f.codex(), original = readFileSync(source); f.destination = f.source;
  await f.sql(f.source, "DELETE FROM thread_spawn_edges; CREATE TABLE unowned(thread_id TEXT REFERENCES threads(id) ON DELETE CASCADE,value TEXT); INSERT INTO unowned VALUES ('child','preserve')");
  await f.run(await f.plan('codex')); await rollback(f.receipt(), f.options); assert.deepEqual(readFileSync(source), original);
  const db = await f.connection(f.source); try { assert.equal((await db.query('SELECT value FROM unowned'))[0]!.value, 'preserve'); } finally { await db.close(); }
});

test('existing destination dependencies are never silently replaced', async t => {
  const f = new Fixture(t); await f.codex(); await f.run(await f.plan('codex')); await f.sql(f.destination, "INSERT INTO thread_dynamic_tools VALUES ('child',0,'new-tool')");
  await assert.rejects(f.plan('codex'), /dependencies differ/);
});
