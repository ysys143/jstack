import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { doctor, install, migrate, recover, rollback, status, uninstall, update } from './install.js';
import type { Runner } from './hosts.js';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'jstack-lifecycle-'));
  const home = join(root, 'home'); mkdirSync(home);
  const source = (version: string) => {
    const path = join(root, `bundle-${version}`);
    for (const dir of ['.claude-plugin', '.codex-plugin', 'skills/entry']) mkdirSync(join(path, dir), { recursive: true });
    for (const host of ['claude', 'codex']) writeFileSync(join(path, `.${host}-plugin/plugin.json`), JSON.stringify({ name: 'jstack', version, description: 'isolated lifecycle test', skills: host === 'claude' ? ['./skills'] : './skills' }));
    writeFileSync(join(path, 'skills/entry/SKILL.md'), `---\nname: entry\ndescription: Test entry\n---\nVersion ${version}\n`);
    return path;
  };
  const installed: Partial<Record<'claude' | 'codex', { id: string; version: string; path: string }>> = {};
  const runner: Runner = (host, args) => {
    if (args[0] !== 'plugin') return { status: 1, stdout: '', stderr: 'unexpected command' };
    if (args[1] === 'marketplace' && args[2] === 'add') return { status: 0, stdout: '', stderr: '' };
    if (['install', 'update', 'add'].includes(args[1] ?? '')) {
      const sourcePath = join(home, `.jstack/marketplace/plugins/${host}/jstack`);
      const manifest = JSON.parse(readFileSync(join(sourcePath, `.${host}-plugin/plugin.json`), 'utf8'));
      if (host === 'codex') {
        const cache = join(home, `.agents/plugins/cache/jstack/jstack/${manifest.version}`);
        mkdirSync(join(cache, '..'), { recursive: true }); cpSync(sourcePath, cache, { recursive: true });
        installed[host] = { id: String(args[2]), version: manifest.version, path: cache };
        return { status: 0, stdout: JSON.stringify({ pluginId: 'jstack@jstack', version: manifest.version, installedPath: cache }), stderr: '' };
      }
      installed[host] = { id: String(args[2]), version: manifest.version, path: sourcePath };
      return { status: 0, stdout: '{}', stderr: '' };
    }
    if (['uninstall', 'remove'].includes(args[1] ?? '')) { if (installed[host]?.id === args[2]) delete installed[host]; return { status: 0, stdout: '{}', stderr: '' }; }
    if (args.join(' ') === 'plugin list --json') {
      const row = installed[host];
      const rows = row ? [{ id: row.id, name: 'jstack', version: row.version, enabled: true, scope: 'user', installPath: row.path }] : [];
      return { status: 0, stdout: JSON.stringify(rows), stderr: '' };
    }
    return { status: 1, stdout: '', stderr: `unexpected command: ${args.join(' ')}` };
  };
  return { root, home, source, runner, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('Claude lifecycle preserves private data and supports rollback', () => {
  const f = fixture();
  try {
    const options = { home: f.home, hosts: ['claude' as const], runner: f.runner };
    mkdirSync(join(f.home, '.jstack/profiles'), { recursive: true });
    writeFileSync(join(f.home, '.jstack/profiles/private.json'), 'private');
    assert.equal(install({ ...options, sourceRoot: f.source('1.0.0') }).ok, true);
    assert.equal(update({ ...options, sourceRoot: f.source('1.0.1') }).ok, true);
    assert.equal(rollback(options).hosts[0].version, '1.0.0');
    assert.equal(status(options).hosts[0].discovered, true);
    assert.equal(uninstall(options).ok, true);
    assert.equal(readFileSync(join(f.home, '.jstack/profiles/private.json'), 'utf8'), 'private');
    assert.ok(existsSync(join(f.home, '.jstack/versions/1.0.0')));
  } finally { f.cleanup(); }
});

test('unowned and user-modified paths survive install, update, and uninstall', () => {
  const f = fixture();
  try {
    const options = { home: f.home, hosts: ['claude' as const], runner: f.runner };
    const target = join(f.home, '.jstack/marketplace/plugins/claude/jstack');
    mkdirSync(target, { recursive: true }); writeFileSync(join(target, 'mine'), 'keep');
    assert.equal(install({ ...options, sourceRoot: f.source('1.0.0') }).ok, false);
    assert.equal(readFileSync(join(target, 'mine'), 'utf8'), 'keep');
    rmSync(target, { recursive: true });
    assert.equal(install({ ...options, sourceRoot: join(f.root, 'bundle-1.0.0') }).ok, true);
    writeFileSync(join(target, 'mine'), 'keep');
    assert.equal(update({ ...options, sourceRoot: f.source('1.0.1') }).ok, false);
    assert.equal(uninstall(options).ok, false);
    assert.equal(readFileSync(join(target, 'mine'), 'utf8'), 'keep');
  } finally { f.cleanup(); }
});

test('activation failure restores previous deployment and records recovery evidence', () => {
  const f = fixture();
  try {
    const options = { home: f.home, hosts: ['claude' as const], runner: f.runner };
    assert.equal(install({ ...options, sourceRoot: f.source('1.0.0') }).ok, true);
    let calls = 0;
    const runner: Runner = (...args) => ++calls === 2 ? { status: 1, stdout: '', stderr: 'injected discovery failure' } : f.runner(...args);
    const result = update({ ...options, runner, sourceRoot: f.source('1.0.1') });
    assert.equal(result.ok, false);
    assert.equal(status(options).hosts[0].version, '1.0.0');
    assert.equal(status(options).hosts[0].discovered, true);
  } finally { f.cleanup(); }
});

test('published version bytes are immutable and lock collisions preserve state', () => {
  const f = fixture();
  try {
    const options = { home: f.home, hosts: ['claude' as const], runner: f.runner };
    const sourceRoot = f.source('1.0.0');
    assert.equal(install({ ...options, sourceRoot }).ok, true);
    writeFileSync(join(sourceRoot, 'extra'), 'changed');
    assert.equal(update({ ...options, sourceRoot }).ok, false);
    mkdirSync(join(f.home, '.jstack/install.lock'));
    assert.throws(() => uninstall(options), /operation is active/);
    assert.ok(existsSync(join(f.home, '.jstack/marketplace/plugins/claude/jstack')));
  } finally { f.cleanup(); }
});

test('rollback rejects modified retained bytes and interrupted transactions block new mutations', () => {
  const f = fixture();
  try {
    const options = { home: f.home, hosts: ['claude' as const], runner: f.runner };
    assert.equal(install({ ...options, sourceRoot: f.source('1.0.0') }).ok, true);
    assert.equal(update({ ...options, sourceRoot: f.source('1.0.1') }).ok, true);
    writeFileSync(join(f.home, '.jstack/versions/1.0.0/modified'), 'unexpected');
    assert.equal(rollback(options).ok, false);
    assert.equal(status(options).hosts[0].version, '1.0.1');
    writeFileSync(join(f.home, '.jstack/transactions/interrupted.json'), JSON.stringify({ status: 'activating' }));
    assert.equal(doctor(options).ok, false);
    assert.equal(doctor(options).recoveryRequired?.length, 1);
    assert.throws(() => uninstall(options), /interrupted transaction/);
  } finally { f.cleanup(); }
});

test('legacy migration is explicit, scope checked, and disables only the requested identity', () => {
  const f = fixture();
  try {
    let enabled = true;
    const legacy = 'jstack@old-market';
    const runner: Runner = (host, args, env) => {
      if (args[1] === 'disable' || args[1] === 'enable') {
        assert.deepEqual(args.slice(2), [legacy, '--scope', 'user']);
        enabled = args[1] === 'enable';
        return { status: 0, stdout: '', stderr: '' };
      }
      const result = f.runner(host, args, env);
      if (args.join(' ') !== 'plugin list --json') return result;
      const rows = JSON.parse(result.stdout);
      rows.push({ id: legacy, name: 'jstack', version: '0.8.0', scope: 'user', enabled });
      return { ...result, stdout: JSON.stringify(rows) };
    };
    const options = { home: f.home, hosts: ['claude' as const], runner, sourceRoot: f.source('1.0.0') };
    assert.equal(install(options).ok, false);
    assert.equal(enabled, true);
    assert.throws(() => migrate(options), /explicit legacy/);
    assert.equal(migrate({ ...options, from: legacy }).ok, true);
    assert.equal(enabled, false);
    assert.equal(status(options).hosts[0].discovered, true);
  } finally { f.cleanup(); }
});

test('real installed hosts in disposable homes: install, update, rollback, guarded uninstall', { skip: process.env.JSTACK_TEST_REAL_HOSTS !== '1' }, async t => {
  const f = fixture();
  try {
    const options = { home: f.home, hosts: ['claude' as const, 'codex' as const] };
    await t.test('official host discovery after install, update and rollback', () => {
      const first = install({ ...options, sourceRoot: f.source('1.0.0') });
      assert.equal(first.ok, true, JSON.stringify(first));
      const second = update({ ...options, sourceRoot: f.source('1.0.1') });
      assert.equal(second.ok, true, JSON.stringify(second));
      const reverted = rollback(options);
      assert.equal(reverted.ok, true, JSON.stringify(reverted));
      assert.ok(reverted.hosts.every(row => row.version === '1.0.0' && row.discovered));
    });
    await t.test('complete real-host uninstall (requires Codex sessions stopped)', uninstallTest => {
      const removed = uninstall(options);
      const codex = removed.hosts.find(row => row.host === 'codex')!;
      if (codex.error === 'Error: Close Codex sessions and retry uninstall; destructive cache removal deferred') {
        assert.equal(removed.hosts.find(row => row.host === 'claude')!.installed, false, JSON.stringify(removed));
        assert.equal(codex.installed, true);
        const retained = status({ ...options, hosts: ['codex'] }).hosts[0]!;
        assert.equal(retained.version, '1.0.0');
        assert.equal(retained.discovered, true);
        uninstallTest.skip('Incomplete: real Codex cache removal safely deferred because session cessation is not proven');
        return;
      }
      assert.equal(removed.ok, true, JSON.stringify(removed));
    });
  } finally { f.cleanup(); }
});

function interruptedUpdate(f: ReturnType<typeof fixture>) {
  const options = { home: f.home, hosts: ['claude' as const], runner: f.runner };
  assert.equal(install({ ...options, sourceRoot: f.source('1.0.0') }).ok, true);
  assert.equal(update({ ...options, sourceRoot: f.source('1.0.1') }).ok, true);
  const dir = join(f.home, '.jstack/transactions');
  const path = readdirSync(dir).map(name => join(dir, name)).find(file => JSON.parse(readFileSync(file, 'utf8')).next === '1.0.1')!;
  const dead = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
  assert.equal(dead.status, 0);
  const owner = { pid: dead.pid, hostname: hostname() };
  writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), status: 'activating', owner }));
  const lock = join(f.home, '.jstack/install.lock'); mkdirSync(lock);
  writeFileSync(join(lock, 'owner.json'), JSON.stringify(owner));
  return { options, path, lock };
}

