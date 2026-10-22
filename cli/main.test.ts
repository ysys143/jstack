import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArguments } from './main.js';
import { verifyIntegrity } from './download.js';

test('CLI validates arguments before any mutation or remote request', () => {
  assert.deepEqual(parseArguments(['install']).options.hosts, ['claude', 'codex']);
  for (const args of [['install', '--host', 'unknown'], ['update', '--version', '../latest'], ['install', '--scope', 'project'], ['status', '--source', '/tmp'], ['migrate'], ['update', '--home', 'a', '--home', 'b']]) assert.throws(() => parseArguments(args));
  const child = spawnSync(process.execPath, [fileURLToPath(new URL('./main.js', import.meta.url)), '--help'], { encoding: 'utf8' });
  assert.equal(child.status, 0); assert.match(child.stdout, /Node 20\+/);
});
test('registry download requires strong integrity and rejects changed bytes', () => {
  const bytes = Buffer.from('synthetic archive'), integrity = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
  verifyIntegrity(bytes, integrity);
  assert.throws(() => verifyIntegrity(Buffer.from('changed'), integrity), /integrity mismatch/);
  assert.throws(() => verifyIntegrity(bytes, 'sha1-abc'), /SHA-512/);
});
test('npm-style symlink entry executes the CLI instead of silently succeeding', { skip: process.platform === 'win32' }, () => {
  const directory = mkdtempSync(join(tmpdir(), 'jstack-bin-link-'));
  try {
    const bin = join(directory, 'jst');
    symlinkSync(fileURLToPath(new URL('./main.js', import.meta.url)), bin);
    const child = spawnSync(process.execPath, [bin, '--help'], { encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    assert.match(child.stdout, /Usage: jst /);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('host roots default to .claude and .agents, honor overrides, and isolate --home', () => {
  const probe = `
    import { homedir } from 'node:os';
    import { locations, hostEnvironment } from ${JSON.stringify(new URL('./hosts.js', import.meta.url).href)};
    const options = JSON.parse(process.argv[1]);
    const paths = locations(options), env = hostEnvironment(options);
    console.log(JSON.stringify({ home: homedir(), paths, claude: env.CLAUDE_CONFIG_DIR, codex: env.CODEX_HOME }));
  `;
  const base = { ...process.env };
  delete base.CLAUDE_CONFIG_DIR; delete base.CODEX_HOME;
  const read = (env: NodeJS.ProcessEnv, options = {}) => {
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', probe, JSON.stringify(options)], { env, encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    const result = JSON.parse(child.stdout);
    assert.equal(result.claude, result.paths.claude);
    assert.equal(result.codex, result.paths.codex);
    assert.equal(result.paths.root, join(result.paths.home, '.jstack'));
    return result;
  };
  for (const env of [base, { ...base, CLAUDE_CONFIG_DIR: '', CODEX_HOME: '' }]) {
    const result = read(env);
    assert.equal(result.paths.claude, join(result.home, '.claude'));
    assert.equal(result.paths.codex, join(result.home, '.agents'));
  }
  const overrides = { ...base, CLAUDE_CONFIG_DIR: join(tmpdir(), 'claude-profile'), CODEX_HOME: join(tmpdir(), 'codex-profile') };
  const selected = read(overrides);
  assert.equal(selected.paths.claude, overrides.CLAUDE_CONFIG_DIR);
  assert.equal(selected.paths.codex, overrides.CODEX_HOME);
  const home = join(tmpdir(), 'jstack-alternate-home');
  const isolated = read(overrides, { home });
  assert.equal(isolated.paths.claude, join(home, '.claude'));
  assert.equal(isolated.paths.codex, join(home, '.agents'));
});
