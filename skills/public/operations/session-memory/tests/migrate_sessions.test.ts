import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { appendFileSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWrite, privateDir } from '../../../../../runtime/os.js';
import { SqliteDatabase, SqlReal } from '../../../../../runtime/sqlite.js';
import { apply, claude, codex, createPlan, rollback, rowsEqual, verify } from '../scripts/migrate_sessions.js';
import { compatible, equal, fingerprint, load, noWriter, parseJson, records, save, stable, stringifyJson, transform, write } from '../scripts/session_migration/common.js';
import type { Host, MigrationOptions, MigrationPlan } from '../scripts/session_migration/types.js';

const nativeRoot = fileURLToPath(new URL('../../../../../native/sqlite3', import.meta.url));
const cacheRoot = join(realpathSync(tmpdir()), `jstack-migration-native-cache-${process.pid}`);
const native = { nativeRoot, cacheRoot };
class Fixture {
  readonly root = mkdtempSync(join(realpathSync(tmpdir()), 'jstack-session-migration-'));
  old = join(this.root, 'missing-old-project');
  project = join(this.root, 'project');
  source = join(this.root, 'source');
  destination = join(this.root, 'destination');
  options: MigrationOptions = { ...native, noWriter: () => undefined };
  constructor(t: TestContext) { for (const path of [this.project, this.source, this.destination]) mkdirSync(path); t.after(() => rmSync(this.root, { recursive: true, force: true })); }
  receipt(name = 'receipt') { return join(this.root, name); }
  transcript() { return Buffer.from(JSON.stringify({ type: 'session_meta', payload: { id: 'child', session_id: 'parent', cwd: this.old } }) + '\n' + JSON.stringify({ type: 'response_item', payload: { text: `Historical command: cd ${this.old}` } }) + '\n'); }
  claude(profile = this.source, bytes?: Buffer): string {
    const file = join(profile, 'projects', claude.encoded(this.old), 'one.jsonl'); mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, bytes ?? Buffer.from(JSON.stringify({ sessionId: 'one', cwd: this.old, message: this.old }) + '\n')); return file;
  }
  async connection(profile: string, kind = 'state') { return SqliteDatabase.open(join(profile, kind === 'history' ? 'thread_history_1.sqlite' : 'state_5.sqlite'), { ...native, readonly: false }); }
  async sql(profile: string, sql: string, kind = 'state') { const db = await this.connection(profile, kind); try { await db.exec(sql); } finally { await db.close(); } }
  async initialize(profile: string) {
    const db = await SqliteDatabase.open(join(profile, 'state_5.sqlite'), { ...native, readonly: false, fileMustExist: false });
    try { await db.exec(`
      CREATE TABLE threads(id TEXT PRIMARY KEY,cwd TEXT,rollout_path TEXT,title TEXT,updated_at INTEGER,project_id TEXT,thread_section_id TEXT);
      CREATE TABLE thread_dynamic_tools(thread_id TEXT REFERENCES threads(id),position INTEGER,name TEXT,PRIMARY KEY(thread_id,position));
      CREATE TABLE thread_spawn_edges(child_thread_id TEXT PRIMARY KEY,parent_thread_id TEXT,status TEXT);
      CREATE TABLE thread_artifacts(id TEXT PRIMARY KEY,thread_id TEXT REFERENCES threads(id),payload TEXT);
    `); } finally { await db.close(); }
    const history = await SqliteDatabase.open(join(profile, 'thread_history_1.sqlite'), { ...native, readonly: false, fileMustExist: false });
    try { await history.exec(`
      CREATE TABLE thread_turns(thread_id TEXT,turn_id TEXT,rollout_ordinal INTEGER,status TEXT,error_json TEXT,started_at INTEGER,completed_at INTEGER,duration_ms INTEGER,first_user_item_id TEXT,final_agent_item_id TEXT,rollout_byte_offset INTEGER,rollout_end_ordinal INTEGER,rollout_end_byte_offset INTEGER,PRIMARY KEY(thread_id,turn_id));
      CREATE TABLE thread_items(thread_id TEXT,turn_id TEXT,item_id TEXT,rollout_ordinal INTEGER,created_at_ms INTEGER,item_json TEXT,item_type TEXT,updated_at_ordinal INTEGER,PRIMARY KEY(thread_id,turn_id,item_id));
      CREATE TABLE thread_history_projection_state(thread_id TEXT PRIMARY KEY,next_rollout_byte_offset INTEGER,next_rollout_ordinal INTEGER);
      CREATE TABLE thread_realtime_items(thread_id TEXT,item_id TEXT,rollout_ordinal INTEGER,created_at_ms INTEGER,item_type TEXT,item_json TEXT,PRIMARY KEY(thread_id,item_id));
    `); } finally { await history.close(); }
  }
  async codex(): Promise<string> {
    await this.initialize(this.source); await this.initialize(this.destination);
    const path = join(this.source, 'sessions/2026/01/01/child.jsonl'); mkdirSync(dirname(path), { recursive: true }); const raw = this.transcript(); writeFileSync(path, raw);
    const source = await this.connection(this.source);
    try { await source.execute('INSERT INTO threads VALUES (?,?,?,?,?,?,?)', ['child', this.old, path, 'Child title', 100, null, null]); await source.execute('INSERT INTO thread_spawn_edges VALUES (?,?,?)', ['child', 'parent', 'completed']); } finally { await source.close(); }
    await this.sql(this.destination, "INSERT INTO threads VALUES ('parent','other-project','parent-rollout','Parent',50,NULL,NULL)");
    const history = await this.connection(this.source, 'history'), body = JSON.stringify({ text: 'History body kept verbatim' });
    try {
      await history.execute('INSERT INTO thread_turns VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', ['child', 'turn-1', 1, 'completed', null, 100, 200, 100, 'item-1', 'item-1', raw.indexOf(10) + 1, 2, raw.length]);
      await history.execute('INSERT INTO thread_items VALUES (?,?,?,?,?,?,?,?)', ['child', 'turn-1', 'item-1', 1, 9007199254740993n, body, 'userMessage', 1]);
      await history.execute('INSERT INTO thread_history_projection_state VALUES (?,?,?)', ['child', raw.length, 2]);
      await history.execute('INSERT INTO thread_realtime_items VALUES (?,?,?,?,?,?)', ['child', 'realtime-1', 1, 9223372036854775807n, 'userMessage', body]);
    } finally { await history.close(); }
    return path;
  }
  plan(host: Host = 'claude', profiles = [this.source]) { return createPlan(host, profiles, this.destination, this.old, this.project, this.options); }
  async run(plan: MigrationPlan, name = 'receipt', options = this.options) { return apply(plan, this.receipt(name), options); }
}

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