test('explicit recovery restores receipt and discovery after a dead-owner activation crash', () => {
  const f = fixture();
  try {
    const { options, path, lock } = interruptedUpdate(f);
    const result = recover(options);
    assert.equal(result.ok, true);
    assert.equal(result.hosts[0].version, '1.0.0');
    assert.equal(result.hosts[0].discovered, true);
    assert.equal(existsSync(lock), false);
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).status, 'rolled-back');
    assert.equal(recover(options).ok, true);
  } finally { f.cleanup(); }
});

test('recovery refuses live and unknown lock owners without changing installed bytes', () => {
  const f = fixture();
  try {
    const { options, lock } = interruptedUpdate(f);
    for (const owner of [{ pid: process.pid, hostname: hostname() }, { pid: 0 }, { pid: process.pid, hostname: 'another-host' }]) {
      writeFileSync(join(lock, 'owner.json'), JSON.stringify(owner));
      assert.throws(() => recover(options), /owner|identity/);
      assert.equal(existsSync(lock), true);
      assert.equal(status(options).hosts[0].version, '1.0.1');
    }
  } finally { f.cleanup(); }
});

test('recovery preserves modified files and rejects forged destination paths', () => {
  const f = fixture();
  try {
    const { options, path, lock } = interruptedUpdate(f);
    const modified = join(f.home, '.jstack/marketplace/plugins/claude/jstack/user-file');
    writeFileSync(modified, 'keep');
    assert.throws(() => recover(options), /modified/);
    assert.equal(readFileSync(modified, 'utf8'), 'keep');
    assert.equal(existsSync(lock), true);
    rmSync(modified);
    writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), target: f.home }));
    assert.throws(() => recover(options), /destination/);
    assert.ok(existsSync(join(f.home, '.jstack/marketplace/plugins/claude/jstack')));
  } finally { f.cleanup(); }
});

