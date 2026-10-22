import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CASES, evaluationContract, evaluate } from './routing_eval.js';
test('grading references are absent from executor completion instructions', () => {
  const contract = evaluationContract(false);
  assert.ok(!JSON.stringify(contract).includes('12'));
  assert.ok(!JSON.stringify(contract).includes('Exact answer'));
  assert.match(contract.verification, /separately held reference/);
  assert.ok(!CASES.find(c => c.id === 'extract')!.prompt.includes('12'));
  assert.match(evaluationContract(true).verification, /independent cases/);
});
test('evaluation rejects over-budget batches before creating artifacts or invoking models', async () => {
  await assert.rejects(evaluate([{ host: 'codex', model: 'unavailable' }], '/unused', 49), /limited/);
  await assert.rejects(evaluate([{ host: 'codex', model: 'unavailable' }], '/unused', 48, 3601), /limited/);
});
