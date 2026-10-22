/** Listing projection, setup findings and package reading, on synthetic inventories and rules. */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { auditFindings, exitCode, projectListing, jstackSurface } from '../scripts/analyze.js';
import { RULE_IDS } from '../scripts/types.js';
import { displayWidth } from '../scripts/width.js';
import type { Finding, HookEntry, Host, HostInventory, HostSettings, ListedEntry, McpServer, PluginInfo, Rule, RuleId, JstackSurface } from '../scripts/types.js';

const VALUES: Partial<Record<RuleId, number>> = {
  'claude.listing.desc-cap': 1536, 'claude.listing.budget-fraction': 0.01, 'claude.listing.chars-per-token': 3, 'claude.listing.fallback-chars': 8000,
  'codex.listing.budget-fraction': 0.02, 'codex.listing.fallback-chars': 8000, 'codex.listing.max-context-tokens-cap': 10000, 'claude.agents.description-warning': 15000,
  'claude.listing.host-skills': 0,
};
const rules = (): Rule[] => RULE_IDS.map(id => ({ id, host: id.split('.')[0] as Rule['host'], topic: id, statement: id, value: VALUES[id], source: 'observed', quote: id, evidence: 'synthetic', verifiedAt: '2026-10-01' }));
const settings = (patch: Partial<HostSettings> = {}): HostSettings => ({ skillOverrides: {}, usage: {}, ...patch });
const inv = (host: Host, patch: Partial<HostInventory> = {}): HostInventory => ({ host, home: '/h', homeSource: 'option', plugins: [], entries: [], mcp: [], hooks: [], settings: settings(), warnings: [], ...patch });
const entry = (patch: Partial<ListedEntry> & { name: string }): ListedEntry => ({ host: 'claude', kind: 'skill', qualified: patch.name, origin: 'user', source: `/h/skills/${patch.name}/SKILL.md`, descriptionChars: 100, whenToUseChars: 0, ...patch });
/** A package entry; `named` says its frontmatter gives the name, which is what lets a plugin skill or command hold a bare name. */
const jstackEntry = (host: Host, name: string, descriptionChars: number, kind: ListedEntry['kind'] = 'skill', named = true): ListedEntry => ({ host, kind, name, qualified: `jstack:${name}`, origin: 'plugin', source: host === 'codex' ? `r0/x/${name}/SKILL.md` : `/p/${name}.md`, plugin: 'jstack', descriptionChars, whenToUseChars: 0, ...(named ? { holds: [name] } : {}) });
const surface = (entries: ListedEntry[], patch: Partial<JstackSurface> = {}): JstackSurface => ({ skills: [], commands: [], agents: [], entries, hooks: [], ...patch });
const hook = (patch: Partial<HookEntry> & { handler: string }): HookEntry => ({ host: 'claude', event: 'PreToolUse', matcher: '', origin: 'user', source: '/h/settings.json', ...patch });
const plugin = (id: string, host: Host = 'claude', enabled = true): PluginInfo => ({ host, id, enabled });
const NOW = 1_700_000_000_000, DAY = 86_400_000;

function audit(inventories: HostInventory[], jstack?: JstackSurface | Partial<Record<Host, JstackSurface>>, windows?: number[], model?: string): Finding[] {
  const listing = inventories.flatMap(i => projectListing(i, rules(), { jstack: jstack && 'entries' in jstack ? jstack : jstack?.[i.host], now: NOW, windows, model }));
  return auditFindings(inventories, rules(), { listing, jstack, now: NOW, model });
}
const codes = (findings: Finding[], code: string, host?: Host) => findings.filter(f => f.code === code && (!host || f.host === host));

test('Claude budget is window x chars-per-token x fraction, and an entry costs `- name: text` plus a newline between entries', () => {
  const entries = [entry({ name: 'alpha', descriptionChars: 100 }), entry({ name: 'beta', descriptionChars: 1000, whenToUseChars: 1000 })];
  const [small, large] = projectListing(inv('claude', { entries }), rules());
  assert.deepEqual([small!.window, small!.budgetChars, large!.window, large!.budgetChars], [200_000, 6000, 1_000_000, 30_000]);
  assert.match(small!.basis, /^1% of 200000 tokens x 3 chars \(model unknown, so 3 as for current models; claude-3\*, .* count 4\)/);
  assert.doesNotMatch(small!.basis, /own skills/, 'no host block is counted unless the rule gives one');
  // alpha: `- alpha: ` + 100 = 5 + 4 + 100; beta: description, ` - `, when_to_use are 2003 chars, cut to the 1536 cap; one newline joins them.
  assert.equal(small!.totalChars, (5 + 4 + 100) + (4 + 4 + 1536) + 1);
  assert.deepEqual(small!.reduced, []);
  const capped = projectListing(inv('claude', { entries, settings: settings({ skillListingMaxDescChars: 50 }) }), rules(), { windows: [200_000] });
  assert.equal(capped[0]!.totalChars, (5 + 4 + 50) + (4 + 4 + 50) + 1);
  const joined = projectListing(inv('claude', { entries: [entry({ name: 'x', descriptionChars: 10, whenToUseChars: 5 })] }), rules(), { windows: [200_000] });
  assert.equal(joined[0]!.totalChars, 1 + 4 + 10 + 3 + 5, 'when_to_use is joined with " - "');
});

test('the budget counts 4 characters per token for the host\'s older models and 3 for every other one', () => {
  const entries = [entry({ name: 'alpha' })];
  const budget = (model?: string) => projectListing(inv('claude', { entries }), rules(), { windows: [200_000], model })[0]!;
  assert.equal(budget().budgetChars, 6000);
  assert.equal(budget('claude-opus-5-5').budgetChars, 6000);
  assert.match(budget('claude-opus-5-5').basis, /x 3 chars .*\(claude-opus-5-5 counts 3\)/);
  for (const older of ['claude-opus-4-1', 'claude-sonnet-4-0', 'claude-haiku-4-5', 'claude-haiku-4-5-20251001', 'claude-haiku-4-5@20251001', 'us.anthropic.claude-haiku-4-5-v1:0', 'Claude-Opus-4.1[1m]']) {
    assert.equal(budget(older).budgetChars, 8000, older);
    assert.match(budget(older).basis, /x 4 chars .*counts 4\)/, older);
  }
  assert.equal(budget('claude-sonnet-5-5-20260101').budgetChars, 6000);
  assert.equal(budget('opus').budgetChars, 6000, 'an alias the audit cannot resolve counts as a current model');
  for (const alias of ['sonnet', 'haiku', 'opusplan', 'Opus[1m]']) assert.match(budget(alias).basis, /x 3 chars .*\(model alias "[a-z]+" cannot be resolved here, so 3 as for current models; an alias that resolves to an older model counts 4\)/, alias);
  assert.doesNotMatch(budget('claude-opus-5-5').basis, /alias/, 'a model id with a version is not an alias');
  assert.equal(budget('  ').budgetChars, 6000);
  assert.equal(projectListing(inv('claude', { entries }), rules(), { windows: [1_000_000], model: 'claude-opus-4-1' })[0]!.budgetChars, 40_000);
});

