/** Codex native state/history adapter, with lossless SQLite rows and byte-offset remapping. */
import { existsSync, lstatSync, readdirSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { SqliteDatabase, identifier, type SqlValue } from '../../../../../../runtime/sqlite.js';
import { blank, equal, lines, MigrationError, read, records } from './common.js';
import { files } from './claude.js';
import type { Discovered, MigrationOptions, Rows } from './types.js';
export const RELATED: Record<string, string> = { thread_dynamic_tools: 'thread_id', thread_spawn_edges: 'child_thread_id', thread_artifacts: 'thread_id' };
export const HISTORY: Record<string, string> = { thread_turns: 'thread_id', thread_items: 'thread_id', thread_history_projection_state: 'thread_id', thread_realtime_items: 'thread_id' };
export const LOCAL_ASSOCIATIONS = ['project_id', 'thread_section_id', 'section_position', 'section_entered_at_ms'];
export function database(profile: string, kind = 'state'): string {
  const pattern = kind === 'history' ? /^thread_history_.*\.sqlite$/ : /^state_.*\.sqlite$/;
  const paths = readdirSync(profile).filter(name => pattern.test(name)).sort().map(name => join(profile, name));
  if (paths.length !== 1) throw new MigrationError(`Exactly one initialized Codex ${kind} database is required`);
  if (lstatSync(paths[0]!).isSymbolicLink()) throw new MigrationError('Resolve database symlinks explicitly before migration');
  return paths[0]!;
}
export const connect = (path: string, readonly = true, options: MigrationOptions = {}): Promise<SqliteDatabase> => SqliteDatabase.open(path, { ...options, readonly });
export function discover(profiles: string[], old: string, next: string): Discovered[] {
  const result: Discovered[] = [];
  for (const profile of profiles) {
    const directory = join(profile, 'sessions');
    if (!existsSync(directory) || !lstatSync(directory).isDirectory()) throw new MigrationError(`Codex sessions directory missing: ${directory}`);
    if (lstatSync(directory).isSymbolicLink()) throw new MigrationError('Session symlink requires explicit resolution');
    for (const source of files(directory)) {
      if (!source.endsWith('.jsonl')) continue;
      const data = read(source)!; const first = records(lines(data)[0] ?? Buffer.alloc(0))[0];
      if (!first || first.type !== 'session_meta') continue;
      const meta = first.payload ?? {};
      if (meta.cwd === old || meta.cwd === next) {
        const identity = meta.id || meta.session_id;
        if (typeof identity !== 'string' || !identity) throw new MigrationError(`Session has no identity: ${source}`);
        result.push({ source, relative: relative(profile, source), identity });
      }
    }
  }
  return result;
}
export async function snapshot(path: string, ids: string[], options: MigrationOptions = {}, held?: { connection: SqliteDatabase; schema: string }): Promise<Rows> {
  const db = held?.connection ?? await connect(path, true, options), schema = held?.schema ?? 'main';
  try {
    const result: Rows = {}, tables = basename(path).startsWith('thread_history_') ? HISTORY : { threads: 'id', ...RELATED };
    for (const [table, key] of Object.entries(tables)) {
      if (!(await db.columns(table, schema)).length) throw new MigrationError(`Unsupported Codex schema: missing ${table}`);
      result[table] = await db.typedRows(table, `${identifier(key)} IN (${ids.map(() => '?').join(',')})`, ids, schema);
    }
    return result;
  } finally { if (!held) await db.close(); }
}
export async function prepare(profile: string, destination: string, identity: string, sourcePath: string, target: string, next: string, options: MigrationOptions = {}): Promise<Rows> {
  const source = database(profile), targetDb = database(destination), a = await connect(source, true, options);
  try {
    const b = await connect(targetDb, true, options);
    try {
      if (basename(source) !== basename(targetDb)) throw new MigrationError('Codex database schemas differ; migration is not supported');
      for (const table of ['threads', ...Object.keys(RELATED)]) if (!equal(await a.columns(table), await b.columns(table))) throw new MigrationError('Codex database schemas differ; migration is not supported');
    } finally { await b.close(); }
  } finally { await a.close(); }
  const rows = await snapshot(source, [identity], options);
  if (rows.threads!.length !== 1) throw new MigrationError('Indexed metadata missing for rollout; repair the source index first');
  const thread = rows.threads![0]!;
  if (typeof thread.rollout_path !== 'string' || resolve(thread.rollout_path) !== resolve(sourcePath)) throw new MigrationError('Duplicate session ID points at a different source rollout');
  if (profile !== destination) for (const key of LOCAL_ASSOCIATIONS) if (Object.hasOwn(thread, key)) thread[key] = null;
  thread.cwd = next; thread.rollout_path = target;
  return rows;
}
export async function prepareHistory(profile: string, destination: string, identity: string, original: Buffer, migrated: Buffer, options: MigrationOptions = {}): Promise<Rows> {
  const source = database(profile, 'history'), target = database(destination, 'history'), a = await connect(source, true, options);
  try {
    const b = await connect(target, true, options);
    try {
      if (basename(source) !== basename(target)) throw new MigrationError('Codex history schemas differ; migration is not supported');
      for (const table of Object.keys(HISTORY)) { const names = await a.columns(table); if (!names.length || !equal(names, await b.columns(table))) throw new MigrationError('Codex history schemas differ; migration is not supported'); }
    } finally { await b.close(); }
  } finally { await a.close(); }
  const rows = await snapshot(source, [identity], options), oldLines = lines(original), newLines = lines(migrated);
  if (newLines.length < oldLines.length || oldLines.some((line, index) => blank(line) !== blank(newLines[index]!))) throw new MigrationError('Cannot preserve history ordinals across different JSONL line layouts');
  const offsets = new Map<string, number>([['0', 0]]); let oldOffset = 0, newOffset = 0;
  oldLines.forEach((line, index) => { oldOffset += line.length; newOffset += newLines[index]!.length; offsets.set(String(oldOffset), newOffset); });
  for (const entries of Object.values(rows)) for (const row of entries) for (const [key, value] of Object.entries(row)) if (key.endsWith('byte_offset') && value !== null) {
    const replacement = offsets.get(String(value)); if (replacement === undefined) throw new MigrationError('History cursor does not align with its source rollout'); row[key] = replacement;
  }
  return rows;
}
export async function replaceHistory(db: SqliteDatabase, ids: string[], rows: Rows, schema = 'history'): Promise<void> {
  for (const table of Object.keys(HISTORY)) {
    await db.execute(`DELETE FROM ${identifier(schema)}.${identifier(table)} WHERE thread_id IN (${ids.map(() => '?').join(',')})`, ids);
    for (const row of rows[table]!) {
      const names = Object.keys(row);
      await db.execute(`INSERT INTO ${identifier(schema)}.${identifier(table)} (${names.map(identifier).join(',')}) VALUES (${names.map(() => '?').join(',')})`, names.map(name => row[name] as SqlValue));
    }
  }
}
export async function replaceRows(db: SqliteDatabase, ids: string[], rows: Rows): Promise<void> {
  for (const [table, key] of Object.entries(RELATED)) await db.execute(`DELETE FROM ${identifier(table)} WHERE ${identifier(key)} IN (${ids.map(() => '?').join(',')})`, ids);
  const retained = new Set(rows.threads!.map(row => row.id));
  for (const identity of ids) if (!retained.has(identity)) await db.execute('DELETE FROM threads WHERE id=?', [identity]);
  for (const table of ['threads', ...Object.keys(RELATED)]) for (const row of rows[table]!) {
    const names = Object.keys(row);
    const conflict = table === 'threads' ? ` ON CONFLICT(id) DO UPDATE SET ${names.filter(name => name !== 'id').map(name => `${identifier(name)}=excluded.${identifier(name)}`).join(',')}` : '';
    await db.execute(`INSERT INTO ${identifier(table)} (${names.map(identifier).join(',')}) VALUES (${names.map(() => '?').join(',')})${conflict}`, names.map(name => row[name] as SqlValue));
  }
}
