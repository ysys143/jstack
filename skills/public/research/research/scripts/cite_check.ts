#!/usr/bin/env node
/** Export every sentence/source pair. Mechanical checks do not prove support. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isMain } from '../../../../../runtime/entry.js';
const digitValue = (char: string): number => { let start = char.codePointAt(0)!; while (start > 0 && /\p{Decimal_Number}/u.test(String.fromCodePoint(start - 1))) start--; return (char.codePointAt(0)! - start) % 10; };
const citationNumber = (text: string): number => [...text].reduce((value, char) => value * 10 + digitValue(char), 0);
export const SOURCE_HEADS = ['## 출처', '## 참고문헌', '## References', '## 참고 자료'];
export function split_report(text: string): [string, string[]] {
  const lines = text.split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/u);
  if (lines.at(-1) === '') lines.pop();
  const i = lines.findIndex(line => SOURCE_HEADS.includes(line.trim()));
  return i < 0 ? [text, []] : [lines.slice(0, i).join('\n'), lines.slice(i + 1)];
}
export function parse_sources(lines: string[]): Record<string, string> {
  const out: Record<string, string> = Object.create(null);
  for (const line of lines) { const match = line.match(/^\s*\[(\p{Decimal_Number}{1,3})\]\s+(.+?)\s*$/u); if (match) out[match[1]] = match[2]; }
  return out;
}
export const sentences = (body: string): string[] => body.split(/(?<=[.!?])\s+|(?<=[다요]\.)\s+|\n\n+/u).map(p => p.trim()).filter(Boolean);
export interface Finding { kind: string; detail: string; cite?: string; sentence?: string; source?: string }
export interface Pair { cite: string; source: string; sentence: string }
export function check(path: string): [Finding[], Pair[]] {
  const [body, srcLines] = split_report(readFileSync(path, 'utf8')), sources = parse_sources(srcLines);
  const findings: Finding[] = [], pairs: Pair[] = [], used = new Set<string>();
  if (!srcLines.length) findings.push({ kind: 'MALFORMED', detail: `Sources section absent: require one of ${SOURCE_HEADS.join(' or ')}` });
  for (const sent of sentences(body)) for (const match of sent.matchAll(/\[(\p{Decimal_Number}{1,3})\]/gu)) {
    const num = match[1]; used.add(num);
    if (!Object.hasOwn(sources, num)) { findings.push({ kind: 'MISSING', cite: num, detail: `[${num}] is absent from the source list`, sentence: [...sent].slice(0, 120).join('') }); continue; }
    pairs.push({ cite: num, source: sources[num], sentence: sent });
  }
  const sourceOrder = [...new Set(srcLines.flatMap(line => { const match = line.match(/^\s*\[(\p{Decimal_Number}{1,3})\]\s+(.+?)\s*$/u); return match ? [match[1]] : []; }))];
  for (const [num, desc] of Object.entries(sources).sort(([a], [b]) => citationNumber(a) - citationNumber(b) || sourceOrder.indexOf(a) - sourceOrder.indexOf(b))) {
    if (!used.has(num)) findings.push({ kind: 'UNUSED', cite: num, detail: `[${num}] is never cited in the body`, source: desc });
    if (!/https?:\/\/\S+|doi:\S+|ISBN\s*[\p{Decimal_Number}-]+|공고번호\s*\S+/u.test(desc)) findings.push({ kind: 'UNRESOLVED', cite: num, detail: `[${num}] lacks an identifier such as a URL, DOI, or notice ID`, source: desc });
  }
  return [findings, pairs];
}
export function main(argv = process.argv.slice(2)): number {
  let report: string | undefined, pairsPath: string | undefined, format = 'text';
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (['--help', '-h'].includes(token)) { console.log('cite_check.js REPORT [--pairs JSONL] [--format text|json]'); return 0; }
    if (token === '--pairs' || token === '--format') { if (!argv[i + 1]) throw new Error(`Missing value: ${token}`); const value = argv[++i]; if (token === '--pairs') pairsPath = value; else format = value; }
    else if (!report && !token.startsWith('-')) report = token;
    else throw new Error(`Invalid argument: ${token}`);
  }
  if (!report || !['text', 'json'].includes(format)) throw new Error('Report and valid --format are required');
  if (!existsSync(report)) { console.error(`[중단] File does not exist: ${report}`); return 2; }
  const [findings, pairs] = check(report);
  if (pairsPath) writeFileSync(pairsPath, pairs.map(p => JSON.stringify(p)).join('\n') + '\n');
  if (format === 'json') console.log(JSON.stringify({ findings, pairs: pairs.length, coverage: '100% (no sampling)' }, null, 2));
  else {
    findings.forEach(f => console.log(`[${f.kind}] ${f.detail}`));
    console.log(`\nMachine findings: ${findings.length} / pairs requiring reading: ${pairs.length} (all pairs; no sampling)`);
    if (pairs.length && !pairsPath) console.log('  Export with --pairs for human or LLM review');
  }
  return findings.length ? 1 : 0;
}
if (isMain(import.meta.url)) { try { process.exitCode = main(); } catch (error) { console.error(String(error)); process.exitCode = 2; } }
