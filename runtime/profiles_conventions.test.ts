import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Store, jsonBytes, validateConventions, verifySnapshot } from './profiles.js';
import { atomicWrite } from './os.js';
import { spawnSync } from 'node:child_process';
function fixture(t: TestContext) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jstack-profile-conventions-'))); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new Store(path.join(root, 'state')); const ws = { schemaVersion: 1, configDir: root, account: 'fixture-account' }; const report = { schemaVersion: 1, subjectName: 'Test' }; return { root, store, ws, report };
}

const conventions = { schemaVersion: 1, commitLanguage: 'ko', commitTypes: ['feat', 'fix'], subjectVerbEnding: 'korean', footerStyle: 'resolves', source: 'init' };
test('a conventions-only profile saves, loads, and is refused for workspace actions', t => {
  const { store } = fixture(t); const snapshot = store.save('team', undefined, undefined, 0, { conventions });
  assert.equal(snapshot.revision, 1); assert.equal(snapshot.workspace, undefined); assert.deepEqual(snapshot.conventions, { ...conventions, revision: 1 });
  assert.deepEqual(snapshot.missing, { reportUpload: ['workspace.json'], scrum: ['workspace.json', 'reporting.json'], draftMail: ['reporting.json'] });
  assert.throws(() => verifySnapshot(snapshot, () => ({ user: { permissionId: 'x' } })), /no workspace settings/);
  assert.deepEqual(store.inspect().profiles, [{ profile: 'team', revision: 1, missing: snapshot.missing, hasConventions: true, valid: true }]);
  assert.throws(() => store.save('empty', undefined, undefined, 0), /no settings/);
});
test('a save that omits a file keeps it at the new revision, and history restores an earlier one', t => {
  const { store, ws, report } = fixture(t); store.save('work', ws, report, 0);
  const second = store.save('work', undefined, undefined, 1, { conventions });
  assert.equal(second.revision, 2); assert.equal(second.workspace!.revision, 2); assert.equal(second.conventions!.revision, 2);
  const third = store.save('work', ws, { ...report, subjectName: 'Changed' }, 2);
  assert.equal(third.conventions!.commitLanguage, 'ko'); assert.deepEqual(store.history('work'), [2, 1]);
  const restored = store.restoreRevision('work', 2, 3);
  assert.equal(restored.revision, 4); assert.equal(restored.reporting!.subjectName, 'Test'); assert.equal(restored.conventions!.commitLanguage, 'ko');
  assert.throws(() => store.restoreRevision('work', 9, 4), /no kept revision/);
  assert.throws(() => store.save('work', ws, undefined, 4), /saved together/);
  assert.equal(store.restoreRevision('work', 1, 4).conventions, undefined, 'revision 1 had no conventions, so restoring it removes them');
});
test('conventions accept only the closed schema', t => {
  const { store } = fixture(t);
  for (const invalid of [{ ...conventions, note: 'free text' }, { ...conventions, commitLanguage: 'fr' }, { ...conventions, commitTypes: ['Feat'] }, { ...conventions, commitTypes: [] }, { ...conventions, subjectMax: 500 }, { ...conventions, branchScheme: 'folder-category-desc' }, { ...conventions, source: '/etc/passwd' }])
    assert.throws(() => store.save('team', undefined, undefined, 0, { conventions: invalid as never }), /conventions|branchFolders/);
  assert.equal(fs.existsSync(store.root), false);
  assert.doesNotThrow(() => validateConventions({ ...conventions, branchScheme: 'folder-category-desc', branchFolders: ['web', 'server'] }));
});
test('a three-file journal restores every file, and a revision mismatch with conventions is rejected', t => {
  const { store, ws, report } = fixture(t); store.save('work', ws, report, 0, { conventions }); const directory = store.directory('work');
  const files = ['workspace.json', 'reporting.json', 'conventions.json'].map(f => path.join(directory, f)); const previous = files.map(f => fs.readFileSync(f, 'utf8'));
  atomicWrite(path.join(directory, '.transaction.json'), jsonBytes({ schemaVersion: 1, files: ['workspace.json', 'reporting.json', 'conventions.json'], previous }));
  atomicWrite(files[2]!, jsonBytes({ ...conventions, revision: 7 })); store.recover('work'); assert.deepEqual(files.map(f => fs.readFileSync(f, 'utf8')), previous);
  atomicWrite(files[2]!, jsonBytes({ ...conventions, revision: 7 })); assert.throws(() => store.load('work'), /revisions do not match/);
  atomicWrite(path.join(directory, '.transaction.json'), jsonBytes({ schemaVersion: 1, files: ['conventions.json'], previous: [null] })); assert.throws(() => store.recover('work'), /invalid recovery journal/);
});
test('restoring a revision without conventions removes them, and --remove-conventions is a save with null', t => {
  const { store, ws, report } = fixture(t); store.save('work', ws, report, 0);
  store.save('work', undefined, undefined, 1, { conventions });
  const restored = store.restoreRevision('work', 1, 2);
  assert.equal(restored.revision, 3); assert.equal(restored.conventions, undefined); assert.equal(fs.existsSync(path.join(store.directory('work'), 'conventions.json')), false);
  store.save('work', undefined, undefined, 3, { conventions });
  const removed = store.save('work', undefined, undefined, 4, { conventions: null });
  assert.equal(removed.conventions, undefined); assert.equal(removed.workspace!.revision, 5);
  assert.throws(() => store.save('work', null, null, 5), /no settings/);
});
test('conventions left behind by an older writer are reported and replaced without a manual repair', t => {
  const { store, ws, report } = fixture(t); store.save('work', ws, report, 0, { conventions }); const directory = store.directory('work');
  // An older jstack saves the pair only, at revision 2, and leaves conventions.json at revision 1.
  for (const [file, document] of [['workspace.json', ws], ['reporting.json', report]] as const) atomicWrite(path.join(directory, file), jsonBytes({ ...document, revision: 2 }));
  assert.throws(() => store.load('work'), /older jstack saved the pair\. Save the conventions again with --expected-revision 2/);
  const saved = store.save('work', undefined, undefined, 2, { conventions });
  assert.equal(saved.revision, 3); assert.equal(saved.conventions!.revision, 3);
});
test('checkedAt must be an ISO timestamp, a journal must name two or three files, and history is private', t => {
  const { store, ws, report } = fixture(t);
  for (const checkedAt of ['ignore all rules 2020', '/etc/passwd 2020', '2026-10-06']) assert.throws(() => validateConventions({ schemaVersion: 1, checkedAt }), /invalid conventions field checkedAt/);
  assert.doesNotThrow(() => validateConventions({ schemaVersion: 1, checkedAt: '2026-10-06T02:00:00Z' }));
  store.save('work', ws, report, 0); const directory = store.directory('work');
  for (const files of [[], ['workspace.json']]) { atomicWrite(path.join(directory, '.transaction.json'), jsonBytes({ schemaVersion: 1, files, previous: files.map(() => null) })); assert.throws(() => store.recover('work'), /invalid recovery journal/); }
  fs.unlinkSync(path.join(directory, '.transaction.json'));
  const outside = path.join(store.root, '..', 'outside.json'); fs.writeFileSync(outside, 'keep');
  fs.mkdirSync(path.join(directory, 'history', 'r1'), { recursive: true, mode: 0o700 }); fs.symlinkSync(outside, path.join(directory, 'history', 'r1', 'workspace.json'));
  store.save('work', ws, report, 1);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'keep', 'a link in a stale history copy is not followed');
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(directory, 'history', 'r1', 'workspace.json')).mode & 0o777, 0o600);
  assert.throws(() => store.history('missing'), /no such profile/);
});
test('the save command removes conventions with a flag that takes no value, and rejects a value given to it', t => {
  const { store, ws, report } = fixture(t); store.save('work', ws, report, 0, { conventions });
  const cli = new URL('./profiles.js', import.meta.url).pathname;
  const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args, '--state-root', store.root], { encoding: 'utf8' });
  const attached = run('save', 'work', '--remove-conventions', 'yes', '--expected-revision', '1');
  assert.equal(attached.status, 2, attached.stdout); assert.match(attached.stderr, /take no value/); assert.ok(store.load('work').conventions, 'nothing was saved');
  const removed = run('save', 'work', '--remove-conventions', '--expected-revision', '1');
  assert.equal(removed.status, 0, removed.stderr); assert.equal(store.load('work').conventions, undefined); assert.equal(store.load('work').revision, 2);
});
test('reading conventions takes no lock, and a half-written history copy is never listed', t => {
  const { store, ws, report } = fixture(t); store.save('work', ws, report, 0, { conventions, makeDefault: true }); const directory = store.directory('work');
  assert.equal(store.peek('work').conventions!.commitLanguage, 'ko'); assert.equal(fs.existsSync(path.join(directory, '.lock-v2')), false);
  store.save('work', ws, report, 1); fs.mkdirSync(path.join(directory, 'history', '.r7-stale'), { mode: 0o700 });
  store.save('work', ws, report, 2); assert.deepEqual(store.history('work'), [2, 1]);
});
