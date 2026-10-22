import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as profiler from '../skills/public/workflow/verify/scripts/test_profile.js';
import type { Options, Report, Row, RunResult } from '../skills/public/workflow/verify/scripts/test_profile.js';

const options: Options = { cmd: 'node {file}', units: [], workers: 1, timeout: 1, top: 10,
  repeat: 1, waitingRatio: 0.35, waitingMinSeconds: 0.2, failOnWaiting: true };
const sample = (wall: number, cpu: number | null, exit: RunResult['exit'] = 0): RunResult => ({ wall, cpu, exit, stderrTail: exit === 0 ? '' : 'fixture failed' });
function report(rows: Row[], changes: Partial<Options> = {}): Report {
  return profiler.reportRows(rows, { ...options, ...changes }, 0.1, 2);
}

test('captured CI scheduling does not change the expected CPU classification', () => {
  const rows = [['ci-busy', 0.545, 0.162, true], ['dedicated-busy', 0.45, 0.4, false], ['sleepy', 0.52, 0.034, true]] as const;
  const measured = rows.map(([name, wall, cpu, waiting]) => {
    const row = profiler.summarize(name, [sample(wall, cpu)], options);
    assert.equal(row.waiting, waiting);
    return row;
  });
  const result = report(measured);
  assert.equal(result.code, 1);
  assert.deepEqual(result.json.waiting_units, ['ci-busy', 'sleepy']);
  assert.equal(result.violations.length, 2);
  assert.match(result.lines.join('\n'), /ci-busy: WAITING/);
});

test('waiting and duration boundaries use unrounded measurements', () => {
  for (const [wall, cpu, expected] of [[1, 0.35, false], [1, 0.3499, true], [0.1999, 0, false], [0.2, 0, true]] as const) {
    assert.equal(profiler.summarize('boundary', [sample(wall, cpu)], options).waiting, expected);
  }
  const exact = profiler.summarize('exact', [sample(1, 1)], { ...options, maxSeconds: 1 });
  assert.equal(report([exact], { maxSeconds: 1 }).code, 0);
  const over = profiler.summarize('over', [sample(1.0001, 1)], { ...options, maxSeconds: 1 });
  assert.equal(report([over], { maxSeconds: 1 }).code, 1);
});

test('CPU unavailability, process failure, timeout, and mixed repeat outcomes retain distinct evidence', () => {
  const unknown = profiler.summarize('unknown', [sample(2, null)], options);
  assert.equal(unknown.waiting, null);
  assert.equal(report([unknown]).code, 2);
  assert.equal(report([unknown], { failOnWaiting: false }).code, 0);
  for (const exit of [3, 'timeout', 'error'] as const) {
    const failed = profiler.summarize('failed', [sample(1, 1, exit)], options);
    assert.equal(report([failed]).code, 1);
    assert.equal(failed.exit, exit);
    assert.equal(failed.stderr_tail, 'fixture failed');
  }
  const mixed = profiler.summarize('mixed', [sample(1, 1), sample(0.5, 0.5, 3)], options);
  const result = report([mixed]);
  assert.equal(mixed.flaky, true);
  assert.equal(mixed.runs, 2);
  assert.match(result.lines.join('\n'), /FLAKY/);
});
