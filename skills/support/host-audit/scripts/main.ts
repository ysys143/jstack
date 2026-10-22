/** `jst host-audit`: read-only audit of a Claude Code and Codex setup against documented host rules and a jstack package. */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { isMain } from '../../../../runtime/entry.js';
import { commandDirectory, defaultRun, hostEnvironment, inventoryClaude, inventoryCodex, type InventoryOptions } from './inventory.js';
import { loadRules, verifyDocs, newerHosts, type Fetcher } from './rules.js';
import { jstackSurface, projectListing, auditFindings, exitCode } from './analyze.js';
import type { AuditReport, Finding, Host, HostInventory, ListingProjection, Rule, JstackSurface } from './types.js';

export const HELP = `jst host-audit [--host claude|codex|all] [--project DIR] [--package PLUGIN_DIR]
                [--verify-docs] [--measure] [--home DIRECTORY] [--model ID] [--json]
Read-only. Inventories the selected host profile (CLAUDE_CONFIG_DIR, CODEX_HOME,
or the defaults ~/.claude and ~/.codex): plugins, skills, commands, subagents,
MCP servers, hooks and listing settings. Projects the model-facing description
listing against the documented budgets and reports conflicts with jstack. With
--package (an extracted plugins/jstack folder) it projects the state after
installing that package; without it, each host is checked against the jstack plugin
enabled on that host, and a host without one gets no jstack checks. --verify-docs
re-reads each documentation page the rules cite and reports drift; --measure
runs \`claude plugin details\` for jstack.
--home DIRECTORY reads DIRECTORY/.claude and DIRECTORY/.codex and runs the host
commands with that HOME; the jstack-managed route keeps its Codex home in
DIRECTORY/.agents, which is reported as a second home. --project DIR is also the
directory the host commands run in. --model ID names the Claude model whose
characters per token (3 or 4) the listing budget uses (default: ANTHROPIC_MODEL,
then the model setting); the context windows stay 200K and 1M.
Exit 0: no blockers; 1: a blocker; 2: usage or an unreadable input.
`;

class UsageError extends Error {}
interface Streams { stdout: { write(text: string): unknown }; stderr: { write(text: string): unknown } }
export interface AuditOptions { hosts: Host[]; inventory: InventoryOptions; packageDir?: string; model?: string; verify?: boolean; measure?: boolean; fetcher?: Fetcher; now?: number }
/** Where the jstack surface came from: the `--package` folder (for every selected host), or the jstack plugin one host has enabled. A host in no entry has no jstack surface. */
export interface JstackUse { source: 'package' | 'installed'; path: string; version?: string; hosts: Host[] }
export interface Report extends AuditReport { jstack?: JstackUse[] }

function parse(argv: string[]) {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (flags.has(arg)) throw new UsageError(`Repeated option: ${arg}`);
    if (['--json', '--verify-docs', '--measure', '--help'].includes(arg)) { flags.set(arg, 'true'); continue; }
    if (!['--host', '--project', '--package', '--home', '--model'].includes(arg) || argv[i + 1] === undefined || argv[i + 1]!.startsWith('--')) throw new UsageError(`Invalid option: ${arg}`);
    flags.set(arg, argv[++i]!);
  }
  return flags;
}

/** The always-on token figure Claude Code itself reports for a plugin, or undefined when the host cannot say. */
export function measuredPluginTokens(runner: NonNullable<InventoryOptions['runner']>, env: NodeJS.ProcessEnv, plugin: string, pluginDir?: string, cwd?: string): number | undefined {
  // `--plugin-dir` precedes the subcommand; the session-only copy it loads takes precedence over an installed one.
  let result: ReturnType<typeof runner>;
  try { result = runner('claude', [...(pluginDir ? ['--plugin-dir', pluginDir] : []), 'plugin', 'details', plugin], env, cwd); } catch { return undefined; }
  if (result.status !== 0) return undefined;
  // `Projected token cost` is followed by a line such as `Always-on:   ~5,734 tok   added to every session`.
  const line = /Projected token cost\s*\n\s*Always-on:\s*~?([\d.,]+)\s*(k?)\s*tok/i.exec(result.stdout);
  return line ? Math.round(Number(line[1]!.replace(/,/g, '')) * (line[2] ? 1000 : 1)) : undefined;
}

/** The Claude model that sets the context window the listing is projected at: the command line, else `ANTHROPIC_MODEL`, else the model of the settings. */
export function configuredModel(flag: string | undefined, env: NodeJS.ProcessEnv, inventories: HostInventory[]): string | undefined {
  return flag?.trim() || env.ANTHROPIC_MODEL?.trim() || inventories.find(row => row.host === 'claude')?.settings.model || undefined;
}

