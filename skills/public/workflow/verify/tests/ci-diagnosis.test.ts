import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';
import { diagnose } from '../scripts/ci_diagnosis.js';

const entry = fileURLToPath(new URL('../scripts/ci_diagnosis.js', import.meta.url));
const withoutGit = (env: NodeJS.ProcessEnv) => Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith('GIT_')));
type Result = { disposition: string; currentCodeVerified: boolean; problems: string[]; observations: Record<string, unknown> };

// One fixture checkout serves every case: the identity matrix calls diagnose() directly,
// and only the command-line contract starts the script as a process.
let shared: ReturnType<typeof createFixture> | undefined;
const roots: string[] = [];
after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'jstack-ci-diagnosis-'));
  roots.push(root);
  const git = (...args: string[]) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', env: withoutGit(process.env) });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git('init', '-q'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.test');
  git('remote', 'add', 'origin', 'git@github.com:team/example.git');
  writeFileSync(join(root, 'source.txt'), 'fixture'); git('add', 'source.txt'); git('commit', '-qm', 'fixture');
  const head = git('rev-parse', 'HEAD'), log = 'failure in check\n';
  writeFileSync(join(root, 'job.log'), log);
  const base = { repository: 'team/example', expectedHead: head, run: { id: 42, repository: 'team/example', headSha: head, attempt: 2, status: 'completed', conclusion: 'failure' },
    job: { id: 7, runId: 42, repository: 'team/example', headSha: head, attempt: 2, status: 'completed', conclusion: 'failure' },
    log: { path: 'job.log', sha256: createHash('sha256').update(log).digest('hex'), complete: true }, artifacts: [], checker: { status: 'failed', exitCode: 1 } };
  const evidence = join(root, 'evidence.json');
  const args = { repoRoot: root, evidence, run: 42, job: 7, attempt: 2, head };
  return {
    root,
    base,
    diagnose: (value: unknown) => { writeFileSync(evidence, JSON.stringify(value)); return diagnose(args) as unknown as Result; },
    cli: (value: unknown, env: NodeJS.ProcessEnv = process.env, repoRoot = root) => {
      writeFileSync(evidence, JSON.stringify(value));
      return spawnSync(process.execPath, [entry, '--repo-root', repoRoot, '--evidence', evidence, '--run', '42', '--job', '7', '--attempt', '2', '--head', head], { encoding: 'utf8', env });
    },
  };
}
const fixture = () => shared ??= createFixture();

test('CI diagnosis: identity matrix', () => {
  const { base, diagnose: run } = fixture();
  const valid = run(base);
  assert.equal(valid.disposition, 'failed-check'); assert.equal(valid.currentCodeVerified, false); assert.deepEqual(valid.problems, []);
  for (const [name, changed, problem] of [
    ['foreign repository', { repository: 'other/example' }, 'repository-mismatch'],
    ['stale head', { expectedHead: 'a'.repeat(40) }, 'head-mismatch'],
    ['foreign run', { run: { ...base.run, id: 43 } }, 'run-mismatch'],
    ['foreign job', { job: { ...base.job, runId: 43 } }, 'run-mismatch'],
    ['wrong job id', { job: { ...base.job, id: 8 } }, 'job-mismatch'],
    ['wrong run attempt', { run: { ...base.run, attempt: 1 } }, 'attempt-mismatch'],
    ['wrong attempt', { job: { ...base.job, attempt: 1 } }, 'attempt-mismatch'],
    ['incomplete log', { log: { ...base.log, complete: false } }, 'log-incomplete'],
    ['changed log bytes', { log: { ...base.log, sha256: '0'.repeat(64) } }, 'log-digest-mismatch'],
    ['unknown checker', { checker: { status: 'unknown' } }, 'checker-unverified'],
    ['skipped checker', { checker: { status: 'skipped' } }, 'checker-unverified'],
    ['conflicting checker exit', { checker: { status: 'failed', exitCode: 0 } }, 'checker-unverified'],
    ['incomplete run', { run: { ...base.run, status: 'in_progress', conclusion: null } }, 'incomplete-run'],
    ['missing artifact listing', { artifacts: null }, 'artifacts-unreported'],
    ['expired artifact', { artifacts: [{ id: 9, name: 'results', status: 'expired' }] }, 'artifact-unavailable'],
    ['stale completion', { run: { ...base.run, headSha: 'b'.repeat(40), conclusion: 'success' } }, 'head-mismatch'],
  ] as const) {
    const result = run({ ...base, ...changed });
    assert.equal(result.currentCodeVerified, false, name);
    assert.equal(result.disposition, 'insufficient-evidence', name);
    assert.ok(result.problems.includes(problem), `${name}: ${result.problems.join(',')}`);
  }
});

test('CI diagnosis: failed checker with successful provider', () => {
  const { base, diagnose: run } = fixture();
  const conflict = run({ ...base, run: { ...base.run, conclusion: 'success' }, job: { ...base.job, conclusion: 'success' } });
  assert.ok(conflict.problems.includes('status-conflict'));
});

test('CI diagnosis: interrupted provider conclusions', () => {
  const { base, diagnose: run } = fixture();
  for (const conclusion of ['cancelled', 'timed_out']) for (const level of ['run', 'job'] as const) {
    const result = run({ ...base, [level]: { ...base[level], conclusion } });
    assert.equal(result.disposition, 'insufficient-evidence');
    assert.ok(result.problems.includes('incomplete-run'));
    assert.equal(result.observations[level === 'run' ? 'runConclusion' : 'jobConclusion'], conclusion);
  }
});

test('CI diagnosis: command-line exit codes, JSON output and foreign Git environment', () => {
  const { root, base, cli } = fixture();
  const foreign = { ...process.env, GIT_DIR: join(root, 'absent-foreign.git'), GIT_WORK_TREE: join(root, 'absent-foreign-tree') };
  const valid = cli(base, foreign);
  assert.equal(valid.status, 0, valid.stderr + valid.stdout);
  assert.equal(JSON.parse(valid.stdout).disposition, 'failed-check');
  const stale = cli({ ...base, expectedHead: 'a'.repeat(40) });
  assert.equal(stale.status, 1, stale.stderr + stale.stdout);
  const result = JSON.parse(stale.stdout);
  assert.equal(result.disposition, 'insufficient-evidence'); assert.equal(result.currentCodeVerified, false);
  assert.ok(result.problems.includes('head-mismatch'));
  const unavailable = cli(base, process.env, join(root, 'absent-repo'));
  assert.equal(unavailable.status, 2, unavailable.stderr + unavailable.stdout);
  assert.equal(unavailable.stdout, '');
  assert.match(unavailable.stderr, /^ci_diagnosis: Git rev-parse HEAD unavailable/);
});
