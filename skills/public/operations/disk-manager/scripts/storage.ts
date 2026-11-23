import { existsSync, readFileSync, realpathSync, mkdirSync, rmSync, statfsSync, opendirSync, lstatSync, statSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { atomicWrite, privateDir, checkOwned, recoverLock } from '../../../../../runtime/os.js';

export interface Profile { schemaVersion: 1; filesystem: string; categories: Record<string, string>; protectedPaths: string[]; retentionDays: number; intervalSeconds: number; snapshotTimeoutSeconds: number; runTimeoutSeconds?: number }
/** Per-category du limit for snapshots; large trees such as Documents/GitHub take over a minute. */
export const defaultSnapshotTimeoutSeconds = 300;
export interface Sample { category: string; path: string; capturedAt: number; bytes: number | null; error: string | null; method: string }
export interface Capacity { capturedAt: number; totalBytes: number; freeBytes: number; usedBytes: number; filesystem: string }
export const now = () => Math.floor(Date.now() / 1000);
export const paths = (root = join(homedir(), '.jstack')) => ({ root: resolve(root), profile: resolve(root, 'profiles/disk-manager.json'), state: resolve(root, 'state/disk-manager'), cache: resolve(root, 'cache/disk-manager'), logs: resolve(root, 'logs/disk-manager'), db: resolve(root, 'state/disk-manager/history.sqlite3') });
/** The pre-jstack collector's database. Only the default state root inherits it. */
export const legacyHistory = (root: string, home = homedir(), platform = process.platform) => platform === 'darwin' && paths(root).root === paths().root ? join(home, '.disk_cache/disk_history.db') : undefined;
/** XDG variables are accepted only when absolute, as required by the base-directory specification. */
export const xdgPath = (env: NodeJS.ProcessEnv, key: string, fallback: string) => env[key] && isAbsolute(env[key]!) && !/[\0\r\n]/.test(env[key]!) ? resolve(env[key]!) : fallback;
/** Linux's default total collection deadline. macOS keeps per-category limits only unless the profile sets one. */
export const defaultRunTimeoutSeconds = 120;
/** The largest valid runTimeoutSeconds; the systemd unit's start timeout is fixed above it. */
export const maxRunTimeoutSeconds = 3600;
/** The total collection deadline in seconds for this run, or undefined when none applies. */
export const runDeadlineSeconds = (p: Profile, platform = process.platform) => p.runTimeoutSeconds ?? (platform === 'linux' ? defaultRunTimeoutSeconds : undefined);
const within = (parent: string, child: string) => child === parent || child.startsWith(parent.replace(/\/$/, '') + sep);
export function defaultProfile(home = homedir(), platform = process.platform, env = process.env): Profile {
  if (platform !== 'darwin' && platform !== 'linux') return { schemaVersion: 1, filesystem: home, categories: {}, protectedPaths: [], retentionDays: 90, intervalSeconds: 21600, snapshotTimeoutSeconds: defaultSnapshotTimeoutSeconds, runTimeoutSeconds: defaultRunTimeoutSeconds };
  if (platform === 'linux') {
    const cache = xdgPath(env, 'XDG_CACHE_HOME', join(home, '.cache'));
    const categories: Record<string, string> = {};
    for (const [name, path] of Object.entries({ uv_cache: join(cache, 'uv'), pip: join(cache, 'pip'), npm: join(home, '.npm') })) {
      // Keep defaults narrow and nonoverlapping even with unusual XDG roots or symlink aliases.
      const canonical = (value: string) => { try { return realpathSync(value); } catch { return resolve(value); } };
      const target = canonical(path);
      if (target === '/' || target === canonical(home) || Object.values(categories).some(other => within(canonical(other), target) || within(target, canonical(other)))) continue;
      categories[name] = path;
    }
    return { schemaVersion: 1, filesystem: home, categories, protectedPaths: [], retentionDays: 90, intervalSeconds: 21600, snapshotTimeoutSeconds: defaultSnapshotTimeoutSeconds, runTimeoutSeconds: defaultRunTimeoutSeconds };
  }
  return { schemaVersion: 1, filesystem: '/System/Volumes/Data', categories: Object.fromEntries(Object.entries({ home: '', github: 'Documents/GitHub', icloud: 'Library/Mobile Documents', colima: '.colima', ollama: '.ollama', lib_appsupport: 'Library/Application Support', lib_caches: 'Library/Caches', cache: '.cache', uv_cache: '.cache/uv', hf_cache: '.cache/huggingface', torch: '.cache/torch', npm: '.npm', movies: 'Movies', downloads: 'Downloads', pictures: 'Pictures', desktop: 'Desktop', documents: 'Documents', library: 'Library', docker_desktop: 'Library/Containers/com.docker.docker', bun: '.bun', nvm: '.nvm', pyenv: '.pyenv', cursor: '.cursor', gradle: '.gradle', ghcup: '.ghcup', keras: '.keras', tensorflow: '.tensorflow', pip: '.cache/pip' }).map(([key, value]) => [key, join(home, value)])), protectedPaths: [], retentionDays: 90, intervalSeconds: 21600, snapshotTimeoutSeconds: defaultSnapshotTimeoutSeconds };
}
export function validateProfile(value: unknown): Profile {
  const p = value as Omit<Profile, 'snapshotTimeoutSeconds'> & { snapshotTimeoutSeconds?: number };
  if (!p || p.schemaVersion !== 1 || Object.keys(p).some(key => !['schemaVersion', 'filesystem', 'categories', 'protectedPaths', 'retentionDays', 'intervalSeconds', 'snapshotTimeoutSeconds', 'runTimeoutSeconds'].includes(key)) || !p.categories || typeof p.categories !== 'object' || Array.isArray(p.categories) || !Object.keys(p.categories).length || Object.keys(p.categories).length > 64) throw new Error('Invalid disk profile');
  const validPath = (path: unknown): path is string => typeof path === 'string' && isAbsolute(path) && !/[\0\r\n]/.test(path);
  if (!validPath(p.filesystem) || !Object.entries(p.categories).every(([key, path]) => /^[a-z][a-z0-9_-]{0,63}$/.test(key) && validPath(path)) || !Array.isArray(p.protectedPaths) || !p.protectedPaths.every(validPath) || !Number.isSafeInteger(p.retentionDays) || p.retentionDays < 1 || p.retentionDays > 3650 || !Number.isSafeInteger(p.intervalSeconds) || p.intervalSeconds < 300 || p.intervalSeconds > 2592000 || (p.snapshotTimeoutSeconds !== undefined && (!Number.isSafeInteger(p.snapshotTimeoutSeconds) || p.snapshotTimeoutSeconds < 1 || p.snapshotTimeoutSeconds > 3600))) throw new Error('Invalid disk profile fields');
  if (p.runTimeoutSeconds !== undefined && (!Number.isSafeInteger(p.runTimeoutSeconds) || p.runTimeoutSeconds < 1 || p.runTimeoutSeconds > maxRunTimeoutSeconds)) throw new Error('Invalid disk profile run deadline');
  // Profiles written before the timeout setting stay valid and receive the default. An absent run deadline stays absent:
  // runDeadlineSeconds applies Linux's default, and macOS keeps only its per-category limits.
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
export function requireMac(platform = process.platform): void { if (platform !== 'darwin') throw new Error('launchd scheduling requires macOS; Windows scheduling is unsupported'); }
export function requireCollection(platform = process.platform): void { if (!['darwin', 'linux'].includes(platform)) throw new Error('Disk collection supports macOS and Linux; Windows collection is unsupported'); }
export function capacity(filesystem: string): Capacity {
  requireCollection(); const fs = statfsSync(filesystem);
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
/** Fixed du locations, never PATH lookup, so the environment cannot substitute another program. */
export const duCandidates = ['/usr/bin/du', '/bin/du'];
/**
 * GNU du names itself by the path it was run as (`/usr/bin/du: ...`); uutils and BSD print `du: ...`. Only the fixed
 * candidate paths are accepted as a prefix, so a diagnostic from any other program is never mistaken for du's.
 */
const diagnosticPattern = new RegExp(`^(?:${duCandidates.map(candidate => candidate.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|')}|du): (.*): (Operation not permitted|Permission denied|No such file or directory|Input\\/output error)$`);
/** GNU quotes diagnostic operands and uses cannot-access/read prefixes; BSD prints the operand directly. */
function diagnostic(line: string): { path: string; reason: string } | null {
  const matched = diagnosticPattern.exec(line);
  if (!matched) return null;
  let operand = matched[1].replace(/^(?:cannot access|cannot read directory) /, '');
  if ((operand.startsWith("'") && operand.endsWith("'")) || (operand.startsWith('"') && operand.endsWith('"'))) operand = operand.slice(1, -1);
  return { path: operand, reason: matched[2] };
}
const deniedEntry = (line: string) => ['Operation not permitted', 'Permission denied'].includes(diagnostic(line)?.reason ?? '');
const vanishedEntry = (path: string, line: string) => { const d = diagnostic(line); return !!d && d.path !== path && within(path, d.path) && d.reason === 'No such file or directory'; };
/** Tell an unreadable protected path (macOS TCC or file mode) from a timeout, a missing category or a broken measurement. */
export function classifyFailure(error: unknown, path: string): FailureReason {
  const failure = error as { code?: unknown; stderr?: unknown } | null;
  if (failure?.code === 'ETIMEDOUT') return 'timeout';
  if (failure?.code === 'ENOBUFS') return 'output-overflow';
  // Denied and vanished entries decide nothing while another du error remains: the category itself missing is
  // `missing`, any other line is `error`, and only denied entries alone are `permission-denied`.
  const lines = String(failure?.stderr ?? '').split('\n').filter(Boolean), other = lines.filter(line => !deniedEntry(line) && !vanishedEntry(path, line));
  if (other.some(line => { const d = diagnostic(line); return d?.reason === 'No such file or directory' && d.path.replace(/\/+$/, '') === path.replace(/\/+$/, ''); })) return 'missing';
  return !other.length && lines.some(deniedEntry) ? 'permission-denied' : 'error';
}
/** nice/ionice replace themselves with du; no shell, sudo, dependency installation or unbounded helper. */
export function duCommand(path: string, platform = process.platform, available = existsSync) {
  requireCollection(platform);
  const found = duCandidates.find(candidate => available(candidate));
  if (!found) throw new Error(`du not found at ${duCandidates.join(' or ')}; jstack does not search PATH, so this category cannot be measured`);
  let file = found, args = platform === 'linux' ? ['-skx', '--', path] : ['-sk', path];
  if (platform === 'linux') {
    if (available('/usr/bin/ionice')) { args = ['-c', '3', file, ...args]; file = '/usr/bin/ionice'; }
    if (available('/usr/bin/nice')) { args = ['-n', '10', file, ...args]; file = '/usr/bin/nice'; }
  }
  return { file, args };
}
const du = (path: string, timeoutMs: number) => {
  const command = duCommand(path);
  return execFileSync(command.file, command.args, { encoding: 'utf8', timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: duBufferBytes, env: { ...process.env, LC_ALL: 'C', LANG: 'C' }, stdio: ['ignore', 'pipe', 'pipe'] });
};
/** Only the single requested operand's complete total is accepted, including paths containing whitespace. */
function allocated(output: string, path: string): number {
  const match = /^(\d+)\t([\s\S]*)$/.exec(output.replace(/\n$/, ''));
  const bytes = match && match[2] === path ? Number(match[1]) * 1024 : NaN;
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error('Invalid allocated-block measurement');
  return bytes;
}
export function measure(category: string, path: string, capturedAt = now(), timeoutMs = 30000, run: (path: string, timeoutMs: number) => string = du, platform = process.platform): Sample {
  const methodName = platform === 'linux' ? 'du -skx; allocated bytes' : 'du -sk; allocated bytes';
  try {
    const output = run(path, timeoutMs);
    const bytes = allocated(output, path);
    return { category, path, capturedAt, bytes, error: null, method: methodName };
  } catch (error) {
    const failure = error as { stdout?: unknown; stderr?: unknown } | null, reason = classifyFailure(error, path);
    const lines = String(failure?.stderr ?? '').trim().split('\n').filter(Boolean);
    const denied = lines.filter(deniedEntry), vanished = lines.filter(line => vanishedEntry(path, line)), other = lines.filter(line => !deniedEntry(line) && !vanishedEntry(path, line));
    // du may omit the total when the category itself is unreadable or missing. When only some entries are denied or
    // vanished it still totals the rest. A denied entry makes that total a flagged lower bound. A vanished entry may
    // have moved elsewhere in the category, so the total stands with a note in the method that it may undercount.
    let partialBytes = NaN;
    if (reason !== 'timeout' && reason !== 'output-overflow' && lines.length > 0 && !other.length) { try { partialBytes = allocated(String(failure?.stdout ?? ''), path); } catch { /* A missing or malformed total stays unknown. */ } }
    if (Number.isSafeInteger(partialBytes) && partialBytes >= 0) {
      const method = `${methodName}${vanished.length ? `; ${vanished.length} entr${vanished.length === 1 ? 'y' : 'ies'} vanished or moved; total may undercount` : ''}`;
      const permissionError = denied.length ? `${partialReason}: ${denied.length} unreadable entr${denied.length === 1 ? 'y' : 'ies'}; ${denied[0]}` : null;
      // Linux vanished entries remain a failing lower bound even when permission errors occur too.
      const error = vanished.length && platform === 'linux' ? `partial-vanished: ${vanished.length} entries vanished or moved${permissionError ? '; ' + permissionError : ''}` : permissionError;
      return { category, path, capturedAt, bytes: partialBytes, error: error?.slice(0, 1024) ?? null, method };
    }
    const detail = reason === 'timeout' ? `du did not finish within ${timeoutMs / 1000}s` : reason === 'output-overflow' ? `du printed more than ${duBufferBytes / 1048576} MiB and its output was truncated` : other[0] ?? lines[0] ?? (error instanceof Error ? error.message : 'Measurement failed');
    return { category, path, capturedAt, bytes: null, error: `${reason}: ${detail}`.slice(0, 1024), method: methodName };
  }
}
export interface ScanOptions { measureFn?: (category: string, path: string, capturedAt: number, timeoutMs: number) => Sample; clock?: () => number; totalMs?: number; perTargetMs?: number; maxChildren?: number }
export async function scan(root: string, p: Profile, category: string, fresh = false, options: ScanOptions = {}) {
  requireCollection(); const selected = p.categories[category]; if (!selected) throw new Error(`Unknown category: ${category}`);
  const target = realpathSync(selected), cache = paths(root).cache, file = join(cache, `${category}.json`);
  // A cached result is read without the overlap lock or state setup: it walks nothing, and the cache is written atomically.
  if (!fresh && existsSync(file)) {
    checkOwned(file); const old = JSON.parse(readFileSync(file, 'utf8'));
    const validSample = (s: Sample) => s && s.category === category && typeof s.path === 'string' && within(target, s.path) && s.path !== target && Number.isSafeInteger(s.capturedAt) && (s.bytes === null ? typeof s.error === 'string' && s.error.length > 0 : Number.isSafeInteger(s.bytes) && s.bytes >= 0 && (s.error === null || typeof s.error === 'string')) && typeof s.method === 'string';
    if (old.schemaVersion === 2 && old.path === target && Array.isArray(old.samples) && old.samples.every(validSample) && Array.isArray(old.skipped) && old.skipped.every((s: {path: string; reason: string}) => s && typeof s.path === 'string' && within(target, s.path) && typeof s.reason === 'string') && Number.isSafeInteger(old.capturedAt) && old.capturedAt <= now() && typeof old.enumerationComplete === 'boolean' && (old.enumerationComplete ? Number.isSafeInteger(old.totalChildren) && old.totalChildren === old.samples.length + old.skipped.length : old.totalChildren === null)) {
      const truncated = !old.enumerationComplete || old.skipped.length > 0;
      return { ...old, truncated, complete: !truncated && old.samples.every((s: Sample) => s.error === null), scannedChildren: old.samples.length, stale: now() - old.capturedAt >= p.intervalSeconds, protectedPaths: p.protectedPaths };
    }
  }
  return locked(root, async () => {
    const clock = options.clock ?? Date.now, started = clock(), budget = Math.min(30000, (runDeadlineSeconds(p) ?? Infinity) * 1000, options.totalMs ?? 30000), deadline = started + budget;
    // Stream at most maxChildren entries plus one lookahead. Never allocate an unbounded readdir array.
    const maxChildren = options.maxChildren ?? 256, entries: string[] = [], directory = opendirSync(target);
    let exhausted = false;
    try { while (entries.length < maxChildren && clock() < deadline) { const entry = directory.readSync(); if (!entry) { exhausted = true; break; } entries.push(join(target, entry.name)); } if (!exhausted && clock() < deadline) exhausted = directory.readSync() === null; }
    finally { directory.closeSync(); }
    const device = statSync(target).dev, samples: Sample[] = [], skipped: { path: string; reason: string }[] = [];
    for (const path of entries) {
      const remaining = deadline - clock();
      if (remaining <= 0) { skipped.push({ path, reason: 'total-deadline' }); continue; }
      try {
        const info = lstatSync(path);
        if (info.isSymbolicLink() || (process.platform === 'linux' && info.dev !== device)) { skipped.push({ path, reason: info.isSymbolicLink() ? 'symlink' : 'other-filesystem' }); continue; }
      } catch (error) { samples.push({ category, path, capturedAt: now(), bytes: null, error: `error: ${String(error)}`, method: 'lstat' }); continue; }
      const available = deadline - clock();
      if (available <= 0) { skipped.push({ path, reason: 'total-deadline' }); continue; }
      samples.push((options.measureFn ?? measure)(category, path, now(), Math.max(1, Math.min(options.perTargetMs ?? 5000, available))));
    }
    samples.sort((a, b) => (b.bytes ?? -1) - (a.bytes ?? -1));
    const truncated = !exhausted || skipped.length > 0, capturedAt = now();
    const result = { schemaVersion: 2, path: target, capturedAt, stale: false, truncated, enumerationComplete: exhausted, scannedChildren: samples.length, totalChildren: exhausted ? entries.length : null, skipped, samples, protectedPaths: p.protectedPaths, complete: !truncated && samples.every(s => s.error === null), elapsedMs: clock() - started, deadlineMs: budget };
    sharedDirectory(paths(root).root); sharedDirectory(dirname(cache)); privateDir(cache);
    atomicWrite(file, Buffer.from(JSON.stringify(result)));
    return result;
  }, { lock: 'snapshot.lock' });
}
