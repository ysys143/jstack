import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, mkdirSync, chmodSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { select, contextKey, validateDecision, type RouteRequest, type Candidate } from './routing.js';
import { runDecision, record, createFileHash, cliInvocation, changedOutside, recordRouteShadow } from './route_cli.js';
import { check_description } from '../skills/_suite_lib.js';

const candidate = (id: string, overrides: Partial<Candidate> = {}): Candidate => ({ id, model: id, host: 'codex', transport: 'native', available: true, tools: ['Read'], access: ['read-only', 'workspace-write'], contextTokens: 32000, efforts: ['low', 'medium', 'high'], contextModes: ['fresh'], runtimeVersion: 'test-host-1', ...overrides });
const request = (overrides: Partial<RouteRequest> = {}): RouteRequest => ({ schemaVersion: 1, taskId: 'fixture', kind: 'extract', prompt: 'Extract the count.', deliverable: 'Exact count', verification: 'Compare with fixture count', cwd: tmpdir(), ownedFiles: [], access: 'read-only', tools: ['Read'], contextTokens: 1000, contextMode: 'fresh', impact: 'low', constraints: 'simple', delegationAllowed: true, allowedTransports: ['native', 'cli'], candidates: [candidate('luna'), candidate('astra')], inheritedCandidate: 'luna', priority: ['luna', 'astra'], timeoutSeconds: 60, ...overrides });
test('names are opaque, native wins and explicit selection is not substituted', () => {
  const r = request({ candidates: [candidate('custom'), candidate('cheap', { transport: 'cli' })], inheritedCandidate: 'cheap', priority: ['cheap', 'custom'] });
  assert.equal(select(r).selected?.model, 'custom');
  assert.equal(select({ ...r, requestedModel: 'missing' }).state, 'unavailable');
  assert.equal(select({ ...r, delegationAllowed: false }).state, 'local');
  assert.equal(select(request({ inheritedCandidate: undefined, priority: undefined })).state, 'unavailable');
});
test('Jev shadow sees only eligible route IDs and never changes the emitted route', async () => {
  const home = mkdtempSync(join(tmpdir(), 'jstack-route-jev-'));
  try {
    const r = request({ cwd: home, candidates: [candidate('luna'), candidate('astra'), candidate('excluded', { available: false })] });
    const decision = select(r), before = JSON.stringify(decision);
    let sent: any, calls = 0;
    const fetchFn = (async (_url: unknown, init?: RequestInit) => {
      calls++; sent = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ model: 'jev-latest', usage: { input_tokens: 20, output_tokens: 1 },
        answers: { decision: { type: 'choice', choice: 'astra', confidence: 0.7, probabilities: { luna: 0.3, astra: 0.7 } } } }));
    }) as typeof fetch;
    const shadow = await recordRouteShadow(decision, { stateHome: home, env: { JSTACK_JEV: 'model-routing', TYPESAFE_API_KEY: 'fixture-key' }, fetchFn });
    assert.equal(shadow?.answer, 'luna');
    assert.equal(shadow?.jev, 'astra');
    assert.equal(JSON.stringify(decision), before);
    assert.deepEqual(sent.state.eligible.map((row: any) => row.id), ['luna', 'astra']);
    assert.deepEqual(Object.keys(sent.questions.decision.criteria), ['luna', 'astra']);
    assert.equal(calls, 1);
    const measured = request({ cwd: home });
    measured.candidates[0]!.measurement = { reviewed: true, contextKey: contextKey(measured, measured.candidates[0]!), samples: 10, successes: 9 };
    assert.equal(await recordRouteShadow(select(measured), { stateHome: home, env: { JSTACK_JEV: 'model-routing', TYPESAFE_API_KEY: 'fixture-key' }, fetchFn }), undefined);
    assert.equal(calls, 1);
    assert.equal(await recordRouteShadow(select(request({ cwd: home, candidates: [candidate('only')], inheritedCandidate: 'only', priority: ['only'] })),
      { stateHome: home, env: { JSTACK_JEV: 'model-routing', TYPESAFE_API_KEY: 'fixture-key' }, fetchFn }), undefined);
    assert.equal(calls, 1);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
