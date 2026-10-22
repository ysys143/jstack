import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { isNodeTest, loadGroups, plan, runBudget, type Groups } from './test_budget.js';

const groups: Groups = { integration: ['cli/lifecycle.test.ts'], budget: { fast: { maxSeconds: 2, repeat: 2 }, integration: { maxSeconds: 30, repeat: 1 } } };

function fixture(t: { after: (fn: () => void) => void }, files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'jstack-test-budget-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({ include: ['**/*.test.ts'], exclude: ['dist', 'node_modules'] }));
  for (const [rel, body] of Object.entries(files)) { mkdirSync(join(root, rel, '..'), { recursive: true }); writeFileSync(join(root, rel), body); }
  return root;
}

test('plan maps changed sources to compiled files and groups', () => {
  const planned = plan(['cli/lifecycle.test.ts', 'runtime/os.test.ts', 'README.md', 'dist/x.test.ts', 'runtime/os.test.ts'], groups);
  assert.deepEqual(planned, [
    { source: 'cli/lifecycle.test.ts', compiled: join('dist', 'cli/lifecycle.test.js'), group: 'integration' },
    { source: 'runtime/os.test.ts', compiled: join('dist', 'runtime/os.test.js'), group: 'fast' },
  ]);
  assert.equal(isNodeTest('runtime/os.ts'), false);
});

test('only root-build test files are budgeted', () => {
  assert.equal(isNodeTest('skills/public/operations/dashboard/scripts/__tests__/widgets.test.ts'), false);
  assert.equal(isNodeTest('scripts/test_budget.test.ts'), true);
});

test('the repository group file lists existing integration sources with budgets', () => {
  const real = loadGroups();
  assert.ok(real.integration.length > 0);
  assert.ok(real.budget.fast.maxSeconds > 0 && real.budget.integration.maxSeconds >= real.budget.fast.maxSeconds);
});

test('no changed test file passes without running anything', async () => {
  const result = await runBudget(['README.md'], { root: tmpdir(), groups });
  assert.equal(result.code, 0);
  assert.match(result.lines.join('\n'), /no added or changed/);
});

test('a missing compiled file is a usage error', async t => {
  const root = fixture(t, { 'runtime/new.test.ts': '' });
  const result = await runBudget(['runtime/new.test.ts'], { root, groups });
  assert.equal(result.code, 2);
});

test('a waiting test fails and a quick test passes', { skip: process.platform === 'win32' }, async t => {
  // The fixtures use import syntax in .js files; Node before 22 reads them as ES modules only under "type": "module".
  const root = fixture(t, {
    'package.json': '{"type": "module"}\n',
    'runtime/idle.test.ts': 'await new Promise(r => setTimeout(r, 400));\n', // test-smells: allow fixture that must be reported as waiting
    'dist/runtime/idle.test.js': "import test from 'node:test'; test('idle', async () => { await new Promise(r => setTimeout(r, 400)); });\n", // test-smells: allow fixture that must be reported as waiting
    'runtime/quick.test.ts': '',
    'dist/runtime/quick.test.js': "import test from 'node:test'; test('quick', () => {});\n",
  });
  // A 0.4 s sleep on a slow runner still spends about 0.3 s of CPU starting Node, so a loose ratio keeps the verdict stable.
  const idle = await runBudget(['runtime/idle.test.ts'], { root, groups, waitingMinSeconds: 0.3, waitingRatio: 0.6 });
  assert.equal(idle.code, 1, idle.lines.join('\n'));
  assert.match(idle.lines.join('\n'), /WAITING/);
  assert.match(idle.lines.join('\n'), /sleep/);
  const quick = await runBudget(['runtime/quick.test.ts'], { root, groups });
  assert.equal(quick.code, 0, quick.lines.join('\n'));
});
