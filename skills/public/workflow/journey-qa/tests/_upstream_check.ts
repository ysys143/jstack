import { spawnSync, type SpawnSyncOptionsWithStringEncoding } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

interface Execution {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  error?: Error & { code?: string };
}
type Runner = (command: string, args: string[], options: SpawnSyncOptionsWithStringEncoding) => Execution;

/** Keep the full upstream streams separate from the owning suite's measured verdict. */
export function runUpstreamCheck(cwd: string, env: NodeJS.ProcessEnv, evidencePath: string,
  upstream: { digest: string; count: number }, run: Runner = spawnSync): Execution {
  const startedAt = new Date().toISOString();
  const result = run('bash', ['check.sh'], { cwd, env, encoding: 'utf8', timeout: 1_500_000, maxBuffer: 64 * 1024 * 1024 });
  const stdout = result.stdout ?? '', stderr = result.stderr ?? '';
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, JSON.stringify({
    schemaVersion: 1, command: ['bash', 'check.sh'], cwd, startedAt,
    nodeVersion: process.version, platform: process.platform, architecture: process.arch,
    inputFingerprint: env.JSTACK_SUITE_INPUT_FINGERPRINT ?? null, runId: env.JSTACK_SUITE_RUN_ID ?? null, upstream,
    exitCode: result.status, signal: result.signal,
    error: result.error ? { message: result.error.message, code: result.error.code ?? null } : null,
    complete: result.status !== null && !result.error && result.signal === null,
    stdout, stderr,
    stdoutSha256: createHash('sha256').update(stdout).digest('hex'),
    stderrSha256: createHash('sha256').update(stderr).digest('hex'),
  }, null, 2) + '\n');
  return result;
}
