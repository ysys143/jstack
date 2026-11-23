/** Shared fixtures for the typed evidence-needs test files: isolated task state, temp files and the in-process CLI. */
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { capture, context, load } from '../../../../../runtime/task_state.js';
import { main } from '../scripts/coverage_matrix.js';

export const COVERAGE = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'coverage_matrix.js');
export const temporary = tmpdir();
export const sha = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
export const ROWS = [['INC-1', 'database failover'], ['INC-2', 'cache outage'], ['INC-12', 'queue stall']] as const;

export async function cli(args: string[]): Promise<{ code: number; out: string; json: any }> {
  const lines: string[] = [], log = console.log, error = console.error; let code: number;
  console.log = (...a: unknown[]) => { lines.push(a.join(' ')); }; console.error = (...a: unknown[]) => { lines.push(a.join(' ')); };
  try { code = await main(args); } catch (e) { code = 2; lines.push(String(e)); } finally { console.log = log; console.error = error; }
  const out = lines.join('\n'); let json: any; try { json = JSON.parse(out); } catch { json = undefined; }
  return { code, out, json };
}

/** One task with two research requirements, a source log, a body report with a sources section, and a valid manifest. */
export function fixture(t: any, costs = [3000, 5500, 1200]) {
  const home = realpathSync(mkdtempSync(join(temporary, 'jstack-evidence-'))); t.after(() => rmSync(home, { recursive: true, force: true }));
  const root = join(home, 'work'); mkdirSync(root);
  const c = context(root, home);
  const source = { role: 'user' as const, message: 'turn-1', quote: 'List every incident and total the cost' };
  capture(c, { id: 'inc', expectedRevision: 0, source, purpose: 'Report October incidents', authorized: ['analyze'],
    requirements: [{ id: 'INCIDENTS', text: 'List every October incident', kind: 'research' }, { id: 'COST', text: 'Total the October incident cost', kind: 'research' }] });
  const put = (name: string, body: string): string => { writeFileSync(join(root, name), body); return join(root, name); };
  const log = (rows = costs): string => ROWS.map(([id, what], i) => `${id} ${what} cost ${rows[i]} won on 2026-10-0${i + 1}\n`).join('') + 'NOTE rows above are the October incidents\n';
  put('incidents.log', log());
  const total = costs.reduce((a, b) => a + b, 0);
  const report = (extra: { total?: string; costRows?: string[]; sources?: string } = {}): string =>
    `## 요약\n\nINCIDENTS 10월 장애 목록\n${ROWS.map(([id, what]) => `- ${id} ${what}`).join('\n')}\n개수 3건\n\nCOST 장애 비용:\n${(extra.costRows ?? ROWS.map(([id], i) => `- ${id} ${costs[i]!.toLocaleString('en-US')}`)).join('\n')}\n합계 ${extra.total ?? total.toLocaleString('en-US')} [1]\n\n## 출처\n\n${extra.sources ?? '[1] 장애 로그 — https://example.org/incidents'}\n`;
  put('report.md', report());
  const quote = (i: number): string => `${ROWS[i]![0]} ${ROWS[i]![1]}`;
  const base = (): any => ({
    schema: 'jstack-evidence-needs/1', task: 'inc', workspace: c.workspace, constraintsRevision: 0,
    sources: { S1: { path: 'incidents.log', sha256: sha(readFileSync(join(root, 'incidents.log'))) } },
    needs: [
      { id: 'N1', type: 'enumerate', requirement: 'INCIDENTS', requirementRevision: 1, subquestion: 'SQ1', boundary: { source: 'S1', linePrefix: 'INC-' },
        items: ROWS.map(([id], i) => ({ id, source: 'S1', quote: quote(i) })) },
      { id: 'N2', type: 'count', requirement: 'INCIDENTS', requirementRevision: 1, claimed: '3', reportPrefix: '개수', boundary: { source: 'S1', linePrefix: 'INC-' },
        items: ROWS.map(([id], i) => ({ id, source: 'S1', quote: quote(i) })) },
      { id: 'N3', type: 'compute', operation: 'sum', requirement: 'COST', requirementRevision: 1, claimed: String(total), reportPrefix: '합계', boundary: { source: 'S1', linePrefix: 'INC-' },
        items: ROWS.map(([id], i) => ({ id, source: 'S1', quote: `${quote(i)} cost ${costs[i]}`, value: String(costs[i]) })) },
    ],
  });
  const needsPath = join(root, 'needs.json');
  const run = (edit: (m: any) => void = () => {}, extra: string[] = [], format = 'json') => {
    const m = base(); edit(m); writeFileSync(needsPath, JSON.stringify(m));
    return cli(['--needs', needsPath, '--task', 'inc', '--workspace', root, '--home', home, '--report', join(root, 'report.md'), '--format', format, ...extra]);
  };
  const revise = (input: any) => capture(c, { id: 'inc', expectedRevision: load(c, 'inc').revision, source, ...input });
  return { home, root, c, put, log, report, run, revise, needsPath, base };
}
export const kinds = (result: { json: any }): string[] => result.json.evidence.findings.map((f: any) => f.kind);
