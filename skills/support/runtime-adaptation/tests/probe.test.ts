import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authArgv, belowFloor, contextVersion } from '../scripts/probe.js';
test('probe compares numeric versions and parses auth as literal argv', () => {
  assert.equal(belowFloor('10.0.0', '9.99.99'), false); assert.equal(belowFloor('1.2.3', '1.2.4'), true);
  assert.equal(contextVersion('warning 2026-01-01', 'tool'), ''); assert.equal(contextVersion('tool version 10.2.3', 'tool'), '10.2.3');
  assert.deepEqual(authArgv('tool auth "literal $(touch no)" \'two words\''), ['tool', 'auth', 'literal $(touch no)', 'two words']);
  for (const text of ['tool; touch no', 'tool | other', 'tool $(other)', 'tool "unclosed', '']) assert.throws(() => authArgv(text));
});
test('probe has silent ready, partial auth, blocked runtime/floor/missing, and enforced timeout states', { skip: process.platform === 'win32' }, () => {
  const root = mkdtempSync(join(tmpdir(), 'jstack-probe-')), bin = join(root, 'bin'), log = join(root, 'auth.json'); mkdirSync(bin);
  const env = { ...process.env, HOME: root, USERPROFILE: root, PATH: bin, LOG: log };
  const script = fileURLToPath(new URL('../scripts/probe.js', import.meta.url));
  const fake = (name: string, source: string) => { const path = join(bin, name); writeFileSync(path, `#!${process.execPath}\n${source}\n`); chmodSync(path, 0o755); };
  const run = (args: string[]) => spawnSync(process.execPath, [script, ...args], { cwd: root, env, encoding: 'utf8', timeout: 5000 });
  try {
    let result = run(['missing', '--install', 'npm install NEVER_RUN']); assert.equal(result.status, 2); assert.match(result.stdout, /Install: npm install NEVER_RUN/);
    fake('tool', "process.stderr.write('unrelated warning 2026-01-01\\n'); if (process.argv[2] === '--version') process.exitCode = 1; else process.stderr.write('tool version 10.2.3\\n');");
    result = run(['tool', '--floor', '9.0']); assert.equal(result.status, 0, result.stdout + result.stderr); assert.equal(result.stdout, ''); assert.equal(result.stderr, '');
    result = run(['tool', '--floor', '10.2.4']); assert.equal(result.status, 2); assert.match(result.stdout, /below required version/);
    fake('auth', "require('node:fs').writeFileSync(process.env.LOG, JSON.stringify(process.argv.slice(2))); process.exitCode = process.argv[2] === 'fail' ? 1 : 0;");
    result = run(['tool', '--auth', 'auth pass "$(touch no)"']); assert.equal(result.status, 0); assert.deepEqual(JSON.parse(readFileSync(log, 'utf8')), ['pass', '$(touch no)']); assert.equal(existsSync(join(root, 'no')), false);
    result = run(['tool', '--auth', 'auth fail']); assert.equal(result.status, 1); assert.match(result.stdout, /unauthenticated/);
    for (const args of [['tool', '--floor'], ['tool', '--auth', 'auth;touch no'], ['tool', '--floor', 'invalid'], ['tool', '--timeout', '-1'], ['tool', '--unknown']]) assert.equal(run(args).status, 2);
    fake('tool', "process.stdout.write('tool 999.0.0'); process.exitCode = 3;"); result = run(['tool']); assert.equal(result.status, 2); assert.match(result.stdout, /cannot run/);
    fake('tool', 'setTimeout(() => {}, 10000);'); result = run(['tool', '--timeout', '0.05']); assert.equal(result.status, 2); assert.match(result.stdout, /cannot run/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
