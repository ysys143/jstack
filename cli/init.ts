import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { locations, requestedHosts, type HostOptions } from './hosts.js';
import { atomicWrite, checkOwned, privateDir, stat, withLock } from '../runtime/os.js';

export class InitError extends Error {}

type PluginRule = { marketplace: string; plugin: string; disabledSkills: 'all' | string[] };
type Preferences = { schemaVersion: 1; revision: number; codex: { plugins: PluginRule[] } };
type SkillEntry = { path: string; enabled: boolean };
type SkillRef = { marketplace: string; plugin: string; version: string; skill: string };

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const jsonBytes = (value: unknown) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const key = (value: Pick<SkillRef, 'marketplace' | 'plugin' | 'skill'>) => `${value.marketplace}\0${value.plugin}\0${value.skill}`;

function refFromPath(file: string): SkillRef | undefined {
  const parts = path.resolve(file).split(path.sep);
  for (let i = 0; i + 7 < parts.length; i++) {
    if (parts[i] !== 'plugins' || parts[i + 1] !== 'cache' || parts[i + 5] !== 'skills' || parts[i + 7] !== 'SKILL.md') continue;
    const marketplace = parts[i + 2], plugin = parts[i + 3], version = parts[i + 4], skill = parts[i + 6];
    if ([marketplace, plugin, version, skill].every(value => value && NAME.test(value))) return { marketplace: marketplace!, plugin: plugin!, version: version!, skill: skill! };
  }
  return undefined;
}

function readConfig(file: string): { text: string; entries: SkillEntry[] } {
  if (!stat(file)) return { text: '', entries: [] };
  if (!stat(file)?.isFile() || stat(file)?.isSymbolicLink()) throw new InitError('Codex config must be a regular file');
  const text = fs.readFileSync(file, 'utf8');
  let document: Record<string, any>;
  try { document = parseToml(text) as Record<string, any>; } catch { throw new InitError('Codex config is invalid TOML; preserve it and repair manually'); }
  const raw = document.skills?.config;
  if (raw === undefined) return { text, entries: [] };
  if (!Array.isArray(raw)) throw new InitError('Codex skills.config has an unsupported shape');
  const entries: SkillEntry[] = raw.map((row: unknown) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new InitError('Codex skills.config contains an invalid entry');
    const value = row as Record<string, unknown>;
    if (typeof value.path !== 'string' || typeof value.enabled !== 'boolean') throw new InitError('Codex skills.config entries require path and enabled');
    return { path: value.path, enabled: value.enabled };
  });
  return { text, entries };
}

function skillNames(root: string, ref: Pick<SkillRef, 'marketplace' | 'plugin' | 'version'>): string[] {
  const directory = path.join(root, 'plugins', 'cache', ref.marketplace, ref.plugin, ref.version, 'skills');
  if (!stat(directory)?.isDirectory() || stat(directory)?.isSymbolicLink()) return [];
  return fs.readdirSync(directory).filter(name => NAME.test(name) && stat(path.join(directory, name, 'SKILL.md'))?.isFile()).sort();
}

export function capturePreferences(codexRoot: string): Preferences {
  const entries = readConfig(path.join(codexRoot, 'config.toml')).entries;
  const disabled = entries.filter(row => !row.enabled).map(row => refFromPath(row.path)).filter((row): row is SkillRef => !!row);
  const groups = new Map<string, SkillRef[]>();
  for (const row of disabled) {
    const id = `${row.marketplace}\0${row.plugin}`;
    groups.set(id, [...(groups.get(id) ?? []), row]);
  }
  const plugins: PluginRule[] = [];
  for (const rows of groups.values()) {
    const sample = rows[0]!;
    const versions = [...new Set(rows.map(row => row.version))];
    const complete = versions.some(version => {
      const names = skillNames(codexRoot, { ...sample, version });
      const selected = new Set(rows.filter(row => row.version === version).map(row => row.skill));
      return names.length > 0 && names.every(name => selected.has(name));
    });
    plugins.push({ marketplace: sample.marketplace, plugin: sample.plugin,
      disabledSkills: complete ? 'all' : [...new Set(rows.map(row => row.skill))].sort() });
  }
  plugins.sort((a, b) => `${a.marketplace}/${a.plugin}`.localeCompare(`${b.marketplace}/${b.plugin}`));
  return { schemaVersion: 1, revision: 1, codex: { plugins } };
}