test('the budget fraction setting, SLASH_COMMAND_TOOL_CHAR_BUDGET and an unknown window follow the host', () => {
  const entries = [entry({ name: 'alpha' })];
  const fraction = projectListing(inv('claude', { entries, settings: settings({ skillListingBudgetFraction: 0.02 }) }), rules());
  assert.deepEqual(fraction.map(p => p.budgetChars), [12_000, 60_000]);
  assert.match(fraction[0]!.basis, /2% of 200000 tokens x 3 chars \(skillListingBudgetFraction\)/);
  const env = projectListing(inv('claude', { entries, settings: settings({ listingCharBudget: 500, skillListingBudgetFraction: 0.02 }) }), rules());
  assert.deepEqual(env.map(p => p.budgetChars), [500, 500]);
  assert.match(env[0]!.basis, /SLASH_COMMAND_TOOL_CHAR_BUDGET=500/);
  const unknown = projectListing(inv('claude', { entries }), rules(), { windows: [0] })[0]!;
  assert.equal(unknown.budgetChars, 6000, 'the host assumes 200000 tokens');
  assert.match(unknown.basis, /200000 tokens \(the host assumes this/);
  assert.equal(projectListing(inv('claude', { entries }), rules(), { windows: [0], model: 'claude-haiku-4-5' })[0]!.budgetChars, 8000, 'the documented 8,000 fallback is the 4-character case');
});

test('a budget fraction outside 0 to 1 and an invalid description cap are ignored, as the host does', () => {
  const entries = [entry({ name: 'alpha', descriptionChars: 3000 })];
  for (const bad of [5, 0, -0.5, 1.0001]) {
    const p = projectListing(inv('claude', { entries, settings: settings({ skillListingBudgetFraction: bad }) }), rules(), { windows: [200_000] })[0]!;
    assert.equal(p.budgetChars, 6000, String(bad));
    assert.match(p.basis, new RegExp(`^1% of 200000 tokens x 3 chars \\(skillListingBudgetFraction ${String(bad).replace('.', '\\.')} is outside 0 to 1 and ignored\\)`));
  }
  assert.equal(projectListing(inv('claude', { entries, settings: settings({ skillListingBudgetFraction: 1 }) }), rules(), { windows: [200_000] })[0]!.budgetChars, 600_000);
  for (const cap of [0, -1, 1.5]) assert.equal(projectListing(inv('claude', { entries, settings: settings({ skillListingMaxDescChars: cap }) }), rules(), { windows: [200_000] })[0]!.totalChars, 5 + 4 + 1536, String(cap));
});

test('overrides and invocation flags decide what is listed, and plugin entries ignore overrides', () => {
  const entries = [
    entry({ name: 'plain', descriptionChars: 100 }),
    entry({ name: 'nameonly', override: 'name-only' }),
    entry({ name: 'offy', override: 'off' }),
    entry({ name: 'uio', override: 'user-invocable-only' }),
    entry({ name: 'hidden', disableModelInvocation: true }),
    entry({ name: 'p', qualified: 'other:p', origin: 'plugin', plugin: 'other', descriptionChars: 50, override: 'off' }),
    entry({ name: 'p2', qualified: 'other:p2', origin: 'plugin', plugin: 'other', descriptionChars: 50, override: 'name-only' }),
    entry({ name: 'reviewer', kind: 'agent', descriptionChars: 5000 }),
  ];
  // plain 5+4+100, nameonly 8+2, other:p 7+4+50, other:p2 8+4+50, and three newlines between the four listed entries.
  assert.equal(projectListing(inv('claude', { entries }), rules())[0]!.totalChars, 109 + 10 + 61 + 62 + 3);
  // A claude.ai skill synced into the home is not a plugin skill: the host applies its override, keyed by the full name or by the bare name while no other command holds it.
  const synced = entry({ name: 'pdf', qualified: 'anthropic-skills:pdf', origin: 'connector', override: 'name-only' });
  assert.equal(projectListing(inv('claude', { entries: [synced] }), rules())[0]!.totalChars, 20 + 2);
});

test('a package skill or command whose frontmatter names it holds the bare name of a synced claude.ai skill, and one without a name does not', () => {
  const synced = (override?: ListedEntry['override']) => entry({ name: 'google-workspace', qualified: 'anthropic-skills:google-workspace', origin: 'connector', ...(override ? { override } : {}) });
  const bare = settings({ skillOverrides: { 'google-workspace': 'off' } }), full = settings({ skillOverrides: { 'anthropic-skills:google-workspace': 'off' } });
  const total = (entries: ListedEntry[], jstack?: JstackSurface, patch = bare) => projectListing(inv('claude', { entries, settings: patch }), rules(), { windows: [200_000], jstack })[0]!.totalChars;
  // A synced row is `- anthropic-skills:google-workspace: ` + 100 (33 + 4 + 100), the package skill `- jstack:google-workspace: ` + 100 (20 + 4 + 100), and one newline joins two rows.
  const syncedRow = 33 + 4 + 100, packageRow = 23 + 4 + 100;
  assert.equal(total([synced('off')]), 0, 'the bare key hides the synced skill while nothing holds the name');
  assert.equal(total([synced('off')], surface([jstackEntry('claude', 'google-workspace', 100)])), syncedRow + packageRow + 1, 'the package skill holds the name, so the bare key no longer reaches the synced skill');
  assert.equal(total([synced('off'), jstackEntry('claude', 'google-workspace', 100)]), syncedRow + packageRow + 1, 'an installed plugin skill holds the name as well');
  assert.equal(total([synced('off')], surface([jstackEntry('claude', 'google-workspace', 100, 'command')])), syncedRow + packageRow + 1, 'a plugin command whose frontmatter names it holds the name');
  assert.equal(total([synced('off')], surface([jstackEntry('claude', 'google-workspace', 100, 'command', false)])), packageRow, 'a plugin command without a frontmatter name does not');
  assert.equal(total([synced('off')], surface([jstackEntry('claude', 'google-workspace', 100, 'skill', false)])), packageRow, 'nor does a plugin skill without one');
  assert.equal(total([synced('off')], surface([jstackEntry('claude', 'google-workspace', 100)]), full), packageRow, 'the full-name key still hides it');
  assert.equal(total([synced()], surface([jstackEntry('claude', 'google-workspace', 100)]), full), packageRow, 'the full-name key hides it though the inventory preset no override');
  assert.equal(total([synced('off'), entry({ kind: 'command', name: 'google-workspace', holds: ['google-workspace'] })]), syncedRow + (16 + 4 + 100) + 1, 'a user command holds the name too');
  assert.equal(total([synced('off'), entry({ name: 'google-workspace', holds: ['GOOGLE-Workspace'] })]), syncedRow + (16 + 4 + 100) + 1, 'a name of another case holds it');
  // A composed name in the settings and a decomposed one in the holder differ only in Unicode form: the synced row is 21 + 4 + 100 characters, the holder's 1 + 4 + 100.
  const cafe = entry({ name: 'caf\u00e9', qualified: 'anthropic-skills:caf\u00e9', origin: 'connector' }), cafeKey = settings({ skillOverrides: { 'caf\u00e9': 'off' } });
  assert.equal(total([cafe], undefined, cafeKey), 0, 'the bare key hides a synced skill that nothing holds');
  assert.equal(total([cafe, entry({ name: 'x', holds: ['Cafe\u0301'] })], undefined, cafeKey), (21 + 4 + 100) + (1 + 4 + 100) + 1, 'a name that differs only in Unicode form and case still holds');
  assert.equal(total([synced('off'), entry({ kind: 'agent', name: 'google-workspace' })]), 0, 'an agent never holds a skill name');
  assert.equal(total([synced('off'), entry({ kind: 'command', name: 'google-workspace', qualified: 'ns:google-workspace', holds: ['ns:google-workspace'] })]), 19 + 4 + 100, 'a command in a subfolder is listed under its namespaced name and does not hold the bare one');
  // An installed jstack skill held the name, so the inventory left the synced skill without an override; a package without that skill gives the bare key back.
  assert.equal(total([synced(), jstackEntry('claude', 'google-workspace', 100)], surface([jstackEntry('claude', 'plan', 100)])), 11 + 4 + 100, 'a package that drops the holder lets the bare key reach the synced skill again');
  assert.equal(total([synced(), jstackEntry('claude', 'google-workspace', 100)], surface([jstackEntry('claude', 'plan', 100)]), settings()), syncedRow + (11 + 4 + 100) + 1, 'with no key at all the synced skill is simply listed');
  const nameOnly = settings({ skillOverrides: { 'google-workspace': 'name-only' } });
  assert.equal(total([synced('name-only')], undefined, nameOnly), 33 + 2, 'a name-only entry that nothing displaces keeps the name alone');
  assert.equal(total([synced('name-only')], surface([jstackEntry('claude', 'google-workspace', 100)]), nameOnly), syncedRow + packageRow + 1, 'a displaced entry lists the full description again');
});

test('over budget, descriptions go to the highest usage scores and an entry that does not fit is skipped while later ones still fit', () => {
  // Names have 2 characters: name-only costs 4, so the descriptions cost 12 (aa), 42 (bb), 17 (cc) and 7 (dd) more; all in full: 16 + 46 + 21 + 11 + 3 newlines = 97.
  const entries = [['aa', 10], ['bb', 40], ['cc', 15], ['dd', 5]].map(([name, descriptionChars]) => entry({ name: name as string, descriptionChars: descriptionChars as number }));
  const usage = { bb: { count: 3, lastUsedAt: NOW }, cc: { count: 3, lastUsedAt: NOW }, aa: { count: 1, lastUsedAt: NOW } };
  const project = (listingCharBudget: number, list = entries) => projectListing(inv('claude', { entries: list, settings: settings({ usage, listingCharBudget }) }), rules(), { windows: [200_000], now: NOW })[0]!;
  assert.equal(project(60).totalChars, 97);
  assert.deepEqual(project(97).reduced, [], 'a listing that fits keeps every description');
  // 60: 19 for the name-only lines and newlines leaves 41. By score bb (3), cc (3, after bb in listing order), aa (1), dd (0): bb needs 42 and is skipped, cc 17 -> 24, aa 12 -> 12, dd 7 -> 5.
  assert.deepEqual(project(60).reduced, ['bb']);
  // 30 leaves 11: bb, cc and aa do not fit, dd does.
  assert.deepEqual(project(30).reduced, ['aa', 'bb', 'cc']);
  // 61 leaves 42: bb fits exactly and nothing else does.
  assert.deepEqual(project(61).reduced, ['aa', 'cc', 'dd']);
  // Equal scores keep the listing order: with cc listed before bb, cc keeps its description and bb (42 > 25 left) loses it, so the result flips.
  assert.deepEqual(project(61, [entries[0]!, entries[2]!, entries[1]!, entries[3]!]).reduced, ['bb']);
  assert.deepEqual(project(19).reduced, ['aa', 'bb', 'cc', 'dd'], 'only the name-only lines fit');
  assert.deepEqual(project(10).reduced, ['aa', 'bb', 'cc', 'dd'], 'not even the name-only lines fit');
});

test('the recency weight floors at 0.1, a missing usage entry scores 0 and a missing last-use time counts as the floor', () => {
  const entries = [entry({ name: 'x' }), entry({ name: 'y' }), entry({ name: 'z' }), entry({ name: 'w' })];
  const usage = { x: { count: 10, lastUsedAt: NOW - 1000 * DAY }, y: { count: 5, lastUsedAt: NOW }, z: { count: 1, lastUsedAt: NOW - 7 * DAY } };
  // Each entry is 3 + 102; the name-only lines and three newlines take 15. Scores: y 5, x 10 x 0.1 = 1, z 0.5, w 0.
  const project = (listingCharBudget: number, patch: HostSettings['usage'] = {}) => projectListing(inv('claude', { entries, settings: settings({ usage: { ...usage, ...patch }, listingCharBudget }) }), rules(), { windows: [200_000], now: NOW })[0]!.reduced;
  assert.deepEqual(project(350), ['w']);
  assert.deepEqual(project(219), ['z', 'w']);
  assert.deepEqual(project(150), ['x', 'z', 'w']);
  assert.deepEqual(project(321), ['w'], 'three descriptions fit: y, x, z');
  assert.deepEqual(project(321, { w: { count: 10 } }), ['z'], 'w scores 10 x 0.1 = 1 without a last-use time, ahead of z at 0.5');
});

test('a jstack package replaces installed jstack entries, keeps their usage history, and its share is reported', () => {
  const entries = [entry({ name: 'mine', descriptionChars: 100 }), jstackEntry('claude', 'old', 999)];
  const jstack = surface([jstackEntry('claude', 'plan', 400), jstackEntry('claude', 'review', 300), jstackEntry('claude', 'plan', 5000, 'agent'), jstackEntry('codex', 'plan', 777)]);
  const options = { windows: [200_000], now: NOW, jstack };
  const stale = projectListing(inv('claude', { entries, settings: settings({ listingCharBudget: 700 }) }), rules(), { windows: [200_000], now: NOW })[0]!;
  assert.equal(stale.totalChars, 108 + 1013 + 1);
  assert.equal(stale.jstackChars, 1013 + 1);
  const usage = { 'jstack:plan': { count: 50, lastUsedAt: NOW } };
  const updated = projectListing(inv('claude', { entries, settings: settings({ listingCharBudget: 700, usage }) }), rules(), options)[0]!;
  assert.equal(updated.totalChars, 108 + 415 + 317 + 2);
  assert.equal(updated.jstackChars, 416 + 318);
  assert.deepEqual(updated.reduced, ['jstack:review'], 'jstack:plan is the most used and keeps its description, then mine fits; jstack:review no longer does');
});

test('usage of a synced claude.ai skill is read under its short name, and a plugin skill under its qualified name', () => {
  // anthropic-skills:docx (23) and anthropic-skills:pdf (22) cost 102 more for a description; 148 leaves room for one.
  const connector = (name: string) => entry({ name, qualified: `anthropic-skills:${name}`, origin: 'connector' });
  const entries = [connector('docx'), connector('pdf')];
  const reduced = (usage: Record<string, { count: number; lastUsedAt: number }>) => projectListing(inv('claude', { entries, settings: settings({ usage, listingCharBudget: 148 }) }), rules(), { windows: [200_000], now: NOW })[0]!.reduced;
  assert.deepEqual(reduced({}), ['anthropic-skills:pdf'], 'without usage the listing order decides');
  assert.deepEqual(reduced({ pdf: { count: 5, lastUsedAt: NOW } }), ['anthropic-skills:docx'], 'the short name is what the host records');
  assert.deepEqual(reduced({ 'anthropic-skills:pdf': { count: 5, lastUsedAt: NOW } }), ['anthropic-skills:docx'], 'the qualified name is the fallback');
  const plugins = [entry({ name: 'a', qualified: 'p:a', origin: 'plugin', plugin: 'p@m' }), entry({ name: 'b', qualified: 'p:b', origin: 'plugin', plugin: 'p@m' })];
  const pluginReduced = (usage: Record<string, { count: number; lastUsedAt: number }>) => projectListing(inv('claude', { entries: plugins, settings: settings({ usage, listingCharBudget: 120 }) }), rules(), { windows: [200_000], now: NOW })[0]!.reduced;
  assert.deepEqual(pluginReduced({ b: { count: 9, lastUsedAt: NOW } }), ['p:b'], 'a bare name is not a plugin skill\'s record: the first listed keeps the room');
  assert.deepEqual(pluginReduced({ 'p:b': { count: 9, lastUsedAt: NOW } }), ['p:a']);
});

test('Codex budget follows max_context_tokens up to its cap, the window fraction, or the fallback', () => {
  const src = '/h/.agents/skills/one/SKILL.md';
  const entries = [entry({ host: 'codex', name: 'one', descriptionChars: 100, source: src }), entry({ host: 'codex', name: 'two', disabled: true }), entry({ host: 'codex', kind: 'agent', name: 'default' })];
  const budgets = (patch: Partial<HostSettings> = {}, windows?: number[]) => projectListing(inv('codex', { entries, settings: settings(patch) }), rules(), { windows }).map(p => p.budgetChars);
  assert.deepEqual(budgets(), [16_000, 80_000]);
  assert.deepEqual(budgets({ skillsMaxContextTokens: 1000 }), [4000, 4000]);
  assert.deepEqual(budgets({ skillsMaxContextTokens: 50_000 }), [40_000, 40_000]);
  assert.deepEqual(budgets({}, [0]), [8000]);
  const p = projectListing(inv('codex', { entries }), rules(), { windows: [200_000] })[0]!;
  assert.equal(p.totalChars, 3 + (4 + 'one/SKILL.md'.length) + 100);
  assert.match(p.basis, /^2% of 200000 tokens x 4 chars \(characters per token assumed: Codex documents none\); each path counts a 4-char root alias plus the path under its skills root, as Codex prints it \(observed: codex\.listing\.path-alias\)$/);
  assert.match(projectListing(inv('codex', { entries, settings: settings({ skillsMaxContextTokens: 50_000 }) }), rules())[0]!.basis, /capped at 10000.*assumed/);
  const over = projectListing(inv('codex', { entries, settings: settings({ skillsMaxContextTokens: 10 }) }), rules())[0]!;
  assert.deepEqual(over.reduced, ['one']);
});

test('a Codex path costs a 4-character root alias plus the path under its skills root, installed or packaged alike', () => {
  const cost = (source: string) => projectListing(inv('codex', { entries: [entry({ host: 'codex', name: 'plan', qualified: 'jstack:plan', source, descriptionChars: 0 })] }), rules(), { windows: [200_000] })[0]!.totalChars - 'jstack:plan'.length;
  const under = 'workflow/plan/SKILL.md'.length;
  assert.equal(cost('/h/.agents/skills/workflow/plan/SKILL.md'), 4 + under);
  assert.equal(cost('/c/plugins/cache/jstack/jstack/0.9.10/entries/codex/workflow/plan/SKILL.md'), 4 + under, 'a plugin cache skills root');
  assert.equal(cost('r0/workflow/plan/SKILL.md'), 4 + under, 'the package form already holds the root alias');
  assert.equal(cost('r11/workflow/plan/SKILL.md'), 4 + under);
  assert.equal(cost('C:\\Users\\me\\.agents\\skills\\workflow\\plan\\SKILL.md'), 4 + under);
  assert.equal(cost('/opt/x/SKILL.md'), 4 + '/opt/x/SKILL.md'.length, 'under no known root the whole path counts');
  // The installed jstack and the package it came from cost the same.
  const installed = entry({ host: 'codex', name: 'plan', qualified: 'jstack:plan', origin: 'plugin', plugin: 'jstack@jstack', source: '/h/.codex/plugins/cache/jstack/jstack/1/entries/codex/workflow/plan/SKILL.md', descriptionChars: 30 });
  const packaged = { ...jstackEntry('codex', 'plan', 30), source: 'r0/workflow/plan/SKILL.md' };
  assert.equal(projectListing(inv('codex', { entries: [installed] }), rules(), { windows: [200_000] })[0]!.totalChars, projectListing(inv('codex', { entries: [installed] }), rules(), { windows: [200_000], jstack: surface([packaged]) })[0]!.totalChars);
});

test('listing-over-budget names the largest non-plugin entries and never plugin skills', () => {
  const user = ['s1', 's2', 's3', 's4', 's5', 's6'].map(name => entry({ name, descriptionChars: 3000 }));
  const entries = [...user, entry({ name: 'big', qualified: 'other:big', origin: 'plugin', plugin: 'other', descriptionChars: 5000 })];
  const found = codes(audit([inv('claude', { entries })]), 'listing-over-budget');
  assert.equal(found.length, 1);
  const f = found[0]!;
  assert.equal(f.severity, 'warn');
  // Six user entries cost 4 + 1538 and the plugin entry 11 + 1538 with the cap; six newlines make 10807 against 6000.
  assert.match(f.title, /4807 chars over budget at 200000 tokens/);
  assert.match(f.detail, /total 10807 chars against a budget of 6000 \(1% of 200000 tokens x 3 chars/);
  assert.match(f.detail, /4 of 7 entries would be listed by name only/);
  assert.match(f.detail, /200000 tokens -> 6000 chars \(over\); 1000000 tokens -> 30000 chars \(fits\)/);
  assert.match(f.action!, /"skillOverrides": \{"s1": "name-only", "s2": "name-only", "s3": "name-only", "s4": "name-only"\}/);
  assert.doesNotMatch(f.action!, /"s5"|"other:big": "name-only"/);
  assert.match(f.action!, /\/plugin/);
  assert.match(f.action!, /skillListingBudgetFraction to at least 0\.019/);
  assert.equal(f.rules.includes('claude.listing.overrides-not-plugins'), true);
  assert.equal(f.rules.includes('claude.listing.entry-format'), true);
  assert.deepEqual(codes(audit([inv('claude', { entries: user.slice(0, 2) })]), 'listing-over-budget'), []);
  const env = codes(audit([inv('claude', { entries, settings: settings({ listingCharBudget: 5000 }) })]), 'listing-over-budget')[0]!;
  assert.match(env.action!, /SLASH_COMMAND_TOOL_CHAR_BUDGET to at least/);
});

test('over budget with synced claude.ai skills, the action offers syncClaudeAiSkills and the full-name override', () => {
  const entries = ['docx', 'pdf', 'pptx', 'xlsx'].map(name => entry({ name, qualified: `anthropic-skills:${name}`, origin: 'connector', descriptionChars: 3000 }));
  const f = codes(audit([inv('claude', { entries })]), 'listing-over-budget')[0]!;
  assert.match(f.action!, /"syncClaudeAiSkills": false in your user settings/);
  assert.match(f.action!, /always-synced ones such as pdf and xlsx/);
  assert.match(f.action!, /an entry under the full name, such as "anthropic-skills:docx": "name-only" in skillOverrides, collapses one and "off" hides it in this profile\)/);
  assert.doesNotMatch(f.action!, /short name/);
  assert.match(f.action!, /4 synced/);
  assert.doesNotMatch(f.action!, /"skillOverrides": \{/, 'a synced skill is not offered under its qualified name');
});

test('Codex over budget says the reduction order is undocumented and points at the diagnostic', () => {
  const entries = Array.from({ length: 40 }, (_, i) => entry({ host: 'codex', name: `skill${i}`, descriptionChars: 400, source: `/h/.agents/skills/skill${i}/SKILL.md` }));
  const f = codes(audit([inv('codex', { entries })]), 'listing-over-budget', 'codex')[0]!;
  assert.match(f.detail, /order is undocumented/);
  assert.match(f.detail, /codex debug prompt-input/);
  assert.match(f.detail, /characters per token assumed/);
  assert.equal(f.rules.includes('codex.diagnostics.prompt-input'), true);
  assert.equal(f.rules.includes('codex.listing.path-alias'), true, 'each path is counted as a root alias plus the path under its root');
  assert.equal(f.rules.includes('claude.listing.chars-per-token'), false, 'the Claude observation is not the source of the Codex budget');
  assert.match(f.action!, /\[\[skills\.config\]\] enabled = false/);
  assert.match(f.action!, /skills\.max_context_tokens to at least/);
  assert.deepEqual(codes(audit([inv('codex', { entries: entries.slice(0, 3) })]), 'listing-over-budget'), []);
  const huge = codes(audit([inv('codex', { entries: entries.map(e => ({ ...e, descriptionChars: 5000 })) })]), 'listing-over-budget')[0]!;
  assert.match(huge.action!, /cannot cover it: \d+ tokens needed, maximum 10000/);
  const dropped = codes(audit([inv('codex', { entries })], surface([jstackEntry('codex', 'plan', 100)])), 'jstack-descriptions-dropped', 'codex');
  assert.equal(dropped.length, 1);
  assert.match(dropped[0]!.detail, /undocumented order/);
  assert.equal(dropped[0]!.rules.includes('codex.listing.path-alias'), true);
  assert.deepEqual(codes(audit([inv('codex', { entries })]), 'jstack-descriptions-dropped'), []);
});

test('jstack-descriptions-dropped fires only when a jstack entry loses its description', () => {
  const user = [entry({ name: 'u1', descriptionChars: 3000 })];
  const jstack = surface(['p1', 'p2', 'p3'].map(n => jstackEntry('claude', n, 1000)));
  const used = { u1: { count: 3, lastUsedAt: NOW } };
  // u1 costs 4 + 1538 and each jstack entry 8 + 1002, so the full listing is 4575. At 3500 the name-only lines and newlines leave 3469: the used u1 keeps its description, p1 fits, p2 and p3 do not.
  const dropped = codes(audit([inv('claude', { entries: user, settings: settings({ listingCharBudget: 3500, usage: used }) })], jstack), 'jstack-descriptions-dropped');
  assert.equal(dropped.length, 1);
  assert.match(dropped[0]!.title, /2 of 3 jstack entries lose their description/);
  assert.deepEqual(dropped[0]!.evidence, ['jstack:p2', 'jstack:p3']);
  assert.match(dropped[0]!.detail, /rarely auto-trigger/);
  assert.match(dropped[0]!.detail, /highest usage score/);
  assert.doesNotMatch(dropped[0]!.detail, /lowest usage score|largest description/);
  const jstackUsed = Object.fromEntries(['p1', 'p2', 'p3'].map(n => [`jstack:${n}`, { count: 1, lastUsedAt: NOW }]));
  const kept = audit([inv('claude', { entries: user, settings: settings({ listingCharBudget: 3100, usage: jstackUsed }) })], jstack);
  assert.deepEqual(codes(kept, 'jstack-descriptions-dropped'), [], 'used jstack entries keep their descriptions and only u1 loses its own');
  assert.equal(codes(kept, 'listing-over-budget').length, 1);
  assert.deepEqual(codes(audit([inv('claude', { entries: user, settings: settings({ listingCharBudget: 99_999 }) })], jstack), 'jstack-descriptions-dropped'), []);
});

test('description-truncated and spec-limits report entries beyond the caps', () => {
  const entries = [entry({ name: 'long', descriptionChars: 1000, whenToUseChars: 800 }), entry({ name: 'fine', descriptionChars: 1000 }), entry({ name: 'Bad_Name' }), entry({ name: 'x'.repeat(65) }), entry({ name: 'wordy', descriptionChars: 1025 })];
  const found = audit([inv('claude', { entries })]);
  const truncated = codes(found, 'description-truncated')[0]!;
  assert.equal(truncated.severity, 'info');
  assert.deepEqual(truncated.evidence, ['long: 1803 chars'], 'description, " - " and when_to_use are one text');
  assert.deepEqual(codes(audit([inv('claude', { entries: [entry({ name: 'fine' })] })]), 'description-truncated'), []);
  const small = codes(audit([inv('claude', { entries: [entry({ name: 'ok', descriptionChars: 600 })], settings: settings({ skillListingMaxDescChars: 500 }) })]), 'description-truncated');
  assert.equal(small.length, 1);
  const spec = codes(found, 'spec-limits')[0]!;
  assert.equal(spec.severity, 'info');
  assert.equal(spec.evidence.length, 3);
  assert.match(spec.evidence.join('\n'), /Bad_Name: name "Bad_Name"/);
  assert.match(spec.evidence.join('\n'), /wordy: description 1025 chars, limit 1024/);
  assert.deepEqual(codes(audit([inv('claude', { entries: [entry({ name: 'fine-name' }), entry({ name: 'Cmd', kind: 'command' })] })]), 'spec-limits'), []);
  assert.equal(codes(audit([inv('codex', { entries: [entry({ host: 'codex', name: 'Bad' })] })]), 'spec-limits', 'codex').length, 1);
});

test('name-collision covers Claude commands, skills and agents and Codex skills, but only against jstack', () => {
  const jstack = surface([], { skills: ['plan', 'review', 'audit'], commands: ['branch'], agents: ['quality-auditor'] });
  const claude = inv('claude', { entries: [
    entry({ name: 'branch', kind: 'command' }), entry({ name: 'plan' }), entry({ name: 'review', qualified: 'omc:review', origin: 'plugin', plugin: 'omc' }),
    entry({ name: 'quality-auditor', kind: 'agent' }), entry({ name: 'plan', kind: 'agent' }), entry({ name: 'plan', qualified: 'jstack:plan', origin: 'plugin', plugin: 'jstack' }), entry({ name: 'unrelated' }),
  ] });
  const codex = inv('codex', { entries: [entry({ host: 'codex', name: 'review' }), entry({ host: 'codex', name: 'unrelated' })] });
  const found = codes(audit([claude, codex], jstack), 'name-collision');
  const pick = (host: Host, severity: string) => found.filter(f => f.host === host && f.severity === severity);
  assert.equal(found.length, 4);
  assert.equal(pick('claude', 'warn')[0]!.evidence.length, 1);
  assert.match(pick('claude', 'warn')[0]!.evidence[0]!, /^branch /);
  assert.deepEqual(pick('claude', 'warn')[0]!.rules, ['claude.skills.precedence', 'claude.skills.plugin-namespace']);
  const info = found.filter(f => f.host === 'claude' && f.severity === 'info');
  assert.equal(info.length, 2);
  assert.deepEqual(info.map(f => f.evidence.length), [2, 1]);
  assert.deepEqual(info.at(-1)!.rules, ['claude.agents.precedence']);
  assert.match(info.at(-1)!.detail, /undocumented/);
  assert.equal(pick('codex', 'warn').length, 1);
  assert.deepEqual(pick('codex', 'warn')[0]!.rules, ['codex.skills.same-name']);
  assert.deepEqual(codes(audit([claude, codex]), 'name-collision'), []);
});

test('agent-descriptions-heavy counts jstack agents at the host\'s 4 characters per token and warns past the token limit', () => {
  const entries = [entry({ name: 'big', kind: 'agent', descriptionChars: 40_000 })];
  const jstack = surface([jstackEntry('claude', 'auditor', 25_000, 'agent')]);
  assert.deepEqual(codes(audit([inv('claude', { entries })]), 'agent-descriptions-heavy'), []);
  const f = codes(audit([inv('claude', { entries })], jstack), 'agent-descriptions-heavy')[0]!;
  assert.equal(f.severity, 'warn');
  // The host estimates `<type>: <description>` per agent: (3 + 2 + 40000) / 4 and (11 + 2 + 25000) / 4, each rounded.
  assert.match(f.title, /16255 tokens, above the 15000-token/);
  assert.match(f.detail, /at 4 chars per token/);
  assert.deepEqual(f.evidence, ['big (user): 40005 chars']);
  assert.deepEqual(f.rules, ['claude.agents.description-warning']);
});

test('codex-agent-overrides-builtin names custom agents that replace default, worker or explorer', () => {
  const entries = [entry({ host: 'codex', kind: 'agent', name: 'worker' }), entry({ host: 'codex', kind: 'agent', name: 'reviewer' })];
  const f = codes(audit([inv('codex', { entries })]), 'codex-agent-overrides-builtin')[0]!;
  assert.equal(f.severity, 'info');
  assert.match(f.title, /1 custom Codex agent replaces a built-in: worker/);
  assert.deepEqual(codes(audit([inv('codex', { entries: entries.slice(1) })]), 'codex-agent-overrides-builtin'), []);
  assert.deepEqual(codes(audit([inv('claude', { entries: [entry({ kind: 'agent', name: 'worker' })] })]), 'codex-agent-overrides-builtin'), []);
});

test('duplicate-hook flags one handler from two sources, including jstack against existing hooks', () => {
  const plugin1 = hook({ handler: 'hooks/guard.js', origin: 'plugin', plugin: 'guard', source: '/p/hooks.json' });
  const dup = codes(audit([inv('claude', { hooks: [hook({ handler: 'hooks/guard.js' }), plugin1] })]), 'duplicate-hook');
  assert.equal(dup.length, 1);
  assert.equal(dup[0]!.severity, 'warn');
  assert.deepEqual(dup[0]!.rules, ['claude.hooks.plugin-merge']);
  assert.match(dup[0]!.title, /hooks\/guard\.js on PreToolUse is registered by 2 sources/);
  assert.deepEqual(codes(audit([inv('claude', { hooks: [hook({ handler: 'hooks/guard.js', matcher: 'Bash' }), hook({ handler: 'hooks/guard.js', matcher: 'Write' })] })]), 'duplicate-hook'), []);
  assert.deepEqual(codes(audit([inv('claude', { hooks: [hook({ handler: 'hooks/guard.js' }), hook({ handler: 'hooks/guard.js', event: 'Stop', origin: 'project' })] })]), 'duplicate-hook'), []);
  assert.deepEqual(codes(audit([inv('claude', { hooks: [hook({ handler: 'hooks/guard.js' }), plugin1], settings: settings({ disableAllHooks: true }) })]), 'duplicate-hook'), []);
  const codexDup = codes(audit([inv('codex', { hooks: [hook({ host: 'codex', handler: 'hooks/guard.js' }), hook({ host: 'codex', handler: 'hooks/guard.js', origin: 'project' })] })]), 'duplicate-hook');
  assert.deepEqual(codexDup[0]!.rules, ['codex.hooks.all-load']);
  const jstack = surface([], { hooks: [{ event: 'PreToolUse', matcher: 'Bash', handler: 'hooks/dispatch.js' }] });
  const existing = inv('claude', { hooks: [hook({ handler: 'hooks/dispatch.js' })] });
  const vsJstack = codes(audit([existing], jstack), 'duplicate-hook');
  assert.equal(vsJstack.length, 1);
  assert.match(vsJstack[0]!.evidence.join(), /plugin:jstack/);
  assert.deepEqual(codes(audit([existing]), 'duplicate-hook'), []);
  const codexOnly = surface([], { hooks: [{ host: 'codex', event: 'PreToolUse', matcher: 'Bash', handler: 'hooks/dispatch.js' }] as unknown as JstackSurface['hooks'] });
  assert.deepEqual(codes(audit([existing], codexOnly), 'duplicate-hook'), []);
  const installed = inv('claude', { hooks: [hook({ handler: 'hooks/dispatch.js', origin: 'plugin', plugin: 'jstack' })] });
  assert.deepEqual(codes(audit([installed], jstack), 'duplicate-hook'), []);
});

test('Claude runs one copy of a handler found in several settings files, and a copy per plugin', () => {
  const settingsCopy = (origin: HookEntry['origin']) => hook({ handler: 'hooks/guard.js', origin, source: `/${origin}/settings.json` });
  const pluginCopy = (id: string) => hook({ handler: 'hooks/guard.js', origin: 'plugin', plugin: id, source: '/p/hooks.json' });
  const found = (hooks: HookEntry[], host: Host = 'claude') => codes(audit([inv(host, { hooks: hooks.map(h => ({ ...h, host })) })]), 'duplicate-hook');
  assert.deepEqual(found([settingsCopy('user'), settingsCopy('project'), settingsCopy('local')]), [], 'settings files merge');
  assert.deepEqual(found([pluginCopy('a@m'), pluginCopy('a@m')]), [], 'one plugin installed at two scopes loads once');
  const withSettings = found([settingsCopy('user'), settingsCopy('project'), pluginCopy('a@m')]);
  assert.equal(withSettings.length, 1);
  assert.match(withSettings[0]!.title, /registered by 2 sources/);
  assert.match(withSettings[0]!.action!, /remove the settings copy or disable the plugin that adds the other/);
  assert.deepEqual(withSettings[0]!.evidence, ['user:/user/settings.json (all)', 'project:/project/settings.json (all)', 'plugin:a@m (all)']);
  const twoPlugins = found([pluginCopy('a@m'), pluginCopy('b@m')]);
  assert.equal(twoPlugins.length, 1);
  assert.match(twoPlugins[0]!.title, /registered by 2 sources/);
  assert.match(twoPlugins[0]!.action!, /disable all but one of the plugins that add it/);
  assert.doesNotMatch(twoPlugins[0]!.action!, /settings copy/);
  const all = found([settingsCopy('user'), pluginCopy('a@m'), pluginCopy('b@m')]);
  assert.match(all[0]!.title, /registered by 3 sources/);
  assert.match(all[0]!.action!, /remove the settings copy and disable all but one of the plugins/);
  assert.equal(found([settingsCopy('user'), settingsCopy('project')], 'codex').length, 1, 'Codex loads every source');
});

test('prompt-routers lists UserPromptSubmit sources and warns from two', () => {
  const router = (patch: Partial<HookEntry>) => hook({ handler: 'hooks/route.js', event: 'UserPromptSubmit', ...patch });
  const none = surface([]);
  const one = codes(audit([inv('claude', { hooks: [router({})] })], none), 'prompt-routers')[0]!;
  assert.equal(one.severity, 'info');
  assert.match(one.detail, /jstack adds none/);
  const two = codes(audit([inv('claude', { hooks: [router({}), router({ origin: 'plugin', plugin: 'omc', source: '/p' })] })]), 'prompt-routers')[0]!;
  assert.equal(two.severity, 'warn');
  assert.deepEqual(two.evidence, ['user:/h/settings.json', 'plugin:omc']);
  assert.equal(codes(audit([inv('claude', { hooks: [router({}), router({})] })]), 'prompt-routers')[0]!.severity, 'info');
  assert.deepEqual(codes(audit([inv('claude', { hooks: [hook({ handler: 'x' })] })]), 'prompt-routers'), []);
});

test('MCP findings: always-loaded servers, a name in several settings scopes, and plugin or connector servers on a shared endpoint', () => {
  const server = (patch: Partial<McpServer> & { name: string }): McpServer => ({ host: 'claude', origin: 'user', source: '/h/.claude.json', transport: 'stdio', ...patch });
  const mcp = [server({ name: 'a', alwaysLoad: true }), server({ name: 'off', alwaysLoad: true, enabled: false }), server({ name: 'dup' }), server({ name: 'dup', origin: 'project' }), server({ name: 'dup', origin: 'plugin', plugin: 'p' }), server({ name: 'twice', origin: 'plugin', plugin: 'p' }), server({ name: 'twice', origin: 'plugin', plugin: 'q' })];
  const found = audit([inv('claude', { mcp })]);
  const always = codes(found, 'mcp-always-loaded')[0]!;
  assert.deepEqual(always.rules, ['claude.mcp.tool-search']);
  assert.equal(always.evidence.length, 1);
  const shadowed = codes(found, 'mcp-shadowed')[0]!;
  assert.deepEqual(shadowed.evidence, ['dup: project wins over user'], 'a plugin server is not matched by name');
  assert.deepEqual(shadowed.rules, ['claude.mcp.scopes']);
  assert.deepEqual(codes(audit([inv('claude', { mcp: [server({ name: 'plain' })] })]), 'mcp-shadowed'), []);
  assert.deepEqual(codes(audit([inv('codex', { mcp: mcp.map(s => ({ ...s, host: 'codex' as const })) })]), 'mcp-always-loaded'), []);
  const remote = (patch: Partial<McpServer> & { name: string }) => server({ transport: 'http', endpoint: 'https://mcp.example.com', ...patch });
  const byEndpoint = codes(audit([inv('claude', { mcp: [remote({ name: 'docs' }), remote({ name: 'docs-by-plugin', origin: 'plugin', plugin: 'p' }), remote({ name: 'claude.ai Docs', origin: 'connector' }), remote({ name: 'else', endpoint: 'https://other.example.com', origin: 'plugin', plugin: 'p' })] })]), 'mcp-shadowed')[0]!;
  assert.deepEqual(byEndpoint.evidence, ['https://mcp.example.com: user docs wins over plugin docs-by-plugin, connector claude.ai Docs']);
  assert.match(byEndpoint.detail, /compared here by scheme and host only/);
  assert.deepEqual(codes(audit([inv('claude', { mcp: [remote({ name: 'one', origin: 'plugin', plugin: 'p' }), remote({ name: 'two', origin: 'plugin', plugin: 'q' })] })]), 'mcp-shadowed'), []);
});

test('ineffective-override flags only keys that name plugin skills', () => {
  const entries = [
    entry({ name: 'component', kind: 'command', qualified: 'frontend:component' }), entry({ name: 'apps/web:deploy' }),
    entry({ name: 'plan', qualified: 'jstack:plan', origin: 'plugin', plugin: 'jstack@jstack' }),
  ];
  const skillOverrides: HostSettings['skillOverrides'] = { 'frontend:component': 'name-only', 'apps/web:deploy': 'off', 'jstack:plan': 'name-only', 'oh-my-claudecode:ralph': 'off', 'off:thing': 'off', plain: 'off' };
  const plugins = [plugin('jstack@jstack'), plugin('oh-my-claudecode@omc'), plugin('off@x', 'claude', false)];
  const found = codes(audit([inv('claude', { entries, plugins, settings: settings({ skillOverrides }) })]), 'ineffective-override');
  assert.equal(found.length, 1);
  assert.deepEqual(found[0]!.evidence, ['jstack:plan: name-only', 'oh-my-claudecode:ralph: off']);
  assert.match(found[0]!.title, /^2 skillOverrides entries name plugin skills/);
  assert.deepEqual(codes(audit([inv('claude', { entries, plugins, settings: settings({ skillOverrides: { 'frontend:component': 'name-only', 'apps/web:deploy': 'off' } }) })]), 'ineffective-override'), []);
  // Before jstack is installed, a key naming one of the package's skills is already known to be ineffective.
  const beforeInstall = codes(audit([inv('claude', { settings: settings({ skillOverrides: { 'jstack:plan': 'off', 'jstack:nothing': 'off' } }) })], surface([jstackEntry('claude', 'plan', 50)])), 'ineffective-override');
  assert.deepEqual(beforeInstall.map(f => f.evidence), [['jstack:plan: off']]);
});

test('override-misses-synced-skill reports bare keys that another command holds, with what holds the name and the full-name key to use', () => {
  const synced = (name: string) => entry({ name, qualified: `anthropic-skills:${name}`, origin: 'connector' });
  const entries = [synced('google-workspace'), synced('pdf'), synced('docx'), synced('xlsx'), synced('pptx'), entry({ name: 'pdf', holds: ['pdf'] }), entry({ name: 'xlsx', kind: 'command', qualified: 'ns:xlsx', holds: ['ns:xlsx'] }), entry({ name: 'pptx', kind: 'agent' })];
  const skillOverrides: HostSettings['skillOverrides'] = { 'google-workspace': 'off', pdf: 'name-only', docx: 'off', 'anthropic-skills:docx': 'off', xlsx: 'on', pptx: 'off', 'jstack:plan': 'off', 'no-synced-skill': 'off' };
  const found = codes(audit([inv('claude', { entries, settings: settings({ skillOverrides }) })], surface([jstackEntry('claude', 'google-workspace', 50), jstackEntry('claude', 'no-synced-skill', 50, 'command', false)])), 'override-misses-synced-skill');
  assert.equal(found.length, 1);
  const f = found[0]!;
  assert.deepEqual([f.severity, f.host, f.rules], ['warn', 'claude', ['claude.listing.synced-override-key']]);
  assert.equal(f.title, '2 skillOverrides entries do not reach the synced claude.ai skill of that name');
  assert.deepEqual(f.evidence, ['google-workspace: off (name held by jstack:google-workspace)', 'pdf: name-only (name held by pdf)']);
  assert.match(f.detail, /answers to its bare name only while no other command holds that name/);
  assert.match(f.detail, /applies the entry to the skill or command of the user's own that is listed under exactly that name, if there is one, and otherwise to nothing \(a plugin skill or command, or a skill that carries the name only in its frontmatter\); either way the synced skill keeps its place in the listing\.$/);
  // Nothing of the user's is listed as google-workspace, so its entry applies to nothing; the user's own skill is listed as pdf, so that entry may be meant for it.
  assert.equal(f.action, 'Key each entry by the full name, which the host always applies to the synced skill: "anthropic-skills:google-workspace": "off", "anthropic-skills:pdf": "name-only". '
    + 'Remove the bare entry "google-workspace": no skill or command of yours is listed under exactly that name, so it applies to nothing. Keep the bare entry "pdf" only if it is meant for the skill or command of yours listed under that name.');
  // The same key is fine while nothing holds the name, and the finding sits beside the plugin-skill one.
  assert.deepEqual(codes(audit([inv('claude', { entries, settings: settings({ skillOverrides }) })]), 'override-misses-synced-skill')[0]!.evidence, ['pdf: name-only (name held by pdf)']);
  const only = (names: string[], holders: ListedEntry[], jstack?: JstackSurface) => codes(audit([inv('claude', { entries: [...names.map(synced), ...holders], settings: settings({ skillOverrides: Object.fromEntries(names.map(name => [name, 'off'])) }) })], jstack), 'override-misses-synced-skill')[0]!;
  const single = only(['google-workspace'], [], surface([jstackEntry('claude', 'google-workspace', 50)]));
  assert.equal(single.title, '1 skillOverrides entry does not reach the synced claude.ai skill of that name');
  assert.equal(single.action, 'Key the entry by the full name, which the host always applies to the synced skill: "anthropic-skills:google-workspace": "off". Remove the bare entry "google-workspace": no skill or command of yours is listed under exactly that name, so it applies to nothing.');
  const own = only(['pdf'], [entry({ name: 'pdf', holds: ['pdf'] })]);
  assert.equal(own.action, 'Key the entry by the full name, which the host always applies to the synced skill: "anthropic-skills:pdf": "off". Keep the bare entry "pdf" only if it is meant for the skill or command of yours listed under that name.');
  assert.doesNotMatch(own.action!, /Remove/);
  // One holder listed under exactly that name is enough to keep the entry.
  const mixed = only(['pdf'], [entry({ name: 'pdf', holds: ['pdf'] }), jstackEntry('claude', 'pdf', 50), entry({ name: 'pdf', qualified: 'pdf', holds: ['folder', 'pdf'] })]);
  assert.match(mixed.action!, /\. Keep the bare entry "pdf" only if it is meant for/);
  assert.doesNotMatch(mixed.action!, /Remove/);
  assert.equal(mixed.evidence[0], 'pdf: off (name held by jstack:pdf, pdf, pdf)');
  const plugins = only(['pdf', 'docx'], [jstackEntry('claude', 'pdf', 50), jstackEntry('claude', 'docx', 50, 'command')]);
  assert.match(plugins.action!, /\. Remove the bare entries "docx", "pdf": no skill or command of yours is listed under exactly those names, so they apply to nothing\.$/);
  assert.doesNotMatch(plugins.action!, /Keep/);
  // A skill of the user's that carries the name only in its frontmatter, or under another case, holds it without being reached by the key.
  for (const holder of [entry({ name: 'pdf', holds: ['folder', 'pdf'] }), entry({ name: 'PDF', holds: ['PDF'] })]) {
    const unreached = only(['pdf'], [holder]);
    assert.match(unreached.action!, /\. Remove the bare entry "pdf": no skill or command of yours is listed under exactly that name, so it applies to nothing\.$/);
    assert.doesNotMatch(unreached.action!, /Keep/);
  }
});

test('override-misses-synced-skill stays quiet when the host applies the entry or nothing holds the name', () => {
  const synced = entry({ name: 'google-workspace', qualified: 'anthropic-skills:google-workspace', origin: 'connector' });
  const miss = (patch: Partial<HostInventory>, jstack?: JstackSurface) => codes(audit([inv('claude', { entries: [synced], ...patch })], jstack), 'override-misses-synced-skill');
  const bare = (value: HostSettings['skillOverrides'][string] = 'off') => settings({ skillOverrides: { 'google-workspace': value } });
  const holder = surface([jstackEntry('claude', 'google-workspace', 50)]);
  assert.equal(miss({ settings: bare() }, holder).length, 1, 'the package skill holds the name');
  assert.deepEqual(miss({ settings: bare() }), [], 'nothing holds the name');
  assert.deepEqual(miss({ settings: settings({ skillOverrides: { 'google-workspace': 'off', 'anthropic-skills:google-workspace': 'off' } }) }, holder), [], 'the full-name key is set too');
  assert.deepEqual(miss({ settings: bare('on') }, holder), [], 'the value is on');
  assert.equal(miss({ settings: bare() }, surface([jstackEntry('claude', 'google-workspace', 50, 'command')])).length, 1, 'a plugin command whose frontmatter names it holds the name');
  assert.deepEqual(miss({ settings: bare() }, surface([jstackEntry('claude', 'google-workspace', 50, 'command', false)])), [], 'a plugin command without a frontmatter name does not');
  assert.deepEqual(miss({ settings: bare() }, surface([jstackEntry('claude', 'google-workspace', 50, 'skill', false)])), [], 'nor does a plugin skill without one');
  const pluginCommand = entry({ name: 'google-workspace', kind: 'command', qualified: 'p:google-workspace', origin: 'plugin', plugin: 'p@m' });
  assert.deepEqual(miss({ entries: [synced, pluginCommand], settings: bare() }), [], 'an installed plugin command without a frontmatter name does not hold it either');
  assert.equal(miss({ entries: [synced, { ...pluginCommand, holds: ['google-workspace'] }], settings: bare() }).length, 1, 'one whose frontmatter names it does');
  assert.deepEqual(miss({ entries: [synced, entry({ name: 'google-workspace', kind: 'agent' })], settings: bare() }), [], 'an agent never holds a skill name');
  assert.deepEqual(miss({ entries: [synced, entry({ name: 'google-workspace', kind: 'command', qualified: 'ns:google-workspace', holds: ['ns:google-workspace'] })], settings: bare() }), [], 'a command in a subfolder is listed as ns:google-workspace and does not hold it');
  assert.deepEqual(miss({ entries: [synced, entry({ name: 'zz-cmd', kind: 'command', holds: ['zz-cmd'] })], settings: bare() }), [], 'a command holds the name it is listed under, not its frontmatter name');
  assert.equal(miss({ entries: [synced, entry({ name: 'google-workspace', holds: ['google-workspace'] })], settings: bare() }).length, 1, 'a skill of the user holds the name');
  assert.equal(miss({ entries: [synced, entry({ name: 'renamed', holds: ['google-workspace', 'renamed'] })], settings: bare() }).length, 1, 'a skill of the user holds its folder name');
  assert.equal(miss({ entries: [synced, entry({ name: 'google-workspace', holds: ['Google-Workspace'] })], settings: bare() }).length, 1, 'a name of another case holds it');
  assert.deepEqual(miss({ entries: [entry({ name: 'google-workspace', holds: ['google-workspace'] })], settings: bare() }), [], 'without a synced skill of that name there is nothing to miss');
  assert.deepEqual(miss({ entries: [synced, entry({ name: 'Google-Workspace', holds: ['google-workspace'] })], settings: settings({ skillOverrides: { 'Google-Workspace': 'off' } }) }), [], 'a key is matched by its exact spelling, so a key of another case names no synced skill');
  assert.deepEqual(codes(audit([inv('codex', { entries: [synced], settings: bare() })], holder), 'override-misses-synced-skill'), [], 'Codex has no skillOverrides');
});

test('plugin findings: a second jstack blocks and inventory notes inform', () => {
  const two = codes(audit([inv('claude', { plugins: [plugin('jstack@jstack'), plugin('jstack-dev@local'), plugin('jstackx@m'), plugin('jstack-work@m', 'claude', false)] })]), 'second-jstack');
  assert.equal(two.length, 1);
  assert.equal(two[0]!.severity, 'block');
  assert.deepEqual(two[0]!.evidence, ['jstack@jstack', 'jstack-dev@local']);
  assert.deepEqual(codes(audit([inv('claude', { plugins: [plugin('jstack@jstack'), plugin('jstack-work@m', 'claude', false)] })]), 'second-jstack'), []);
  const scopes = [{ ...plugin('jstack@jstack'), scope: 'user' }, { ...plugin('jstack@jstack'), scope: 'project' }];
  assert.deepEqual(codes(audit([inv('claude', { plugins: scopes })]), 'second-jstack'), [], 'one plugin id at user and project scope is one jstack');
  const mixed = codes(audit([inv('claude', { plugins: [...scopes, plugin('jstack-dev@local')] })]), 'second-jstack')[0]!;
  assert.match(mixed.title, /^2 enabled Claude plugins are jstack/);
  assert.deepEqual(mixed.evidence, ['jstack@jstack', 'jstack-dev@local']);
  assert.equal(codes(audit([inv('codex', { plugins: [plugin('jstack@jstack', 'codex'), plugin('jstack-dev@staging', 'codex')] })]), 'second-jstack', 'codex').length, 1);
  const warnings = codes(audit([inv('claude', { warnings: ['config.toml is not valid TOML'] }), inv('codex')]), 'inventory-warnings');
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]!.title, '1 note from the Claude inventory');
  assert.deepEqual(warnings[0]!.evidence, ['config.toml is not valid TOML']);
});

test('findings come blocking first, every finding lists its rules, and exitCode follows the worst severity', () => {
  const found = audit([inv('claude', { plugins: [plugin('jstack@jstack'), plugin('jstack-dev@m')], warnings: ['w'], entries: [entry({ name: 'Bad' })] })]);
  assert.deepEqual(found.map(f => f.severity), ['block', 'info', 'info']);
  assert.equal(found.every(f => Array.isArray(f.rules)), true);
  const make = (...severity: Finding['severity'][]): Finding[] => severity.map(s => ({ code: 'x', severity: s, host: 'claude', title: '', detail: '', evidence: [], rules: [] }));
  assert.deepEqual([[], make('info'), make('warn', 'info'), make('info', 'block', 'warn')].map(exitCode), [0, 0, 0, 1]);
});

test('jstackSurface reads both hosts, hooks, names and the version from a package or installed plugin directory, and collisions work against it', () => {
  const base = mkdtempSync(join(tmpdir(), 'jstack-surface-')), dir = join(base, 'plugins/cache/jstack/jstack/1.2.3');
  const put = (path: string, content: string | object) => { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), typeof content === 'string' ? content : JSON.stringify(content)); };
  const description = 'Clarify requirements, write a spec, and check it. Triggers: plan.';
  try {
    put('.claude-plugin/plugin.json', { name: 'jstack', version: '1.2.3', skills: ['./entries/claude/workflow/plan', './entries/claude/engineering/author'], commands: ['./hosts/claude/commands'], hooks: './hooks/claude-hooks.json' });
    put('.codex-plugin/plugin.json', { name: 'jstack', version: '1.2.3', skills: './entries/codex', hooks: ['./hooks/hooks.json', './hooks/codex-hooks.json'] });
    put('entries/claude/workflow/plan/SKILL.md', `---\nname: plan\ndescription: "${description}"\nwhen_to_use: Use when planning.\n---\nbody`);
    put('entries/claude/engineering/author/SKILL.md', '---\nname: author\ndescription: Compatibility entry.\ndisable-model-invocation: true\n---\n');
    put('entries/codex/workflow/plan/SKILL.md', `---\nname: plan\ndescription: "${description}"\n---\nbody`);
    put('entries/codex/engineering/author/SKILL.md', '---\nname: author\ndescription: Compatibility entry.\ndisable-model-invocation: true\n---\n');
    put('hosts/claude/commands/branch.md', '---\ndescription: Create a branch\n---\n# branch');
    put('agents/auditor.md', '---\nname: quality-auditor\ndescription: Judge quality.\nmodel: opus\n---\n');
    put('hooks/hooks.json', { hooks: { PreToolUse: [{ matcher: 'Bash|Write', hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/payload/hooks/dispatch.js" PreToolUse' }] }] } });
    put('hooks/claude-hooks.json', { hooks: { SessionStart: [{ matcher: '', hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/payload/hooks/jst-path.js"' }] }] } });
    put('hooks/codex-hooks.json', { hooks: { SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: 'echo hello' }] }] } });
    put('payload/contracts/skill-catalog.json', { entries: [
      { owner: 'plan', name: 'plan', visibility: 'public', aliases: [] }, { owner: 'audit', name: 'review', visibility: 'public', aliases: ['audit'] },
      { owner: 'author', name: 'skill-creator', visibility: 'public', aliases: ['author', 'skill-authoring'], nativeAliases: ['author'] }, { owner: 'team', name: 'parallel-execution', visibility: 'support', aliases: ['team'] },
    ] });
    const s = jstackSurface(dir);
    assert.equal(s.version, '1.2.3');
    assert.deepEqual(s.skills, ['audit', 'author', 'plan', 'review', 'skill-authoring', 'skill-creator']);
    assert.deepEqual(s.commands, ['branch']);
    assert.deepEqual(s.agents, ['quality-auditor']);
    const claudePlan = s.entries.find(e => e.host === 'claude' && e.name === 'plan')!;
    assert.deepEqual([claudePlan.qualified, claudePlan.origin, claudePlan.plugin, claudePlan.descriptionChars, claudePlan.whenToUseChars], ['jstack:plan', 'plugin', 'jstack', description.length, 'Use when planning.'.length]);
    assert.equal(s.entries.find(e => e.host === 'claude' && e.name === 'author')!.disableModelInvocation, true);
    assert.equal(s.entries.find(e => e.kind === 'command')!.qualified, 'jstack:branch');
    assert.equal(s.entries.find(e => e.kind === 'agent')!.qualified, 'jstack:quality-auditor');
    const codexPlan = s.entries.find(e => e.host === 'codex' && e.name === 'plan')!;
    assert.deepEqual([codexPlan.qualified, codexPlan.source, codexPlan.descriptionChars], ['jstack:plan', 'r0/workflow/plan/SKILL.md', description.length]);
    assert.equal(s.entries.filter(e => e.host === 'codex').length, 2);
    const hooks = (host: string) => (s.hooks as (JstackSurface['hooks'][number] & { host: string })[]).filter(h => h.host === host).map(h => `${h.event}:${h.matcher}:${h.handler}`);
    // A hook is identified as the inventory identifies it: the plugin root spelled out, here the directory itself.
    assert.deepEqual(hooks('claude'), [`PreToolUse:Bash|Write:node ${dir}/payload/hooks/dispatch.js PreToolUse`, `SessionStart::node ${dir}/payload/hooks/jst-path.js`]);
    assert.deepEqual(hooks('codex'), [`PreToolUse:Bash|Write:node ${dir}/payload/hooks/dispatch.js PreToolUse`, 'SessionStart:startup:echo hello']);
    // The root can be the folder the host will run instead, and a root under the user's home is written with `~`.
    const asInstalled = jstackSurface(dir, { root: '/home/me/.claude/plugins/cache/jstack/jstack/1.2.2', home: '/home/me' }).hooks as (JstackSurface['hooks'][number] & { host: string })[];
    assert.deepEqual(asInstalled.filter(h => h.host === 'claude').map(h => h.handler), ['node ~/.claude/plugins/cache/jstack/jstack/1.2.2/payload/hooks/dispatch.js PreToolUse', 'node ~/.claude/plugins/cache/jstack/jstack/1.2.2/payload/hooks/jst-path.js']);
    const projected = projectListing(inv('claude'), rules(), { jstack: s, windows: [200_000] })[0]!;
    // jstack:plan: name + 2, then `: ` and the description joined to when_to_use; jstack:branch the same; one newline between them.
    assert.equal(projected.totalChars, ('jstack:plan'.length + 2 + 2 + description.length + 3 + 'Use when planning.'.length) + ('jstack:branch'.length + 2 + 2 + 'Create a branch'.length) + 1);
    assert.throws(() => jstackSurface(join(dir, 'missing')), /not a jstack package/);
    // Collisions are read from this surface, which here is an installed plugin directory rather than an extracted package.
    const claudeHome = inv('claude', { entries: [entry({ name: 'branch', kind: 'command' }), entry({ name: 'review' }), entry({ name: 'plan', qualified: 'jstack:plan', origin: 'plugin', plugin: 'jstack@jstack' })] });
    const collisions = codes(audit([claudeHome, inv('codex', { entries: [entry({ host: 'codex', name: 'review' })] })], s), 'name-collision');
    assert.deepEqual(collisions.map(f => [f.host, f.severity]).sort(), [['claude', 'info'], ['claude', 'warn'], ['codex', 'warn']]);
    assert.match(collisions.find(f => f.host === 'claude' && f.severity === 'warn')!.evidence[0]!, /^branch /);
    assert.deepEqual(codes(audit([claudeHome]), 'name-collision'), [], 'without a surface there is nothing to collide with');
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('jstackSurface gives a skill or command of the package its frontmatter name to hold, unless the name has a colon, and nothing to an agent or a Codex skill', () => {
  const base = mkdtempSync(join(tmpdir(), 'jstack-surface-holds-')), put = (path: string, content: string | object) => { mkdirSync(dirname(join(base, path)), { recursive: true }); writeFileSync(join(base, path), typeof content === 'string' ? content : JSON.stringify(content)); };
  try {
    put('.claude-plugin/plugin.json', { name: 'jstack', skills: ['./entries/claude'] });
    put('.codex-plugin/plugin.json', { name: 'jstack', skills: './entries/codex' });
    put('entries/claude/named/SKILL.md', '---\nname: named\ndescription: Skill that names itself\n---\n');
    put('entries/claude/folder-only/SKILL.md', '---\ndescription: Skill without a name\n---\n');
    put('entries/claude/coloned/SKILL.md', '---\nname: jstack:coloned\ndescription: Skill whose name has a colon\n---\n');
    put('commands/named-cmd.md', '---\nname: named-cmd\ndescription: Command that names itself\n---\n');
    put('commands/file-only.md', '---\ndescription: Command without a name\n---\n');
    put('agents/helper.md', '---\nname: helper\ndescription: Agent\n---\n');
    put('entries/codex/named/SKILL.md', '---\nname: named\ndescription: Codex skill\n---\n');
    const holds = Object.fromEntries(jstackSurface(base).entries.map(e => [`${e.host}:${e.kind}:${e.name}`, e.holds]));
    assert.deepEqual(holds, { 'claude:skill:named': ['named'], 'claude:skill:folder-only': undefined, 'claude:skill:jstack:coloned': undefined, 'claude:command:named-cmd': ['named-cmd'], 'claude:command:file-only': undefined, 'claude:agent:helper': undefined, 'codex:skill:named': undefined });
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('Claude measures listing text by display width: wide characters count 2, the cap cuts characters', () => {
  assert.deepEqual(['plan', '\uacc4\ud68d \uc218\ub9bd', '\uff46\uff55\uff4c\uff4c', '\u00e9', 'e\u0301', '\u200b', '\u{1F642}'].map(displayWidth), [4, 9, 8, 1, 1, 0, 2]);
  const korean = entry({ name: 'ko', descriptionChars: 10, descriptionWidth: 20 }), latin = entry({ name: 'en', descriptionChars: 10 });
  const cost = (e: ListedEntry, budget: number) => projectListing(inv('claude', { entries: [e], settings: settings({ listingCharBudget: budget }) }), rules(), { windows: [200_000] })[0]!.totalChars;
  assert.equal(cost(korean, 1000), 'ko'.length + 4 + 20, 'a Korean description weighs its display width');
  assert.equal(cost(latin, 1000), 'en'.length + 4 + 10);
  const capped = entry({ name: 'ko', descriptionChars: 3000, descriptionWidth: 6000 });
  assert.equal(cost(capped, 100000), 2 + 4 + 3072, 'the 1,536-character cap keeps half the text, so half the width');
});

test('each host is checked against its own jstack surface, and a host without one has none to collide with', () => {
  const jstack = surface([jstackEntry('claude', 'plan', 400), jstackEntry('codex', 'plan', 300)], { skills: ['plan', 'review'], commands: ['branch'], hooks: [{ event: 'UserPromptSubmit', matcher: '', handler: 'node /p/route.js' }] });
  const claude = inv('claude', { entries: [entry({ name: 'branch', kind: 'command' })] });
  const codex = inv('codex', { entries: [entry({ host: 'codex', name: 'review' })], hooks: [hook({ host: 'codex', event: 'UserPromptSubmit', handler: 'node /p/route.js' })] });
  const hosts = (found: Finding[], code: string) => codes(found, code).map(f => f.host).sort();
  const claudeOnly = audit([claude, codex], { claude: jstack });
  assert.deepEqual(hosts(claudeOnly, 'name-collision'), ['claude']);
  assert.deepEqual(hosts(claudeOnly, 'duplicate-hook'), [], 'Codex does not load the jstack hook that only Claude has installed');
  assert.doesNotMatch(codes(claudeOnly, 'prompt-routers', 'codex')[0]!.detail, /jstack adds/, 'without a jstack surface on a host nothing is said about what jstack adds there');
  assert.deepEqual(hosts(audit([claude, codex], { claude: jstack, codex: jstack }), 'name-collision'), ['claude', 'codex']);
  assert.deepEqual(hosts(audit([claude, codex], { claude: jstack, codex: jstack }), 'duplicate-hook'), ['codex']);
  assert.deepEqual(hosts(audit([claude, codex], { codex: jstack }), 'name-collision'), ['codex']);
  assert.deepEqual(hosts(audit([claude, codex], jstack), 'name-collision'), ['claude', 'codex'], 'a single surface still applies to both hosts');
});

test('when equal usage scores decide which entries lose their description, the finding says the host orders the ties by its own merge order', () => {
  const jstack = surface(['p1', 'p2', 'p3'].map(n => jstackEntry('claude', n, 1000)));
  // Each entry is `- jstack:pN` (8) with a 1002-char description; 2500 leaves 2474 after the name-only lines and newlines, room for two descriptions.
  const details = (usage: HostSettings['usage']) => { const found = audit([inv('claude', { settings: settings({ listingCharBudget: 2500, usage }) })], jstack); return [codes(found, 'listing-over-budget')[0]!.detail, codes(found, 'jstack-descriptions-dropped')[0]!.detail]; };
  const at = (count: number) => ({ count, lastUsedAt: NOW });
  for (const detail of details({})) { assert.match(detail, /Some entries share a usage score \(entries with no recorded use all score 0\)/); assert.match(detail, /its own merge order while the audit uses the inventory order/); }
  for (const detail of details({ 'jstack:p1': at(3), 'jstack:p2': at(3), 'jstack:p3': at(3) })) assert.match(detail, /share a usage score/, 'equal use ties as well');
  for (const detail of details({ 'jstack:p1': at(5), 'jstack:p2': at(3) })) assert.doesNotMatch(detail, /share a usage score/, 'p1 and p2 keep their descriptions and p3 alone has no use: no tie splits the kept from the lost');
  for (const detail of details({ 'jstack:p1': at(1), 'jstack:p2': at(3), 'jstack:p3': at(3) })) assert.doesNotMatch(detail, /share a usage score/, 'a tie between two kept entries decides nothing');
  const codexEntries = Array.from({ length: 40 }, (_, i) => entry({ host: 'codex', name: `skill${i}`, descriptionChars: 400, source: `/h/.agents/skills/skill${i}/SKILL.md` }));
  assert.doesNotMatch(codes(audit([inv('codex', { entries: codexEntries })]), 'listing-over-budget')[0]!.detail, /share a usage score/, 'Codex has no usage order');
});

test('an alias model counts 3 characters per token, and the over-budget finding says what an older model behind the alias would give', () => {
  // Nine entries cost 1006 each with their descriptions: 9062 with newlines, over 6000 (3 chars) and 8000 (4 chars) at 200K tokens.
  const entries = Array.from({ length: 9 }, (_, i) => entry({ name: `s${i}`, descriptionChars: 1000 }));
  const detail = (model?: string, list = entries, patch: Partial<HostSettings> = {}) => codes(audit([inv('claude', { entries: list, settings: settings(patch) })], undefined, undefined, model), 'listing-over-budget')[0]!.detail;
  // 4 chars: 8000 - 9 name-only lines (4) and 8 newlines leaves 7956, room for seven 1002-char descriptions; 3 chars: 6000 leaves 5956 and room for five.
  assert.match(detail('opus'), /4 of 9 entries would be listed by name only.* If the alias "opus" resolves to an older model that counts 4 characters per token, the budget is 8000 chars and 2 of 9 entries would be listed by name only\./);
  assert.match(detail('Sonnet[1m]'), /If the alias "Sonnet\[1m\]" resolves to an older model/);
  assert.doesNotMatch(detail('claude-opus-5-5'), /resolves to an older model/);
  assert.doesNotMatch(detail(), /resolves to an older model/, 'an unknown model is not an alias');
  assert.doesNotMatch(detail('opus', entries, { listingCharBudget: 6000 }), /resolves to an older model/, 'a fixed character budget does not depend on the model');
  // Seven entries (7048 chars) are over the 3-character budget but fit the 4-character one.
  assert.match(detail('opus', entries.slice(0, 7)), /the budget is 8000 chars and 0 of 7 entries would be listed by name only\./);
});

test('a plugin entry with neither a description nor a when_to_use is not listed; a user entry without one still is', () => {
  const entries = [
    entry({ name: 'described', qualified: 'p:described', origin: 'plugin', plugin: 'p@m', descriptionChars: 30 }),
    entry({ name: 'bare', qualified: 'p:bare', origin: 'plugin', plugin: 'p@m', descriptionChars: 12, hasDescription: false }),
    entry({ name: 'hinted', qualified: 'p:hinted', origin: 'plugin', plugin: 'p@m', descriptionChars: 0, whenToUseChars: 20, hasDescription: false }),
    entry({ name: 'mine', descriptionChars: 12, hasDescription: false }),
  ];
  const projected = projectListing(inv('claude', { entries, settings: settings({ listingCharBudget: 10_000 }) }), rules(), { windows: [200_000] })[0]!;
  // p:described 11+4+30, p:hinted 8+4+(0+3+20), mine 4+4+12, and two newlines; p:bare is absent.
  assert.equal(projected.totalChars, 45 + 35 + 20 + 2);
});

test("Claude Code's own skills take their share of the budget first", () => {
  const withHost = (chars: number) => rules().map(rule => (rule.id === 'claude.listing.host-skills' ? { ...rule, value: chars } : rule));
  const entries = [entry({ name: 'aa', descriptionChars: 40 }), entry({ name: 'bb', descriptionChars: 40 })];
  const run = (host: number, budget: number) => projectListing(inv('claude', { entries, settings: settings({ listingCharBudget: budget }) }), withHost(host), { windows: [200_000] })[0]!;
  // Two entries cost 2+4+40 each plus one newline: 93. With a 50-char host block and its newline the listing is 144.
  assert.deepEqual([run(0, 100).totalChars, run(0, 100).reduced.length, run(0, 100).hostChars], [93, 0, undefined]);
  const over = run(50, 102);
  assert.deepEqual([over.totalChars, over.hostChars], [144, 50]);
  // 102 - 51 leaves 51; the name-only lines and their newline take 9, so exactly one 42-char description (`: ` and 40) fits.
  assert.deepEqual(over.reduced, ['bb']);
  assert.deepEqual(run(120, 100).reduced, ['aa', 'bb'], 'a host block larger than the budget leaves no description');
  assert.match(over.basis, /Claude Code's own skills are counted as about 50 chars, kept first/);
  // Both entries tie at score 0 and one loses: the finding says the named entry may differ, with the host block taken into account.
  const finding = auditFindings([inv('claude', { entries, settings: settings({ listingCharBudget: 102 }) })], withHost(50), { listing: [over] }).find(f => f.code === 'listing-over-budget')!;
  assert.match(finding.detail, /host's own merge order|merge order/);
});

test('a package entry whose frontmatter cannot be read is reported, not dropped silently', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jstack-surface-bad-'));
  const put = (path: string, content: string | object) => { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), typeof content === 'string' ? content : JSON.stringify(content)); };
  try {
    put('.claude-plugin/plugin.json', { name: 'jstack', version: '1.0.0', skills: ['./entries/claude/workflow/plan'], commands: ['./commands'] });
    put('entries/claude/workflow/plan/SKILL.md', '---\nname: plan\ndescription: Plan: the work\n---\n');
    put('commands/ok.md', '# /ok — no frontmatter is fine\n');
    const surface = jstackSurface(dir);
    assert.deepEqual(surface.unreadable?.map(file => file.slice(dir.length + 1)), ['entries/claude/workflow/plan/SKILL.md']);
    assert.deepEqual(surface.entries.map(e => e.name), ['ok']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
