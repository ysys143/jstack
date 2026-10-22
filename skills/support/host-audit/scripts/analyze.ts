/** Projects the model-facing description listing from an inventory and the documented rules, reports setup findings, and reads jstack's own surface from a package. */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { handlerId, holdsBareName, pluginHolds, syncedOverride } from './inventory.js';
import { displayWidth } from './width.js';
import type { Finding, HookEntry, Host, HostInventory, ListedEntry, ListingProjection, McpServer, Origin, Rule, RuleId, Severity, JstackSurface } from './types.js';

const DEFAULT_WINDOWS = [200_000, 1_000_000];
/** The window the host assumes when it cannot tell. */
const HOST_DEFAULT_WINDOW = 200_000;
const DAY = 86_400_000;
/** The models the host counts at 4 characters per token in the listing budget (its set `JI`): the claude-3 family, opus 4-0/4-1/4-5/4-6, sonnet 4-0/4-5/4-6 and haiku 4-5. Every other model counts 3. */
const CPT4_MODEL = /^claude-(?:3-(?:5-)?(?:opus|sonnet|haiku)|3-7-sonnet|opus-4-[0156]|sonnet-4-[056]|haiku-4-5)$/;
const CPT4_FAMILIES = 'claude-3*, opus 4-0 to 4-6 (not 4-2 to 4-4), sonnet 4-0/4-5/4-6 and haiku 4-5';
/** Codex documents no characters per token for its budget, so this is an assumption. */
const CODEX_CHARS_PER_TOKEN = 4;
/** The host estimates subagent descriptions at 4 characters per token, whatever the model. */
const AGENT_CHARS_PER_TOKEN = 4;
const SKILL_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** Plugin names that are jstack itself: `jstack` and builds such as `jstack-dev`. */
const JSTACK_NAME = /^jstack(?:[-_.].*)?$/i;
const CODEX_BUILTIN_AGENTS = ['default', 'worker', 'explorer'];
/** Claude MCP scope precedence, highest first; the winning entry replaces the others whole. */
const SCOPE_RANK: Origin[] = ['managed', 'admin', 'local', 'project', 'user', 'plugin', 'connector', 'bundled'];
/** The scopes whose same-name servers the host merges by name; plugin servers and connectors are matched by endpoint instead. */
const SETTINGS_SCOPES: Origin[] = SCOPE_RANK.slice(0, 5);
const SEVERITY_RANK: Record<Severity, number> = { block: 0, warn: 1, info: 2 };

type Obj = Record<string, unknown>;
/** jstack hook rows may say which host loads them; a row without a host applies to both. */
type SurfaceHook = JstackSurface['hooks'][number] & { host?: Host };

/** A rule's numeric value. A missing one is a caller bug, so it fails loudly instead of defaulting. */
function num(rules: Rule[], id: RuleId): number {
  const value = rules.find(r => r.id === id)?.value;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`rule ${id} has no numeric value`);
  return value;
}
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const pct = (fraction: number) => `${Number((fraction * 100).toFixed(2))}%`;
const hostName = (host: Host) => (host === 'claude' ? 'Claude' : 'Codex');
/** Inventories record a plugin as its id (`jstack@jstack`); a package's own entries say `jstack`. */
const isJstack = (x: { origin: Origin; plugin?: string }) => x.origin === 'plugin' && !!x.plugin && JSTACK_NAME.test(x.plugin.split('@')[0]!);
const joined = (items: string[], max = 8) => items.slice(0, max).join(', ') + (items.length > max ? `, +${items.length - max} more` : '');
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The host's entries, with jstack's own replaced by the package's when a package is given. */
function entriesOf(inv: HostInventory, jstack?: JstackSurface): ListedEntry[] {
  const own = inv.entries.filter(e => e.host === inv.host);
  return jstack ? [...own.filter(e => !isJstack(e)), ...jstack.entries.filter(e => e.host === inv.host)] : own;
}

/**
 * One entry's weight in the listing: the part that always stays (Claude `- name`, Codex name and path) and the droppable rest.
 * For Claude `fixed` is the name-only line and `desc` what a description adds (`: ` and the capped text), 0 for an entry the user set to name-only.
 */
interface Row { entry: ListedEntry; fixed: number; desc: number }

/** The text after the name: the description, then ` - when_to_use` when there is one (the host joins them with three characters). */
const textChars = (e: ListedEntry) => e.descriptionChars + (e.whenToUseChars > 0 ? e.whenToUseChars + 3 : 0);
/** The same text as Claude Code measures it: display width, wide characters counting 2. The cap cuts characters, so the kept share of the width is scaled. */
const textWidth = (e: ListedEntry, cap: number) => {
  const chars = textChars(e), width = (e.descriptionWidth ?? e.descriptionChars) + (e.whenToUseChars > 0 ? (e.whenToUseWidth ?? e.whenToUseChars) + 3 : 0);
  return chars <= cap ? width : Math.round((width * cap) / chars);
};

/** The per-skill description cap; a setting that is not a positive integer is not accepted by the host and is ignored. */
function descCap(inv: HostInventory, rules: Rule[]): number {
  const set = inv.settings.skillListingMaxDescChars;
  return set !== undefined && Number.isInteger(set) && set > 0 ? set : num(rules, 'claude.listing.desc-cap');
}

/** The budget fraction; a setting outside 0 < f <= 1 is not accepted by the host and is ignored. */
function budgetFraction(inv: HostInventory, rules: Rule[]): number {
  const set = inv.settings.skillListingBudgetFraction;
  return set !== undefined && set > 0 && set <= 1 ? set : num(rules, 'claude.listing.budget-fraction');
}

/** Claude lists skills and commands; agents go elsewhere. A line is `- name: text`; a name-only entry is `- name`. */
function claudeRows(inv: HostInventory, rules: Rule[], jstack?: JstackSurface): Row[] {
  const cap = descCap(inv, rules), rows: Row[] = [], all = entriesOf(inv, jstack), overrides = inv.settings.skillOverrides;
  for (const entry of all) {
    if (entry.kind === 'agent' || entry.disableModelInvocation) continue;
    // A plugin skill or command with neither a description nor a when_to_use is not listed to the model at all.
    if (entry.origin === 'plugin' && entry.hasDescription === false && !entry.whenToUseChars) continue;
    // Everything but a plugin skill honors skillOverrides, synced claude.ai skills included.
    const overridable = entry.origin !== 'plugin';
    // A synced skill answers to its bare name only while no other command holds it, and a package can add or remove the holder, so one that settings name is resolved again against the projected entries.
    const keyed = entry.origin === 'connector' && (own(overrides, entry.qualified) !== undefined || own(overrides, entry.name) !== undefined);
    const setting = keyed ? syncedOverride(overrides, all, entry.name) : entry.override;
    if (overridable && (setting === 'off' || setting === 'user-invocable-only')) continue;
    rows.push({ entry, fixed: displayWidth(entry.qualified) + 2, desc: overridable && setting === 'name-only' ? 0 : 2 + textWidth(entry, cap) });
  }
  return rows;
}

