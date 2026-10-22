import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawnSync } from 'node:child_process';
import { init, record_review, review_evidence, contract_at, task_root, assess } from '../scripts/workflow.js';

test('review receipts detect correction cycles and retain coverage and staleness gates', t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jstack-review-receipts-'))), cwd = process.cwd();
  t.after(() => { process.chdir(cwd); fs.rmSync(root, { recursive: true, force: true }); });
  process.chdir(root);
  const git = spawnSync('git', ['init', '-q'], { cwd: root, encoding: 'utf8' }); assert.equal(git.status, 0, git.stderr);
  const put = (name: string, body: string) => fs.writeFileSync(path.join(root, name), body);
  put('app.cjs', 'module.exports=(a,b)=>a-b;');
  put('contract.yaml', JSON.stringify({
    '계약버전': 2, '작업ID': 'sum', '발동': '사용자', '위임': '불필요', '준비': [{ '도구': 'node', '확인명령': 'node --version' }],
    '산출': [{ '경로': 'app.cjs', '형식': 'JavaScript' }],
    '검증': [{ '요구ID': 'ADD-1', '사용자행동': 'Return the sum', '관련파일': ['app.cjs'], '등급': '기계',
      '명령': { '실행': 'node --version', '기대종료': 0 }, '반증': { '실행': 'node --version {RED_ROOT}', '기대종료': 0 },
      '인간검토': '불필요', '추가검토': [{ '종류': 'cold-read', '적용': '필요' }] }],
  }));
  const output = (call: () => number) => {
    const saved = console.log; let raw = ''; console.log = text => { raw += String(text); };
    try { assert.equal(call(), 0); } finally { console.log = saved; }
    return JSON.parse(raw);
  };
  output(() => init({ task: 'sum', contract: 'contract.yaml' }));
  put('blockers.json', JSON.stringify(['ADD-1.wrong-operation']));
  const record = (id: string, mode: 'broad' | 'focused' = 'broad', verdict = 'fail') => {
    put('review.txt', id + ': ADD-1 review result');
    return output(() => record_review({ task: 'sum', requirement: 'ADD-1', kind: 'cold-read', raw_output: 'review.txt', verdict, review_id: id, review_mode: mode, blocking_findings: verdict === 'fail' ? 'blockers.json' : undefined }));
  };
  const taskRoot = task_root(root, 'sum'), [contract, hash] = contract_at(taskRoot);
  assert.equal(record('r1').reviewCycle.action, 'review');
  put('app.cjs', 'module.exports=(a,b)=>a-b; // first correction');
  assert.equal(record('r2').reviewCycle.action, 'review');
  put('app.cjs', 'module.exports=(a,b)=>a-b; // second correction');
  const stalled = record('r3');
  assert.ok(stalled.reviewCycle.signals.includes('review-cycle'));
  assert.ok(stalled.reviewCycle.signals.includes('stalled-findings'));
  assert.equal(stalled.reviewCycle.action, 'reassess');
  assert.equal(assess(root, taskRoot, contract, hash).complete, false);
  assert.deepEqual(review_evidence(root, taskRoot, contract, hash)[1], ['ADD-1:cold-read']);
  put('app.cjs', 'module.exports=(a,b)=>a+b;');
  const focused = record('r4', 'focused', 'pass');
  assert.equal(focused.reviewCycle.signals.includes('review-cycle'), false);
  assert.deepEqual(review_evidence(root, taskRoot, contract, hash)[1], []);
  const stateFile = path.join(taskRoot, 'state.json'), before = fs.readFileSync(stateFile);
  assert.equal(record('r4', 'focused', 'pass').duplicate, true);
  assert.deepEqual(fs.readFileSync(stateFile), before, 're-import cannot invalidate a receipt');
  assert.equal(assess(root, taskRoot, contract, hash).complete, false, 'passing review alone cannot complete the workflow');
  assert.throws(() => record_review({ task: 'sum', requirement: 'ADD-1', kind: 'cold-read', raw_output: 'review.txt', verdict: 'pass', reviewed_file: ['review.txt'] }), /all files/);
  put('app.cjs', 'module.exports=(a,b)=>a-b;');
  assert.deepEqual(review_evidence(root, taskRoot, contract, hash)[1], ['ADD-1:cold-read']);
});
