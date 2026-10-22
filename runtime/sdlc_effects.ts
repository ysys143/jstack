/** Read-only release reconciliation. Transport injection is for deterministic provider fixtures. */
import { spawnSync } from 'node:child_process';
export interface ReadResult { ok: boolean; output: string }
export interface EffectObservation { outcome: 'present' | 'absent' | 'unknown'; observed: unknown; head: string }
export type GithubReader = (endpoint: string, root: string) => ReadResult;
function git(root: string, ...args: string[]): ReadResult {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
  return { ok: r.status === 0, output: r.stdout?.trim() ?? '' };
}
const github: GithubReader = (endpoint, root) => {
  const r = spawnSync('gh', ['api', endpoint], { cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
  return { ok: r.status === 0, output: r.stdout ?? '' };
};
export function readEffect(root: string, operation: string, target: any, provider: GithubReader = github): EffectObservation {
  const local = git(root, 'rev-parse', 'HEAD'); if (!local.ok) throw new Error('Local HEAD unavailable');
  const result: EffectObservation = { outcome: 'unknown', observed: {}, head: local.output };
  if (operation === 'commit') {
    const tree = git(root, 'rev-parse', 'HEAD^{tree}'), parents = git(root, 'show', '-s', '--format=%P', 'HEAD');
    result.observed = { tree: tree.output, parents: parents.output };
    if (tree.ok && parents.ok) result.outcome = tree.output === target.tree && parents.output === target.parent ? 'present' : local.output === target.parent ? 'absent' : 'unknown';
  } else if (operation === 'push') {
    const observed = git(root, 'ls-remote', '--heads', target.remote, `refs/heads/${target.branch}`); result.observed = observed;
    if (observed.ok) result.outcome = observed.output.split(/\s/)[0] === target.head ? 'present' : !observed.output ? 'absent' : 'unknown';
  } else if (operation === 'pr') {
    const response = provider(`repos/${target.repository}/pulls?state=open&head=${encodeURIComponent(target.repository.split('/')[0] + ':' + target.branch)}&base=${encodeURIComponent(target.base)}`, root);
    try {
      const rows = JSON.parse(response.output); result.observed = rows;
      if (response.ok && Array.isArray(rows)) {
        const row = rows[0];
        result.outcome = rows.length === 0 ? 'absent' : rows.length === 1 && row.state === 'open' && row.head?.sha === target.head && row.head?.ref === target.branch && row.head?.repo?.full_name === target.repository && row.base?.ref === target.base && row.base?.repo?.full_name === target.repository && Number.isInteger(row.number) && typeof row.html_url === 'string' ? 'present' : 'unknown';
      }
    } catch { result.observed = { error: 'Provider readback unavailable' }; }
  } else throw new Error('Unknown release operation');
  return result;
}