/** What Codex prints for a skill's path, `(file: r11/workflow/plan/SKILL.md)`: a root alias (counted as four characters) and the path under the skills root. */
function codexPathChars(source: string): number {
  const path = source.split('\\').join('/'), alias = /^r\d+\//.exec(path);
  if (alias) return 4 + path.length - alias[0].length;
  const root = Math.max(...['/skills/', '/entries/codex/'].map(marker => (path.lastIndexOf(marker) < 0 ? -1 : path.lastIndexOf(marker) + marker.length)));
  return 4 + (root > 0 ? path.length - root : path.length);
}

/** Codex lists every enabled skill with its path. */
const codexRows = (inv: HostInventory, jstack?: JstackSurface): Row[] =>
  entriesOf(inv, jstack).filter(e => e.kind === 'skill' && !e.disabled).map(entry => ({ entry, fixed: entry.qualified.length + codexPathChars(entry.source), desc: entry.descriptionChars }));

/**
 * Characters per token for a Claude model, from the host's `jg`: 4 for its older set, 3 otherwise. The model id is normalized the way the host does (no suffixes, dots and underscores as hyphens).
 * An alias (`sonnet`, `haiku`, `opus`, `opusplan`: no version digits) is resolved by the host through server-side defaults before it picks 3 or 4, which the audit cannot see, so it counts 3 and says so.
 */
function claudeCharsPerToken(rules: Rule[], model?: string): { cpt: number; note: string; alias: boolean } {
  const current = num(rules, 'claude.listing.chars-per-token');
  if (!model?.trim()) return { cpt: current, note: ` (model unknown, so ${current} as for current models; ${CPT4_FAMILIES} count 4)`, alias: false };
  const key = model.trim().toLowerCase().replace(/\[[^\]]*\]$/, '').replace(/^(?:[a-z]{2,6}\.)?anthropic\./, '').replace(/-v\d+(?::\d+)?$/, '').replace(/(?:@|-)(?:\d{8}|latest)$/, '').replace(/[._]/g, '-');
  if (!/\d/.test(key)) return { cpt: current, note: ` (model alias "${key}" cannot be resolved here, so ${current} as for current models; an alias that resolves to an older model counts 4)`, alias: true };
  const cpt = CPT4_MODEL.test(key) ? 4 : current;
  return { cpt, note: ` (${key} counts ${cpt})`, alias: false };
}

/** Claude Code's own skills and prompt commands share the listing and its budget; they are not on disk, so an observed figure stands in for them. */
function hostSkillChars(rules: Rule[]): number {
  const value = rules.find(r => r.id === 'claude.listing.host-skills')?.value;
  return typeof value === 'number' && value > 0 ? value : 0;
}
function claudeBudget(inv: HostInventory, rules: Rule[], window: number, model?: string): [number, string] {
  const s = inv.settings, own = hostSkillChars(rules), note = own ? `; Claude Code's own skills are counted as about ${own} chars, kept first (observed; the figure varies by version and account)` : '';
  if (s.listingCharBudget !== undefined && s.listingCharBudget > 0) return [s.listingCharBudget, `SLASH_COMMAND_TOOL_CHAR_BUDGET=${s.listingCharBudget} chars${note}`];
  const { cpt, note: perToken } = claudeCharsPerToken(rules, model), fraction = budgetFraction(inv, rules), set = s.skillListingBudgetFraction, tokens = window > 0 ? window : HOST_DEFAULT_WINDOW;
  const from = set === undefined ? '' : fraction === set ? ' (skillListingBudgetFraction)' : ` (skillListingBudgetFraction ${set} is outside 0 to 1 and ignored)`;
  return [Math.max(1, Math.floor(tokens * cpt * fraction)), `${pct(fraction)} of ${tokens} tokens${window > 0 ? '' : ' (the host assumes this when the window is unknown)'} x ${cpt} chars${from}${perToken}${note}`];
}

function codexBudget(inv: HostInventory, rules: Rule[], window: number): [number, string] {
  const s = inv.settings, cpt = CODEX_CHARS_PER_TOKEN, assumed = ' (characters per token assumed: Codex documents none)';
  if (s.skillsMaxContextTokens !== undefined) {
    const cap = num(rules, 'codex.listing.max-context-tokens-cap'), tokens = Math.min(s.skillsMaxContextTokens, cap);
    return [tokens * cpt, `skills.max_context_tokens=${s.skillsMaxContextTokens}${tokens < s.skillsMaxContextTokens ? ` capped at ${cap}` : ''}: ${tokens} tokens x ${cpt} chars${assumed}`];
  }
  if (!(window > 0)) { const chars = num(rules, 'codex.listing.fallback-chars'); return [chars, `${chars} chars fallback for an unknown context window`]; }
  const fraction = num(rules, 'codex.listing.budget-fraction');
  return [Math.round(window * fraction * cpt), `${pct(fraction)} of ${window} tokens x ${cpt} chars${assumed}; each path counts a 4-char root alias plus the path under its skills root, as Codex prints it (observed: codex.listing.path-alias)`];
}

const own = <T>(record: Record<string, T>, key: string): T | undefined => (Object.hasOwn(record, key) ? record[key] : undefined);

/** Claude's keep priority: usage count weighted by recency (halves weekly, floor 0.1). No usage scores 0. */
function usageScore(use: { count: number; lastUsedAt?: number } | undefined, now: number): number {
  if (!use) return 0;
  const days = use.lastUsedAt === undefined ? Infinity : (now - use.lastUsedAt) / DAY;
  return use.count * Math.max(0.5 ** (days / 7), 0.1);
}

/** The host looks usage up under the command's own name: the qualified name, except for skills synced from claude.ai, which are recorded under their short name. */
const usageOf = (inv: HostInventory, e: ListedEntry) => (e.origin === 'connector' ? own(inv.settings.usage, e.name) ?? own(inv.settings.usage, e.qualified) : own(inv.settings.usage, e.qualified));

/** Said where equal usage scores decide which entries lose their description: the host orders them by its own merge order, the audit by inventory order. */
const TIE_NOTE = 'Some entries share a usage score (entries with no recorded use all score 0), and the host orders tied entries by its own merge order while the audit uses the inventory order, so the entries named here may differ from the ones the host names.';

/**
 * What the host does when the listing is over budget: every entry costs its name-only line, the rest of the budget goes to descriptions in order of
 * usage score (highest first, listing order on ties), and an entry whose description does not fit stays name-only while later, smaller ones can still fit.
 * `reduced` is the qualified names left name-only, in listing order; `tied` says that a kept and a lost entry share a score, so the order of the ties decides which one is named.
 */
