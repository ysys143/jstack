import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { isMain } from '../../../../../runtime/entry.js';
import { profile, paths, now, capacity, measure, scan, locked, requireMac, legacyHistory, failureReasons, partialReason, type Profile, type Sample, type FailureReason } from './storage.js';
import { openHistory, record, differences, capacityDifference, history, chart, importLegacy, legacyImported } from './history.js';
import { schedule } from './scheduler.js';
import type { NativeOptions } from '../../../../../runtime/sqlite.js';
import { context, remember } from './memory.js';

export const HELP = `jst disk context|remember --file NOTE.json|status|config|scan [CATEGORY]|snapshot [CATEGORY]|diff|history [CATEGORY]
         schedule status|enable|disable | import-legacy --source FILE
Options: --root DIR --hours 24 --days 14 --fresh --json --cli /absolute/bin/jst
All collection is read-only. Snapshot writes history; scheduling is opt-in.
No command deletes user data. Cleanup remains a scoped, reviewed skill workflow.
`;
function parse(argv: string[]) {
  const flags = new Map<string, string>(), positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    if (flags.has(arg)) throw new Error(`Repeated option: ${arg}`);
    if (['--json', '--fresh', '--help'].includes(arg)) { flags.set(arg, 'true'); continue; }
    if (!['--root', '--hours', '--days', '--source', '--cli', '--file'].includes(arg) || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`Invalid option: ${arg}`);
    flags.set(arg, argv[++i]);
  }
  return { flags, positional };
}
type MeasureFn = (category: string, path: string, capturedAt: number, timeoutMs: number) => Sample | Promise<Sample>;
export async function takeSamples(p: Profile, category: string | undefined, at: number, measureFn: MeasureFn = measure): Promise<Sample[]> {
  const samples: Sample[] = [];
  for (const [name, path] of Object.entries(p.categories).filter(([name]) => !category || name === category)) samples.push(await measureFn(name, path, at, p.snapshotTimeoutSeconds * 1000));
  return samples;
}
const remedies: Record<FailureReason, string> = {
  timeout: 'Raise snapshotTimeoutSeconds in the disk-manager profile or narrow the category.',
  'permission-denied': 'macOS privacy protection or file permissions blocked du. Granting Full Disk Access to the Node binary that runs the collector is the user\'s decision; jstack never escalates. Otherwise remove the category.',
  missing: 'The path does not exist; fix or remove the category in the disk-manager profile.',
  error: 'Inspect the error and the category path.',
  'output-overflow': 'du printed more than 64 MiB, usually from very many unreadable entries; narrow the category.',
};
const partialRemedy = 'du could not read some entries (macOS privacy protection or file permissions), so the size covers the readable part only: a lower bound that diff never turns into a delta. Granting Full Disk Access to the Node binary that runs the collector is the user\'s decision; jstack never escalates.';
/**
 * Every unmeasured category stays unknown and keeps the run incomplete. A partly readable category keeps its
 * lower bound under `partial`. Protected paths, whole or partial, do not fail the run; every other failure does.
 */
export function summarize(samples: Sample[], capacityError: string | null) {
  const lowerBound = (s: Sample) => s.bytes !== null && !!s.error?.startsWith(`${partialReason}:`);
  const partial = samples.filter(lowerBound).map(s => ({ category: s.category, path: s.path, lowerBoundBytes: s.bytes, error: s.error, remedy: partialRemedy }));
  const unmeasured = samples.filter(s => s.error !== null && !lowerBound(s)).map(s => {
    const reason = failureReasons.find(r => s.error!.startsWith(`${r}:`)) ?? 'error';
    return { category: s.category, path: s.path, reason, error: s.error, remedy: remedies[reason] };
  });
  return { complete: samples.every(s => s.error === null) && !capacityError, partial, unmeasured, exitCode: capacityError || unmeasured.some(u => u.reason !== 'permission-denied') ? 1 : 0 };
}
/** A snapshot waits this long for a live local owner of the state lock; another host or an unverifiable owner fails. */
const stateWaitMs = 60_000;
/**
 * du can run for hours, so it runs under `snapshot.lock`, which refuses only another snapshot. `remember`, import and
 * schedule changes stay available; the state lock is taken only to check the history before du and to record after it.
 */
