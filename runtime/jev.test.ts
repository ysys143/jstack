import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { compareShadow, jevSettings, queryJev, questionFor, validateAnswer, validateJevState, type JevState } from './jev.js';

const state: JevState = { point: 'model-routing', kind: 'implement', impact: 'high', constraints: 'complex', access: 'workspace-write', attempt: 1,
  eligible: [{ id: 'alpha', host: 'codex', transport: 'native', contextTokens: 200000 }, { id: 'beta', host: 'claude', transport: 'native', contextTokens: 200000 }] };
const response = (choice = 'beta') => new Response(JSON.stringify({ model: 'jev-latest', usage: { input_tokens: 40, output_tokens: 2 },
  answers: { decision: { type: 'choice', choice, confidence: 0.8, probabilities: { alpha: 0.2, beta: 0.8 } } } }), { status: 200 });
const filesUnder = (root: string): string[] => readdirSync(root, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? filesUnder(join(root, entry.name)).map(path => join(entry.name, path)) : [entry.name]);

test('Jev requires a named point as well as a key; invalid activation and names send nothing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'jstack-jev-off-'));
  try {
    let requests = 0;
    const fetchFn = (async () => { requests++; return response(); }) as typeof fetch;
    for (const env of [{}, { TYPESAFE_API_KEY: 'fixture-secret' }, { TYPESAFE_API_KEY: 'fixture-secret', JSTACK_JEV: 'off' }]) {
      const result = await compareShadow(state, 'alpha', { workspace: root, stateHome: root, env, fetchFn });
      assert.deepEqual(result, { answer: 'alpha', source: 'twin', mode: 'off' });
    }
    assert.equal(requests, 0);
    assert.equal(filesUnder(root).length, 0);
    assert.throws(() => jevSettings({ JSTACK_JEV: 'unknown', TYPESAFE_API_KEY: 'fixture-secret' }), /unknown/);
    assert.throws(() => jevSettings({ JSTACK_JEV: 'model-routing', JSTACK_JEV_ACTIVE_POINTS: 'model-routing', TYPESAFE_API_KEY: 'fixture-secret' }), /shadow mode only/);
    assert.equal(requests, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('Jev state rejects prompt text, paths, extra fields, and unsafe candidate IDs', () => {
  validateJevState(state);
  assert.throws(() => validateJevState({ ...state, prompt: 'private text' } as JevState), /unapproved/);
  assert.throws(() => validateJevState({ ...state, eligible: [{ ...state.eligible[0]!, id: '/private/path' }] }), /unapproved/);
  assert.deepEqual(Object.keys(questionFor(state).criteria), ['alpha', 'beta']);
});

test('official lowercase Choice, Score, and Noul answers are validated', () => {
  const choice = questionFor(state);
  assert.equal(validateAnswer(choice, { type: 'choice', choice: 'alpha', confidence: 0.6, probabilities: { alpha: 0.6, beta: 0.4 } }).choice, 'alpha');
  assert.throws(() => validateAnswer(choice, { type: 'Choice', choice: 'alpha' }), /type/);
  assert.throws(() => validateAnswer(choice, { type: 'choice', choice: 'excluded', confidence: 1, probabilities: { alpha: 0, beta: 1 } }), /choice/);
  assert.equal(validateAnswer({ type: 'noul', instructions: 'Is it complete?', criteria: { true: 'yes', false: 'no' } }, { type: 'noul', noul: 0.7 }).noul, 0.7);
  assert.throws(() => validateAnswer({ type: 'noul', instructions: 'Question', criteria: { true: 'yes', false: 'no' } }, { type: 'noul', noul: 2 }), /noul/);
  assert.equal(validateAnswer({ type: 'score', instructions: 'How urgent?', criteria: ['low', 'high'] }, { type: 'score', score: 0.8, confidence: 0.9 }).score, 0.8);
  assert.throws(() => validateAnswer({ type: 'score', instructions: 'How urgent?', criteria: ['low', 'high'] }, { type: 'score', score: 2, confidence: 0.9 }), /score/);
});

test('the HTTP request follows the official schema and a shadow result never replaces the twin', async () => {
  const root = mkdtempSync(join(tmpdir(), 'jstack-jev-shadow-'));
  try {
    let body: any, authorization: string | null = null;
    const fetchFn = (async (_url: unknown, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      authorization = new Headers(init?.headers).get('Authorization');
      return response();
    }) as typeof fetch;
    const result = await compareShadow(state, 'alpha', { workspace: root, stateHome: root,
      env: { JSTACK_JEV: 'model-routing', TYPESAFE_API_KEY: 'fixture-secret', JSTACK_JEV_SESSION_ID: 'session-1' }, fetchFn });
    assert.deepEqual(result, { answer: 'alpha', source: 'twin', mode: 'shadow', jev: 'beta' });
    assert.equal(body.model, 'jev-latest');
    assert.equal(body.questions.decision.type, 'choice');
    assert.equal(body.state.point, 'model-routing');
    assert.equal(authorization, 'Bearer fixture-secret');
    const log = filesUnder(root).find(file=>file.endsWith('shadow.jsonl'))!;
    const contents = readFileSync(join(root, log), 'utf8');
    assert.match(contents, /"twin":"alpha"/);
    assert.doesNotMatch(contents, /fixture-secret|\/private\/|prompt|workspace-write.*alpha/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('request caps and circuit state survive separate hook processes', () => {
  const root = mkdtempSync(join(tmpdir(), 'jstack-jev-processes-'));
  try {
    const moduleUrl = new URL('./jev.js', import.meta.url).href;
    const program = `import { compareShadow } from ${JSON.stringify(moduleUrl)};
const state=${JSON.stringify(state)};
const fetchFn=async()=>new Response(JSON.stringify({model:'jev-latest',usage:{input_tokens:1,output_tokens:1},answers:{decision:{type:'choice',choice:'beta',confidence:0.8,probabilities:{alpha:0.2,beta:0.8}}}}),{status:process.env.FAIL==='1'?500:200});
const result=await compareShadow(state,'alpha',{workspace:process.argv[1],stateHome:process.argv[2],env:process.env,fetchFn});
console.log(result.mode);`;
    const call = (extra: Record<string, string>) => {
      const out = spawnSync(process.execPath, ['--input-type=module', '-e', program, root, root], { encoding: 'utf8', env: { ...process.env, JSTACK_JEV: 'model-routing', TYPESAFE_API_KEY: 'fixture-secret', JSTACK_JEV_SESSION_ID: 'session-1', ...extra } });
      assert.equal(out.status, 0, out.stderr);
      return out.stdout.trim();
    };
    assert.equal(call({ JSTACK_JEV_MAX_REQUESTS: '2' }), 'shadow');
    assert.equal(call({ JSTACK_JEV_MAX_REQUESTS: '2' }), 'shadow');
    assert.equal(call({ JSTACK_JEV_MAX_REQUESTS: '2' }), 'cap');
    assert.equal(call({ JSTACK_JEV_SESSION_ID: 'session-2', FAIL: '1' }), 'degraded');
    assert.equal(call({ JSTACK_JEV_SESSION_ID: 'session-2', FAIL: '1' }), 'degraded');
    assert.equal(call({ JSTACK_JEV_SESSION_ID: 'session-2', FAIL: '1' }), 'degraded');
    assert.equal(call({ JSTACK_JEV_SESSION_ID: 'session-2', FAIL: '1' }), 'circuit-open');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('timeout, malformed answer, and malformed budget degrade without leaking request data', async () => {
  const root = mkdtempSync(join(tmpdir(), 'jstack-jev-degrade-'));
  try {
    const env = { JSTACK_JEV: 'model-routing', TYPESAFE_API_KEY: 'fixture-secret', JSTACK_JEV_SESSION_ID: 'session-timeout', JSTACK_JEV_TIMEOUT_MS: '10' };
    const never = ((_: unknown, init?: RequestInit) => new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted fixture-secret'))))) as typeof fetch;
    const timeout = await compareShadow(state, 'alpha', { workspace: root, stateHome: root, env, fetchFn: never });
    assert.equal(timeout.mode, 'degraded');
    assert.equal(timeout.answer, 'alpha');
    assert.doesNotMatch(JSON.stringify(timeout), /fixture-secret/);
    const malformed = await compareShadow(state, 'alpha', { workspace: root, stateHome: root, env,
      fetchFn: (async () => new Response(JSON.stringify({ answers: { decision: { type: 'Choice', choice: 'beta' } } }), { status: 200 })) as typeof fetch });
    assert.equal(malformed.mode, 'degraded');
    const budget = filesUnder(root).find(file=>file.endsWith('budget.json'))!;
    writeFileSync(join(root, budget), '{broken');
    let requests = 0;
    const result = await compareShadow(state, 'alpha', { workspace: root, stateHome: root, env, fetchFn: (async () => { requests++; return response(); }) as typeof fetch });
    assert.equal(result.mode, 'degraded');
    assert.equal(requests, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
