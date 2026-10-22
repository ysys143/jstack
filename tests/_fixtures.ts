/** Disposable root-suite support; never points tests at the user's home or index. */
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import type { TestContext } from 'node:test';
import { sourceRoot } from '../scripts/doctor-work.js';
export const ROOT = process.env.JSTACK_RUNTIME_ROOT || sourceRoot();
export function box(t: TestContext, name: string): string { const root = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), name)); t.after(() => fs.rmSync(root, { recursive: true, force: true })); return root; }
export function write(path: string, data: string | Buffer, mode = 0o600): string { fs.mkdirSync(dirname(path), { recursive: true, mode: 0o700 }); fs.writeFileSync(path, data, { mode }); return path; }
export function git(root: string, ...args: string[]): string {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'commit.gpgsign', GIT_CONFIG_VALUE_0: 'false' } });
  if (result.status !== 0) throw new Error(result.stderr || 'Git fixture failed'); return result.stdout;
}
export function faultRename(target: string, action: () => void, once = true): boolean {
  const original = fs.renameSync; let failed = false;
  fs.renameSync = ((from, to) => { if (String(to) === target && (!failed || !once)) { failed = true; throw new Error('simulated disk write failure'); } original(from, to); }) as typeof fs.renameSync;
  syncBuiltinESMExports();
  try { action(); } finally { fs.renameSync = original; syncBuiltinESMExports(); }
  return failed;
}
export function child(args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => { const process = spawn(globalThis.process.execPath, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] }); let stdout = '', stderr = ''; process.stdout.setEncoding('utf8').on('data', value => stdout += value); process.stderr.setEncoding('utf8').on('data', value => stderr += value); process.on('error', reject); process.on('close', status => resolve({ status, stdout, stderr })); });
}
