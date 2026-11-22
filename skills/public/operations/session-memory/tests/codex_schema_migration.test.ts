import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqliteDatabase } from '../../../../../runtime/sqlite.js';
import { apply, codex, createPlan, rollback, verify } from '../scripts/migrate_sessions.js';
import { records } from '../scripts/session_migration/common.js';
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
  transcript() { return Buffer.from(JSON.stringify({ type: 'session_meta', payload: { id: 'child', session_id: 'parent', cwd: this.old, account_scoped: true, creator_user_id: 'source-user', creator_account_id: 'source-account' } }) + '\n' + JSON.stringify({ type: 'response_item', payload: { text: `Historical command: cd ${this.old}` } }) + '\n'); }
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
  async modernSchema(profile: string) {
    await this.sql(profile, `DROP TABLE thread_artifacts;
      CREATE TABLE thread_attachments(id TEXT PRIMARY KEY,thread_id TEXT REFERENCES threads(id),payload TEXT);
      CREATE TABLE thread_read_receipts(thread_id TEXT PRIMARY KEY,revision TEXT);
      CREATE TABLE session_model_ids(session_id TEXT,kind TEXT,PRIMARY KEY(session_id,kind));`);
  }
  plan(host: Host = 'claude', profiles = [this.source]) { return createPlan(host, profiles, this.destination, this.old, this.project, this.options); }
  async run(plan: MigrationPlan, name = 'receipt', options = this.options) { return apply(plan, this.receipt(name), options); }
}


test('modern Codex schema migrates and rolls back attachments, receipts and model IDs', async t => {
  const f = new Fixture(t); await f.codex();
  await f.modernSchema(f.source); await f.modernSchema(f.destination);
  await f.sql(f.source, "INSERT INTO thread_attachments VALUES ('a','child','attachment'); INSERT INTO thread_read_receipts VALUES ('child','revision'); INSERT INTO session_model_ids VALUES ('child','model')");
  const plan = await f.plan('codex'); await f.run(plan);
  const rows = await codex.snapshot(plan.database!.path, ['child'], f.options);
  assert.equal(rows.thread_attachments![0]!.payload, 'attachment');
  assert.equal(rows.thread_read_receipts![0]!.revision, 'revision');
  assert.equal(rows.session_model_ids![0]!.kind, 'model');
  assert.equal((await verify(f.receipt(), f.options)).status, 'verified');
  await f.sql(f.destination, "UPDATE thread_read_receipts SET revision='later' WHERE thread_id='child'");
  await assert.rejects(rollback(f.receipt(), f.options), /newer changes/);
  await f.sql(f.destination, "UPDATE thread_read_receipts SET revision='revision' WHERE thread_id='child'");
  await rollback(f.receipt(), f.options);
  assert.ok(Object.values(await codex.snapshot(plan.database!.path, ['child'], f.options)).every(entries => entries.length === 0));
});

test('different optional Codex state tables fail before mutation', async t => {
  const f = new Fixture(t); await f.codex(); await f.modernSchema(f.source);
  await assert.rejects(f.plan('codex'), /schemas differ/);
  assert.equal(existsSync(join(f.destination, 'sessions')), false);
});

test('unknown Codex state schema without artifacts or attachments is rejected', async t => {
  const f = new Fixture(t); await f.codex();
  await f.sql(f.source, 'DROP TABLE thread_artifacts');
  await assert.rejects(f.plan('codex'), /missing artifacts and attachments/);
});

test('explicit destination owner is applied to session metadata and database with history offsets preserved', async t => {
  const f = new Fixture(t); const source = await f.codex();
  for (const profile of [f.source, f.destination]) await f.sql(profile, 'ALTER TABLE threads ADD COLUMN creator_user_id TEXT; ALTER TABLE threads ADD COLUMN creator_account_id TEXT');
  await f.sql(f.source, "UPDATE threads SET creator_user_id='source-user',creator_account_id='source-account' WHERE id='child'");
  await f.sql(f.destination, "UPDATE threads SET creator_user_id='destination-user-long',creator_account_id='destination-account-long' WHERE id='parent'");
  const before = readFileSync(source);
  const plan = await createPlan('codex', [f.source], f.destination, f.old, f.project, { ...f.options, targetOwnerThread: 'parent' });
  await f.run(plan);
  const target = readFileSync(plan.files[0]!.target), metadata = records(target)[0]!.payload;
  assert.equal(metadata.creator_user_id, 'destination-user-long'); assert.equal(metadata.creator_account_id, 'destination-account-long');
  const state = await codex.snapshot(plan.database!.path, ['child'], f.options);
  assert.equal(state.threads![0]!.creator_account_id, metadata.creator_account_id);
  const history = await codex.snapshot(plan.history!.path, ['child'], f.options);
  assert.equal(history.thread_turns![0]!.rollout_byte_offset, target.indexOf(10) + 1);
  assert.equal(history.thread_history_projection_state![0]!.next_rollout_byte_offset, target.length);
  assert.equal((await verify(f.receipt(), f.options)).status, 'verified');
  await rollback(f.receipt(), f.options); assert.deepEqual(readFileSync(source), before);
});

test('destination account changes and inconsistent source ownership block rebinding', async t => {
  const f = new Fixture(t); await f.codex();
  for (const profile of [f.source, f.destination]) await f.sql(profile, 'ALTER TABLE threads ADD COLUMN creator_user_id TEXT; ALTER TABLE threads ADD COLUMN creator_account_id TEXT');
  await f.sql(f.source, "UPDATE threads SET creator_user_id='source-user',creator_account_id='source-account' WHERE id='child'");
  await f.sql(f.destination, "UPDATE threads SET creator_user_id='dest-user',creator_account_id='dest-account' WHERE id='parent'");
  const options = { ...f.options, targetOwnerThread: 'parent' };
  const plan = await createPlan('codex', [f.source], f.destination, f.old, f.project, options);
  await f.sql(f.destination, "UPDATE threads SET creator_account_id='changed' WHERE id='parent'");
  await assert.rejects(f.run(plan), /Plan no longer matches/);
  await f.sql(f.source, "UPDATE threads SET creator_user_id='different' WHERE id='child'");
  await assert.rejects(createPlan('codex', [f.source], f.destination, f.old, f.project, options), /Source ownership differs/);
});