function claudeKept(rows: Row[], budget: number, score: (r: Row) => number): { reduced: string[]; tied: boolean } {
  let left = budget - sum(rows.map(r => r.fixed)) - Math.max(0, rows.length - 1);
  const lost = new Set<Row>(), order = rows.filter(r => r.desc > 0).map(r => ({ r, s: score(r) })).sort((a, b) => b.s - a.s);
  for (const { r } of order) { if (r.desc <= left) left -= r.desc; else lost.add(r); }
  const keptScores = new Set(order.filter(x => !lost.has(x.r)).map(x => x.s));
  return { reduced: rows.filter(r => lost.has(r)).map(r => r.entry.qualified), tied: order.some(x => lost.has(x.r) && keptScores.has(x.s)) };
}

/**
 * The listing at each context window. `totalChars` is the weight before anything is reduced, so a total above the budget means the host reduces it.
 * Claude `totalChars` is the full listing as the host builds it (`- name: text` lines joined by newlines) and `reduced` the entries left name-only; Codex `reduced` is every listed skill because its order is undocumented.
 * `model` selects the characters per token of the Claude budget; without it the current-model value is used.
 */
export function projectListing(inventory: HostInventory, rules: Rule[], options: { windows?: number[]; jstack?: JstackSurface; now?: number; model?: string } = {}): ListingProjection[] {
  const { jstack, now = Date.now() } = options, claude = inventory.host === 'claude';
  const rows = claude ? claudeRows(inventory, rules, jstack) : codexRows(inventory, jstack), newlines = claude ? Math.max(0, rows.length - 1) : 0;
  // The host's own block and the newline that joins it to the rest; it is kept before anything else, so the rest shares what is left.
  const hostChars = claude ? hostSkillChars(rules) : 0, hostBlock = hostChars + (hostChars && rows.length ? 1 : 0);
  const totalChars = sum(rows.map(r => r.fixed + r.desc)) + newlines + hostBlock, jstackChars = sum(rows.filter(r => isJstack(r.entry)).map(r => r.fixed + r.desc + (claude && r !== rows[0] ? 1 : 0)));
  return (options.windows ?? DEFAULT_WINDOWS).map(window => {
    const [budgetChars, basis] = claude ? claudeBudget(inventory, rules, window, options.model) : codexBudget(inventory, rules, window);
    let reduced: string[] = [];
    if (totalChars > budgetChars && !claude) reduced = rows.map(r => r.entry.qualified);
    else if (totalChars > budgetChars) reduced = claudeKept(rows, budgetChars - hostBlock, r => usageScore(usageOf(inventory, r.entry), now)).reduced;
    return { host: inventory.host, window, budgetChars, ...(hostChars ? { hostChars } : {}), basis, totalChars, jstackChars, reduced };
  });
}

/** jstack's surface as the checks of one host read it: a single surface applies to both hosts, a map gives each host its own install, and a host without one has none to check against. */
type JstackFor = JstackSurface | Partial<Record<Host, JstackSurface>>;
/** `now` and `model` are what `projectListing` was given, so the findings score usage and count characters the same way. */
type AuditOptions = { listing: ListingProjection[]; jstack?: JstackFor; now?: number; model?: string };
type HostAudit = Omit<AuditOptions, 'jstack'> & { jstack?: JstackSurface };

