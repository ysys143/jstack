import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { specialistRoot, specialistStatus, setupSpecialist, runSpecialist, type SpecialistOptions } from './specialists.js';
import { runProcess } from './os.js';
function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'jstack-specialist-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, 'source'), home = join(root, 'home'); mkdirSync(home);
  const put = (name: string, text: string) => { const path = join(source, name); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); };
  put('contracts/ts-migration/specialists.json', JSON.stringify({ features: [{ id: 'sample', python: '3.10', lock: 'locks/sample.txt', importCheck: 'import example', targetPlatforms: ['macos', 'linux', 'windows'], sources: ['scripts/sample.py'] }] }));
  put('locks/sample.txt', 'example==1.0 --hash=sha256:' + 'a'.repeat(64)); put('scripts/sample.py', 'print("fixture")');
  const calls: { command: string; args: string[]; env?: NodeJS.ProcessEnv }[] = [];
  let failInstall = false;
  const runner: typeof runProcess = (command, args, options = {}) => {
    calls.push({ command, args, env: options.env });
    if (args[0] === 'venv') {
      const python = join(args.at(-1)!, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
      mkdirSync(dirname(python), { recursive: true }); writeFileSync(python, 'fixture');
    }
    return { status: failInstall && args[0] === 'pip' ? 1 : 0, stdout: args[0] === '--version' ? command === 'uv' ? 'uv 0.7.8\n' : 'Python 3.10.18\n' : '', stderr: '', output: [], pid: 0, signal: null };
  };
  const options: SpecialistOptions = { root: source, home, runner };
  return { source, home, options, calls, put, fail: () => { failInstall = true; } };
}
test('optional status is read-only and setup requires hash-locked isolated installation', t => {
  const f = fixture(t); assert.equal(specialistStatus('sample', f.options).state, 'absent'); assert.equal(f.calls.length, 0);
  const result = setupSpecialist('sample', f.options); assert.equal(result.state, 'ready');
  assert.ok(f.calls.some(row => row.args.includes('--require-hashes') && row.args.includes('--requirements')));
  assert.ok(f.calls.some(row => row.args.includes('--managed-python')));
  assert.ok(f.calls.some(row => row.args[0] === '-I' && row.args.includes('import example')));
  assert.equal(result.featureArtifactVerified, false);
  const count = f.calls.length; setupSpecialist('sample', f.options); assert.equal(f.calls.length, count);
});
test('compiled manifest without locks falls back to the complete source root', t => {
  const f = fixture(t);
  f.put('dist/contracts/ts-migration/specialists.json', readFileSync(join(f.source, 'contracts/ts-migration/specialists.json'), 'utf8'));
  const moduleUrl = pathToFileURL(join(f.source, 'dist/runtime/specialists.js')).href;
  assert.equal(realpathSync(specialistRoot(moduleUrl)), realpathSync(f.source));
  rmSync(join(f.source, 'locks/sample.txt'));
  assert.throws(() => specialistRoot(moduleUrl), /manifest is missing/);
});
test('failed setup preserves the incomplete environment and refuses an automatic retry', t => {
  const f = fixture(t); f.fail(); assert.throws(() => setupSpecialist('sample', f.options), /command failed/);
  assert.equal(specialistStatus('sample', f.options).state, 'incomplete');
  assert.throws(() => setupSpecialist('sample', f.options), /Incomplete or unmanaged/);
});
test('only declared specialist scripts execute, with literal arguments', t => {
  const f = fixture(t);
  assert.throws(() => runSpecialist('sample', '../outside.py', [], f.options), /does not belong/);
  assert.equal(f.calls.length, 0);
  assert.equal(runSpecialist('sample', 'scripts/sample.py', ['space name', '; echo unsafe'], f.options), 0);
  assert.deepEqual(f.calls.at(-1)!.args.slice(1), ['space name', '; echo unsafe']);
});
test('unowned environment state and changed lock identities are preserved', t => {
  const f = fixture(t), result = setupSpecialist('sample', f.options);
  const receipt = join(result.directory, 'jstack-environment.json');
  const state = JSON.parse(readFileSync(receipt, 'utf8')); state.identity = 'different'; writeFileSync(receipt, JSON.stringify(state)); chmodSync(receipt, 0o600);
  assert.throws(() => specialistStatus('sample', f.options), /identity differs/);
  assert.throws(() => setupSpecialist('sample', f.options), /identity differs/);
});