function validatePreferences(value: unknown): Preferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InitError('personal defaults must be a JSON object');
  const document = value as Record<string, any>;
  if (document.schemaVersion !== 1 || !Number.isSafeInteger(document.revision) || document.revision < 1 || !document.codex || !Array.isArray(document.codex.plugins)) throw new InitError('unsupported personal-defaults schema');
  if (Object.keys(document).sort().join(',') !== 'codex,revision,schemaVersion' || Object.keys(document.codex).join(',') !== 'plugins') throw new InitError('unknown personal-defaults field');
  const seen = new Set<string>();
  for (const rule of document.codex.plugins) {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule) || Object.keys(rule).sort().join(',') !== 'disabledSkills,marketplace,plugin') throw new InitError('invalid plugin default');
    if (!NAME.test(rule.marketplace) || !NAME.test(rule.plugin)) throw new InitError('invalid plugin identity in personal defaults');
    if (rule.disabledSkills !== 'all' && (!Array.isArray(rule.disabledSkills) || !rule.disabledSkills.length || rule.disabledSkills.some((name: unknown) => typeof name !== 'string' || !NAME.test(name)))) throw new InitError('invalid disabled skill selection');
    const id = `${rule.marketplace}/${rule.plugin}`; if (seen.has(id)) throw new InitError('duplicate plugin default'); seen.add(id);
  }
  return document as Preferences;
}

function readPreferences(file: string): Preferences {
  checkOwned(file);
  try { return validatePreferences(JSON.parse(fs.readFileSync(file, 'utf8'))); }
  catch (error) { if (error instanceof InitError) throw error; throw new InitError('personal defaults are unreadable JSON'); }
}

function installedSkillPaths(codexRoot: string, rule: PluginRule): string[] {
  const pluginRoot = path.join(codexRoot, 'plugins', 'cache', rule.marketplace, rule.plugin);
  if (!stat(pluginRoot)?.isDirectory() || stat(pluginRoot)?.isSymbolicLink()) return [];
  const wanted = rule.disabledSkills === 'all' ? undefined : new Set(rule.disabledSkills);
  const rows: string[] = [];
  for (const version of fs.readdirSync(pluginRoot).filter(name => NAME.test(name)).sort()) {
    for (const skill of skillNames(codexRoot, { marketplace: rule.marketplace, plugin: rule.plugin, version })) {
      if (!wanted || wanted.has(skill)) rows.push(path.join(pluginRoot, version, 'skills', skill, 'SKILL.md'));
    }
  }
  return rows;
}

