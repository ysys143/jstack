import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dateValue, localDate, makeScope, scopeList, shiftDate } from '../scripts/collection-common.js';
import { collect as collectMtime } from '../scripts/collect_by_mtime.js';

const entry = (name: string) => fileURLToPath(new URL(name, new URL('../scripts/', import.meta.url)));
function fixture() {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'jstack-workspace-')), home = join(root, 'home'), projects = join(root, 'projects'), bin = join(root, 'bin'), calls = join(root, 'calls.jsonl');
  for (const path of [home, projects, bin]) mkdirSync(path, { mode: 0o700 });
  const env = { ...process.env, HOME: home, USERPROFILE: home, PATH: bin, GITHUB_DIR: projects, JSTACK_PROFILE: 'fixture', SCRUM_REPOS: '', SCRUM_EXCLUDE: '', SCRUM_LOG_DIR: '', SCRUM_MAIL_TO: '', SCRUM_SHEET_URL: '', LOG: calls, GIT_COLLECT_AUTHOR: '' };
  const fake = (name: string, body: string) => { const path = join(bin, name); writeFileSync(path, `#!${process.execPath}\nconst fs = require('node:fs'); let input = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', s => input += s); process.stdin.on('end', () => { fs.appendFileSync(process.env.LOG, JSON.stringify({ name: ${JSON.stringify(name)}, args: process.argv.slice(2), input, accountConfig: process.env.GOOGLE_WORKSPACE_CLI_CONFIG_DIR }) + '\\n'); ${body} });\n`); chmodSync(path, 0o755); };
  const run = (name: string, args: string[], overrides: NodeJS.ProcessEnv = {}) => spawnSync(process.execPath, [entry(name), ...args], { cwd: root, env: { ...env, ...overrides }, encoding: 'utf8', timeout: 15_000 });
  const records = () => existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n').map(row => JSON.parse(row)) : [];
  const write = (file: string, value = 'fixture') => { const path = join(projects, file); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, value); return path; };
  return { root, home, projects, bin, env, fake, run, records, write, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
test('calendar boundaries and scoped paths reject malformed dates, ambiguity and aliases', { skip: process.platform === 'win32' }, () => {
  const f = fixture();
  try {
    assert.equal(shiftDate('2024-03-01', -1), '2024-02-29'); assert.throws(() => dateValue('2025-02-29')); assert.throws(() => dateValue('2026-1-1'));
    f.write('work/private/deep/secret'); f.write('work/normal'); f.write('space name/file');
    const scope = makeScope(f.projects, 'work', 'private'); assert.equal(scope(join(f.projects, 'work')), true); assert.equal(scope(join(f.projects, 'work/private/deep')), false);
    symlinkSync(join(f.projects, 'work/private'), join(f.projects, 'alias')); assert.equal(scope(join(f.projects, 'alias')), false);
    assert.deepEqual(scopeList('space name', f.projects, 'SCRUM_REPOS'), ['space name']); assert.throws(() => scopeList('space name missing', f.projects, 'SCRUM_REPOS'), /ambiguous spacing/);
  } finally { f.cleanup(); }
});
test('mtime collection handles spaces, excludes generated trees and Git worktrees, and writes no source data', () => {
  const f = fixture();
  try {
    f.write('project space/README.md', 'first\nsecond\nthird\nfourth\n'); f.write('project space/recent.txt'); f.write('project space/node_modules/hidden');
    f.write('worktree/.git', 'gitdir: elsewhere'); f.write('worktree/never.md'); f.write('old/stale');
    utimesSync(join(f.projects, 'old/stale'), new Date('2000-01-01'), new Date('2000-01-01'));
    const before = readFileSync(join(f.projects, 'project space/recent.txt'));
    const text = collectMtime('2020-01-01', f.projects); assert.match(text, /## project space/); assert.match(text, /> first\n> second\n> third/); assert.doesNotMatch(text, /fourth|node_modules|never.md|## old/);
    assert.deepEqual(readFileSync(join(f.projects, 'project space/recent.txt')), before);
    assert.equal(f.run('./collect_by_mtime.js', []).status, 2); assert.equal(f.run('./collect_by_mtime.js', ['not-a-date']).status, 2);
  } finally { f.cleanup(); }
});
test('Git collection matches the shell oracle on a real isolated repository', () => {
  const f = fixture();
  try {
    const repo = join(f.projects, 'repo with spaces'); mkdirSync(repo);
    const env = { ...process.env, HOME: f.home, USERPROFILE: f.home, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid', GIT_AUTHOR_DATE: '2026-01-02T12:00:00Z', GIT_COMMITTER_DATE: '2026-01-02T12:00:00Z', GITHUB_DIR: f.projects, GIT_COLLECT_AUTHOR: '' };
    for (const args of [['init', '-q', repo], ['-C', repo, '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-q', '-m', 'fixture title']]) { const result = spawnSync('git', args, { env, encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); }
    const args = ['2026-01-01', '2026-01-03'];
    const js = spawnSync(process.execPath, [entry('./collect_git.js'), ...args], { env, encoding: 'utf8' }); assert.equal(js.status, 0, js.stderr); assert.match(js.stdout, /fixture title/);
  } finally { f.cleanup(); }
});
test('Git failures remain incomplete and author fragments remain one literal argument', { skip: process.platform === 'win32' }, () => {
  const f = fixture();
  try {
    mkdirSync(join(f.projects, 'repo/.git'), { recursive: true }); f.fake('git', "process.stderr.write('failed'); process.exitCode=7;");
    const result = f.run('./collect_git.js', ['2026-01-01', '2026-01-03'], { GIT_COLLECT_AUTHOR: 'literal; $(touch injected)' }); assert.equal(result.status, 1); assert.match(result.stderr, /Incomplete Git collection/);
    assert.ok(f.records()[0].args.includes('--author=literal; $(touch injected)')); assert.equal(existsSync(join(f.root, 'injected')), false);
  } finally { f.cleanup(); }
});
test('gws readiness distinguishes missing, wrong tool, no account, configured, and failed executable', { skip: process.platform === 'win32' }, () => {
  const f = fixture();
  try {
    assert.equal(f.run('./ensure_gws.js', []).status, 2);
    f.fake('gws', "process.stdout.write(process.argv[2] === '--version' ? 'gws 1.2.3\\n' : 'workspace tool\\n');"); assert.match(f.run('./ensure_gws.js', []).stdout, /\[2\] wrong tool/);
    f.fake('gws', "process.stdout.write(process.argv[2] === '--version' ? 'gws 1.2.3\\n' : 'auth login\\n');"); assert.equal(f.run('./ensure_gws.js', []).status, 1);
    mkdirSync(join(f.home, '.config/gws-fixture'), { recursive: true }); writeFileSync(join(f.home, '.config/gws-fixture/credential.json'), '{}'); const ready = f.run('./ensure_gws.js', []); assert.equal(ready.status, 0); assert.match(ready.stdout, /gws-fixture/);
    f.fake('gws', "process.stdout.write('auth'); process.exitCode=4;"); assert.equal(f.run('./ensure_gws.js', []).status, 2);
  } finally { f.cleanup(); }
});
