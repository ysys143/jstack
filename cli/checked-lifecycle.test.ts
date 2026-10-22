import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPackage } from '../packaging/build.js';
import { hostEnvironment } from './hosts.js';
test('checked full bundles install, update and roll back through the real CLI in isolated homes', { skip: !process.env.JSTACK_TEST_CHECKED_PACKAGE || !process.env.JSTACK_TEST_PREVIOUS_PACKAGE || process.env.JSTACK_TEST_REAL_HOSTS !== '1' }, async t => {
  const current = process.env.JSTACK_TEST_CHECKED_PACKAGE!, previous = process.env.JSTACK_TEST_PREVIOUS_PACKAGE!, before = checkPackage(previous), next = checkPackage(current);
  assert.notEqual(before.version, next.version);
  const root = mkdtempSync(join(tmpdir(), 'jstack-checked-lifecycle-')), home = join(root, 'home'), cli = fileURLToPath(new URL('./main.js', import.meta.url)); mkdirSync(home);
  const env = hostEnvironment({ home }); const evidence: unknown[] = [];
  const run = (command: string, extra: string[] = [], expected = 0) => { const args = [cli, command, '--home', home, '--json', ...extra], result = spawnSync(process.execPath, args, { cwd: root, env, encoding: 'utf8', timeout: 120_000, maxBuffer: 16 * 1024 * 1024 }); evidence.push({ command, extra, status: result.status, stdout: result.stdout, stderr: result.stderr }); assert.equal(result.status, expected, JSON.stringify(evidence.at(-1))); return JSON.parse(result.stdout); };
  try {
    mkdirSync(join(home, '.jstack/profiles'), { recursive: true }); const privateFile = join(home, '.jstack/profiles/synthetic.json'); writeFileSync(privateFile, '{"preserve":"synthetic-user-data"}'); const privateBytes = readFileSync(privateFile);
    mkdirSync(join(home, '.claude/skills/user-authored'), { recursive: true }); const skill = join(home, '.claude/skills/user-authored/SKILL.md'); writeFileSync(skill, '---\nname: user-authored\ndescription: Synthetic explicit request only.\n---\nPreserve this skill.\n'); const skillBytes = readFileSync(skill);
    const preserved = () => { assert.deepEqual(readFileSync(privateFile), privateBytes); assert.deepEqual(readFileSync(skill), skillBytes); };
    const verify = (version: string) => { const state = run('status'); assert.ok(state.hosts.every((row: any) => row.version === version && row.installed && row.discovered), JSON.stringify(state)); for (const host of ['claude', 'codex']) { const installed = join(home, host === 'claude' ? '.claude/plugins/cache/jstack/jstack' : '.agents/plugins/cache/jstack/jstack', version); assert.equal(checkPackage(installed).version, version); } preserved(); };
    run('install', ['--source', previous]); verify(before.version);
    run('update', ['--source', current]); verify(next.version);
    assert.equal(existsSync(join(home, '.claude/plugins/cache/jstack/jstack', next.version, 'payload/runtime/obsolete-control.txt')), false);
    run('rollback'); verify(before.version);
    await t.test('guarded real-host uninstall preserves live Codex discovery', sub => { const result = spawnSync(process.execPath, [cli, 'uninstall', '--home', home, '--json'], { cwd: root, env, encoding: 'utf8', timeout: 120_000 }); const removed = JSON.parse(result.stdout), codex = removed.hosts.find((row: any) => row.host === 'codex'); evidence.push({ command: 'uninstall', status: result.status, result: removed }); preserved(); if (codex?.error === 'Error: Close Codex sessions and retry uninstall; destructive cache removal deferred') { assert.equal(result.status, 1); assert.equal(removed.hosts.find((row: any) => row.host === 'claude').installed, false); assert.equal(codex.installed, true); const retained = run('status', ['--host', 'codex']); assert.equal(retained.hosts[0].discovered, true); sub.skip('Codex session cessation is not proven; complete native removal remains unverified'); } else assert.equal(result.status, 0, JSON.stringify(removed)); });
  } finally { if (process.env.JSTACK_TEST_INSTALLER_EVIDENCE) writeFileSync(process.env.JSTACK_TEST_INSTALLER_EVIDENCE, JSON.stringify({ platform: process.platform, arch: process.arch, node: process.version, previous: before, current: next, steps: evidence }, null, 2)); rmSync(root, { recursive: true, force: true }); }
});
