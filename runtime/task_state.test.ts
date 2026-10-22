import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { context, capture, observe, assess, status, resume, load, selectTask } from './task_state.js';
import { stateOperation, writeState } from './workflow_state.js';
import { main as taskMain, HELP } from './task_cli.js';

function fixture(t: any) {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), 'jstack-task-')));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const root = path.join(home, 'work'); fs.mkdirSync(root);
  const c = { ...context(root, home, 'session-a'), now: 1000 };
  const put = (name: string, text: string) => { fs.writeFileSync(path.join(root, name), text); return name; };
  put('host.txt', 'Host event: worker a started'); put('report.txt', 'Analysis with cited source and limits.');
  const source = { role: 'user', message: 'turn-1', quote: 'Compare frameworks; preserve my scope.' };
  const create = (extra: any = {}) => capture(c, { id: 'work', expectedRevision: 0, source, purpose: 'Compare frameworks', authorized: ['analyze'],
    requirements: [{ id: 'R1', text: 'Compare lifecycle', kind: 'research' }, { id: 'R2', text: 'Explain limitations', kind: 'document' }], ...extra });
  const event = (event: string, extra: any = {}) => observe(c, { id: 'work', expectedRevision: load(c, 'work').revision, attempt: 'a', event, ...extra });
  const proof = (requirement: string, extra: any = {}) => ({ requirement, requirementRevision: 1, method: 'review', result: 'pass',
    observer: 'coordinator', independence: 'self', artifacts: ['report.txt'], sources: ['https://example.org/spec'], rationale: 'Compared the requested behavior with the source.', ...extra });
  const verify = (evidence: any[]) => assess(c, { id: 'work', expectedRevision: load(c, 'work').revision, evidence });
  return { c, home, root, put, source, create, event, proof, verify };
}
test('corrections preserve omitted requirements and invalidate only revised meaning', t => {
  const f = fixture(t); f.create(); f.verify([f.proof('R1'), f.proof('R2')]);
  assert.equal(status(f.c, load(f.c, 'work')).complete, true);
  const task = capture(f.c, { id: 'work', expectedRevision: 2, source: { ...f.source, message: 'turn-2', quote: 'Do not focus on routing' },
    requirements: [{ id: 'R1', text: 'Compare lifecycle without routing focus', kind: 'research' }] });
  const view = status(f.c, task); assert.equal(view.complete, false);
  assert.deepEqual(view.requirements.map(r => r.state), ['unknown', 'passed']);
  assert.equal(task.history.length, 3); assert.equal(task.requirements.length, 2);
});
test('partial coverage, changed files and withdrawn requirements never imply full success', t => {
  const f = fixture(t); f.create(); f.verify([f.proof('R1')]);
  assert.equal(status(f.c, load(f.c, 'work')).complete, false);
  f.verify([f.proof('R2')]); f.put('report.txt', 'Changed after review');
  assert.equal(status(f.c, load(f.c, 'work')).requirements[0]!.reason, 'stale-evidence');
  const withdrawn = capture(f.c, { id: 'work', expectedRevision: 3, source: f.source, withdraw: ['R1', 'R2'] });
  assert.equal(status(f.c, withdrawn).complete, false); assert.equal(status(f.c, withdrawn).disposition, 'withdrawn');
});
test('planning correction revokes execution without losing requirements or authorizing from silence', t => {
  const f = fixture(t); f.create();
  const task = capture(f.c, { id: 'work', expectedRevision: 1, source: { ...f.source, quote: 'Design it first' }, authorized: ['design'] });
  assert.equal(task.requirements.length, 2);
  assert.throws(() => f.event('start', { operation: 'analyze', requirements: ['R1'], handle: 'worker-a', observation: 'host.txt' }), /not authorized/);
  assert.throws(() => capture(f.c, { id: 'work', expectedRevision: 2, withdraw: ['R1'] }), /user message/);
});
test('no execution is inferred from capture; stale liveness remains unknown', t => {
  const f = fixture(t); const task = f.create(); assert.deepEqual(status(f.c, task).attempts, []);
  assert.throws(() => f.event('start', { operation: 'analyze', requirements: ['R1'] }), /handle/);
  f.event('start', { operation: 'analyze', requirements: ['R1'], handle: 'worker-a', observation: 'host.txt' });
  assert.equal(status(f.c, load(f.c, 'work')).attempts[0]!.state, 'running');
  assert.equal(status({ ...f.c, now: 130000 }, load(f.c, 'work')).attempts[0]!.state, 'unknown');
  assert.equal(resume(f.c, load(f.c, 'work')).canResume, false);
});
test('partial and late results cannot complete or revive an earlier attempt', t => {
  const f = fixture(t); f.create(); f.event('start', { operation: 'analyze', requirements: ['R1'], handle: 'worker-a', observation: 'host.txt' });
  f.event('partial', { artifacts: ['report.txt'] }); f.event('stop', { reason: 'interrupted', observation: 'host.txt' });
  f.event('start', { attempt: 'b', operation: 'analyze', requirements: ['R1'], handle: 'worker-b', observation: 'host.txt' });
  f.event('partial', { artifacts: ['report.txt'] });
  const task = load(f.c, 'work'); assert.deepEqual(task.attempts.map(a => a.state), ['stopped', 'running']);
  assert.equal(status(f.c, task).complete, false);
  assert.throws(() => f.event('end', { observation: 'host.txt', reason: 'late' }), /terminal/);
});
test('external response loss blocks retries until readback; confirmed writes cannot repeat', t => {
  const f = fixture(t); f.create(); f.event('start', { operation: 'analyze', requirements: ['R1'], handle: 'worker-a', observation: 'host.txt' });
  f.event('external-invoked', { key: 'issue-create-1', observation: 'host.txt' });
  f.event('stop', { reason: 'response-lost', observation: 'host.txt' });
  assert.equal(resume(f.c, load(f.c, 'work')).canResume, false);
  assert.throws(() => f.event('start', { attempt: 'b', operation: 'analyze', requirements: ['R1'], handle: 'worker-b', observation: 'host.txt' }), /unknown external/);
  f.put('readback.txt', 'Provider readback: issue #123 exists');
  f.event('external-resolved', { key: 'issue-create-1', outcome: 'present', observation: 'readback.txt' });
  assert.equal(resume(f.c, load(f.c, 'work')).canResume, true);
  f.event('start', { attempt: 'b', operation: 'analyze', requirements: ['R1'], handle: 'worker-b', observation: 'host.txt' });
  assert.throws(() => f.event('external-invoked', { attempt: 'b', key: 'issue-create-1', observation: 'host.txt' }), /already exists/);
});
test('budget exhaustion stops admission and is never success', t => {
  const f = fixture(t); f.create({ budget: { maxAttempts: 1 } });
  f.event('start', { operation: 'analyze', requirements: ['R1'], handle: 'worker-a', observation: 'host.txt' });
  f.event('end', { observation: 'host.txt', reason: 'failed' });
  const view = status(f.c, load(f.c, 'work')); assert.equal(view.complete, false); assert.equal(view.budget, 'attempt-budget-exhausted');
  assert.throws(() => f.event('start', { attempt: 'b', operation: 'analyze', requirements: ['R1'], handle: 'worker-b', observation: 'host.txt' }), /budget-exhausted/);
});
test('research needs sources, independent review needs observation, code needs workflow', t => {
  const f = fixture(t); f.create();
  assert.throws(() => f.verify([f.proof('R1', { sources: [] })]), /source references/);
  capture(f.c, { id: 'work', expectedRevision: 1, source: f.source, requirements: [{ id: 'R2', text: 'Explain limitations', kind: 'document', independent: true }] });
  assert.throws(() => f.verify([f.proof('R2', { requirementRevision: 2, independence: 'reported-independent' })]), /observation/);
  capture(f.c, { id: 'work', expectedRevision: 2, source: f.source, requirements: [{ id: 'R2', text: 'Implement it', kind: 'code', independent: false }] });
  assert.throws(() => f.verify([f.proof('R2', { requirementRevision: 3 })]), /workflow receipt/);
});
test('session lookup never chooses global latest and conflicting writers are rejected', t => {
  const f = fixture(t); f.create();
  assert.equal(selectTask(f.c).id, 'work');
  assert.throws(() => selectTask({ ...f.c, session: undefined }), /task ID/);
  assert.throws(() => selectTask({ ...f.c, session: 'another' }), /none bound/);
  assert.throws(() => capture(f.c, { id: 'work', expectedRevision: 0, source: f.source, withdraw: ['R1'] }), /Revision conflict/);
  assert.equal(load(f.c, 'work').requirements[0]!.active, true);
});
test('new constraints retain previous constraints and expose invalidated running work', t => {
  const f = fixture(t); f.create({ constraints: ['Keep output short'] });
  f.event('start', { operation: 'analyze', requirements: ['R1'], handle: 'worker-a', observation: 'host.txt' });
  const task = capture(f.c, { id: 'work', expectedRevision: 2, source: f.source, constraints: ['Use all three frameworks'] });
  assert.deepEqual(task.constraints, ['Keep output short', 'Use all three frameworks']);
  assert.deepEqual(status(f.c, task).nextActions, ['reconcile-request-change']);
  f.event('end', { reason: 'old result', observation: 'host.txt' });
  assert.throws(() => f.verify([f.proof('R1', { attempt: 'a' })]), /current requirement/);
});
test('partial bytes survive later edits and resume reports stale working artifacts', t => {
  const f = fixture(t); f.create();
  f.event('start', { operation: 'analyze', requirements: ['R1'], handle: 'worker-a', observation: 'host.txt' });
  f.event('partial', { artifacts: ['report.txt'] }); f.event('stop', { observation: 'host.txt', reason: 'interrupted' });
  const task = load(f.c, 'work'), artifact = task.attempts[0]!.artifacts[0]!;
  f.put('report.txt', 'new work');
  assert.equal(fs.readFileSync(artifact.snapshot!, 'utf8'), 'Analysis with cited source and limits.');
  assert.equal(resume(f.c, task).canResume, false);
});
test('workflow completion cannot overwrite an interrupt committed during a long check', async t => {
  const f = fixture(t), stateFile = path.join(f.root, 'state.json');
  fs.writeFileSync(stateFile, JSON.stringify({ phase: 'working', revision: 0 }));
  let release!: () => void; const waiting = new Promise<void>(r => { release = r; });
  const check = stateOperation(f.root, async () => { await waiting; writeState(stateFile, { phase: 'complete' }); });
  await stateOperation(f.root, () => writeState(stateFile, { phase: 'interrupted', revision: 0 }));
  release(); await assert.rejects(check, /state changed/);
  assert.equal(JSON.parse(fs.readFileSync(stateFile, 'utf8')).phase, 'interrupted');
});
test('CLI persists without modifying consumer artifacts and has concise status', t => {
  const f = fixture(t), cli = fileURLToPath(new URL('../cli/main.js', import.meta.url));
  const call = (args: string[], input?: unknown) => spawnSync(process.execPath, [cli, 'task', ...args, '--workspace', f.root, '--home', f.home], { encoding: 'utf8', input: input ? JSON.stringify(input) : undefined });
  const before = fs.readdirSync(f.root);
  const created = call(['capture'], { id: 'local', expectedRevision: 0, purpose: 'Return one number', source: f.source, requirements: [{ id: 'R1', text: 'Only a number', kind: 'document' }] });
  assert.equal(created.status, 0, created.stderr);
  const view = call(['status', 'local']); assert.equal(view.status, 0, view.stderr);
  assert.match(view.stdout, /not started/); assert.ok(view.stdout.split('\n').length <= 7);
  assert.deepEqual(fs.readdirSync(f.root), before);
  assert.equal(fs.readFileSync(path.join(f.root, 'report.txt'), 'utf8'), 'Analysis with cited source and limits.');
});
// taskMain writes before its first await, so the capture is restored before the result is awaited.
function runTask(argv: string[]) {
  const out = process.stdout.write, err = process.stderr.write; let stdout = '', stderr = '';
  process.stdout.write = ((chunk: string | Uint8Array) => { stdout += String(chunk); return true; }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => { stderr += String(chunk); return true; }) as typeof process.stderr.write;
  let status: Promise<number>;
  try { status = taskMain(argv); } finally { process.stdout.write = out; process.stderr.write = err; }
  return status.then(code => ({ status: code, stdout, stderr }));
}
test('--help and -h print the usage on stdout, exit 0, and never create or read state', async t => {
  const f = fixture(t), missing = path.join(f.home, 'missing-workspace');
  for (const argv of [['--help'], ['-h'], ['observe', '--help'], ['status', '--help'], ['capture', '-h'], ['assess', '--help'], ['resume', '--help'],
    ['status', '--help', '--workspace', missing, '--home', f.home]]) {
    const result = await runTask(argv);
    assert.deepEqual(result, { status: 0, stdout: HELP, stderr: '' }, argv.join(' '));
  }
  assert.deepEqual(fs.readdirSync(f.home), ['work']);
});
test('the usage names every action and the accepted values of the input fields', () => {
  assert.match(HELP, /^Usage: jst task capture\|observe\|assess /);
  for (const action of ['capture', 'observe', 'assess', 'status', 'resume']) assert.ok(HELP.includes(`  ${action} `), action);
  for (const field of ['source', 'purpose', 'authorized', 'requirements', 'independent', 'constraints', 'removeConstraints', 'withdraw', 'budget',
    'attempt', 'event', 'operation', 'handle', 'pid', 'observation', 'artifacts', 'reason', 'key', 'outcome',
    'evidence', 'requirement', 'requirementRevision', 'method', 'result', 'rationale', 'observer', 'sources', 'independence', 'workflow'])
    assert.match(HELP, new RegExp(`\\b${field}\\b`), field);
  assert.match(HELP, /attempt: the ended attempt; required once the requirement has an\s+observed attempt/);
  assert.equal(HELP.includes(`Protocol and examples: ${fileURLToPath(new URL('./TASKS.md', import.meta.url))}`), fs.existsSync(new URL('./TASKS.md', import.meta.url)));
  for (const values of ['kind: code|research|document', 'result: pass|fail|unknown', 'method: review|workflow', 'outcome present|absent',
    'independence: self|reported-independent|unknown']) assert.ok(HELP.includes(values), values);
});
test('-h and --help after a task ID or options print the usage, but not where an option value consumes them', async t => {
  const f = fixture(t), here = ['--workspace', f.root, '--home', f.home];
  for (const argv of [['status', 'T1', '--help'], ['status', 'T1', 'T2', '-h'], ['resume', '--json', '--help'], ['capture', '--session', 's1', '-h'],
    ['observe', '--input', 'in.json', '--help']]) {
    assert.deepEqual(await runTask([...argv, ...here]), { status: 0, stdout: HELP, stderr: '' }, argv.join(' '));
  }
  const file = await runTask(['capture', '--input', '-h', ...here]);
  assert.equal(file.status, 2); assert.equal(file.stdout, '');
  assert.match(JSON.parse(file.stderr).error, /ENOENT.*-h/);
  assert.deepEqual(fs.readdirSync(f.home), ['work']);
});
test('unknown actions and a bare invocation still fail with the JSON usage error', async () => {
  for (const argv of [['bogus'], ['bogus', '--help'], ['bogus', 'T1', '-h'], []]) {
    const result = await runTask(argv);
    assert.equal(result.status, 2, argv.join(' ')); assert.equal(result.stdout, '');
    assert.match(JSON.parse(result.stderr).error, /^Usage: jst task capture\|observe\|assess\|status\|resume /);
  }
});
