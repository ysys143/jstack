import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CANONICAL, check } from '../scripts/check_suite_lib_parity.js';
import { checkPathsRegression } from '../scripts/check_paths_regression.js';
import { checkAttribution } from '../scripts/check_attribution.js';
import { ROOT, box, write } from './_fixtures.js';
function fixture(t: TestContext, source = true) { const root = box(t, 'jstack-root-repository-'), rows = Object.entries(CANONICAL).map(([source, target]) => ({ source, target })); for (const row of rows) write(join(root, source ? row.source : row.target.replace(/\.ts$/,".js")), 'fixture\n'); write(join(root, 'packaging/package-files.json'), JSON.stringify({ files: rows })); return root; }
test('repository: valid source and payload retain canonical bindings', t => { for (const source of [true, false]) assert.deepEqual(check(fixture(t, source)), []); });
test('repository: missing and empty canonical files fail', t => { for (const empty of [true, false]) { const root = fixture(t), file = join(root, 'skills/_suite_lib.ts'); if (empty) writeFileSync(file, ''); else unlinkSync(file); assert.ok(check(root).some(problem => problem.includes('missing or empty'))); } });
test('repository: duplicate suite libraries fail', t => { const root = fixture(t); write(join(root, 'skills/other/_suite_lib.py'), 'duplicate'); assert.ok(check(root).some(problem => problem.includes('duplicate suite library'))); });
test('repository: canonical membership binding drift fails', t => { const root = fixture(t), file = join(root, 'packaging/package-files.json'), doc = JSON.parse(readFileSync(file, 'utf8')); doc.files[0].source = 'skills/elsewhere.py'; writeFileSync(file, JSON.stringify(doc)); assert.ok(check(root).some(problem => problem.includes('not unique'))); });
test('repository: retired source trees fail', t => { const root = fixture(t); mkdirSync(join(root, 'staging')); assert.ok(check(root).some(problem => problem.includes('retired source tree'))); });
function referenceFixture(t: TestContext) { const root = box(t, 'jstack-root-reference-gate-'); write(join(root, 'tests/fixtures/path-reference-baseline.txt'), '## jstack\n'); const checker = write(join(root, 'checker.js'), ''); return { root, runtime: root, checker }; }
test('repository: reference gate rejects crashes, empty output, and hygiene failures', t => { const options = referenceFixture(t); for (const [status, stdout, stderr] of [[0, '', ''], [1, '[FAIL] did not measure', ''], [1, '참조 1건 / 실재 1건 / MISS 0건\n위생 위반 1건', ''], [1, '', 'Traceback (most recent call last)']] as const) assert.equal(checkPathsRegression({ ...options, run: () => ({ status, stdout, stderr }) }).code, 2); });
test('repository: reference gate accepts measured clean output and rejects a new reference', t => { const options = referenceFixture(t); for (const [status, stdout, expected] of [[0, '참조 1건 / 실재 1건 / MISS 0건', 0], [1, '참조 1건 / 실재 0건 / MISS 1건\n  missing/new.py\n    <- skills/sample/SKILL.md', 1]] as const) assert.equal(checkPathsRegression({ ...options, run: () => ({ status, stdout, stderr: '' }) }).code, expected); });
test('repository: attribution discovers all adapted rules and rejects empty populations', t => {
  const taxonomy = 'skills/humanize/references/ai-tell-taxonomy.md', text = readFileSync(join(ROOT, taxonomy), 'utf8');
  assert.deepEqual([...text.matchAll(/^###\s+([A-Z]-\d+)\..*fluent-korean\s*(?:이식|port)/gm)].map(match => match[1]).sort(), ['A-20', 'A-21', 'F-6', 'F-7']);
  assert.equal(checkAttribution(ROOT).code, 0, JSON.stringify(checkAttribution(ROOT)));
  const root = box(t, 'jstack-root-attribution-');
  for (const rel of ['output-styles/fluent-korean.md', 'output-styles/fluent-korean-not-coding.md', 'output-styles/ATTRIBUTION.md', taxonomy]) { const source = existsSync(join(ROOT, rel)) ? join(ROOT, rel) : join(ROOT, 'hosts/claude', rel); write(join(root, rel), readFileSync(source)); }
  const attribution = readFileSync(join(root, 'output-styles/ATTRIBUTION.md'), 'utf8'); for (const match of attribution.matchAll(/`(skills\/[^`]+\.md)`/g)) if (!existsSync(join(root, match[1]!))) write(join(root, match[1]!), readFileSync(join(ROOT, match[1]!)));
  assert.equal(checkAttribution(root).code, 0); writeFileSync(join(root, taxonomy), '# No adapted rules\n'); assert.equal(checkAttribution(root).code, 1);
});