test('the public route plan entrypoint reaches Jev only with a point opt-in', () => {
  const home = mkdtempSync(join(tmpdir(), 'jstack-route-entry-jev-'));
  try {
    const file = join(home, 'request.json'), capture = join(home, 'request-capture.json');
    writeFileSync(file, JSON.stringify(request({ cwd: home, candidates: [candidate('luna'), candidate('astra'), candidate('excluded', { available: false })] })));
    const cliUrl = new URL('./route_cli.js', import.meta.url).href;
    const script = `import { writeFileSync } from 'node:fs';
globalThis.fetch = async (_url, init) => {
  writeFileSync(process.env.JSTACK_JEV_CAPTURE, String(init.body));
  return new Response(JSON.stringify({model:'jev-latest',usage:{input_tokens:1,output_tokens:1},answers:{decision:{type:'choice',choice:'astra',confidence:0.8,probabilities:{luna:0.2,astra:0.8}}}}));
};
const { main } = await import(${JSON.stringify(cliUrl)});
process.exitCode = await main(['plan','--request',process.argv[1]]);`;
    const invoke = (point: string | undefined) => spawnSync(process.execPath, ['--input-type=module', '-e', script, file], {
      encoding: 'utf8', env: { ...process.env, JSTACK_JEV: point ?? '', TYPESAFE_API_KEY: 'fixture-key', XDG_STATE_HOME: home, JSTACK_JEV_CAPTURE: capture }, timeout: 60000,
    });
    const disabled = invoke(undefined);
    assert.equal(disabled.status, 0, disabled.error?.message ?? disabled.stderr);
    assert.equal(readFileSync(file, 'utf8').includes('fixture-key'), false);
    assert.equal(existsSync(capture), false);
    const enabled = invoke('model-routing');
    assert.equal(enabled.status, 0, enabled.error?.message ?? enabled.stderr);
    assert.equal(JSON.parse(disabled.stdout).selected.id, JSON.parse(enabled.stdout).selected.id);
    const sent = JSON.parse(readFileSync(capture, 'utf8'));
    assert.deepEqual(sent.state.eligible.map((row: any) => row.id), ['luna', 'astra']);
    assert.equal(JSON.stringify(sent).includes('Extract the count.'), false);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
test('each required capability and limit excludes an otherwise preferred model', () => {
  for (const change of [{ available: false }, { tools: [] }, { access: [] }, { contextTokens: 10 }, { contextModes: [] }, { efforts: [] }]) {
    const d = select(request({ effort: 'medium', candidates: [candidate('luna', change), candidate('astra')] }));
    assert.equal(d.selected?.model, 'astra', JSON.stringify(change)); assert.equal(d.excluded[0].id, 'luna');
  }
  assert.equal(select(request({ maxCost: 1 })).state, 'unavailable');
  assert.throws(() => select(request({ timeoutSeconds: Infinity })), /limits/);
  assert.throws(() => select(request({ access: 'workspace-write', ownedFiles: ['../x'] })), /relative/);
});
test('reviewed comparable evidence outranks inheritance; unknown price is not zero', () => {
  const r = request();
  r.candidates[0].measurement = { reviewed: true, contextKey: contextKey(r, r.candidates[0]), samples: 10, successes: 9 };
  r.candidates[1].measurement = { reviewed: true, contextKey: contextKey(r, r.candidates[1]), samples: 10, successes: 9, cost: 1 };
  assert.equal(select(r).selected?.model, 'astra');
  r.candidates[1].measurement.contextKey = 'different-environment';
  assert.equal(select(r).selected?.model, 'luna');
  r.candidates[0].measurement.samples = 1;
  assert.throws(() => select(r), /one run/);
});
test('effort and guidance follow task constraints, not model names', () => {
  const d = select(request({ constraints: 'complex', effort: 'low' }));
  assert.equal(d.effort, 'low'); assert.deepEqual(d.guidance, ['core', 'constraint-checklist']);
  d.request.prompt = 'tampered'; assert.throws(() => validateDecision(d), /integrity/);
});
test('CLI calls use literal argv and preserve read-only restrictions', () => {
  const r = request({ candidates: [candidate('luna', { transport: 'cli' })], priority: ['luna'] });
  assert.deepEqual(cliInvocation(select(r)).args.slice(0, 3), ['exec', '--sandbox', 'read-only']);
  const claude = select({ ...r, candidates: [candidate('luna', { transport: 'cli', host: 'claude' })] });
  const args = cliInvocation(claude).args;
  assert.ok(args.includes('dontAsk')); assert.ok(args.includes('--strict-mcp-config')); assert.ok(!args.includes('--dangerously-skip-permissions'));
  assert.equal(select({ ...r, access: 'workspace-write', ownedFiles: ['x'], candidates: [candidate('luna', { transport: 'cli', host: 'claude' })] }).state, 'unavailable');
  assert.deepEqual(changedOutside({ x: 'a', y: 'b' }, { x: 'c', y: 'z' }, ['x']), ['y']);
});
test('native reservation, hash-bound verification and exactly one transition', async () => {
  const home = mkdtempSync(join(tmpdir(), 'jstack-route-test-'));
  try {
    const d = select(request());
    const started = await runDecision(d, home); assert.equal(started.state, 'native-required');
    await assert.rejects(runDecision(d, home), /Duplicate/);
    const file = join(home, 'check.txt'); writeFileSync(file, 'failing verification output');
    const evidence = [{ path: file, sha256: createFileHash(file) }];
    assert.throws(() => record(d, { decisionId: d.id, status: 'passed', actualModel: 'unknown', evidence: [] }, home), /artifacts/);
    const transition = record(d, { decisionId: d.id, status: 'verification-failed', actualModel: 'luna', evidence }, home);
    assert.equal(transition.state, 'transition');
    const next = ('decision' in transition ? transition.decision : undefined)!;
    assert.equal(next.selected?.model, 'astra'); assert.equal(next.attempt, 2);
    await runDecision(next, home);
    writeFileSync(file, 'second failing verification output'); evidence[0].sha256 = createFileHash(file);
    assert.equal(record(next, { decisionId: next.id, status: 'verification-failed', actualModel: 'astra', evidence }, home).state, 'incomplete');
    assert.throws(() => record(next, { decisionId: next.id, status: 'passed', actualModel: 'astra', evidence }, home), /duplicate/);
    await assert.rejects(runDecision(next, home), /exhausted/);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
test('a 0755 shared ~/.jstack parent is accepted while routing stays private', { skip: process.platform === 'win32' }, async () => {
  const home = mkdtempSync(join(tmpdir(), 'jstack-route-shared-'));
  try {
    const root = join(home, '.jstack'), dir = join(root, 'routing');
    mkdirSync(root); chmodSync(root, 0o755);
    const d = select(request());
    assert.equal((await runDecision(d, home)).state, 'native-required');
    assert.equal(statSync(root).mode & 0o777, 0o755);
    assert.equal(statSync(dir).mode & 0o777, 0o700);
    assert.equal(statSync(join(dir, 'fixture.json')).mode & 0o777, 0o600);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
test('an existing shared parent without write bits for group and others is accepted unchanged', { skip: process.platform === 'win32' }, async () => {
  const home = mkdtempSync(join(tmpdir(), 'jstack-route-shared-'));
  try {
    const root = join(home, '.jstack'), dir = join(root, 'routing');
    mkdirSync(root);
    for (const mode of [0o750, 0o700]) {
      chmodSync(root, mode);
      const taskId = `shared-${mode.toString(8)}`;
      assert.equal((await runDecision(select(request({ taskId })), home)).state, 'native-required', mode.toString(8));
      assert.equal(statSync(root).mode & 0o777, mode);
      assert.equal(statSync(dir).mode & 0o777, 0o700);
    }
  } finally { rmSync(home, { recursive: true, force: true }); }
});
test('a group- or other-writable shared parent, or a non-private routing directory, is rejected', { skip: process.platform === 'win32' }, async () => {
  const home = mkdtempSync(join(tmpdir(), 'jstack-route-shared-'));
  try {
    const root = join(home, '.jstack'), dir = join(root, 'routing');
    mkdirSync(root);
    for (const mode of [0o775, 0o777, 0o757]) {
      chmodSync(root, mode);
      await assert.rejects(runDecision(select(request()), home), /not be writable by group or others/, mode.toString(8));
      assert.equal(existsSync(dir), false);
    }
    chmodSync(root, 0o755); mkdirSync(dir); chmodSync(dir, 0o755);
    await assert.rejects(runDecision(select(request()), home), /permissions must be 0700/);
    assert.equal(statSync(dir).mode & 0o777, 0o755);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
test('explicit model fallback needs permission; environment failures never escalate', async () => {
  assert.equal(select(request({ requestedModel: 'luna' }), { attempt: 2, failedModel: 'luna' }).state, 'unavailable');
  assert.equal(select(request({ requestedModel: 'luna', allowedFallbackModels: ['astra'] }), { attempt: 2, failedModel: 'luna' }).selected?.model, 'astra');
  const home = mkdtempSync(join(tmpdir(), 'jstack-route-test-'));
  try {
    const d = select(request()); await runDecision(d, home);
    assert.equal(record(d, { decisionId: d.id, status: 'environment-failed', actualModel: 'unknown', evidence: [] }, home).state, 'incomplete');
    const ledger = JSON.parse(readFileSync(join(home, '.jstack/routing/fixture.json'), 'utf8'));
    assert.equal(ledger.entries.length, 1); assert.equal(ledger.entries[0].next, undefined);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
test('short descriptions and equivalent frontmatter formatting pass; empty metadata fails', () => {
  for (const fm of ['name: migration\ndescription: Apply schema migrations.', 'name: migration\ndescription: >-\n  Apply schema migrations.']) {
    const verdicts: boolean[] = []; check_description((_name, ok) => verdicts.push(ok), tmpdir(), fm);
    assert.deepEqual(verdicts, [true]);
  }
  for (const fm of ['name: migration\ndescription:', 'name: migration\ndescription: >-', 'name: migration\ndescription:\nother: not-a-description', 'description: Apply schema migrations.']) {
    const verdicts: boolean[] = []; check_description((_name, ok) => verdicts.push(ok), tmpdir(), fm);
    assert.equal(verdicts[0], false, fm);
  }
});
test('budget exhaustion, changed evidence and model mismatch cannot become success', async () => {
  const home = mkdtempSync(join(tmpdir(), 'jstack-route-test-'));
  try {
    const d = select(request()); await runDecision(d, home);
    const file = join(home, 'evidence'); writeFileSync(file, 'fresh check');
    const evidence = [{ path: file, sha256: createFileHash(file) }];
    writeFileSync(file, 'changed');
    assert.throws(() => record(d, { decisionId: d.id, status: 'passed', actualModel: 'unknown', evidence }, home), /hash mismatch/);
    evidence[0].sha256 = createFileHash(file);
    assert.equal(record(d, { decisionId: d.id, status: 'passed', actualModel: 'other', evidence }, home).state, 'incomplete');
    const d2 = select(request({ taskId: 'time-budget' })); await runDecision(d2, home);
    const path = join(home, '.jstack/routing/time-budget.json'); const state = JSON.parse(readFileSync(path, 'utf8'));
    state.startedAt -= 120000; writeFileSync(path, JSON.stringify(state));
    writeFileSync(file, 'fresh failure'); evidence[0].sha256 = createFileHash(file);
    const result = record(d2, { decisionId: d2.id, status: 'verification-failed', actualModel: 'unknown', evidence }, home);
    assert.equal(result.state, 'incomplete'); assert.match(result.reason!, /budget/);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
test('public jst route entrypoint reports a failed CLI invocation as nonzero', { skip: process.platform === 'win32' }, () => {
  const home = mkdtempSync(join(tmpdir(), 'jstack-route-cli-'));
  try {
    const bin = join(home, 'bin'); mkdirSync(bin);
    const stub = join(bin, 'codex');
    writeFileSync(stub, `#!${process.execPath}\nif(process.argv.includes('--version'))console.log('test-1');else if(process.argv.includes('--help'))console.log('--model --sandbox');else {console.error('provider unavailable');process.exitCode=7;}\n`);
    chmodSync(stub, 0o755);
    const d = select(request({ cwd: home, candidates: [candidate('luna', { transport: 'cli' })], priority: ['luna'] }));
    const file = join(home, 'decision.json'); writeFileSync(file, JSON.stringify(d));
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../cli/main.js', import.meta.url)), 'route', 'run', '--decision', file, '--home', home], { encoding: 'utf8', env: { ...process.env, PATH: bin }, timeout: 10000 });
    assert.equal(result.status, 1, result.stderr);
    assert.equal(JSON.parse(result.stdout).exitCode, 7);
    assert.match(JSON.parse(result.stdout).error, /provider unavailable/);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
