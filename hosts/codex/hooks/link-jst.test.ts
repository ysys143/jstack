import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { compareVersions, type LinkInput, linkJst, main } from './link-jst.js';

const posixOnly = { skip: process.platform === 'win32' };

/** A temp HOME with a Codex plugin cache holding jstack version folders. */
function world() {
  const box = mkdtempSync(join(tmpdir(), 'jstack-link-')), home = join(box, 'home');
  mkdirSync(home);
  const plugin = (version: string, marketplace = 'jstack', codexHome = '.agents') => {
    const root = join(home, codexHome, 'plugins', 'cache', marketplace, 'jstack', version);
    mkdirSync(join(root, '.codex-plugin'), { recursive: true }); mkdirSync(join(root, 'payload', 'bin'), { recursive: true });
    writeFileSync(join(root, '.codex-plugin', 'plugin.json'), JSON.stringify({ name: 'jstack', version }));
    writeFileSync(join(root, 'payload', 'bin', 'jst'), '#!/bin/sh\nexit 0\n'); chmodSync(join(root, 'payload', 'bin', 'jst'), 0o755);
    return root;
  };
  const link = join(home, '.local', 'bin', 'jst');
  const input = (pluginRoot: string, extra: Partial<LinkInput> = {}): LinkInput => ({ home, path: '/usr/bin:/bin', env: {}, pluginRoot, ...extra });
  const placeLink = (target: string) => { mkdirSync(join(home, '.local', 'bin'), { recursive: true }); symlinkSync(target, link); };
  return { box, home, link, plugin, input, placeLink, dispose: () => rmSync(box, { recursive: true, force: true }) };
}

test('versions order numerically and a release follows its prereleases', () => {
  assert.equal(compareVersions('0.9.10', '0.9.9'), 1);
  assert.equal(compareVersions('0.9.8', '0.9.8'), 0);
  assert.equal(compareVersions('1.0.0-rc.2', '1.0.0'), -1);
  assert.equal(compareVersions('1.0.0-rc.10', '1.0.0-rc.9'), 1);
});

test('a missing link is created in a new 0755 directory, with a PATH hint only when needed', posixOnly, () => {
  const w = world();
  try {
    const root = w.plugin('0.9.8');
    const first = linkJst(w.input(root));
    assert.equal(first.state, 'linked'); assert.equal(readlinkSync(w.link), join(root, 'payload', 'bin', 'jst'));
    assert.equal(statSync(join(w.home, '.local', 'bin')).mode & 0o777, 0o755);
    assert.match(first.message, /^jstack: linked .*\.local\/bin\/jst to .*0\.9\.8\/payload\/bin\/jst\. .*\.local\/bin is not on PATH/);
    rmSync(w.link);
    const onPath = linkJst(w.input(root, { path: `/usr/bin:${join(w.home, '.local', 'bin')}` }));
    assert.equal(onPath.state, 'linked'); assert.doesNotMatch(onPath.message, /not on PATH/);
    const again = linkJst(w.input(root));
    assert.equal(again.state, 'current'); assert.equal(again.message, '');
  } finally { w.dispose(); }
});

test('an older or vanished plugin version is relinked; a newer or equal one is kept', posixOnly, () => {
  const w = world();
  try {
    const older = w.plugin('0.9.7'), ours = w.plugin('0.9.8'), newer = w.plugin('0.9.10'), twin = w.plugin('0.9.8', 'jstack', '.codex');
    w.placeLink(join(older, 'payload', 'bin', 'jst'));
    const replaced = linkJst(w.input(ours));
    assert.equal(replaced.state, 'replaced'); assert.equal(readlinkSync(w.link), join(ours, 'payload', 'bin', 'jst'));
    assert.match(replaced.message, /^jstack: relinked .* from an older jstack plugin version/);
    rmSync(w.link); w.placeLink(join(w.home, '.agents', 'plugins', 'cache', 'jstack', 'jstack', '0.9.1', 'payload', 'bin', 'jst'));
    assert.equal(linkJst(w.input(ours)).state, 'replaced');
    rmSync(w.link); w.placeLink(join(newer, 'payload', 'bin', 'jst'));
    const kept = linkJst(w.input(ours));
    assert.equal(kept.state, 'newer'); assert.equal(kept.message, ''); assert.equal(readlinkSync(w.link), join(newer, 'payload', 'bin', 'jst'));
    rmSync(w.link); w.placeLink(join(twin, 'payload', 'bin', 'jst'));
    assert.equal(linkJst(w.input(ours)).state, 'current'); assert.equal(readlinkSync(w.link), join(twin, 'payload', 'bin', 'jst'));
  } finally { w.dispose(); }
});

