import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { commandInvocation, runCommand } from '../scripts/bridge-common.js';

const entry = (name: string) => name === 'codex-bridge.js' ? fileURLToPath(new URL('../../../../support/task-delegation/scripts/codex-bridge.js', import.meta.url)) : fileURLToPath(new URL(name, new URL('../scripts/', import.meta.url)));
test('Windows npm command shims resolve to Node argv without evaluating cmd metacharacters', () => {
  const root = mkdtempSync(join(tmpdir(), 'jstack-cmd-shim-'));
  try {
    const target = join(root, 'cli.js'), shim = join(root, 'codex.cmd'); writeFileSync(target, '');
    writeFileSync(shim, '@ECHO off\r\n"%_prog%" "%dp0%\\cli.js" %*\r\n');
    assert.deepEqual(commandInvocation(shim, ['literal & calc', '"quoted"'], 'win32'), { command: process.execPath, args: [target, 'literal & calc', '"quoted"'] });
    writeFileSync(shim, '@ECHO off\r\nother %*\r\n'); assert.throws(() => commandInvocation(shim, [], 'win32'), /Unsupported Windows command shim/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'jstack-fake-bridges-')), bin = join(root, 'bin'), log = join(root, 'calls.jsonl'); mkdirSync(bin);
  const env = { ...process.env, HOME: root, USERPROFILE: root, CODEX_HOME: join(root, '.codex'), PATH: bin, OPENAI_API_KEY: 'fake-test-key', GEMINI_API_KEY: '', LOG: log };
  const fake = (name: string, body: string) => {
    const path = join(bin, name);
    writeFileSync(path, `#!${process.execPath}\nconst fs = require('node:fs'); let input = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', value => input += value); process.stdin.on('end', () => { fs.appendFileSync(process.env.LOG, JSON.stringify({ name: ${JSON.stringify(name)}, args: process.argv.slice(2), input }) + '\\n'); ${body} });\n`); chmodSync(path, 0o755); return path;
  };
  const run = (name: string, args: string[], overrides: NodeJS.ProcessEnv = {}) => spawnSync(process.execPath, [entry(name), ...args], { cwd: root, env: { ...env, ...overrides }, encoding: 'utf8', timeout: 10_000 });
  const calls = () => existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map(row => JSON.parse(row)) : [];
  return { root, bin, env, fake, run, calls, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('Codex delegation uses stdin, literal model/workdir argv, and read-only by default', { skip: process.platform === 'win32' }, () => {
  const f = fixture();
  try {
    f.fake('codex', "process.stdout.write('  result \\n');");
    const prompt = '$(touch injected) "literal"\nsecond', workdir = join(f.root, 'directory with spaces');
    const result = f.run('codex-bridge.js', ['--prompt', prompt, '--workdir', workdir, '--model', 'model;literal']);
    assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, 'result\n');
    assert.deepEqual(f.calls()[0].args, ['exec', '-s', 'read-only', '--skip-git-repo-check', '-C', workdir, '-m', 'model;literal', '-']);
    assert.equal(f.calls()[0].input, prompt + '\n'); assert.equal(existsSync(join(f.root, 'injected')), false);
    const elevated = f.run('codex-bridge.js', ['--prompt', 'explicit', '--sandbox', 'workspace-write']);
    assert.equal(elevated.status, 0); assert.equal(f.calls()[1].args[2], 'workspace-write');
  } finally { f.cleanup(); }
});
test('bridge negatives retain stderr and reject missing, unauthenticated, empty, failed and timed-out execution', { skip: process.platform === 'win32' }, () => {
  const f = fixture();
  try {
    const missing = f.run('./council-bridge.js', ['--prompt', 'query']); assert.equal(missing.status, 1); assert.equal(missing.stdout, ''); assert.match(missing.stderr, /CLI not found/);
    f.fake('codex', "process.stdout.write('must not run');");
    const auth = f.run('codex-bridge.js', ['--prompt', 'query'], { OPENAI_API_KEY: '' }); assert.equal(auth.status, 1); assert.match(auth.stderr, /unauthenticated/); assert.equal(f.calls().length, 0);
    const before = f.calls().length;
    for (const args of [['--prompt'], ['--prompt', 'query', '--timeout', '-1'], ['--prompt', 'query', '--timeout', 'bad'], ['--prompt', 'query', '--unknown', 'x']]) assert.equal(f.run('./council-bridge.js', args).status, 1);
    assert.equal(f.calls().length, before);
  } finally { f.cleanup(); }
});
test('council reports a missing or failed Codex participant, ignores an installed agy, and pins Codex to read-only', { skip: process.platform === 'win32' }, () => {
  const f = fixture();
  try {
    const absent = f.run('./council-bridge.js', ['--prompt', 'query']); assert.equal(absent.status, 1); assert.equal(absent.stdout, ''); assert.match(absent.stderr, /Codex CLI is not installed/);
    f.fake('agy', "require('node:fs').writeFileSync('UNAUTHORIZED','bad');process.stdout.write('unsafe');");
    f.fake('codex', "process.stdout.write('codex response');");
    const one = f.run('./council-bridge.js', ['--prompt', 'query']); assert.equal(one.status, 0); assert.match(one.stdout, /=== CODEX RESPONSE ===\ncodex response/); assert.doesNotMatch(one.stdout, /AGY/); assert.match(one.stderr, /1\/1 AIs responded successfully/); assert.deepEqual(f.calls()[0].args.slice(0, 4), ['exec', '--sandbox', 'read-only', '--skip-git-repo-check']);
    assert.equal(f.calls().filter(call => call.name === 'agy').length, 0); assert.equal(existsSync(join(f.root, 'UNAUTHORIZED')), false);
    f.fake('codex', "process.stderr.write('provider denied\\n'); process.exitCode = 9;");
    const failed = f.run('./council-bridge.js', ['--prompt', 'query']); assert.equal(failed.status, 1); assert.match(failed.stdout, /Codex failed with exit code 9\]\nprovider denied/); assert.match(failed.stderr, /0\/1 AIs responded successfully/);
  } finally { f.cleanup(); }
});
test('transport enforces timeout/output bounds and preserves split UTF-8 bytes', { skip: process.platform === 'win32' }, async () => {
  const f = fixture();
  try {
    const path = f.fake('transport', "process.stdout.write(Buffer.from([0xf0,0x9f])); setTimeout(() => process.stdout.write(Buffer.from([0x98,0x80])), 10);");
    assert.equal((await runCommand(path, [], { timeout: 2, env: f.env })).stdout, '😀');
    f.fake('transport', "process.stdout.write('x'.repeat(10000)); setTimeout(() => {},10000);");
    const bounded = await runCommand(path, [], { timeout: 2, env: f.env, maxBytes: 100 }); assert.equal(bounded.status, 125); assert.match(bounded.stderr, /output exceeded/);
    f.fake('transport', 'setTimeout(() => {}, 10000);');
    const timeout = await runCommand(path, [], { timeout: 0.05, env: f.env }); assert.equal(timeout.status, 124); assert.equal(timeout.timedOut, true);
  } finally { f.cleanup(); }
});
