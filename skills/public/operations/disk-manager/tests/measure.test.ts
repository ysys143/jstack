/** Profile, du classification, snapshot summary, scheduler, scan and skill contract units; no SQLite, no CLI process. */

import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { catalogRoot } from '../../../../../runtime/catalog_cli.js';
import { sourcePath } from '../../../../../runtime/skill_catalog.js';
import { label, launchAgent, schedule } from '../scripts/scheduler.js';
import { defaultProfile, measure, paths, profile, requireMac, type Sample, scan, validateProfile } from '../scripts/storage.js';
import { fixture, sample } from './_fixtures.js';

test('disk profile rejects executable settings and reports defaults without writing', () => {
  const root = fixture();
  try {
    assert.equal(profile(root).retentionDays, 90); assert.equal(existsSync(paths(root).state), false);
    const p = defaultProfile('/fixture');
    assert.throws(() => validateProfile({ ...p, shell: 'rm -rf' }));
    assert.throws(() => validateProfile({ ...p, categories: { cache: 'relative' } }));
    assert.throws(() => validateProfile({ ...p, intervalSeconds: 0 }));
    assert.throws(() => requireMac('linux'));
  } finally { rmSync(root, { recursive: true }); }
});
test('snapshot timeout is a bounded profile setting with a default', () => {
  const root = fixture();
  try {
    const p = defaultProfile('/fixture') as unknown as Record<string, unknown>;
    assert.equal((profile(root) as unknown as Record<string, unknown>).snapshotTimeoutSeconds, 300);
    for (const valid of [1, 3600]) assert.equal((validateProfile({ ...p, snapshotTimeoutSeconds: valid }) as unknown as Record<string, unknown>).snapshotTimeoutSeconds, valid);
    for (const invalid of [0, 1.5, 'x', 3601]) assert.throws(() => validateProfile({ ...p, snapshotTimeoutSeconds: invalid }), /Invalid disk profile/);
    const { snapshotTimeoutSeconds: _, ...older } = p;
    assert.equal((validateProfile(older) as unknown as Record<string, unknown>).snapshotTimeoutSeconds, 300);
  } finally { rmSync(root, { recursive: true }); }
});
test('failed du measurements are classified without running du', async () => {
  const { classifyFailure } = await import('../scripts/storage.js') as Record<string, any>;
  const failure = (message: string, fields: Record<string, unknown>) => Object.assign(new Error(message), fields);
  assert.equal(classifyFailure(failure('spawnSync /usr/bin/du ETIMEDOUT', { code: 'ETIMEDOUT', status: null }), '/x/a'), 'timeout');
  assert.equal(classifyFailure(failure('Command failed: /usr/bin/du -sk /x/Movies', { status: 1, stderr: 'du: /x/Movies: Operation not permitted\n' }), '/x/Movies'), 'permission-denied');
  assert.equal(classifyFailure(failure('Command failed: /usr/bin/du -sk /x/locked', { status: 1, stderr: 'du: /x/locked: Permission denied\n' }), '/x/locked'), 'permission-denied');
  assert.equal(classifyFailure(failure('Command failed: /usr/bin/du -sk /x/absent', { status: 1, stderr: 'du: /x/absent: No such file or directory\n' }), '/x/absent'), 'missing');
  assert.equal(classifyFailure(new Error('Invalid allocated-block measurement'), '/x/a'), 'error');
});
test('an entry that vanishes during du keeps the total and only a missing category fails', async () => {
  const { classifyFailure } = await import('../scripts/storage.js') as Record<string, any>;
  const { summarize } = await import('../scripts/main.js') as Record<string, any>;
  // du lists a directory before it stats each entry; one removed in between prints ENOENT, exits 1 and still totals.
  const du = (stdout: string, stderr: string) => () => { throw Object.assign(new Error(`Command failed: /usr/bin/du -sk /x/cache\n${stderr}`), { status: 1, stdout, stderr }); };
  const gone = 'du: /x/cache/build/tmp.1: No such file or directory\n', denied = 'du: /x/cache/locked: Operation not permitted\n';
  const vanished = measure('cache', '/x/cache', 1, 1000, du('2048\t/x/cache\n', gone));
  assert.equal(vanished.bytes, 2048 * 1024); assert.equal(vanished.error, null); assert.equal(vanished.method, 'du -sk; allocated bytes; 1 entry vanished or moved; total may undercount');
  assert.deepEqual(summarize([vanished], null), { complete: true, partial: [], unmeasured: [], exitCode: 0 });
  // Without a total, a vanished entry alone leaves no measurement: an error, not a missing category.
  assert.equal(classifyFailure(Object.assign(new Error(gone), { stderr: gone }), '/x/cache'), 'error');
  const mixed = measure('cache', '/x/cache', 1, 1000, du('2048\t/x/cache\n', gone + denied));
  assert.equal(mixed.bytes, 2048 * 1024); assert.equal(mixed.error, `partial-permission-denied: 1 unreadable entry; ${denied.trim()}`);
  assert.equal(summarize([mixed], null).exitCode, 0); assert.deepEqual(summarize([mixed], null).partial.map((entry: Record<string, unknown>) => entry.category), ['cache']);
  const absent = measure('cache', '/x/cache', 1, 1000, du('', 'du: /x/cache: No such file or directory\n'));
  assert.equal(absent.bytes, null); assert.equal(absent.error, 'missing: du: /x/cache: No such file or directory'); assert.equal(summarize([absent], null).exitCode, 1);
  const broken = measure('cache', '/x/cache', 1, 1000, du('2048\t/x/cache\n', `${gone}du: /x/cache/disk: Input/output error\n`));
  assert.equal(broken.bytes, null); assert.equal(broken.error, 'error: du: /x/cache/disk: Input/output error'); assert.equal(summarize([broken], null).exitCode, 1);
  // A denied entry decides the reason only when no other du error remains.
  const deniedOnly = measure('cache', '/x/cache', 1, 1000, du('2048\t/x/cache\n', denied));
  assert.equal(deniedOnly.bytes, 2048 * 1024); assert.equal(deniedOnly.error, `partial-permission-denied: 1 unreadable entry; ${denied.trim()}`);
  const deniedAndBroken = measure('cache', '/x/cache', 1, 1000, du('2048\t/x/cache\n', `${denied}du: /x/cache/disk: Input/output error\n`));
  assert.equal(deniedAndBroken.bytes, null); assert.equal(deniedAndBroken.error, 'error: du: /x/cache/disk: Input/output error');
  assert.deepEqual(summarize([deniedAndBroken], null).unmeasured.map((entry: Record<string, unknown>) => entry.reason), ['error']); assert.equal(summarize([deniedAndBroken], null).exitCode, 1);
  // Output beyond du's buffer is truncated, so neither its total nor its denied entries can be trusted.
  const overflow = measure('cache', '/x/cache', 1, 1000, () => { throw Object.assign(new Error('spawnSync /usr/bin/du ENOBUFS'), { code: 'ENOBUFS', stdout: '2048\t/x/cache\n', stderr: denied }); });
  assert.equal(overflow.bytes, null); assert.match(overflow.error!, /^output-overflow: /);
  assert.deepEqual(summarize([overflow], null).unmeasured.map((entry: Record<string, unknown>) => entry.reason), ['output-overflow']); assert.equal(summarize([overflow], null).exitCode, 1);
});
test('snapshot summary keeps protected paths unknown without failing the run', async () => {
  const { summarize, takeSamples } = await import('../scripts/main.js') as Record<string, any>;
  const at = 1_000, measured = { ...sample(at, 10), category: 'data' };
  const failed = (category: string, error: string): Sample => ({ category, path: `/x/${category}`, capturedAt: at, bytes: null, error, method: 'fixture' });
  const protectedOnly = summarize([measured, failed('movies', 'permission-denied: du: /x/movies: Operation not permitted')], null);
  assert.equal(protectedOnly.complete, false); assert.equal(protectedOnly.exitCode, 0);
  assert.deepEqual(protectedOnly.unmeasured.map((entry: Record<string, unknown>) => [entry.category, entry.reason]), [['movies', 'permission-denied']]);
  assert.match(protectedOnly.unmeasured[0].remedy, /Full Disk Access/);
  for (const error of ['timeout: du did not finish within 7s', 'missing: du: /x/a: No such file or directory', 'error: Invalid allocated-block measurement']) assert.equal(summarize([measured, failed('a', error)], null).exitCode, 1, error);
  assert.equal(summarize([measured], 'Error: statfs failed').exitCode, 1);
  assert.deepEqual(summarize([measured], null), { complete: true, partial: [], unmeasured: [], exitCode: 0 });
  const lowerBound = { ...measured, category: 'lib_caches', bytes: 4096, error: 'partial-permission-denied: 1 unreadable entry; du: /x/lib_caches/locked: Operation not permitted' };
  const partly = summarize([measured, lowerBound], null);
  assert.equal(partly.complete, false); assert.equal(partly.exitCode, 0); assert.deepEqual(partly.unmeasured, []);
  assert.deepEqual(partly.partial.map((entry: Record<string, unknown>) => [entry.category, entry.lowerBoundBytes]), [['lib_caches', 4096]]);
  assert.match(partly.partial[0].remedy, /lower bound/);
  assert.equal(summarize([lowerBound, failed('a', 'timeout: du did not finish within 7s')], null).exitCode, 1);
  const calls: [string, number][] = [];
  const spy = (category: string, path: string, capturedAt: number, timeoutMs: number): Sample => { calls.push([category, timeoutMs]); return { ...measured, category, path, capturedAt }; };
  const p = { ...defaultProfile('/fixture'), categories: { a: '/x', b: '/y' }, snapshotTimeoutSeconds: 7 };
  assert.deepEqual((await takeSamples(p, undefined, at, spy)).map((s: Sample) => s.category), ['a', 'b']);
  assert.deepEqual((await takeSamples(p, 'b', at, spy)).map((s: Sample) => s.category), ['b']);
  assert.deepEqual(calls, [['a', 7000], ['b', 7000], ['b', 7000]]);
});
test('scheduler escapes launch agent arguments', () => {
  assert.match(launchAgent('/apps/a&b/jstack', '/state/a<b', 21600), /a&amp;b/);
  assert.match(launchAgent('/apps/jstack', '/state', 21600), /<false\/>/);
});
test('scheduler rejects Windows before invoking launchctl', () => {
  assert.throws(() => schedule('enable', '/state', 21600, '/apps/jstack', { platform: 'win32', runner: () => { throw new Error('must not run'); } }), /macOS/);
});
test('failed registration rolls back only its new file', { skip: process.platform === 'win32' ? 'launchd ownership requires POSIX uid' : false }, () => {
  const root = fixture(), home = join(root, 'home'), cli = join(root, 'jstack.js');
  writeFileSync(cli, '');
  try {
    assert.match(launchAgent('/apps/a&b/jstack', '/state/a<b', 21600), /a&amp;b/);
    assert.match(launchAgent(cli, root, 21600), /<false\/>/);
    assert.throws(() => schedule('enable', join(root, 'state'), 21600, cli, { home, platform: 'darwin', runner: args => ({ status: args[0] === 'bootstrap' ? 5 : 1, stderr: 'injected' }) }), /injected/);
    assert.equal(existsSync(join(home, 'Library/LaunchAgents', `${label}.plist`)), false);
  } finally { rmSync(root, { recursive: true }); }
});
test('scheduler refuses the plugin launcher, which node cannot run, and names the CLI package', { skip: process.platform === 'win32' ? 'launchd ownership requires POSIX uid' : false }, () => {
  // A plugin loaded in place: its launcher sits beside payload/cli/main.js and is refused even without a shebang.
  const root = fixture(), home = join(root, 'home'), plugin = join(root, 'marketplace', 'plugins', 'jstack');
  mkdirSync(join(plugin, 'payload', 'bin'), { recursive: true }); mkdirSync(join(plugin, 'payload', 'cli'), { recursive: true });
  writeFileSync(join(plugin, 'payload', 'bin', 'jst'), ''); writeFileSync(join(plugin, 'payload', 'cli', 'main.js'), '');
  const wrapper = join(root, 'wrapper'), entry = join(root, 'main.js'), shim = join(root, 'volta-shim');
  writeFileSync(wrapper, '#!/bin/sh\nexec node main.js "$@"\n'); writeFileSync(entry, '#!/usr/bin/env node\n');
  // A binary shim (Volta style): no shebang and no JavaScript name.
  writeFileSync(shim, Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0, 0, 0, 0]));
  // The npm global layout: PREFIX/bin/jst links to the package's dist/cli/main.js.
  const prefix = join(root, 'npm prefix'), cliMain = join(prefix, 'lib', 'node_modules', '@ysys143', 'jstack', 'dist', 'cli', 'main.js');
  mkdirSync(dirname(cliMain), { recursive: true }); mkdirSync(join(prefix, 'bin')); writeFileSync(cliMain, '#!/usr/bin/env node\n');
  symlinkSync('../lib/node_modules/@ysys143/jstack/dist/cli/main.js', join(prefix, 'bin', 'jst'));
  const enable = (cli: string) => schedule('enable', join(root, 'state'), 21600, cli, { home, platform: 'darwin', runner: args => ({ status: args[0] === 'bootstrap' ? 5 : 1, stderr: 'injected' }) });
  try {
    for (const cli of [join(plugin, 'payload', 'bin', 'jst'), wrapper, shim]) assert.throws(() => enable(cli), /not a Node entrypoint.*pnpm.*CLI package/);
    for (const cli of [entry, join(prefix, 'bin', 'jst')]) assert.throws(() => enable(cli), /injected/);
  } finally { rmSync(root, { recursive: true }); }
});
test('scheduler refuses a legacy collector without modifying it', { skip: process.platform === 'win32' ? 'launchd ownership requires POSIX uid' : false }, () => {
  const root = fixture(), home = join(root, 'home'), directory = join(home, 'Library/LaunchAgents'), cli = join(root, 'jstack.js');
  mkdirSync(directory, { recursive: true }); writeFileSync(cli, '');
  const legacy = join(directory, 'legacy.plist'); writeFileSync(legacy, '<string>/example/.disk_cache/refresh.sh</string>');
  try { assert.throws(() => schedule('enable', join(root, 'state'), 21600, cli, { home, platform: 'darwin', runner: () => ({ status: 1 }) }), /Legacy/); assert.equal(readFileSync(legacy, 'utf8'), '<string>/example/.disk_cache/refresh.sh</string>'); }
  finally { rmSync(root, { recursive: true }); }
});
test('schedule status reports a legacy collector and proposes migration', { skip: process.platform === 'win32' ? 'launchd ownership requires POSIX uid' : false }, () => {
  const root = fixture(), home = join(root, 'home'), directory = join(home, 'Library/LaunchAgents'), state = join(root, 'state');
  const status = (registered: boolean) => schedule('status', state, 21600, undefined, { home, platform: 'darwin', runner: () => ({ status: registered ? 0 : 1, stdout: 'fixture' }) }) as Record<string, unknown>;
  try {
    assert.deepEqual(status(false).legacyCollectors, []); assert.equal(status(false).next, undefined);
    mkdirSync(directory, { recursive: true });
    const legacy = join(directory, 'legacy.plist'), other = join(directory, 'other.plist');
    writeFileSync(legacy, '<string>/example/.disk_cache/refresh.sh</string>'); writeFileSync(other, '<string>/usr/bin/true</string>');
    if (process.getuid?.() !== 0) chmodSync(other, 0);
    try {
      assert.deepEqual(status(false).legacyCollectors, [legacy]);
      assert.match(String(status(false).next), /import-legacy/); assert.match(String(status(false).next), /schedule enable/);
      assert.match(String(status(true).next), /both/);
    } finally { chmodSync(other, 0o600); }
    assert.equal(readFileSync(legacy, 'utf8'), '<string>/example/.disk_cache/refresh.sh</string>');
  } finally { rmSync(root, { recursive: true }); }
});
test('scan handles spaces literally, retains error and keeps history outside cache', { skip: process.platform !== 'darwin' }, () => {
  const root = fixture(), selected = join(root, 'a space $(not-executed)'); mkdirSync(selected); writeFileSync(join(selected, 'data'), 'sample');
  try {
    const p = { ...defaultProfile(root), categories: { sample: selected } };
    assert.ok(measure('sample', selected).bytes! > 0);
    assert.equal(measure('absent', join(root, 'absent')).bytes, null);
    assert.equal(scan(root, p, 'sample', true).samples.length, 1);
    assert.equal(scan(root, p, 'sample').stale, false);
    assert.equal(scan(root, p, 'sample').truncated, false);
    assert.equal(scan(root, p, 'sample').totalChildren, 1);
    assert.equal(paths(root).db.startsWith(paths(root).cache), false);
  } finally { rmSync(root, { recursive: true }); }
});
test('du keeps a partly readable total as a flagged lower bound', { skip: process.platform !== 'darwin' || process.getuid?.() === 0 ? 'needs macOS du and an unprivileged user' : false }, () => {
  const root = fixture(), category = join(root, 'caches'), blocked = join(category, 'blocked'), whole = join(root, 'whole');
  mkdirSync(join(category, 'readable'), { recursive: true }); mkdirSync(blocked); mkdirSync(whole);
  writeFileSync(join(category, 'readable/data'), Buffer.alloc(4 * 1048576, 1)); writeFileSync(join(blocked, 'hidden'), 'x');
  chmodSync(blocked, 0); chmodSync(whole, 0);
  try {
    const partly = measure('lib_caches', category);
    assert.ok(partly.bytes! >= 4 * 1048576, String(partly.bytes)); assert.match(partly.error!, /^partial-permission-denied: 1 unreadable entry; du: .*blocked: Permission denied/);
    const denied = measure('movies', whole);
    assert.equal(denied.bytes, null); assert.match(denied.error!, /^permission-denied:/);
  } finally { chmodSync(blocked, 0o700); chmodSync(whole, 0o700); rmSync(root, { recursive: true }); }
});
test('skill contract keeps safe selection, causal uncertainty and model neutrality', () => {
  const root = catalogRoot(), path = sourcePath(root, 'skills/disk-manager/SKILL.md'), body = readFileSync(path, 'utf8');
  assert.match(body, /earlier scoped authorization/); assert.match(body, /before destructive action/);
  assert.match(body, /failed\s+measurement is unknown/); assert.match(body, /Separate observations/);
  assert.match(body, /either host and any capable model/); assert.match(body, /never schedules cleanup/);
  assert.match(body, /`jst` is not found,\s+stop/); assert.match(body, /installation fault/); assert.match(body, /Do not\s+substitute a Node absolute path, shell wrapper, alias or symlink/);
  assert.doesNotMatch(body, /resolved installed path/); assert.match(body, /--cli "\$\(command -v jst\)"/);
  assert.match(body, /present the\s+migration proposal/); assert.match(body, /without\s+their decision/); assert.doesNotMatch(body, /without migrating it/);
  assert.match(body, /`snapshotTimeoutSeconds`/); assert.match(body, /`permission-denied`[^.]*exit\s+0/); assert.match(body, /unknown,\s+not zero/);
  assert.match(body, /`partial`[^.]*lower\s+bound/); assert.match(body, /never computes a delta from it/);
  for (const reference of ['macos', 'containers', 'development-caches', 'installation']) assert.ok(existsSync(join(dirname(path), 'references', `${reference}.md`)));
});
