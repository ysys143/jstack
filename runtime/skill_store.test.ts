import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawnSync } from 'node:child_process';
import { Placement, treeDigest, verifyOwnershipDigest } from './skill_store.js';
function fixture(t: TestContext) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jstack-placement-'))); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const project = path.join(root, '한글 project'); const source = path.join(root, 'source'); fs.mkdirSync(project); fs.mkdirSync(source);
  assert.equal(spawnSync('git', ['init', '-q', project]).status, 0); fs.writeFileSync(path.join(source, 'SKILL.md'), '---\nname: example\ndescription: Fixture skill\n---\nContent\n', { mode: 0o644 });
  return { root, project, source, placement: new Placement('example', 'project', { project }) };
}
test('placement excludes local skills without changing index and connects canonical source', t => {
  const { source, placement, project } = fixture(t); const result = placement.place(source); assert.equal(result.sharing, 'local'); assert.equal(result.linked, true);
  assert.equal(fs.realpathSync(placement.link), fs.realpathSync(placement.canonical)); assert.equal(spawnSync('git', ['-C', project, 'diff', '--cached', '--exit-code']).status, 0);
  assert.equal(placement.place(source).digest, result.digest); assert.equal(placement.connect().sharing, 'unchanged');
});
test('share toggles only owned exclude block and retains user content', t => { const { placement, source } = fixture(t); fs.writeFileSync(placement.exclude!, '# user rule\nprivate/\n'); placement.place(source); placement.place(undefined, { shared: true }); assert.equal(fs.readFileSync(placement.exclude!, 'utf8'), '# user rule\nprivate/\n'); });
test('user skill edits cannot be overwritten by a subsequent placement', t => { const { placement, source } = fixture(t); placement.place(source); fs.appendFileSync(path.join(placement.canonical, 'SKILL.md'), '\nUser edit'); assert.throws(() => placement.place(source), /existing skill differs/); assert.match(fs.readFileSync(path.join(placement.canonical, 'SKILL.md'), 'utf8'), /User edit/); });
test('tracked skills cannot be silently untracked', t => { const { placement, source, project } = fixture(t); placement.place(source, { shared: true }); assert.equal(spawnSync('git', ['-C', project, 'add', '.agents', '.claude']).status, 0); assert.throws(() => placement.place(), /automatic untracking is forbidden/); assert.ok(placement.tracked().length); });
test('conflicting host directory is preserved', t => { const { placement, source } = fixture(t); fs.mkdirSync(placement.link, { recursive: true }); fs.writeFileSync(path.join(placement.link, 'mine'), 'user'); assert.throws(() => placement.place(source), /occupied/); assert.equal(fs.readFileSync(path.join(placement.link, 'mine'), 'utf8'), 'user'); });
test('source symlinks and equivalent Unicode/case names fail closed', t => { const { source, placement } = fixture(t); fs.writeFileSync(path.join(source, 'A'), 'a'); fs.writeFileSync(path.join(source, 'a'), 'a'); if (fs.readdirSync(source).includes('A') && fs.readdirSync(source).includes('a')) assert.throws(() => placement.place(source), /collision/); });
test('another ignore rule prevents sharing and rolls back new paths', t => { const { placement, project, source } = fixture(t); fs.writeFileSync(path.join(project, '.gitignore'), '.agents/\n'); assert.throws(() => placement.place(source, { shared: true }), /another ignore rule/); assert.equal(fs.existsSync(placement.canonical), false); assert.equal(fs.existsSync(placement.link), false); });
test('portable v2 digest omits host file modes; v1 receipts remain verifiable', t => {
  const { source } = fixture(t); const v1 = treeDigest(source, 1); const v2 = treeDigest(source, 2); assert.notEqual(v1, v2);
  assert.ok(verifyOwnershipDigest(source, { scope: 'project', digest: v1, shared: false, relativeTarget: 'fixture' }));
  if (process.platform !== 'win32') { fs.chmodSync(path.join(source, 'SKILL.md'), 0o600); assert.equal(treeDigest(source, 2), v2); assert.notEqual(treeDigest(source, 1), v1); }
});
test('global scope cannot request Git sharing', t => { const { root, source } = fixture(t); const placement = new Placement('example', 'global', { home: root }); assert.throws(() => placement.place(source, { shared: true }), /only to project/); });
test('static Python v1 hash fixture preserves UTF-8 bytes and component sorting', { skip: process.platform === 'win32' }, t => {
  const { root } = fixture(t); const source = path.join(root, 'legacy-fixture'); fs.mkdirSync(source); fs.mkdirSync(path.join(source, 'a'));
  for (const relative of ['SKILL.md', 'a/file', 'a.txt', '한글', '\u{10000}', '\ue000']) {
    const file = path.join(source, relative); fs.writeFileSync(file, relative === 'SKILL.md' ? '---\nname: example\ndescription: Fixture\n---\n한글\n' : relative, { mode: 0o644 });
  }
  // Generated by the previous Python tree_digest implementation; no Python test dependency.
  assert.equal(treeDigest(source, 1), 'a2bc149d438591e6a898e79da4d6cd41b732e889ea7decbda255c2a6d94c3974');
});

test('exclusive placement copies nested content into its reserved destination', t => {
  const { source, placement } = fixture(t);
  fs.mkdirSync(path.join(source, 'references', 'nested'), { recursive: true });
  fs.writeFileSync(path.join(source, 'references', 'nested', 'guide.md'), 'preserve nested content');
  fs.writeFileSync(path.join(source, '.config'), 'preserve dotfile');
  const before = treeDigest(source, 2), result = placement.place(source);
  assert.equal(result.digest, before); assert.equal(treeDigest(placement.canonical, 2), before);
  assert.equal(fs.readFileSync(path.join(placement.canonical, 'references', 'nested', 'guide.md'), 'utf8'), 'preserve nested content');
  assert.equal(placement.place(source).digest, before);
});

test('placement preserves the original copy error when rollback must retain changed data', async t => {
  const { source, placement } = fixture(t);
  const { default: nativeFs } = await import('node:fs');
  const { syncBuiltinESMExports } = await import('node:module');
  const original = nativeFs.cpSync;
  try {
    nativeFs.cpSync = () => { fs.writeFileSync(path.join(placement.canonical, 'user-note'), 'concurrent user data'); throw new Error('injected copy failure'); };
    syncBuiltinESMExports();
    assert.throws(() => placement.place(source), error => error instanceof AggregateError && error.errors[0].message === 'injected copy failure' && /user-modified skill/.test(error.errors[1].message));
    assert.equal(fs.readFileSync(path.join(placement.canonical, 'user-note'), 'utf8'), 'concurrent user data');
  } finally { nativeFs.cpSync = original; syncBuiltinESMExports(); }
});
