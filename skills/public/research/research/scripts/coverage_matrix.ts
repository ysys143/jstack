#!/usr/bin/env node
/** Mechanical mention coverage; fulfillment still requires reading each pair. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isMain } from '../../../../../runtime/entry.js';
export const REQ_LINE = /^\s*([A-Z][A-Z0-9-]{1,15}\p{Decimal_Number})\s+(.+?)\s*$/u;
export function parse_requirements(path: string): Record<string, string> {
  const out: Record<string, string> = Object.create(null);
  for (const line of readFileSync(path, 'utf8').split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/u)) {
    const match = line.match(REQ_LINE); if (match) out[match[1]] = match[2];
  }
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
export function main(argv = process.argv.slice(2)): number {
  const values: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (['--help', '-h'].includes(argv[i])) { console.log('coverage_matrix.js --req FILE --report FILE [--min-chars INTEGER] [--pairs JSONL] [--format text|json]'); return 0; }
    if (!['--req', '--report', '--min-chars', '--pairs', '--format'].includes(argv[i]) || argv[i + 1] === undefined) throw new Error(`Invalid option: ${argv[i]}`);
    values[argv[i].slice(2)] = argv[++i];
  }
  if (!values.req || !values.report) throw new Error('--req and --report are required');
  const format = values.format ?? 'text', minimum = values['min-chars'] ?? '200';
  if (!['text', 'json'].includes(format) || !/^[+-]?\d+$/.test(minimum) || !Number.isSafeInteger(Number(minimum))) throw new Error('Invalid --format or --min-chars');
  for (const path of [values.req, values.report]) if (!existsSync(path)) { console.error(`[중단] File does not exist: ${path}`); return 2; }
  const reqs = parse_requirements(values.req);
  if (!Object.keys(reqs).length) { console.error(`[중단] No requirements parsed from ${values.req}: use ID<two spaces>description`); return 2; }
  const [findings, pairs] = check(reqs, readFileSync(values.report, 'utf8'), Number(minimum));
  if (values.pairs) writeFileSync(values.pairs, pairs.map(p => JSON.stringify(p)).join('\n') + '\n');
  const total = Object.keys(reqs).length, covered = total - findings.filter(f => f.kind === 'MISSING').length;
  if (format === 'json') console.log(JSON.stringify({ findings, total, covered, pairs: pairs.length }, null, 2));
  else {
    findings.forEach(f => console.log(`[${f.kind}] ${f.detail}`));
    console.log(`\nRequirements mentioned: ${covered}/${total} / findings: ${findings.length}`);
    console.log('  Human or LLM reading assesses fulfillment; export with --pairs');
  }
  return findings.length ? 1 : 0;
}
if (isMain(import.meta.url)) { try { process.exitCode = main(); } catch (error) { console.error(String(error)); process.exitCode = 2; } }
