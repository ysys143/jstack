/**
 * Read-only audit of a repository's git worktrees. It lists each worktree with its merge state, tracked and untracked
 * edits and, when `gh` answers, its pull request state. It never removes, prunes, fetches or writes anything: the
 * report only says which worktrees the user could review for removal.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { isMain } from '../../../../../runtime/entry.js';
import { runProcess } from '../../../../../runtime/os.js';

export const HELP = `node worktree_audit.js [--repo DIR] [--base REF] [--no-gh]
Lists git worktrees with merge state, tracked and untracked edits and pull request state.
Read-only: nothing is removed, pruned, fetched or written. Output is JSON.
`;
const sampleLimit = 5;
const gitTimeoutMs = 30_000;
const ghTimeoutMs = 20_000;

export interface PullRequest { number: number; state: string; url: string }
export type PullRequestInfo = { status: 'skipped' | 'no-branch' | 'unavailable'; reason: string } | { status: 'ok'; pulls: PullRequest[] };
export interface WorktreeReport {
  path: string; head: string; branch: string | null; primary: boolean; locked: boolean; existsOnDisk: boolean;
  mergeState: { base: string | null; mergedIntoBase: boolean | null; aheadOfBase: number | null; unpushed: number | null };
  trackedChanges: number; untrackedFiles: number; untrackedSample: string[];
  pullRequests: PullRequestInfo;
  /** Reasons the user should look before removing this worktree; empty means nothing in the report blocks a review. */
  blockers: string[];
  candidateForUserReview: boolean;
}
/** `env` entries override the process environment for the git and gh child processes. */
export interface AuditOptions { base?: string; useGh?: boolean; env?: NodeJS.ProcessEnv }

/** GIT_OPTIONAL_LOCKS=0 stops `git status` from refreshing the index, so the audit leaves the repository untouched. */
const gitEnv = (env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv => ({ ...env, GIT_OPTIONAL_LOCKS: '0' });
function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv) {
  const run = runProcess('git', args, { cwd, env: gitEnv(env), timeout: gitTimeoutMs });
  return { ok: run.status === 0, status: run.status, stdout: String(run.stdout ?? ''), stderr: String(run.stderr ?? '') };
}

/** Parses `git worktree list --porcelain`: records are separated by blank lines and the first record is the primary tree. */
export function parseWorktreeList(text: string) {
  return text.split(/\n\n+/).map(block => block.trim()).filter(Boolean).map((block, index) => {
    const entry = { path: '', head: '', branch: null as string | null, locked: false, bare: false, primary: index === 0 };
    for (const line of block.split('\n')) {
      if (line.startsWith('worktree ')) entry.path = line.slice('worktree '.length);
      else if (line.startsWith('HEAD ')) entry.head = line.slice('HEAD '.length);
      else if (line.startsWith('branch ')) entry.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
      else if (line === 'bare') entry.bare = true;
      else if (line === 'locked' || line.startsWith('locked ')) entry.locked = true;
    }
    return entry;
  });
}

/** Splits `git status --porcelain=v1 -z` into tracked edits and untracked paths. A rename or copy carries a second path. */
export function parseStatus(text: string) {
  const parts = text.split('\0');
  let tracked = 0; const untracked: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (entry.length < 4) continue;
    const code = entry.slice(0, 2), path = entry.slice(3);
    if (code === '??') untracked.push(path);
    else if (code !== '!!') { tracked++; if (code[0] === 'R' || code[0] === 'C' || code[1] === 'R' || code[1] === 'C') i++; }
  }
  return { tracked, untracked };
}

function resolveBase(repo: string, requested: string | undefined, env: NodeJS.ProcessEnv): string | null {
  const exists = (ref: string) => git(repo, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], env).ok;
  if (requested) return exists(requested) ? requested : null;
  const remoteHead = git(repo, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], env);
  if (remoteHead.ok && exists(remoteHead.stdout.trim())) return remoteHead.stdout.trim();
  return ['origin/main', 'origin/master', 'main', 'master'].find(exists) ?? null;
}

function pullRequests(repo: string, branch: string | null, useGh: boolean, env?: NodeJS.ProcessEnv): PullRequestInfo {
  if (!useGh) return { status: 'skipped', reason: 'gh lookup disabled' };
  if (!branch) return { status: 'no-branch', reason: 'detached HEAD has no branch to look up' };
  const run = runProcess('gh', ['pr', 'list', '--head', branch, '--state', 'all', '--json', 'number,state,url', '--limit', '10'], { cwd: repo, env: env ?? process.env, timeout: ghTimeoutMs });
  if (run.error) return { status: 'unavailable', reason: `gh did not run: ${run.error.message}` };
  if (run.status !== 0) return { status: 'unavailable', reason: `gh exited ${run.status}: ${String(run.stderr ?? '').trim().split('\n')[0]}` };
  try {
    const parsed: unknown = JSON.parse(String(run.stdout));
    if (!Array.isArray(parsed)) throw new Error('not a list');
    return { status: 'ok', pulls: parsed.map(item => ({ number: Number(item.number), state: String(item.state), url: String(item.url ?? '') })) };
  } catch (error) { return { status: 'unavailable', reason: `gh output was not a pull request list: ${(error as Error).message}` }; }
}

