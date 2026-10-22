import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { createContractSuitePlan, planContractSuites, type PlannerSnapshot } from './select_contract_suites.js';

interface OwnerSpec { owner: string; name?: string; visibility?: 'public' | 'support'; category?: string }
interface SnapshotOptions {
  owners: OwnerSpec[];
  files?: string[];
  roots?: Record<string, string[]>;
  ownerConsumers?: Record<string, string[]>;
  rootConsumers?: Record<string, string[]>;
  rootSuites?: string[];
  missingOwnerRows?: string[];
  missingRootRows?: string[];
}
const REACT: OwnerSpec = { owner: 'react', name: 'react-performance' };

function sourceRoot(owner: OwnerSpec): string {
  const name = owner.name ?? owner.owner;
  return owner.visibility === 'support' ? `skills/support/${name}` : `skills/public/${owner.category ?? 'engineering'}/${name}`;
}
function snapshot(options: SnapshotOptions): PlannerSnapshot {
  const memberRows: { source: string; target: string }[] = [];
  for (const owner of options.owners) {
    const root = sourceRoot(owner);
    memberRows.push({ source: `${root}/SKILL.md`, target: `skills/${owner.owner}/SKILL.md` });
    memberRows.push({ source: `${root}/tests/run_tests.ts`, target: `skills/${owner.owner}/tests/run_tests.ts` });
    for (const source of options.files ?? []) if (source.startsWith(`${root}/`)) {
      memberRows.push({ source, target: `skills/${owner.owner}/${source.slice(root.length + 1)}` });
    }
  }
  for (const suite of options.rootSuites ?? []) memberRows.push({ source: suite.replace(/\.py$/, '.ts'), target: suite.replace(/\.py$/, '.ts') });
  const owners = options.owners.map(owner => owner.owner);
  const ownerConsumers = Object.fromEntries(owners.filter(owner => !options.missingOwnerRows?.includes(owner)).map(owner => [owner, options.ownerConsumers?.[owner] ?? []]));
  const rootConsumers = Object.fromEntries(owners.filter(owner => !options.missingRootRows?.includes(owner)).map(owner => [owner, options.rootConsumers?.[owner] ?? []]));
  const floors: Record<string, number> = Object.fromEntries(owners.map(owner => [`skills/${owner}`, 0]));
  for (const suite of options.rootSuites ?? []) floors[suite] = 0;
  return {
    packageFiles: { schemaVersion: 1, files: memberRows },
    catalog: {
      schemaVersion: 1,
      sourceLayout: 'hierarchical',
      categories: [...new Set(options.owners.map(owner => owner.category ?? 'engineering'))],
      entries: options.owners.map(owner => ({
        owner: owner.owner,
        name: owner.name ?? owner.owner,
        aliases: owner.owner === (owner.name ?? owner.owner) ? [] : [owner.owner],
        visibility: owner.visibility ?? 'public',
        ...(owner.visibility === 'support' ? {} : { category: owner.category ?? 'engineering' }),
        // The planner must not infer edges from this field.
        ...(owner.visibility === 'support' ? { usedBy: ['alpha'] } : {}),
      })),
    },
    deletionFloors: { schemaVersion: 1, floors },
    dependencies: {
      schemaVersion: 1,
      eligibleSourceRoots: options.roots ?? {},
      ownerConsumers,
      rootConsumers,
    },
  };
}

function plan(baseSnapshot: PlannerSnapshot, headSnapshot: PlannerSnapshot, diff: Parameters<typeof planContractSuites>[0]['diff'], mode: 'shadow' | 'enforce' = 'enforce') {
  return planContractSuites({ base: 'base-sha', head: 'head-sha', mode, diff, baseSnapshot, headSnapshot });
}

test('added owner resources select the mapped owner only when its source root is reviewed', () => {
  const root = 'skills/public/engineering/react-performance', added = `${root}/references/new-rule.md`;
  const base = snapshot({ owners: [REACT], roots: { react: [root] } });
  const head = snapshot({ owners: [REACT], roots: { react: [root] }, files: [added] });
  const result = plan(base, head, [{ status: 'A', newPath: added }]);
  assert.equal(result.scope, 'scoped');
  assert.equal(result.execution, 'selected');
  assert.deepEqual(result.selectedSuites, ['react']);
  assert.deepEqual(result.expectedOwningLabels, ['skills/react']);
});

