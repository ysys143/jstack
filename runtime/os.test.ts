import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { npmShimTarget, removeTreeSync, runProcess } from './os.js';
test('npm shim resolves a Node entrypoint without cmd argument interpolation', t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jstack-shim-'))); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const entry = path.join(root, 'node_modules', 'fixture', 'main.js'); fs.mkdirSync(path.dirname(entry), { recursive: true }); fs.writeFileSync(entry, '');
  const shim = path.join(root, 'fixture.cmd'); fs.writeFileSync(shim, '@ECHO off\nSET "_prog=node"\n"%_prog%" "%dp0%\\node_modules\\fixture\\main.js" %*\n'); assert.equal(npmShimTarget(shim), entry);
  fs.writeFileSync(shim, '@echo off\nnode "%dp0%\\..\\outside.js" %*'); assert.throws(() => npmShimTarget(shim), /escapes/);
});
test('process arguments retain Unicode and shell metacharacters literally', () => {
  const args = ['한글 space', 'a&b', '%PATH%', '$(touch not-created)', '"quote"', 'line\nfeed'];
  const result = runProcess(process.execPath, ['-e', 'console.log(JSON.stringify(process.argv.slice(1)))', ...args]); assert.equal(result.status, 0); assert.deepEqual(JSON.parse(result.stdout), args);
});

test('Python and TS writers contend on the same portable lock in both directions', { skip: process.platform === 'win32' || !process.env.JSTACK_ORACLE }, async t => {
  const { spawn, spawnSync } = await import('node:child_process');
  const { withLock } = await import('./os.js');
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jstack-lock-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const module of ['profiles', 'skill_store']) {
    const file = path.join(root, `${module}.lock`);
    const script = `import importlib.util, pathlib, sys, time\nspec=importlib.util.spec_from_file_location('fixture', sys.argv[1]); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)\nwith m.portable_lock(pathlib.Path(sys.argv[2]), timeout=float(sys.argv[3])):\n print('held', flush=True)\n time.sleep(float(sys.argv[4]))`;
    const source = path.resolve('runtime', `${module}.py`);
    const child = spawn('python3', ['-c', script, source, file, '1', '0.4']);
    const exited = new Promise<number | null>(resolve => child.on('exit', resolve));
    await new Promise<void>((resolve, reject) => { child.stdout.once('data', () => resolve()); child.once('error', reject); child.once('exit', code => { if (code !== 0) reject(new Error('Python lock holder failed')); }); });
    assert.throws(() => withLock(file, () => assert.fail('overlapping TS writer'), 80), /unavailable/);
    assert.equal(await exited, 0);
    withLock(file, () => {
      const blocked = spawnSync('python3', ['-c', script, source, file, '0.08', '0']);
      assert.notEqual(blocked.status, 0); assert.match(blocked.stderr.toString(), /state lock unavailable/);
    });
    const released = spawnSync('python3', ['-c', script, source, file, '1', '0']);
    assert.equal(released.status, 0, released.stderr.toString());
  }
});

test('recovery preserves live and unknown owners and recovers a proven terminated writer', async t => {
  const { spawn } = await import('node:child_process');
  const { recoverLock, withLock, privateDir, atomicWrite } = await import('./os.js');
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jstack-recover-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'state.lock');
  withLock(file, () => assert.throws(() => recoverLock(file), /still active/));
  privateDir(file);
  atomicWrite(path.join(file, 'owner.json'), Buffer.from(JSON.stringify({pid: process.pid, host: 'unknown-host'})));
  assert.throws(() => recoverLock(file), /cannot be verified/);
  fs.rmSync(file, {recursive: true});
  const child = spawn(process.execPath, ['--input-type=module', '-e', `import {withLock} from ${JSON.stringify(new URL('./os.js', import.meta.url).href)}; withLock(process.argv[1],()=>{console.log('held');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,60000)})`, file]);
  const exited = new Promise<void>(resolve => child.on('exit', () => resolve()));
  let startupError = ''; child.stderr.on('data', bytes => { startupError += bytes.toString(); });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('lock writer did not become ready: ' + startupError)), 30_000);
      child.stdout.once('data', () => { clearTimeout(timer); resolve(); });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`lock writer exited ${code}: ${startupError}`)); });
    });
  } finally { child.kill('SIGKILL'); await exited; }
  assert.throws(() => withLock(file, () => assert.fail('stale lock stolen'), 50), /unavailable/);
  assert.equal(recoverLock(file), true); assert.equal(recoverLock(file), false);
  withLock(file, () => assert.ok(true));
});