test('a foreign link or a regular file is left alone and reported for the user', posixOnly, () => {
  const w = world();
  try {
    const root = w.plugin('0.9.8'), elsewhere = join(w.box, 'other-jstack');
    writeFileSync(elsewhere, '#!/bin/sh\n'); chmodSync(elsewhere, 0o755);
    w.placeLink(elsewhere);
    const foreign = linkJst(w.input(root));
    assert.equal(foreign.state, 'foreign'); assert.equal(readlinkSync(w.link), elsewhere);
    assert.match(foreign.message, /^jstack: .*\.local\/bin\/jst exists and is not a jstack plugin link, so it was left alone; if jstack is needed, tell the user and do not change that file without their consent\.$/);
    rmSync(w.link); writeFileSync(w.link, 'user data\n');
    const file = linkJst(w.input(root));
    assert.equal(file.state, 'foreign'); assert.equal(lstatSync(w.link).isFile(), true);
    // A cache-shaped path that is not a jstack plugin is not ours either.
    rmSync(w.link); const impostor = join(w.home, '.agents', 'plugins', 'cache', 'x', 'jstack', '9.9.9', 'payload', 'bin');
    mkdirSync(impostor, { recursive: true }); writeFileSync(join(impostor, 'jst'), '#!/bin/sh\n'); chmodSync(join(impostor, 'jst'), 0o755);
    w.placeLink(join(impostor, 'jst'));
    assert.equal(linkJst(w.input(root)).state, 'foreign'); assert.equal(readlinkSync(w.link), join(impostor, 'jst'));
  } finally { w.dispose(); }
});

test('a jstack already on PATH is never shadowed, and opting out writes nothing', posixOnly, () => {
  const w = world();
  try {
    const root = w.plugin('0.9.8'), npm = join(w.box, 'npm', 'bin');
    mkdirSync(npm, { recursive: true }); writeFileSync(join(npm, 'jst'), '#!/bin/sh\n'); chmodSync(join(npm, 'jst'), 0o755);
    const existing = linkJst(w.input(root, { path: `relative:${npm}:/usr/bin` }));
    assert.equal(existing.state, 'existing'); assert.equal(existing.message, ''); assert.equal(existsSync(join(w.home, '.local')), false);
    for (const value of ['1', 'true', 'YES']) {
      const opted = linkJst(w.input(root, { env: { JSTACK_NO_PATH_LINK: value } }));
      assert.equal(opted.state, 'opted-out'); assert.equal(opted.message, ''); assert.equal(existsSync(join(w.home, '.local')), false);
    }
    assert.equal(linkJst(w.input(root, { env: { JSTACK_NO_PATH_LINK: '0' } })).state, 'linked');
  } finally { w.dispose(); }
});

test('a missing launcher or an unwritable directory reports once and never throws', posixOnly, () => {
  const w = world();
  try {
    const root = w.plugin('0.9.8'), bare = join(w.box, 'bare');
    mkdirSync(bare);
    const missing = linkJst(w.input(bare));
    assert.equal(missing.state, 'no-launcher'); assert.match(missing.message, /missing or not executable, so jstack was not linked/);
    if (process.getuid?.() !== 0) {
      mkdirSync(join(w.home, '.local'), { mode: 0o555 });
      const denied = linkJst(w.input(root));
      chmodSync(join(w.home, '.local'), 0o755);
      assert.equal(denied.state, 'failed'); assert.match(denied.message, /^jstack: could not link .* \(EACCES\), so jstack may not be on PATH in this session; tell the user if jstack is needed\.$/);
    }
  } finally { w.dispose(); }
});

test('the hook entry exits 0 and prints one line, also when it cannot run', posixOnly, () => {
  const w = world();
  try {
    const root = w.plugin('0.9.8'), script = fileURLToPath(new URL('./link-jst.js', import.meta.url));
    const env = { HOME: w.home, PATH: '/usr/bin:/bin', PLUGIN_ROOT: root };
    const run = spawnSync(process.execPath, [script], { encoding: 'utf8', env });
    assert.equal(run.status, 0, run.stderr); assert.equal(run.stderr, '');
    assert.equal(run.stdout.split('\n').filter(Boolean).length, 1); assert.match(run.stdout, /^jstack: linked /);
    const quiet = spawnSync(process.execPath, [script], { encoding: 'utf8', env });
    assert.equal(quiet.status, 0); assert.equal(quiet.stdout, '');
  } finally { w.dispose(); }
});

const SCRIPT = fileURLToPath(new URL('./link-jst.js', import.meta.url));
/** A directory holding only node, so no jstack of this machine leaks into a test PATH. */
function nodeOnly(box: string): string {
  const directory = join(box, 'node-only'); mkdirSync(directory, { recursive: true });
  if (process.platform !== 'win32' && !existsSync(join(directory, 'node'))) symlinkSync(process.execPath, join(directory, 'node'));
  return directory;
}