export async function snapshot(root: string, p: Profile, category: string | undefined, { measureFn = measure as MeasureFn, native = {} as NativeOptions, defaults = false, pollMs = undefined as number | undefined } = {}) {
  return locked(root, async () => {
    // Fail before du, not after hours of it: an unsupported history, another host's lock or an unverifiable owner stops
    // here. Opening the history for writing also records an import that predates the imports table.
    const recorded = await locked(root, async () => {
      const db = await openHistory(root, true, native);
      try { return new Set((await db.query('SELECT DISTINCT category FROM measurements')).map(row => String(row.category))); } finally { await db.close(); }
    }, { waitMs: stateWaitMs, pollMs });
    // `defaults` says the caller's profile is jstack's default, so a category this machine lacks (no Docker Desktop, no
    // Gradle) is not present rather than a failure. A written profile names its categories, and a missing one fails.
    const absent = (path: string) => { try { statSync(path); return false; } catch (error) { return ['ENOENT', 'ENOTDIR'].includes(String((error as NodeJS.ErrnoException).code)); } };
    const notPresent = !defaults ? [] : Object.entries(p.categories).filter(([name, path]) => (!category || name === category) && absent(path)).map(([name]) => name);
    // A category deleted after earlier samples, such as a cleaned cache, or one named explicitly is recorded as 0 bytes
    // so diff and history show it. An absent default without history in a full snapshot stays only under notPresent.
    const gone = new Set(notPresent.filter(name => name === category || recorded.has(name)));
    const listed = { ...p, categories: Object.fromEntries(Object.entries(p.categories).filter(([name]) => !notPresent.includes(name) || gone.has(name))) };
    const at = now(), samples = await takeSamples(listed, category, at, (name, path, capturedAt, timeoutMs) => gone.has(name) ? { category: name, path, capturedAt, bytes: 0, error: null, method: 'path not present' } : measureFn(name, path, capturedAt, timeoutMs));
    let space = null, capacityError: string | null = null;
    try { space = { ...capacity(p.filesystem), capturedAt: at }; } catch (error) { capacityError = String(error); }
    try {
      await locked(root, async () => {
        const db = await openHistory(root, true, native);
        try { await record(db, samples, space, p.retentionDays, at); } finally { await db.close(); }
      }, { waitMs: stateWaitMs, pollMs });
    } catch (error) {
      // Hours of du are not discarded: the error carries what was measured, in its text and as data.
      const cause = error instanceof Error ? error.message : String(error), measured = samples.map(s => `${s.category}=${s.bytes ?? 'unknown'}`).join(', ');
      throw Object.assign(new Error(`Snapshot measured but did not record (${cause}); measured bytes: ${measured}`), { unrecorded: { capturedAt: at, samples, space } });
    }
    return { capturedAt: at, timeoutSeconds: p.snapshotTimeoutSeconds, samples, notPresent: notPresent.filter(name => !gone.has(name)), space, capacityError, ...summarize(samples, capacityError) };
  }, { lock: 'snapshot.lock', pollMs });
}
export async function main(argv = process.argv.slice(2)): Promise<number> {
  try {
    const { flags, positional } = parse(argv), [action = 'help', category] = positional;
    if (action === 'help' || flags.has('--help')) { process.stdout.write(HELP); return 0; }
    if (positional.length > 2) throw new Error('Unexpected positional arguments');
    const root = paths(flags.get('--root') ?? join(homedir(), '.jstack')).root, defaults = !existsSync(paths(root).profile), p = profile(root);
    const positive = (flag: string, fallback: number) => { const n = Number(flags.get(flag) ?? fallback); if (!Number.isSafeInteger(n) || n < 1 || n > 36500) throw new Error(`Invalid ${flag}`); return n; };
    let result: unknown, code = 0;
    if (action === 'context') result = await context(root);
    else if (action === 'remember') {
      if (!flags.get('--file')) throw new Error('remember requires --file NOTE.json');
      result = await remember(root, JSON.parse(readFileSync(flags.get('--file')!, 'utf8')));
    } else if (action === 'config') result = { ...paths(root), profile: p };
    else if (action === 'status') result = capacity(p.filesystem);
    else if (action === 'scan') result = scan(root, p, category ?? 'home', flags.has('--fresh'));
    else if (action === 'snapshot') {
      requireMac();
      if (category && !p.categories[category]) throw new Error('Unknown snapshot category');
      const { exitCode, ...summary } = await snapshot(root, p, category, { defaults });
      code = exitCode; result = summary;
    } else if (action === 'history' || action === 'diff') {
      if (!existsSync(paths(root).db)) {
        const legacy = legacyHistory(root);
        throw new Error(`No history exists; take a snapshot or import legacy history first${legacy && existsSync(legacy) ? `. A legacy database exists at ${legacy}; diff and history read only the jstack database, so propose jst disk import-legacy --source BACKUP (references/installation.md)` : ''}`);
      }
      const db = await openHistory(root);
      try {
        // A jstack history written before the import does not make the legacy database obsolete.
        const legacy = legacyHistory(root);
        if (legacy && existsSync(legacy) && !(await legacyImported(db))) process.stderr.write(`Legacy history at ${legacy} is not imported; ${action} reads only the jstack database. Propose jst disk import-legacy --source BACKUP (references/installation.md).\n`);
        result = action === 'diff' ? { categories: await differences(db, positive('--hours', 24)), filesystem: await capacityDifference(db, positive('--hours', 24)) } : await history(db, category ?? 'all', positive('--days', 14));
        if (action === 'history' && !flags.has('--json')) { process.stdout.write(`Daily latest values (UTC), ${category ?? 'filesystem used space'}\n${chart(result as Record<string, unknown>[])}\n`); return 0; }
      } finally { await db.close(); }
    } else if (action === 'schedule') result = !category || category === 'status' ? schedule('status', root, p.intervalSeconds) : await locked(root, async () => schedule(category, root, p.intervalSeconds, flags.get('--cli')));
    else if (action === 'import-legacy') {
      if (!flags.get('--source')) throw new Error('import-legacy requires --source FILE');
      result = await locked(root, () => importLegacy(root, flags.get('--source')!, p.categories, p.filesystem));
    } else throw new Error('Unknown disk action; run jst disk --help');
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return code;
  } catch (error) {
    const unrecorded = (error as { unrecorded?: unknown } | null)?.unrecorded;
    process.stderr.write(JSON.stringify({ error: error instanceof Error ? error.message : String(error), ...(unrecorded ? { unrecorded } : {}) }) + '\n'); return 1;
  }
}
if (isMain(import.meta.url)) main().then(code => { process.exitCode = code; });
