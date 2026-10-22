import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareMeasurements, parseMeasurement } from './check_floor_parity.js';
const floor = '[PASS] 계약 커버리지: references/example.md — 3건 실패 (하한 3)\n';
test('measured floor cannot pass without a clean baseline and exact population', () => {
  assert.equal(compareMeasurements({skill:floor+'4/4 통과\n'}, {skill:1}).passed, true);
  for (const output of [floor+'3/4 통과\n', floor, '0/0 통과\n', 'Ran 0 tests\nOK\n', '4/4 통과\n', floor.replace('하한 3', '하한 2')+'4/4 통과\n']) assert.equal(compareMeasurements({skill:output}, {skill:1}).passed, false);
  assert.equal(compareMeasurements({skill:floor+'3/4 통과\n1/1 통과\n'}, {skill:1}).passed, true, 'a raw single-suite transcript uses its final verdict');
  assert.equal(compareMeasurements({}, {}).passed, false);
  assert.equal(compareMeasurements({skill:floor+'4/4 통과\n'}, {}).passed, false);
});
test('framed processes cannot hide a failed, missing, nested, or nonzero-exit suite', () => {
  const frame = (body: string, code = 0) => `@@jstack-suite-begin\n${body}\n@@jstack-suite-end ${code}\n`;
  assert.equal(compareMeasurements({ skill: frame(floor + '4/4 통과') + frame('1/1 통과') }, { skill: 1 }).passed, true);
  for (const output of [frame(floor + '3/4 통과') + frame('1/1 통과'), frame(floor + '4/4 통과', 1), frame(floor + '4/4 통과') + frame(''), frame(frame(floor + '4/4 통과')), frame(floor + '4/4 통과') + 'unframed output', '@@jstack-suite-begin\n4/4 통과', '@@jstack-suite-end 0\n']) assert.equal(parseMeasurement(output).green, false, output);
});
test('Node TAP summaries preserve absence/failure detection', () => {
  assert.equal(parseMeasurement('# tests 3\n# pass 3\n# fail 0\n').green, true);
  assert.equal(parseMeasurement('# tests 0\n# pass 0\n# fail 0\n').green, false);
  assert.equal(parseMeasurement('# tests 3\n# pass 2\n# fail 1\n').green, false);
});
test('Node summary formats reject cancelled or incomplete runs', () => {
  for (const prefix of ['# ', '\u2139 ']) {
    const summary = (body: string) => body.split('\n').map(line => prefix + line).join('\n');
    assert.equal(parseMeasurement(summary('tests 3\npass 3\nfail 0')).green, true);
    assert.equal(parseMeasurement(summary('tests 0\npass 0\nfail 0')).green, false);
    assert.equal(parseMeasurement(summary('tests 3\npass 2\nfail 1')).green, false);
    assert.equal(parseMeasurement(summary('tests 3\npass 2\nfail 0\ncancelled 1')).green, false);
    assert.equal(parseMeasurement(summary('tests 3\npass 2\nfail 0')).green, false);
    assert.equal(parseMeasurement(summary('tests 3\npass 2\nfail 0\nskipped 1')).green, true);
  }
});
