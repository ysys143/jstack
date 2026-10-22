/** Owning suite: the audit is read-only, presents findings as generated, re-checks its documentation, and its fixtures pass. */
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { check_contract_coverage, split_frontmatter } from '../../../_suite_lib.js';
import { RULE_IDS, type HostInventory, type ListedEntry } from '../scripts/types.js';
import { projectListing, jstackSurface } from '../scripts/analyze.js';
import { loadRules } from '../scripts/rules.js';
const file = fileURLToPath(import.meta.url), root = dirname(dirname(file));
let total = 0, failed = 0;
const check = (name: string, ok: unknown, detail = '') => { total++; if (!ok) failed++; console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`); };
const read = (path: string) => existsSync(path) ? readFileSync(path, 'utf8') : '';
const [front, skill] = split_frontmatter(read(join(root, 'SKILL.md')));
const contracts: [string, RegExp][] = [
  ['the audit changes nothing', /This is a read-only audit\. It changes no host setting, plugin, skill, MCP entry or\s+file/],
  ['runs from the extracted release before installing', /payload\/skills\/host-audit\/scripts\/main\.js \\\s*\n\s*--package <extracted>\/jstack-marketplace\/plugins\/jstack --verify-docs --measure/],
  ['runs through the CLI after installing', /^jst host-audit --verify-docs --measure/m],
  ['findings are shown as generated', /Do not add, soften or re-order findings\./],
  ['an estimate is told apart from a measurement', /Listing\s+figures are estimates from the documented budget unless the line says\s+`measured by`/],
  ['drift is reported first and unverified findings are not repeated as fact', /Do not repeat an unverified finding as fact\./],
  ['an unreachable page is not called verified', /When the documentation could not be fetched, say it was not re-checked\./],
  ['plugin skills cannot be demoted with overrides', /Plugin skills, jstack's included, cannot be demoted with `skillOverrides`/],
  ['settings change only with approval', /change settings only with approval/],
  ['a user skill with a jstack name is kept', /Keep the user's own; rename only if the user asks/],
  ['a second jstack is a blocker', /\| `second-jstack` \(blocker\) \|/],
  ['secrets never reach the report', /no environment, header or argument values\s+reach the report/],
  ['undocumented behavior is named as such', /The Codex shortening order is\s+undocumented/],
  ['the Claude listing follows the host computation', /3 characters per token for current models and 4 for older ones \(a model\s+alias such as `opus` is counted as 3 and the result for 4 is noted\), display\s+width \(a Korean character counts 2\)/],
];
for (const [name, pattern] of contracts) check(`SKILL.md ${name}`, pattern.test(skill));
const description = /description:\s*"([^"]*)"/.exec(front)?.[1] ?? '';
check('description stays within the Agent Skills limit and names the audit scope', description.length > 0 && description.length <= 1024 && ['MCP', 'subagents', 'listing'].every(term => description.includes(term)));
const rulesDoc = read(join(root, 'references', 'host-rules.md'));
check('host-rules.md documents every rule id', RULE_IDS.every(id => rulesDoc.includes(id)), RULE_IDS.filter(id => !rulesDoc.includes(id)).join(', '));
check('host-rules.md explains how to refresh after drift', /## Refreshing the rules/.test(rulesDoc));
const fixtures = ['rules.test.js', 'inventory.test.js', 'analyze.test.js', 'main.test.js'].map(name => join(dirname(file), name));
const present = fixtures.filter(path => existsSync(path));
const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...present], { encoding: 'utf8' });
process.stdout.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? '');
check('host-audit execution fixtures pass', present.length === fixtures.length && result.status === 0, present.length === fixtures.length ? '' : `missing ${fixtures.filter(path => !present.includes(path)).join(', ')}`);
// jstack's own share of the listing is limited so that it does not crowd the budget. Claude Code's own skills share that budget, so a
// fresh install on the smallest window still drops descriptions by usage; the note below says how many jstack keeps there.
// The suite runner names the built package in JSTACK_PACKAGE_ROOT; inside an installed plugin it is three folders up.
const LISTING = { total: 5000, skill: 100, command: 60 };
const pluginRoot = [process.env.JSTACK_PACKAGE_ROOT, join(root, '..', '..', '..')].find(dir => !!dir && existsSync(join(dir, '.claude-plugin', 'plugin.json')));
if (pluginRoot) {
  const surface = jstackSurface(pluginRoot), width = (entry: ListedEntry) => (entry.descriptionWidth ?? entry.descriptionChars) + (entry.whenToUseChars ? (entry.whenToUseWidth ?? entry.whenToUseChars) + 3 : 0);
  // The same test the projection applies: agents are listed elsewhere, and a plugin entry needs a description or a when_to_use.
  const listed = surface.entries.filter(entry => entry.kind !== 'agent' && !entry.disableModelInvocation && (entry.hasDescription !== false || entry.whenToUseChars > 0));
  const over = (kind: ListedEntry['kind'], limit: number) => listed.filter(entry => entry.kind === kind && width(entry) > limit).map(entry => `${entry.host} ${entry.name} ${width(entry)}`);
  const empty: HostInventory = { host: 'claude', home: '', homeSource: 'option', plugins: [], entries: [], mcp: [], hooks: [], settings: { skillOverrides: {}, usage: {} }, warnings: [] };
  const projection = projectListing(empty, loadRules().rules, { jstack: surface, windows: [200_000] })[0]!;
  const catalog = JSON.parse(read(join(pluginRoot, 'payload', 'contracts', 'skill-catalog.json')) || '{"entries":[]}') as { entries: { visibility: string; invocation?: string }[] };
  const publicSkills = catalog.entries.filter(entry => entry.visibility === 'public' && entry.invocation !== 'explicit').length, claudeSkills = listed.filter(entry => entry.host === 'claude' && entry.kind === 'skill').length;
  check('every package entry has readable frontmatter', !surface.unreadable?.length, (surface.unreadable ?? []).join(', '));
  check('the measured listing holds every implicitly invocable public skill of the catalog and at least one command', publicSkills > 0 && claudeSkills === publicSkills && listed.some(entry => entry.kind === 'command'), `${claudeSkills} skills listed, ${publicSkills} implicitly invocable in the catalog`);
  check(`jstack's own share of the Claude listing is at most ${LISTING.total} characters`, projection.jstackChars > 0 && projection.jstackChars <= LISTING.total, `${projection.jstackChars} characters`);
  check(`every listed skill description is at most ${LISTING.skill} display columns`, !over('skill', LISTING.skill).length, over('skill', LISTING.skill).join(', '));
  check(`every described command is at most ${LISTING.command} display columns`, !over('command', LISTING.command).length, over('command', LISTING.command).join(', '));
  const jstackListed = listed.filter(entry => entry.host === 'claude').length;
  console.log(`[INFO] fresh install, 200K window, default budget ${projection.budgetChars}: Claude Code's own skills count as about ${projection.hostChars ?? 0} characters and jstack as ${projection.jstackChars}; ${jstackListed - projection.reduced.length} of ${jstackListed} jstack descriptions are kept at the default budget; a fraction of about 0.02 or a larger window shows them all`);
} else check('the listing budget is measured on the built package', false, 'run this suite through run_suites.js, which builds the package');
check_contract_coverage(check, file, root, { per_file: { 'SKILL.md': 14, 'references/host-rules.md': 3 } });
console.log(`${total - failed}/${total} passed`);
process.exitCode = failed ? 1 : 0;
