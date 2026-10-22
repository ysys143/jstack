#!/usr/bin/env node
import { isMain } from '../../../../../runtime/entry.js';
/** Cap one cleanup run at twenty findings.
 * Bound reports by severity, preserving ties and disclosing every cut.
 * There is no exit code for truncation: a bounded report is a valid result.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CAP = 20;
export const SEVERITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };
export const UNKNOWN_RANK = 3;
type Finding = Record<string, unknown>;
const typeName = (value: unknown): string => value === null ? 'NoneType' : Array.isArray(value) ? 'list' : typeof value === 'object' ? 'dict' : typeof value === 'boolean' ? 'bool' : typeof value === 'string' ? 'str' : Number.isInteger(value) ? 'int' : 'float';
export function rank(finding: Finding): number {
  return typeof finding.severity === 'string' ? (Object.hasOwn(SEVERITY_RANK, finding.severity.toLowerCase()) ? SEVERITY_RANK[finding.severity.toLowerCase()]! : UNKNOWN_RANK) : UNKNOWN_RANK;
}
export function extract(document: unknown): Finding[] {
  let findings: unknown;
  if (Array.isArray(document)) findings = document;
  else if (document !== null && typeof document === 'object') {
    if (!Object.hasOwn(document, 'findings')) throw new Error("object input has no 'findings' key");
    findings = (document as Finding).findings;
  } else throw new Error(`top level is ${typeName(document)}, expected list or object`);
  if (!Array.isArray(findings)) throw new Error(`'findings' is ${typeName(findings)}, expected a list`);
  findings.forEach((item, i) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) throw new Error(`finding ${i} is ${typeName(item)}, expected an object`);
  });
  return findings as Finding[];
}
export function cap(findings: Finding[], limit = CAP) {
  const ordered = [...findings].sort((a, b) => rank(a) - rank(b));
  const kept = ordered.slice(0, limit), truncated = ordered.length - kept.length;
  return { total: ordered.length, shown: kept.length, truncated,
    note: `Show ${kept.length} of ${ordered.length}` + (truncated > 0 ? ` — ${truncated} lower-priority finding(s) cut to keep the report readable` : ''), findings: kept };
}
export function main(argv = process.argv.slice(2)): number {
  const source = argv[0] ?? '-';
  let raw: string;
  try { raw = readFileSync(source === '-' ? 0 : source, 'utf8'); }
  catch (error) { console.error(`cap_findings: cannot read ${source}: ${error}`); return 2; }
  let document: unknown;
  try { document = JSON.parse(raw); }
  catch (error) { console.error(`cap_findings: input is not JSON: ${error}`); return 2; }
  try { console.log(JSON.stringify(cap(extract(document)), null, 1)); return 0; }
  catch (error) { console.error(`cap_findings: ${(error as Error).message}`); return 2; }
}
if (isMain(import.meta.url)) process.exitCode = main();
