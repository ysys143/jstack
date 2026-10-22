import { existsSync, renameSync, rmSync, lstatSync } from 'node:fs';
import { SqliteDatabase, type NativeOptions } from '../../../../../runtime/sqlite.js';
import { checkOwned, createPrivateFile } from '../../../../../runtime/os.js';
import { paths, ensureState, now, type Sample, type Capacity } from './storage.js';

const schema = `CREATE TABLE IF NOT EXISTS measurements(captured_at INTEGER NOT NULL, category TEXT NOT NULL, path TEXT NOT NULL, bytes INTEGER, error TEXT, method TEXT NOT NULL, PRIMARY KEY(captured_at, category));
CREATE TABLE IF NOT EXISTS capacity(captured_at INTEGER PRIMARY KEY, filesystem TEXT NOT NULL, total_bytes INTEGER NOT NULL, free_bytes INTEGER NOT NULL, used_bytes INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS imports(imported_at INTEGER NOT NULL, source TEXT NOT NULL, samples INTEGER, capacity INTEGER);
PRAGMA user_version=1;`;
/** Legacy rows never recorded a path, so they are never compared with a measured path. */
export const legacyPath = '(legacy path unknown)';
/** Source of an import that predates the imports table; its counts were never recorded and stay null. */
const unrecordedImport = '(imported before import records)';
export async function openHistory(root: string, write = false, native: NativeOptions = {}): Promise<SqliteDatabase> {
  const path = paths(root).db;
  if (write) ensureState(root);
  if (existsSync(path)) checkOwned(path);
  else if (write) createPrivateFile(path);
  const db = await SqliteDatabase.open(path, { ...native, cacheRoot: native.cacheRoot ?? paths(root).root + '/native/sqlite3', readonly: !write, fileMustExist: !write });
  try {
    const version = Number((await db.query('PRAGMA user_version'))[0]?.user_version);
    const tables = new Set((await db.query("SELECT name FROM sqlite_master WHERE type='table'")).map(row => String(row.name)));
    if (version !== 1 && !(write && version === 0 && !tables.size)) throw new Error('Unsupported disk history schema');
    if (write) {
      // Each commit is a disk sync: a new or older history gets the missing tables in one transaction, and an
      // up-to-date one is left unwritten.
      if (!['measurements', 'capacity', 'imports'].every(name => tables.has(name))) await db.transaction(() => db.exec(schema));
      // An import made before the imports table left only legacy-path rows, which retention prunes. Record it before
      // any prune, so the legacy database is neither proposed nor merged again.
      await db.execute('INSERT INTO imports SELECT ?, ?, NULL, NULL WHERE NOT EXISTS (SELECT 1 FROM imports) AND EXISTS (SELECT 1 FROM measurements WHERE path=?)', [now(), unrecordedImport, legacyPath]);
    }
    return db;
  } catch (error) { await db.close(); throw error; }
}
export async function record(db: SqliteDatabase, samples: Sample[], space: Capacity | null, retentionDays: number, at = now()): Promise<void> {
  await db.transaction(async () => {
    for (const s of samples) await db.execute('INSERT INTO measurements VALUES(?,?,?,?,?,?)', [s.capturedAt, s.category, s.path, s.bytes, s.error, s.method]);
    if (space) await db.execute('INSERT INTO capacity VALUES(?,?,?,?,?)', [space.capturedAt, space.filesystem, space.totalBytes, space.freeBytes, space.usedBytes]);
    const cutoff = at - retentionDays * 86400;
    await db.execute('DELETE FROM measurements WHERE captured_at < ?', [cutoff]);
    await db.execute('DELETE FROM capacity WHERE captured_at < ?', [cutoff]);
  });
}
export async function differences(db: SqliteDatabase, hours: number, at = now()) {
  const rows = await db.query('SELECT * FROM measurements ORDER BY captured_at DESC'), cutoff = at - hours * 3600;
  // Only complete measurements give a delta; an error row is unknown or, with bytes, a lower bound.
  const exact = (row: (typeof rows)[number] | undefined) => row !== undefined && row.bytes !== null && row.error === null;
  return [...new Set(rows.map(row => String(row.category)))].map(category => {
    const current = rows.find(row => row.category === category)!;
    // A baseline is strictly earlier than the current row, so a lone sample older than the window is never its own.
    const earlier = (row: (typeof rows)[number]) => Number(row.captured_at) <= cutoff && Number(row.captured_at) < Number(current.captured_at);
    const previous = rows.find(row => row.category === category && row.path === current.path && earlier(row));
    // Without a same-path baseline, show the imported legacy value beside the current one, never as a delta.
    const legacy = previous ? undefined : rows.find(row => row.category === category && row.path === legacyPath && earlier(row));
    return { category, path: current.path, currentAt: current.captured_at, previousAt: previous?.captured_at ?? null, currentBytes: current.bytes, previousBytes: previous?.bytes ?? null, deltaBytes: exact(current) && exact(previous) ? Number(current.bytes) - Number(previous!.bytes) : null, error: current.error, legacyBaseline: legacy ? { at: legacy.captured_at, bytes: legacy.bytes } : null };
  });
}
export async function history(db: SqliteDatabase, category: string, days: number, at = now()) {
  // UTC dates are explicit; one real latest sample per day, never averages or sums.
  const rows = category === 'all'
    ? await db.query('SELECT captured_at, used_bytes AS bytes, filesystem AS path, NULL AS error FROM capacity WHERE captured_at >= ? ORDER BY captured_at DESC', [at - days * 86400])
    : await db.query('SELECT captured_at, bytes, path, error FROM measurements WHERE category=? AND captured_at >= ? ORDER BY captured_at DESC', [category, at - days * 86400]);
  const seen = new Set<string>();
  return rows.filter(row => { const day = new Date(Number(row.captured_at) * 1000).toISOString().slice(0, 10); if (seen.has(day)) return false; seen.add(day); return true; }).reverse();
}
export async function capacityDifference(db: SqliteDatabase, hours: number, at = now()) {
  const rows = await db.query('SELECT * FROM capacity ORDER BY captured_at DESC'), current = rows[0];
  const previous = current && rows.find(row => row.filesystem === current.filesystem && Number(row.captured_at) <= at - hours * 3600);
  return { current: current ?? null, previous: previous ?? null, deltaFreeBytes: current && previous ? Number(current.free_bytes) - Number(previous.free_bytes) : null };
}
export function chart(rows: Record<string, unknown>[]): string {
  const max = Math.max(1, ...rows.map(row => Number(row.bytes ?? 0)));
  // A size recorded with an error is the readable part only, shown as a lower bound.
  return rows.map(row => `${new Date(Number(row.captured_at) * 1000).toISOString().slice(0, 10)} ${row.bytes === null ? 'unknown' : `${row.error ? '>= ' : ''}${(Number(row.bytes) / 1073741824).toFixed(2)} GiB ${'#'.repeat(Math.round(Number(row.bytes) / max * 32))}`}`).join('\n');
}
/** An import is recorded in the history it wrote. Retention may prune old imported rows, never that record. */
export async function legacyImported(db: SqliteDatabase): Promise<boolean> {
  const recorded = (await db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='imports'")).length > 0 && (await db.query('SELECT 1 FROM imports LIMIT 1')).length > 0;
  // Histories imported before the record existed still carry their legacy rows.
  return recorded || (await db.query('SELECT 1 FROM measurements WHERE path=? LIMIT 1', [legacyPath])).length > 0;
}
/**
 * Read a legacy database without touching it. Without a jstack history, publish a complete new DB once. A jstack history
 * that snapshots created before any import receives the import in one transaction; a sample that collides with an
 * existing one aborts it unchanged. A second import is refused.
 */
export async function importLegacy(root: string, source: string, categories: Record<string, string>, filesystem: string, native: NativeOptions = {}) {
  ensureState(root); const destination = paths(root).db, merge = existsSync(destination);
  const sourceInfo = lstatSync(source);
  if (!sourceInfo.isFile() || sourceInfo.isSymbolicLink() || (process.getuid && sourceInfo.uid !== process.getuid())) throw new Error('Legacy source must be an owned regular database');
  const old = await SqliteDatabase.open(source, { ...native, cacheRoot: native.cacheRoot ?? paths(root).root + '/native/sqlite3' });
  const temporary = destination + '.importing';
  if (!merge && existsSync(temporary)) { await old.close(); throw new Error('Interrupted import exists; inspect before retrying'); }
  let target: SqliteDatabase | undefined, created = false;
  try {
    for (const [table, columns] of Object.entries({ snapshots: ['captured_at', 'category', 'size_mb'], disk_free: ['captured_at', 'free_mb', 'total_mb'] })) {
      const actual = await old.columns(table); if (!columns.every(column => actual.includes(column))) throw new Error('Unsupported legacy disk schema');
    }
    if (merge) {
      target = await openHistory(root, true, native);
      if (await legacyImported(target)) throw new Error('Legacy history was already imported; import never merges twice or overwrites');
    } else {
      createPrivateFile(temporary); created = true;
      target = await SqliteDatabase.open(temporary, { ...native, cacheRoot: native.cacheRoot ?? paths(root).root + '/native/sqlite3', readonly: false, fileMustExist: false });
      // One commit (a disk sync) for the whole schema, as in openHistory.
      await target.transaction(() => target!.exec(schema));
    }
    await old.exec('BEGIN');
    const samples = await old.query('SELECT captured_at, category, size_mb FROM snapshots ORDER BY captured_at, rowid');
    const capacity = await old.query('SELECT * FROM disk_free ORDER BY captured_at');
    const integer = (v: unknown) => { if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) throw new Error('Invalid legacy measurement'); return v; };
    // A repeated legacy sample keeps its last value; a collision with jstack history is never replaced.
    const latest = new Map(samples.map(s => [`${integer(s.captured_at)}\0${String(s.category)}`, s]));
    try {
      await target.transaction(async () => {
        for (const s of latest.values()) {
          const bytes = integer(s.size_mb) * 1048576; integer(bytes);
          await target!.execute('INSERT INTO measurements VALUES(?,?,?,?,?,?)', [integer(s.captured_at), String(s.category), legacyPath, bytes, null, 'legacy du -sm; MiB converted to bytes']);
        }
        for (const s of capacity) {
          const total = integer(s.total_mb) * 1048576, free = integer(s.free_mb) * 1048576; integer(total); integer(free);
          if (free > total) throw new Error('Invalid legacy free space');
          await target!.execute('INSERT INTO capacity VALUES(?,?,?,?,?)', [integer(s.captured_at), filesystem, total, free, total - free]);
        }
        await target!.execute('INSERT INTO imports VALUES(?,?,?,?)', [now(), source, samples.length, capacity.length]);
      });
    } catch (error) {
      if (merge && /UNIQUE|PRIMARY KEY|constraint/i.test(String(error))) throw new Error(`Legacy history conflicts with existing jstack history at the same time and category; nothing was imported (${error instanceof Error ? error.message : String(error)})`);
      throw error;
    }
    await old.exec('COMMIT'); await target.close(); target = undefined;
    if (!merge) renameSync(temporary, destination);
    return { imported: true, merged: merge, samples: samples.length, capacity: capacity.length, sourcePreserved: true };
  } finally { await target?.close(); await old.close(); if (created && existsSync(temporary)) rmSync(temporary); }
}