test('owner file deletions resolve against the base membership and retain the existing head suite', () => {
  const root = 'skills/public/engineering/react-performance', deleted = `${root}/references/removed.md`;
  const base = snapshot({ owners: [REACT], roots: { react: [root] }, files: [deleted] });
  const head = snapshot({ owners: [REACT], roots: { react: [root] } });
  const result = plan(base, head, [{ status: 'D', oldPath: deleted }]);
  assert.equal(result.scope, 'scoped');
  assert.deepEqual(result.changedPaths, [deleted]);
  assert.deepEqual(result.selectedSuites, ['react']);
});

test('renames include both source owners from base and head memberships', () => {
  const alphaRoot = 'skills/public/engineering/alpha', betaRoot = 'skills/public/engineering/beta';
  const oldPath = `${alphaRoot}/references/shared.md`, newPath = `${betaRoot}/references/shared.md`;
  const base = snapshot({ owners: [{ owner: 'alpha' }, { owner: 'beta' }], roots: { alpha: [alphaRoot], beta: [betaRoot] }, files: [oldPath] });
  const head = snapshot({ owners: [{ owner: 'alpha' }, { owner: 'beta' }], roots: { alpha: [alphaRoot], beta: [betaRoot] }, files: [newPath] });
  const result = plan(base, head, [{ status: 'R100', oldPath, newPath }]);
  assert.equal(result.scope, 'scoped');
  assert.deepEqual(result.selectedSuites, ['alpha', 'beta']);
  assert.deepEqual(result.changedPaths, [newPath, oldPath].sort());
});

test('new owner suite files remain attached to their existing canonical owner', () => {
  const root = 'skills/public/engineering/react-performance', suite = `${root}/tests/new_contract.ts`;
  const base = snapshot({ owners: [REACT], roots: { react: [root] } });
  const head = snapshot({ owners: [REACT], roots: { react: [root] }, files: [suite] });
  const result = plan(base, head, [{ status: 'A', newPath: suite }]);
  assert.equal(result.scope, 'scoped');
  assert.deepEqual(result.selectedSuites, ['react']);
});

test('default mode is shadow, and suite availability mirrors direct-child runner discovery', () => {
  const root = 'skills/public/engineering/react-performance', file = `${root}/SKILL.md`;
  const base = snapshot({ owners: [REACT], roots: { react: [root] } });
  const head = snapshot({ owners: [REACT], roots: { react: [root] } });
  const shadow = planContractSuites({ base: 'base', head: 'head', diff: [{ status: 'M', oldPath: file, newPath: file }], baseSnapshot: base, headSnapshot: head });
  assert.equal(shadow.mode, 'shadow');
  assert.equal(shadow.scope, 'scoped');
  assert.equal(shadow.execution, 'full');
  assert.deepEqual(shadow.selectedSuites, ['react']);

  const noDirectSuite = structuredClone(head);
  const files = (noDirectSuite.packageFiles as { files: { source: string; target: string }[] }).files;
  files.splice(1, 1);
  files.push({ source: `${root}/tests/nested/only.ts`, target: 'skills/react/tests/nested/only.ts' });
  const missingSuite = plan(base, noDirectSuite, [{ status: 'M', oldPath: file, newPath: file }]);
  assert.equal(missingSuite.scope, 'full', 'a nested helper is not discovered as an owning suite');
});

test('reviewed owner dependencies close transitively across owner and root consumers', () => {
  const alphaRoot = 'skills/public/engineering/alpha', changed = `${alphaRoot}/SKILL.md`;
  const owners = [{ owner: 'alpha' }, { owner: 'beta' }, { owner: 'gamma' }];
  const options = {
    owners,
    roots: { alpha: [alphaRoot] },
    ownerConsumers: { alpha: ['beta'], beta: ['gamma'] },
    rootConsumers: { gamma: ['tests/test_contracts.py'] },
    rootSuites: ['tests/test_contracts.py'],
  };
  const result = plan(snapshot(options), snapshot(options), [{ status: 'M', oldPath: changed, newPath: changed }]);
  assert.equal(result.scope, 'scoped');
  assert.deepEqual(result.selectedSuites, ['alpha', 'beta', 'gamma', 'tests/test_contracts.py']);
  assert.deepEqual(result.expectedOwningLabels, ['skills/alpha', 'skills/beta', 'skills/gamma']);
  assert.deepEqual(result.expectedRootSuites, ['tests/test_contracts.py']);
});