test('Codex uninstall defers destructive commands when session cessation is not proven', () => {
  const f = fixture();
  try {
    const { options } = interruptedUpdate(f);
    // Reuse verified retained bytes as a managed Codex deployment without invoking a real host.
    recover(options);
    const file = join(f.home, '.jstack/installation.json');
    const receipt = JSON.parse(readFileSync(file, 'utf8'));
    const deployment = receipt.hosts.claude;
    const codexTarget = join(f.home, '.jstack/marketplace/plugins/codex/jstack');
    mkdirSync(codexTarget, { recursive: true });
    // Fixture tree is small and copy is confined to this disposable home.
    cpSync(deployment.target, codexTarget, { recursive: true });
    receipt.hosts.codex = { ...deployment, target: codexTarget, pluginId: 'jstack@jstack' };
    writeFileSync(file, JSON.stringify(receipt));
    let commands = 0;
    const result = uninstall({ home: f.home, hosts: ['codex'], hostStopped: () => false, runner: () => { commands++; throw new Error('must not run'); } });
    assert.equal(result.ok, false);
    assert.equal(result.hosts[0].restartRequired, true);
    assert.match(result.hosts[0].error!, /deferred/);
    assert.equal(commands, 0);
    assert.ok(existsSync(codexTarget));
  } finally { f.cleanup(); }
});

