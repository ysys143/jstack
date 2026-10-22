import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { jinaFetcher, loadRules, newerHosts, normalize, ruleValue, rulesFile, validateRules, verifyDocs } from '../scripts/rules.js';
import type { Fetcher } from '../scripts/rules.js';
import { RULE_IDS } from '../scripts/types.js';
import type { Rule, RuleId } from '../scripts/types.js';

type Doc = { schemaVersion: unknown; verifiedAt?: unknown; rules: Record<string, unknown>[] };
const raw = (): Doc => JSON.parse(readFileSync(rulesFile(), 'utf8'));
/** Problems validateRules reports after one edit to a fresh copy of the shipped document. */
const problemsAfter = (change: (doc: Doc) => void): string[] => { const doc = raw(); change(doc); return validateRules(doc); };
const entry = (doc: Doc, id: RuleId) => doc.rules.find(rule => rule.id === id) as Record<string, unknown>;
const { rules } = loadRules();
const pageSources = [...new Set(rules.filter(rule => rule.source !== 'observed').map(rule => rule.source))];

test('the shipped rules validate, define every rule id once, and list each one in the readable copy', () => {
  assert.deepEqual(validateRules(raw()), []);
  assert.deepEqual(rules.map(rule => rule.id).sort(), [...RULE_IDS].sort());
  assert.match(loadRules().verifiedAt, /^\d{4}-\d{2}-\d{2}$/);
  const readable = readFileSync(join(rulesFile(), '..', 'host-rules.md'), 'utf8');
  for (const rule of rules) assert.ok(readable.includes(`\`${rule.id}\``), `${rule.id} is missing from host-rules.md`);
  for (const rule of rules) {
    assert.equal(rule.host, rule.id.split('.')[0]);
    assert.equal(rule.hostVersion === undefined, rule.host === 'spec', `${rule.id} hostVersion`);
  }
  assert.deepEqual(rules.filter(rule => rule.source === 'observed').map(rule => rule.id), ['claude.listing.synced-override-key', 'claude.listing.eligibility', 'claude.listing.host-skills', 'claude.listing.chars-per-token', 'claude.listing.entry-format', 'claude.listing.usage-score', 'codex.listing.path-alias']);
  for (const rule of rules.filter(rule => rule.source === 'observed' && rule.host === 'claude')) assert.match(rule.evidence ?? '', /Claude Code 2\.1\.\d+ binary[\s\S]*Re-check: grep -a/);
});

test('the Codex path alias is an observed rule that names the binary literal and the session log form', () => {
  const rule = rules.find(row => row.id === 'codex.listing.path-alias')!;
  assert.deepEqual([rule.source, rule.host, rule.hostVersion], ['observed', 'codex', '0.160.1']);
  assert.equal(rule.quote, 'expand the matching root alias first from `### Skill roots`');
  assert.match(rule.evidence ?? '', /Codex 0\.160\.1 binary[\s\S]*\(file: r11\/workflow\/plan\/SKILL\.md\)[\s\S]*Re-check: on the native binary[\s\S]*grep -a -o -F/);
  assert.match(rule.statement, /root alias plus the path under that root/);
});

test('the numbers the audit computes with match the documented values', () => {
  const expected: [RuleId, number, Rule['unit']][] = [
    ['claude.listing.desc-cap', 1536, 'chars'], ['claude.listing.budget-fraction', 0.01, 'fraction'], ['claude.listing.fallback-chars', 8000, 'chars'],
    ['claude.listing.chars-per-token', 3, 'chars-per-token'], ['claude.agents.description-warning', 15000, 'tokens'], ['claude.mcp.description-cap', 2048, 'chars'],
    ['codex.listing.budget-fraction', 0.02, 'fraction'], ['codex.listing.fallback-chars', 8000, 'chars'], ['codex.listing.max-context-tokens-cap', 10000, 'tokens'],
    ['spec.skill.name', 64, 'chars'], ['spec.skill.description', 1024, 'chars'],
  ];
  for (const [id, value, unit] of expected) {
    assert.equal(ruleValue(rules, id), value, id);
    assert.equal(rules.find(rule => rule.id === id)?.unit, unit, id);
  }
  assert.equal(ruleValue(rules, 'claude.listing.drop-order'), undefined);
  assert.equal(ruleValue([], 'claude.listing.desc-cap'), undefined);
});