test('private state creation and replacement preserve ownership checks', async t => {
  const { privateDir, atomicWrite, checkOwned } = await import('./os.js');
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jstack-private-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, 'state'), file = path.join(directory, 'state.json');
  privateDir(directory); privateDir(directory); checkOwned(directory, true);
  atomicWrite(file, Buffer.from('first')); checkOwned(file);
  atomicWrite(file, Buffer.from('second')); checkOwned(file);
  assert.equal(fs.readFileSync(file, 'utf8'), 'second');
});


test('a shared parent may be 0755 but never writable by group or others, linked, or not a directory', { skip: process.platform === 'win32' }, async t => {
  const { sharedParent, privateDir } = await import('./os.js');
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jstack-shared-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const created = path.join(root, 'created');
  sharedParent(created); assert.equal(fs.statSync(created).mode & 0o777, 0o700);
  const shared = path.join(root, 'shared'); fs.mkdirSync(shared); fs.chmodSync(shared, 0o755);
  sharedParent(shared); sharedParent(shared); assert.equal(fs.statSync(shared).mode & 0o777, 0o755);
  privateDir(path.join(shared, 'leaf')); assert.equal(fs.statSync(path.join(shared, 'leaf')).mode & 0o777, 0o700);
  for (const mode of [0o775, 0o757, 0o777]) {
    fs.chmodSync(shared, mode);
    assert.throws(() => sharedParent(shared), /not be writable by group or others/, mode.toString(8));
    assert.equal(fs.statSync(shared).mode & 0o777, mode, 'an existing parent is never repaired');
  }
  fs.chmodSync(shared, 0o755);
  const link = path.join(root, 'link'); fs.symlinkSync(shared, link, 'dir');
  assert.throws(() => sharedParent(link), /symlink/);
  const file = path.join(root, 'file'); fs.writeFileSync(file, '');
  assert.throws(() => sharedParent(file), /owned directory/);
});

test('Windows ACL checks ignore incompatible inherited PowerShell modules and reject public access', { skip: process.platform !== 'win32' }, async t => {
  const { privateDir, checkOwned } = await import('./os.js');
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'jstack-acl-modules-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const modules = path.join(root, 'modules'), module = path.join(modules, 'Microsoft.PowerShell.Security');
  fs.mkdirSync(module, { recursive: true });
  fs.writeFileSync(path.join(module, 'Microsoft.PowerShell.Security.psm1'), "throw 'incompatible inherited module loaded'");
  const previous = process.env.PSModulePath;
  try {
    process.env.PSModulePath = modules;
    const directory = path.join(root, 'state'); privateDir(directory); checkOwned(directory, true);
    const exposed = runProcess('icacls.exe', [directory, '/grant', '*S-1-1-0:(OI)(CI)R']);
    assert.equal(exposed.status, 0, exposed.stderr);
    assert.throws(() => checkOwned(directory, true), /public ACL/);
    assert.throws(() => privateDir(directory), /public ACL/, 'existing public ACL must not be repaired silently');
  } finally { if (previous === undefined) delete process.env.PSModulePath; else process.env.PSModulePath = previous; }
});

test('exclusive private state creation never replaces a lock or file', async t => {
  const { privateDir, createPrivateFile, checkOwned } = await import('./os.js');
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'jstack-exclusive-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const lock = path.join(root, 'lock'); privateDir(lock, { exclusive: true }); checkOwned(lock, true);
  fs.writeFileSync(path.join(lock, 'marker'), 'first owner');
  assert.throws(() => privateDir(lock, { exclusive: true }), { code: 'EEXIST' });
  assert.equal(fs.readFileSync(path.join(lock, 'marker'), 'utf8'), 'first owner');
  const file = path.join(root, 'database'); createPrivateFile(file); checkOwned(file);
  fs.writeFileSync(file, 'preserved data');
  assert.throws(() => createPrivateFile(file), { code: 'EEXIST' });
  assert.equal(fs.readFileSync(file, 'utf8'), 'preserved data');
});


test('owned Unicode trees are removed without following outside junctions', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jstack-remove-tree-'));
  t.after(() => removeTreeSync(root));
  const target = path.join(root, '한글 tree'), outside = path.join(root, 'outside');
  fs.mkdirSync(path.join(target, 'nested'), { recursive: true }); fs.mkdirSync(outside);
  fs.writeFileSync(path.join(target, 'nested', '내용'), 'owned');
  fs.writeFileSync(path.join(outside, 'keep'), 'user');
  fs.symlinkSync(outside, path.join(target, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  removeTreeSync(target);
  assert.equal(fs.existsSync(target), false);
  assert.equal(fs.readFileSync(path.join(outside, 'keep'), 'utf8'), 'user');
  assert.throws(() => removeTreeSync(target), { code: 'ENOENT' });
});
