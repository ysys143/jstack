import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Store } from './profiles.js';
import { DEFAULT_CONVENTIONS, ConventionsError, choicePath, describeConflict, effectiveConventions, loadConventions, observeLanguage, recordChoice } from './conventions.js';

function fixture(t: TestContext) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jstack-conventions-'))); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new Store(path.join(root, 'state')), repo = path.join(root, 'repo'); fs.mkdirSync(repo);
  spawnSync('git', ['init', '-q'], { cwd: repo });
  return { root, store, repo, env: { HOME: root } as NodeJS.ProcessEnv };
}
const english = Array.from({ length: 12 }, (_, i) => `feat: add part ${i}`), korean = Array.from({ length: 12 }, (_, i) => `feat: 기능 ${i} 추가`);
const mixed = [...english.slice(0, 9), ...korean.slice(0, 3)];
const workspace = (root: string) => ({ schemaVersion: 1, configDir: root, account: 'synthetic' });

test('defaults apply without state, without a profile, or without conventions in the profile', t => {
  const { store, env } = fixture(t);
  assert.deepEqual(loadConventions({ stateRoot: store.root, env }), { values: { ...DEFAULT_CONVENTIONS }, source: 'default', warnings: [] });
  store.save('work', workspace(store.root), { schemaVersion: 1 }, 0, { makeDefault: true });
  const plain = loadConventions({ stateRoot: store.root, env });
  assert.equal(plain.source, 'default'); assert.deepEqual(plain.warnings, []);
  store.save('work', undefined, undefined, 1, { conventions: { schemaVersion: 1, commitLanguage: 'ko', commitTypes: ['feat'] } });
  const loaded = loadConventions({ stateRoot: store.root, env });
  assert.equal(loaded.source, 'profile:work'); assert.equal(loaded.revision, 2); assert.equal(loaded.values.commitLanguage, 'ko'); assert.deepEqual(loaded.values.commitTypes, ['feat']); assert.equal(loaded.values.subjectMax, 50);
  assert.equal(loadConventions({ stateRoot: store.root, env: { JSTACK_PROFILE: 'missing' } }).source, 'default');
});

test('a broken conventions file for tests is a usage error, not a silent default', t => {
  const { root } = fixture(t); const file = path.join(root, 'conventions.json');
  fs.writeFileSync(file, '{not json', { mode: 0o600 });
  assert.throws(() => loadConventions({ env: { JSTACK_CONVENTIONS_FILE: file } }), ConventionsError);
  fs.writeFileSync(file, JSON.stringify({ schemaVersion: 1, note: 'free text' }), { mode: 0o600 });
  assert.throws(() => loadConventions({ env: { JSTACK_CONVENTIONS_FILE: file } }), /unknown conventions field/);
});

test('observation needs ten subjects and a clear majority', () => {
  assert.equal(observeLanguage(english.slice(0, 9)).language, 'unknown');
  assert.equal(observeLanguage(english).language, 'en'); assert.equal(observeLanguage(korean).language, 'ko');
  assert.equal(observeLanguage([...english.slice(0, 6), ...korean.slice(0, 6)]).language, 'mixed');
});

test('a profile that disagrees with the repository is a decision with state, recommendation and rollback', t => {
  const { store, repo, env } = fixture(t);
  store.save('team', undefined, undefined, 0, { makeDefault: true, conventions: { schemaVersion: 1, commitLanguage: 'ko', subjectVerbEnding: 'korean' } });
  const loaded = loadConventions({ stateRoot: store.root, env });
  assert.equal(effectiveConventions(repo, loaded, korean).conflict, undefined);
  assert.equal(effectiveConventions(repo, loaded, mixed).conflict, undefined);
  const effective = effectiveConventions(repo, loaded, english);
  assert.deepEqual(effective.conflict?.fields, ['commitLanguage']); assert.equal(effective.conflict?.recommendation, 'repository');
  const text = describeConflict(effective).join('\n');
  assert.match(text, /Current state: profile team \(revision 1\) sets commitLanguage=ko; 12 of the last 12 commit subjects here are English/);
  assert.match(text, /Recommendation: repository/); assert.match(text, /jst profiles restore team --revision N --expected-revision 1/);
  assert.match(text, /--remove-conventions --expected-revision 1/); assert.match(text, /do not choose for them/);
  assert.throws(() => recordChoice(repo, 'profile', effectiveConventions(repo, loaded, korean)), /no conventions conflict/);
});

test('a recorded choice holds through mixed history and unrelated saves, and is asked again only when it no longer fits', t => {
  const { store, repo, env } = fixture(t);
  store.save('team', workspace(store.root), { schemaVersion: 1 }, 0, { makeDefault: true, conventions: { schemaVersion: 1, commitLanguage: 'ko', subjectVerbEnding: 'korean' } });
  const loaded = loadConventions({ stateRoot: store.root, env });
  const record = recordChoice(repo, 'repository', effectiveConventions(repo, loaded, english));
  assert.equal(record.observed, 'en'); assert.ok(fs.existsSync(choicePath(repo)!));
  for (const subjects of [english, mixed, english.slice(0, 3)]) {
    const decided = effectiveConventions(repo, loaded, subjects);
    assert.equal(decided.conflict, undefined); assert.equal(decided.values.commitLanguage, 'en'); assert.equal(decided.values.subjectVerbEnding, 'none');
  }
  const turned = effectiveConventions(repo, loaded, korean);
  assert.equal(turned.choice, undefined, 'a history that turned Korean no longer fits a choice recorded for English history'); assert.equal(turned.values.commitLanguage, 'ko');
  store.save('team', { ...workspace(store.root), driveId: 'synthetic-drive' }, { schemaVersion: 1 }, 1);
  assert.equal(effectiveConventions(repo, loadConventions({ stateRoot: store.root, env }), english).choice?.choice, 'repository', 'a save that changes only workspace settings keeps the choice');
  store.save('team', undefined, undefined, 2, { conventions: { schemaVersion: 1, commitLanguage: 'ko' } });
  assert.ok(effectiveConventions(repo, loadConventions({ stateRoot: store.root, env }), english).conflict, 'changed conventions ask again');
});

test('the automatic commit language is part of the conflict', t => {
  const { store, repo, env } = fixture(t);
  store.save('team', undefined, undefined, 0, { makeDefault: true, conventions: { schemaVersion: 1, commitLanguage: 'en', autocommitLanguage: 'ko' } });
  const effective = effectiveConventions(repo, loadConventions({ stateRoot: store.root, env }), english);
  assert.deepEqual(effective.conflict?.fields, ['autocommitLanguage']);
  assert.match(describeConflict(effective).join('\n'), /sets autocommitLanguage=ko/);
});

test('linked worktrees share one choice', t => {
  const { root, repo } = fixture(t);
  spawnSync('git', ['-c', 'user.email=fixture@example.invalid', '-c', 'user.name=Fixture', 'commit', '-q', '--allow-empty', '-m', 'chore: seed'], { cwd: repo });
  const linked = path.join(root, 'linked'); assert.equal(spawnSync('git', ['worktree', 'add', '-q', '--detach', linked], { cwd: repo }).status, 0);
  assert.equal(choicePath(linked), choicePath(repo));
});
