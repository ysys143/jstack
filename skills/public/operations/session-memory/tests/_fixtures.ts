/** Shared fixtures for the session migration test files: temporary profiles, Codex databases and the SQLite addon cache. */
import type { TestContext } from 'node:test';
import { after } from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { memoryTemporaryRoot } from '../../../../../runtime/fixtures/memory_tmp.js';
import { atomicWrite, privateDir } from '../../../../../runtime/os.js';
import { SqliteDatabase } from '../../../../../runtime/sqlite.js';
import { lockedBinary, nativePlatform, validateNativeManifest } from '../../../../../runtime/sqlite-native.js';
import { apply, claude, createPlan } from '../scripts/migrate_sessions.js';
import type { Host, MigrationOptions, MigrationPlan } from '../scripts/session_migration/types.js';

const nativeRoot = fileURLToPath(new URL('../../../../../native/sqlite3', import.meta.url));
// Receipts, journals and SQLite commits made about two thousand disk syncs in one file; the addon cache holds native code.
const temporary = memoryTemporaryRoot(realpathSync(tmpdir()));
// Every SQLite open lists the cache root's parent to rule out case collisions, and the system temp directory can hold
// thousands of entries. The cache therefore sits inside a directory of its own, removed when the process ends.
const cacheParent = mkdtempSync(join(temporary, 'jstack-migration-native-')), cacheRoot = join(cacheParent, 'sqlite3');
after(() => { if (process.platform !== 'win32') rmSync(cacheParent, { recursive: true, force: true }); });
/**
 * A process's own cache is deleted when it ends, so its addon skips the disk sync that preparedNative gives the lasting
 * user cache. preparedNative still verifies its size and hash on every open.
 */
let seeded = false;
const seed = () => {
  if (seeded) return; seeded = true;
  const asset = validateNativeManifest(readFileSync(join(nativeRoot, 'manifest.json'))).assets.find(row => row.key === nativePlatform());
  if (!asset) return;
  const target = join(cacheRoot, asset.binarySha256);
  privateDir(cacheRoot); privateDir(target);
  atomicWrite(join(target, 'node_sqlite3.node'), lockedBinary(readFileSync(join(nativeRoot, `${asset.key}.tar.gz`)), asset), true, false);
};
/** One prepared SQLite addon per test process. */
export const native = { nativeRoot, get cacheRoot() { seed(); return cacheRoot; } };

export class Fixture {
  readonly root = mkdtempSync(join(temporary, 'jstack-session-migration-'));
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
