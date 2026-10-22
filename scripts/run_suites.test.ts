import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseMeasurement } from './check_floor_parity.js';
import { runSuites, runSuitesConcurrent } from './run_suites.js';

function fixture(t: TestContext) {
  const base = mkdtempSync(join(tmpdir(), 'jstack-runner-test-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'jstack');
  mkdirSync(root);
  return { base, root };
}

const put = (root: string, name: string, text: string) => {
  const path = join(root, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
};

function installMetaCheckers(root: string): void {
  put(root, 'scripts/check_floor_parity.js', "console.log('[fixture] floor parity');");
  put(root, 'scripts/check_suite_lib_behaviour.js', "console.log('[fixture] behavior');");
  put(root, 'scripts/check_suite_lib_parity.js', "console.log('[fixture] parity');");
}

function installWorkerLauncher(root: string): void {
  put(root, 'package.json', '{"type":"module"}');
  put(root, 'scripts/run_suites.js', `
import {runSuites} from ${JSON.stringify(new URL('./run_suites.js', import.meta.url).href)};
const args=process.argv.slice(2),internalChild=args[0]==='--internal-suite-child';
if(internalChild)args.shift();
process.exitCode=runSuites({root:process.env.JSTACK_RUNTIME_ROOT,selected:args,internalChild});
`);
}

const passingSuite = "console.log('1/1 passed');";
const environment = () => ({ nodeVersion: process.version, platform: process.platform, architecture: process.arch });

test('runner rejects absent owning suites and zero execution', t => {
  const { root } = fixture(t);
  assert.throws(() => runSuites({ root, selected: ['missing'] }), /missing/);
  put(root, 'contracts/ts-migration/deletion-floors.json', '{"floors":{}}');
  assert.throws(() => runSuites({ root }), /No suites/);
  put(root, 'contracts/ts-migration/deletion-floors.json', '{"floors":{"skills/absent":1}}');
  assert.throws(() => runSuites({ root }), /owning suite is missing/);
});

test('an early failed suite cannot be hidden by a later passing suite', t => {
  const { root, base } = fixture(t);
  put(root, 'contracts/ts-migration/deletion-floors.json', '{"floors":{"skills/example":0}}');
  put(root, 'skills/example/tests/a.js', "console.log('0/1 통과'); process.exitCode=1;");
  put(root, 'skills/example/tests/b.js', "console.log('1/1 통과');");
  installMetaCheckers(root);
  const evidence = join(base, 'evidence');
  assert.equal(runSuites({ root, selected: ['example'], evidence }), 1);
  assert.match(readFileSync(join(evidence, 'example.out'), 'utf8'), /0\/1 통과[\s\S]*1\/1 통과/);
  assert.equal(JSON.parse(readFileSync(join(evidence, 'timings.json'), 'utf8')).exitCode, 1);
  assert.throws(() => runSuites({ root, selected: ['example'], evidence }), /not empty/);
});

test('a zero-count verdict and leaked temporary files are failures', t => {
  const { root } = fixture(t);
  put(root, 'contracts/ts-migration/deletion-floors.json', '{"floors":{"skills/example":0}}');
  put(root, 'skills/example/tests/run.js', "console.log('0/0 통과');");
  installMetaCheckers(root);
  assert.equal(runSuites({ root, selected: ['example'] }), 1);
  put(root, 'skills/example/tests/run.js', "require('fs').writeFileSync(require('path').join(require('os').tmpdir(),'leaked'),'x');console.log('1/1 통과');");
  assert.equal(runSuites({ root, selected: ['example'] }), 1);
});

test('native Node test output preserves pass, assertion failure, and zero-test decisions', t => {
  const { root } = fixture(t);
  put(root, 'contracts/ts-migration/deletion-floors.json', '{"floors":{"skills/example":0}}');
  installMetaCheckers(root);
  put(root, 'skills/example/tests/native.js', "require('node:test')('example',()=>{});");
  assert.equal(runSuites({ root, selected: ['example'] }), 0);
  put(root, 'skills/example/tests/native.js', "require('node:test')('example',()=>{throw Error('broken behavior');});");
  assert.equal(runSuites({ root, selected: ['example'] }), 1);
  put(root, 'skills/example/tests/native.js', "require('node:test');");
  assert.equal(runSuites({ root, selected: ['example'] }), 1);
});

test('missing meta-checkers preserve the setup failure exit code', t => {
  const { root } = fixture(t);
  put(root, 'contracts/ts-migration/deletion-floors.json', '{"floors":{"skills/example":0}}');
  put(root, 'skills/example/tests/run.js', "console.log('0/1 통과');process.exitCode=1;");
  assert.equal(runSuites({ root }), 2);
});

test('both existing owning verdict languages retain failure and zero-count checks', () => {
  for (const language of ['통과', 'passed']) {
    assert.equal(parseMeasurement(`2/2 ${language}`).green, true);
    assert.equal(parseMeasurement(`1/2 ${language}`).green, false);
    assert.equal(parseMeasurement(`0/0 ${language}`).green, false);
    assert.equal(parseMeasurement(`@@jstack-suite-begin\n2/2 ${language}\n@@jstack-suite-end 1`).green, false);
  }
});

test('parallel owning suites cannot observe another suite mutation', async t => {
  const { root, base } = fixture(t);
  put(root, 'contracts/ts-migration/deletion-floors.json', '{"floors":{"skills/a":0,"skills/b":0}}');
  installMetaCheckers(root);
  installWorkerLauncher(root);
  for (const name of ['a', 'b']) put(root, `skills/${name}/tests/run.js`, `import fs from 'node:fs';import path from 'node:path';const marker=path.resolve('../../marker');if(fs.existsSync(marker))process.exitCode=1;fs.writeFileSync(marker,'changed');console.log('1/1 passed');`);
  assert.equal(await runSuitesConcurrent({ root, evidence: join(base, 'evidence') }, 2), 0);
  assert.equal(existsSync(join(root, 'marker')), false);
});

test('selected run executes floor and harness meta-checks once at the outer aggregator', async t => {
  const { root, base } = fixture(t);
  put(root, 'contracts/ts-migration/deletion-floors.json', '{"floors":{"skills/example":0}}');
  installWorkerLauncher(root);
  const calls = join(base, 'meta-calls.txt');
  put(root, 'scripts/check_floor_parity.js', `
import fs from 'node:fs';import path from 'node:path';
const args=process.argv.slice(2);
const dir=args[args.indexOf('--from-dir')+1],label=args[args.indexOf('--from-dir')+2],file=path.join(dir,path.basename(label)+'.out');
const output=fs.existsSync(file)?fs.readFileSync(file,'utf8'):'';
fs.appendFileSync(process.env.JSTACK_META_CALLS,'floor\\n');
process.exitCode=label==='skills/example'&&output.includes('MEASURED_FLOOR_OK')?0:1;
`);
  put(root, 'scripts/check_suite_lib_behaviour.js', "import fs from 'node:fs';fs.appendFileSync(process.env.JSTACK_META_CALLS,'behavior\\n');");
  put(root, 'scripts/check_suite_lib_parity.js', "import fs from 'node:fs';fs.appendFileSync(process.env.JSTACK_META_CALLS,'parity\\n');");
  put(root, 'skills/example/tests/run.js', "console.log('MEASURED_FLOOR_OK');console.log('1/1 passed');");
  installWorkerLauncher(root);
  const evidence = join(base, 'evidence');
  assert.equal(await runSuitesConcurrent({ root, selected: ['example'], evidence, env: { JSTACK_META_CALLS: calls } }, 1), 0);
  assert.deepEqual(readFileSync(calls, 'utf8').trim().split('\n').sort(), ['behavior', 'floor', 'parity']);
  const timing = JSON.parse(readFileSync(join(evidence, 'timings.json'), 'utf8'));
  assert.equal(timing.metaChecks.length, 3);
  assert.equal(timing.suites.length, 1);
});

test('only the explicit option defers floor parity, not an inherited deletion skip', async t => {
  const { root, base } = fixture(t);
  put(root, 'contracts/ts-migration/deletion-floors.json', '{"floors":{"skills/example":0}}');
  put(root, 'scripts/check_floor_parity.js', "import fs from 'node:fs';fs.appendFileSync(process.env.JSTACK_META_CALLS,'floor\\n');");
  put(root, 'scripts/check_suite_lib_behaviour.js', "import fs from 'node:fs';fs.appendFileSync(process.env.JSTACK_META_CALLS,'behavior\\n');");
  put(root, 'scripts/check_suite_lib_parity.js', "import fs from 'node:fs';fs.appendFileSync(process.env.JSTACK_META_CALLS,'parity\\n');");
  put(root, 'skills/example/tests/run.js', "console.log('1/1 passed');");
  installWorkerLauncher(root);
  const inherited = join(base, 'inherited.txt'), deferred = join(base, 'deferred.txt');
  // Root suites run this runner as a fixture with JSTACK_SKIP_DELETION=1 and expect all three checks.
  assert.equal(await runSuitesConcurrent({ root, selected: ['example'], evidence: join(base, 'e1'), env: { JSTACK_META_CALLS: inherited, JSTACK_SKIP_DELETION: '1' } }, 1), 0);
  assert.deepEqual(readFileSync(inherited, 'utf8').trim().split('\n').sort(), ['behavior', 'floor', 'parity']);
  assert.equal(await runSuitesConcurrent({ root, selected: ['example'], evidence: join(base, 'e2'), env: { JSTACK_META_CALLS: deferred }, deferFloorParity: true }, 1), 0);
  assert.deepEqual(readFileSync(deferred, 'utf8').trim().split('\n').sort(), ['behavior', 'parity']);
});

test('selected floor evidence failures remain visible in the outer timing record', async t => {
  const { root, base } = fixture(t);
  put(root, 'contracts/ts-migration/deletion-floors.json', '{"floors":{"skills/example":0}}');
  installWorkerLauncher(root);
  const calls = join(base, 'meta-calls.txt');
  put(root, 'scripts/check_floor_parity.js', "import fs from 'node:fs';fs.appendFileSync(process.env.JSTACK_META_CALLS,'floor\\n');process.exitCode=1;");
  put(root, 'scripts/check_suite_lib_behaviour.js', "import fs from 'node:fs';fs.appendFileSync(process.env.JSTACK_META_CALLS,'behavior\\n');");
  put(root, 'scripts/check_suite_lib_parity.js', "import fs from 'node:fs';fs.appendFileSync(process.env.JSTACK_META_CALLS,'parity\\n');");
  put(root, 'skills/example/tests/run.js', passingSuite);
  const evidence = join(base, 'evidence');
  assert.equal(await runSuitesConcurrent({ root, selected: ['example'], evidence, env: { JSTACK_META_CALLS: calls } }, 1), 1);
  assert.deepEqual(readFileSync(calls, 'utf8').trim().split('\n').sort(), ['behavior', 'floor', 'parity']);
  const timing = JSON.parse(readFileSync(join(evidence, 'timings.json'), 'utf8'));
  assert.equal(timing.exitCode, 1);
  assert.equal(timing.metaChecks.find((row: { name: string }) => row.name === 'floor parity').exitCode, 1);
});

test('longest-first history schedules known suites and median-fills new suites', async t => {
  const { root, base } = fixture(t);
  put(root, 'contracts/ts-migration/deletion-floors.json', '{"floors":{"skills/a":0,"skills/b":0,"skills/c":0}}');
  installWorkerLauncher(root);
  const schedule = join(base, 'schedule.txt');
  for (const name of ['a', 'b', 'c']) put(root, `skills/${name}/tests/run.js`, `import fs from 'node:fs';fs.appendFileSync(process.env.JSTACK_SCHEDULE_LOG,${JSON.stringify(name + '\n')});console.log('1/1 passed');`);
  installMetaCheckers(root);
  const history = join(base, 'history.json');
  writeFileSync(history, JSON.stringify({
    schemaVersion: 1,
    runId: 'previous-run',
    inputFingerprint: 'previous-package-source',
    environment: environment(),
    suites: [
      { label: 'skills/a', copyMs: 1, runMs: 1, cleanupMs: 1, totalMs: 10, failed: false },
      { label: 'skills/b', copyMs: 10, runMs: 80, cleanupMs: 10, totalMs: 100, failed: false },
    ],
  }));
  const evidence = join(base, 'evidence');
  assert.equal(await runSuitesConcurrent({ root, evidence, timingHistory: history, inputFingerprint: 'current-package-source', env: { JSTACK_SCHEDULE_LOG: schedule } }, 1), 0);
  assert.deepEqual(readFileSync(schedule, 'utf8').trim().split('\n'), ['b', 'c', 'a']);
  const timing = JSON.parse(readFileSync(join(evidence, 'timings.json'), 'utf8'));
  assert.equal(timing.complete, true);
  assert.equal(timing.inputFingerprint, 'current-package-source');
  assert.notEqual(timing.runId, 'previous-run');
  assert.equal(timing.timingHistory.applied, true);
  assert.equal(timing.timingHistory.inputFingerprint, 'previous-package-source');
  assert.deepEqual(timing.suites.map((row: { label: string }) => row.label), ['skills/b', 'skills/c', 'skills/a']);
  for (const row of timing.suites) {
    for (const key of ['copyMs', 'runMs', 'cleanupMs', 'totalMs']) assert.equal(Number.isFinite(row[key]), true);
    assert.equal(row.failed, false);
  }
});

test('invalid history safely falls back to the complete alphabetical suite queue', async t => {
  const { root, base } = fixture(t);
  put(root, 'contracts/ts-migration/deletion-floors.json', '{"floors":{"skills/a":0,"skills/b":0}}');
  installWorkerLauncher(root);
  installMetaCheckers(root);
  const schedule = join(base, 'schedule.txt');
  for (const name of ['b', 'a']) put(root, `skills/${name}/tests/run.js`, `import fs from 'node:fs';fs.appendFileSync(process.env.JSTACK_SCHEDULE_LOG,${JSON.stringify(name + '\n')});console.log('1/1 passed');`);
  const history = join(base, 'history.json');
  writeFileSync(history, '{not valid JSON');
  const evidence = join(base, 'evidence');
  assert.equal(await runSuitesConcurrent({ root, evidence, timingHistory: history, env: { JSTACK_SCHEDULE_LOG: schedule } }, 1), 0);
  assert.deepEqual(readFileSync(schedule, 'utf8').trim().split('\n'), ['a', 'b']);
  const timing = JSON.parse(readFileSync(join(evidence, 'timings.json'), 'utf8'));
  assert.equal(timing.suites.length, 2);
  assert.equal(timing.timingHistory.applied, false);
  assert.match(timing.timingHistory.reason, /unreadable timing file/);
});

test('failed suite timings are retained in JSON evidence', async t => {
  const { root, base } = fixture(t);
  put(root, 'contracts/ts-migration/deletion-floors.json', '{"floors":{"skills/example":0}}');
  installWorkerLauncher(root);
  installMetaCheckers(root);
  put(root, 'skills/example/tests/run.js', "console.log('0/1 passed');process.exitCode=1;");
  const evidence = join(base, 'evidence');
  assert.equal(await runSuitesConcurrent({ root, selected: ['example'], evidence }, 1), 1);
  const timing = JSON.parse(readFileSync(join(evidence, 'timings.json'), 'utf8'));
  assert.equal(timing.exitCode, 1);
  assert.equal(timing.suites.length, 1);
  assert.equal(timing.suites[0].failed, true);
});

test('finished suite timings are checkpointed before later workers finish', async t => {
  const { root, base } = fixture(t);
  put(root, 'contracts/ts-migration/deletion-floors.json', '{"floors":{"skills/a":0,"skills/b":0}}');
  installWorkerLauncher(root);
  installMetaCheckers(root);
  const release = join(base, 'release.txt'), evidence = join(base, 'evidence');
  put(root, 'skills/a/tests/run.js', passingSuite);
  put(root, 'skills/b/tests/run.js', `
import fs from 'node:fs';
const deadline=Date.now()+5000;
while(!fs.existsSync(process.env.JSTACK_RELEASE)&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
console.log(fs.existsSync(process.env.JSTACK_RELEASE)?'1/1 passed':'0/1 passed');
`);
  const running = runSuitesConcurrent({ root, evidence, env: { JSTACK_RELEASE: release } }, 1);
  let partial: any;
  try {
    for (let attempt = 0; attempt < 150; attempt++) {
      if (existsSync(join(evidence, 'timings.json'))) {
        const document = JSON.parse(readFileSync(join(evidence, 'timings.json'), 'utf8'));
        if (document.suites?.length) { partial = document; break; }
      }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  } finally { writeFileSync(release, 'continue'); }
  assert.equal(await running, 0);
  assert.equal(partial?.complete, false);
  assert.equal(partial?.exitCode, 2);
  assert.deepEqual(partial?.suites.map((row: { label: string }) => row.label), ['skills/a']);
  assert.equal(JSON.parse(readFileSync(join(evidence, 'timings.json'), 'utf8')).complete, true);
});
