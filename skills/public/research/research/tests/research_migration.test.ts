import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
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
test('Python oracle matches JSON verdicts, pairs and exit codes on positive and negative reports', { skip: process.env.JSTACK_ORACLE !== '1' }, t => {
  const directory = mkdtempSync(join(tmpdir(), 'jstack-research-oracle-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const req = join(directory, 'req.txt'), report = join(directory, 'report.md');
  writeFileSync(req, 'REQ-001  first\nREQ-002  second\n');
  const sourceRoot = fileURLToPath(new URL('../../../../../../skills/public/research/research/scripts/', import.meta.url));
  for (const text of ['[１] [٢] [01] [1].\n\n## References\n[01] first\n[1] second\n[１] full width\n[٢] Arabic\n', '', 'REQ-001 😀 [1].\n\nREQ-003 [2].\n\n## References\n[1] valid doi:abc\n[3] none\n', 'REQ-001 REQ-002 [1].\n\n## 출처\n[1] source https://example.com\n']) {
    writeFileSync(report, text);
    for (const script of ['coverage_matrix', 'cite_check']) {
      const args = script === 'coverage_matrix' ? ['--req', req, '--report', report, '--min-chars', '1'] : [report];
      const pythonPairs = join(directory, 'python.jsonl'), nodePairs = join(directory, 'node.jsonl');
      const py = spawnSync('python3', [join(sourceRoot, script + '.py'), ...args, '--format', 'json', '--pairs', pythonPairs], { encoding: 'utf8' });
      const js = spawnSync(process.execPath, [fileURLToPath(new URL(`../scripts/${script}.js`, import.meta.url)), ...args, '--format', 'json', '--pairs', nodePairs], { encoding: 'utf8' });
      assert.equal(js.status, py.status, js.stderr + py.stderr);
      assert.deepEqual(JSON.parse(js.stdout), JSON.parse(py.stdout));
      const rows = (path: string) => readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
      assert.deepEqual(rows(nodePairs), rows(pythonPairs));
    }
  }
});