test('support usedBy metadata does not replace explicit eligibility or dependencies', () => {
  const path = 'skills/support/runtime-adaptation/SKILL.md';
  const owners: OwnerSpec[] = [{ owner: 'bridge', name: 'runtime-adaptation', visibility: 'support' }, { owner: 'alpha' }];
  const base = snapshot({ owners });
  const head = snapshot({ owners });
  const result = plan(base, head, [{ status: 'M', oldPath: path, newPath: path }]);
  assert.equal(result.scope, 'full');
  assert.match(result.reasons.join('\n'), /outside the reviewed scoped source roots/);
});

test('shared runtime, unknown paths, and incomplete dependency rows force the full population', () => {
  const root = 'skills/public/engineering/react-performance', file = `${root}/SKILL.md`;
  const base = snapshot({ owners: [REACT], roots: { react: [root] } });
  const head = snapshot({ owners: [REACT], roots: { react: [root] } });
  const shared = plan(base, head, [{ status: 'M', oldPath: 'runtime/os.ts', newPath: 'runtime/os.ts' }]);
  assert.equal(shared.scope, 'full');
  assert.match(shared.reasons.join('\n'), /does not map runtime\/os\.ts/);
  const unknown = plan(base, head, [{ status: 'A', newPath: 'new-unclassified-file.md' }]);
  assert.equal(unknown.scope, 'full');
  const incomplete = snapshot({ owners: [REACT], roots: { react: [root] }, missingRootRows: ['react'] });
  const missingGraph = plan(base, incomplete, [{ status: 'M', oldPath: file, newPath: file }]);
  assert.equal(missingGraph.scope, 'full');
  assert.match(missingGraph.reasons.join('\n'), /rootConsumers is incomplete/);
});

test('root suite source changes and out-of-scope owners run the full population', () => {
  const root = 'skills/public/engineering/react-performance', ownerFile = `${root}/SKILL.md`;
  const owners = [REACT, { owner: 'alpha' }];
  const base = snapshot({ owners, roots: { react: [root] }, rootSuites: ['tests/test_contracts.py'] });
  const head = snapshot({ owners, roots: { react: [root] }, rootSuites: ['tests/test_contracts.py'] });
  const directRoot = plan(base, head, [{ status: 'M', oldPath: 'tests/test_contracts.ts', newPath: 'tests/test_contracts.ts' }]);
  assert.equal(directRoot.scope, 'full');
  const outOfScope = plan(base, head, [{ status: 'M', oldPath: 'skills/public/engineering/alpha/SKILL.md', newPath: 'skills/public/engineering/alpha/SKILL.md' }]);
  assert.equal(outOfScope.scope, 'full');
  assert.ok(outOfScope.selectedSuites.includes('react'));
  assert.ok(outOfScope.selectedSuites.includes('alpha'));
  assert.ok(outOfScope.selectedSuites.includes('tests/test_contracts.py'));
  assert.ok(ownerFile);
});

test('current package, catalog, floor, and dependency files prove an eligible React edit is scoped', () => {
  const readJson = (path: string): unknown => JSON.parse(readFileSync(join(process.cwd(), path), 'utf8'));
  const current = {
    packageFiles: readJson('packaging/package-files.json'),
    catalog: readJson('contracts/skill-catalog.json'),
    deletionFloors: readJson('contracts/ts-migration/deletion-floors.json'),
    dependencies: readJson('contracts/contract-suite-dependencies.json'),
  } satisfies PlannerSnapshot;
  const changed = 'skills/public/engineering/react-performance/SKILL.md';
  const result = plan(current, current, [{ status: 'M', oldPath: changed, newPath: changed }]);
  assert.equal(result.scope, 'scoped', result.reasons.join('\n'));
  assert.equal(result.execution, 'selected');
  assert.deepEqual(result.selectedSuites, ['react']);
  assert.deepEqual(result.expectedOwningLabels, ['skills/react']);
  assert.deepEqual(result.expectedRootSuites, []);
});

