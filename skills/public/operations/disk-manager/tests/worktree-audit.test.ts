/** The worktree audit against a temporary repository with linked worktrees: read-only, no network, no clock waits. */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { auditWorktrees, parseStatus, parseWorktreeList } from '../scripts/worktree_audit.js';
import { fixture } from './_fixtures.js';

const identity = { GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
const git = (cwd: string, ...args: string[]) => {
  const run = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...identity } });
  assert.equal(run.status, 0, `git ${args.join(' ')}: ${run.stderr}`);
  return run.stdout;
};
/** A repository on `main` with three linked worktrees: merged and clean, ahead with edits, and ahead but clean. */
const repository = (root: string) => {
  const repo = join(root, 'repo'); mkdirSync(repo);
  git(repo, 'init', '--quiet', '--initial-branch=main'); writeFileSync(join(repo, 'a.txt'), 'one\n'); git(repo, 'add', 'a.txt'); git(repo, 'commit', '--quiet', '-m', 'first');
  const merged = join(root, 'merged'), dirty = join(root, 'dirty'), ahead = join(root, 'ahead');
  git(repo, 'worktree', 'add', '--quiet', '-b', 'merged-topic', merged);
  git(repo, 'worktree', 'add', '--quiet', '-b', 'dirty-topic', dirty);
  git(repo, 'worktree', 'add', '--quiet', '-b', 'ahead-topic', ahead);
  writeFileSync(join(dirty, 'a.txt'), 'edited\n'); writeFileSync(join(dirty, 'scratch.txt'), 'new\n');
  writeFileSync(join(ahead, 'b.txt'), 'two\n'); git(ahead, 'add', 'b.txt'); git(ahead, 'commit', '--quiet', '-m', 'second');
  return { repo, merged, dirty, ahead };
};

test('worktree audit reports merge state, tracked and untracked edits, and removes nothing', () => {
  const root = fixture();
  try {
    const { repo, merged, dirty, ahead } = repository(root);
    const before = git(repo, 'worktree', 'list', '--porcelain');
    const report = auditWorktrees(repo, { useGh: false, env: identity });
    const byBranch = Object.fromEntries(report.worktrees.map(item => [item.branch, item]));
    assert.equal(report.base, 'main');
    assert.equal(report.worktrees.length, 4);
    assert.equal(byBranch.main.primary, true); assert.equal(byBranch.main.candidateForUserReview, false);
    assert.equal(byBranch['merged-topic'].mergeState.mergedIntoBase, true); assert.equal(byBranch['merged-topic'].candidateForUserReview, true);
    assert.equal(byBranch['dirty-topic'].trackedChanges, 1); assert.equal(byBranch['dirty-topic'].untrackedFiles, 1);
    assert.deepEqual(byBranch['dirty-topic'].untrackedSample, ['scratch.txt']); assert.equal(byBranch['dirty-topic'].candidateForUserReview, false);
    assert.equal(byBranch['ahead-topic'].mergeState.mergedIntoBase, false); assert.equal(byBranch['ahead-topic'].mergeState.aheadOfBase, 1);
    assert.ok(byBranch['ahead-topic'].blockers.some((reason: string) => /not in main/.test(reason)), byBranch['ahead-topic'].blockers.join('; '));
    assert.deepEqual(byBranch['merged-topic'].pullRequests, { status: 'skipped', reason: 'gh lookup disabled' });
    // Read-only: every worktree, the edits and the worktree list are exactly as they were.
    for (const path of [merged, dirty, ahead]) assert.ok(existsSync(path));
    assert.equal(readFileSync(join(dirty, 'a.txt'), 'utf8'), 'edited\n');
    assert.equal(git(repo, 'worktree', 'list', '--porcelain'), before);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a merged pull request reported by gh clears the squash-merge blocker', { skip: process.platform === 'win32' ? 'the stub gh is a shell script' : false }, () => {
  const root = fixture();
  try {
    const { repo } = repository(root), bin = join(root, 'bin'), gh = join(bin, 'gh'); mkdirSync(bin);
    writeFileSync(gh, `#!/bin/sh\nif [ "$4" = "ahead-topic" ]; then echo '[{"number":7,"state":"MERGED","url":"https://example.invalid/pull/7"}]'; else echo '[]'; fi\n`); chmodSync(gh, 0o755);
    const report = auditWorktrees(repo, { env: { ...identity, PATH: `${bin}:${process.env.PATH}` } });
    const ahead = report.worktrees.find(item => item.branch === 'ahead-topic')!;
    assert.deepEqual(ahead.pullRequests, { status: 'ok', pulls: [{ number: 7, state: 'MERGED', url: 'https://example.invalid/pull/7' }] });
    assert.equal(ahead.candidateForUserReview, true, ahead.blockers.join('; '));
    const dirty = report.worktrees.find(item => item.branch === 'dirty-topic')!;
    assert.deepEqual(dirty.pullRequests, { status: 'ok', pulls: [] }); assert.equal(dirty.candidateForUserReview, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a failing gh is reported as unavailable, not guessed', { skip: process.platform === 'win32' ? 'the stub gh is a shell script' : false }, () => {
  const root = fixture();
  try {
    const { repo } = repository(root), bin = join(root, 'bin'), gh = join(bin, 'gh'); mkdirSync(bin);
    writeFileSync(gh, '#!/bin/sh\necho "not logged in" >&2\nexit 4\n'); chmodSync(gh, 0o755);
    const report = auditWorktrees(repo, { env: { ...identity, PATH: `${bin}:${process.env.PATH}` } });
    const merged = report.worktrees.find(item => item.branch === 'merged-topic')!;
    assert.equal(merged.pullRequests.status, 'unavailable'); assert.match(JSON.stringify(merged.pullRequests), /not logged in/); assert.equal(merged.mergeState.mergedIntoBase, true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('parsers handle porcelain output', () => {
  assert.deepEqual(parseWorktreeList('worktree /r\nHEAD abc\nbranch refs/heads/main\n\nworktree /w\nHEAD def\ndetached\nlocked reason\n').map(item => [item.path, item.branch, item.primary, item.locked]), [['/r', 'main', true, false], ['/w', null, false, true]]);
  assert.deepEqual(parseStatus(' M a.txt\0R  new.txt\0old.txt\0?? u.txt\0!! ignored.txt\0'), { tracked: 2, untracked: ['u.txt'] });
});
