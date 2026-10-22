/** Shared fixtures for the disk-manager test files: temporary roots, the SQLite addon cache and history samples. */

import { linkSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { preparedNative } from '../../../../../runtime/sqlite-native.js';
import type { Sample } from '../scripts/storage.js';

const nativeRoot = fileURLToPath(new URL('../../../../../native/sqlite3', import.meta.url));
// Every SQLite open lists the cache root's parent to rule out case collisions, and the system temp directory can hold
// thousands of entries. The cache therefore sits inside a directory of its own.
const cacheRoot = process.env.JSTACK_DISK_TEST_CACHE ?? join(mkdtempSync(join(realpathSync(tmpdir()), 'jstack-disk-native-')), 'sqlite3');
after(() => { if (process.platform !== 'win32' && !process.env.JSTACK_DISK_TEST_CACHE) rmSync(dirname(cacheRoot), { recursive: true, force: true }); });
/** One prepared SQLite addon per test process, or the owning suite's shared cache. */
export const native = { nativeRoot, cacheRoot };
export const fixture = () => mkdtempSync(join(realpathSync(tmpdir()), 'jstack-disk-'));
/**
 * A spawned CLI prepares SQLite under its own state root. A hard link to the verified test addon spares it unpacking a
 * new copy and macOS's first-load check of a new binary; without a link it unpacks its own.
 */
export const seedNative = (stateRoot: string) => {
  const addon = preparedNative(native), target = join(stateRoot, 'native/sqlite3', basename(dirname(addon)));
  try { mkdirSync(target, { recursive: true, mode: 0o700 }); linkSync(addon, join(target, basename(addon))); }
  catch { rmSync(join(stateRoot, 'native'), { recursive: true, force: true }); }
};
export const sample = (capturedAt: number, bytes: number | null, path = '/fixture/cache'): Sample => ({ capturedAt, category: 'cache', path, bytes, error: bytes === null ? 'permission denied' : null, method: 'fixture allocated bytes' });