function write(root: string, path: string, content: string): void {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
}
function git(root: string, args: string[]): string {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.trim();
}
function gitFixtureSnapshot(root: string, references: string[]) {
  const sourceRoot = 'skills/public/engineering/react-performance';
  const files = [
    { source: `${sourceRoot}/SKILL.md`, target: 'skills/react/SKILL.md' },
    { source: `${sourceRoot}/tests/run_tests.ts`, target: 'skills/react/tests/run_tests.ts' },
    ...references.map(path => ({ source: path, target: `skills/react/${path.slice(sourceRoot.length + 1)}` })),
  ];
  write(root, 'packaging/package-files.json', JSON.stringify({ schemaVersion: 1, files }, null, 2) + '\n');
  write(root, 'contracts/skill-catalog.json', JSON.stringify({ schemaVersion: 1, sourceLayout: 'hierarchical', categories: ['engineering'], entries: [{ owner: 'react', name: 'react-performance', aliases: ['react'], visibility: 'public', category: 'engineering' }] }, null, 2) + '\n');
  write(root, 'contracts/ts-migration/deletion-floors.json', JSON.stringify({ schemaVersion: 1, floors: { 'skills/react': 6 } }, null, 2) + '\n');
  write(root, 'contracts/contract-suite-dependencies.json', JSON.stringify({ schemaVersion: 1, eligibleSourceRoots: { react: [sourceRoot] }, ownerConsumers: { react: [] }, rootConsumers: { react: [] } }, null, 2) + '\n');
  write(root, `${sourceRoot}/SKILL.md`, 'body\n');
  write(root, `${sourceRoot}/tests/run_tests.ts`, 'console.log("suite");\n');
  for (const reference of references) write(root, reference, 'same body\n');
}

test('Git CLI resolves HEAD and preserves exact rename and deletion diff identifiers', t => {
  const root = mkdtempSync(join(tmpdir(), 'jstack-selector-git-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, ['init', '-q']);
  const sourceRoot = 'skills/public/engineering/react-performance';
  const oldReference = `${sourceRoot}/references/old.md`, removedReference = `${sourceRoot}/references/removed.md`;
  gitFixtureSnapshot(root, [oldReference, removedReference]);
  git(root, ['add', '.']);
  git(root, ['-c', 'user.name=Planner Test', '-c', 'user.email=validation@example.invalid', 'commit', '-qm', 'base']);
  const base = git(root, ['rev-parse', 'HEAD']);

  const newReference = `${sourceRoot}/references/new reference.md`;
  renameSync(join(root, oldReference), join(root, newReference));
  rmSync(join(root, removedReference));
  gitFixtureSnapshot(root, [newReference]);
  git(root, ['add', '-A']);
  git(root, ['-c', 'user.name=Planner Test', '-c', 'user.email=validation@example.invalid', 'commit', '-qm', 'rename and delete']);
  const head = git(root, ['rev-parse', 'HEAD']);

  const result = createContractSuitePlan({ root, base, head: 'HEAD', mode: 'enforce' });
  assert.equal(result.headCommit, head);
  assert.match(result.headTree ?? '', /^[0-9a-f]{40,64}$/);
  assert.match(result.baseTree ?? '', /^[0-9a-f]{40,64}$/);
  assert.ok(result.diff.some(row => row.status.startsWith('R') && row.oldPath === oldReference && row.newPath === newReference), JSON.stringify(result.diff));
  assert.ok(result.diff.some(row => row.status === 'D' && row.oldPath === removedReference), JSON.stringify(result.diff));
  assert.deepEqual(result.changedPaths, [newReference, oldReference, removedReference, 'packaging/package-files.json'].sort());
  assert.equal(result.scope, 'full', 'membership inventory changes are globally significant');
  assert.equal(result.execution, 'full');
});

test('unresolvable Git identities produce a valid full fallback plan', () => {
  const result = createContractSuitePlan({ root: process.cwd(), base: 'missing-base-ref', head: 'HEAD', mode: 'enforce' });
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.scope, 'full');
  assert.equal(result.execution, 'full');
  assert.equal(result.baseCommit, null);
  assert.match(result.reasons.join('\n'), /could not resolve both base and head/);
});
