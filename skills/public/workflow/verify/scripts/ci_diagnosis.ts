#!/usr/bin/env node
/** Read-only cross-check of a captured CI run against the current checkout. */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { isMain } from '../../../../../runtime/entry.js';

type Args = { repoRoot: string; evidence: string; run: number; job: number; attempt: number; head: string };
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const object = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};

function parse(argv: string[]): Args {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]!;
    if (!['--repo-root', '--evidence', '--run', '--job', '--attempt', '--head'].includes(key) || values.has(key) || !argv[i + 1] || argv[i + 1]!.startsWith('--')) throw new Error(`Invalid option: ${key}`);
    values.set(key, argv[++i]!);
  }
  if (values.size !== 6) throw new Error('Require --repo-root, --evidence, --run, --job, --attempt, and --head');
  const run = Number(values.get('--run')), job = Number(values.get('--job')), attempt = Number(values.get('--attempt'));
  const head = values.get('--head')!;
  if (![run, job, attempt].every(value => Number.isSafeInteger(value) && value > 0) || !/^[a-f0-9]{40}$/.test(head)) throw new Error('Invalid run, job, attempt, or full Git head');
  return { repoRoot: resolve(values.get('--repo-root')!), evidence: resolve(values.get('--evidence')!), run, job, attempt, head };
}
function git(root: string, ...args: string[]): string {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 10_000, env });
  if (result.status !== 0) throw new Error(`Git ${args.join(' ')} unavailable: ${(result.stderr || result.error?.message || '').trim()}`);
  return result.stdout.trim();
}
function githubRepository(remote: string): string | undefined {
  const match = remote.match(/^(?:git@github\.com:|https:\/\/github\.com\/)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/);
  return match?.[1];
}
export function diagnose(args: Args): Record<string, unknown> {
  const evidence = object(JSON.parse(readFileSync(args.evidence, 'utf8')));
  const run = object(evidence.run), job = object(evidence.job), log = object(evidence.log), checker = object(evidence.checker);
  const actualHead = git(args.repoRoot, 'rev-parse', 'HEAD');
  // Ask Git whether the given directory is the top level rather than comparing two
  // spellings of one path: Git reports long names and forward slashes, while a host
  // realpath may keep 8.3 short names and backslashes for the same directory.
  const rootPrefix = git(args.repoRoot, 'rev-parse', '--show-prefix');
  const remote = git(args.repoRoot, 'remote', 'get-url', 'origin');
  const actualRepository = githubRepository(remote);
  const problems: string[] = [];
  if (rootPrefix !== '') problems.push('repository-root-mismatch');
  if (!actualRepository || evidence.repository !== actualRepository || run.repository !== actualRepository || job.repository !== actualRepository) problems.push('repository-mismatch');
  if (actualHead !== args.head || evidence.expectedHead !== args.head || run.headSha !== args.head || job.headSha !== args.head) problems.push('head-mismatch');
  if (run.id !== args.run || job.runId !== args.run) problems.push('run-mismatch');
  if (job.id !== args.job) problems.push('job-mismatch');
  if (run.attempt !== args.attempt || job.attempt !== args.attempt) problems.push('attempt-mismatch');
  if (run.status !== 'completed' || job.status !== 'completed' || !['success', 'failure'].includes(run.conclusion) || !['success', 'failure'].includes(job.conclusion)) problems.push('incomplete-run');
  if (!['success', 'failed'].includes(checker.status) || !Number.isSafeInteger(checker.exitCode) || (checker.status === 'success') !== (checker.exitCode === 0)) problems.push('checker-unverified');
  if (!Array.isArray(evidence.artifacts)) problems.push('artifacts-unreported');
  else if (evidence.artifacts.some((item: unknown) => { const row = object(item); return !Number.isSafeInteger(row.id) || typeof row.name !== 'string' || !['available', 'expired', 'missing'].includes(row.status); })) problems.push('artifact-evidence-invalid');
  else if (evidence.artifacts.some((item: unknown) => object(item).status !== 'available')) problems.push('artifact-unavailable');
  if (log.complete !== true || typeof log.path !== 'string' || !/^[a-f0-9]{64}$/.test(log.sha256)) problems.push('log-incomplete');
  else {
    try { const file = isAbsolute(log.path) ? log.path : resolve(args.repoRoot, log.path); if (sha(readFileSync(file)) !== log.sha256) problems.push('log-digest-mismatch'); }
    catch { problems.push('log-unavailable'); }
  }
  if (!problems.length && checker.status === 'success' && (run.conclusion !== 'success' || job.conclusion !== 'success')) problems.push('status-conflict');
  if (!problems.length && checker.status === 'failed' && run.conclusion === 'success' && job.conclusion === 'success') problems.push('status-conflict');
  const disposition = problems.length ? 'insufficient-evidence' : checker.status === 'failed' ? 'failed-check' : 'completed-check';
  return { disposition, currentCodeVerified: false, repository: actualRepository ?? null, head: actualHead,
    run: args.run, job: args.job, attempt: args.attempt, observations: { runStatus: run.status ?? null, runConclusion: run.conclusion ?? null, jobStatus: job.status ?? null, jobConclusion: job.conclusion ?? null, checkerStatus: checker.status ?? null },
    problems, handoff: 'Return observations and competing hypotheses to the original phase; this diagnosis makes no source repair or verification claim.' };
}
export function main(argv = process.argv.slice(2)): number {
  try { const result = diagnose(parse(argv)); process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); return (result.problems as string[]).length ? 1 : 0; }
  catch (error) { process.stderr.write(`ci_diagnosis: ${(error as Error).message}\n`); return 2; }
}
if (isMain(import.meta.url)) process.exitCode = main();