test('recovery restores a crash-interrupted uninstall without deleting retained or private data', () => {
  const f = fixture();
  try {
    const options = { home: f.home, hosts: ['claude' as const], runner: f.runner };
    assert.equal(install({ ...options, sourceRoot: f.source('1.0.0') }).ok, true);
    const file = join(f.home, '.jstack/installation.json');
    const previous = JSON.parse(readFileSync(file, 'utf8')).hosts.claude;
    const backup = join(f.home, '.jstack/marketplace/plugins/.jstack-lifecycle/12345678-1234-1234-1234-123456789012/removed');
    mkdirSync(backup, { recursive: true }); cpSync(previous.target, backup, { recursive: true });
    rmSync(previous.target, { recursive: true });
    const child = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
    writeFileSync(join(f.home, '.jstack/transactions/uninstall-crash.json'), JSON.stringify({
      operation: 'uninstall', host: 'claude', target: previous.target, backup, previous,
      owner: { pid: child.pid, hostname: hostname() }, status: 'prepared',
    }));
    assert.equal(recover(options).ok, true);
    assert.equal(status(options).hosts[0].discovered, true);
    assert.ok(existsSync(backup));
  } finally { f.cleanup(); }
});

test('activation compensation preserves files changed during host registration', () => {
  const f = fixture();
  try {
    const options = { home: f.home, hosts: ['claude' as const], runner: f.runner };
    assert.equal(install({ ...options, sourceRoot: f.source('1.0.0') }).ok, true);
    let calls = 0;
    const changed = join(f.home, '.jstack/marketplace/plugins/claude/jstack/user-edit');
    const runner: Runner = (...args) => {
      if (++calls === 2) {
        writeFileSync(changed, 'preserve concurrent edit');
        return { status: 1, stdout: '', stderr: 'registration failed after user edit' };
      }
      return f.runner(...args);
    };
    const result = update({ ...options, runner, sourceRoot: f.source('1.0.1') });
    assert.equal(result.ok, false);
    assert.match(result.hosts[0].error!, /recovery required/);
    assert.equal(readFileSync(changed, 'utf8'), 'preserve concurrent edit');
    assert.equal(doctor(options).recoveryRequired?.length, 1);
  } finally { f.cleanup(); }
});

function interruptedMigration(f: ReturnType<typeof fixture>) {
  let enabled = true;
  const legacy = 'jstack@recorded-market';
  const commands: string[][] = [];
  const runner: Runner = (host, args, env) => {
    if (args[1] === 'disable' || args[1] === 'enable') {
      assert.deepEqual(args.slice(2), [legacy, '--scope', 'user']);
      commands.push(args);
      enabled = args[1] === 'enable';
      return { status: 0, stdout: '', stderr: '' };
    }
    const result = f.runner(host, args, env);
    if (args.join(' ') !== 'plugin list --json') return result;
    return { ...result, stdout: JSON.stringify([...JSON.parse(result.stdout), { id: legacy, name: 'jstack', version: '0.8.0', scope: 'user', enabled }]) };
  };
  const options = { home: f.home, hosts: ['claude' as const], runner, hostStopped: () => true };
  assert.equal(migrate({ ...options, from: legacy, sourceRoot: f.source('1.0.0') }).ok, true);
  const dir = join(f.home, '.jstack/transactions');
  const path = readdirSync(dir).map(name => join(dir, name)).find(file => JSON.parse(readFileSync(file, 'utf8')).operation === 'migrate')!;
  const entry = JSON.parse(readFileSync(path, 'utf8'));
  const dead = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
  const owner = { pid: dead.pid, hostname: hostname() };
  writeFileSync(path, JSON.stringify({ ...entry, owner, status: 'prepared' }));
  writeFileSync(entry.child, JSON.stringify({ ...JSON.parse(readFileSync(entry.child, 'utf8')), owner }));
  return { options, path, entry, legacy, commands };
}

