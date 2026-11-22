/** No systemctl is executed: user timer lifecycle tests use a command runner and private temporary unit directories. */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { schedule, systemdUnit, systemdUnits, type Runner } from '../scripts/scheduler.js';
import { fixture } from './_fixtures.js';

const posix = process.platform === 'win32' ? 'POSIX user units' : false;
const setup = () => {
  const root = fixture(), home = join(root, 'home'), config = join(root, 'xdg config'), cache = join(root, 'xdg cache'), directory = join(config, 'systemd/user'), cli = join(root, 'jst.js');
  writeFileSync(cli, '#!/usr/bin/env node\n');
  const timer = join(directory, systemdUnit + '.timer'), service = join(directory, systemdUnit + '.service'), calls: string[][] = [];
  const runner: Runner = args => {
    calls.push(args); assert.equal(args[0], '--user');
    if (args[1] === 'show' && args[2] === '--property=Version') return { status: 0, stdout: 'Version=fixture' };
    if (args[1] === 'show') {
      const file = args[2].endsWith('.timer') ? timer : service;
      return { status: 0, stdout: existsSync(file) ? `LoadState=loaded\nActiveState=active\nUnitFileState=enabled\nFragmentPath=${file}\nDropInPaths=\n` : 'LoadState=not-found\nActiveState=inactive\nUnitFileState=\nFragmentPath=\nDropInPaths=\n' };
    }
    return { status: 0, stdout: '' };
  };
  return { root, home, config, cache, cli, directory, timer, service, calls, runner, options: { home, platform: 'linux' as const, env: { XDG_CONFIG_HOME: config, XDG_CACHE_HOME: cache }, runner } };
};
test('systemd units delay first collection and set finite oneshot/resource controls with escaped arguments', () => {
  const { service, timer } = systemdUnits('/apps/a "% $\\jst.js', '/state/a % $', 300, '/cache/with space');
  assert.match(timer, /OnActiveSec=300s\nOnUnitInactiveSec=300s/); assert.match(timer, /Persistent=false/); assert.match(timer, /WakeSystem=false/);
  assert.doesNotMatch(timer, /OnBootSec|OnStartupSec|OnCalendar/);
  assert.match(service, /Type=oneshot/); assert.match(service, /TimeoutStartSec=3720s/); assert.doesNotMatch(service, /RuntimeMaxSec/);
  for (const setting of ['KillMode=control-group', 'Nice=10', 'IOSchedulingClass=idle', 'CPUQuota=20%', 'IOWeight=10', 'MemoryMax=512M', 'NoNewPrivileges=yes']) assert.ok(service.includes(setting), setting);
  assert.ok(service.includes('a \\"%% $$\\\\jst.js')); assert.ok(service.includes('"XDG_CACHE_HOME=/cache/with space"'));
  assert.doesNotMatch(service, /sudo|cron|Restart=/);
  assert.throws(() => systemdUnits('/cli\nInjected=true', '/state', 300)); assert.throws(() => systemdUnits('/cli', '/state', 0));
});
test('systemd registration is explicit, XDG-aware, shared across hosts and removes only owned units', { skip: posix }, () => {
  const f = setup();
  try {
    const status = schedule('status', f.root, 300, undefined, f.options);
    assert.equal(status.registered, false); assert.equal(existsSync(f.directory), false);
    const enabled = schedule('enable', f.root, 300, f.cli, f.options);
    assert.equal(enabled.registered, true); assert.equal(enabled.cleanupScheduled, false);
    assert.equal(readFileSync(f.timer, 'utf8'), systemdUnits(f.cli, f.root, 300, f.cache).timer);
    // The start timeout does not depend on the profile at registration: a later, larger runTimeoutSeconds still fits.
    assert.match(readFileSync(f.service, 'utf8'), /TimeoutStartSec=3720s/);
    assert.ok(f.calls.some(args => args.join(' ') === `--user enable --now ${systemdUnit}.timer`));
    assert.ok(!f.calls.some(args => args[1] === 'start'));
    assert.equal(schedule('status', f.root, 300, undefined, f.options).registered, true);
    assert.throws(() => schedule('enable', f.root, 300, f.cli, f.options), /already configured/);
    const disabled = schedule('disable', f.root, 300, undefined, f.options);
    assert.equal(disabled.registered, false); assert.equal('historyPreserved' in disabled && disabled.historyPreserved, true);
    assert.equal(existsSync(f.timer), false); assert.equal(existsSync(f.service), false); assert.equal(existsSync(f.cli), true);
  } finally { rmSync(f.root, { recursive: true }); }
});
test('unavailable systemd returns honest guidance and refuses enable without a fallback', { skip: posix }, () => {
  const f = setup(), options = { ...f.options, runner: (): ReturnType<Runner> => ({ status: 1, stderr: 'Failed to connect to user bus' }) };
  try {
    const status = schedule('status', f.root, 300, undefined, options) as { supported: boolean; reason: string };
    assert.equal(status.supported, false); assert.match(status.reason, /manual snapshots/); assert.match(status.reason, /never falls back to cron, root/);
    assert.throws(() => schedule('enable', f.root, 300, f.cli, options), /user manager unavailable/);
    assert.equal(existsSync(f.directory), false);
  } finally { rmSync(f.root, { recursive: true }); }
});
test('failed systemd enable rolls back its units and preserves unrelated files', { skip: posix }, () => {
  const f = setup(); mkdirSync(f.directory, { recursive: true, mode: 0o700 }); const unrelated = join(f.directory, 'other.service'); writeFileSync(unrelated, 'keep');
  const runner: Runner = args => args[1] === 'enable' ? { status: 1, stderr: 'injected enable refusal' } : f.runner(args);
  try {
    assert.throws(() => schedule('enable', f.root, 300, f.cli, { ...f.options, runner }), /injected enable refusal/);
    assert.equal(existsSync(f.timer), false); assert.equal(existsSync(f.service), false); assert.equal(readFileSync(unrelated, 'utf8'), 'keep');
    assert.ok(f.calls.some(args => args.join(' ') === `--user disable --now ${systemdUnit}.timer`));
  } finally { rmSync(f.root, { recursive: true }); }
});
test('systemd mutations refuse unrelated services, overrides, unexpected files and partial inspection', { skip: posix }, () => {
  const f = setup();
  try {
    const external: Runner = args => args[1] === 'show' && args[2].endsWith('.service') ? { status: 0, stdout: 'LoadState=loaded\nFragmentPath=/external/service\nDropInPaths=\n' } : f.runner(args);
    assert.throws(() => schedule('enable', f.root, 300, f.cli, { ...f.options, runner: external }), /already configured/);
    schedule('enable', f.root, 300, f.cli, f.options);
    assert.throws(() => schedule('disable', f.root, 300, undefined, { ...f.options, runner: external }), /another location/);
    const overridden: Runner = args => { const result = f.runner(args); return args[1] === 'show' ? { ...result, stdout: result.stdout!.replace('DropInPaths=', 'DropInPaths=/external/override.conf') } : result; };
    assert.throws(() => schedule('disable', f.root, 300, undefined, { ...f.options, runner: overridden }), /overrides/);
    assert.equal(f.calls.some(args => args[1] === 'stop'), false);
    writeFileSync(f.service, 'not jstack', { mode: 0o600 });
    assert.throws(() => schedule('disable', f.root, 300, undefined, f.options), /Unexpected scheduler file/);
    assert.equal(readFileSync(f.service, 'utf8'), 'not jstack');
    assert.throws(() => schedule('status', f.root, 300, undefined, { ...f.options, runner: args => args[1] === 'show' && args[2] !== '--property=Version' ? { status: 0, stdout: '' } : { status: 0 } }), /Unexpected systemd unit state/);
  } finally { rmSync(f.root, { recursive: true }); }
});
test('failed systemd rollback keeps evidence for manual recovery', { skip: posix }, () => {
  const f = setup(), runner: Runner = args => ['enable', 'disable'].includes(args[1]) ? { status: 1, stderr: 'injected failure' } : f.runner(args);
  try {
    assert.throws(() => schedule('enable', f.root, 300, f.cli, { ...f.options, runner }), /rollback failed/);
    assert.equal(existsSync(f.timer), true); assert.equal(existsSync(f.service), true);
  } finally { rmSync(f.root, { recursive: true }); }
});
test('enable stops when the user manager loads the units from elsewhere, removing only its files without disable', { skip: posix }, () => {
  const f = setup(), elsewhere = join(f.root, 'manager config/systemd/user');
  // The user manager searches another XDG_CONFIG_HOME: it never sees the units this shell wrote.
  const runner: Runner = args => args[1] === 'show' && args[2] !== '--property=Version' ? { status: 0, stdout: 'LoadState=not-found\nActiveState=inactive\nUnitFileState=\nFragmentPath=\nDropInPaths=\n' } : f.runner(args);
  const moved: Runner = args => { const result = f.runner(args); return args[1] === 'show' && result.stdout ? { ...result, stdout: result.stdout.replace(f.directory, elsewhere) } : result; };
  try {
    for (const injected of [runner, moved]) {
      f.calls.length = 0;
      assert.throws(() => schedule('enable', f.root, 300, f.cli, { ...f.options, runner: injected }), /did not load the units just written[\s\S]*XDG_CONFIG_HOME/);
      assert.equal(existsSync(f.timer), false); assert.equal(existsSync(f.service), false);
      assert.equal(f.calls.some(args => ['enable', 'disable'].includes(args[1])), false);
      assert.equal(f.calls.filter(args => args[1] === 'daemon-reload').length, 2);
    }
  } finally { rmSync(f.root, { recursive: true }); }
});
test('enable that fails before systemd loads the units removes its files without disable', { skip: posix }, () => {
  const f = setup(), runner: Runner = args => args[1] === 'daemon-reload' ? { status: 1, stderr: 'injected reload failure' } : f.runner(args);
  try {
    assert.throws(() => schedule('enable', f.root, 300, f.cli, { ...f.options, runner }), /injected reload failure/);
    assert.equal(existsSync(f.timer), false); assert.equal(existsSync(f.service), false);
    assert.equal(f.calls.some(args => ['enable', 'disable'].includes(args[1])), false);
  } finally { rmSync(f.root, { recursive: true }); }
});
test('status reports a masked or broken unit instead of failing, and changes refuse it', { skip: posix }, () => {
  const f = setup();
  try {
    for (const state of ['masked', 'error']) {
      const runner: Runner = args => args[1] === 'show' && args[2] === systemdUnit + '.timer' ? { status: 0, stdout: `LoadState=${state}\nActiveState=inactive\nUnitFileState=${state === 'masked' ? 'masked' : ''}\nFragmentPath=\nDropInPaths=\n` } : f.runner(args);
      const status = schedule('status', f.root, 300, undefined, { ...f.options, runner }) as { registered: boolean; loadState: string; attention?: string };
      assert.equal(status.registered, false); assert.equal(status.loadState, state); assert.match(status.attention ?? '', new RegExp(`LoadState=${state}`));
      assert.throws(() => schedule('enable', f.root, 300, f.cli, { ...f.options, runner }), new RegExp(`Unexpected systemd unit state: .*LoadState=${state}`));
      assert.throws(() => schedule('disable', f.root, 300, undefined, { ...f.options, runner }), /Unexpected systemd unit state/);
      assert.equal(existsSync(f.timer), false);
    }
  } finally { rmSync(f.root, { recursive: true }); }
});