test('another jstack on PATH makes the hook remove only its own link and never relink', posixOnly, () => {
  const w = world();
  try {
    const ours = w.plugin('0.9.8'), older = w.plugin('0.9.7'), npm = join(w.box, 'npm', 'bin'), bin = join(w.home, '.local', 'bin');
    mkdirSync(npm, { recursive: true }); writeFileSync(join(npm, 'jst'), '#!/bin/sh\n'); chmodSync(join(npm, 'jst'), 0o755);
    const later = `${bin}:/usr/bin:${npm}`;
    for (const target of [join(ours, 'payload', 'bin', 'jst'), join(older, 'payload', 'bin', 'jst'), join(w.home, '.agents', 'plugins', 'cache', 'jstack', 'jstack', '0.9.1', 'payload', 'bin', 'jst')]) {
      w.placeLink(target);
      const yielded = linkJst(w.input(ours, { path: later }));
      assert.equal(yielded.state, 'yielded', target); assert.equal(readlinkTarget(w.link), false);
      assert.match(yielded.message, /^jstack: removed the plugin link .*\.local\/bin\/jst because .*npm\/bin\/jst is on PATH and takes precedence\.$/);
      rmSync(bin, { recursive: true, force: true });
    }
    const elsewhere = join(w.box, 'mine'); writeFileSync(elsewhere, '#!/bin/sh\n'); chmodSync(elsewhere, 0o755);
    w.placeLink(elsewhere);
    const foreign = linkJst(w.input(ours, { path: later }));
    assert.equal(foreign.state, 'existing'); assert.equal(foreign.message, ''); assert.equal(readlinkSync(w.link), elsewhere);
  } finally { w.dispose(); }
});
function readlinkTarget(path: string): string | false { try { return readlinkSync(path); } catch { return false; } }

test('the PATH hint survives a missing PATH directory before ~/.local/bin exists', posixOnly, () => {
  const w = world();
  try {
    const linked = linkJst(w.input(w.plugin('0.9.8'), { path: `/usr/bin:${join(w.box, 'missing')}` }));
    assert.equal(linked.state, 'linked'); assert.match(linked.message, /\.local\/bin is not on PATH, so jstack will not resolve until the user adds it to their shell profile and starts a new session; tell the user if jstack is needed\.$/);
  } finally { w.dispose(); }
});

test('build metadata never flips the link, and an unreadable own manifest never replaces a live link', posixOnly, () => {
  const w = world();
  try {
    const a = w.plugin('1.0.0+a', 'jstack', '.codex'), b = w.plugin('1.0.0+b', 'jstack', '.codex-work');
    w.placeLink(join(a, 'payload', 'bin', 'jst'));
    assert.equal(linkJst(w.input(b)).state, 'current'); assert.equal(readlinkSync(w.link), join(a, 'payload', 'bin', 'jst'));
    const broken = join(w.box, 'cache-less', 'plugins', 'cache', 'jstack', 'jstack', '1.0.0');
    mkdirSync(join(broken, 'payload', 'bin'), { recursive: true }); writeFileSync(join(broken, 'payload', 'bin', 'jst'), '#!/bin/sh\n'); chmodSync(join(broken, 'payload', 'bin', 'jst'), 0o755);
    const kept = linkJst(w.input(broken));
    assert.equal(kept.state, 'kept'); assert.equal(kept.message, ''); assert.equal(readlinkSync(w.link), join(a, 'payload', 'bin', 'jst'));
  } finally { w.dispose(); }
});

