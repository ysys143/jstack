import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync, realpathSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { context, capture, load, file, observe } from './task_state.js';
import * as old from './fixtures/task_state_v1.js';
import { startRun, runEvent, selectRun, runStatus, leafContext } from './sdlc.js';
import { main as taskMain } from './task_cli.js';
import { repo_identity } from '../skills/public/workflow/verify/scripts/workflow.js';
import { processTemporaryDirectory } from './fixtures/process_tmp.js';

// Starting a run needs the user's confirmation of the exact requirements; the runtime reports the digest to confirm.
// Tests obtain it from the first refusal and then confirm, so the confirmation path is always exercised.
export function confirmed<T>(run: (extra: any) => T, extra: any = {}): T {
  if ('confirmed' in extra) return run(extra);
  try { return run(extra); } catch (e) {
    const m = /requirementsSha256=([0-9a-f]{64})/.exec((e as Error).message);
    if (!m) throw e;
    return run({ ...extra, confirmed: true, requirementsSha256: m[1] });
  }
}

let template: string | undefined;
// Protocol tests use real atomic writes on Linux's temporary memory filesystem,
// avoiding block-device fsync latency. The migration test below retains a disk fixture.
const fixtureTemp = process.platform === 'linux' && existsSync('/dev/shm') ? '/dev/shm' : tmpdir();
after(() => { if (template) rmSync(template, { recursive: true, force: true }); });
function repoTemplate(): string {
  if (template) return template;
  template = processTemporaryDirectory('jstack-sdlc-template-', fixtureTemp);
  for (const args of [['init', '-q'], ['config', 'user.email', 'fixture@example.invalid'], ['config', 'user.name', 'Fixture']]) {
    const r: SpawnSyncReturns<string> = spawnSync('git', args, { cwd: template, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr);
  }
  writeFileSync(path.join(template, 'app.cjs'), 'module.exports=1;');
  for (const args of [['add', 'app.cjs'], ['commit', '-qm', 'fixture']]) { const r: SpawnSyncReturns<string> = spawnSync('git', args, { cwd: template, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); }
  return template;
}
function fixture(t: any, temporaryRoot = fixtureTemp) {
  const home = realpathSync(mkdtempSync(path.join(temporaryRoot, 'jstack-sdlc-'))), root = path.join(home, 'repo'); mkdirSync(root);
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const git = (...args: string[]) => { const r: SpawnSyncReturns<string> = spawnSync('git', args, { cwd: root, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  cpSync(repoTemplate(), root, { recursive: true });
  const c = { ...context(root, home, 'session-a'), now: 1000 };
  const put = (name: string, value: unknown) => { const p = path.join(home, name); writeFileSync(p, typeof value === 'string' ? value : JSON.stringify(value)); return p; };
  const user = put('user.json', { role: 'user', host: 'codex', session: 'session-a', message: 'message-1', content: 'jstack:sdlc for this change and implement the accepted spec.' });
  const env = put('environment.json', { host: 'codex', session: 'session-a', version: 'fixture', profile: 'isolated', hooks: 'none', capabilities: 'fixture', competingCoordinator: false });
  capture(c, { id: 'change', expectedRevision: 0, source: { role: 'user', message: 'message-1', quote: 'Use jstack:sdlc' }, purpose: 'Change app', authorized: ['implement'], requirements: [{ id: 'R1', text: 'Return one', kind: 'code' }] });
  const source = { observation: user, message: 'message-1' };
  const start = (extra: any = {}) => confirmed(x => startRun(c, { id: 'change', expectedRevision: load(c, 'change').revision, eventId: 'start', reason: 'Explicit selection', run: 'run-1', endpoint: 'local-commit', method: 'ordinary', source,
    coordinator: { id: 'owner', host: 'codex', session: c.session }, environment: env, repoCheck: 'node -e "require(\'./app.cjs\')"', ...x }), extra);
  let serial = 0;
  const input = (type: string, extra = {}) => ({ id: 'change', run: 'run-1', expectedRevision: load(c, 'change').revision, eventId: `event-${++serial}`, reason: 'Fixture event', coordinator: 'owner', epoch: 1, type, ...extra });
  const event = (type: string, extra = {}) => runEvent(c, input(type, extra));
  const binding = () => {
    const dir = path.join(root, '.jstack/tasks/code'); mkdirSync(dir, { recursive: true });
    const contract = { 계약버전: 2, 작업ID: 'code', 검증: [{ 요구ID: 'C1', 관련파일: ['app.cjs'] }] };
    const bytes = JSON.stringify(contract), hash = createHash('sha256').update(bytes).digest('hex');
    writeFileSync(path.join(dir, 'contract.yaml'), bytes);
    writeFileSync(path.join(dir, 'task.json'), JSON.stringify({ taskId: 'code', repository: repo_identity(root), contractSha256: hash }));
    return { task: 'code', contractSha256: hash, mapping: [{ request: 'R1', revision: 1, requirement: 'C1' }] };
  };
  const shape = async (extra: any = {}) => {
    await event('shape', { spec: put('spec.md', '# Change\nReturn one.\n'), readiness: { decisions: [], criteria: [{ requirement: 'R1', when: 'called', actor: 'app', behavior: 'return one', observable: 'value equals 1', failure: 'other value fails', human: false }], ...extra } });
    await event('bind', { binding: binding() }); await event('approve', { gate: 'shape', verdict: 'pass', source });
  };
  return { home, root, c, put, git, source, env, start, input, event, binding, shape };
}

test('explicit selection migrates only its task and the frozen old writer refuses v2', t => {
  const f = fixture(t, tmpdir()), before = load(f.c, 'change');
  old.capture(f.c, { id: 'change', expectedRevision: before.revision, source: { role: 'user', message: 'm', quote: 'Keep scope' }, constraints: ['Preserve scope'] });
  const migrated = f.start(); assert.equal(migrated.schemaVersion, 2); assert.equal(migrated.constraints[0], 'Preserve scope');
  assert.throws(() => old.load(f.c, 'change'), /identity/);
  assert.throws(() => old.capture(f.c, { id: 'change', expectedRevision: migrated.revision, source: { role: 'user', message: 'm', quote: 'Amend' } }), /identity/);
  assert.equal(load(f.c, 'change').revision, migrated.revision);
  assert.throws(() => capture(f.c, { id: 'change', expectedRevision: migrated.revision, source: { role: 'user', message: 'm', quote: 'Amend' } }), /coordinator/);
});

test('generic build and assistant observations cannot create a run', t => {
  const f = fixture(t);
  f.put('user.json', { role: 'user', host: 'codex', session: 'session-a', message: 'message-1', content: 'Build an app' });
  assert.throws(() => f.start(), /Explicit sdlc/);
  f.put('user.json', { role: 'assistant', host: 'codex', session: 'session-a', message: 'message-1', content: 'Use jstack:sdlc' });
  assert.throws(() => f.start(), /host user/); assert.equal(load(f.c, 'change').schemaVersion, 1);
});

test('readiness blocks material assumptions and requires complete identity mapping', async t => {
  const f = fixture(t); f.start();
  await f.shape({ decisions: [{ id: 'D1', status: 'assumed', material: true, reversible: false, revisit: 'before data migration', source: 'user message' }] });
  await assert.rejects(f.event('transition', { stage: 'execute' }), /open-material/);
  await f.shape({ decisions: [{ id: 'D1', status: 'assumed', material: false, reversible: true, revisit: 'if interface changes', source: 'code inspection' }] });
  await f.event('transition', { stage: 'execute' });
  await assert.rejects(f.event('transition', { stage: 'release' }), /next stage/);
  assert.equal(runStatus(f.c, load(f.c, 'change')).runComplete, false);
  const ready = load(f.c, 'change').run!.shape!;
  await f.event('shape', { spec: ready.spec.path, readiness: { decisions: ready.decisions, criteria: ready.criteria.map(a => ({ ...a, human: true })) } });
  await assert.rejects(f.event('transition', { stage: 'execute' }), /shape-acceptance-required/);
});

test('duplicate events do not advance revision, conflicting payload and cwd are rejected', async t => {
  const f = fixture(t); f.start(); const input = f.input('pause'); const first = await runEvent(f.c, input);
  assert.equal((await runEvent(f.c, input)).revision, first.revision);
  await assert.rejects(runEvent(f.c, { ...input, reason: 'changed' }), /reused/);
  await assert.rejects(runEvent({ ...f.c, root: f.home }, input), /worktree/);
  assert.equal(load(f.c, 'change').run!.state, 'paused');
});

test('only a leading invocation token selects; a refusing tail needs the requirement confirmation, not a text rule', t => {
  const f = fixture(t);
  const rejected = ['Use jstack:sdlc for this change', 'Do not use jstack:sdlc', 'What does jstack:sdlc mean?', 'sdlc tests are failing',
    'Run sdlc.test.js and report', 'Please use jstack:sdlc', 'jstack:sdlcx for this change'];
  for (const content of rejected) {
    f.put('user.json', { role: 'user', host: 'codex', session: 'session-a', message: 'message-1', content });
    assert.throws(() => f.start(), /Explicit sdlc/, content);
  }
  assert.equal(load(f.c, 'change').schemaVersion, 1);
  f.put('user.json', { role: 'user', host: 'codex', session: 'session-a', message: 'message-1', content: 'jstack:sdlc 쓰지 말고 그냥 이 버그 고쳐줘' });
  assert.throws(() => f.start({ confirmed: false }), /Confirm the requirements/, 'refusing tail without confirmation');
  assert.equal(load(f.c, 'change').schemaVersion, 1);
  for (const content of ['/sdlc add a feature', '$sdlc fix the parser', 'jstack:sdlc, implement the accepted spec',
    '/jstack:sdlc add search', '$jstack:sdlc fix the parser']) {
    const g = fixture(t);
    g.put('user.json', { role: 'user', host: 'codex', session: 'session-a', message: 'message-1', content });
    assert.equal(g.start().schemaVersion, 2, content);
  }
});

test('starting needs the exact requirements confirmed; a wrong digest is refused', t => {
  const f = fixture(t);
  assert.throws(() => f.start({ confirmed: true, requirementsSha256: '0'.repeat(64) }), /Confirm the requirements/);
  assert.equal(load(f.c, 'change').schemaVersion, 1);
  assert.equal(f.start().schemaVersion, 2);
});

test('select and approve bind to the coordinator host, not only its session', async t => {
  const f = fixture(t); f.start(); await f.shape();
  const sameSessionOtherHost = f.put('user-claude.json', { role: 'user', host: 'claude', session: 'session-a', message: 'message-2', content: 'approve' });
  await assert.rejects(f.event('approve', { gate: 'commit', verdict: 'pass', target: { parent: 'a', tree: 'b' }, source: { observation: sameSessionOtherHost, message: 'message-2' } }), /coordinator host session/);
  const c = { ...f.c }, selectWithoutToken = f.put('user-select.json', { role: 'user', host: 'codex', session: 'session-a', message: 'message-3', content: 'continue the run' });
  assert.throws(() => selectRun(c, { ...f.input('select'), source: { observation: selectWithoutToken, message: 'message-3' }, coordinator: { id: 'owner', host: 'codex', session: 'session-a' }, environment: f.env }), /Explicit sdlc/);
});

test('observations from another session cannot start or approve the run', async t => {
  const f = fixture(t);
  const other = f.put('user-b.json', { role: 'user', host: 'codex', session: 'session-b', message: 'message-1', content: 'jstack:sdlc for this change' });
  assert.throws(() => f.start({ source: { observation: other, message: 'message-1' } }), /coordinator host session/, 'start from another session');
  const otherHost = f.put('user-claude.json', { role: 'user', host: 'claude', session: 'session-a', message: 'message-1', content: 'jstack:sdlc for this change' });
  assert.throws(() => f.start({ source: { observation: otherHost, message: 'message-1' } }), /coordinator host session/, 'same session, other host');
  f.put('user.json', { role: 'user', host: 'codex', session: 'session-a', message: 'message-1', content: 'jstack:sdlc for this change' });
  f.start(); await f.shape();
  await assert.rejects(f.event('approve', { gate: 'commit', verdict: 'pass', target: { parent: 'a', tree: 'b' }, source: { observation: other, message: 'message-1' } }), /coordinator host session/);
});

test('handoff preserves unknown work and fences the previous coordinator', async t => {
  const f = fixture(t); f.start(); await f.shape(); await f.event('transition', { stage: 'execute' });
  const observation = f.put('execution.json', { actor: 'worker', host: 'codex', event: 'start' });
  observe(f.c, { id: 'change', expectedRevision: load(f.c, 'change').revision, run: { id: 'run-1', coordinator: 'owner', epoch: 1 }, attempt: 'a', event: 'start', operation: 'implement', requirements: ['R1'], owner: 'owner', role: 'executor', handle: 'worker', observation });
  await f.event('handoff'); const before = load(f.c, 'change'); assert.ok(before.run!.handoff); assert.equal(before.attempts[0].state, 'running');
  const c = { ...f.c, session: 'session-b' }, env = f.put('env-b.json', { host: 'codex', session: 'session-b', version: 'fixture', profile: 'isolated', hooks: 'none', capabilities: 'fixture', competingCoordinator: false });
  const userB = f.put('user-b.json', { role: 'user', host: 'codex', session: 'session-b', message: 'message-b', content: 'jstack:sdlc to resume this run' });
  assert.throws(() => selectRun(c, { ...f.input('select'), source: { observation: userB, message: 'message-b' }, coordinator: { id: 'new-owner', host: 'codex', session: 'session-b' }, environment: env }), /Confirm the requirements/, 'select without confirmation');
  confirmed(x => selectRun(c, { ...f.input('select'), source: { observation: userB, message: 'message-b' }, coordinator: { id: 'new-owner', host: 'codex', session: 'session-b' }, environment: env, ...x }));
  await assert.rejects(f.event('reenter'), /coordinator/);
  await assert.rejects(runEvent(c, f.input('reenter', { coordinator: 'new-owner', epoch: 2 })), /Settle workers/);
  observe(c, { id: 'change', expectedRevision: load(c, 'change').revision, run: { id: 'run-1', coordinator: 'new-owner', epoch: 2 }, attempt: 'a', event: 'end', reason: 'Observed completion after handoff', observation });
  await runEvent(c, f.input('reenter', { coordinator: 'new-owner', epoch: 2 }));
  assert.equal(load(c, 'change').run!.state, 'active');
  assert.equal(load(c, 'change').attempts[0].state, 'ended');
});

test('result bytes and semantic amendments invalidate evidence without changing disposition vocabulary', async t => {
  const f = fixture(t); f.start(); await f.shape(); await f.event('transition', { stage: 'execute' });
  const context = leafContext(load(f.c, 'change')) as any;
  const output = f.put('result.json', { kind: 'implemented', verdict: 'pass', requirements: ['R1'], basis: context.basis, targets: context.targets });
  const observation = f.put('execution.json', { actor: 'worker', host: 'codex', event: 'end' });
  await f.event('result', { output, observation });
  assert.equal((runStatus(f.c, load(f.c, 'change')).projections.R1 as any).implemented, 'pass');
  const preserved = load(f.c, 'change').run!.results['implemented:R1'].refs[0].snapshot!;
  f.put('result.json', 'changed'); assert.equal(JSON.parse(readFileSync(preserved, 'utf8')).verdict, 'pass'); assert.equal((runStatus(f.c, load(f.c, 'change')).projections.R1 as any).implemented, 'stale');
  capture(f.c, { id: 'change', expectedRevision: load(f.c, 'change').revision, run: { id: 'run-1', coordinator: 'owner', epoch: 1 }, source: { role: 'user', message: 'change', quote: 'Return two instead' }, requirements: [{ id: 'R1', text: 'Return two', kind: 'code' }] });
  const changed = load(f.c, 'change'); assert.equal(changed.run!.stage, 'shape'); assert.equal(changed.requirements[0].revision, 2);
  await assert.rejects(f.event('transition', { stage: 'execute' }), /shape-missing-or-stale/);
});

test('TDD approvals are ordered and bind scenario/case bytes', async t => {
  const f = fixture(t); f.start({ method: 'tdd' }); await f.shape();
  await f.event('transition', { stage: 'execute' });
  const startAttempt = () => observe(f.c, { id: 'change', expectedRevision: load(f.c, 'change').revision, run: { id: 'run-1', coordinator: 'owner', epoch: 1 }, attempt: 'a', event: 'start', operation: 'implement', requirements: ['R1'], owner: 'owner', role: 'executor', handle: 'worker', observation: f.put('execution.json', { event: 'start' }) });
  assert.throws(startAttempt, /tdd-approvals-required/);
  const artifact = f.put('cases.md', 'Case one');
  await assert.rejects(f.event('approve', { gate: 'cases', verdict: 'pass', source: f.source, artifact }), /scenarios before/);
  await f.event('approve', { gate: 'scenarios', verdict: 'pass', source: f.source, artifact });
  assert.throws(startAttempt, /tdd-approvals-required/);
  f.put('cases.md', 'changed'); await assert.rejects(f.event('approve', { gate: 'cases', verdict: 'pass', source: f.source, artifact }), /scenarios before/);
  await f.event('approve', { gate: 'scenarios', verdict: 'pass', source: f.source, artifact });
  await f.event('approve', { gate: 'cases', verdict: 'pass', source: f.source, artifact });
  assert.doesNotThrow(startAttempt);
  await f.event('approve', { gate: 'scenarios', verdict: 'pass', source: f.source, artifact });
  assert.equal(load(f.c, 'change').run!.approvals.cases, undefined);
});

test('cancel preserves open requests and cannot be revived by a stage or select', async t => {
  const f = fixture(t); f.start(); await f.event('cancel');
  const view = runStatus(f.c, load(f.c, 'change')); assert.equal(view.disposition, 'open'); assert.equal(view.runComplete, false);
  await assert.rejects(f.event('reenter'), /Terminal/);
  assert.throws(() => selectRun(f.c, { ...f.input('select'), source: f.source, coordinator: { id: 'owner', host: 'codex', session: 'session-a' }, environment: f.env }), /Terminal/);
  assert.equal(JSON.parse(readFileSync(file(f.c, 'change'), 'utf8')).run.state, 'cancelled');
});

test('native task CLI routes run help and explicit read-only resume without selecting a latest task', async t => {
  const f = fixture(t); f.start();
  const invoke = async (...args: string[]) => {
    const logs: string[] = [], log = console.log, error = console.error;
    console.log = (...values) => logs.push(values.join(' ')); console.error = console.log;
    try { return { code: await taskMain(['run', ...args]), output: logs.join('\n') }; }
    finally { console.log = log; console.error = error; }
  };
  assert.match((await invoke('--help')).output, /start\|select\|event/);
  const flags = ['--workspace', f.root, '--home', f.home, '--session', 'session-a'];
  assert.equal((await invoke('status', ...flags)).code, 2);
  const before = load(f.c, 'change').revision;
  const view = await invoke('status', 'change', ...flags);
  assert.equal(view.code, 0); assert.equal(JSON.parse(view.output).run.id, 'run-1');
  assert.equal(load(f.c, 'change').revision, before);
  const input = f.put('pause.json', f.input('pause'));
  assert.equal((await invoke('event', '--input', input, ...flags)).code, 0);
  assert.equal(load(f.c, 'change').run!.state, 'paused');
  await f.event('cancel');
  assert.equal((await invoke('resume', 'change', ...flags)).code, 1);
});
