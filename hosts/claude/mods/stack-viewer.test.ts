import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Compiled to dist/hosts/claude/mods; the imported mod and the kit stay in the checkout.
const MOD = fileURLToPath(new URL('../../../../hosts/claude/mods/stack-viewer', import.meta.url));
const KIT = fileURLToPath(new URL('../../../../hosts/claude/mods/claude-code-testing.mjs', import.meta.url));
const kit = () => import(pathToFileURL(KIT).href);
function box(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'jstack-stack-viewer-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Bundle a mod test file against the Node kit and run it; returns the TAP summary. */
async function runUnderNode(testFile: string, dir: string) {
  const { build } = await import('esbuild');
  const bundle = join(dir, 'bundle.test.mjs');
  await build({ entryPoints: [testFile], bundle: true, platform: 'node', format: 'esm', target: 'node20', alias: { 'claude-code/testing': KIT }, outfile: bundle, logLevel: 'silent' });
  // A child that inherits this runner's context refuses to run files, so it starts without it.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', bundle], { encoding: 'utf8', env });
  const count = (name: string) => Number(new RegExp(`^# ${name} (\\d+)$`, 'm').exec(run.stdout)?.[1]);
  return { status: run.status, output: run.stdout + run.stderr, pass: count('pass'), fail: count('fail'), skips: [...run.stdout.matchAll(/# SKIP (.*)$/gm)].map(m => m[1]) };
}

test('stack-viewer: the upstream tests that need no engine harness pass under Node', async t => {
  const { HARNESS_SKIP } = await kit();
  const result = await runUnderNode(join(MOD, 'tests/stack-viewer.test.tsx'), box(t));
  assert.equal(result.status, 0, result.output);
  // At 30756c4 the file holds 16 tests and one takes the engine harness; an update must reconfirm both counts.
  assert.equal(result.pass, 15, result.output);
  assert.equal(result.fail, 0, result.output);
  assert.deepEqual(result.skips, [HARNESS_SKIP], result.output);
});

test('stack-viewer: a wrong expectation in the upstream tests fails under Node', async t => {
  const dir = box(t), source = readFileSync(join(MOD, 'tests/stack-viewer.test.tsx'), 'utf8');
  const expected = "'curl -H \"Authorization: Bearer •••\" https://x.io/h?token=•••&v=1'";
  assert.ok(source.includes(expected), 'the redaction expectation this check mutates is gone; pick another one');
  // The copy imports the mod from the checkout, so only the expectation differs.
  const copy = join(dir, 'mutated.test.tsx');
  writeFileSync(copy, source.replace(expected, "'a credential left in place'").replaceAll("'../hooks/stack.ts'", JSON.stringify(join(MOD, 'hooks/stack.ts'))));
  const result = await runUnderNode(copy, dir);
  assert.equal(result.status, 1, result.output);
  assert.equal(result.fail, 1, result.output);
});

test('the Node kit runs a body passed after options, and refuses a test without one', async t => {
  const dir = box(t), file = join(dir, 'options.test.ts');
  writeFileSync(file, "import { test } from 'claude-code/testing'\ntest('options then body', { timeoutMs: 1000 }, () => { throw new Error('the body ran') })\n");
  const result = await runUnderNode(file, dir);
  assert.equal(result.fail, 1, result.output);
  assert.match(result.output, /the body ran/);
  const { test: kitTest } = await kit();
  assert.throws(() => kitTest('no body', { timeoutMs: 1000 }), /last argument must be the test body/);
});

// Outcomes measured with Claude Code 2.1.308's own kit (`claude plugin test`) on 2026-10-23.
// A value of the wrong type does not match, so its negated form passes.
const ENGINE: [string, boolean, (expect: any) => void][] = [
  ['toMatchObject: a RegExp does not match a string property', false, e => e({ s: 'abc' }).toMatchObject({ s: /b/ })],
  ['toEqual: a string never equals a RegExp', false, e => e('/b/').toEqual(/b/)],
  ['toEqual: equal RegExps', true, e => e(/b/).toEqual(/b/)],
  ['toEqual: Maps with different values', false, e => e(new Map([[1, 'a']])).toEqual(new Map([[1, 'b']]))],
  ['toEqual: equal Maps', true, e => e(new Map([[1, 'a']])).toEqual(new Map([[1, 'a']]))],
  ['toEqual: Sets with different members', false, e => e(new Set([1])).toEqual(new Set([2]))],
  ['toEqual: different Dates', false, e => e(new Date(0)).toEqual(new Date(1))],
  ['toEqual: undefined properties are ignored', true, e => e({ a: 1, b: undefined }).toEqual({ a: 1 })],
  ['toEqual: a trailing undefined array item counts', false, e => e([1]).toEqual([1, undefined])],
  ['toEqual: a class instance equals a plain object', true, e => e(new (class { a = 1; })()).toEqual({ a: 1 })],
  ['toEqual: 0 and -0 differ', false, e => e(0).toEqual(-0)],
  ['toEqual: NaN equals NaN', true, e => e(Number.NaN).toEqual(Number.NaN)],
  ['toMatchObject: array elements match as subsets', true, e => e([{ a: 1, b: 2 }]).toMatchObject([{ a: 1 }])],
  ['toMatchObject: arrays of different length', false, e => e([1, 2]).toMatchObject([1])],
  ['toMatchObject: nested subset', true, e => e({ a: { b: 1, c: 2 } }).toMatchObject({ a: { b: 1 } })],
  ['toMatchObject: undefined', false, e => e(undefined).toMatchObject({})],
  ['not.toMatchObject: undefined', true, e => e(undefined).not.toMatchObject({})],
  ['toMatch: undefined', false, e => e(undefined).toMatch(/x/)],
  ['toMatch: undefined is not coerced to a string', false, e => e(undefined).toMatch(/undef/)],
  ['not.toMatch: undefined', true, e => e(undefined).not.toMatch(/x/)],
  ['toMatch: a string pattern', true, e => e('abc').toMatch('b')],
  ['toContain: undefined', false, e => e(undefined).toContain('a')],
  ['not.toContain: undefined', true, e => e(undefined).not.toContain('a')],
  ['toContain: a substring', true, e => e('abc').toContain('b')],
  ['not.toContain: an absent array item', true, e => e(['a']).not.toContain('b')],
  ['toBe: two empty objects differ', false, e => e({}).toBe({})],
  ['toBeFalsy: zero', true, e => e(0).toBeFalsy()],
  ['toBeDefined: null', true, e => e(null).toBeDefined()],
];
test('the Node kit matches the engine kit on every measured case', async () => {
  const { expect } = await kit();
  for (const [name, passes, run] of ENGINE) {
    let threw = false;
    try { run(expect); } catch { threw = true; }
    assert.equal(!threw, passes, name);
  }
});