/**
 * jstack for each host: the `--package` folder for every host, else the enabled `jstack@...` plugin of that host alone (a host without one has no jstack surface).
 * A hook's identity is resolved against the plugin folder that host runs: the installed one, also for a package that will replace it, so a settings copy of a jstack hook stays comparable.
 * A plugin folder that is not a jstack package is a warning, not an error.
 */
function jstackPerHost(inventories: HostInventory[], options: AuditOptions): { surfaces: Partial<Record<Host, JstackSurface>>; uses: JstackUse[] } {
  const env = options.inventory.env ?? process.env, home = resolve(options.inventory.home ?? (env.HOME || env.USERPROFILE || homedir())); // as the inventory locates the user's home
  const surfaces: Partial<Record<Host, JstackSurface>> = {}, uses: JstackUse[] = [];
  for (const inventory of inventories) {
    const plugin = inventory.plugins.find(row => row.enabled && /^jstack@/.test(row.id) && row.path);
    if (options.packageDir) { surfaces[inventory.host] = jstackSurface(options.packageDir, { root: plugin?.path ?? options.packageDir, home }); continue; }
    if (!plugin) continue;
    try { const surface = jstackSurface(plugin.path!, { root: plugin.path, home }); surfaces[inventory.host] = surface; uses.push({ source: 'installed', path: plugin.path!, version: surface.version ?? plugin.version, hosts: [inventory.host] }); } catch { inventory.warnings.push(`the enabled jstack plugin at ${plugin.path} could not be read as a jstack package`); }
  }
  if (options.packageDir) uses.push({ source: 'package', path: options.packageDir, version: surfaces[inventories[0]!.host]?.version, hosts: inventories.map(row => row.host) });
  // An entry file whose frontmatter is not valid YAML is left out of the surface; say so rather than count less in silence.
  for (const inventory of inventories) {
    const unreadable = surfaces[inventory.host]?.unreadable ?? [];
    if (unreadable.length) inventory.warnings.push(`${unreadable.length} jstack entry file${unreadable.length === 1 ? ' has' : 's have'} frontmatter that is not valid YAML and ${unreadable.length === 1 ? 'is' : 'are'} not counted: ${unreadable.map(file => file.split(/[\\/]/).slice(-2).join('/')).join(', ')}`);
  }
  return { surfaces, uses };
}

/** Run the whole audit. Nothing on disk changes; the only network access is --verify-docs. */
export async function audit(options: AuditOptions): Promise<Report> {
  const { verifiedAt, rules } = loadRules(), runner = options.inventory.runner ?? defaultRun;
  const inventories: HostInventory[] = options.hosts.map(host => (host === 'claude' ? inventoryClaude : inventoryCodex)({ ...options.inventory, runner }));
  const { surfaces, uses } = jstackPerHost(inventories, options);
  const model = configuredModel(options.model, options.inventory.env ?? process.env, inventories), now = options.now ?? Date.now();
  const listing: ListingProjection[] = inventories.flatMap(inventory => projectListing(inventory, rules, { jstack: surfaces[inventory.host], now, model: inventory.host === 'claude' ? model : undefined }));
  if (options.measure && options.hosts.includes('claude')) {
    const tokens = measuredPluginTokens(runner, hostEnvironment('claude', options.inventory), 'jstack', options.packageDir, commandDirectory(options.inventory.project));
    if (tokens !== undefined) for (const row of listing.filter(row => row.host === 'claude')) row.measured = { tool: `claude${options.packageDir ? ' --plugin-dir <package>' : ''} plugin details jstack`, value: tokens, unit: 'tokens' };
  }
  const findings: Finding[] = auditFindings(inventories, rules, { listing, jstack: surfaces, now, model });
  const versions = Object.fromEntries(inventories.filter(row => row.version).map(row => [row.host, row.version!])) as Partial<Record<Host, string>>;
  for (const newer of newerHosts(rules, versions)) findings.push({ code: 'rules-older-than-host', severity: 'info', host: newer.host, title: `Rules were checked on ${newer.host} ${newer.verifiedOn}; ${newer.installed} is installed`, detail: 'Host behavior may have changed since the rules were checked; run with --verify-docs.', evidence: [], rules: [] });
  const report: Report = { schemaVersion: 1, generatedAt: new Date(options.now ?? Date.now()).toISOString(), rulesVerifiedAt: verifiedAt, hosts: inventories, listing, findings, ...(uses.length ? { jstack: uses } : {}) };
  if (options.verify) {
    const docs = await verifyDocs(rules, options.fetcher); report.docs = docs;
    const drifted = new Set(docs.flatMap(row => row.drifted));
    for (const finding of findings) if (finding.rules.some(id => drifted.has(id))) finding.unverified = true;
  }
  return report;
}

