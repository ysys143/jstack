/** Linux defaults, bounded collection and GNU/BSD diagnostics. Native operations use tiny temporary trees only. */
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';
import { takeSamples, summarize } from '../scripts/main.js';
import { capacity, defaultProfile, duCommand, legacyHistory, locked, measure, paths, requireCollection, runDeadlineSeconds, scan, validateProfile } from '../scripts/storage.js';
import { fixture, native } from './_fixtures.js';
import { differences, openHistory, record } from '../scripts/history.js';

const linux = process.platform !== 'linux' ? 'native Linux test' : false;
test('Linux defaults select narrow nonoverlapping caches and honor absolute XDG paths', { skip: process.platform === 'win32' ? 'POSIX symlink defaults' : false }, () => {
  const home = fixture();
  try {
    const cache = join(home, 'xdg cache'), p = defaultProfile(home, 'linux', { XDG_CACHE_HOME: cache });
    assert.equal(p.filesystem, home); assert.equal(p.categories.home, undefined);
    assert.deepEqual(p.categories, { uv_cache: join(cache, 'uv'), pip: join(cache, 'pip'), npm: join(home, '.npm') });
    assert.equal(defaultProfile(home, 'linux', { XDG_CACHE_HOME: 'relative' }).categories.pip, join(home, '.cache/pip'));
    const nested = defaultProfile(home, 'linux', { XDG_CACHE_HOME: join(home, '.npm') });
    assert.equal(nested.categories.npm, undefined); assert.equal(nested.categories.uv_cache, join(home, '.npm/uv'));
    mkdirSync(cache); symlinkSync(home, join(cache, 'uv')); symlinkSync('/', join(cache, 'pip'));
    const aliases = defaultProfile(home, 'linux', { XDG_CACHE_HOME: cache });
    assert.deepEqual(aliases.categories, { npm: join(home, '.npm') });
    assert.equal(legacyHistory(paths().root, home, 'linux'), undefined);
    assert.throws(() => requireCollection('win32'), /Windows collection is unsupported/);
    assert.deepEqual(defaultProfile(home, 'win32', {}).categories, {});
    const old = { ...p }; delete old.runTimeoutSeconds;
    // A written profile without a run deadline keeps none; only Linux applies the default at run time.
    assert.equal(validateProfile(old).runTimeoutSeconds, undefined);
    assert.equal(runDeadlineSeconds(validateProfile(old), 'linux'), 120); assert.equal(runDeadlineSeconds(validateProfile(old), 'darwin'), undefined);
    assert.equal(runDeadlineSeconds(validateProfile({ ...old, runTimeoutSeconds: 600 }), 'darwin'), 600);
    assert.equal(defaultProfile(home, 'darwin').runTimeoutSeconds, undefined);
    for (const value of [0, 3601, 0.5, '100']) assert.throws(() => validateProfile({ ...p, runTimeoutSeconds: value }));
  } finally { rmSync(home, { recursive: true }); }
});
test('du priority and filesystem flags preserve literal paths and do not require helpers', () => {
  assert.deepEqual(duCommand('/a b', 'linux', path => path === '/usr/bin/du'), { file: '/usr/bin/du', args: ['-skx', '--', '/a b'] });
  // du comes from a fixed candidate list, never PATH; without any candidate the category fails to measure.
  assert.deepEqual(duCommand('/a b', 'linux', path => path === '/bin/du'), { file: '/bin/du', args: ['-skx', '--', '/a b'] });
  assert.throws(() => duCommand('/a b', 'linux', () => false), /du not found at \/usr\/bin\/du or \/bin\/du/);
  const missingDu = measure('cache', '/a b', 1, 8, path => { duCommand(path, 'linux', () => false); return ''; }, 'linux');
  assert.equal(missingDu.bytes, null); assert.match(missingDu.error!, /^error: du not found/);
  assert.deepEqual(duCommand('/a b', 'linux', () => true), { file: '/usr/bin/nice', args: ['-n', '10', '/usr/bin/ionice', '-c', '3', '/usr/bin/du', '-skx', '--', '/a b'] });
  assert.deepEqual(duCommand('/a b', 'darwin', () => true), { file: '/usr/bin/du', args: ['-sk', '/a b'] });
});
test('GNU and BSD error fixtures retain unknown and lower bounds, including mixed failures', () => {
  const path = '/x/cache', total = `8\t${path}\n`;
  const failed = (stderr: string, stdout = total, code?: string, platform: NodeJS.Platform = 'linux') => measure('cache', path, 1, 8, () => { throw Object.assign(new Error('fixture failure'), { stderr, stdout, code }); }, platform);
  for (const denied of ["du: cannot read directory '/x/cache/locked': Permission denied\n", 'du: /x/cache/locked: Operation not permitted\n']) {
    const partly = failed(denied); assert.equal(partly.bytes, 8192); assert.match(partly.error!, /^partial-permission-denied:/); assert.equal(summarize([partly], null).complete, false);
    const noTotal = failed(denied, ''); assert.equal(noTotal.bytes, null); assert.match(noTotal.error!, /^permission-denied:/);
    const mixed = failed(denied + "du: cannot access '/x/cache/bad': Input/output error\n"); assert.equal(mixed.bytes, null); assert.match(mixed.error!, /^error:/);
    for (const code of ['ETIMEDOUT', 'ENOBUFS']) assert.equal(failed(denied, total, code).bytes, null);
  }
  for (const missing of ["du: cannot access '/x/cache': No such file or directory\n", 'du: /x/cache: No such file or directory\n']) assert.match(failed(missing, '').error!, /^missing:/);
  const vanished = "du: cannot access '/x/cache/gone': No such file or directory\n";
  const lower = failed(vanished); assert.equal(lower.bytes, 8192); assert.match(lower.error!, /^partial-vanished:/); assert.equal(summarize([lower], null).exitCode, 1);
  assert.equal(failed('du: /x/cache/gone: No such file or directory\n', total, undefined, 'darwin').error, null);
  for (const output of ['', 'garbage', '1\t/another\n', total + total, '-1\t/x/cache\n', '999999999999999999999\t/x/cache\n']) assert.equal(measure('cache', path, 1, 8, () => output).bytes, null);
});
test('GNU du diagnostics prefixed with its fixed path parse like the uutils and BSD forms', () => {
  const path = '/x/cache', total = `8\t${path}\n`;
  const failed = (stderr: string, stdout = total, platform: NodeJS.Platform = 'linux') => measure('cache', path, 1, 8, () => { throw Object.assign(new Error('fixture failure'), { stderr, stdout }); }, platform);
  // GNU coreutils names itself by the path it ran as; uutils and BSD print `du:`. Every fixed candidate path is accepted.
  for (const prefix of ['/usr/bin/du', '/bin/du', 'du']) {
    // (a) A missing category is `missing`, not a generic error.
    const missing = failed(`${prefix}: cannot access '${path}': No such file or directory\n`, '');
    assert.equal(missing.bytes, null, prefix); assert.match(missing.error!, /^missing:/, prefix);
    // (b) A partly unreadable category keeps its total as a labelled lower bound and does not fail the run.
    const partly = failed(`${prefix}: cannot read directory '${path}/locked': Permission denied\n`);
    assert.equal(partly.bytes, 8192, prefix); assert.match(partly.error!, /^partial-permission-denied:/, prefix);
    const summary = summarize([partly], null);
    assert.equal(summary.partial[0].lowerBoundBytes, 8192); assert.equal(summary.complete, false); assert.equal(summary.exitCode, 0);
    assert.match(failed(`${prefix}: cannot read directory '${path}/locked': Permission denied\n`, '').error!, /^permission-denied:/, prefix);
    // A vanished entry stays a failing Linux lower bound.
    assert.match(failed(`${prefix}: cannot access '${path}/gone': No such file or directory\n`).error!, /^partial-vanished:/, prefix);
  }
  // (c) The BSD form without GNU's quoting and verbs is unchanged.
  assert.match(failed(`du: ${path}: No such file or directory\n`, '', 'darwin').error!, /^missing:/);
  assert.match(failed(`du: ${path}/locked: Operation not permitted\n`, total, 'darwin').error!, /^partial-permission-denied:/);
  // Only the fixed candidates count as du: another program's diagnostic is an unclassified error, never a lower bound.
  for (const stranger of ['/opt/other/du', 'xdu', '/usr/bin/du2']) {
    const result = failed(`${stranger}: cannot read directory '${path}/locked': Permission denied\n`);
    assert.equal(result.bytes, null, stranger); assert.match(result.error!, /^error:/, stranger);
  }
});
test('total snapshot deadline bounds sequential targets and records targets never started as unknown', async () => {
  let tick = 0, active = 0, maximum = 0;
  const calls: number[] = [], p = { ...defaultProfile('/fixture', 'linux', {}), categories: { a: '/a', b: '/b', c: '/c' }, snapshotTimeoutSeconds: 1 };
  const samples = await takeSamples(p, undefined, 1, async (category, path, capturedAt, timeout) => {
    active++; maximum = Math.max(maximum, active); calls.push(timeout); tick += 750;
    await Promise.resolve(); active--; return { category, path, capturedAt, bytes: 1024, error: null, method: 'fixture' };
  }, { clock: () => tick, deadline: 1000 });
  assert.equal(maximum, 1); assert.deepEqual(calls, [1000, 250]);
  assert.equal(samples[2].bytes, null); assert.match(samples[2].error!, /total collection deadline/);
  assert.equal(summarize(samples, null).complete, false);
});
test('native du forces C locale, a finite timeout and hard termination without a shell', { skip: linux }, () => {
  const original = childProcess.execFileSync; let seen = false;
  childProcess.execFileSync = ((file: string, args: string[], options: Record<string, any>) => {
    seen = true; assert.ok(file.endsWith('/du') || file.endsWith('/nice') || file.endsWith('/ionice'));
    assert.equal(options.env.LC_ALL, 'C'); assert.equal(options.env.LANG, 'C'); assert.equal(options.timeout, 19); assert.equal(options.killSignal, 'SIGKILL'); assert.equal(options.shell, undefined);
    assert.equal(args.at(-1), '/tiny'); throw Object.assign(new Error('timeout fixture'), { code: 'ETIMEDOUT' });
  }) as unknown as typeof childProcess.execFileSync;
  syncBuiltinESMExports();
  try { assert.match(measure('fixture', '/tiny', 1, 19).error!, /^timeout:/); assert.equal(seen, true); }
  finally { childProcess.execFileSync = original; syncBuiltinESMExports(); }
});
test('native Linux status, du and bounded scan preserve private state and never follow symlinks', { skip: linux }, async () => {
  const root = fixture(), data = join(root, 'tiny $(literal)'); mkdirSync(data); writeFileSync(join(data, 'a b'), 'fixture'); symlinkSync('/', join(data, 'root-link'));
  const p = { ...defaultProfile(root, 'linux', {}), filesystem: root, categories: { selected: data }, protectedPaths: [data] };
  try {
    assert.ok(capacity(root).totalBytes > 0); assert.ok(measure('selected', data).bytes! > 0);
    assert.match(measure('missing', join(root, 'absent')).error!, /^missing:/);
    const result = await scan(root, p, 'selected', true);
    assert.equal(result.samples.length, 1); assert.deepEqual(result.skipped, [{ path: join(data, 'root-link'), reason: 'symlink' }]);
    assert.equal(result.complete, false); assert.equal(result.totalChildren, 2); assert.equal(result.truncated, true); assert.deepEqual(result.protectedPaths, [data]);
    assert.equal((await scan(root, p, 'selected')).capturedAt, result.capturedAt);
    const bounded = await scan(root, p, 'selected', true, { maxChildren: 1 });
    assert.equal(bounded.totalChildren, null); assert.equal(bounded.enumerationComplete, false); assert.equal(bounded.complete, false);
    let tick = 0;
    const timed = await scan(root, p, 'selected', true, { totalMs: 10, clock: () => tick, measureFn: (category, path, capturedAt, timeout) => { assert.equal(timeout, 10); tick = 10; return { category, path, capturedAt, bytes: 1, error: null, method: 'fixture' }; } });
    assert.equal(timed.complete, false);
    assert.ok(timed.skipped.some((row: {reason: string}) => row.reason === 'total-deadline' || row.reason === 'symlink'));
    assert.equal(existsSync(paths(root).db), false);
    assert.equal(JSON.parse(readFileSync(join(paths(root).cache, 'selected.json'), 'utf8')).schemaVersion, 2);
  } finally { rmSync(root, { recursive: true }); }
});
test('scan and snapshot share the same overlap lock, with no expensive fallback run', { skip: linux }, async () => {
  const { snapshot } = await import('../scripts/main.js');
  const root = fixture(), data = join(root, 'tiny'); mkdirSync(data);
  const p = { ...defaultProfile(root, 'linux', {}), categories: { tiny: data }, filesystem: root };
  try {
    await locked(root, async () => {
      await assert.rejects(scan(root, p, 'tiny', true), /locked/);
      await assert.rejects(snapshot(root, p, undefined), /locked/);
      assert.equal(existsSync(paths(root).db), false);
    }, { lock: 'snapshot.lock' });
    assert.equal((await scan(root, p, 'tiny', true)).complete, true);
  } finally { rmSync(root, { recursive: true }); }
});
test('native Linux permission failure stays a lower bound', { skip: process.platform !== 'linux' || process.getuid?.() === 0 }, () => {
  const root = fixture(), denied = join(root, 'blocked'); mkdirSync(denied); writeFileSync(join(root, 'readable'), 'fixture'); chmodSync(denied, 0);
  try { const result = measure('fixture', root); assert.ok(result.bytes! > 0); assert.match(result.error!, /^partial-permission-denied:/); }
  finally { chmodSync(denied, 0o700); rmSync(root, { recursive: true }); }
});

