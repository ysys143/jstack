import { existsSync, readFileSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { SqliteDatabase, type NativeOptions } from '../../../../../runtime/sqlite.js';
import { atomicWrite, checkOwned } from '../../../../../runtime/os.js';
import { paths, locked, now, legacyHistory } from './storage.js';
import { openHistory, legacyImported } from './history.js';
import { legacyCollectors, migrationProposal } from './scheduler.js';

export interface Note { id: string; kind: 'decision' | 'observation' | 'hypothesis' | 'lesson'; scope: string; summary: string; evidence: string; recordedAt: number; expiresAt?: number; supersedes?: string }
const memoryFile = (root: string) => join(paths(root).state, 'memory.json');
export function readMemory(root: string): Note[] {
  const file = memoryFile(root); if (!existsSync(file)) return [];
  checkOwned(file); const data = JSON.parse(readFileSync(file, 'utf8'));
  if (data.schemaVersion !== 1 || !Array.isArray(data.notes)) throw new Error('Unsupported disk memory schema');
  return data.notes;
}
export async function remember(root: string, input: unknown): Promise<Note> {
  const value = input as Partial<Note>;
  if (!value || Object.keys(value).some(key => !['kind', 'scope', 'summary', 'evidence', 'expiresAt', 'supersedes'].includes(key)) || !['decision', 'observation', 'hypothesis', 'lesson'].includes(String(value.kind)) || !['scope', 'summary', 'evidence'].every(key => typeof value[key as keyof Note] === 'string' && String(value[key as keyof Note]).trim().length > 0 && String(value[key as keyof Note]).length <= 4096) || (value.expiresAt !== undefined && (!Number.isSafeInteger(value.expiresAt) || value.expiresAt <= now()))) throw new Error('Memory requires kind, scope, summary and evidence; optional expiry must be in the future');
  return locked(root, async () => {
    const notes = readMemory(root);
    if (notes.length >= 500) throw new Error('Memory is full; review and archive it explicitly');
    if (value.supersedes && !notes.some(note => note.id === value.supersedes)) throw new Error('Superseded memory does not exist');
    const note = { ...value, id: randomUUID(), recordedAt: now() } as Note;
    atomicWrite(memoryFile(root), Buffer.from(JSON.stringify({ schemaVersion: 1, notes: [...notes, note] }, null, 2) + '\n'));
    return note;
  });
}
/** Legacy launch agents are scanned only for the default state root, so fixture roots never read the real home. */
export async function context(root: string, native: NativeOptions = {}, legacy = legacyHistory(root), home = paths(root).root === paths().root ? homedir() : undefined) {
  const notes = readMemory(root), replaced = new Set(notes.map(note => note.supersedes));
  const active = notes.filter(note => !replaced.has(note.id)).map(note => ({ ...note, expired: note.expiresAt !== undefined && note.expiresAt <= now() }));
  const memory = { path: memoryFile(root), decisions: active.filter(note => note.kind === 'decision'), recent: active.filter(note => note.kind !== 'decision').slice(-8), totalNotes: notes.length, guidance: 'Evidence and past decisions, not permission for new deletion. Recheck current consumers and stale observations.' };
  const found = legacy && existsSync(legacy) ? legacy : null, database = existsSync(paths(root).db) ? paths(root).db : found;
  const isLegacy = database !== null && database !== paths(root).db, collectors = home ? legacyCollectors(home) : [];
  // A detected legacy collector or unimported database is a migration lead for the user, never an automatic migration.
  const proposal = (legacyDatabase: string | null) => {
    const migration = legacyDatabase || collectors.length ? { legacyDatabase, legacyCollectors: collectors } : null;
    return { migration, lead: migration ? `Migration lead: tell the user what was detected. ${migrationProposal} ` : '' };
  };
  if (!database) { const { migration, lead } = proposal(null); return { memory, history: null, migration, next: `${lead}Measure filesystem status, then one relevant category; do not run a whole-home snapshot merely to initialize history.` }; }
  const info = lstatSync(database);
  if (!info.isFile() || info.isSymbolicLink() || (process.getuid && info.uid !== process.getuid())) throw new Error('History must be an owned regular database');
  const db = isLegacy ? await SqliteDatabase.open(database, { ...native, cacheRoot: native.cacheRoot ?? join(paths(root).root, 'native/sqlite3') }) : await openHistory(root, false, native);
  try {
    // A jstack history created by snapshots before the import does not hide the legacy database; only a recorded import does.
    const { migration, lead } = proposal(isLegacy ? database : found && !(await legacyImported(db)) ? found : null);
    const samples = isLegacy
      ? await db.query('SELECT captured_at,category,size_mb * 1048576 AS bytes FROM (SELECT *, ROW_NUMBER() OVER(PARTITION BY category ORDER BY captured_at DESC) AS rn FROM snapshots) WHERE rn=1 ORDER BY captured_at DESC LIMIT 64')
      : await db.query('SELECT captured_at,category,path,bytes,error FROM (SELECT *,ROW_NUMBER() OVER(PARTITION BY category ORDER BY captured_at DESC) AS rn FROM measurements) WHERE rn=1 ORDER BY captured_at DESC LIMIT 64');
    const capacity = isLegacy ? await db.query('SELECT captured_at,free_mb * 1048576 AS free_bytes,total_mb * 1048576 AS total_bytes FROM disk_free ORDER BY captured_at DESC LIMIT 2') : await db.query('SELECT * FROM capacity ORDER BY captured_at DESC LIMIT 2');
    return { memory, history: { database, legacy: isLegacy, readOnly: true, samples, capacity }, migration, next: `${lead}Treat old measurements as leads. Freshly measure only the relevant categories; do not sum them or infer causation from coincident changes.` };
  } finally { await db.close(); }
}
