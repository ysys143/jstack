#!/usr/bin/env node
/** Regenerate science routing data without following directory aliases. */
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { isMain } from '../../../../../runtime/entry.js';

export const CAT_URL = 'https://raw.githubusercontent.com/K-Dense-AI/scientific-agent-skills/HEAD/docs/skills.md';
export const HEAD_ROW = '| File | Count | Domain |\n|---|---|---|\n';
export function one_line(value: unknown, n = 110): string {
  const normalized = String(value).trim().split(/\s+/u).join(' ');
  return [...normalized.split(/(?<=[.!?])\s/u)[0]].slice(0, n).join('').trimEnd();
}
export function skill_files(base: string): string[] {
  if (!existsSync(base)) return [];
  const out: string[] = [];
  function walk(directory: string): void {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name), info = lstatSync(path);
      if (info.isDirectory()) walk(path);
      else if (name === 'SKILL.md' && (info.isFile() || info.isSymbolicLink())) out.push(path);
    }
  }
  walk(base); return out.sort();
}
export function replace_table(text: string, table: string): string {
  const marker = text.indexOf(HEAD_ROW);
  if (marker < 0) throw new Error('Science routing table marker is missing');
  const start = marker + HEAD_ROW.length;
  let end = start;
  while (text.startsWith('|', end)) { const next = text.indexOf('\n', end); if (next < 0) throw new Error('Routing table row must end in a newline'); end = next + 1; }
  return text.slice(0, start) + table + '\n' + text.slice(end);
}
type Source = { repo: string; url: string; commit: string; license: string };
type Row = [string, string, string, string, string];
export function rebuild(root: string, catalog: string) {
  const referenceRoot = join(root, 'references'), domains = new Map<string, string>();
  if (lstatSync(referenceRoot).isSymbolicLink()) throw new Error('Reference directory must not be a symlink');
  let level2: string | undefined, level3: string | undefined;
  for (const line of catalog.split(/\r?\n/)) {
    const m2 = line.match(/^## (.+)$/), m3 = line.match(/^### (.+)$/);
    if (m2) { level2 = m2[1].trim(); level3 = undefined; continue; }
    if (m3) { level3 = m3[1].trim(); continue; }
    const item = line.match(/^-\s+\*\*\[.+?\]\(\.\.\/skills\/([^/]+)\/\)\*\*/);
    if (item && (level3 || level2)) domains.set(item[1], level3 || level2!);
  }
  const rows: Row[] = [];
  for (const repo of ['kdense', 'gdm', 'academic']) for (const path of skill_files(join(root, 'repos', repo))) {
    const front = readFileSync(path, 'utf8').match(/^---\n(.*?)\n---\n/s); if (!front) continue;
    let data: any; try { data = parse(front[1], { schema: 'yaml-1.1', merge: true }) || {}; } catch { data = {}; }
    const slug = basename(dirname(path));
    const group = repo === 'kdense' ? domains.get(slug) ?? 'Uncategorized' : repo === 'gdm' ? 'Biological Databases (DeepMind)' : 'Academic Paper Pipeline';
    rows.push([group, slug, one_line(data.description ?? ''), relative(root, path).split(sep).join('/'), repo]);
  }
  const sources = JSON.parse(readFileSync(join(referenceRoot, '_sources.json'), 'utf8')) as Record<string, Source>;
  const groups = new Map<string, Row[]>();
  rows.forEach(row => { const items = groups.get(row[0]) ?? []; items.push(row); groups.set(row[0], items); });
  const planned = new Map<string, string>();
  const index: { domain: string; file: string; count: number; bytes: number }[] = [];
  for (const [group, items] of groups) {
    const file = group.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') + '.md';
    if (file === '.md' || planned.has(file)) throw new Error(`Nonunique domain output: ${group}`);
    const credits = [...new Set(items.map(row => row[4]))].sort().filter(repo => Object.hasOwn(sources, repo)).map(repo => {
      const source = sources[repo]; return `\`${repo}\` = [${source.repo}](${source.url}) @ ${source.commit.slice(0, 7)} (${source.license.split(' —')[0]})`;
    }).join(', ');
    let body = `# ${group}\n\n<!-- sources -->\n출처: ${credits}\n\n${items.length} items. Choose one, read the \`path\`'s SKILL.md, and follow its instructions.\n\n`;
    for (const [, slug, desc, path, repo] of [...items].sort((a, b) => a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0)) body += `- **${slug}** (\`${repo}\`) — ${desc}\n  \`${path}\`\n`;
    planned.set(file, body); index.push({ domain: group, file, count: items.length, bytes: Buffer.byteLength(body) });
  }
  index.sort((a, b) => b.count - a.count || (a.domain < b.domain ? -1 : a.domain > b.domain ? 1 : 0));
  const skillPath = join(root, 'SKILL.md');
  const skill = replace_table(readFileSync(skillPath, 'utf8'), index.map(row => `| \`${row.file}\` | ${row.count} | ${row.domain} |`).join('\n'));
  for (const path of [skillPath, ...['_index.json', '_kdense-catalog.md', ...planned.keys()].map(file => join(referenceRoot, file))]) {
    try { if (!lstatSync(path).isFile()) throw new Error(`Output is not a regular file: ${basename(path)}`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  // Only generated files are replaceable; user-authored references survive regeneration.
  for (const [file] of planned) if (existsSync(join(referenceRoot, file)) && !readFileSync(join(referenceRoot, file), 'utf8').includes('<!-- sources -->')) throw new Error(`Unowned reference would be overwritten: ${file}`);
  mkdirSync(referenceRoot, { recursive: true });
  for (const file of readdirSync(referenceRoot)) if (!file.startsWith('_') && file.endsWith('.md') && !planned.has(file)) {
    const path = join(referenceRoot, file);
    if (lstatSync(path).isFile() && readFileSync(path, 'utf8').includes('<!-- sources -->')) unlinkSync(path);
  }
  for (const [file, body] of planned) writeFileSync(join(referenceRoot, file), body);
  writeFileSync(join(referenceRoot, '_kdense-catalog.md'), catalog);
  writeFileSync(join(referenceRoot, '_index.json'), JSON.stringify(index, null, 1));
  writeFileSync(skillPath, skill);
  return { skills: rows.length, domains: index.length, bytes: index.reduce((n, row) => n + row.bytes, 0), index };
}
export async function main(argv = process.argv.slice(2)): Promise<number> {
  let root = resolve(dirname(fileURLToPath(import.meta.url)), '..'), catalogPath: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--help') { console.log('rebuild-index.js [--root SCIENCE_DIRECTORY] [--catalog LOCAL_CATALOG]'); return 0; }
    if (!['--root', '--catalog'].includes(argv[i]) || !argv[i + 1]) throw new Error(`Invalid argument: ${argv[i]}`);
    const flag = argv[i], value = argv[++i]; if (flag === '--root') root = resolve(value); else catalogPath = value;
  }
  let catalog: string;
  if (catalogPath) catalog = readFileSync(catalogPath, 'utf8');
  else { const response = await fetch(CAT_URL, { signal: AbortSignal.timeout(30_000) }); if (!response.ok) throw new Error(`Catalog HTTP ${response.status}`); catalog = await response.text(); }
  const result = rebuild(root, catalog);
  console.log(`${result.skills} skills / ${result.domains} domains / index ${result.bytes.toLocaleString('en-US')}B — regeneration complete`); return 0;
}
if (isMain(import.meta.url)) main().then(code => { process.exitCode = code; }).catch(error => { console.error(String(error)); process.exitCode = 2; });