test('rulesFile finds the shipped file and loadRules refuses a file with problems', () => {
  assert.match(rulesFile(), /host-rules\.json$/);
  const dir = mkdtempSync(join(tmpdir(), 'jstack-host-rules-'));
  try {
    const doc = raw(); doc.rules.pop();
    const broken = join(dir, 'host-rules.json'); writeFileSync(broken, JSON.stringify(doc));
    assert.throws(() => loadRules(broken), /missing rule spec\.skill\.description/);
    writeFileSync(broken, JSON.stringify(raw()));
    assert.equal(loadRules(broken).rules.length, RULE_IDS.length);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('validateRules reports each problem class', () => {
  assert.deepEqual(validateRules(null), ['the rules document must be an object']);
  assert.deepEqual(validateRules([]), ['the rules document must be an object']);
  assert.deepEqual(problemsAfter(doc => { doc.schemaVersion = 2; }), ['schemaVersion must be 1, found 2']);
  assert.deepEqual(problemsAfter(doc => { delete doc.verifiedAt; }), ['verifiedAt is missing']);
  assert.deepEqual(problemsAfter(doc => { doc.rules = 'none' as unknown as Doc['rules']; }), ['rules must be an array']);
  assert.deepEqual(problemsAfter(doc => { doc.rules = doc.rules.filter(rule => rule.id !== 'codex.mcp.config'); }), ['missing rule codex.mcp.config']);
  assert.deepEqual(problemsAfter(doc => { doc.rules.push({ ...entry(doc, 'codex.mcp.config'), id: 'codex.extra' }); }), ['unknown rule id codex.extra']);
  assert.deepEqual(problemsAfter(doc => { doc.rules.push({ ...entry(doc, 'codex.mcp.config') }); }), ['duplicate rule id codex.mcp.config']);
  for (const field of ['topic', 'statement', 'source', 'quote', 'verifiedAt']) {
    assert.ok(problemsAfter(doc => { delete entry(doc, 'claude.mcp.scopes')[field]; }).includes(`claude.mcp.scopes: ${field} is missing`), field);
    assert.ok(problemsAfter(doc => { entry(doc, 'claude.mcp.scopes')[field] = '  '; }).includes(`claude.mcp.scopes: ${field} is missing`), `${field} blank`);
  }
  assert.deepEqual(problemsAfter(doc => { delete entry(doc, 'claude.listing.usage-score').evidence; }), ['claude.listing.usage-score: an observed rule needs evidence']);
  assert.deepEqual(problemsAfter(doc => { entry(doc, 'claude.mcp.scopes').source = 'http://example.com/docs'; }), ['claude.mcp.scopes: source must be an https URL or "observed"']);
  assert.deepEqual(problemsAfter(doc => { entry(doc, 'claude.mcp.scopes').source = 'docs'; }), ['claude.mcp.scopes: source must be an https URL or "observed"']);
  assert.deepEqual(problemsAfter(doc => { delete entry(doc, 'claude.mcp.description-cap').unit; }), ['claude.mcp.description-cap: a numeric value needs a unit']);
  assert.deepEqual(problemsAfter(doc => { entry(doc, 'claude.mcp.description-cap').unit = 'bytes'; }), ['claude.mcp.description-cap: unit must be one of chars, tokens, fraction, chars-per-token']);
  assert.deepEqual(problemsAfter(doc => { entry(doc, 'codex.mcp.config').host = 'claude'; }), ['codex.mcp.config: host must be codex']);
  assert.deepEqual(problemsAfter(doc => { doc.rules.push(null as unknown as Record<string, unknown>); }), ['unknown rule id undefined']);
});

test('normalize makes page text and quotes comparable', () => {
  assert.equal(normalize('  It’s “quoted”  and\n\tspread out  '), 'It\'s "quoted" and spread out');
  assert.equal(normalize('**bold** and *emphasis* and `code` and _slanted_ and __strong__'), 'bold and emphasis and code and slanted and strong');
  assert.equal(normalize('keep `skills.max_context_tokens` and snake_case_names'), 'keep skills.max_context_tokens and snake_case_names');
  assert.equal(normalize('zero​width ﻿marks'), 'zerowidth marks');
  assert.equal(normalize(''), '');
  assert.ok(normalize('The `description` text — is “cut” at 1,536').includes(normalize('The description text — is "cut" at 1,536')));
});

/** A page that contains the given rules' quotes, mangled the way a renderer might: emphasis, newlines, straight quotes. */
const pageFor = (url: string, skip?: RuleId) => rules.filter(rule => rule.source === url && rule.id !== skip)
  .map(rule => `# A heading\n\nSome words first. **${rule.quote.replace(/’/g, "'").replace(/ /g, ' \n ')}** And more.`).join('\n\n');

test('verifyDocs fetches each documentation page once, concurrently, and never fetches observed rules', async () => {
  const calls: { url: string; timeoutMs: number; release: () => void }[] = [];
  const fetcher: Fetcher = (url, timeoutMs) => new Promise(resolve => { calls.push({ url, timeoutMs, release: () => resolve({ ok: true, text: pageFor(url) }) }); });
  const done = verifyDocs(rules, fetcher);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls.map(call => call.url).sort(), [...pageSources].sort());
  assert.ok(calls.every(call => call.url !== 'observed' && call.timeoutMs === 60000));
  for (const call of calls) call.release();
  const checks = await done;
  assert.deepEqual(checks.map(check => check.url).sort(), [...pageSources].sort());
  assert.ok(checks.every(check => check.status === 'ok' && check.drifted.length === 0));
  const custom: number[] = [];
  await verifyDocs(rules.slice(0, 1), async (url, timeoutMs) => { custom.push(timeoutMs); return { ok: true, text: pageFor(url) }; }, { timeoutMs: 7 });
  assert.deepEqual(custom, [7]);
});

test('verifyDocs names the rules whose quote left the page, and tells an unreachable page from drift', async () => {
  const driftUrl = rules.find(rule => rule.id === 'claude.listing.drop-order')?.source as string;
  assert.ok(rules.filter(rule => rule.source === driftUrl).length > 1);
  const unreachableUrl = rules.find(rule => rule.id === 'codex.mcp.config')?.source as string;
  const throwingUrl = rules.find(rule => rule.id === 'spec.skill.name')?.source as string;
  const fetcher: Fetcher = async url => {
    if (url === unreachableUrl) return { ok: false, text: 'ignored' };
    if (url === throwingUrl) throw new Error('network is down');
    return { ok: true, text: pageFor(url, url === driftUrl ? 'claude.listing.drop-order' : undefined) };
  };
  const checks = await verifyDocs(rules, fetcher);
  const by = (url: string) => checks.find(check => check.url === url);
  assert.deepEqual(by(driftUrl), { url: driftUrl, status: 'drift', drifted: ['claude.listing.drop-order'] });
  assert.deepEqual(by(unreachableUrl), { url: unreachableUrl, status: 'unreachable', drifted: [] });
  assert.deepEqual(by(throwingUrl), { url: throwingUrl, status: 'unreachable', drifted: [] });
  assert.equal(checks.filter(check => check.status === 'ok').length, pageSources.length - 3);
  assert.deepEqual(await verifyDocs(rules.filter(rule => rule.source === 'observed'), async () => assert.fail('observed rules have no page')), []);
});

test('jinaFetcher reads the page through Jina Reader and reports failures instead of throwing', async () => {
  const realFetch = globalThis.fetch;
  const seen: string[] = [];
  const reply = (body: string, status = 200) => { globalThis.fetch = (async (url: string) => { seen.push(url); return new Response(body, { status }); }) as typeof fetch; };
  try {
    reply('Title: Page\n\nMarkdown Content:\nbody');
    assert.deepEqual(await jinaFetcher('https://example.com/docs', 1000), { ok: true, text: 'Title: Page\n\nMarkdown Content:\nbody' });
    assert.deepEqual(seen, ['https://r.jina.ai/https://example.com/docs']);
    reply('Title: Page Not Found\n\nWarning: Target URL returned error 404: Not Found\n\nMarkdown Content:\nnone');
    assert.equal((await jinaFetcher('https://example.com/missing', 1000)).ok, false);
    reply('rate limited', 429);
    assert.equal((await jinaFetcher('https://example.com/docs', 1000)).ok, false);
    globalThis.fetch = (async () => { throw new TypeError('fetch failed'); }) as typeof fetch;
    assert.deepEqual(await jinaFetcher('https://example.com/docs', 1000), { ok: false, text: '' });
    globalThis.fetch = ((_url: string, init: RequestInit) => new Promise((_resolve, reject) => { init.signal?.addEventListener('abort', () => reject(new Error('aborted'))); })) as typeof fetch;
    assert.deepEqual(await jinaFetcher('https://example.com/slow', 1), { ok: false, text: '' });
  } finally { globalThis.fetch = realFetch; }
});

test('newerHosts reports a host whose installed version is newer than the newest one its rules were verified on', () => {
  const verified = { claude: '2.1.292', codex: '0.160.1' };
  assert.deepEqual(newerHosts(rules, { claude: '2.1.300 (Claude Code)', codex: 'codex-cli 0.161.0' }), [
    { host: 'claude', verifiedOn: verified.claude, installed: '2.1.300' }, { host: 'codex', verifiedOn: verified.codex, installed: '0.161.0' },
  ]);
  assert.deepEqual(newerHosts(rules, { claude: '2.1.292 (Claude Code)', codex: 'codex-cli 0.160.1' }), []);
  assert.deepEqual(newerHosts(rules, { claude: '2.1.290', codex: '0.159.9' }), []);
  assert.deepEqual(newerHosts(rules, { claude: '2.1.292.0' }), []);
  assert.deepEqual(newerHosts(rules, { claude: '2.1.1000' }), [{ host: 'claude', verifiedOn: verified.claude, installed: '2.1.1000' }]);
  assert.deepEqual(newerHosts(rules, { codex: 'v0.161' }), [{ host: 'codex', verifiedOn: verified.codex, installed: '0.161' }]);
  assert.deepEqual(newerHosts(rules, { claude: '3' }), [{ host: 'claude', verifiedOn: verified.claude, installed: '3' }]);
  assert.deepEqual(newerHosts(rules, { claude: 'unknown', codex: '' }), []);
  assert.deepEqual(newerHosts(rules, {}), []);
  assert.deepEqual(newerHosts(rules.filter(rule => rule.host === 'spec'), { claude: '9.9.9', codex: '9.9.9' }), []);
  const mixed = rules.map(rule => rule.id === 'claude.mcp.scopes' ? { ...rule, hostVersion: '2.1.300' } : rule);
  assert.deepEqual(newerHosts(mixed, { claude: '2.1.300' }), []);
  assert.deepEqual(newerHosts(mixed, { claude: '2.1.301' }), [{ host: 'claude', verifiedOn: '2.1.300', installed: '2.1.301' }]);
});
