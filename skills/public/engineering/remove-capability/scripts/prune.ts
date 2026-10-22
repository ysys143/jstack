#!/usr/bin/env node
/** Diagnose selected agent configuration directories without changing any files. */
import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, sep } from 'node:path';
import { isMap, isScalar, parseDocument } from 'yaml';
import { isMain } from '../../../../../runtime/entry.js';

export const CAP = 1536;
type Issue = [string, string];
export interface Scan { skills: [string, string, number][]; issues: Issue[] }
const isDir = (path: string) => { try { return statSync(path).isDirectory(); } catch { return false; } };
const isFile = (path: string) => { try { return statSync(path).isFile(); } catch { return false; } };
const expand = (path: string) => path === '~' ? homedir() : path.startsWith('~/') || path.startsWith('~\\') ? join(homedir(), path.slice(2)) : path;
const len = (value: string) => [...value].length;
// YAML scalars used in a listing follow the existing Python string convention.
const pystr = (value: unknown): string => value === true ? 'True' : value === false ? 'False' : value === null ? 'None' : String(value);
const truthy = (value: unknown) => value !== null && value !== undefined && value !== false && value !== 0 && value !== '' && !(Array.isArray(value) && value.length === 0) && !(typeof value === 'object' && value !== null && Object.keys(value).length === 0);
export function loadFrontmatter(path: string): [Record<string, unknown> | null, string | null] {
  const match = /^---\n(.*?)\n---\n/s.exec(readFileSync(path, 'utf8').replace(/\r\n|\r/g, '\n'));
  if (!match) return [null, 'missing frontmatter'];
  try {
    const block = match[1]!, document = parseDocument(block, { version: '1.1', uniqueKeys: false });
    if (document.errors.length) throw document.errors[0];
    // PyYAML preserves a missing final line break in a terminal block scalar.
    // yaml synthesizes one; remove only that parser-added character.
    if (!block.endsWith('\n') && isMap(document.contents)) for (const pair of document.contents.items) {
      if (isScalar(pair.value) && ['BLOCK_FOLDED', 'BLOCK_LITERAL'].includes(pair.value.type ?? '') && (pair.value.range?.[1] ?? 0) >= block.length && typeof pair.value.value === 'string' && pair.value.value.endsWith('\n')) pair.value.value = pair.value.value.slice(0, -1);
    }
    const result = document.toJS();
    if (!result) return [{}, null];
    if (typeof result === 'object' && !Array.isArray(result)) return [result as Record<string, unknown>, null];
  } catch { /* Tolerant fallback mirrors the host-facing diagnostic. */ }
  const result: Record<string, unknown> = {};
  for (const key of ['name', 'description', 'when_to_use']) {
    const row = new RegExp(`^${key}:\\s*(.*)$`, 'm').exec(match[1]!);
    if (row) result[key] = row[1]!.trim().replace(/^["']+|["']+$/g, '');
  }
  return [result, 'strict YAML failed (host may still read it)'];
}
export function scanDir(root: string): Scan {
  const out: Scan = { skills: [], issues: [] };
  if (!isDir(root)) { out.issues.push(['missing', root]); return out; }
  for (const name of readdirSync(root).sort()) {
    if (name.startsWith('.')) continue;
    const path = join(root, name);
    if (lstatSync(path).isSymbolicLink() && !existsSync(path)) { out.issues.push(['broken link', `${name} -> ${readlinkSync(path)}`]); continue; }
    if (!isDir(path)) { out.issues.push(['non-skill file', name]); continue; }
    const skill = join(path, 'SKILL.md');
    if (!isFile(skill)) {
      const nested = readdirSync(path).filter(entry => !entry.startsWith('.') && isFile(join(path, entry, 'SKILL.md')));
      if (nested.length) out.issues.push([nested.includes(name) ? 'nested (possible repository clone)' : 'nested container', `${name} (${nested.length} nested)`]);
      else out.issues.push(['missing SKILL.md', name]);
      continue;
    }
    const [fm, warning] = loadFrontmatter(skill);
    if (fm === null) { out.issues.push(['missing frontmatter', name]); out.skills.push([name, name, 0]); continue; }
    if (warning) out.issues.push(['YAML warning', `${name}: ${warning}`]);
    const nm = pystr(truthy(fm.name) ? fm.name : name), desc = pystr(truthy(fm.description) ? fm.description : ''), when = pystr(truthy(fm.when_to_use) ? fm.when_to_use : '');
    if (nm !== name) out.issues.push(['name mismatch', `directory=${name} / name=${nm}; callable only as /${nm}`]);
    if (!desc) out.issues.push(['missing description', name]);
    const size = len(nm) + len(desc) + len(when);
    if (size > CAP) out.issues.push(['over 1536 characters', `${name} (${size} characters)`]);
    out.skills.push([name, nm, size]);
  }
  return out;
}
export function claudeExtras(config: string): Issue[] {
  const issues: Issue[] = [], settings = join(config, 'settings.json'), installed = join(config, 'plugins/installed_plugins.json');
  if (!isFile(settings)) return issues;
  let state: Record<string, any>;
  try { state = JSON.parse(readFileSync(settings, 'utf8')); }
  catch (error) { issues.push(['failed to parse settings.json', String((error as Error).message).split('\n')[0]!]); return issues; }
  let plugins: Record<string, any[]> = {};
  if (isFile(installed)) {
    try { plugins = JSON.parse(readFileSync(installed, 'utf8')).plugins ?? {}; }
    catch { issues.push(['failed to parse installed_plugins.json', installed]); }
  }
  for (const key of Object.keys(state.enabledPlugins ?? {})) if (!(key in plugins)) issues.push(['ghost plugin key', key]);
  for (const key of Object.keys(state.skillOverrides ?? {})) if (!existsSync(join(config, 'skills', key))) issues.push(['orphan skillOverrides', key]);
  for (const [key, records] of Object.entries(plugins)) for (const record of records) if (!isDir(record.installPath ?? '')) issues.push(['missing install path', `${key}: ${record.installPath ?? 'None'}`]);
  return issues;
}
export function codexExtras(config: string): Issue[] {
  const file = join(config, 'config.toml');
  if (!isFile(file)) return [];
  const out: Issue[] = [], text = readFileSync(file, 'utf8').replace(/\r\n|\r/g, '\n');
  for (const match of text.matchAll(/^\[\[skills\.config\]\]\npath = "([^"]+)"\nenabled = (\w+)/gm)) if (!existsSync(expand(match[1]!))) out.push(['orphan skills.config', `${match[1]} (enabled=${match[2]})`]);
  return out;
}
export function summarize(result: Record<string, Scan>) {
  const dirs: Record<string, { skills: number; listing_chars: number; issues: number; by_kind: Record<string, number> }> = {};
  let total = 0;
  for (const [config, scan] of Object.entries(result)) {
    const by: Record<string, number> = {};
    for (const [kind] of scan.issues) by[kind] = (by[kind] ?? 0) + 1;
    const count = scan.issues.length; total += count;
    dirs[config] = { skills: scan.skills.length, listing_chars: scan.skills.reduce((sum, row) => sum + row[2], 0), issues: count, by_kind: by };
  }
  return { total, dirs, exit: total ? 1 : 0 };
}
export function main(argv = process.argv.slice(2)): number {
  const dirs: string[] = []; let json = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--json') json = true;
    else if (arg === '--config-dir' && argv[index + 1] && !argv[index + 1]!.startsWith('--')) dirs.push(expand(argv[++index]!));
    else if (arg === '--help' || arg === '-h') { console.log('Usage: prune [--config-dir DIR ...] [--json]\nRead-only skill directory diagnosis. Exit: 0 clean, 1 defects, 2 unavailable.'); return 0; }
    else { console.error(`[blocked] unknown or incomplete argument: ${arg}`); return 2; }
  }
  // Default host homes plus the active profile overrides, without duplicates.
  if (!dirs.length) for (const path of [join(homedir(), '.claude'), process.env.CLAUDE_CONFIG_DIR, join(homedir(), '.codex'), process.env.CODEX_HOME]) { if (path && isDir(expand(path)) && !dirs.includes(expand(path))) dirs.push(expand(path)); }
  if (!dirs.length) { console.error('[blocked] no config directory is available to scan; this is unmeasured, not zero defects.'); return 2; }
  const result: Record<string, Scan> = {};
  for (const config of dirs) { const scan = scanDir(join(config, 'skills')); scan.issues.push(...(config.replaceAll(sep, '/').includes('/.codex') ? codexExtras(config) : claudeExtras(config))); result[config] = scan; }
  const summary = summarize(result);
  if (json) console.log(JSON.stringify({ summary, dirs: result }, null, 1));
  else {
    const number = (value: number) => value.toLocaleString('en-US');
    for (const [config, scan] of Object.entries(result)) {
      const size = scan.skills.reduce((sum, row) => sum + row[2], 0);
      console.log(`\n=== ${config.replaceAll(homedir(), '~')}\n  skills ${scan.skills.length} | listing cost ${number(size)} characters (~${number(Math.floor(size / 4))} tokens)`);
      if (!scan.issues.length) { console.log('  no issues'); continue; }
      const by = new Map<string, string[]>();
      for (const [kind, detail] of scan.issues) by.set(kind, [...(by.get(kind) ?? []), detail]);
      for (const [kind, details] of [...by].sort((a, b) => b[1].length - a[1].length)) { console.log(`  [${details.length}] ${kind}`); for (const detail of details.slice(0, 10)) console.log(`      - ${detail}`); if (details.length > 10) console.log(`      ... and ${details.length - 10} more`); }
    }
    console.log(`\nTotal issues: ${summary.total}. This tool changed nothing.`);
  }
  return summary.exit;
}
if (isMain(import.meta.url)) process.exitCode = main();
