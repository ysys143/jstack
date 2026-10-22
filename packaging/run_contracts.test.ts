import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseContractArgs, selectionFromPlan } from './run_contracts.js';

const checkout = { head: 'a'.repeat(40), tree: 'b'.repeat(40), clean: true };
const plan = { schemaVersion: 1, mode: 'enforce', scope: 'scoped', execution: 'selected', head: 'HEAD', headCommit: checkout.head, headTree: checkout.tree, selectedSuites: ['dashboard', 'tests/test_contracts.py'] };

test('contract plans select only the bound clean checkout and shadow always runs full', () => {
  assert.deepEqual(selectionFromPlan(plan, checkout).selected, plan.selectedSuites);
  for (const changed of [{ ...checkout, clean: false }, { ...checkout, head: 'c'.repeat(40) }, { ...checkout, tree: 'd'.repeat(40) }]) {
    assert.deepEqual(selectionFromPlan(plan, changed).selected, []);
  }
  assert.deepEqual(selectionFromPlan({ ...plan, mode: 'shadow', execution: 'full' }, checkout).selected, []);
  assert.deepEqual(selectionFromPlan({ ...plan, scope: 'full', execution: 'full' }, checkout).selected, []);
  assert.deepEqual(selectionFromPlan({ ...plan, scope: 'full', execution: 'full', selectedSuites: [], headCommit: null, headTree: null }, checkout).selected, []);
});

test('malformed, empty, duplicate or contradictory selection plans cannot reduce coverage', () => {
  for (const invalid of [null, {}, { ...plan, schemaVersion: 2 }, { ...plan, selectedSuites: [] },
    { ...plan, selectedSuites: ['../outside'] }, { ...plan, selectedSuites: ['dashboard', 'dashboard'] },
    { ...plan, mode: 'shadow' }, { ...plan, scope: 'full' }]) {
    assert.throws(() => selectionFromPlan(invalid, checkout));
  }
});

test('contract CLI keeps explicit selectors separate from plans and requires option values', () => {
  assert.deepEqual(parseContractArgs(['dashboard', '--output', '/tmp/out', '--timing-history', '/tmp/history']), {
    selected: ['dashboard'], output: '/tmp/out', timingHistory: '/tmp/history',
  });
  assert.deepEqual(parseContractArgs(['--plan', '/tmp/plan']), { selected: [], planFile: '/tmp/plan' });
  assert.deepEqual(parseContractArgs(['--deletion']), { selected: [], deletion: true });
  assert.equal(parseContractArgs(['dashboard']).deletion, undefined);
  for (const args of [['--plan'], ['--output', '--plan'], ['--unknown'], ['dashboard', '--plan', '/tmp/plan'], ['--deletion', '--quick', '--plan', '/tmp/plan']]) {
    assert.throws(() => parseContractArgs(args));
  }
});
