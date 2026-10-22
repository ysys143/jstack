import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestContext } from 'node:test';
import { SqliteDatabase, type SqlValue } from '../runtime/sqlite.js';
import { apply, claude, codex, createPlan, type MigrationOptions, type MigrationPlan } from '../skills/public/operations/session-memory/scripts/migrate_sessions.js';
import type { Host } from '../skills/public/operations/session-memory/scripts/session_migration/types.js';
import { box, write } from './_fixtures.js';
export class MigrationFixture {
  readonly root: string; old: string; project: string; source: string; dest: string; options: MigrationOptions;
  constructor(t: TestContext) {
    this.root = box(t, 'jstack-root-migration-'); this.old = join(this.root, 'missing-old-project'); this.project = join(this.root, 'project'); this.source = join(this.root, 'source'); this.dest = join(this.root, 'destination');
    for (const path of [this.project, this.source, this.dest]) mkdirSync(path);
    this.options = { nativeRoot: fileURLToPath(new URL('../native/sqlite3', import.meta.url)), cacheRoot: join(this.root, 'native-cache'), noWriter: () => undefined };
  }
  transcript(identity = 'child', parent = 'parent'): Buffer { return Buffer.from(JSON.stringify({ type: 'session_meta', payload: { id: identity, session_id: parent, cwd: this.old } }) + '\n' + JSON.stringify({ type: 'response_item', payload: { text: `Historical command: cd ${this.old}` } }) + '\n'); }
  claude(profile = this.source, text?: Buffer): string { return write(join(profile, 'projects', claude.encoded(this.old), 'one.jsonl'), text ?? Buffer.from(JSON.stringify({ sessionId: 'one', cwd: this.old, message: this.old }) + '\n')); }
  path(profile: string, kind = 'state'): string { return join(profile, kind === 'history' ? 'thread_history_1.sqlite' : 'state_5.sqlite'); }
  async connection(profile: string, kind = 'state', create = false) { return SqliteDatabase.open(this.path(profile, kind), { ...this.options, readonly: false, fileMustExist: !create }); }
  async sql(profile: string, sql: string, kind = 'state', values?: SqlValue[]) { const db = await this.connection(profile, kind); try { if (values) await db.execute(sql, values); else await db.exec(sql); } finally { await db.close(); } }
  async rows(profile: string, table: string, kind = 'state') { const db = await this.connection(profile, kind); try { return await db.typedRows(table); } finally { await db.close(); } }
  async initialize(profile: string) {
    const db = await this.connection(profile, 'state', true);
    try { await db.exec(`CREATE TABLE threads(id TEXT PRIMARY KEY,cwd TEXT,rollout_path TEXT,title TEXT,updated_at INTEGER,project_id TEXT,thread_section_id TEXT);
CREATE TABLE thread_dynamic_tools(thread_id TEXT REFERENCES threads(id),position INTEGER,name TEXT,PRIMARY KEY(thread_id,position));
CREATE TABLE thread_spawn_edges(child_thread_id TEXT PRIMARY KEY,parent_thread_id TEXT,status TEXT);
CREATE TABLE thread_artifacts(id TEXT PRIMARY KEY,thread_id TEXT REFERENCES threads(id),payload TEXT);`); } finally { await db.close(); }
    const history = await this.connection(profile, 'history', true);
    try { await history.exec(`CREATE TABLE thread_turns(thread_id TEXT,turn_id TEXT,rollout_ordinal INTEGER,status TEXT,error_json TEXT,started_at INTEGER,completed_at INTEGER,duration_ms INTEGER,first_user_item_id TEXT,final_agent_item_id TEXT,rollout_byte_offset INTEGER,rollout_end_ordinal INTEGER,rollout_end_byte_offset INTEGER,PRIMARY KEY(thread_id,turn_id));
CREATE TABLE thread_items(thread_id TEXT,turn_id TEXT,item_id TEXT,rollout_ordinal INTEGER,created_at_ms INTEGER,item_json TEXT,item_type TEXT,updated_at_ordinal INTEGER,PRIMARY KEY(thread_id,turn_id,item_id));
CREATE TABLE thread_history_projection_state(thread_id TEXT PRIMARY KEY,next_rollout_byte_offset INTEGER,next_rollout_ordinal INTEGER);
CREATE TABLE thread_realtime_items(thread_id TEXT,item_id TEXT,rollout_ordinal INTEGER,created_at_ms INTEGER,item_type TEXT,item_json TEXT,PRIMARY KEY(thread_id,item_id));`); } finally { await history.close(); }
  }
  async codex(): Promise<string> {
    await this.initialize(this.source); await this.initialize(this.dest);
    const path = write(join(this.source, 'sessions/2026/01/01/child.jsonl'), this.transcript());
    await this.sql(this.source, 'INSERT INTO threads VALUES (?,?,?,?,?,?,?)', 'state', ['child', this.old, path, 'Child title', 100, null, null]);
    await this.sql(this.source, "INSERT INTO thread_spawn_edges VALUES ('child','parent','completed')");
    await this.sql(this.dest, "INSERT INTO threads VALUES ('parent','other-project','parent-rollout','Parent',50,NULL,NULL)");
    const raw = readFileSync(path), body = JSON.stringify({ text: 'History body kept verbatim' });
    await this.sql(this.source, 'INSERT INTO thread_turns VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', 'history', ['child', 'turn-1', 1, 'completed', null, 100, 200, 100, 'item-1', 'item-1', raw.indexOf(10) + 1, 2, raw.length]);
    await this.sql(this.source, 'INSERT INTO thread_items VALUES (?,?,?,?,?,?,?,?)', 'history', ['child', 'turn-1', 'item-1', 1, 100, body, 'userMessage', 1]);
    await this.sql(this.source, 'INSERT INTO thread_history_projection_state VALUES (?,?,?)', 'history', ['child', raw.length, 2]);
    await this.sql(this.source, 'INSERT INTO thread_realtime_items VALUES (?,?,?,?,?,?)', 'history', ['child', 'realtime-1', 1, 100, 'userMessage', body]); return path;
  }
  plan(host: Host = 'claude', profiles = [this.source]): Promise<MigrationPlan> { return createPlan(host, profiles, this.dest, this.old, this.project, this.options); }
  receipt(name = 'receipt'): string { return join(this.root, name); }
  apply(plan: MigrationPlan, name = 'receipt', options = this.options) { return apply(plan, this.receipt(name), options); }
  snapshot(profile: string, kind = 'state', ids = ['child']) { return codex.snapshot(this.path(profile, kind), ids, this.options); }
}