/** Over-budget, jstack-dropped and truncation findings for one host. */
function listingFindings(inv: HostInventory, rules: Rule[], { listing, jstack, now = Date.now(), model }: HostAudit): Finding[] {
  const windows = listing.filter(p => p.host === inv.host).sort((a, b) => a.window - b.window), p = windows[0];
  const claude = inv.host === 'claude', host = inv.host, name = hostName(host);
  const rows = claude ? claudeRows(inv, rules, jstack) : codexRows(inv, jstack), out: Finding[] = [];
  const jstackListed = rows.filter(r => isJstack(r.entry)).length;
  if (claude) {
    const cap = descCap(inv, rules);
    const long = rows.filter(r => r.desc > 0 && textChars(r.entry) > cap).sort((a, b) => textChars(b.entry) - textChars(a.entry));
    if (long.length) out.push({ code: 'description-truncated', severity: 'info', host, title: `${plural(long.length, 'Claude entry')} exceed${long.length === 1 ? 's' : ''} the ${cap}-char description cap`, detail: `description plus when_to_use is cut to ${cap} chars in the listing; the model never sees the rest. Longest: ${long[0]!.entry.qualified} with ${textChars(long[0]!.entry)} chars.`, evidence: long.slice(0, 10).map(r => `${r.entry.qualified}: ${textChars(r.entry)} chars`), rules: ['claude.listing.desc-cap'] });
  }
  if (!p || p.totalChars <= p.budgetChars) return out;
  const fallback = p.window > 0 ? [] : [claude ? 'claude.listing.fallback-chars' as const : 'codex.listing.fallback-chars' as const];
  // What the host's own block leaves of a budget, as the projection computes it.
  const room = (budget: number) => budget - (p.hostChars ? p.hostChars + (rows.length ? 1 : 0) : 0);
  const score = (r: Row) => usageScore(usageOf(inv, r.entry), now), tied = claude && claudeKept(rows, room(p.budgetChars), score).tied ? ` ${TIE_NOTE}` : '';
  const excess = p.totalChars - p.budgetChars, share = p.jstackChars ? ` jstack accounts for ${p.jstackChars} chars (${Math.round((p.jstackChars / p.totalChars) * 100)}%).` : '';
  const perWindow = `Budget by window: ${windows.map(w => `${w.window} tokens -> ${w.budgetChars} chars (${w.totalChars > w.budgetChars ? 'over' : 'fits'})`).join('; ')}.`;
  const heaviest = [...rows].sort((a, b) => b.fixed + b.desc - a.fixed - a.desc || cmp(a.entry.qualified, b.entry.qualified)).slice(0, 5).map(r => `${r.entry.qualified} (${r.entry.origin}): ${r.fixed + r.desc} chars`);
  if (claude) {
    // Overrides reach the user's own and project skills by their qualified name; synced claude.ai skills are keyed by their full name, anthropic-skills:<name>, and handled in their own step.
    const editable = rows.filter(r => !['plugin', 'connector'].includes(r.entry.origin) && r.desc > 0).sort((a, b) => b.desc - a.desc || cmp(a.entry.qualified, b.entry.qualified));
    const synced = rows.filter(r => r.entry.origin === 'connector' && r.desc > 0).sort((a, b) => b.desc - a.desc || cmp(a.entry.qualified, b.entry.qualified));
    const pick: Row[] = []; let saved = 0;
    for (const r of editable) { if (saved >= excess || pick.length === 8) break; pick.push(r); saved += r.desc; }
    const steps: string[] = [];
    if (pick.length) steps.push(`set "skillOverrides": {${pick.map(r => `"${r.entry.qualified}": "name-only"`).join(', ')}} in settings, saving ${saved} of the ${excess} excess chars`);
    if (synced.length) steps.push(`turn off the claude.ai skills you do not use in your claude.ai skills settings, or set "syncClaudeAiSkills": false in your user settings to stop syncing all of them, always-synced ones such as pdf and xlsx included (${synced.length} synced, ${sum(synced.map(r => r.desc))} description chars; an entry under the full name, such as "anthropic-skills:${synced[0]!.entry.name}": "name-only" in skillOverrides, collapses one and "off" hides it in this profile)`);
    steps.push('disable plugins you do not use with /plugin (overrides cannot shorten plugin skills, jstack included)');
    // The budget is linear in the fraction, so the fraction that fits scales with total over budget; a fraction above 1 is not accepted by the host.
    const fits = Math.ceil(budgetFraction(inv, rules) * (p.totalChars / p.budgetChars) * 1000) / 1000;
    steps.push((inv.settings.listingCharBudget !== undefined && inv.settings.listingCharBudget > 0) || fits > 1 ? `raise SLASH_COMMAND_TOOL_CHAR_BUDGET to at least ${p.totalChars}` : `raise skillListingBudgetFraction to at least ${fits}`);
    // An alias model may resolve to one of the older models that count 4 characters per token; a fixed SLASH_COMMAND_TOOL_CHAR_BUDGET does not depend on the model.
    let older = '';
    if (claudeCharsPerToken(rules, model).alias && !(inv.settings.listingCharBudget !== undefined && inv.settings.listingCharBudget > 0)) {
      const budget = Math.max(1, Math.floor((p.window > 0 ? p.window : HOST_DEFAULT_WINDOW) * 4 * budgetFraction(inv, rules)));
      older = ` If the alias "${model!.trim()}" resolves to an older model that counts 4 characters per token, the budget is ${budget} chars and ${p.totalChars > budget ? claudeKept(rows, room(budget), score).reduced.length : 0} of ${rows.length} entries would be listed by name only.`;
    }
    out.push({ code: 'listing-over-budget', severity: 'warn', host, title: `${name} listing is ${excess} chars over budget at ${p.window} tokens`, detail: `Names and descriptions, with their line markers and newlines, total ${p.totalChars} chars against a budget of ${p.budgetChars} (${p.basis}).${p.hostChars ? ` About ${p.hostChars} of that is Claude Code's own skills, which keep their descriptions first.` : ''} ${p.reduced.length} of ${rows.length} entries would be listed by name only; the host keeps descriptions for the most-used entries first.${older}${tied}${share} ${perWindow}`, evidence: heaviest, rules: ['claude.listing.budget-fraction', 'claude.listing.chars-per-token', 'claude.listing.entry-format', 'claude.listing.desc-cap', 'claude.listing.drop-order', 'claude.listing.usage-score', 'claude.listing.overrides-not-plugins', ...fallback], action: `Either ${steps.join('; or ')}.` });
  } else {
    const cap = num(rules, 'codex.listing.max-context-tokens-cap'), needed = Math.ceil(p.totalChars / CODEX_CHARS_PER_TOKEN);
    const others = rows.filter(r => !isJstack(r.entry)).sort((a, b) => b.fixed + b.desc - a.fixed - a.desc || cmp(a.entry.qualified, b.entry.qualified)).slice(0, 5).map(r => `${r.entry.qualified} (${r.fixed + r.desc} chars)`);
    const tokens = needed <= cap ? `set skills.max_context_tokens to at least ${needed} (maximum ${cap})` : `skills.max_context_tokens cannot cover it: ${needed} tokens needed, maximum ${cap}`;
    out.push({ code: 'listing-over-budget', severity: 'warn', host, title: `${name} listing is ${excess} chars over budget at ${p.window} tokens`, detail: `Names, descriptions and paths total ${p.totalChars} chars against a budget of ${p.budgetChars} (${p.basis}). Codex shortens descriptions first and then omits skills; the exact order is undocumented, so all ${rows.length} listed skills may be affected.${share} Run \`codex debug prompt-input\` to see what is actually listed. ${perWindow}`, evidence: heaviest, rules: ['codex.listing.budget-fraction', 'codex.listing.max-context-tokens-cap', 'codex.listing.shorten-then-omit', 'codex.listing.path-alias', 'codex.diagnostics.prompt-input', ...fallback], action: `Either disable skills you do not use with [[skills.config]] enabled = false${others.length ? ` (largest: ${others.join(', ')})` : ''}; or ${tokens}.` });
  }
  const jstackNames = new Set(rows.filter(r => isJstack(r.entry)).map(r => r.entry.qualified)), hit = p.reduced.filter(q => jstackNames.has(q));
  if (hit.length && claude) out.push({ code: 'jstack-descriptions-dropped', severity: 'warn', host, title: `${hit.length} of ${jstackListed} jstack entries lose their description at ${p.window} tokens`, detail: `jstack skills are listed by name only and rarely auto-trigger until they are used. The host gives the remaining budget to descriptions in order of highest usage score (listing order on ties); an entry whose description does not fit stays name-only, so jstack skills with no recorded use compete last.${tied}`, evidence: hit.slice(0, 10), rules: ['claude.listing.drop-order', 'claude.listing.usage-score', 'claude.listing.budget-fraction'], action: 'Free budget: set unused non-plugin entries to name-only, disable unused plugins with /plugin, or raise skillListingBudgetFraction. jstack descriptions are fixed by the package.' });
  else if (hit.length) out.push({ code: 'jstack-descriptions-dropped', severity: 'warn', host, title: `Codex may shorten or omit descriptions of ${jstackListed} jstack skills at ${p.window} tokens`, detail: 'The listing is over budget and Codex shortens descriptions first, then omits skills, in an undocumented order. Any of the jstack skills may be affected. Run `codex debug prompt-input` to see which.', evidence: hit.slice(0, 10), rules: ['codex.listing.shorten-then-omit', 'codex.listing.path-alias', 'codex.diagnostics.prompt-input', 'codex.listing.max-context-tokens-cap'], action: `Free budget by disabling unused skills with [[skills.config]] enabled = false, or raise skills.max_context_tokens (maximum ${num(rules, 'codex.listing.max-context-tokens-cap')}).` });
  return out;
}

/** Skill names and descriptions that break the Agent Skills spec. */
function specFindings(inv: HostInventory, jstack?: JstackSurface): Finding[] {
  const bad: string[] = [];
  for (const e of entriesOf(inv, jstack).filter(e => e.kind === 'skill')) {
    const why = [...(e.name.length > 64 || !SKILL_NAME.test(e.name) ? [`name "${e.name}" breaks ^[a-z0-9]+(-[a-z0-9]+)*$ or 64 chars`] : []), ...(e.descriptionChars > 1024 ? [`description ${e.descriptionChars} chars, limit 1024`] : [])];
    if (why.length) bad.push(`${e.qualified}: ${why.join('; ')}`);
  }
  return bad.length ? [{ code: 'spec-limits', severity: 'info', host: inv.host, title: `${plural(bad.length, `${hostName(inv.host)} skill`)} ${bad.length === 1 ? 'breaks' : 'break'} the Agent Skills limits`, detail: 'Names must be at most 64 chars of lowercase letters, digits and single hyphens; descriptions at most 1024 chars. Other tools that follow the spec may reject or truncate these.', evidence: bad.slice(0, 10), rules: ['spec.skill.name', 'spec.skill.description'] }] : [];
}

/** Non-jstack entries whose bare name equals something jstack ships. */
function collisionFindings(inv: HostInventory, jstack?: JstackSurface): Finding[] {
  if (!jstack) return [];
  const host = inv.host, own = inv.entries.filter(e => e.host === host && !isJstack(e));
  const typed = new Set([...jstack.skills, ...jstack.commands]), agents = new Set(jstack.agents), out: Finding[] = [];
  const show = (e: ListedEntry) => `${e.qualified} (${e.origin}: ${e.source})`;
  if (host === 'claude') {
    const hit = own.filter(e => e.kind !== 'agent' && typed.has(e.name));
    const commands = hit.filter(e => e.kind === 'command' && e.origin !== 'plugin'), rest = hit.filter(e => !commands.includes(e));
    if (commands.length) out.push({ code: 'name-collision', severity: 'warn', host, title: `${plural(commands.length, 'Claude command')} share${commands.length === 1 ? 's' : ''} a name with jstack`, detail: 'A command typed as /name runs the non-plugin one; jstack answers only as /jstack:name. Both are listed to the model, which may pick either.', evidence: commands.map(show), rules: ['claude.skills.precedence', 'claude.skills.plugin-namespace'], action: 'Rename or remove your command, or call jstack by its /jstack: name.' });
    if (rest.length) out.push({ code: 'name-collision', severity: 'info', host, title: `${plural(rest.length, 'Claude skill')} share${rest.length === 1 ? 's' : ''} a name with jstack`, detail: 'Both entries are listed to the model under different qualified names, so routing between them is ambiguous.', evidence: rest.map(show), rules: ['claude.skills.precedence', 'claude.skills.plugin-namespace'] });
    const duplicated = own.filter(e => e.kind === 'agent' && agents.has(e.name));
    if (duplicated.length) out.push({ code: 'name-collision', severity: 'info', host, title: `${plural(duplicated.length, 'Claude agent')} share${duplicated.length === 1 ? 's' : ''} a name with a jstack agent`, detail: 'Claude ranks a user agent above a plugin agent, but plugin agents are namespaced as jstack:name, and which one is chosen for the bare name is undocumented.', evidence: duplicated.map(show), rules: ['claude.agents.precedence'] });
  } else {
    const hit = own.filter(e => e.kind === 'skill' && jstack.skills.includes(e.name));
    if (hit.length) out.push({ code: 'name-collision', severity: 'warn', host, title: `${plural(hit.length, 'Codex skill')} share${hit.length === 1 ? 's' : ''} a name with jstack`, detail: 'Codex lists both skills, so the model may pick either.', evidence: hit.map(show), rules: ['codex.skills.same-name'], action: 'Rename or disable your skill with [[skills.config]] enabled = false if you want jstack to answer.' });
  }
  return out;
}

/** Claude agent descriptions are always in context; Codex custom agents may replace built-ins. */
function agentFindings(inv: HostInventory, rules: Rule[], jstack?: JstackSurface): Finding[] {
  const host = inv.host, agents = entriesOf(inv, jstack).filter(e => e.kind === 'agent'), out: Finding[] = [];
  if (host === 'claude') {
    // The host estimates each agent as `<type>: <description>` at 4 characters per token, rounded per agent, whatever the model.
    const limit = num(rules, 'claude.agents.description-warning'), cpt = AGENT_CHARS_PER_TOKEN;
    const weight = (e: ListedEntry) => e.qualified.length + 2 + e.descriptionChars + e.whenToUseChars, chars = sum(agents.map(weight)), tokens = sum(agents.map(e => Math.round(weight(e) / cpt)));
    if (tokens > limit) {
      const own = agents.filter(e => !isJstack(e)).sort((a, b) => weight(b) - weight(a)).slice(0, 5);
      out.push({ code: 'agent-descriptions-heavy', severity: 'warn', host, title: `Agent descriptions use about ${tokens} tokens, above the ${limit}-token warning level`, detail: `${plural(agents.length, 'agent')} add ${chars} chars of type and description, about ${tokens} tokens at ${cpt} chars per token (the host's own estimate); jstack's agents are ${sum(agents.filter(isJstack).map(weight))} chars of that. Claude loads them in every session.`, evidence: own.map(e => `${e.qualified} (${e.origin}): ${weight(e)} chars`), rules: ['claude.agents.description-warning'], action: 'Remove agents you do not use, or disable the plugins that ship many of them with /plugin.' });
    }
  } else {
    const hit = agents.filter(e => CODEX_BUILTIN_AGENTS.includes(e.name));
    if (hit.length) out.push({ code: 'codex-agent-overrides-builtin', severity: 'info', host, title: `${plural(hit.length, 'custom Codex agent')} replace${hit.length === 1 ? 's' : ''} a built-in: ${joined(hit.map(e => e.name))}`, detail: 'Codex ships default, worker and explorer agents; a custom agent with the same name takes their place.', evidence: hit.map(e => `${e.name}: ${e.source}`), rules: ['codex.agents.builtin-override', 'codex.agents.locations'] });
  }
  return out;
}

/** Hooks of this host: the inventory's, with jstack's own replaced by the package's. */
function hooksOf(inv: HostInventory, jstack?: JstackSurface): HookEntry[] {
  const own = inv.hooks.filter(h => h.host === inv.host);
  if (!jstack) return own;
  const theirs = (jstack.hooks as SurfaceHook[]).filter(h => (h.host ?? inv.host) === inv.host).map(h => ({ host: inv.host, event: h.event, matcher: h.matcher, handler: h.handler, origin: 'plugin' as const, source: 'jstack package', plugin: 'jstack' }));
  return [...own.filter(h => !isJstack(h)), ...theirs];
}

const sourceOf = (x: { origin: Origin; plugin?: string; source: string }) => (x.plugin ? `${x.origin}:${x.plugin}` : `${x.origin}:${x.source}`);

/** The same handler from two sources, and the sources that inject context before every prompt. */
function hookFindings(inv: HostInventory, jstack?: JstackSurface): Finding[] {
  if (inv.settings.disableAllHooks) return [];
  const host = inv.host, hooks = hooksOf(inv, jstack), out: Finding[] = [];
  const rule: RuleId = host === 'claude' ? 'claude.hooks.plugin-merge' : 'codex.hooks.all-load';
  const groups = new Map<string, HookEntry[]>();
  for (const h of hooks) groups.set(`${h.event}\0${h.handler}`, [...(groups.get(`${h.event}\0${h.handler}`) ?? []), h]);
  for (const group of groups.values()) {
    // Claude runs one copy of a handler found in several settings files; only a plugin's copy is separate, and each plugin's own copy too.
    const owners = new Set(group.map(h => (host === 'claude' && h.origin !== 'plugin' ? 'settings' : `${h.origin}:${h.plugin ?? ''}`)));
    if (owners.size < 2) continue;
    const { event, handler } = group[0]!, plugins = new Set(group.filter(h => h.origin === 'plugin').map(h => h.plugin ?? '')), copy = group.some(h => h.origin !== 'plugin');
    const action = !copy ? 'Keep one registration: disable all but one of the plugins that add it.' : plugins.size > 1 ? 'Keep one registration: remove the settings copy and disable all but one of the plugins that add it.' : 'Keep one registration: remove the settings copy or disable the plugin that adds the other.';
    out.push({ code: 'duplicate-hook', severity: 'warn', host, title: `Hook ${handler} on ${event} is registered by ${owners.size} sources`, detail: host === 'claude' ? 'Claude runs a plugin hook separately from settings hooks and from other plugins, so the handler runs once per source on every matching event; copies in several settings files run once.' : 'Codex loads every hook source, so the handler runs once per source on every matching event.', evidence: [...new Set(group.map(h => `${sourceOf(h)} (${h.matcher || 'all'})`))], rules: [rule], action });
  }
  const routers = hooks.filter(h => h.event === 'UserPromptSubmit'), sources = [...new Set(routers.map(sourceOf))];
  if (sources.length) out.push({ code: 'prompt-routers', severity: sources.length >= 2 ? 'warn' : 'info', host, title: `${plural(sources.length, 'source')} inject${sources.length === 1 ? 's' : ''} context before every ${hostName(host)} prompt`, detail: `UserPromptSubmit hooks run on every prompt and can add context to it: ${joined(sources)}.${jstack ? (routers.some(isJstack) ? ' jstack adds some of them.' : ' jstack adds none.') : ''}`, evidence: sources, rules: [rule], ...(sources.length >= 2 ? { action: 'Keep the routers you rely on; competing ones can steer the same prompt differently.' } : {}) });
  return out;
}

/** MCP servers (Claude only): always-loaded servers and servers defined in several places. */
function mcpFindings(inv: HostInventory): Finding[] {
  if (inv.host !== 'claude') return [];
  const servers = inv.mcp.filter(s => s.host === 'claude' && s.enabled !== false), out: Finding[] = [];
  const always = servers.filter(s => s.alwaysLoad);
  if (always.length) out.push({ code: 'mcp-always-loaded', severity: 'info', host: 'claude', title: `${plural(always.length, 'MCP server')} bypass${always.length === 1 ? 'es' : ''} tool search`, detail: 'alwaysLoad servers put every tool definition in context at session start instead of on demand.', evidence: always.map(s => `${s.name} (${s.origin}: ${s.source})`), rules: ['claude.mcp.tool-search'] });
  // The host matches duplicates across the settings scopes by name, and plugin servers and connectors by endpoint (the same URL).
  const byName = new Map<string, McpServer[]>(), byEndpoint = new Map<string, McpServer[]>();
  for (const s of servers) {
    if (SETTINGS_SCOPES.includes(s.origin)) byName.set(s.name, [...(byName.get(s.name) ?? []), s]);
    if (s.endpoint) byEndpoint.set(s.endpoint, [...(byEndpoint.get(s.endpoint) ?? []), s]);
  }
  const ranked = (list: McpServer[]) => [...list].sort((a, b) => SCOPE_RANK.indexOf(a.origin) - SCOPE_RANK.indexOf(b.origin));
  const shadowed: string[] = [];
  for (const [serverName, list] of byName) {
    const origins = [...new Set(ranked(list).map(s => s.origin))];
    if (origins.length > 1) shadowed.push(`${serverName}: ${origins[0]} wins over ${origins.slice(1).join(', ')}`);
  }
  for (const [endpoint, list] of byEndpoint) {
    const [winner, ...rest] = ranked(list), lower = rest.filter(s => ['plugin', 'connector'].includes(s.origin) && s.origin !== winner!.origin);
    if (lower.length) shadowed.push(`${endpoint}: ${winner!.origin} ${winner!.name} wins over ${lower.map(s => `${s.origin} ${s.name}`).join(', ')}`);
  }
  if (shadowed.length) out.push({ code: 'mcp-shadowed', severity: 'info', host: 'claude', title: `${plural(shadowed.length, 'MCP server')} defined in several places`, detail: 'A name defined in several settings scopes (local, then project, user), or a plugin or connector server on the same endpoint as a higher-precedence server, connects once with the highest-precedence definition; the lower ones are ignored, not merged. Remote endpoints are compared here by scheme and host only, while the host also compares path and port, so a reported pair may be two servers.', evidence: shadowed, rules: ['claude.mcp.scopes'] });
  return out;
}

/** `skillOverrides` keys naming plugin skills: the documented behavior is that they have no effect. A key is a plugin skill's when it is a plugin entry's qualified name (the package's included) or starts with an enabled plugin's `<name>:`; commands-subfolder and nested skill names such as `frontend:component` are the user's own and do take effect. */
function overrideFindings(inv: HostInventory, jstack?: JstackSurface): Finding[] {
  if (inv.host !== 'claude') return [];
  const plugin = new Set([...inv.entries.filter(e => e.origin === 'plugin'), ...(jstack?.entries.filter(e => e.host === 'claude') ?? [])].map(e => e.qualified)), own = new Set(inv.entries.filter(e => e.origin !== 'plugin').flatMap(e => [e.qualified, e.name]));
  const names = inv.plugins.filter(p => p.host === 'claude' && p.enabled).map(p => p.id.split('@')[0]!);
  const keys = Object.keys(inv.settings.skillOverrides).filter(key => !own.has(key) && (plugin.has(key) || names.some(n => key.startsWith(`${n}:`)))).sort();
  const out: Finding[] = keys.length ? [{ code: 'ineffective-override', severity: 'warn', host: 'claude', title: `${keys.length} skillOverrides ${keys.length === 1 ? 'entry names a plugin skill' : 'entries name plugin skills'}, which overrides do not affect`, detail: 'These entries look like they demote or hide plugin skills, but skillOverrides applies only to the user\'s own, project and bundled skills; the plugin skills keep their full descriptions.', evidence: keys.map(key => `${key}: ${inv.settings.skillOverrides[key]}`), rules: ['claude.listing.overrides-not-plugins'], action: 'Remove the entries, and disable a plugin you do not use with /plugin instead.' }] : [];
  // A synced claude.ai skill answers to its bare name only while no other command holds it; the package can add the holder.
  const overrides = inv.settings.skillOverrides, all = entriesOf(inv, jstack);
  const missed = Object.keys(overrides).filter(key => overrides[key] !== 'on' && !Object.hasOwn(overrides, `anthropic-skills:${key}`) && inv.entries.some(e => e.origin === 'connector' && e.name === key)).sort()
    .map(key => ({ key, holders: all.filter(e => holdsBareName(e, key)).sort((a, b) => cmp(a.qualified, b.qualified)) })).filter(x => x.holders.length);
  // A bare entry reaches a skill or command of the user's own only under the name its key is read by, the first name it holds (a skill's folder, a command's listed name); otherwise it applies to nothing.
  const reached = (x: typeof missed[number]) => x.holders.some(e => e.origin !== 'plugin' && e.holds?.[0] === x.key);
  const dead = missed.filter(x => !reached(x)).map(x => JSON.stringify(x.key)), live = missed.filter(reached).map(x => JSON.stringify(x.key));
  const closing = [...(dead.length ? [`Remove the bare ${dead.length === 1 ? 'entry' : 'entries'} ${joined(dead)}: no skill or command of yours is listed under exactly ${dead.length === 1 ? 'that name' : 'those names'}, so ${dead.length === 1 ? 'it applies' : 'they apply'} to nothing.`] : []),
    ...(live.length ? [`Keep the bare ${live.length === 1 ? 'entry' : 'entries'} ${joined(live)} only if ${live.length === 1 ? 'it is' : 'they are'} meant for the skill or command of yours listed under that name.`] : [])].join(' ');
  if (missed.length) out.push({ code: 'override-misses-synced-skill', severity: 'warn', host: 'claude', title: `${missed.length} skillOverrides ${missed.length === 1 ? 'entry does' : 'entries do'} not reach the synced claude.ai skill of that name`, detail: 'A skill synced from claude.ai is listed as anthropic-skills:<name> and answers to its bare name only while no other command holds that name. Here another one holds it, so the host applies the entry to the skill or command of the user\'s own that is listed under exactly that name, if there is one, and otherwise to nothing (a plugin skill or command, or a skill that carries the name only in its frontmatter); either way the synced skill keeps its place in the listing.', evidence: missed.map(x => `${x.key}: ${overrides[x.key]} (name held by ${x.holders.map(e => e.qualified).join(', ')})`), rules: ['claude.listing.synced-override-key'], action: `Key ${missed.length === 1 ? 'the entry' : 'each entry'} by the full name, which the host always applies to the synced skill: ${joined(missed.map(x => `${JSON.stringify(`anthropic-skills:${x.key}`)}: ${JSON.stringify(overrides[x.key])}`))}. ${closing}` });
  return out;
}

/** Duplicate jstack installs and what the reader could not read. */
function pluginFindings(inv: HostInventory): Finding[] {
  const host = inv.host, out: Finding[] = [], enabled = inv.plugins.filter(p => p.host === host && p.enabled);
  const split = (id: string) => ({ plugin: id.split('@')[0]!, marketplace: id.split('@')[1] ?? '' });
  // One plugin id installed at user and project scope is one jstack: the host loads it once.
  const jstackIds = [...new Set(enabled.filter(p => JSTACK_NAME.test(split(p.id).plugin)).map(p => p.id))];
  if (jstackIds.length > 1) out.push({ code: 'second-jstack', severity: 'block', host, title: `${jstackIds.length} enabled ${hostName(host)} plugins are jstack`, detail: 'Two jstack installs register the same skills, commands, agents and hooks, so every one of them is listed and run twice.', evidence: jstackIds, rules: [host === 'claude' ? 'claude.skills.plugin-namespace' : 'codex.skills.same-name'], action: host === 'claude' ? 'Disable all but one with /plugin.' : 'Set enabled = false under [plugins."<id>"] in config.toml for all but one.' });
  if (inv.warnings.length) out.push({ code: 'inventory-warnings', severity: 'info', host, title: `${plural(inv.warnings.length, 'note')} from the ${hostName(host)} inventory`, detail: 'The audit may be incomplete for these: something could not be read, or was read with an assumption; nothing was changed.', evidence: inv.warnings, rules: [] });
  return out;
}

/** Everything the audit reports for these inventories, blocking findings first. A host is checked against its own jstack surface only (`options.jstack` as a per-host map), so a host without jstack gets no jstack weight and no collisions. */
export function auditFindings(inventories: HostInventory[], rules: Rule[], options: AuditOptions): Finding[] {
  const out: Finding[] = [];
  for (const inv of inventories) {
    const jstack = options.jstack && 'entries' in options.jstack ? options.jstack : options.jstack?.[inv.host];
    out.push(...listingFindings(inv, rules, { ...options, jstack }), ...specFindings(inv, jstack), ...collisionFindings(inv, jstack), ...agentFindings(inv, rules, jstack), ...hookFindings(inv, jstack), ...mcpFindings(inv), ...overrideFindings(inv, jstack), ...pluginFindings(inv));
  }
  return out.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

/** Process exit status: 1 when a finding blocks, else 0. Warnings are for the user to weigh, and 2 is a usage error. */
export function exitCode(findings: Finding[]): 0 | 1 {
  return findings.some(f => f.severity === 'block') ? 1 : 0;
}

// ---- jstack's own surface -------------------------------------------------------------------------------------------

const readJson = (file: string): Obj | undefined => { try { return JSON.parse(readFileSync(file, 'utf8')) as Obj; } catch { return undefined; } };
const isDir = (p: string) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : value === undefined ? [] : [value]);
const strings = (value: unknown): string[] => list(value).filter((v): v is string => typeof v === 'string');
const len = (value: unknown) => (typeof value === 'string' ? value.trim().length : 0);

/** The frontmatter of an entry file; a file with none is `{}`, and one whose frontmatter is not readable YAML is `undefined`. */
function frontMatter(file: string): Obj | undefined {
  let text: string; try { text = readFileSync(file, 'utf8'); } catch { return undefined; }
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return {};
  try { const data = parseYaml(match[1]!); return data === null || data === undefined ? {} : typeof data === 'object' && !Array.isArray(data) ? (data as Obj) : undefined; } catch { return undefined; }
}

/** SKILL.md files under a root, without descending into a skill's own folders. */
function skillFiles(root: string): string[] {
  if (existsSync(join(root, 'SKILL.md'))) return [join(root, 'SKILL.md')];
  if (!isDir(root)) return [];
  return readdirSync(root).filter(n => !n.startsWith('.') && n !== 'node_modules').sort().flatMap(n => skillFiles(join(root, n)));
}

/** `*.md` files of the directories (or files) a manifest points at, else the default directory. */
function markdownFiles(dir: string, declared: unknown, fallback: string): string[] {
  const paths = strings(declared).map(p => resolve(dir, p)).filter(existsSync);
  const roots = paths.length ? paths : [join(dir, fallback)];
  return roots.flatMap(r => (isDir(r) ? readdirSync(r).filter(n => n.endsWith('.md')).sort().map(n => join(r, n)) : r.endsWith('.md') ? [r] : []));
}


/** The hook rows of one hooks file or inline manifest object, each handler identified the way the inventory identifies the same command (the plugin root and the home spelled out). */
function hookRows(source: unknown, dir: string, host: Host, identity: { root: string; home?: string }): SurfaceHook[] {
  const config = typeof source === 'string' ? readJson(resolve(dir, source)) : (source as Obj | undefined);
  const events = (config?.hooks ?? {}) as Record<string, unknown>, rows: SurfaceHook[] = [];
  for (const [event, groups] of Object.entries(events))
    for (const group of list(groups) as Obj[])
      for (const hook of list(group.hooks) as Obj[]) rows.push({ host, event, matcher: typeof group.matcher === 'string' ? group.matcher : '', handler: handlerId(hook, identity.root, identity.home) });
  return rows;
}

/**
 * jstack's surface from an extracted package's plugins/jstack directory or an installed plugin cache directory.
 * Claude entries are qualified `jstack:<name>`; Codex lists the same qualified name with a path, which is estimated as an alias plus the path under its skills root.
 * `root` is the plugin directory that `${CLAUDE_PLUGIN_ROOT}` in a hook means on the host that runs it (default: `pluginDir`): the installed path when the package is going to replace an installed jstack, so a hook's identity is the one the inventory has for the same command. `home` is the user's home, written `~` as in the inventory.
 */
export function jstackSurface(pluginDir: string, identity: { root?: string; home?: string } = {}): JstackSurface {
  const dir = resolve(pluginDir), root = identity.root ?? dir, claude = readJson(join(dir, '.claude-plugin/plugin.json')), codex = readJson(join(dir, '.codex-plugin/plugin.json'));
  if (!claude && !codex) throw new Error(`not a jstack package: no .claude-plugin/plugin.json or .codex-plugin/plugin.json in ${dir}`);
  const entries: ListedEntry[] = [];
  const unreadable: string[] = [];
  const add = (host: Host, kind: ListedEntry['kind'], fm: Obj | undefined, fallbackName: string, source: string) => {
    if (!fm) { unreadable.push(source); return; }
    const entryName = typeof fm.name === 'string' && fm.name ? fm.name : fallbackName;
    entries.push({ host, kind, name: entryName, qualified: `jstack:${entryName}`, origin: 'plugin', source, plugin: 'jstack', ...(len(fm.description) ? {} : { hasDescription: false }), descriptionChars: len(fm.description), whenToUseChars: host === 'claude' ? len(fm.when_to_use) : 0, descriptionWidth: displayWidth(typeof fm.description === 'string' ? fm.description.trim() : ''), whenToUseWidth: host === 'claude' && typeof fm.when_to_use === 'string' ? displayWidth(fm.when_to_use.trim()) : 0, ...((host === 'claude' ? fm['disable-model-invocation'] : fm.allowImplicitInvocation === false) === true ? { disableModelInvocation: true } : {}), ...(fm['user-invocable'] === false ? { userInvocable: false } : {}), ...(host === 'claude' && kind !== 'agent' ? pluginHolds(fm.name) : {}) });
  };
  const claudeRoots = strings(claude?.skills).map(p => resolve(dir, p));
  for (const file of (claudeRoots.length ? claudeRoots : [join(dir, 'entries/claude')]).flatMap(skillFiles)) add('claude', 'skill', frontMatter(file), basename(dirname(file)), file);
  for (const file of markdownFiles(dir, claude?.commands, 'commands')) add('claude', 'command', frontMatter(file), basename(file, '.md'), file);
  for (const file of markdownFiles(dir, claude?.agents, 'agents')) add('claude', 'agent', frontMatter(file), basename(file, '.md'), file);
  const codexRoot = resolve(dir, strings(codex?.skills)[0] ?? 'entries/codex');
  for (const file of skillFiles(codexRoot)) {
    const fm = frontMatter(file), policyFile = join(dirname(file), 'agents/openai.yaml');
    if (fm && existsSync(policyFile)) {
      const policy = parseYaml(readFileSync(policyFile, 'utf8'));
      if (policy?.policy?.allow_implicit_invocation === false) fm.allowImplicitInvocation = false;
    }
    add('codex', 'skill', fm, basename(dirname(file)), `r0/${relative(codexRoot, file).split('\\').join('/')}`);
  }

  const catalog = [join(dir, 'payload/contracts/skill-catalog.json'), join(dir, 'contracts/skill-catalog.json')].map(readJson).find(Boolean);
  const names = new Set(entries.filter(e => e.kind === 'skill').map(e => e.name));
  for (const e of list(catalog?.entries) as Obj[]) if (e.visibility === 'public') for (const n of [e.name, ...list(e.aliases), ...list(e.nativeAliases)]) if (typeof n === 'string') names.add(n);

  const hooks = new Map<string, SurfaceHook>();
  const sources: [Host, unknown[]][] = [['claude', [existsSync(join(dir, 'hooks/hooks.json')) ? 'hooks/hooks.json' : undefined, ...list(claude?.hooks)].filter(Boolean)], ['codex', list(codex?.hooks)]];
  for (const [host, files] of sources) for (const file of files) for (const row of hookRows(file, dir, host, { root, home: identity.home })) hooks.set(`${host}\0${row.event}\0${row.matcher}\0${row.handler}`, row);

  const of = (kind: ListedEntry['kind']) => [...new Set(entries.filter(e => e.host === 'claude' && e.kind === kind).map(e => e.name))].sort();
  return { version: [claude?.version, codex?.version].find((v): v is string => typeof v === 'string'), skills: [...names].sort(), commands: of('command'), agents: of('agent'), entries, ...(unreadable.length ? { unreadable } : {}), hooks: [...hooks.values()] };
}
