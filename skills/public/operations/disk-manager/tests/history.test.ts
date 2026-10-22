/** SQLite history, legacy import, memory and context units, run in process. */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { createPrivateFile } from '../../../../../runtime/os.js';
import { SqliteDatabase } from '../../../../../runtime/sqlite.js';
import { chart, differences, history, importLegacy, openHistory, record } from '../scripts/history.js';
import { ensureState, paths } from '../scripts/storage.js';
import { fixture, native, sample } from './_fixtures.js';

test('SQLite difference keeps absent baseline and failed measurements unknown', async () => {
  const root = fixture(), db = await openHistory(root, true, native), at = 2_000_000;
  try {
    await record(db, [sample(at - 90000, 100)], null, 90, at);
    // A lone sample older than the window is the current value, never its own baseline.
    const lone = (await differences(db, 24, at))[0]; assert.equal(lone.previousAt, null); assert.equal(lone.deltaBytes, null);
    await record(db, [sample(at, 170)], null, 90, at);
    assert.equal((await differences(db, 24, at))[0].deltaBytes, 70);
    assert.equal((await differences(db, 48, at))[0].deltaBytes, null);
    await record(db, [sample(at + 1, null)], null, 90, at);
    assert.equal((await differences(db, 24, at + 1))[0].deltaBytes, null);
    await record(db, [sample(at + 2, 180, '/different/path')], null, 90, at);
    assert.equal((await differences(db, 24, at + 2))[0].deltaBytes, null);
    await record(db, [{ ...sample(at + 3, 190), error: 'partial-permission-denied: 1 unreadable entry' }], null, 90, at);
    const partly = (await differences(db, 24, at + 3))[0];
    assert.equal(partly.currentBytes, 190); assert.equal(partly.previousBytes, 100); assert.equal(partly.deltaBytes, null);
  } finally { await db.close(); rmSync(root, { recursive: true }); }
});
test('difference shows an imported legacy value as a baseline without a delta', async () => {
  const root = fixture(), db = await openHistory(root, true, native), at = 2_000_000;
  try {
    await record(db, [{ ...sample(at - 90000, 100, '(legacy path unknown)'), method: 'legacy du -sm; MiB converted to bytes' }], null, 90, at);
    await record(db, [sample(at, 170)], null, 90, at);
    const row = (await differences(db, 24, at))[0];
    assert.equal(row.previousAt, null); assert.equal(row.deltaBytes, null);
    assert.deepEqual(row.legacyBaseline, { at: at - 90000, bytes: 100 });
    await record(db, [sample(at + 90000, 180)], null, 90, at);
    assert.equal((await differences(db, 24, at + 90000))[0].legacyBaseline, null);
  } finally { await db.close(); rmSync(root, { recursive: true }); }
});
test('daily history uses actual filesystem used bytes rather than overlapping category sum', async () => {
  const root = fixture(), db = await openHistory(root, true, native), at = 2_000_000;
  try {
    await record(db, [sample(at, 400), { ...sample(at, 700), category: 'home' }], { capturedAt: at, filesystem: '/fixture', freeBytes: 200, totalBytes: 1000, usedBytes: 750 }, 90, at);
    await record(db, [sample(at + 1, null)], { capturedAt: at + 1, filesystem: '/fixture', freeBytes: 180, totalBytes: 1000, usedBytes: 770 }, 90, at);
    assert.equal((await history(db, 'all', 14, at + 1))[0].bytes, 770);
    assert.equal((await history(db, 'cache', 14, at + 1))[0].bytes, null);
    assert.match(chart(await history(db, 'cache', 14, at + 1)), /unknown/);
    assert.match(chart([{ captured_at: at, bytes: 1073741824, error: 'partial-permission-denied: 1 unreadable entry' }]), />= 1\.00 GiB/);
    assert.doesNotMatch(chart([{ captured_at: at, bytes: 1073741824, error: null }]), />=/);
  } finally { await db.close(); rmSync(root, { recursive: true }); }
});
test('retention affects only history and duplicate snapshot rolls back atomically', async () => {
  const root = fixture(), db = await openHistory(root, true, native), at = 20_000_000;
  try {
    await record(db, [sample(1, 40)], null, 365, 1);
    await record(db, [sample(at, 60)], null, 90, at);
    assert.equal((await db.query('SELECT * FROM measurements')).length, 1);
    await assert.rejects(record(db, [{ ...sample(at, 1), category: 'new' }, sample(at, 99)], null, 90, at));
    assert.equal((await db.query('SELECT * FROM measurements')).length, 1);
  } finally { await db.close(); rmSync(root, { recursive: true }); }
});
test('legacy import preserves source bytes, converts MiB and refuses a second import', async () => {
  const root = fixture(), source = join(root, 'legacy.db'), target = join(root, 'new');
  const old = await SqliteDatabase.open(source, { ...native, readonly: false, fileMustExist: false });
  await old.exec('BEGIN; CREATE TABLE snapshots(captured_at INTEGER,category TEXT,size_mb INTEGER); CREATE TABLE disk_free(captured_at INTEGER, free_mb INTEGER,total_mb INTEGER); INSERT INTO snapshots VALUES(1,\'cache\',5); INSERT INTO disk_free VALUES(1,10,20); COMMIT;'); await old.close();
  const hash = () => createHash('sha256').update(readFileSync(source)).digest('hex'), before = hash();
  try {
    await importLegacy(target, source, { cache: '/current/path' }, '/fixture', native);
    // One commit creates the schema and one imports; the header's change counter (offset 24) counts commits.
    assert.equal(hash(), before); assert.equal(readFileSync(paths(target).db).readUInt32BE(24), 2);
    const db = await openHistory(target, false, native);
    try { const row = (await db.query('SELECT * FROM measurements'))[0]; assert.equal(row.bytes, 5 * 1048576); assert.equal(row.path, '(legacy path unknown)'); } finally { await db.close(); }
    await assert.rejects(importLegacy(target, source, {}, '/fixture', native), /already imported/);
  } finally { rmSync(root, { recursive: true }); }
});
test('legacy import merges into a jstack history without an import and never twice', async () => {
  const root = fixture(), source = join(root, 'legacy.db'), conflicting = join(root, 'conflict.db'), target = join(root, 'new');
  const legacyDb = async (file: string, rows: string) => { const old = await SqliteDatabase.open(file, { ...native, readonly: false, fileMustExist: false }); await old.exec(`BEGIN; CREATE TABLE snapshots(captured_at INTEGER,category TEXT,size_mb INTEGER); CREATE TABLE disk_free(captured_at INTEGER, free_mb INTEGER,total_mb INTEGER); ${rows} COMMIT;`); await old.close(); };
  await legacyDb(source, "INSERT INTO snapshots VALUES(1,'cache',5),(1,'cache',6),(2,'home',7); INSERT INTO disk_free VALUES(1,10,20);");
  await legacyDb(conflicting, "INSERT INTO snapshots VALUES(100,'cache',5);");
  const hash = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex'), before = hash(source);
  const rows = async () => { const db = await openHistory(target, false, native); try { return (await db.query('SELECT captured_at, category, path, bytes FROM measurements ORDER BY captured_at, category')).map(row => [row.captured_at, row.category, row.path, row.bytes]); } finally { await db.close(); } };
  try {
    // A snapshot taken before the import creates the jstack history first.
    const db = await openHistory(target, true, native); await record(db, [sample(100, 40)], null, 90, 100); await db.close();
    await assert.rejects(importLegacy(target, conflicting, {}, '/fixture', native), /conflict/);
    assert.deepEqual(await rows(), [[100, 'cache', '/fixture/cache', 40]]);
    const result = await importLegacy(target, source, {}, '/fixture', native);
    assert.equal(result.merged, true); assert.equal(hash(source), before);
    assert.deepEqual(await rows(), [[1, 'cache', '(legacy path unknown)', 6 * 1048576], [2, 'home', '(legacy path unknown)', 7 * 1048576], [100, 'cache', '/fixture/cache', 40]]);
    await assert.rejects(importLegacy(target, source, {}, '/fixture', native), /already imported/);
  } finally { rmSync(root, { recursive: true }); }
});
test('an import made before the imports table is recorded before retention prunes its rows', async () => {
  const { context } = await import('../scripts/memory.js');
  const root = fixture(), source = join(root, 'legacy.db'), legacy = '(legacy path unknown)';
  const old = await SqliteDatabase.open(source, { ...native, readonly: false, fileMustExist: false });
  await old.exec("BEGIN; CREATE TABLE snapshots(captured_at INTEGER,category TEXT,size_mb INTEGER); CREATE TABLE disk_free(captured_at INTEGER,free_mb INTEGER,total_mb INTEGER); INSERT INTO snapshots VALUES(1,'cache',5); COMMIT;"); await old.close();
  try {
    // The previous release imported into this schema: no imports table, only legacy-path rows mark the import.
    ensureState(root); createPrivateFile(paths(root).db);
    const previous = await SqliteDatabase.open(paths(root).db, { ...native, readonly: false });
    await previous.exec(`BEGIN; CREATE TABLE measurements(captured_at INTEGER NOT NULL, category TEXT NOT NULL, path TEXT NOT NULL, bytes INTEGER, error TEXT, method TEXT NOT NULL, PRIMARY KEY(captured_at, category));
CREATE TABLE capacity(captured_at INTEGER PRIMARY KEY, filesystem TEXT NOT NULL, total_bytes INTEGER NOT NULL, free_bytes INTEGER NOT NULL, used_bytes INTEGER NOT NULL);
INSERT INTO measurements VALUES(1,'cache','${legacy}',5242880,NULL,'legacy du -sm; MiB converted to bytes');
PRAGMA user_version=1; COMMIT;`);
    await previous.close();
    // The next snapshot's retention prunes every imported row.
    const db = await openHistory(root, true, native); await record(db, [sample(20_000_000, 1)], null, 1, 20_000_000); await db.close();
    const reopened = await openHistory(root, false, native);
    try { assert.equal((await reopened.query('SELECT 1 FROM measurements WHERE path=?', [legacy])).length, 0); assert.equal((await reopened.query('SELECT 1 FROM imports')).length, 1); }
    finally { await reopened.close(); }
    await assert.rejects(importLegacy(root, source, {}, '/fixture', native), /already imported/);
    assert.equal((await context(root, native, source, join(root, 'home')) as Record<string, any>).migration, null);
  } finally { rmSync(root, { recursive: true }); }
});
test('legacy unsupported schema leaves no destination', async () => {
  const root = fixture(), source = join(root, 'legacy.db'), target = join(root, 'new');
  const db = await SqliteDatabase.open(source, { ...native, readonly: false, fileMustExist: false }); await db.exec('CREATE TABLE unrelated(id TEXT)'); await db.close();
  try { await assert.rejects(importLegacy(target, source, {}, '/fixture', native), /schema/); assert.equal(existsSync(paths(target).db), false); }
  finally { rmSync(root, { recursive: true }); }
});
test('private memory preserves shared root permissions and protects its private state', async () => {
  const { chmodSync, statSync } = await import('node:fs');
  const { remember, context } = await import('../scripts/memory.js');
  const root = fixture(); if (process.platform !== 'win32') chmodSync(root, 0o755);
  const originalMode = statSync(root).mode;
  const { checkOwned } = await import('../../../../../runtime/os.js');
  try {
    assert.equal((await context(root, native)).memory.totalNotes, 0);
    assert.equal(existsSync(paths(root).state), false);
    const first = await remember(root, { kind: 'decision', scope: 'fixture volumes', summary: 'Keep selected volumes', evidence: 'fixture user selection' });
    assert.equal(statSync(root).mode, originalMode);
    checkOwned(paths(root).state, true);
    checkOwned(join(paths(root).state, 'memory.json'));
    if (process.platform !== 'win32') {
      assert.equal(statSync(paths(root).state).mode & 0o777, 0o700);
      assert.equal(statSync(join(paths(root).state, 'memory.json')).mode & 0o777, 0o600);
    }
    await remember(root, { kind: 'decision', scope: 'fixture volumes', summary: 'Keep remaining volumes', evidence: 'fixture revised selection', supersedes: first.id });
    // cli.test.ts reads the same memory back through a separate CLI process.
    const restored = await context(root, native);
    assert.equal(restored.memory.totalNotes, 2);
    assert.equal(restored.memory.decisions.length, 1);
    assert.match(restored.memory.guidance, /not permission/);
    await assert.rejects(remember(root, { kind: 'decision', scope: 'x', summary: 'missing evidence' }));
    if (process.platform !== 'win32') {
      chmodSync(root, 0o777);
      await assert.rejects(remember(root, { kind: 'observation', scope: 'x', summary: 'unsafe parent', evidence: 'fixture' }));
    }
  } finally { rmSync(root, { recursive: true }); }
});
test('context reads legacy history in place and preserves private memory', async () => {
  const { remember, context } = await import('../scripts/memory.js');
  const root = fixture(), source = join(root, 'legacy.db');
  const old = await SqliteDatabase.open(source, { ...native, readonly: false, fileMustExist: false });
  await old.exec("BEGIN; CREATE TABLE snapshots(captured_at INTEGER,category TEXT,size_mb INTEGER); CREATE TABLE disk_free(captured_at INTEGER,free_mb INTEGER,total_mb INTEGER); INSERT INTO snapshots VALUES(1,'cache',5),(2,'cache',7); INSERT INTO disk_free VALUES(2,10,20); COMMIT;");
  await old.close();
  const before = readFileSync(source);
  try {
    await remember(root, { kind: 'hypothesis', scope: 'cache', summary: 'Possible growth', evidence: 'fixture history' });
    const result = await context(root, native, source);
    assert.equal(result.history?.legacy, true);
    assert.equal(result.history?.samples.length, 1);
    assert.equal(result.history?.samples[0].bytes, 7 * 1048576);
    assert.equal(result.memory.recent[0].kind, 'hypothesis');
    assert.deepEqual(readFileSync(source), before);
    assert.equal(existsSync(paths(root).db), false);
  } finally { rmSync(root, { recursive: true }); }
});
test('context turns a legacy database or collector into a migration proposal', async () => {
  const { context } = await import('../scripts/memory.js');
  const root = fixture(), source = join(root, 'legacy.db'), home = join(root, 'home'), plist = join(home, 'Library/LaunchAgents/legacy.plist');
  mkdirSync(dirname(plist), { recursive: true }); writeFileSync(plist, '<string>/example/.disk_cache/refresh.sh</string>');
  const old = await SqliteDatabase.open(source, { ...native, readonly: false, fileMustExist: false });
  await old.exec("BEGIN; CREATE TABLE snapshots(captured_at INTEGER,category TEXT,size_mb INTEGER); CREATE TABLE disk_free(captured_at INTEGER,free_mb INTEGER,total_mb INTEGER); INSERT INTO snapshots VALUES(1,'cache',5); COMMIT;");
  await old.close();
  const before = readFileSync(source);
  try {
    const legacy = await context(root, native, source, home) as Record<string, any>;
    assert.equal(legacy.migration?.legacyDatabase, source); assert.deepEqual(legacy.migration?.legacyCollectors, [plist]);
    assert.match(legacy.next, /import-legacy/); assert.match(legacy.next, /schedule enable/); assert.match(legacy.next, /approval/);
    assert.deepEqual(readFileSync(source), before); assert.equal(existsSync(paths(root).db), false);
    const collectorOnly = await context(root, native, join(root, 'absent.db'), home) as Record<string, any>;
    assert.equal(collectorOnly.history, null); assert.equal(collectorOnly.migration?.legacyDatabase, null); assert.match(collectorOnly.next, /import-legacy/);
    rmSync(plist); await (await openHistory(root, true, native)).close();
    // A jstack history created before the import must not hide the legacy database.
    const early = await context(root, native, source, home) as Record<string, any>;
    assert.equal(early.history?.legacy, false); assert.equal(early.migration?.legacyDatabase, source); assert.match(early.next, /import-legacy/);
    await importLegacy(root, source, {}, '/fixture', native);
    const migrated = await context(root, native, source, home) as Record<string, any>;
    assert.equal(migrated.migration, null); assert.doesNotMatch(migrated.next, /import-legacy/);
    // Retention may prune old imported rows; the recorded import still counts.
    const db = await openHistory(root, true, native); await record(db, [sample(20_000_000, 1)], null, 1, 20_000_000); await db.close();
    assert.equal((await context(root, native, source, home) as Record<string, any>).migration, null);
  } finally { rmSync(root, { recursive: true }); }
});
test('a history is created in one commit and opens for writing without another', async () => {
  // Each commit is a disk sync; the header's file change counter (offset 24) counts them.
  const root = fixture(), commits = () => readFileSync(paths(root).db).readUInt32BE(24);
  try {
    await (await openHistory(root, true, native)).close(); assert.equal(commits(), 1);
    for (let i = 0; i < 2; i++) await (await openHistory(root, true, native)).close();
    assert.equal(commits(), 1);
  } finally { rmSync(root, { recursive: true }); }
});
test('new history retains private ownership when reopened', async () => {
  const root = fixture();
  try {
    const created = await openHistory(root, true, native); await created.close();
    const reopened = await openHistory(root, false, native);
    try { assert.equal(Number((await reopened.query('PRAGMA user_version'))[0]?.user_version), 1); }
    finally { await reopened.close(); }
  } finally { rmSync(root, { recursive: true }); }
});
