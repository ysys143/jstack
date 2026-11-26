/** Shared fixtures for the disk-manager test files: temporary roots, the SQLite addon cache and history samples. */

import { linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { atomicWrite, privateDir } from '../../../../../runtime/os.js';
import { lockedBinary, nativePlatform, preparedNative, validateNativeManifest } from '../../../../../runtime/sqlite-native.js';
import type { Sample } from '../scripts/storage.js';

const nativeRoot = fileURLToPath(new URL('../../../../../native/sqlite3', import.meta.url));
/**
 * On Linux the fixtures live on the temporary memory filesystem when it may hold the loaded SQLite addon (no noexec, as
 * in a Docker container). History commits, scan caches and locks still make their real disk syncs, but a block-device
 * sync waits on the CI disk, and one slow run of five made these files WAITING. run_tests.ts picks the same directory
 * for its shared addon cache, so a hard link to the addon stays on one filesystem.
 */
const memory = () => {
  try { return readFileSync('/proc/self/mountinfo', 'utf8').split('\n').some(line => { const field = line.split(' '); return field[4] === '/dev/shm' && !field[5]!.split(',').includes('noexec'); }); }
  catch { return false; }
};
const temporary = realpathSync(process.platform === 'linux' && memory() ? '/dev/shm' : tmpdir());
// Every SQLite open lists the cache root's parent to rule out case collisions, and the system temp directory can hold
// thousands of entries. The cache therefore sits inside a directory of its own.
const ownCache = !process.env.JSTACK_DISK_TEST_CACHE;
const cacheRoot = process.env.JSTACK_DISK_TEST_CACHE ?? join(mkdtempSync(join(temporary, 'jstack-disk-native-')), 'sqlite3');
after(() => { if (process.platform !== 'win32' && ownCache) rmSync(dirname(cacheRoot), { recursive: true, force: true }); });
/**
 * A process's own cache is deleted when it ends, so its addon skips the disk sync that preparedNative gives the lasting
 * user cache; on CI disks that sync made SQLite test files mostly wait. preparedNative still verifies its size and hash.
 */
let seeded = !ownCache;
const seed = () => {
  if (seeded) return; seeded = true;
  const asset = validateNativeManifest(readFileSync(join(nativeRoot, 'manifest.json'))).assets.find(row => row.key === nativePlatform());
  if (!asset) return;
  const target = join(cacheRoot, asset.binarySha256);
  privateDir(cacheRoot); privateDir(target);
  atomicWrite(join(target, 'node_sqlite3.node'), lockedBinary(readFileSync(join(nativeRoot, `${asset.key}.tar.gz`)), asset), true, false);
};
/** One prepared SQLite addon per test process, or the owning suite's shared cache. */
export const native = { nativeRoot, get cacheRoot() { seed(); return cacheRoot; } };
export const fixture = () => mkdtempSync(join(temporary, 'jstack-disk-'));
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
