import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqliteDatabase, SqlReal } from './sqlite.js';
import { nativePlatform, preparedNative } from './sqlite-native.js';

// A loaded .node stays mapped on Windows. Keep only this process's verified addon
// cache outside fixture cleanup; never use the user's real .jstack directory.
const cacheRoot = join(realpathSync(tmpdir()), `jstack-sqlite-test-cache-${process.pid}`);
const nativeRoot = fileURLToPath(new URL('../native/sqlite3', import.meta.url));
const options = { nativeRoot, cacheRoot };
const fixture = () => mkdtempSync(join(realpathSync(tmpdir()), 'jstack-sqlite-'));

test('N-API typed rows preserve int64, REAL, BLOB, NULL and read-only behavior', async () => {
  const root = fixture(), path = join(root, 'rows.sqlite');
  const db = await SqliteDatabase.open(path, { ...options, readonly: false, fileMustExist: false });
  try {
    await db.exec('CREATE TABLE values_table(id TEXT, value, real_value REAL, payload BLOB, empty)');
    await db.execute('INSERT INTO values_table VALUES (?, ?, ?, ?, ?)', ['first', 9223372036854775807n, new SqlReal(1), Buffer.from([0, 255]), null]);
    await db.execute("INSERT INTO values_table(id,value) VALUES ('question? mark', ? /* ? is a comment */)", [-9223372036854775808n]);
    const rows = await db.typedRows('values_table');
    assert.equal(rows[0]!.value, 9223372036854775807n);
    assert.equal(rows[1]!.value, -9223372036854775808n);
    assert.equal(rows[1]!.id, 'question? mark');
    assert.ok(rows[0]!.real_value instanceof SqlReal);
    assert.equal((rows[0]!.real_value as SqlReal).value, 1);
    assert.deepEqual(rows[0]!.payload, Buffer.from([0, 255]));
    assert.equal(rows[0]!.empty, null);
    await assert.rejects(db.query('SELECT value FROM values_table'), /Unsafe SQLite integer/);
    await assert.rejects(db.execute('INSERT INTO values_table(value) VALUES (?)', [9223372036854775808n]), /64-bit/);
  } finally { await db.close(); }
  const readonly = await SqliteDatabase.open(path, options);
  try { await assert.rejects(readonly.exec('DELETE FROM values_table'), /readonly/); }
  finally { await readonly.close(); rmSync(root, { recursive: true }); }
});

test('ATTACH and BEGIN IMMEDIATE commit and roll back both databases on an injected failure', async () => {
  const root = fixture(), path = join(root, 'state.sqlite'), historyPath = join(root, 'history.sqlite');
  const history = await SqliteDatabase.open(historyPath, { ...options, readonly: false, fileMustExist: false });
  await history.exec('CREATE TABLE items(id TEXT PRIMARY KEY, value INTEGER)'); await history.close();
  const db = await SqliteDatabase.open(path, { ...options, readonly: false, fileMustExist: false });
  try {
    await db.exec('CREATE TABLE threads(id TEXT PRIMARY KEY, value INTEGER)');
    await db.execute('ATTACH DATABASE ? AS history', [historyPath]);
    await db.transaction(async () => {
      await db.execute('INSERT INTO threads VALUES (?,?)', ['one', 9007199254740993n]);
      await db.execute('INSERT INTO history.items VALUES (?,?)', ['one', 9223372036854775807n]);
    });
    await assert.rejects(db.transaction(async () => {
      await db.exec('UPDATE threads SET value=4; UPDATE history.items SET value=5');
      throw new Error('injected history failure');
    }), /injected history failure/);
    assert.equal((await db.typedRows('threads'))[0]!.value, 9007199254740993n);
    assert.equal((await db.typedRows('items', '1', [], 'history'))[0]!.value, 9223372036854775807n);
    assert.deepEqual(await db.query('PRAGMA foreign_key_check'), []);
    assert.deepEqual(await db.query('PRAGMA history.foreign_key_check'), []);
  } finally { await db.close(); rmSync(root, { recursive: true }); }
});

test('missing or modified native artifacts fail offline before opening a database', async () => {
  const root = fixture();
  try {
    assert.throws(() => preparedNative({ nativeRoot: root, cacheRoot: join(root, 'cache') }), /missing its prepared SQLite assets/);
    const copy = join(root, 'native'); cpSync(nativeRoot, copy, { recursive: true });
    const archive = join(copy, `${nativePlatform()}.tar.gz`);
    const bytes = readFileSync(archive); bytes[0] = bytes[0]! ^ 0xff; writeFileSync(archive, bytes);
    assert.throws(() => preparedNative({ nativeRoot: copy, cacheRoot: join(root, 'cache') }), /modified/);
  } finally { rmSync(root, { recursive: true }); }
});

test('offline cache extraction verifies bytes and refuses a later modified addon', () => {
  const root = fixture(), cache = join(root, 'cache');
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = (() => { throw new Error('runtime network forbidden'); }) as typeof fetch;
    const binary = preparedNative({ nativeRoot, cacheRoot: cache });
    assert.equal(preparedNative({ nativeRoot, cacheRoot: cache }), binary);
    const original = readFileSync(binary); original[0] = original[0]! ^ 0xff; writeFileSync(binary, original);
    assert.throws(() => preparedNative({ nativeRoot, cacheRoot: cache }), /modified/);
  } finally { globalThis.fetch = previousFetch; rmSync(root, { recursive: true }); }
});