test('new user file/history changes and corrupted backups block rollback without replacement', async t => {
  const f = new Fixture(t); f.claude(); const plan = await f.plan(); await f.run(plan); appendFileSync(plan.files[0]!.target, '{"message":"new work"}\n');
  await assert.rejects(rollback(f.receipt(), f.options), /newer changes/); assert.match(readFileSync(plan.files[0]!.target, 'utf8'), /new work/);
  const g = new Fixture(t); const source = g.claude(); const p = await g.plan(); mkdirSync(dirname(p.files[0]!.target), { recursive: true }); writeFileSync(p.files[0]!.target, readFileSync(source)); await g.run(await g.plan());
  const journal = load(join(g.receipt(), 'receipt.json')), current = readFileSync(journal.files[0].target); writeFileSync(join(g.receipt(), journal.files[0].backup), 'corrupted');
  await assert.rejects(rollback(g.receipt(), g.options), /backup/); assert.deepEqual(readFileSync(journal.files[0].target), current);
  const h = new Fixture(t); await h.codex(); let hp = await h.plan('codex'); await h.sql(h.source, "UPDATE thread_items SET item_json='changed source'", 'history'); await assert.rejects(h.run(hp), /Source session metadata changed/);
  hp = await h.plan('codex'); await h.run(hp); await h.sql(h.destination, "UPDATE thread_items SET item_json='later work'", 'history'); await assert.rejects(rollback(h.receipt(), h.options), /newer changes/);
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
