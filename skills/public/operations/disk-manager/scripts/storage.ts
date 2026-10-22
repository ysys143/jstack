import { existsSync, readFileSync, realpathSync, mkdirSync, rmSync, statfsSync, readdirSync, lstatSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { atomicWrite, privateDir, checkOwned, recoverLock } from '../../../../../runtime/os.js';

export interface Profile { schemaVersion: 1; filesystem: string; categories: Record<string, string>; protectedPaths: string[]; retentionDays: number; intervalSeconds: number; snapshotTimeoutSeconds: number }
/** Per-category du limit for snapshots; large trees such as Documents/GitHub take over a minute. */
export const defaultSnapshotTimeoutSeconds = 300;
export interface Sample { category: string; path: string; capturedAt: number; bytes: number | null; error: string | null; method: string }
export interface Capacity { capturedAt: number; totalBytes: number; freeBytes: number; usedBytes: number; filesystem: string }
export const now = () => Math.floor(Date.now() / 1000);
export const paths = (root = join(homedir(), '.jstack')) => ({ root: resolve(root), profile: resolve(root, 'profiles/disk-manager.json'), state: resolve(root, 'state/disk-manager'), cache: resolve(root, 'cache/disk-manager'), logs: resolve(root, 'logs/disk-manager'), db: resolve(root, 'state/disk-manager/history.sqlite3') });
/** The pre-jstack collector's database. Only the default state root inherits it. */
export const legacyHistory = (root: string, home = homedir()) => paths(root).root === paths().root ? join(home, '.disk_cache/disk_history.db') : undefined;
export function defaultProfile(home = homedir()): Profile {
  return { schemaVersion: 1, filesystem: '/System/Volumes/Data', categories: Object.fromEntries(Object.entries({ home: '', github: 'Documents/GitHub', icloud: 'Library/Mobile Documents', colima: '.colima', ollama: '.ollama', lib_appsupport: 'Library/Application Support', lib_caches: 'Library/Caches', cache: '.cache', uv_cache: '.cache/uv', hf_cache: '.cache/huggingface', torch: '.cache/torch', npm: '.npm', movies: 'Movies', downloads: 'Downloads', pictures: 'Pictures', desktop: 'Desktop', documents: 'Documents', library: 'Library', docker_desktop: 'Library/Containers/com.docker.docker', bun: '.bun', nvm: '.nvm', pyenv: '.pyenv', cursor: '.cursor', gradle: '.gradle', ghcup: '.ghcup', keras: '.keras', tensorflow: '.tensorflow', pip: '.cache/pip' }).map(([key, value]) => [key, join(home, value)])), protectedPaths: [], retentionDays: 90, intervalSeconds: 21600, snapshotTimeoutSeconds: defaultSnapshotTimeoutSeconds };
}
export function validateProfile(value: unknown): Profile {
  const p = value as Omit<Profile, 'snapshotTimeoutSeconds'> & { snapshotTimeoutSeconds?: number };
  if (!p || p.schemaVersion !== 1 || Object.keys(p).some(key => !['schemaVersion', 'filesystem', 'categories', 'protectedPaths', 'retentionDays', 'intervalSeconds', 'snapshotTimeoutSeconds'].includes(key)) || !p.categories || typeof p.categories !== 'object' || Array.isArray(p.categories) || !Object.keys(p.categories).length || Object.keys(p.categories).length > 64) throw new Error('Invalid disk profile');
  const validPath = (path: unknown): path is string => typeof path === 'string' && isAbsolute(path) && !/[\0\r\n]/.test(path);
  if (!validPath(p.filesystem) || !Object.entries(p.categories).every(([key, path]) => /^[a-z][a-z0-9_-]{0,63}$/.test(key) && validPath(path)) || !Array.isArray(p.protectedPaths) || !p.protectedPaths.every(validPath) || !Number.isSafeInteger(p.retentionDays) || p.retentionDays < 1 || p.retentionDays > 3650 || !Number.isSafeInteger(p.intervalSeconds) || p.intervalSeconds < 300 || p.intervalSeconds > 2592000 || (p.snapshotTimeoutSeconds !== undefined && (!Number.isSafeInteger(p.snapshotTimeoutSeconds) || p.snapshotTimeoutSeconds < 1 || p.snapshotTimeoutSeconds > 3600))) throw new Error('Invalid disk profile fields');
  // Profiles written before the timeout setting stay valid and receive the default.
  return { ...p, snapshotTimeoutSeconds: p.snapshotTimeoutSeconds ?? defaultSnapshotTimeoutSeconds };
}
export function profile(root: string): Profile {
  const file = paths(root).profile;
  if (!existsSync(file)) return defaultProfile();
  checkOwned(file); return validateProfile(JSON.parse(readFileSync(file, 'utf8')));
}
export function ensureState(root: string): void {
  const p = paths(root);
  sharedDirectory(p.root); sharedDirectory(join(p.root, 'state')); privateDir(p.state);
}
/** Shared jstack parents may be 0755. Only our private leaf requires 0700. */
export function sharedDirectory(directory: string): void {
  const path = resolve(directory);
  for (let current = path; dirname(current) !== current; current = dirname(current)) if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new Error('State path cannot contain symlinks');
  if (!existsSync(path)) mkdirSync(path, { recursive: true, mode: 0o700 });
  const info = lstatSync(path);
  if (!info.isDirectory() || (process.getuid && info.uid !== process.getuid()) || (process.platform !== 'win32' && (info.mode & 0o022))) throw new Error('State parent must be owned and not writable by other users');
}
const acquire = (lock: string): boolean => {
  try { mkdirSync(lock, { mode: 0o700 }); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; return false; }
};
/** The lock's recorded owner is a running process on this machine. This only decides waiting; recovery verifies. */
const liveOwner = (lock: string): boolean => {
  try {
    const owner = JSON.parse(readFileSync(join(lock, 'owner.json'), 'utf8')) as { pid?: unknown; host?: unknown };
    if (owner.host !== hostname() || typeof owner.pid !== 'number' || !Number.isSafeInteger(owner.pid) || owner.pid <= 0) return false;
    process.kill(owner.pid, 0); return true;
  } catch { return false; }
};
/**
 * `collection.lock` guards short state writes; a snapshot holds `snapshot.lock` while du runs and takes the state lock
 * only to check and to record. `waitMs` lets a writer wait out a live local owner instead of failing at once,
 * checking every `pollMs`; a missing owner record also gets one `pollMs` before recovery. Tests shorten `pollMs`.
 */
export async function locked<T>(root: string, action: () => Promise<T>, { lock: name = 'collection.lock', waitMs = 0, pollMs = 50 } = {}): Promise<T> {
  ensureState(root); const lock = join(paths(root).state, name), deadline = Date.now() + waitMs;
  const refuse = (held: string) => new Error(`Disk state is locked (${held}); inspect the active collector or interrupted collection before retrying`);
  for (let settling = true; !acquire(lock);) {
    // Wait only while a running process on this machine holds the lock, without entering recovery meanwhile.
    if (liveOwner(lock)) {
      if (Date.now() >= deadline) throw refuse('lock owner is still active');
      await new Promise(resolve => setTimeout(resolve, pollMs)); continue;
    }
    // A new owner writes its record just after creating the lock; a missing record gets one poll before recovery.
    if (settling && !existsSync(join(lock, 'owner.json'))) { settling = false; await new Promise(resolve => setTimeout(resolve, pollMs)); continue; }
    // A killed collector cannot release its lock. Recover only an owner on this machine whose process has exited;
    // another host or a lock without a verifiable owner fails at once and stays for inspection.
    try { recoverLock(lock); } catch (error) { throw refuse(error instanceof Error ? error.message : String(error)); }
  }
  // The owner record lets a later command recover the lock of a killed process. It must outlive the process, not the
  // machine: after a crash no recorded pid is running. So it skips the disk sync, a journal commit for each new file.
  try { atomicWrite(join(lock, 'owner.json'), Buffer.from(JSON.stringify({ pid: process.pid, host: hostname(), startedAt: now() })), true, false); return await action(); }
  finally { rmSync(lock, { recursive: true }); }
}
export function requireMac(platform = process.platform): void { if (platform !== 'darwin') throw new Error('Disk collection and launchd scheduling currently require macOS'); }
export function capacity(filesystem: string): Capacity {
  requireMac(); const fs = statfsSync(filesystem);
  const totalBytes = fs.blocks * fs.bsize, freeBytes = fs.bavail * fs.bsize, usedBytes = (fs.blocks - fs.bfree) * fs.bsize;
  if (![totalBytes, freeBytes, usedBytes].every(n => Number.isSafeInteger(n) && n >= 0)) throw new Error('Invalid filesystem measurement');
  return { capturedAt: now(), filesystem, totalBytes, freeBytes, usedBytes };
}
export type FailureReason = 'timeout' | 'permission-denied' | 'missing' | 'output-overflow' | 'error';
export const failureReasons: FailureReason[] = ['timeout', 'permission-denied', 'missing', 'output-overflow', 'error'];
/** du's output limit; output beyond it (ENOBUFS) is truncated and never trusted. */
const duBufferBytes = 64 * 1024 * 1024;
/** A sample with bytes and this error prefix holds only the readable part: a lower bound, never a delta input. */
export const partialReason = 'partial-permission-denied';
const deniedEntry = (line: string) => /: (Operation not permitted|Permission denied)$/.test(line);
/** du lists a directory before it stats each entry, so an entry removed in between is reported under the category. */
const vanishedEntry = (path: string, line: string) => line.startsWith(`du: ${path.replace(/\/+$/, '')}/`) && line.endsWith(': No such file or directory');
/** Tell an unreadable protected path (macOS TCC or file mode) from a timeout, a missing category or a broken measurement. */
export function classifyFailure(error: unknown, path: string): FailureReason {
  const failure = error as { code?: unknown; stderr?: unknown } | null;
  if (failure?.code === 'ETIMEDOUT') return 'timeout';
  if (failure?.code === 'ENOBUFS') return 'output-overflow';
  // Denied and vanished entries decide nothing while another du error remains: the category itself missing is
  // `missing`, any other line is `error`, and only denied entries alone are `permission-denied`.
  const lines = String(failure?.stderr ?? '').split('\n').filter(Boolean), other = lines.filter(line => !deniedEntry(line) && !vanishedEntry(path, line));
  if (other.some(line => [path, path.replace(/\/+$/, '')].some(root => line === `du: ${root}: No such file or directory`))) return 'missing';
  return !other.length && lines.some(deniedEntry) ? 'permission-denied' : 'error';
}
const du = (path: string, timeoutMs: number) => { requireMac(); return execFileSync('/usr/bin/du', ['-sk', path], { encoding: 'utf8', timeout: timeoutMs, maxBuffer: duBufferBytes, stdio: ['ignore', 'pipe', 'pipe'] }); };
export function measure(category: string, path: string, capturedAt = now(), timeoutMs = 30000, run: (path: string, timeoutMs: number) => string = du): Sample {
  try {
    const output = run(path, timeoutMs);
    const first = output.match(/^(\d+)\s/), bytes = first ? Number(first[1]) * 1024 : NaN;
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error('Invalid allocated-block measurement');
    return { category, path, capturedAt, bytes, error: null, method: 'du -sk; allocated bytes' };
  } catch (error) {
    const failure = error as { stdout?: unknown; stderr?: unknown } | null, reason = classifyFailure(error, path);
    const lines = String(failure?.stderr ?? '').trim().split('\n').filter(Boolean);
    const denied = lines.filter(deniedEntry), vanished = lines.filter(line => vanishedEntry(path, line)), other = lines.filter(line => !deniedEntry(line) && !vanishedEntry(path, line));
    // du prints no total when the category itself is unreadable or missing. When only some entries are denied or
    // vanished it still totals the rest. A denied entry makes that total a flagged lower bound. A vanished entry may
    // have moved elsewhere in the category, so the total stands with a note in the method that it may undercount.
    const total = reason !== 'timeout' && reason !== 'output-overflow' && lines.length > 0 && !other.length ? String(failure?.stdout ?? '').match(/^(\d+)\s/) : null;
    const partialBytes = total ? Number(total[1]) * 1024 : NaN;
    if (Number.isSafeInteger(partialBytes) && partialBytes >= 0) {
      const method = `du -sk; allocated bytes${vanished.length ? `; ${vanished.length} entr${vanished.length === 1 ? 'y' : 'ies'} vanished or moved; total may undercount` : ''}`;
      return { category, path, capturedAt, bytes: partialBytes, error: denied.length ? `${partialReason}: ${denied.length} unreadable entr${denied.length === 1 ? 'y' : 'ies'}; ${denied[0]}`.slice(0, 1024) : null, method };
    }
    const detail = reason === 'timeout' ? `du did not finish within ${timeoutMs / 1000}s` : reason === 'output-overflow' ? `du printed more than ${duBufferBytes / 1048576} MiB and its output was truncated` : other[0] ?? lines[0] ?? (error instanceof Error ? error.message : 'Measurement failed');
    return { category, path, capturedAt, bytes: null, error: `${reason}: ${detail}`.slice(0, 1024), method: 'du -sk; allocated bytes' };
  }
}
export function scan(root: string, p: Profile, category: string, fresh = false): { stale: boolean; truncated: boolean; scannedChildren: number; totalChildren: number; samples: Sample[]; protectedPaths: string[] } {
  requireMac(); const selected = p.categories[category]; if (!selected) throw new Error(`Unknown category: ${category}`);
  const target = realpathSync(selected), cache = paths(root).cache, file = join(cache, `${category}.json`);
  if (!fresh && existsSync(file)) {
    checkOwned(file); const old = JSON.parse(readFileSync(file, 'utf8'));
    if (old.path === target && Array.isArray(old.samples) && Number.isSafeInteger(old.capturedAt) && Number.isSafeInteger(old.totalChildren)) return { stale: now() - old.capturedAt >= p.intervalSeconds, truncated: old.truncated === true, scannedChildren: old.samples.length, totalChildren: old.totalChildren, samples: old.samples, protectedPaths: p.protectedPaths };
  }
  // One directory level, no followed symlinks, bounded child count and timeout.
  const names = readdirSync(target), totalChildren = names.length;
  const children = names.slice(0, 256).map(name => join(target, name)).filter(path => !lstatSync(path).isSymbolicLink());
  const started = Date.now(), samples: Sample[] = [];
  for (const path of children) {
    const remaining = 30000 - (Date.now() - started);
    if (remaining < 100) break;
    samples.push(measure(category, path, now(), Math.min(5000, remaining)));
  }
  samples.sort((a, b) => (b.bytes ?? -1) - (a.bytes ?? -1));
  const truncated = samples.length !== totalChildren;
  sharedDirectory(paths(root).root); sharedDirectory(dirname(cache)); privateDir(cache);
  atomicWrite(file, Buffer.from(JSON.stringify({ path: target, capturedAt: now(), samples, totalChildren, truncated })));
  return { stale: false, truncated, scannedChildren: samples.length, totalChildren, samples, protectedPaths: p.protectedPaths };
}
