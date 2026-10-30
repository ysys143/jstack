import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkBranch, checkMessage } from '../scripts/check_commit.js';
import { DEFAULT_CONVENTIONS } from '../../../../runtime/conventions.js';

const script = fileURLToPath(new URL('../scripts/check_commit.js', import.meta.url));
/** Every spawn gets a temporary home and none of the caller's profile selections, so a developer's own profile never changes a verdict. */
function isolated(home: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home, ...extra }; delete env.JSTACK_PROFILE; if (!('JSTACK_CONVENTIONS_FILE' in extra)) delete env.JSTACK_CONVENTIONS_FILE; return env;
}
test('invalid arguments, missing staged files, and non-repositories cannot report a pass', () => {
  const root = mkdtempSync(join(tmpdir(), 'jstack-gitrules-negative-'));
  try {
    for (const args of [[], ['--message'], ['--staged', '--branch'], ['--staged'], ['--branch']]) {
      const result = spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: 'utf8', env: isolated(root) });
      assert.equal(result.status, 2, result.stdout + result.stderr); assert.doesNotMatch(result.stdout, /\[pass\]/);
    }
    mkdirSync(join(root, '.git')); writeFileSync(join(root, '.git/COMMIT_EDITMSG'), 'fix: preserve prepared subject\n\n# comment ignored\nReason.\n');
    const result = spawnSync(process.execPath, [script, '--staged'], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(checkMessage('feat: ' + '😀'.repeat(44)), []);
    assert.equal(checkBranch('feat/UPPER_CASE').length, 3);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

function conventionsFixture(document: Record<string, unknown>) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'jstack-gitrules-conventions-'))); const file = join(root, 'conventions.json');
  writeFileSync(file, JSON.stringify({ schemaVersion: 1, ...document })); chmodSync(file, 0o600); return { root, file };
}
test('profile conventions change the types, language, verb ending and footer that are checked', () => {
  const korean = { ...DEFAULT_CONVENTIONS, commitLanguage: 'ko' as const, subjectVerbEnding: 'korean' as const, footerStyle: 'resolves' as const, commitTypes: ['feat', 'fix', 'hotfix'] };
  assert.deepEqual(checkMessage('hotfix: 로그인 오류 수정', korean), []);
  assert.deepEqual(checkMessage('feat: add login', korean), ['description is not Korean (commitLanguage=ko)']);
  assert.match(checkMessage('feat: 로그인 화면', korean)[0]!, /does not end in an action noun/);
  assert.match(checkMessage('fix: 로그인 오류 수정\n\nbody\nFixes #12', korean)[0]!, /should be written `Resolves: #<n>`/);
  assert.deepEqual(checkMessage('fix: 로그인 오류 수정\n\nbody\nResolves: #12', korean), []);
  assert.deepEqual(checkMessage('hotfix: x'), ['type `hotfix` is outside the convention (allowed: feat, fix, refactor, test, docs, chore, style, remove, perf)']);
  assert.deepEqual(checkBranch('hotfix/login', { ...DEFAULT_CONVENTIONS, branchTypes: ['feat', 'hotfix'] }), []);
});
test('a conventions file is applied and named in the verdict; --defaults ignores it', () => {
  const { root, file } = conventionsFixture({ commitLanguage: 'ko', commitTypes: ['feat'] });
  try {
    const env = isolated(root, { JSTACK_CONVENTIONS_FILE: file });
    const korean = spawnSync(process.execPath, [script, '--message', 'feat: 기능 추가'], { cwd: root, encoding: 'utf8', env });
    assert.equal(korean.status, 0, korean.stdout + korean.stderr); assert.match(korean.stdout, /\[pass\] commit message \(conventions: file:/);
    const english = spawnSync(process.execPath, [script, '--message', 'feat: add feature'], { cwd: root, encoding: 'utf8', env });
    assert.equal(english.status, 1); assert.match(english.stdout, /not Korean/);
    const defaults = spawnSync(process.execPath, [script, '--defaults', '--message', 'feat: add feature'], { cwd: root, encoding: 'utf8', env });
    assert.equal(defaults.status, 0); assert.equal(defaults.stdout, '[pass] commit message\n');
    writeFileSync(file, '{broken'); const broken = spawnSync(process.execPath, [script, '--message', 'feat: add feature'], { cwd: root, encoding: 'utf8', env });
    assert.equal(broken.status, 2, 'a broken conventions file is a usage error, not a rule violation'); assert.match(broken.stderr, /JSTACK_CONVENTIONS_FILE/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