export function applyPreferences(codexRoot: string, preferences: Preferences): { applied: number; existing: number; preservedOverrides: number; pendingPlugins: string[] } {
  const configFile = path.join(codexRoot, 'config.toml');
  const config = readConfig(configFile);
  const exact = new Map(config.entries.map(row => [path.resolve(row.path), row.enabled]));
  const bySkill = new Map<string, boolean[]>();
  for (const row of config.entries) {
    const ref = refFromPath(row.path); if (!ref) continue;
    bySkill.set(key(ref), [...(bySkill.get(key(ref)) ?? []), row.enabled]);
  }
  const additions: string[] = []; let existing = 0, preservedOverrides = 0;
  const pendingPlugins: string[] = [];
  for (const rule of preferences.codex.plugins) {
    const paths = installedSkillPaths(codexRoot, rule);
    if (!paths.length) { pendingPlugins.push(`${rule.plugin}@${rule.marketplace}`); continue; }
    for (const file of paths) {
      if (exact.has(path.resolve(file))) { if (exact.get(path.resolve(file))) preservedOverrides++; else existing++; continue; }
      const ref = refFromPath(file)!;
      if ((bySkill.get(key(ref)) ?? []).includes(true)) { preservedOverrides++; continue; }
      additions.push(`[[skills.config]]\npath = ${JSON.stringify(file)}\nenabled = false\n`);
    }
  }
  if (additions.length) {
    if (!stat(codexRoot)?.isDirectory() || stat(codexRoot)?.isSymbolicLink()) throw new InitError('Codex home must be an existing regular directory');
    const separator = config.text.length && !config.text.endsWith('\n') ? '\n\n' : config.text.length ? '\n' : '';
    const next = `${config.text}${separator}${additions.join('\n')}`;
    try { parseToml(next); } catch { throw new InitError('generated Codex config did not validate'); }
    atomicWrite(configFile, Buffer.from(next), false);
  }
  return { applied: additions.length, existing, preservedOverrides, pendingPlugins: [...new Set(pendingPlugins)].sort() };
}

export interface InitOptions extends HostOptions { capture?: boolean }

export function initialize(options: InitOptions = {}): Record<string, unknown> {
  const selected = requestedHosts(options), paths = locations(options);
  if (!selected.includes('codex')) {
    if (options.capture) throw new InitError('--capture-app-defaults requires the Codex host');
    return { ok: true, captured: false, pluginDefaults: 0, hosts: [{ host: 'claude', status: 'not-applicable', reason: 'Claude does not use Codex skills.config entries' }] };
  }
  const directory = path.join(paths.root, 'preferences');
  const file = path.join(directory, 'codex-skill-defaults.json');
  privateDir(directory);
  return withLock(path.join(directory, '.init-lock-v1'), () => {
    let captured = false; let preferences: Preferences;
    if (options.capture || !stat(file)) {
      preferences = capturePreferences(paths.codex);
      if (!preferences.codex.plugins.length) throw new InitError('no disabled plugin skills were found to capture');
      const revision = stat(file) ? readPreferences(file).revision + 1 : 1;
      preferences.revision = revision; atomicWrite(file, jsonBytes(preferences)); captured = true;
    } else preferences = readPreferences(file);
    const hosts = selected.map(host => host === 'codex'
      ? { host, status: 'configured', ...applyPreferences(paths.codex, preferences) }
      : { host, status: 'not-applicable', reason: 'Claude does not use Codex skills.config entries' });
    return { ok: true, captured, preferenceFile: file, revision: preferences.revision, pluginDefaults: preferences.codex.plugins.length, hosts };
  });
}

export function parseInitArguments(argv: string[]): InitOptions & { json?: boolean } {
  const options: InitOptions & { json?: boolean } = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]!;
    if (flag === '--json') { options.json = true; continue; }
    if (flag === '--capture-app-defaults') { options.capture = true; continue; }
    if (flag === '--host') {
      const value = argv[++i]; if (!value || !['claude', 'codex', 'all'].includes(value)) throw new InitError('Host must be claude, codex, or all');
      options.hosts = value === 'all' ? ['claude', 'codex'] : [value as 'claude' | 'codex']; continue;
    }
    if (flag === '--home') { const value = argv[++i]; if (!value || value.startsWith('--')) throw new InitError('--home requires a directory'); options.home = value; continue; }
    throw new InitError(`Invalid init option: ${flag}`);
  }
  return options;
}

export function main(argv = process.argv.slice(2)): number {
  try {
    const options = parseInitArguments(argv); const result = initialize(options);
    process.stdout.write(`${JSON.stringify(result, null, options.json ? 2 : 0)}\n`); return 0;
  } catch (error) { process.stderr.write(`${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n`); return error instanceof InitError ? 2 : 1; }
}
