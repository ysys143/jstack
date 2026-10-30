import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cap, extract, rank } from '../scripts/cap_findings.js';

test('priority cut preserves stable ties, unknown severities and input bytes', () => {
  const values = Array.from({ length: 30 }, (_, i) => ({ id: i, severity: i % 3 ? 'low' : 'HIGH' }));
  const original = JSON.stringify(values), result = cap(values);
  assert.equal(result.shown, 20); assert.equal(result.truncated, 10);
  assert.deepEqual(result.findings.slice(0, 10).map(row => row.id), [0, 3, 6, 9, 12, 15, 18, 21, 24, 27]);
  assert.match(result.note, /10 lower-priority/);
  assert.equal(JSON.stringify(values), original);
  for (const severity of ['__proto__', 'constructor', null, 1]) assert.equal(rank({ severity }), 3);
  assert.deepEqual(cap([]).findings, []);
});
test('invalid findings fail before reporting a misleading empty result', () => {
  for (const value of [null, 1, false, {}, { findings: false }, [null], [[]], ['finding']]) assert.throws(() => extract(value));
  const child = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/cap_findings.js', import.meta.url))], { input: '{"findings":false}', encoding: 'utf8' });
  assert.equal(child.status, 2); assert.equal(child.stdout, ''); assert.match(child.stderr, /expected a list/);
});
