#!/usr/bin/env node
/** Mechanical mention coverage; fulfillment still requires reading each pair. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isMain } from '../../../../../runtime/entry.js';
import { split_report } from './cite_check.js';
import { check_evidence, fileBindings, needsBase, parseCover, readNeedsFile, readRegularFile, taskBindings, type EvidenceReport } from './evidence_needs.js';
export const REQ_LINE = /^\s*([A-Z][A-Z0-9-]{1,15}\p{Decimal_Number})\s+(.+?)\s*$/u;
/** Every requirement row in file order; parse_requirements keeps the last row of a repeated ID, this keeps all of them. */
export function requirement_rows(text: string): [string, string][] {
  return text.split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/u).flatMap(line => { const match = line.match(REQ_LINE); return match ? [[match[1], match[2]] as [string, string]] : []; });
}
export function parse_requirements(path: string): Record<string, string> {
  const out: Record<string, string> = Object.create(null);
  for (const [id, description] of requirement_rows(readFileSync(path, 'utf8'))) out[id] = description;
  return out;
}
export const paragraphs = (text: string): string[] => text.split(/\n\s*\n/u).map(p => p.trim()).filter(Boolean);
export interface Finding { kind: string; req: string; detail: string; requirement?: string }
export interface Pair { req: string; requirement: string; response: string }
const length = (text: string): number => [...text].length;
export function check(reqs: Record<string, string>, report: string, min_chars: number): [Finding[], Pair[]] {
  const findings: Finding[] = [], pairs: Pair[] = [], paras = paragraphs(report);
  for (const [rid, desc] of Object.entries(reqs)) {
    const hits = paras.filter(p => p.includes(rid));
    if (!hits.length) { findings.push({ kind: 'MISSING', req: rid, detail: `${rid} is absent from the deliverable`, requirement: desc }); continue; }
    const body = hits.reduce((best, next) => length(next) > length(best) ? next : best);
    if (length(body) < min_chars) findings.push({ kind: 'THIN', req: rid, detail: `${rid} response has ${length(body)} characters (minimum ${min_chars} characters)`, requirement: desc });
    pairs.push({ req: rid, requirement: desc, response: body });
  }
  // Python word boundaries are Unicode-aware; ASCII \b also matches inside Korean words.
  const seen = new Set([...report.matchAll(/(?<![\p{L}\p{N}_])([A-Z][A-Z0-9-]{1,15}\p{Decimal_Number})(?![\p{L}\p{N}_])/gu)].map(m => m[1]));
  const prefixes = Object.keys(reqs).map(r => r.includes('-') ? r.slice(0, r.lastIndexOf('-')) : r);
  for (const rid of [...seen].filter(r => !Object.hasOwn(reqs, r)).sort()) if (prefixes.some(p => rid.startsWith(p))) findings.push({ kind: 'ORPHAN', req: rid, detail: `${rid} is used in the deliverable but absent from the requirements list` });
  return [findings, pairs];
}
const TYPED_ONLY = ['task', 'workspace', 'home', 'cover'];
export async function main(argv = process.argv.slice(2)): Promise<number> {
  const values: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (['--help', '-h'].includes(argv[i])) { console.log('coverage_matrix.js --req FILE --report FILE [--min-chars INTEGER] [--pairs JSONL] [--format text|json]\n  typed evidence (opt-in): --needs FILE (--task ID [--workspace DIR] [--home DIR] | --req FILE) [--cover all|ID,ID]; see references/evidence-needs.md'); return 0; }
    if (!['--req', '--report', '--min-chars', '--pairs', '--format', '--needs', ...TYPED_ONLY.map(o => `--${o}`)].includes(argv[i]) || argv[i + 1] === undefined) throw new Error(`Invalid option: ${argv[i]}`);
    values[argv[i].slice(2)] = argv[++i];
  }
  const typed = values.needs !== undefined;
  for (const option of TYPED_ONLY) if (!typed && values[option] !== undefined) throw new Error(`--${option} requires --needs`);
  if (typed && values.task === undefined && values.req === undefined) throw new Error('--needs requires --task ID or --req FILE for its requirement bindings');
  if (!values.report || (!values.req && !(typed && values.task !== undefined))) throw new Error('--req and --report are required');
  if (typed && values.pairs !== undefined) throw new Error('--pairs cannot be combined with --needs: the pair export would write beside typed inputs; run the plain check for pairs');
  if (values.pairs && !values.req) throw new Error('--pairs requires --req');
  const format = values.format ?? 'text', minimum = values['min-chars'] ?? '200';
  if (!['text', 'json'].includes(format) || !/^[+-]?\d+$/.test(minimum) || !Number.isSafeInteger(Number(minimum))) throw new Error('Invalid --format or --min-chars');
  for (const path of [values.req, values.report, values.needs]) if (path !== undefined && !existsSync(path)) { console.error(`[중단] File does not exist: ${path}`); return 2; }
  // Typed mode reads every input with the bounded regular-file reader; the plain RFP check keeps its original reads.
  const readText = (path: string): string => typed ? readRegularFile(path).toString('utf8') : readFileSync(path, 'utf8');
  const reportText = readText(values.report);
  let reqs: Record<string, string> | undefined;
  if (values.req) {
    const rows = requirement_rows(readText(values.req));
    if (typed && values.task === undefined) {
      const once = new Set<string>(), dupes = new Set<string>();
      for (const [id] of rows) (once.has(id) ? dupes : once).add(id);
      if (dupes.size) throw new Error(`Duplicate requirement ID(s) in ${values.req}: ${[...dupes].join(', ')}; a typed binding needs one row per ID`);
    }
    reqs = Object.create(null) as Record<string, string>; for (const [id, description] of rows) reqs[id] = description;
    if (!Object.keys(reqs).length) { console.error(`[중단] No requirements parsed from ${values.req}: use ID<two spaces>description`); return 2; }
  }
  let findings: Finding[] = [], pairs: Pair[] = [], total = 0, covered = 0;
  if (reqs) {
    [findings, pairs] = check(reqs, reportText, Number(minimum));
    if (values.pairs) writeFileSync(values.pairs, pairs.map(p => JSON.stringify(p)).join('\n') + '\n');
    total = Object.keys(reqs).length; covered = total - findings.filter(f => f.kind === 'MISSING').length;
  }
  let evidence: EvidenceReport | undefined;
  if (typed) {
    const cover = parseCover(values.cover);
    const live = values.task !== undefined ? await taskBindings(values.task, values.workspace ?? process.cwd(), values.home ?? homedir()) : undefined;
    const bindings = live?.bindings ?? fileBindings(reqs!);
    evidence = check_evidence(readNeedsFile(values.needs!), needsBase(values.needs!), paragraphs(split_report(reportText)[0]), bindings, live ? 'task' : 'requirements-file', cover, live?.identity);
  }
  const failed = findings.length > 0 || (evidence !== undefined && evidence.mechanicalResult !== 'consistent');
  if (format === 'json') console.log(JSON.stringify({ ...(reqs ? { findings, total, covered, pairs: pairs.length } : {}), ...(evidence ? { evidence } : {}) }, null, 2));
  else {
    findings.forEach(f => console.log(`[${f.kind}] ${f.detail}`));
    if (reqs) { console.log(`\nRequirements mentioned: ${covered}/${total} / findings: ${findings.length}`); console.log('  Human or LLM reading assesses fulfillment; export with --pairs'); }
    if (evidence) {
      for (const f of evidence.findings) console.log(`[${f.kind}]${f.need ? ` ${f.need}` : ''}${f.req ? ` (${f.req})` : ''}: ${f.detail}`);
      const bound = evidence.identity ? `task ${evidence.identity.task} / workspace ${evidence.identity.workspace.slice(0, 12)} / constraintsRevision ${evidence.identity.constraintsRevision}; requirements ${evidence.requirements.map(r => `${r.id}${r.active ? `@${r.revision}` : ' withdrawn'}`).join(', ')}` : 'requirements file (use --format json for current requirement hashes)';
      console.log(`\nEvidence needs: ${evidence.needs.filter(n => n.status === 'consistent').length}/${evidence.needs.length} consistent / findings: ${evidence.findings.length} / mechanical result: ${evidence.mechanicalResult}`);
      console.log(`  Current binding: ${bound}`);
      console.log(`  Covered requirements: ${evidence.covered.join(', ') || '(none)'}${evidence.outsideScope.length ? ` / outside this check: ${evidence.outsideScope.join(', ')}` : ''}; this result says nothing about the task as a whole`);
      console.log(`  ${evidence.scope}`);
    }
  }
  return failed ? 1 : 0;
}
if (isMain(import.meta.url)) { main().then(code => { process.exitCode = code; }, error => { console.error(String(error)); process.exitCode = 2; }); }
