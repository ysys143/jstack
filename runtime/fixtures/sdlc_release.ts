import type { TestContext } from 'node:test';
import type { GithubReader } from '../sdlc_effects.js';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync, cpSync, existsSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { catalogRoot } from '../catalog_cli.js';

async function quietly<T>(run: () => T | Promise<T>): Promise<T> {
  const original = console.log; console.log = () => {};
  try { return await run(); } finally { console.log = original; }
}
export async function releaseFixture(t: TestContext, endpoint: 'local-commit' | 'pr-and-ship' = 'local-commit', provider?: GithubReader) {
  const home = realpathSync(mkdtempSync(path.join(tmpdir(), 'jstack-sdlc-release-'))), root = path.join(home, 'repo'), previous = process.cwd();
  mkdirSync(root); process.chdir(root);
  t.after(() => { process.chdir(previous); rmSync(home, { recursive: true, force: true }); });
  // Exercise the real runtime in a private code package. Rehashing unrelated
  // vendored skills on every workflow gate is outside this integration's scope.
  const compiled = fileURLToPath(new URL('../../', import.meta.url)), runtime = path.join(home, 'package');
  cpSync(compiled, runtime, { recursive: true, filter: source => {
    const parts = path.relative(compiled, source).split(path.sep);
    if (parts.some(p => ['node_modules', 'native', 'tests', 'fixtures', 'repos', '.git'].includes(p))) return false;
    return statSync(source).isDirectory() || /\.(?:[cm]?js|json)$/.test(source) && !source.endsWith('.test.js');
  } });
  mkdirSync(path.join(runtime, 'contracts'), { recursive: true });
  cpSync(path.join(catalogRoot(), 'contracts/skill-catalog.json'), path.join(runtime, 'contracts/skill-catalog.json'));
  writeFileSync(path.join(runtime, 'package.json'), '{"type":"module"}');
  const modules = path.join(compiled, '../node_modules');
  if (existsSync(modules)) symlinkSync(modules, path.join(home, 'node_modules'), 'junction');
  const { context, capture, load, assess } = await import(pathToFileURL(path.join(runtime, 'runtime/task_state.js')).href) as typeof import('../task_state.js');
  const { startRun, runEvent, runStatus, leafContext } = await import(pathToFileURL(path.join(runtime, 'runtime/sdlc.js')).href) as typeof import('../sdlc.js');
  const workflowFile = fileURLToPath(new URL('../../skills/public/workflow/verify/scripts/workflow.js', import.meta.url));
  const { init, preflight, verify, open_task } = await import(pathToFileURL(path.join(runtime, path.relative(compiled, workflowFile))).href) as typeof import('../../skills/public/workflow/verify/scripts/workflow.js');
  const git = (...args: string[]) => { const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  git('init', '-q'); git('config', 'user.email', 'fixture@example.invalid'); git('config', 'user.name', 'Fixture');
  writeFileSync('app.cjs', 'module.exports=1;');
  writeFileSync('positive.cjs', "require('node:assert/strict').equal(require('./app.cjs'),2);\n");
  writeFileSync('red.cjs', "const fs=require('node:fs'),p=require('node:path'),cp=require('node:child_process');const root=process.argv[2];fs.writeFileSync(p.join(root,'app.cjs'),'module.exports=0;');const r=cp.spawnSync(process.execPath,['positive.cjs'],{cwd:root});process.exit(r.status===1?0:1);\n");
  git('add', '.'); git('commit', '-qm', 'fixture');
  const c = context(root, home, 'session');
  const put = (name: string, data: unknown) => { const p = path.join(home, name); writeFileSync(p, typeof data === 'string' ? data : JSON.stringify(data)); return p; };
  const source = { message: 'message', observation: put('user.json', { role: 'user', host: 'codex', session: 'session', message: 'message', content: `jstack:sdlc; implement the spec and finish at ${endpoint}. Approve each exact release target in this isolated fixture.` }) };
  const env = put('env.json', { host: 'codex', session: 'session', version: 'fixture', profile: 'fixture', hooks: 'none', capabilities: 'fixture', competingCoordinator: false });
  capture(c, { id: 'change', expectedRevision: 0, source: { role: 'user', message: 'message', quote: 'Use jstack:sdlc' }, purpose: 'Return two', authorized: ['implement'], requirements: [{ id: 'R1', text: 'Return two', kind: 'code' }] });
  const startInput = { id: 'change', run: 'run', expectedRevision: 1, eventId: 'start', reason: 'explicit', endpoint, method: 'ordinary', source, environment: env, coordinator: { id: 'owner', host: 'codex', session: 'session' }, repoCheck: 'node positive.cjs' };
  try { startRun(c, startInput); } catch (e) {
    const digest = /requirementsSha256=([0-9a-f]{64})/.exec((e as Error).message)?.[1];
    if (!digest) throw e;
    startRun(c, { ...startInput, confirmed: true, requirementsSha256: digest });
  }
  let serial = 0;
  const event = (type: string, extra = {}) => runEvent(c, { id: 'change', run: 'run', expectedRevision: load(c, 'change').revision, eventId: `e${++serial}`, reason: 'Fixture', coordinator: 'owner', epoch: 1, type, ...extra }, provider);
  const contract = { 계약버전: 2, 작업ID: 'code', 발동: '사용자', 위임: '불필요', 준비: [{ 도구: 'node', 확인명령: 'node --version' }], 산출: [{ 경로: 'app.cjs', 형식: 'JavaScript' }],
    검증: [{ 요구ID: 'C1', 사용자행동: 'Return two', 관련파일: ['app.cjs', 'positive.cjs', 'red.cjs'], 등급: '기계', 명령: { 실행: 'node positive.cjs', 기대종료: 0 }, 반증: { 실행: 'node red.cjs {RED_ROOT}', 기대종료: 0 }, 인간검토: '불필요', 추가검토: [{ 종류: 'cold-read', 적용: '생략', 생략사유: 'Run Inspect tests the separate review projection' }] }] };
  assert.equal(await quietly(() => init({ task: 'code', contract: put('contract.json', contract) })), 0);
  await event('shape', { spec: put('spec.md', 'Return two with a test and a negative control.'), readiness: { decisions: [], criteria: [{ requirement: 'R1', when: 'loaded', actor: 'app', behavior: 'return two', observable: 'value 2', failure: 'different value', human: endpoint === 'local-commit' }] } });
  await event('bind', { binding: { task: 'code', contractSha256: open_task(root, 'code')[3], mapping: [{ request: 'R1', revision: 1, requirement: 'C1' }] } });
  await event('approve', { gate: 'shape', verdict: 'pass', source }); await event('transition', { stage: 'execute' });
  writeFileSync('app.cjs', 'module.exports=2;');
  const observation = put('execution.json', { actor: 'native-fixture-worker', host: 'codex', event: 'result' });
  const record = async (kind: string) => {
    const ctx = leafContext(load(c, 'change')) as any;
    await event('result', { output: put(kind + '.json', { kind, role: 'reviewer', verdict: 'pass', blockingFindings: [], requirements: ['R1'], basis: ctx.basis, targets: ctx.targets }), observation });
  };
  await record('implemented'); await event('transition', { stage: 'inspect' }); await record('review-approved'); await event('transition', { stage: 'prove' });
  assert.equal(await quietly(() => preflight({ task: 'code' })), 0);
  if (endpoint === 'local-commit') assert.equal(await quietly(() => verify({ task: 'code' })), 0);
  git('add', 'app.cjs');
  if (endpoint === 'local-commit') await assert.rejects(event('transition', { stage: 'release' }), /git-state-stale/);
  assert.equal(await quietly(() => verify({ task: 'code' })), 0);
  if (endpoint === 'local-commit') {
    await assert.rejects(event('transition', { stage: 'release' }), /human-acceptance-required:R1/);
    await event('approve', { gate: 'accepted:R1', verdict: 'pass', source });
  }
  await event('transition', { stage: 'release' });
  assert.equal(runStatus(c, load(c, 'change')).runComplete, false);
  const target = { parent: git('rev-parse', 'HEAD'), tree: git('write-tree') };
  await assert.rejects(event('invoke', { operation: 'commit', target }), /approval/);
  await event('approve', { gate: 'commit', verdict: 'pass', target, source });
  await event('invoke', { operation: 'commit', target });
  await assert.rejects(event('invoke', { operation: 'commit', target }), /readback/i);
  // Lost native response: do the commit, but only provider readback resolves it.
  git('commit', '-qm', 'Return two');
  assert.equal(Object.values(load(c, 'change').external)[0].state, 'unknown');
  await event('readback', { operation: 'commit' });
  assert.equal(Object.values(load(c, 'change').external)[0].state, 'present');
  assert.equal(runStatus(c, load(c, 'change')).runComplete, false);
  assert.equal(await quietly(() => verify({ task: 'code' })), 0);
  assess(c, { id: 'change', expectedRevision: load(c, 'change').revision, run: { id: 'run', coordinator: 'owner', epoch: 1 }, evidence: [{ requirement: 'R1', requirementRevision: 1, result: 'pass', method: 'workflow', rationale: 'Current positive and RED workflow evidence', artifacts: [path.join(root, 'app.cjs')], observer: 'fixture', workflow: { cwd: root, task: 'code', requirement: 'C1' } }] });
  return { c, root, home, put, git, event, source, runStatus, load };
}
