/** The documented host rules the audit applies: load, validate, and re-check them against their official pages. */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RULE_IDS } from './types.js';
import type { DocCheck, Host, Rule, RuleId } from './types.js';

export interface RulesFile { schemaVersion: 1; verifiedAt: string; rules: Rule[] }
/** Fetches the readable text of a documentation page. Must not throw: a failure is `ok: false`. */
export type Fetcher = (url: string, timeoutMs: number) => Promise<{ ok: boolean; text: string }>;

const RULES_PATH = join('skills', 'support', 'host-audit', 'references', 'host-rules.json');
const UNITS = ['chars', 'tokens', 'fraction', 'chars-per-token'];

/** The rules file beside the scripts (package layout), else found by walking up to the source tree (compiled `dist/`). */
export function rulesFile(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const beside = join(here, '..', 'references', 'host-rules.json');
  if (existsSync(beside)) return beside;
  for (let dir = here; ; dir = dirname(dir)) {
    const candidate = join(dir, RULES_PATH);
    if (existsSync(candidate)) return candidate;
    if (dirname(dir) === dir) throw new Error(`host-rules.json not found beside or above ${here}`);
  }
}

/** Reads and validates the rules file; a file with problems is an error, never partial data. */
export function loadRules(file = rulesFile()): { verifiedAt: string; rules: Rule[] } {
  const doc: unknown = JSON.parse(readFileSync(file, 'utf8'));
  const problems = validateRules(doc);
  if (problems.length) throw new Error(`${file} is invalid: ${problems.join('; ')}`);
  const { verifiedAt, rules } = doc as RulesFile;
  return { verifiedAt, rules };
}

const filled = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

/** Everything wrong with a parsed rules document; empty when it defines exactly `RULE_IDS`, each once and complete. */
export function validateRules(doc: unknown): string[] {
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return ['the rules document must be an object'];
  const { schemaVersion, verifiedAt, rules } = doc as Record<string, unknown>;
  const problems: string[] = [];
  if (schemaVersion !== 1) problems.push(`schemaVersion must be 1, found ${JSON.stringify(schemaVersion)}`);
  if (!filled(verifiedAt)) problems.push('verifiedAt is missing');
  if (!Array.isArray(rules)) return [...problems, 'rules must be an array'];
  const known = new Set<string>(RULE_IDS), seen = new Set<string>();
  for (const entry of rules as unknown[]) {
    const rule = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<string, unknown>;
    const id = String(rule.id);
    if (!known.has(id)) { problems.push(`unknown rule id ${id}`); continue; }
    if (seen.has(id)) { problems.push(`duplicate rule id ${id}`); continue; }
    seen.add(id);
    for (const field of ['topic', 'statement', 'source', 'quote', 'verifiedAt']) if (!filled(rule[field])) problems.push(`${id}: ${field} is missing`);
    if (rule.host !== id.split('.')[0]) problems.push(`${id}: host must be ${id.split('.')[0]}`);
    if (filled(rule.source) && rule.source !== 'observed' && !rule.source.startsWith('https://')) problems.push(`${id}: source must be an https URL or "observed"`);
    if (rule.source === 'observed' && !filled(rule.evidence)) problems.push(`${id}: an observed rule needs evidence`);
    if (rule.unit !== undefined && !UNITS.includes(String(rule.unit))) problems.push(`${id}: unit must be one of ${UNITS.join(', ')}`);
    if (typeof rule.value === 'number' && rule.unit === undefined) problems.push(`${id}: a numeric value needs a unit`);
  }
  for (const id of RULE_IDS) if (!seen.has(id)) problems.push(`missing rule ${id}`);
  return problems;
}

export function ruleValue(rules: Rule[], id: RuleId): Rule['value'] {
  return rules.find(rule => rule.id === id)?.value;
}

/** Page text and quotes are compared through this: no emphasis or code marks, straight quotes, one-space whitespace. */
export function normalize(value: string): string {
  return value
    .replace(/[‘’‛]/g, "'").replace(/[“”‟]/g, '"')
    .replace(/[​-‍﻿]/g, '')
    .replace(/[`*]/g, '')
    .replace(/(?<![\p{L}\p{N}])_+|_+(?![\p{L}\p{N}])/gu, '')
    .replace(/\s+/g, ' ').trim();
}

/** Reads a page through Jina Reader. Jina answers 200 for a missing target and says so in its header, so that counts as a failure too. */
export const jinaFetcher: Fetcher = async (url, timeoutMs) => {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`https://r.jina.ai/${url}`, { signal: controller.signal });
    const body = await response.text();
    return { ok: response.ok && !/^Warning: Target URL returned error \d+/m.test(body.slice(0, 1000)), text: body };
  } catch { return { ok: false, text: '' }; } finally { clearTimeout(timer); }
};

/** One fetch per distinct documentation URL, retried once when it fails (a large page took 17 s through Jina): `ok` when every quote is on the page, `drift` naming the ids whose quote is not. Observed rules have no page. */
export async function verifyDocs(rules: Rule[], fetcher: Fetcher = jinaFetcher, options: { timeoutMs: number } = { timeoutMs: 60000 }): Promise<DocCheck[]> {
  const bySource = new Map<string, Rule[]>();
  for (const rule of rules) if (rule.source !== 'observed') bySource.set(rule.source, [...(bySource.get(rule.source) ?? []), rule]);
  return Promise.all([...bySource].map(async ([url, group]): Promise<DocCheck> => {
    const get = () => fetcher(url, options.timeoutMs).catch(() => ({ ok: false, text: '' }));
    let page = await get();
    if (!page.ok) page = await get();
    if (!page.ok) return { url, status: 'unreachable', drifted: [] };
    const haystack = normalize(page.text);
    const drifted = group.filter(rule => !haystack.includes(normalize(rule.quote))).map(rule => rule.id);
    return { url, status: drifted.length ? 'drift' : 'ok', drifted };
  }));
}

const parts = (version: string) => (version.match(/\d+(?:\.\d+)*/)?.[0] ?? '').split('.').filter(Boolean).map(Number);
function newer(a: number[], b: number[]): boolean {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  return false;
}

/** Hosts whose installed version is newer than the newest one their rules were verified on. */
export function newerHosts(rules: Rule[], versions: Partial<Record<Host, string>>): { host: Host; verifiedOn: string; installed: string }[] {
  const found: { host: Host; verifiedOn: string; installed: string }[] = [];
  for (const host of ['claude', 'codex'] as const) {
    const installed = parts(versions[host] ?? '');
    let verifiedOn = '';
    for (const rule of rules) if (rule.host === host && rule.hostVersion && parts(rule.hostVersion).length && (!verifiedOn || newer(parts(rule.hostVersion), parts(verifiedOn)))) verifiedOn = rule.hostVersion;
    if (installed.length && verifiedOn && newer(installed, parts(verifiedOn))) found.push({ host, verifiedOn, installed: installed.join('.') });
  }
  return found;
}
