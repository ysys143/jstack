import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compareTaskSize, parseTaskSize } from './jev_cli.js';
import { questionFor } from './jev.js';

const args = ['task-size', '--decision', 'parallel', '--work-type', 'coding', '--impact', 'high', '--constraints', 'complex',
  '--changed-files', '3', '--independent-parts', '2', '--delegation-allowed', 'true'];
const filesUnder = (root: string): string[] => readdirSync(root, { withFileTypes: true }).flatMap(entry =>
  entry.isDirectory() ? filesUnder(join(root, entry.name)).map(path => join(entry.name, path)) : [entry.name]);

test('task-size command compares the actual chosen shape only at a valid decision boundary', () => {
  const input = parseTaskSize(args, tmpdir());
  assert.equal(input.decision, 'parallel');
  assert.equal(input.state.independentPartCount, 2);
  assert.deepEqual(Object.keys(questionFor(input.state).criteria), ['local', 'single', 'parallel']);
  assert.throws(() => parseTaskSize([...args, '--prompt', 'private text']), /invalid/);
  assert.throws(() => parseTaskSize([...args, '--changed-files', '4']), /repeated/);
  assert.throws(() => parseTaskSize(args.map(value => value === 'coding' ? 'unknown' : value)), /work-type/);
  assert.throws(() => parseTaskSize(args.map(value => value === '2' ? '0' : value)), /authorized execution choices/);
  const noDelegation = parseTaskSize(['task-size', '--decision', 'local', '--work-type', 'coding', '--impact', 'low', '--constraints', 'simple',
    '--changed-files', '1', '--independent-parts', '2', '--delegation-allowed', 'false']);
  assert.deepEqual(Object.keys(questionFor(noDelegation.state).criteria), ['local']);
  assert.throws(() => parseTaskSize(['task-size', '--decision', 'single', '--work-type', 'coding', '--impact', 'low', '--constraints', 'simple',
    '--changed-files', '1', '--independent-parts', '2', '--delegation-allowed', 'false']), /authorized/);
});

test('task-size is zero-egress by default and shadow never changes the chosen shape', async () => {
  const root = mkdtempSync(join(tmpdir(), 'jstack-task-size-'));
  try {
    const input = parseTaskSize([...args, '--workspace', root]);
    let calls = 0, sent: any;
    const fetchFn = (async (_url: unknown, init?: RequestInit) => {
      calls++; sent = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ model: 'jev-latest', usage: { input_tokens: 1, output_tokens: 1 }, answers: { decision: {
        type: 'choice', choice: 'single', confidence: 0.8, probabilities: { local: 0.1, single: 0.8, parallel: 0.1 },
      } } }), { status: 200 });
    }) as typeof fetch;
    const stateHome = join(root, 'state');
    for (const env of [{}, { TYPESAFE_API_KEY: 'fixture-key' }, { JSTACK_JEV: 'task-size' }]) {
      const result = await compareTaskSize(input, { env, stateHome, fetchFn });
      assert.equal(result.answer, 'parallel');
      assert.equal(result.mode, 'off');
    }
    assert.equal(calls, 0);
    assert.equal(existsSync(stateHome), false);
    const localOnly = parseTaskSize(['task-size', '--decision', 'local', '--work-type', 'daily', '--impact', 'low', '--constraints', 'simple',
      '--changed-files', '0', '--independent-parts', '0', '--delegation-allowed', 'false', '--workspace', root]);
    const trivial = await compareTaskSize(localOnly, { env: { JSTACK_JEV: 'task-size', TYPESAFE_API_KEY: 'fixture-key' }, stateHome, fetchFn });
    assert.equal(trivial.mode, 'off');
    assert.equal(calls, 0);
    const shadow = await compareTaskSize(input, { env: { JSTACK_JEV: 'task-size', TYPESAFE_API_KEY: 'fixture-key' }, stateHome, fetchFn });
    assert.equal(shadow.answer, 'parallel');
    assert.equal(shadow.jev, 'single');
    assert.equal(calls, 1);
    assert.deepEqual(sent.state, input.state);
    assert.equal(JSON.stringify(sent).includes(root), false);
    const log = filesUnder(stateHome).find(path => path.endsWith('shadow.jsonl'))!;
    assert.doesNotMatch(readFileSync(join(stateHome, log), 'utf8'), /fixture-key|private text/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
