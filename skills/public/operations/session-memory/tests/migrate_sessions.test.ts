import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { atomicWrite, privateDir } from '../../../../../runtime/os.js';
import { SqlReal } from '../../../../../runtime/sqlite.js';
import { claude, codex, rollback, rowsEqual, verify } from '../scripts/migrate_sessions.js';
import { compatible, equal, load, noWriter, parseJson, records, save, stable, stringifyJson, transform, write } from '../scripts/session_migration/common.js';
import type { MigrationPlan } from '../scripts/session_migration/types.js';
import { Fixture } from './_fixtures.js';

// Codex schema guards and crash recovery are in migrate_sessions_codex.test.ts.

test('Claude plan is read-only; apply changes cwd only and rollback preserves the source', async t => {
  const f = new Fixture(t), source = f.claude(), before = readFileSync(source), plan = await f.plan();
  assert.equal(existsSync(join(f.destination, 'projects')), false);
  await f.run(plan);
  const row = records(readFileSync(plan.files[0]!.target))[0]!;
  assert.equal(row.cwd, f.project); assert.equal(row.message, f.old); assert.deepEqual(readFileSync(source), before);
  assert.equal((await verify(f.receipt(), f.options)).status, 'verified');
  await rollback(f.receipt(), f.options); assert.equal(existsSync(plan.files[0]!.target), false);
  assert.equal((await rollback(f.receipt(), f.options)).status, 'rolled-back');
});

test('divergent larger transcripts and malformed tails are rejected', async t => {
  const f = new Fixture(t); f.claude(); const plan = await f.plan();
  mkdirSync(dirname(plan.files[0]!.target), { recursive: true }); writeFileSync(plan.files[0]!.target, '{"message":"different and longer transcript"}\n');
  await assert.rejects(f.plan(), /Divergent/);
  f.claude(f.source, Buffer.from('{"cwd":')); await assert.rejects(f.plan(), /Incomplete/);
});

test('strict prefix extension merges across selected profiles and preserves destination extensions', async t => {
  const f = new Fixture(t), source = f.claude(), second = join(f.root, 'second'); mkdirSync(second);
  f.claude(second, Buffer.concat([readFileSync(source), Buffer.from('{"message":"next"}\n')]));
  const plan = await f.plan('claude', [f.source, second]); await f.run(plan);
  assert.equal(records(readFileSync(plan.files[0]!.target)).length, 2);
  appendFileSync(plan.files[0]!.target, '{"message":"newer destination"}\n');
  const next = await f.plan(); await f.run(next, 'receipt2');
  assert.equal(records(readFileSync(next.files[0]!.target)).length, 3);
});

test('source and destination changes invalidate a plan before mutation', async t => {
  const f = new Fixture(t), source = f.claude(), plan = await f.plan(); appendFileSync(source, '{"message":"later"}\n');
  await assert.rejects(f.run(plan), /Source changed/);
  const next = await f.plan(); mkdirSync(dirname(next.files[0]!.target), { recursive: true }); writeFileSync(next.files[0]!.target, '{}\n');
  await assert.rejects(f.run(next, 'receipt2'), /Destination changed/);
});