test('macOS scan measures another device while Linux reports it skipped', { skip: process.platform === 'win32' ? 'POSIX platform fixture' : false }, async () => {
  const root = fixture(), target = join(root, 'tiny'), child = join(target, 'child'); mkdirSync(target); writeFileSync(child, 'fixture');
  const p = { ...defaultProfile(root, 'darwin'), filesystem: root, categories: { selected: target } };
  const originalLstat = fs.lstatSync, lstatDescriptor = Object.getOwnPropertyDescriptor(fs, 'lstatSync')!, platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(fs, 'lstatSync', { ...lstatDescriptor, value: (...args: Parameters<typeof fs.lstatSync>) => {
    const info = originalLstat(...args);
    return info && String(args[0]) === child ? Object.defineProperty(info, 'dev', { value: Number(info.dev) + 1 }) : info;
  } });
  syncBuiltinESMExports();
  try {
    for (const platform of ['darwin', 'linux']) {
      Object.defineProperty(process, 'platform', { ...platformDescriptor, value: platform });
      const measured: string[] = [];
      const result = await scan(root, p, 'selected', true, { measureFn: (category, path, capturedAt) => { measured.push(path); return { category, path, capturedAt, bytes: 1024, error: null, method: 'fixture' }; } });
      assert.deepEqual(measured, platform === 'darwin' ? [child] : []);
      assert.deepEqual(result.skipped, platform === 'darwin' ? [] : [{ path: child, reason: 'other-filesystem' }]);
      assert.equal(result.complete, platform === 'darwin');
    }
  } finally {
    Object.defineProperty(process, 'platform', platformDescriptor); Object.defineProperty(fs, 'lstatSync', lstatDescriptor); syncBuiltinESMExports(); rmSync(root, { recursive: true });
  }
});
test('mixed vanished and denied GNU/BSD entries keep Linux failure and no diff delta, preserving macOS behavior', { skip: process.platform === 'win32' ? 'macOS/Linux collector fixture' : false }, async () => {
  const root = fixture(), db = await openHistory(root, true, native), at = 2_000_000, path = '/tiny/cache';
  const diagnostics = [
    "du: cannot read directory '/tiny/cache/locked': Permission denied\ndu: cannot access '/tiny/cache/gone': No such file or directory\n",
    'du: /tiny/cache/locked: Operation not permitted\ndu: /tiny/cache/gone: No such file or directory\n',
  ];
  try {
    for (const [index, stderr] of diagnostics.entries()) for (const platform of ['linux', 'darwin'] as const) {
      const category = `${platform}_${index}`;
      const current = measure(category, path, at, 100, () => { throw Object.assign(new Error('fixture mixed failure'), { stderr, stdout: `8\t${path}\n` }); }, platform);
      assert.equal(current.bytes, 8192);
      assert.match(current.error!, platform === 'linux' ? /^partial-vanished:/ : /^partial-permission-denied:/);
      assert.match(current.error!, /unreadable/); assert.match(current.method, /vanished or moved/);
      const result = summarize([current], null);
      assert.equal(result.complete, false); assert.equal(result.exitCode, platform === 'linux' ? 1 : 0);
      assert.equal(result.partial[0].lowerBoundBytes, 8192);
      await record(db, [{ ...current, capturedAt: at - 90000, bytes: 4096, error: null }], null, 90, at);
      await record(db, [current], null, 90, at);
    }
    const rows = await differences(db, 24, at);
    assert.equal(rows.length, 4);
    for (const row of rows) { assert.equal(row.previousBytes, 4096); assert.equal(row.currentBytes, 8192); assert.equal(row.deltaBytes, null); }
  } finally { await db.close(); rmSync(root, { recursive: true }); }
});
test('macOS scan keeps exit status 0 for an incomplete result while Linux fails it, and a cached scan needs no lock', { skip: process.platform === 'win32' ? 'POSIX platform fixture' : false }, async () => {
  const { main } = await import('../scripts/main.js');
  const root = fixture(), target = join(root, 'tiny'); mkdirSync(target); symlinkSync('/', join(target, 'root-link'));
  mkdirSync(join(root, 'profiles'), { mode: 0o700 });
  writeFileSync(paths(root).profile, JSON.stringify({ schemaVersion: 1, filesystem: root, categories: { tiny: target }, protectedPaths: [], retentionDays: 90, intervalSeconds: 3600 }), { mode: 0o600 });
  const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!, write = process.stdout.write;
  let output = '';
  try {
    for (const [platform, status] of [['darwin', 0], ['linux', 1]] as const) {
      Object.defineProperty(process, 'platform', { ...platformDescriptor, value: platform });
      output = '';
      process.stdout.write = ((chunk: string) => { output += chunk; return true; }) as typeof process.stdout.write;
      // Only an enumerated symlink: nothing runs du, and the result is incomplete.
      const code = await main(['scan', 'tiny', '--fresh', '--root', root]);
      process.stdout.write = write;
      assert.equal(code, status, platform); assert.equal(JSON.parse(output).complete, false);
    }
  } finally { process.stdout.write = write; Object.defineProperty(process, 'platform', platformDescriptor); }
  try {
    // Reading the cache walks nothing, so a held overlap lock does not refuse it.
    const p = validateProfile(JSON.parse(readFileSync(paths(root).profile, 'utf8')));
    await locked(root, async () => { const cached = await scan(root, p, 'tiny'); assert.equal(cached.complete, false); assert.equal(cached.schemaVersion, 2); }, { lock: 'snapshot.lock' });
  } finally { rmSync(root, { recursive: true }); }
});
test('children not started before the scan deadline are reported as total-deadline skips, never lstat or measured', { skip: process.platform === 'win32' ? 'POSIX platform fixture' : false }, async () => {
  const root = fixture(), target = join(root, 'tiny'), children = ['a', 'b', 'c'].map(name => join(target, name)); mkdirSync(target);
  for (const child of children) writeFileSync(child, 'fixture');
  const p = { ...defaultProfile(root, 'darwin'), filesystem: root, categories: { selected: target } };
  const originalLstat = fs.lstatSync, lstatDescriptor = Object.getOwnPropertyDescriptor(fs, 'lstatSync')!;
  let tick = 0, onLstat = () => {}; const inspected: string[] = [];
  Object.defineProperty(fs, 'lstatSync', { ...lstatDescriptor, value: (...args: Parameters<typeof fs.lstatSync>) => {
    if (children.includes(String(args[0]))) { inspected.push(String(args[0])); onLstat(); }
    return originalLstat(...args);
  } });
  syncBuiltinESMExports();
  try {
    // No symlink child: every skip below can only come from the deadline. The fake clock passes the deadline at a
    // chosen point: after the first du (before the next child is inspected), or during the first child's lstat.
    for (const scenario of ['after first du', 'during first lstat'] as const) {
      tick = 0; inspected.length = 0; onLstat = scenario === 'during first lstat' ? () => { tick = 10; } : () => {};
      const measured: string[] = [];
      const result = await scan(root, p, 'selected', true, { totalMs: 10, clock: () => tick, measureFn: (category, path, capturedAt) => { measured.push(path); tick = 10; return { category, path, capturedAt, bytes: 1024, error: null, method: 'fixture' }; } });
      const skippedPaths = result.skipped.map((row: { path: string }) => row.path);
      assert.equal(result.enumerationComplete, true, scenario); assert.equal(result.totalChildren, 3, scenario);
      assert.deepEqual(result.skipped.map((row: { reason: string }) => row.reason), scenario === 'after first du' ? ['total-deadline', 'total-deadline'] : ['total-deadline', 'total-deadline', 'total-deadline'], scenario);
      assert.deepEqual([...measured, ...skippedPaths].sort(), [...children].sort(), scenario);
      // No du ran for a skipped child; once the deadline passed, no further child was even inspected.
      assert.equal(measured.length, scenario === 'after first du' ? 1 : 0, scenario);
      if (scenario === 'after first du') assert.deepEqual(inspected, measured, scenario); else assert.equal(inspected.length, 1, scenario);
      assert.equal(result.truncated, true, scenario); assert.equal(result.complete, false, scenario);
    }
  } finally { Object.defineProperty(fs, 'lstatSync', lstatDescriptor); syncBuiltinESMExports(); rmSync(root, { recursive: true }); }
});
test('Linux scan without a CATEGORY refuses instead of scanning home, even when the profile defines home', { skip: process.platform === 'win32' ? 'POSIX platform fixture' : false }, async () => {
  const { main } = await import('../scripts/main.js');
  const root = fixture(), home = join(root, 'home'); mkdirSync(home);
  mkdirSync(join(root, 'profiles'), { mode: 0o700 });
  writeFileSync(paths(root).profile, JSON.stringify({ schemaVersion: 1, filesystem: root, categories: { home }, protectedPaths: [], retentionDays: 90, intervalSeconds: 3600 }), { mode: 0o600 });
  const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!, write = process.stdout.write, writeError = process.stderr.write;
  let output = '', errors = '';
  try {
    Object.defineProperty(process, 'platform', { ...platformDescriptor, value: 'linux' });
    process.stdout.write = ((chunk: string) => { output += chunk; return true; }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: string) => { errors += chunk; return true; }) as typeof process.stderr.write;
    const code = await main(['scan', '--fresh', '--root', root]);
    process.stdout.write = write; process.stderr.write = writeError;
    assert.equal(code, 1); assert.equal(output, '');
    assert.match(JSON.parse(errors).error, /Linux scan requires an explicit CATEGORY/);
    assert.equal(existsSync(join(paths(root).cache, 'home.json')), false);
  } finally { process.stdout.write = write; process.stderr.write = writeError; Object.defineProperty(process, 'platform', platformDescriptor); rmSync(root, { recursive: true }); }
});
test('a macOS fresh scan takes the shared snapshot.lock and refuses while it is held', { skip: process.platform === 'win32' ? 'POSIX platform fixture' : false }, async () => {
  const root = fixture(), data = join(root, 'tiny'); mkdirSync(data);
  const p = { ...defaultProfile(root, 'darwin'), filesystem: root, categories: { tiny: data } };
  const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!;
  try {
    Object.defineProperty(process, 'platform', { ...platformDescriptor, value: 'darwin' });
    await locked(root, async () => {
      await assert.rejects(scan(root, p, 'tiny', true), /locked/);
      assert.equal(existsSync(join(paths(root).cache, 'tiny.json')), false);
    }, { lock: 'snapshot.lock' });
    assert.equal((await scan(root, p, 'tiny', true)).complete, true);
  } finally { Object.defineProperty(process, 'platform', platformDescriptor); rmSync(root, { recursive: true }); }
});
