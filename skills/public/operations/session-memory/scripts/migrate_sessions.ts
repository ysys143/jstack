#!/usr/bin/env node
import { isMain } from '../../../../../runtime/entry.js';
/** Plan/apply/verify/rollback explicitly scoped session migrations; Python v1 receipts remain readable. */
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, realpathSync, readdirSync, rmdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { homedir, hostname } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SqlReal, type SqlValue } from '../../../../../runtime/sqlite.js';
import { atomicWrite, privateDir, recoverLock } from '../../../../../runtime/os.js';
import * as claude from './session_migration/claude.js';
import * as codex from './session_migration/codex.js';
import { blank, bounded, compatible, digest, equal, fingerprint, lines, load, MigrationError, noWriter, read, records, save, stable, stringifyJson, transform, write } from './session_migration/common.js';
import type { DatabaseBlock, FileAction, Host, MigrationOptions, MigrationPlan, MigrationReceipt, Rows } from './session_migration/types.js';
export { claude, codex, MigrationError };
export type { MigrationOptions, MigrationPlan, MigrationReceipt };
const object = <T>(): Record<string, T> => Object.create(null) as Record<string, T>;
const within = (file: string, directory: string) => { const path = relative(directory, file); return !isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`); };
function canonical(value: string): string {
  const path = resolve(value === '~' ? homedir() : /^[~][\\/]/.test(value) ? join(homedir(), value.slice(2)) : value);
  let existing = path; while (!existsSync(existing)) { const parent = dirname(existing); if (parent === existing) return path; existing = parent; }
  return resolve(realpathSync(existing), relative(existing, path));
}
export function rowsEqual(a: Rows, b: Rows): boolean {
  const keys = Object.keys(a).sort();
  return equal(keys, Object.keys(b).sort()) && keys.every(key => equal(a[key]!.map(stable).sort(), b[key]!.map(stable).sort()));
}
function date(seconds: SqlValue | undefined): string {
  const value = seconds instanceof SqlReal ? seconds.value : Number(seconds);
  if (!Number.isFinite(value)) throw new MigrationError('Invalid Codex updated_at timestamp');
  const result = new Date(value * 1000).toISOString();
  return result.replace(/\.000Z$/, 'Z');
}

export async function createPlan(host: Host, requestedProfiles: string[], requestedDestination: string, requestedOld: string, requestedProject: string, options: MigrationOptions = {}): Promise<MigrationPlan> {
  if (!['claude', 'codex'].includes(host)) throw new MigrationError('Select the explicit claude or codex host');
  const destination = canonical(requestedDestination), profiles = [...new Set(requestedProfiles.map(canonical))], old = canonical(requestedOld), project = canonical(requestedProject);
  if (!existsSync(project) || !lstatSync(project).isDirectory() || !existsSync(destination) || !lstatSync(destination).isDirectory()) throw new MigrationError('The new project and initialized destination profile must exist');
  const adapter = host === 'claude' ? claude : codex;
  const actions = new Map<string, FileAction & { data: Buffer }>(), guards = object<string>(), identities = new Map<string, string>();
  const dbRows = new Map<string, Rows>(), dbGuards = object<Record<string, Rows>>(), historySources = new Map<string, { profile: string; source: string }[]>();
  for (const profile of profiles) for (const entry of adapter.discover([profile], old, project)) {
    const { source, identity } = entry, target = bounded(join(destination, entry.relative), destination);
    bounded(source, profile); const data = read(source); if (data === null) throw new MigrationError('Selected session source disappeared');
    guards[source] = digest(data);
    let incoming = source.endsWith('.jsonl') ? transform(data, host, old, project) : data;
    const existing = read(target), current = actions.get(target)?.data ?? existing;
    if (identity && identities.has(identity) && identities.get(identity) !== target) throw new MigrationError('One Codex ID has multiple rollout paths; reconcile before migration');
    if (identity) identities.set(identity, target);
    if (current !== null) {
      const normalized = target.endsWith('.jsonl') ? transform(current, host, old, project) : current;
      if (source.endsWith('.jsonl')) incoming = compatible(normalized, incoming);
      else if (!current.equals(incoming)) throw new MigrationError(`Conflicting ancillary file: ${entry.relative}`);
    }
    if (host === 'codex') {
      const id = identity!, db = codex.database(profile);
      (dbGuards[db] ??= object<Rows>())[id] = await codex.snapshot(db, [id], options);
      const prepared = await codex.prepare(profile, destination, id, source, target, project, options), previous = dbRows.get(id);
      if (previous && !rowsEqual(previous, prepared)) throw new MigrationError('Conflicting Codex metadata for the same session ID');
      dbRows.set(id, prepared);
      const history = codex.database(profile, 'history');
      (dbGuards[history] ??= object<Rows>())[id] = await codex.snapshot(history, [id], options);
      historySources.set(id, [...(historySources.get(id) ?? []), { profile, source }]);
    }
    actions.set(target, { target, source, sourceSha256: digest(data), before: existing === null ? null : digest(existing), after: digest(incoming), data: incoming });
  }
  if (!actions.size) throw new MigrationError('No sessions matched the explicit project paths and profiles');
  const plan: MigrationPlan = { schemaVersion: 1, host, oldProject: old, project, profiles, destination, sourceGuards: guards, sourceDatabases: dbGuards, files: [] };
  if (host === 'codex') {
    const ids = [...identities.keys()].sort(), target = codex.database(destination), before = await codex.snapshot(target, ids, options), after: Rows = Object.fromEntries(Object.keys(before).map(table => [table, []]));
    for (const id of ids) for (const [table, rows] of Object.entries(dbRows.get(id)!)) after[table]!.push(...rows);
    for (const row of before.threads!) {
      const candidate = after.threads!.find(item => item.id === row.id);
      if (!candidate) throw new MigrationError('Existing destination thread metadata differs; no automatic overwrite');
      for (const key of codex.LOCAL_ASSOCIATIONS) if (Object.hasOwn(candidate, key)) candidate[key] = row[key]!;
      const allowed = { ...row, cwd: project, rollout_path: identities.get(String(row.id))! };
      if (!equal(allowed, candidate)) throw new MigrationError('Existing destination thread metadata differs; no automatic overwrite');
    }
    const existingIds = new Set(before.threads!.map(row => row.id));
    for (const [table, key] of Object.entries(codex.RELATED)) {
      const retained = after[table]!.filter(row => existingIds.has(row[key]!));
      if (!equal(before[table]!.map(stable).sort(), retained.map(stable).sort())) throw new MigrationError('Existing destination session dependencies differ; no automatic overwrite');
    }
    const parents = [...new Set(after.thread_spawn_edges!.map(row => row.parent_thread_id!))].filter(id => !ids.includes(String(id)));
    if (parents.length) {
      const db = await codex.connect(target, true, options);
      try { const present = new Set((await db.query(`SELECT id FROM threads WHERE id IN (${parents.map(() => '?').join(',')})`, parents)).map(row => row.id)); if (parents.some(id => !present.has(id as string))) throw new MigrationError('Parent sessions are missing from destination; include their source profiles'); }
      finally { await db.close(); }
    }
    plan.database = { path: target, ids, before, after };
    const history = codex.database(destination, 'history'), historyBefore = await codex.snapshot(history, ids, options), historyAfter: Rows = Object.fromEntries(Object.keys(historyBefore).map(table => [table, []]));
    for (const id of ids) {
      let prepared: Rows | undefined;
      for (const { profile, source } of historySources.get(id)!) {
        const candidate = await codex.prepareHistory(profile, destination, id, read(source)!, actions.get(identities.get(id)!)!.data, options);
        if (prepared && !rowsEqual(prepared, candidate)) throw new MigrationError('Conflicting Codex paginated history for the same session ID');
        prepared = candidate;
      }
      const existing: Rows = Object.fromEntries(Object.entries(historyBefore).map(([table, rows]) => [table, rows.filter(row => row.thread_id === id)]));
      if (Object.values(existing).some(rows => rows.length)) {
        const original = read(identities.get(id)!); if (original === null) throw new MigrationError('Existing destination history has no rollout to verify');
        const normalized = await codex.prepareHistory(destination, destination, id, original, actions.get(identities.get(id)!)!.data, options);
        if (!rowsEqual(normalized, prepared!)) throw new MigrationError('Existing destination paginated history differs; no automatic overwrite');
      }
      for (const table of Object.keys(historyAfter)) historyAfter[table]!.push(...prepared![table]!);
    }
    plan.history = { path: history, ids, before: historyBefore, after: historyAfter };
    const index = join(destination, 'session_index.jsonl'), destinationEntries = new Map(records(read(index) ?? Buffer.alloc(0)).map(row => [row.id, row])), imported = new Map<string, Record<string, any>>();
    for (const profile of profiles) {
      const sourceIndex = join(profile, 'session_index.jsonl'), data = read(sourceIndex); if (data === null) continue;
      guards[sourceIndex] = digest(data);
      for (const entry of records(data)) {
        const id = entry.id; if (!ids.includes(id) || destinationEntries.has(id)) continue;
        const previous = imported.get(id); if (previous && !equal(previous, entry)) throw new MigrationError('Conflicting source index entries; reconcile session names first'); imported.set(id, entry);
      }
    }
    plan.index = { path: index, before: fingerprint(index), entries: after.threads!.map(row => destinationEntries.get(row.id) ?? imported.get(String(row.id)) ?? { id: row.id, thread_name: row.title, updated_at: date(row.updated_at) }) };
  }
  plan.files = [...actions.values()].map(({ data: _data, ...action }) => action);
  return plan;
}

function validatePlan(plan: MigrationPlan): void {
  if (plan.schemaVersion !== 1 || !['claude', 'codex'].includes(plan.host) || !Array.isArray(plan.files) || !plan.files.length || !Array.isArray(plan.profiles) || !plan.profiles.length || !isAbsolute(plan.destination)) throw new MigrationError('Unsupported or incomplete migration plan');
  if (![plan.oldProject, plan.project, ...plan.profiles].every(path => typeof path === 'string' && isAbsolute(path))) throw new MigrationError('Migration scope must use explicit absolute paths');
  for (const path of [...Object.keys(plan.sourceGuards), ...Object.keys(plan.sourceDatabases)]) {
    const profile = plan.profiles.find(profile => within(path, profile));
    if (!profile) throw new MigrationError('Migration guard escapes its explicit source profiles');
    bounded(path, profile);
  }
  for (const action of plan.files) {
    bounded(action.target, plan.destination);
    const profile = plan.profiles.find(path => within(action.source, path)); if (!profile) throw new MigrationError('Session source escapes explicit profiles'); bounded(action.source, profile);
    if (!/^[0-9a-f]{64}$/.test(action.after) || (action.before !== null && !/^[0-9a-f]{64}$/.test(action.before))) throw new MigrationError('Invalid migration file hash');
  }
  if (new Set(plan.files.map(file => file.target)).size !== plan.files.length) throw new MigrationError('Duplicate migration destination');
  if (plan.host === 'codex') {
    if (!plan.database || !plan.history || !plan.index) throw new MigrationError('Codex migration requires state, history and index');
    if (plan.database.path !== codex.database(plan.destination) || plan.history.path !== codex.database(plan.destination, 'history') || plan.index.path !== join(plan.destination, 'session_index.jsonl')) throw new MigrationError('Migration metadata escaped its destination profile');
    for (const block of [plan.database, plan.history]) bounded(block.path, plan.destination);
  }
}
export async function preflight(plan: MigrationPlan, options: MigrationOptions = {}): Promise<void> {
  validatePlan(plan);
  for (const [path, expected] of Object.entries(plan.sourceGuards)) if (fingerprint(path) !== expected) throw new MigrationError('Source changed after planning; make a new plan');
  for (const [path, sessions] of Object.entries(plan.sourceDatabases)) for (const [id, expected] of Object.entries(sessions)) if (!rowsEqual(await codex.snapshot(path, [id], options), expected)) throw new MigrationError('Source session metadata changed after planning');
  for (const action of plan.files) {
    if (fingerprint(action.target) !== action.before) throw new MigrationError('Destination changed after planning; make a new plan');
    if (action.before !== null && action.before !== action.after) (options.noWriter ?? noWriter)(action.target);
  }
  if (plan.database) {
    for (const block of [plan.database, plan.history!]) if (!rowsEqual(await codex.snapshot(block.path, block.ids, options), block.before)) throw new MigrationError('Destination database changed after planning');
    if (fingerprint(plan.index!.path) !== plan.index!.before) throw new MigrationError('Destination index changed after planning');
  }
}
export async function materialize(plan: MigrationPlan, options: MigrationOptions = {}): Promise<Map<string, Buffer>> {
  const rebuilt = await createPlan(plan.host, plan.profiles, plan.destination, plan.oldProject, plan.project, options);
  if (!equal(rebuilt, plan)) throw new MigrationError('Plan no longer matches the current inputs');
  const chosen = new Map<string, Buffer>(), adapter = plan.host === 'claude' ? claude : codex;
  for (const profile of plan.profiles) for (const entry of adapter.discover([profile], plan.oldProject, plan.project)) {
    const target = join(plan.destination, entry.relative); let data = read(entry.source)!;
    if (entry.source.endsWith('.jsonl')) {
      data = transform(data, plan.host, plan.oldProject, plan.project);
      const previous = chosen.get(target) ?? read(target);
      if (previous !== null) data = compatible(transform(previous, plan.host, plan.oldProject, plan.project), data);
    }
    chosen.set(target, data);
  }
  return chosen;
}

async function locked<T>(destination: string, action: () => Promise<T>, recovering = false): Promise<T> {
  const lock = join(destination, '.jstack-session-migration.lock'); bounded(lock, destination);
  if (recovering && existsSync(lock)) recoverLock(lock);
  if (existsSync(`${lock}.recovery`)) throw new MigrationError('Session migration lock recovery is active; retry after it finishes');
  try { privateDir(lock, { exclusive: true }); } catch { throw new MigrationError('Another session migration is active or interrupted; preserve its lock and use rollback after its owner exits'); }
  const token = randomUUID();
  try {
    atomicWrite(join(lock, 'owner.json'), Buffer.from(stringifyJson({ pid: process.pid, host: hostname(), token })));
    if (existsSync(`${lock}.recovery`)) throw new MigrationError('Session migration lock recovery acquired the guard; retry later');
    return await action();
  } finally {
    if (load(join(lock, 'owner.json')).token !== token || readdirSync(lock).sort().join(',') !== 'owner.json') throw new MigrationError('Migration lock was modified; preserve it for inspection');
    unlinkSync(join(lock, 'owner.json')); rmdirSync(lock);
  }
}

export async function apply(plan: MigrationPlan, requestedReceipt: string, options: MigrationOptions = {}): Promise<Record<string, unknown>> {
  validatePlan(plan);
  return locked(plan.destination, async () => {
    await preflight(plan, options); const data = await materialize(plan, options), receipt = canonical(requestedReceipt);
    if ([plan.project, ...plan.profiles, plan.destination].some(path => within(receipt, path))) throw new MigrationError('Store receipts outside project repositories and host profiles');
    mkdirSync(receipt, { mode: 0o700 });
    const journal: MigrationReceipt = { schemaVersion: 1, status: 'prepared', plan, files: [], indexLines: [] };
    for (const [index, action] of plan.files.entries()) if (action.before !== action.after) {
      const backup = `file-${index}.before`; if (action.before !== null) write(join(receipt, backup), read(action.target)!);
      journal.files.push({ ...action, backup });
    }
    if (plan.index && read(plan.index.path) !== null) write(join(receipt, 'index.before'), read(plan.index.path)!);
    save(join(receipt, 'receipt.json'), journal);
    try {
      await preflight(plan, options);
      for (const action of journal.files) {
        const bytes = data.get(action.target)!;
        if (digest(bytes) !== action.after) throw new MigrationError('Prepared content disagrees with the plan');
        if (fingerprint(action.target) !== action.before) throw new MigrationError('Destination changed immediately before writing');
        if (action.before !== null) (options.noWriter ?? noWriter)(action.target);
        write(action.target, bytes, action.before === null);
      }
      if (plan.database) {
        const db = await codex.connect(plan.database.path, false, options);
        try {
          await db.execute('ATTACH DATABASE ? AS history', [plan.history!.path]);
          await db.transaction(async () => {
            for (const [block, schema] of [[plan.database!, 'main'], [plan.history!, 'history']] as const) if (!rowsEqual(await codex.snapshot(block.path, block.ids, options, { connection: db, schema }), block.before)) throw new MigrationError('Destination database changed during apply');
            await options.fault?.('before-state-write');
            await codex.replaceRows(db, plan.database!.ids, plan.database!.after);
            await options.fault?.('before-history-write');
            await codex.replaceHistory(db, plan.database!.ids, plan.history!.after);
            if ((await db.query('PRAGMA foreign_key_check')).length || (await db.query('PRAGMA history.foreign_key_check')).length) throw new MigrationError('Codex foreign-key verification failed');
          });
        } finally { await db.close(); }
        await options.fault?.('after-database-commit');
        const index = plan.index!;
        if (fingerprint(index.path) !== index.before) throw new MigrationError('Destination index changed during apply; database journal retained');
        const previous = records(read(index.path) ?? Buffer.alloc(0)), latest = new Map(previous.map(row => [row.id, row]));
        journal.indexLines = index.entries.filter(row => !latest.has(row.id) || !equal(latest.get(row.id), row));
        save(join(receipt, 'receipt.json'), journal);
        await options.fault?.('before-index-write');
        if (journal.indexLines.length) {
          const raw = read(index.path) ?? Buffer.alloc(0);
          if (raw.length && raw[raw.length - 1] !== 10) throw new MigrationError('Destination index has an incomplete final line');
          (options.noWriter ?? noWriter)(index.path);
          const fd = openSync(index.path, 'a', 0o600);
          try { writeFileSync(fd, Buffer.from(journal.indexLines.map(row => stringifyJson(row, { compact: false }) + '\n').join(''))); fsyncSync(fd); }
          finally { closeSync(fd); }
        }
      }
      journal.status = 'applied'; save(join(receipt, 'receipt.json'), journal);
      await options.fault?.('before-verify'); await verify(receipt, options);
    } catch (error) { journal.status = 'interrupted'; save(join(receipt, 'receipt.json'), journal); throw error; }
    return { receipt, filesChanged: journal.files.length, sessions: plan.database?.ids.length ?? 0, status: 'verified' };
  });
}
function receiptAt(path: string): MigrationReceipt {
  const receipt = load(join(path, 'receipt.json')) as MigrationReceipt;
  if (receipt.schemaVersion !== 1 || !['prepared', 'applied', 'interrupted', 'rolled-back'].includes(receipt.status) || !Array.isArray(receipt.files) || !Array.isArray(receipt.indexLines)) throw new MigrationError('Unsupported migration receipt');
  validatePlan(receipt.plan);
  for (const action of receipt.files) if (!/^file-\d+\.before$/.test(action.backup) || !receipt.plan.files.some(file => equal(file, Object.fromEntries(Object.entries(action).filter(([key]) => key !== 'backup'))))) throw new MigrationError('Receipt file ownership does not match its plan');
  return receipt;
}
export async function verify(receipt: string, options: MigrationOptions = {}): Promise<Record<string, unknown>> {
  const journal = receiptAt(receipt), plan = journal.plan;
  for (const action of plan.files) if (fingerprint(action.target) !== action.after) throw new MigrationError('Migrated file changed or is incomplete');
  if (plan.database) {
    for (const block of [plan.database, plan.history!]) if (!rowsEqual(await codex.snapshot(block.path, block.ids, options), block.after)) throw new MigrationError('Migrated database rows changed or are incomplete');
    const latest = new Map(records(read(plan.index!.path) ?? Buffer.alloc(0)).map(row => [row.id, row]));
    if (plan.index!.entries.some(row => !latest.has(row.id) || !equal(latest.get(row.id), row))) throw new MigrationError('Migrated index entries are missing or changed');
    for (const action of plan.files) if (records(read(action.target)!)[0]?.payload?.cwd !== plan.project) throw new MigrationError('Rollout still points at the old project');
  }
  return { status: 'verified', files: plan.files.length };
}
export async function rollback(receipt: string, options: MigrationOptions = {}): Promise<Record<string, unknown>> {
  receipt = canonical(receipt); const journal = receiptAt(receipt), plan = journal.plan;
  if (journal.status === 'rolled-back') return { status: 'rolled-back' };
  return locked(plan.destination, async () => {
    for (const action of journal.files) {
      if (action.before !== null && fingerprint(join(receipt, action.backup)) !== action.before) throw new MigrationError('Rollback refused: backup is missing or corrupted');
      if (![action.before, action.after].includes(fingerprint(action.target)!)) throw new MigrationError('Rollback refused: migrated file has newer changes');
      (options.noWriter ?? noWriter)(action.target);
    }
    if (plan.database) {
      const actual = new Map<DatabaseBlock, Rows>();
      for (const block of [plan.database, plan.history!]) {
        const rows = await codex.snapshot(block.path, block.ids, options); actual.set(block, rows);
        if (!rowsEqual(rows, block.before) && !rowsEqual(rows, block.after)) throw new MigrationError('Rollback refused: migrated database rows have newer changes');
      }
      const index = plan.index!, raw = read(index.path) ?? Buffer.alloc(0), latest = new Map(records(raw).map(row => [row.id, row]));
      const beforeBytes = read(join(receipt, 'index.before')) ?? Buffer.alloc(0), beforeIndex = new Map(records(beforeBytes).map(row => [row.id, row]));
      for (const row of journal.indexLines) if (!equal(latest.get(row.id) ?? null, row) && !equal(latest.get(row.id) ?? null, beforeIndex.get(row.id) ?? null)) throw new MigrationError('Rollback refused: session index has newer changes');
      (options.noWriter ?? noWriter)(index.path);
      let remaining = raw;
      if (journal.indexLines.length) {
        const appended = Buffer.from(journal.indexLines.map(row => stringifyJson(row, { compact: false }) + '\n').join(''));
        if (raw.subarray(0, beforeBytes.length + appended.length).equals(Buffer.concat([beforeBytes, appended]))) remaining = Buffer.concat([beforeBytes, raw.subarray(beforeBytes.length + appended.length)]);
        else if (!raw.subarray(0, beforeBytes.length).equals(beforeBytes) || journal.indexLines.some(row => equal(latest.get(row.id) ?? null, row) && !equal(beforeIndex.get(row.id) ?? null, row))) throw new MigrationError('Rollback refused: cannot identify owned index append bytes');
      }
      const db = await codex.connect(plan.database.path, false, options);
      try {
        await db.execute('ATTACH DATABASE ? AS history', [plan.history!.path]);
        await db.transaction(async () => {
          for (const [block, schema] of [[plan.database!, 'main'], [plan.history!, 'history']] as const) if (!rowsEqual(await codex.snapshot(block.path, block.ids, options, { connection: db, schema }), actual.get(block)!)) throw new MigrationError('Database changed while preparing rollback');
          await codex.replaceRows(db, plan.database!.ids, plan.database!.before);
          await codex.replaceHistory(db, plan.database!.ids, plan.history!.before);
          if ((await db.query('PRAGMA foreign_key_check')).length || (await db.query('PRAGMA history.foreign_key_check')).length) throw new MigrationError('Codex rollback foreign-key verification failed');
        });
      } finally { await db.close(); }
      if (remaining.length || index.before !== null) write(index.path, remaining); else if (existsSync(index.path)) unlinkSync(index.path);
    }
    for (const action of [...journal.files].reverse()) {
      if (action.before === null) { if (existsSync(action.target)) unlinkSync(action.target); }
      else write(action.target, read(join(receipt, action.backup))!);
    }
    journal.status = 'rolled-back'; save(join(receipt, 'receipt.json'), journal);
    return { status: 'rolled-back' };
  }, true);
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write('Usage: migrate_sessions plan --host claude|codex --source-data-dir DIR [--source-data-dir DIR] --data-dir DIR --old-project PATH --project PATH --output FILE\n       migrate_sessions apply PLAN --receipt DIR\n       migrate_sessions verify RECEIPT\n       migrate_sessions rollback RECEIPT\n'); return 0;
  }
  try {
    const command = argv[0], flags = new Map<string, string[]>(), positional: string[] = [];
    for (let index = 1; index < argv.length; index++) {
      const value = argv[index]!;
      if (!value.startsWith('--')) positional.push(value);
      else { const next = argv[++index]; if (!next || next.startsWith('--')) throw new MigrationError(`Missing value for ${value}`); flags.set(value, [...(flags.get(value) ?? []), next]); }
    }
    const one = (key: string) => { const values = flags.get(key); if (values?.length !== 1) throw new MigrationError(`${key} is required exactly once`); return values[0]!; };
    let result: Record<string, unknown>;
    if (command === 'plan') {
      const allowed = new Set(['--host', '--source-data-dir', '--data-dir', '--old-project', '--project', '--output']);
      if (positional.length || [...flags.keys()].some(key => !allowed.has(key))) throw new MigrationError('Unexpected plan argument');
      const output = canonical(one('--output')), project = canonical(one('--project'));
      if (within(output, project)) throw new MigrationError('Store private migration plans outside the project repository');
      if (existsSync(output)) throw new MigrationError('Plan output already exists');
      const profiles = flags.get('--source-data-dir'); if (!profiles?.length) throw new MigrationError('--source-data-dir is required');
      const plan = await createPlan(one('--host') as Host, profiles, one('--data-dir'), one('--old-project'), project);
      save(output, plan); result = { plan: output, files: plan.files.length, mutations: plan.files.filter(row => row.before !== row.after).length };
    } else if (command === 'apply') {
      if (positional.length !== 1 || [...flags.keys()].some(key => key !== '--receipt')) throw new MigrationError('apply requires a plan and --receipt');
      result = await apply(load(positional[0]!), one('--receipt'));
    } else if (command === 'verify' || command === 'rollback') {
      if (positional.length !== 1 || flags.size) throw new MigrationError(`${command} requires one receipt directory`);
      result = await (command === 'verify' ? verify : rollback)(positional[0]!);
    } else throw new MigrationError('Use plan, apply, verify, or rollback');
    process.stdout.write(stringifyJson(result, { indent: 2 }) + '\n'); return 0;
  } catch (error) { process.stderr.write(JSON.stringify({ error: (error as Error).message }) + '\n'); return 2; }
}
if (isMain(import.meta.url)) main().then(code => { process.exitCode = code; });
