import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { appendReview, reviewAdvice, checkReview, recordReview, type ReviewEvent } from './review_cycles.js';
import { capture, context, status } from './task_state.js';

function event(id: string, overrides: Partial<ReviewEvent> = {}): ReviewEvent {
  return { id, context: 'task-contract', purpose: 'Review AUTH-1', scopeHash: 'scope', inputHash: 'input', mode: 'broad', verdict: 'fail', resultHash: 'result', blockingFindings: ['AUTH-1.expiry'], ...overrides };
}
test('repeated unchanged purpose recommends reuse only after a recorded pass', () => {
  const initial = event('r1');
  assert.equal(reviewAdvice([], initial).action, 'review');
  assert.deepEqual(reviewAdvice([initial], event('r2')).signals, ['unchanged-review']);
  assert.equal(reviewAdvice([initial], event('r2')).action, 'focus');
  assert.equal(reviewAdvice([event('r1', { verdict: 'pass', blockingFindings: [] })], event('r2')).action, 'reuse');
  assert.equal(reviewAdvice([initial], event('r2', { inputHash: 'changed' })).action, 'review');
  assert.equal(reviewAdvice([initial], event('r2', { purpose: 'Review BUDGET-1' })).action, 'review');
  assert.equal(reviewAdvice([initial], event('r2', { context: 'amended-contract' })).action, 'review');
  assert.equal(reviewAdvice([initial], event('r2', { scopeHash: 'another-scope' })).action, 'review');
});
test('broad review cycles survive edits and scope growth while focused verification remains available', () => {
  const history = [event('r1'), event('r2', { inputHash: 'fix-1', scopeHash: 'expanded' })];
  const next = event('r3', { inputHash: 'fix-2', scopeHash: 'expanded-again' });
  assert.equal(reviewAdvice(history, next).action, 'focus');
  assert.deepEqual(reviewAdvice(history, next).signals, ['review-cycle']);
  assert.equal(reviewAdvice(history, { ...next, mode: 'focused' }).action, 'review');
  assert.equal(reviewAdvice(history, { ...next, context: 'new-requirements' }).action, 'review');
  const passed = event('r3', { inputHash: 'fixed', verdict: 'pass', blockingFindings: [] });
  assert.equal(reviewAdvice([...history, passed], event('r4', { inputHash: 'next-change' })).broadRounds, 0);
});
test('stable blockers identify stalled corrections even with focused reviews and different bytes', () => {
  const history = [event('r1'), event('r2', { inputHash: 'fix-1', mode: 'focused' })];
  const next = event('r3', { inputHash: 'fix-2', mode: 'focused' });
  const advice = reviewAdvice(history, next, next.blockingFindings);
  assert.equal(advice.action, 'reassess');
  assert.deepEqual(advice.blockingFindings, ['AUTH-1.expiry']);
  assert.equal(reviewAdvice(history, next, ['new-regression']).action, 'review');
  assert.equal(reviewAdvice(history, next, []).action, 'review');
});
test('duplicate delivery is idempotent and conflicting identities and malformed results are rejected', () => {
  const first = event('r1'), history = appendReview([], first).history;
  const replay = appendReview(history, first);
  assert.equal(replay.duplicate, true); assert.equal(replay.history.length, 1);
  assert.throws(() => appendReview(history, { ...first, resultHash: 'different' }), /already binds/);
  assert.throws(() => appendReview([], event('r1', { verdict: 'pass' })), /unresolved/);
  assert.throws(() => appendReview([], event('r1', { blockingFindings: ['same', 'same'] })), /Duplicate/);
  assert.throws(() => appendReview([], event('r1', { mode: 'anything' as any })), /mode/);
  assert.throws(() => appendReview([], event('r1', { resultHash: '' })), /result hash/);
});

