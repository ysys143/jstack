import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { runSuites, runSuitesConcurrent } from './run_suites.js';

function fixture(t: TestContext) {
  const base = mkdtempSync(join(tmpdir(), 'jstack-suite-evidence-')), root = join(base, 'jstack');
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const put = (name: string, body: string) => { const file = join(root, name); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, body); };
  put('package.json', '{"type":"module"}');
  put('contracts/ts-migration/deletion-floors.json', '{"floors":{"skills/example":0}}');
  for (const name of ['check_floor_parity', 'check_suite_lib_behaviour', 'check_suite_lib_parity']) put(`scripts/${name}.js`, '');
  put('scripts/run_suites.js', `import {runSuites} from ${JSON.stringify(new URL('./run_suites.js', import.meta.url).href)};process.exitCode=runSuites({root:process.env.JSTACK_RUNTIME_ROOT,selected:['example'],internalChild:true});`);
  put('skills/example/tests/run.js', `
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
fs.writeFileSync(path.join(process.env.JSTACK_SUITE_EVIDENCE_DIR,'example.details.json'),JSON.stringify({reason:'failure before the last six lines',temporary:os.tmpdir(),input:process.env.JSTACK_SUITE_INPUT_FINGERPRINT}));
console.log('0/1 passed');process.exitCode=1;
`);
  return { root, base, evidence: join(base, 'evidence'), put };
}

for (const parallel of [false, true]) test(`${parallel ? 'parallel' : 'sequential'} failure preserves details after temporary cleanup`, async t => {
  const { root, evidence } = fixture(t);
  const options = { root, evidence, selected: ['example'], inputFingerprint: 'captured-input' };
  assert.equal(parallel ? await runSuitesConcurrent(options, 1) : runSuites(options), 1);
  const details = JSON.parse(readFileSync(join(evidence, 'example.details.json'), 'utf8'));
  assert.equal(details.reason, 'failure before the last six lines');
  assert.equal(details.input, 'captured-input');
  assert.equal(existsSync(details.temporary), false);
  assert.match(readFileSync(join(evidence, 'example.out'), 'utf8'), /0\/1 passed/);
});

test('parallel worker details survive when the worker exits before creating its verdict', async t => {
  const { root, evidence, put } = fixture(t);
  put('scripts/run_suites.js', `import fs from 'node:fs';import path from 'node:path';fs.writeFileSync(path.join(process.env.JSTACK_SUITE_EVIDENCE_DIR,'example.details.json'),'{"signal":"SIGTERM","complete":false}');process.exitCode=2;`);
  assert.equal(await runSuitesConcurrent({ root, evidence, selected: ['example'] }, 1), 1);
  assert.deepEqual(JSON.parse(readFileSync(join(evidence, 'example.details.json'), 'utf8')), { signal: 'SIGTERM', complete: false });
  assert.match(readFileSync(join(evidence, 'example.out'), 'utf8'), /Worker did not create suite evidence/);
});
