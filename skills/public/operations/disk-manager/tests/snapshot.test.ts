/** State locks and the snapshot flow around du, run in process. */

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createPrivateFile } from '../../../../../runtime/os.js';
import { SqliteDatabase } from '../../../../../runtime/sqlite.js';
import { differences, openHistory, record } from '../scripts/history.js';
import { defaultProfile, ensureState, locked, now, paths, type Sample } from '../scripts/storage.js';
import { fixture, native, sample } from './_fixtures.js';

// `jst disk snapshot` requires macOS; macOS and Linux run its flow below in process within the time limits. On Windows
// each private-state check spawns PowerShell to read the ACL, about 16 per snapshot, so each test takes 10-16 s. The
// locks and the history a snapshot composes keep their Windows coverage in the lock tests above and in history.test.ts.
const skipOnWindows = process.platform === 'win32' ? 'jst disk snapshot requires macOS; Windows ACL checks make each snapshot take 10-16 s' : false;

test('collector lock excludes a concurrent writer and releases on error', async () => {
  const root = fixture();
  try {
    await locked(root, async () => { await assert.rejects(locked(root, async () => 1), /locked/); });
    await assert.rejects(locked(root, async () => { throw new Error('injected'); }), /injected/);
    assert.equal(await locked(root, async () => 7), 7);
  } finally { rmSync(root, { recursive: true }); }
});
test('a state write waits only for a live local owner, and only until its deadline', { timeout: 10_000 }, async () => {
  const root = fixture(), lock = join(paths(root).state, 'collection.lock');
  try {
    let release!: () => void;
    const held = locked(root, () => new Promise<void>(resolve => { release = resolve; }));
    // A recovery lock left by a killed process must not stretch the wait past its deadline.
    mkdirSync(`${lock}.recovery`, { mode: 0o700 });
    const started = Date.now();
    await assert.rejects(locked(root, async () => 1, { waitMs: 10, pollMs: 1 }), /still active/);
    const waited = Date.now() - started; assert.ok(waited >= 10 && waited < 2000, String(waited));
    const waiting = locked(root, async () => 'written', { waitMs: 10_000, pollMs: 1 });
    release();
    assert.equal(await waiting, 'written'); await held;
  } finally { rmSync(root, { recursive: true }); }
});
test('taking a lock writes its owner record without a disk sync', async () => {
  // Every snapshot takes three locks; a sync of each new owner record is a journal commit on CI disks.
  const fs = (await import('node:fs')).default, { syncBuiltinESMExports } = await import('node:module');
  const root = fixture(), original = fs.fsyncSync; let syncs = 0;
  ensureState(root); fs.fsyncSync = (...args) => { syncs++; return original(...args); }; syncBuiltinESMExports();
  try { assert.equal(await locked(root, async () => JSON.parse(readFileSync(join(paths(root).state, 'collection.lock/owner.json'), 'utf8')).pid), process.pid); }
  finally { fs.fsyncSync = original; syncBuiltinESMExports(); rmSync(root, { recursive: true }); }
  assert.equal(syncs, 0);
});
test('collector lock recovers only an exited owner on this machine', { skip: process.platform === 'win32' ? 'lock ownership requires POSIX uid' : false }, async () => {
  const root = fixture(), lock = join(paths(root).state, 'collection.lock');
  // A pid above every system's limit (Linux at most 2^22, macOS 99998) names no process, like an exited owner.
  const exited = 2 ** 30; assert.throws(() => process.kill(exited, 0), { code: 'ESRCH' });
  const stale = (owner: Record<string, unknown>) => { mkdirSync(lock, { mode: 0o700 }); writeFileSync(join(lock, 'owner.json'), JSON.stringify(owner), { mode: 0o600 }); };
  try {
    ensureState(root);
    stale({ pid: exited, host: hostname(), startedAt: 1 });
    assert.equal(await locked(root, async () => 7), 7); assert.equal(existsSync(lock), false);
    stale({ pid: process.pid, host: hostname(), startedAt: 1 });
    await assert.rejects(locked(root, async () => 1), /locked.*still active/); assert.equal(existsSync(lock), true);
    rmSync(lock, { recursive: true });
    stale({ pid: exited, startedAt: 1 });
    await assert.rejects(locked(root, async () => 1), /locked.*cannot be verified/); assert.equal(existsSync(lock), true);
    rmSync(lock, { recursive: true });
    await locked(root, async () => { assert.equal(JSON.parse(readFileSync(join(lock, 'owner.json'), 'utf8')).host, hostname()); });
  } finally { rmSync(root, { recursive: true }); }
});
test('snapshot measures outside the state lock and refuses only a concurrent snapshot', { skip: skipOnWindows, timeout: 10_000 }, async () => {
  const { snapshot } = await import('../scripts/main.js') as Record<string, any>;
  const { remember } = await import('../scripts/memory.js');
  const root = fixture(), p = { ...defaultProfile(root), filesystem: root, categories: { data: join(root, 'data') } }; mkdirSync(p.categories.data);
  let measuring!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { measuring = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  // A controllable du: the measurement stays pending until the test releases it.
  const slow = async (category: string, path: string, capturedAt: number): Promise<Sample> => { measuring(); await gate; return { category, path, capturedAt, bytes: 4096, error: null, method: 'fixture' }; };
  try {
    const running = snapshot(root, p, undefined, { measureFn: slow, native });
    await started;
    assert.equal((await remember(root, { kind: 'observation', scope: 'data', summary: 'Recorded during a scan', evidence: 'fixture' })).scope, 'data');
    assert.equal(await locked(root, async () => 7), 7);
    await assert.rejects(snapshot(root, p, undefined, { measureFn: slow, native }), /locked/);
    release();
    assert.deepEqual((await running).samples.map((s: Sample) => s.bytes), [4096]);
    const db = await openHistory(root, false, native);
    try { assert.deepEqual((await db.query('SELECT category, bytes FROM measurements')).map(row => [row.category, row.bytes]), [['data', 4096]]); }
    finally { await db.close(); }
  } finally { release(); rmSync(root, { recursive: true }); }
});
test('snapshot checks the history and the state lock before du runs', { skip: skipOnWindows, timeout: 10_000 }, async () => {
  const { snapshot } = await import('../scripts/main.js') as Record<string, any>;
  const roots: string[] = [];
  const setup = () => { const root = fixture(); roots.push(root); ensureState(root); mkdirSync(join(root, 'data')); return { root, p: { ...defaultProfile(root), filesystem: root, categories: { data: join(root, 'data') } } }; };
  let measured = 0;
  const stub = (category: string, path: string, capturedAt: number): Sample => { measured++; return { category, path, capturedAt, bytes: 4096, error: null, method: 'fixture' }; };
  try {
    // Another host's or an ownerless state lock fails at once instead of after the walk.
    for (const owner of [{ pid: 1, host: `not-${hostname()}`, startedAt: 1 }, null]) {
      const { root, p } = setup(), lock = join(paths(root).state, 'collection.lock'); mkdirSync(lock, { mode: 0o700 });
      if (owner) writeFileSync(join(lock, 'owner.json'), JSON.stringify(owner), { mode: 0o600 });
      await assert.rejects(snapshot(root, p, undefined, { measureFn: stub, native, pollMs: 1 }), /locked/);
    }
    const { root, p } = setup(); createPrivateFile(paths(root).db);
    const db = await SqliteDatabase.open(paths(root).db, { ...native, readonly: false }); await db.exec('CREATE TABLE x(a); PRAGMA user_version=2;'); await db.close();
    await assert.rejects(snapshot(root, p, undefined, { measureFn: stub, native }), /Unsupported disk history schema/);
    assert.equal(measured, 0);
  } finally { for (const root of roots) rmSync(root, { recursive: true }); }
});
test('a snapshot that cannot record after du reports what it measured', { skip: skipOnWindows }, async () => {
  const { snapshot } = await import('../scripts/main.js') as Record<string, any>;
  const root = fixture(), p = { ...defaultProfile(root), filesystem: root, categories: { data: join(root, 'data') } }; mkdirSync(p.categories.data);
  try {
    // The history passes the check before du; only the write after it is refused.
    const db = await openHistory(root, true, native); await db.exec("CREATE TRIGGER refuse BEFORE INSERT ON measurements BEGIN SELECT RAISE(ABORT, 'injected refusal'); END;"); await db.close();
    const error = await snapshot(root, p, undefined, { measureFn: (category: string, path: string, capturedAt: number): Sample => ({ category, path, capturedAt, bytes: 4096, error: null, method: 'fixture' }), native }).then(() => null, (failure: unknown) => failure) as Error & { unrecorded?: { samples: Sample[] } };
    assert.match(error.message, /injected refusal/); assert.match(error.message, /data=4096/);
    assert.deepEqual(error.unrecorded?.samples.map(s => [s.category, s.bytes]), [['data', 4096]]);
  } finally { rmSync(root, { recursive: true }); }
});
test('without a profile, default categories this machine lacks are not present rather than failed', { skip: skipOnWindows, timeout: 10_000 }, async () => {
  const { snapshot } = await import('../scripts/main.js') as Record<string, any>;
  const root = fixture(), configuredRoot = fixture(), home = join(root, 'home'); mkdirSync(join(home, '.npm'), { recursive: true });
  const measured: string[] = [];
  const stub = (category: string, path: string, capturedAt: number): Sample => { measured.push(category); return existsSync(path) ? { category, path, capturedAt, bytes: 4096, error: null, method: 'fixture' } : { category, path, capturedAt, bytes: null, error: `missing: du: ${path}: No such file or directory`, method: 'fixture' }; };
  const p = { ...defaultProfile(home), filesystem: root };
  try {
    const result = await snapshot(root, p, undefined, { measureFn: stub, native, defaults: true });
    assert.deepEqual(measured, ['home', 'npm']); assert.deepEqual(result.unmeasured, []);
    assert.deepEqual(result.notPresent, Object.keys(p.categories).filter(name => !['home', 'npm'].includes(name)));
    // Filesystem capacity needs macOS; the absent categories alone neither fail the run nor make it incomplete.
    assert.equal(result.exitCode, result.capacityError ? 1 : 0); assert.equal(result.complete, !result.capacityError);
    // The caller says whether its profile is the default, not the state root. A written profile names its categories
    // on purpose, so a missing one still fails.
    measured.length = 0;
    const configured = { ...p, categories: { npm: join(home, '.npm'), torch: join(home, '.cache/torch') } };
    const strict = await snapshot(configuredRoot, configured, undefined, { measureFn: stub, native });
    assert.deepEqual(measured, ['npm', 'torch']); assert.deepEqual(strict.notPresent, []);
    assert.deepEqual(strict.unmeasured.map((entry: Record<string, unknown>) => entry.reason), ['missing']); assert.equal(strict.exitCode, 1);
  } finally { rmSync(root, { recursive: true }); rmSync(configuredRoot, { recursive: true }); }
});
test('a default category deleted after earlier samples is recorded as 0 bytes, so diff shows the cleanup', { skip: skipOnWindows, timeout: 10_000 }, async () => {
  const { snapshot } = await import('../scripts/main.js') as Record<string, any>;
  const root = fixture(), home = join(root, 'home'), gradle = join(home, '.gradle'), at = now(), size = 12 * 2 ** 30; mkdirSync(gradle, { recursive: true });
  const p = { ...defaultProfile(home), filesystem: root };
  const stub = (category: string, path: string, capturedAt: number): Sample => ({ category, path, capturedAt, bytes: 4096, error: null, method: 'fixture' });
  try {
    const db = await openHistory(root, true, native);
    await record(db, [48, 30].map(hours => ({ ...sample(at - hours * 3600, size, gradle), category: 'gradle' })), null, 90, at); await db.close();
    rmSync(gradle, { recursive: true });
    const result = await snapshot(root, p, undefined, { measureFn: stub, native, defaults: true });
    assert.deepEqual(result.samples.find((s: Sample) => s.category === 'gradle'), { category: 'gradle', path: gradle, capturedAt: result.capturedAt, bytes: 0, error: null, method: 'path not present' });
    assert.equal(result.notPresent.includes('gradle'), false); assert.equal(result.notPresent.includes('torch'), true);
    const recorded = await openHistory(root, false, native);
    try {
      const row = (await differences(recorded, 24)).find(entry => entry.category === 'gradle')!;
      assert.equal(row.currentBytes, 0); assert.equal(row.previousBytes, size); assert.equal(row.deltaBytes, -size); assert.notEqual(row.previousAt, row.currentAt);
    } finally { await recorded.close(); }
  } finally { rmSync(root, { recursive: true }); }
});
test('an absent default category named explicitly is recorded as 0 bytes', { skip: skipOnWindows }, async () => {
  const { snapshot } = await import('../scripts/main.js') as Record<string, any>;
  const root = fixture(), home = join(root, 'home'); mkdirSync(home);
  try {
    const result = await snapshot(root, { ...defaultProfile(home), filesystem: root }, 'docker_desktop', { measureFn: () => { throw new Error('du must not run for an absent path'); }, native, defaults: true });
    assert.deepEqual(result.samples.map((s: Sample) => [s.category, s.bytes, s.error, s.method]), [['docker_desktop', 0, null, 'path not present']]);
    assert.deepEqual(result.notPresent, []); assert.deepEqual(result.unmeasured, []);
    const db = await openHistory(root, false, native);
    try { assert.deepEqual((await db.query('SELECT category, bytes FROM measurements')).map(row => [row.category, row.bytes]), [['docker_desktop', 0]]); }
    finally { await db.close(); }
  } finally { rmSync(root, { recursive: true }); }
});