const ORDER = { block: 0, warn: 1, info: 2 } as const;
/** Plain text for the agent to show as it is: drift first, then findings by severity, then the listing figures. */
export function renderReport(report: Report, rules: Rule[] = loadRules().rules): string {
  const lines: string[] = [], source = new Map(rules.map(rule => [rule.id, rule.source]));
  const drift = (report.docs ?? []).filter(row => row.status === 'drift'), unreachable = (report.docs ?? []).filter(row => row.status === 'unreachable');
  if (report.docs) {
    lines.push(drift.length ? `Documentation drift: ${drift.map(row => `${row.url} (${row.drifted.join(', ')})`).join('; ')}. Findings that rely on these rules are marked unverified.` : `Documentation re-checked: every cited quote is still present${unreachable.length ? `, except ${unreachable.length} page(s) that could not be fetched` : ''}.`, '');
  } else lines.push(`Documentation not re-checked (rules verified ${report.rulesVerifiedAt}; run with --verify-docs).`, '');
  for (const host of report.hosts) {
    lines.push(`${host.host} ${host.version ?? '(version unknown)'} at ${host.home} (${host.homeSource}): ${host.plugins.filter(row => row.enabled).length} enabled plugins, ${host.entries.filter(row => row.kind !== 'agent').length} skills and commands, ${host.entries.filter(row => row.kind === 'agent').length} agents, ${host.mcp.length} MCP servers, ${host.hooks.length} hooks.`);
  }
  const jstack = report.jstack ?? [], without = report.hosts.map(row => row.host).filter(host => !jstack.some(use => use.hosts.includes(host)));
  for (const use of jstack) lines.push(`jstack ${use.version ?? '(version unknown)'} ${use.source === 'installed' ? 'installed' : 'package'} at ${use.path} (${use.hosts.join(', ')}): collisions, hooks and listing weight are checked against it.`);
  if (!jstack.length) lines.push('No --package and no enabled jstack plugin: collisions with jstack are not checked.');
  else if (without.length) lines.push(`No enabled jstack plugin on ${without.join(', ')}: collisions with jstack are not checked there.`);
  lines.push('', 'Listing:');
  for (const row of report.listing) lines.push(`- ${row.host} at ${row.window.toLocaleString('en-US')} tokens: ${row.totalChars.toLocaleString('en-US')} of ${row.budgetChars.toLocaleString('en-US')} chars (${row.basis}); jstack ${row.jstackChars.toLocaleString('en-US')}; ${row.reduced.length} reduced${row.measured ? `; jstack always-on measured by ${row.measured.tool}: ${row.measured.value.toLocaleString('en-US')} ${row.measured.unit}` : ''}`);
  const findings = [...report.findings].sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
  lines.push('', findings.length ? 'Findings:' : 'Findings: none.');
  for (const finding of findings) {
    lines.push(`- [${finding.severity}] ${finding.host}: ${finding.title}${finding.unverified ? ' (unverified: documentation changed)' : ''}`, `  ${finding.detail}`);
    if (finding.evidence.length) lines.push(`  Evidence: ${finding.evidence.slice(0, 8).join(', ')}${finding.evidence.length > 8 ? `, and ${finding.evidence.length - 8} more` : ''}`);
    if (finding.action) lines.push(`  Action: ${finding.action}`);
    const sources = [...new Set(finding.rules.map(id => source.get(id)).filter(Boolean))];
    if (sources.length) lines.push(`  Source: ${sources.join(', ')}`);
  }
  return lines.join('\n') + '\n';
}

export async function main(argv = process.argv.slice(2), io: Streams = process, env: NodeJS.ProcessEnv = process.env, extra: Partial<Pick<AuditOptions, 'fetcher' | 'now'> & Pick<InventoryOptions, 'runner' | 'managed' | 'adminSkills'>> = {}): Promise<number> {
  try {
    const flags = parse(argv);
    if (flags.has('--help')) { io.stdout.write(HELP); return 0; }
    const host = flags.get('--host') ?? 'all';
    if (!['claude', 'codex', 'all'].includes(host)) throw new UsageError('--host is claude, codex or all');
    const packageDir = flags.get('--package') ? resolve(flags.get('--package')!) : undefined;
    if (packageDir && !existsSync(packageDir)) throw new UsageError(`--package not found: ${packageDir}`);
    const project = flags.get('--project') ? resolve(flags.get('--project')!) : undefined;
    const report = await audit({ hosts: host === 'all' ? ['claude', 'codex'] : [host as Host], packageDir, model: flags.get('--model'), verify: flags.has('--verify-docs'), measure: flags.has('--measure'), fetcher: extra.fetcher, now: extra.now, inventory: { home: flags.get('--home'), project, env, runner: extra.runner, managed: extra.managed, adminSkills: extra.adminSkills } });
    io.stdout.write(flags.has('--json') ? JSON.stringify(report, null, 2) + '\n' : renderReport(report));
    return exitCode(report.findings);
  } catch (error) {
    io.stderr.write(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) + '\n');
    return 2;
  }
}

if (isMain(import.meta.url)) main().then(code => { process.exitCode = code; });