test('migration recovery compensates a committed child and restores only the recorded legacy identity', () => {
  const f = fixture();
  try {
    const { options, path, entry, legacy, commands } = interruptedMigration(f);
    const result = recover(options);
    assert.equal(result.ok, true);
    assert.equal(result.hosts[0].restoredPluginId, legacy);
    assert.equal(result.hosts[0].discovered, true);
    assert.equal(result.hosts[0].installed, false);
    assert.equal(existsSync(join(f.home, '.jstack/marketplace/plugins/claude/jstack')), false);
    assert.deepEqual(commands.at(-1), ['plugin', 'enable', legacy, '--scope', 'user']);
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).status, 'rolled-back');
    assert.equal(JSON.parse(readFileSync(entry.child, 'utf8')).status, 'rolled-back');
  } finally { f.cleanup(); }
});

test('migration recovery defers live sessions and refuses changed legacy registration before mutation', () => {
  const f = fixture();
  try {
    const { options, commands } = interruptedMigration(f);
    const initialCommands = commands.length;
    assert.throws(() => recover({ ...options, hostStopped: () => false }), /Close Claude sessions/);
    assert.equal(commands.length, initialCommands);
    const runner: Runner = (...args) => {
      const result = options.runner(...args);
      if (args[1].join(' ') !== 'plugin list --json') return result;
      const rows = JSON.parse(result.stdout).map((row: any) => row.id === 'jstack@recorded-market' ? { ...row, scope: 'project' } : row);
      return { ...result, stdout: JSON.stringify(rows) };
    };
    assert.throws(() => recover({ ...options, runner }), /Legacy registration changed/);
    assert.equal(commands.length, initialCommands);
    assert.ok(existsSync(join(f.home, '.jstack/marketplace/plugins/claude/jstack')));
  } finally { f.cleanup(); }
});

test('migration recovery retries a failed official enable after deployment compensation', () => {
  const f = fixture();
  try {
    const { options, entry, path } = interruptedMigration(f);
    const runner: Runner = (...args) => args[1][1] === 'enable' ? { status: 1, stdout: '', stderr: 'injected enable failure' } : options.runner(...args);
    assert.throws(() => recover({ ...options, runner }), /injected enable failure/);
    assert.equal(JSON.parse(readFileSync(entry.child, 'utf8')).status, 'rolled-back');
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).status, 'prepared');
    assert.equal(recover(options).ok, true);
  } finally { f.cleanup(); }
});

test('pending migration child is recovered even after parent enable compensation completed', () => {
  const f = fixture();
  try {
    const { options, entry, path, legacy, commands } = interruptedMigration(f);
    options.runner('claude', ['plugin', 'enable', legacy, '--scope', 'user'], {});
    writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), status: 'rolled-back' }));
    writeFileSync(entry.child, JSON.stringify({ ...JSON.parse(readFileSync(entry.child, 'utf8')), status: 'recovery-required' }));
    const count = commands.length;
    assert.equal(recover(options).ok, true);
    assert.equal(commands.length, count);
    assert.equal(existsSync(join(f.home, '.jstack/marketplace/plugins/claude/jstack')), false);
  } finally { f.cleanup(); }
});


test('linked installer roots and host discovery ancestors preserve external files', { skip: process.platform === 'win32' }, () => {
  for (const relative of ['.jstack', '.jstack/versions', '.jstack/marketplace/plugins/claude', '.jstack/marketplace/plugins/.jstack-lifecycle']) {
    const f = fixture();
    try {
      const outside = join(f.root, 'outside'); mkdirSync(outside); writeFileSync(join(outside, 'mine'), 'keep');
      const link = join(f.home, relative); mkdirSync(join(link, '..'), { recursive: true }); symlinkSync(outside, link);
      let result; try { result = install({ home: f.home, hosts: ['claude'], runner: f.runner, sourceRoot: f.source('1.0.0') }); } catch (error) { assert.match(String(error), /Linked/); }
      assert.notEqual(result?.ok, true, relative); assert.deepEqual(readdirSync(outside), ['mine'], relative); assert.equal(readFileSync(join(outside, 'mine'), 'utf8'), 'keep');
    } finally { f.cleanup(); }
  }
});