test('ancillary conflicts, encoded project collisions and symlink escapes preserve both sides', async t => {
  const f = new Fixture(t), source = f.claude(); writeFileSync(join(dirname(source), 'memory.md'), 'original');
  const target = join(f.destination, 'projects', claude.encoded(f.project)); mkdirSync(target, { recursive: true }); writeFileSync(join(target, 'memory.md'), 'user decision');
  await assert.rejects(f.plan(), /Conflicting ancillary/);
  f.claude(f.source, Buffer.from(JSON.stringify({ cwd: join(f.root, 'another-project') }) + '\n')); await assert.rejects(f.plan(), /Ambiguous Claude/);
  f.claude(); rmSync(join(f.destination, 'projects'), { recursive: true }); symlinkSync(join(f.source, 'projects'), join(f.destination, 'projects'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(f.plan(), /symlink/i);
});

test('unselected profiles are excluded and exclusive creation cannot overwrite an intervening file', async t => {
  const f = new Fixture(t); f.claude(); const other = join(f.root, 'verification'); mkdirSync(other); f.claude(other);
  const plan = await f.plan(); assert.deepEqual(plan.profiles, [f.source]); assert.equal(plan.files.length, 1);
  const target = join(f.root, 'new-file'); writeFileSync(target, 'user work'); assert.throws(() => write(target, Buffer.from('replacement'), true)); assert.equal(readFileSync(target, 'utf8'), 'user work');
});

test('Codex preserves IDs, parent edges, arbitrary int64 and indexed history with UTF-8 byte offsets', async t => {
  const f = new Fixture(t), source = await f.codex(), before = readFileSync(source); f.project = join(f.root, '이관-완료'); mkdirSync(f.project);
  const originalHistory = await codex.snapshot(join(f.source, 'thread_history_1.sqlite'), ['child'], f.options), plan = await f.plan('codex');
  const saved = join(f.root, 'plan.json'); save(saved, plan); const loaded = load(saved) as MigrationPlan;
  assert.equal(loaded.history!.after.thread_items![0]!.created_at_ms, 9007199254740993n);
  await f.run(loaded); assert.deepEqual(readFileSync(source), before);
  const raw = readFileSync(plan.files[0]!.target), meta = records(raw)[0]!.payload;
  assert.equal(meta.id, 'child'); assert.equal(meta.session_id, 'parent'); assert.equal(meta.cwd, f.project);
  const actual = await codex.snapshot(join(f.destination, 'thread_history_1.sqlite'), ['child'], f.options);
  assert.equal(actual.thread_turns![0]!.rollout_byte_offset, raw.indexOf(10) + 1); assert.equal(actual.thread_turns![0]!.rollout_end_byte_offset, raw.length);
  assert.equal(actual.thread_history_projection_state![0]!.next_rollout_byte_offset, raw.length);
  assert.ok(equal(actual.thread_items, originalHistory.thread_items)); assert.ok(equal(actual.thread_realtime_items, originalHistory.thread_realtime_items));
  assert.equal((await verify(f.receipt(), f.options)).status, 'verified');
  await f.sql(f.destination, "INSERT INTO thread_history_projection_state VALUES ('unrelated',0,0)", 'history');
  await rollback(f.receipt(), f.options);
  assert.ok(Object.values(await codex.snapshot(join(f.destination, 'thread_history_1.sqlite'), ['child'], f.options)).every(rows => rows.length === 0));
  assert.ok(rowsEqual(await codex.snapshot(join(f.source, 'thread_history_1.sqlite'), ['child'], f.options), originalHistory));
  assert.equal((await codex.snapshot(join(f.destination, 'thread_history_1.sqlite'), ['unrelated'], f.options)).thread_history_projection_state!.length, 1);
});

test('Codex source index names survive, and rollback retains unrelated later threads and index appends', async t => {
  const f = new Fixture(t); await f.codex(); const entry = { id: 'child', thread_name: 'User chosen name', updated_at: '2026-01-01T01:00:00Z' };
  writeFileSync(join(f.source, 'session_index.jsonl'), JSON.stringify(entry) + '\n'); await f.run(await f.plan('codex'));
  assert.ok(equal(records(readFileSync(join(f.destination, 'session_index.jsonl')))[0], entry));
  await f.sql(f.destination, "INSERT INTO threads VALUES ('other','elsewhere','file','Other',101,NULL,NULL)");
  appendFileSync(join(f.destination, 'session_index.jsonl'), '{"id":"other","thread_name":"Other","updated_at":"later"}\n');
  await rollback(f.receipt(), f.options);
  const db = await f.connection(f.destination); try { assert.deepEqual((await db.query('SELECT id FROM threads ORDER BY id')).map(row => row.id), ['other', 'parent']); } finally { await db.close(); }
  assert.equal(records(readFileSync(join(f.destination, 'session_index.jsonl')))[0]!.id, 'other');
});

test('new user file/history changes and corrupted backups block rollback without replacement', async t => {
  const f = new Fixture(t); f.claude(); const plan = await f.plan(); await f.run(plan); appendFileSync(plan.files[0]!.target, '{"message":"new work"}\n');
  await assert.rejects(rollback(f.receipt(), f.options), /newer changes/); assert.match(readFileSync(plan.files[0]!.target, 'utf8'), /new work/);
  const g = new Fixture(t); const source = g.claude(); const p = await g.plan(); mkdirSync(dirname(p.files[0]!.target), { recursive: true }); writeFileSync(p.files[0]!.target, readFileSync(source)); await g.run(await g.plan());
  const journal = load(join(g.receipt(), 'receipt.json')), current = readFileSync(journal.files[0].target); writeFileSync(join(g.receipt(), journal.files[0].backup), 'corrupted');
  await assert.rejects(rollback(g.receipt(), g.options), /backup/); assert.deepEqual(readFileSync(journal.files[0].target), current);
  const h = new Fixture(t); await h.codex(); let hp = await h.plan('codex'); await h.sql(h.source, "UPDATE thread_items SET item_json='changed source'", 'history'); await assert.rejects(h.run(hp), /Source session metadata changed/);
  hp = await h.plan('codex'); await h.run(hp); await h.sql(h.destination, "UPDATE thread_items SET item_json='later work'", 'history'); await assert.rejects(rollback(h.receipt(), h.options), /newer changes/);
});

test('unchanged JSONL bytes survive, metadata int64 and Python float representations stay exact', () => {
  const source = Buffer.from('{ "type": "session_meta", "payload": {"cwd":"/old", "n":9007199254740993,"cost":1.0,"tiny":1e-6,"2":"two","1":"one"}}\r\n\r\n{ "type": "response_item", "payload": {"text": "literal /old", "n":9223372036854775807}}\r\n');
  const result = transform(source, 'codex', '/old', '/새');
  assert.equal(result.toString(), '{"type":"session_meta","payload":{"cwd":"/새","n":9007199254740993,"cost":1.0,"tiny":1e-06,"2":"two","1":"one"}}\n\r\n{ "type": "response_item", "payload": {"text": "literal /old", "n":9223372036854775807}}\r\n');
  assert.equal(parseJson('9007199254740993'), 9007199254740993n); assert.ok(parseJson('1.0') instanceof SqlReal);
  assert.equal(stringifyJson(parseJson('{"f":1.0}')), '{"f":1.0}');
  assert.throws(() => compatible(Buffer.from('{"n":9007199254740993}\n'), Buffer.from('{"n":9007199254740992}\n')), /Divergent/);
});

test('writer detector fails closed for an actual held-open writer', t => {
  const f = new Fixture(t), file = f.claude(), fd = openSync(file, 'a');
  try { assert.throws(() => noWriter(file), /writer|requires lsof|close/i); } finally { closeSync(fd); }
});

test('Python v1 canonical hash preserves float markers, Unicode codepoint sorting and arbitrary integers', () => {
  // Generated independently with Python json.dumps(sort_keys=True,separators=(',',':')).
  const value = parseJson('{"😀":"astral","\ue000":"bmp","é":"한글","float":1.0,"tiny":1e-6,"large":9007199254740993,"2":"two","1":"one","del":"\\u007f"}');
  assert.equal(stable(value), '963544388c77879e098a0e073130034d431beb91fc3ecda75b61d9759e2d0b75');
  assert.deepEqual(compatible(Buffer.from('{"n":1}\n'), Buffer.from('{"n":1.0}\n')), Buffer.from('{"n":1}\n'));
});

test('session rollback preserves live locks and explicitly recovers only a dead same-host owner', async t => {
  const f = new Fixture(t); f.claude(); const plan = await f.plan(); await f.run(plan);
  const lock = join(f.destination, '.jstack-session-migration.lock'); privateDir(lock, { exclusive: true });
  atomicWrite(join(lock, 'owner.json'), Buffer.from(stringifyJson({ pid: process.pid, host: hostname(), token: 'live-owner' })));
  await assert.rejects(rollback(f.receipt(), f.options), /still active/); assert.ok(existsSync(plan.files[0]!.target));
  const dead = spawnSync(process.execPath, ['-e', 'process.exit(0)']); assert.equal(dead.status, 0);
  atomicWrite(join(lock, 'owner.json'), Buffer.from(stringifyJson({ pid: dead.pid, host: hostname(), token: 'dead-owner' })));
  assert.equal((await rollback(f.receipt(), f.options)).status, 'rolled-back'); assert.equal(existsSync(lock), false);
});

test('forged migration paths cannot expand the explicit profile scope', async t => {
  const f = new Fixture(t); f.claude(); const plan = await f.plan();
  plan.files[0]!.target = join(f.root, 'outside-target');
  await assert.rejects(f.run(plan), /escapes its explicit profile/);
  assert.equal(existsSync(join(f.root, 'outside-target')), false);
});