function fixture(t: any) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jstack-review-cycle-')));
  const home = path.join(root, 'home'); fs.mkdirSync(home);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'SKILL.md'), '# Original executable instruction');
  fs.writeFileSync(path.join(root, 'config.json'), '{}');
  fs.writeFileSync(path.join(root, 'review.txt'), 'AUTH-1.expiry: fails to expire');
  const c = context(root, home);
  const task = capture(c, { id: 'review-task', expectedRevision: 0, purpose: 'Fix expiry', source: { role: 'user', message: 'u1', quote: 'Fix expiry' }, requirements: [{ id: 'AUTH-1', text: 'Expire the session', kind: 'code' }] });
  const input = { purpose: 'Review AUTH-1', files: ['SKILL.md', 'config.json'], mode: 'broad' };
  const checked = checkReview(c, task.id, input);
  const result = { ...input, id: 'host-delivery-1', rawOutput: 'review.txt', verdict: 'fail', blockingFindings: ['AUTH-1.expiry'], expectedContext: checked.context, expectedInputHash: checked.inputHash, expectedScopeHash: checked.scopeHash };
  return { root, home, c, task, input, checked, result };
}
test('private records hash Markdown and canonical scope and never complete the request', t => {
  const f = fixture(t);
  assert.equal(checkReview(f.c, f.task.id, { ...f.input, files: [...f.input.files].reverse() }).inputHash, f.checked.inputHash);
  recordReview(f.c, f.task.id, f.result);
  assert.equal(recordReview(f.c, f.task.id, f.result).duplicate, true);
  assert.equal(checkReview(f.c, f.task.id, f.input).advice.action, 'focus');
  assert.equal(status(f.c, f.task).complete, false);
  fs.writeFileSync(path.join(f.root, 'SKILL.md'), '# Changed executable instruction');
  assert.notEqual(checkReview(f.c, f.task.id, f.input).inputHash, f.checked.inputHash);
  assert.throws(() => recordReview(f.c, f.task.id, f.result), /changed/);
});
test('missing evidence, scope escapes, duplicate aliases and changed requirements cannot stand in for a review', t => {
  const f = fixture(t);
  assert.throws(() => recordReview(f.c, f.task.id, { ...f.result, rawOutput: 'missing.txt' }), /ENOENT/);
  fs.writeFileSync(path.join(f.root, 'empty.txt'), '');
  assert.throws(() => recordReview(f.c, f.task.id, { ...f.result, rawOutput: 'empty.txt' }), /empty/);
  assert.throws(() => checkReview(f.c, f.task.id, { ...f.input, files: ['../outside'] }), /scope/);
  assert.throws(() => checkReview(f.c, f.task.id, { ...f.input, files: ['SKILL.md', './SKILL.md'] }), /Duplicate/);
  assert.throws(() => checkReview(f.c, f.task.id, { ...f.input, files: [] }), /required/);
  capture(f.c, { id: f.task.id, expectedRevision: 1, source: { role: 'user', message: 'u2', quote: 'Also revoke tokens' }, requirements: [{ id: 'AUTH-1', text: 'Expire and revoke tokens', kind: 'code' }] });
  assert.throws(() => recordReview(f.c, f.task.id, f.result), /changed/);
  assert.notEqual(checkReview(f.c, f.task.id, f.input).context, f.checked.context);
});
test('a missing or altered previous passing result cannot recommend reuse', t => {
  const f = fixture(t);
  recordReview(f.c, f.task.id, { ...f.result, verdict: 'pass', blockingFindings: [] });
  assert.equal(checkReview(f.c, f.task.id, f.input).advice.action, 'reuse');
  fs.writeFileSync(path.join(f.root, 'review.txt'), 'altered result');
  assert.equal(checkReview(f.c, f.task.id, f.input).advice.action, 'review');
  fs.unlinkSync(path.join(f.root, 'review.txt'));
  assert.equal(checkReview(f.c, f.task.id, f.input).advice.action, 'review');
});
test('jst review command checks and records a real nonempty result through the public CLI', t => {
  const f = fixture(t), cli = fileURLToPath(new URL('../cli/main.js', import.meta.url));
  const inputFile = path.join(f.root, 'input.json');
  const call = (action: string, input: any) => {
    fs.writeFileSync(inputFile, JSON.stringify(input));
    const run = spawnSync(process.execPath, [cli, 'review', action, f.task.id, '--workspace', f.root, '--home', f.home, '--input', inputFile], { encoding: 'utf8', timeout: 5000 });
    assert.equal(run.status, 0, run.stderr); return JSON.parse(run.stdout);
  };
  assert.equal(call('check', f.input).advice.action, 'review');
  assert.equal(call('record', f.result).duplicate, false);
  assert.equal(call('check', f.input).advice.action, 'focus');
});