export function auditWorktrees(repoArg: string, options: AuditOptions = {}): { repo: string; base: string | null; worktrees: WorktreeReport[] } {
  const repo = resolve(repoArg), useGh = options.useGh ?? true, env = { ...process.env, ...options.env };
  const listed = git(repo, ['worktree', 'list', '--porcelain'], env);
  if (!listed.ok) throw new Error(`git worktree list failed in ${repo}: ${listed.stderr.trim() || `exit ${listed.status}`}`);
  const base = resolveBase(repo, options.base, env);
  if (options.base && !base) throw new Error(`Base ref not found: ${options.base}`);
  const worktrees = parseWorktreeList(listed.stdout).filter(entry => !entry.bare).map((entry): WorktreeReport => {
    const existsOnDisk = existsSync(entry.path), blockers: string[] = [];
    let tracked = 0, untracked: string[] = [];
    if (existsOnDisk) {
      const status = git(entry.path, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], env);
      if (status.ok) ({ tracked, untracked } = parseStatus(status.stdout));
      else blockers.push(`git status failed: ${status.stderr.trim().split('\n')[0] || `exit ${status.status}`}`);
    }
    let mergedIntoBase: boolean | null = null, aheadOfBase: number | null = null, unpushed: number | null = null;
    if (base && entry.head) {
      mergedIntoBase = git(repo, ['merge-base', '--is-ancestor', entry.head, base], env).ok;
      const ahead = git(repo, ['rev-list', '--count', `${base}..${entry.head}`], env);
      aheadOfBase = ahead.ok ? Number(ahead.stdout.trim()) : null;
    }
    if (entry.branch) {
      const upstream = git(repo, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', `${entry.branch}@{upstream}`], env);
      if (upstream.ok) {
        const count = git(repo, ['rev-list', '--count', `${upstream.stdout.trim()}..${entry.head}`], env);
        unpushed = count.ok ? Number(count.stdout.trim()) : null;
      }
    }
    const pulls: PullRequestInfo = entry.primary ? { status: 'skipped', reason: 'primary worktree is never a removal candidate' } : pullRequests(repo, entry.branch, useGh, env);
    const mergedByPull = pulls.status === 'ok' && pulls.pulls.some(pull => pull.state === 'MERGED');
    if (entry.primary) blockers.push('primary worktree');
    if (entry.locked) blockers.push('locked');
    if (!existsOnDisk) blockers.push('directory is missing; git still lists it');
    if (tracked > 0) blockers.push(`${tracked} tracked edit${tracked === 1 ? '' : 's'}`);
    if (untracked.length > 0) blockers.push(`${untracked.length} untracked file${untracked.length === 1 ? '' : 's'}`);
    if (!base) blockers.push('no base ref to compare against');
    else if (!entry.primary && !mergedIntoBase && !mergedByPull) blockers.push(`${aheadOfBase ?? 'unknown number of'} commit(s) not in ${base} and no merged pull request`);
    if (unpushed) blockers.push(`${unpushed} commit(s) not pushed to its upstream`);
    return {
      path: entry.path, head: entry.head, branch: entry.branch, primary: entry.primary, locked: entry.locked, existsOnDisk,
      mergeState: { base, mergedIntoBase, aheadOfBase, unpushed },
      trackedChanges: tracked, untrackedFiles: untracked.length, untrackedSample: untracked.slice(0, sampleLimit),
      pullRequests: pulls, blockers, candidateForUserReview: blockers.length === 0,
    };
  });
  return { repo, base, worktrees };
}

export function main(argv = process.argv.slice(2)): number {
  try {
    let repo = process.cwd(), base: string | undefined, useGh = true;
    for (let i = 0; i < argv.length; i++) {
      const arg = argv[i];
      if (arg === '--help') { process.stdout.write(HELP); return 0; }
      if (arg === '--no-gh') useGh = false;
      else if ((arg === '--repo' || arg === '--base') && argv[i + 1] && !argv[i + 1].startsWith('--')) { if (arg === '--repo') repo = argv[++i]; else base = argv[++i]; }
      else throw new Error(`Invalid option: ${arg}`);
    }
    process.stdout.write(JSON.stringify({ readOnly: true, ...auditWorktrees(repo, { base, useGh }), note: 'candidateForUserReview is a list for the user to look at, not authorization to delete.' }, null, 2) + '\n');
    return 0;
  } catch (error) { process.stderr.write(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) + '\n'); return 1; }
}
if (isMain(import.meta.url)) process.exitCode = main();
