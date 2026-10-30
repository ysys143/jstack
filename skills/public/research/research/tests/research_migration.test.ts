import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { check as coverage } from '../scripts/coverage_matrix.js';
import { check as citations } from '../scripts/cite_check.js';

test('coverage counts Unicode code points and reports every missing/orphan requirement', () => {
  const [findings, pairs] = coverage({ 'REQ-001': 'one', 'REQ-002': 'two' }, 'REQ-001 😀\n\nREQ-003\n\n한REQ-004글', 10);
  assert.deepEqual(findings.map(f => f.kind), ['THIN', 'MISSING', 'ORPHAN']);
  assert.match(findings[0].detail, /9 characters/);
  assert.equal(findings[2].req, 'REQ-003'); assert.equal(pairs.length, 1);
});
test('all citation pairs are exported while absent, unused and unresolved sources are explicit', t => {
  const directory = mkdtempSync(join(tmpdir(), 'jstack-citations-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const report = join(directory, 'report.md');
  writeFileSync(report, '첫 문장 [1]. 두 번째 [1] [2].\n\n## References\n[1] Valid https://example.com\n[3] No identifier\n');
  const [findings, pairs] = citations(report);
  assert.deepEqual(findings.map(f => f.kind), ['MISSING', 'UNUSED', 'UNRESOLVED']);
  assert.equal(pairs.length, 2); assert.notEqual(pairs[0].sentence, pairs[1].sentence);
});