test('concurrent session starts never report a false failure', posixOnly, async () => {
  const w = world();
  try {
    const ours = w.plugin('0.9.8'), older = w.plugin('0.9.7');
    const env = { HOME: w.home, PATH: nodeOnly(w.box), PLUGIN_ROOT: ours };
    const start = () => new Promise<{ status: number | null; out: string }>(done => {
      const child = spawn(process.execPath, [SCRIPT], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      let out = ''; child.stdout.on('data', chunk => { out += chunk; }); child.stderr.on('data', chunk => { out += chunk; });
      child.on('close', status => done({ status, out }));
    });
    for (const setup of [() => undefined, () => { rmSync(w.link); w.placeLink(join(older, 'payload', 'bin', 'jst')); }]) {
      setup();
      const runs = await Promise.all(Array.from({ length: 12 }, start));
      for (const run of runs) { assert.equal(run.status, 0); assert.doesNotMatch(run.out, /could not link/); }
      assert.equal(readlinkSync(w.link), join(ours, 'payload', 'bin', 'jst'));
      assert.deepEqual(readdirSync(join(w.home, '.local', 'bin')), ['jst']);
    }
  } finally { w.dispose(); }
});

test('the hook entry stays silent on resume, and an empty or relative HOME writes nothing', posixOnly, () => {
  const w = world();
  const write = process.stdout.write, printed: string[] = [], cwd = process.cwd();
  try {
    const root = w.plugin('0.9.8'), env = { HOME: w.home, PATH: '/usr/bin', PLUGIN_ROOT: root };
    process.stdout.write = ((chunk: string) => { printed.push(String(chunk)); return true; }) as typeof process.stdout.write;
    assert.equal(main(env, 'darwin', () => JSON.stringify({ source: 'resume' })), 0);
    assert.deepEqual(printed, []); assert.equal(readlinkSync(w.link), join(root, 'payload', 'bin', 'jst'));
    rmSync(w.link);
    assert.equal(main(env, 'darwin', () => JSON.stringify({ source: 'startup' })), 0);
    assert.equal(printed.length, 1); assert.match(printed[0]!, /^jstack: linked /);
    process.chdir(w.box);
    for (const home of ['', 'relative-home']) assert.equal(main({ ...env, HOME: home }, 'darwin', () => ''), 0);
    assert.equal(existsSync(join(w.box, '.local')), false); assert.equal(existsSync(join(w.box, 'relative-home')), false);
    assert.equal(printed.length, 1);
    // The real entry reads the source from the hook input: a missing launcher is reported on startup only.
    const hook = (source: string) => spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', input: JSON.stringify({ source }), env: { HOME: w.home, PATH: '', PLUGIN_ROOT: join(w.box, 'no-plugin') } });
    assert.equal(hook('resume').stdout, ''); assert.match(hook('startup').stdout, /missing or not executable/);
  } finally { process.chdir(cwd); process.stdout.write = write; w.dispose(); }
});

test('on Windows the hook entry is a silent no-op that writes nothing', () => {
  const w = world();
  const write = process.stdout.write, printed: string[] = [];
  try {
    const root = w.plugin('0.9.8');
    process.stdout.write = ((chunk: string) => { printed.push(String(chunk)); return true; }) as typeof process.stdout.write;
    const status = main({ HOME: w.home, PATH: '', PLUGIN_ROOT: root }, 'win32');
    process.stdout.write = write;
    assert.equal(status, 0); assert.deepEqual(printed, []); assert.equal(existsSync(join(w.home, '.local')), false);
  } finally { process.stdout.write = write; w.dispose(); }
});

test('the registered command runs the hook once Codex substitutes the plugin root', () => {
  const w = world();
  try {
    // Codex replaces ${PLUGIN_ROOT} and ${CLAUDE_PLUGIN_ROOT} in the command text, then runs it
    // through $SHELL, or COMSPEC /C on Windows; shell: true does the same here.
    const definition = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../hosts/codex/hooks/codex-hooks.json', import.meta.url)), 'utf8'));
    const [group] = definition.hooks.SessionStart;
    assert.equal(group.matcher, 'startup|resume'); assert.equal(group.hooks[0].timeout, 10);
    const root = join(w.box, 'plugin root');
    mkdirSync(join(root, 'payload', 'bin'), { recursive: true });
    writeFileSync(join(root, 'payload', 'bin', 'jst'), '#!/bin/sh\n'); chmodSync(join(root, 'payload', 'bin', 'jst'), 0o755);
    // The payload hooks directory resolves to the compiled module beside this test.
    symlinkSync(dirname(fileURLToPath(import.meta.url)), join(root, 'hooks'), 'junction');
    const command = ['PLUGIN_ROOT', 'CLAUDE_PLUGIN_ROOT'].reduce((text: string, key) => text.replaceAll(`\${${key}}`, root), group.hooks[0].command);
    assert.doesNotMatch(command, /\$\{/);
    const nodeOnly = join(w.box, 'node-only'); mkdirSync(nodeOnly);
    if (process.platform !== 'win32') symlinkSync(process.execPath, join(nodeOnly, 'node'));
    const plugin = { HOME: w.home, USERPROFILE: w.home, PLUGIN_ROOT: root, CLAUDE_PLUGIN_ROOT: root };
    const env = process.platform === 'win32' ? { ...process.env, ...plugin } : { ...plugin, PATH: nodeOnly };
    const run = spawnSync(command, { shell: true, encoding: 'utf8', env });
    assert.equal(run.status, 0, run.stderr); assert.equal(run.stderr, '');
    if (process.platform === 'win32') { assert.equal(run.stdout, ''); assert.equal(existsSync(join(w.home, '.local')), false); }
    else { assert.match(run.stdout, /^jstack: linked .*plugin root\/payload\/bin\/jst\./); assert.equal(readlinkSync(join(w.home, '.local', 'bin', 'jst')), join(root, 'payload', 'bin', 'jst')); }
  } finally { w.dispose(); }
});
