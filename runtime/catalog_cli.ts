#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative, sep } from 'node:path';
import { CATALOG_PATH, loadCatalog, resolveSkill, sourcePath } from './skill_catalog.js';
import { isMain } from './entry.js';

export function catalogRoot(): string {
  // Installed payload, contributor dist, or prepared npm CLI metadata.
  for (const url of [new URL('../', import.meta.url), new URL('../../', import.meta.url)]) {
    if (existsSync(new URL(CATALOG_PATH, url))) return fileURLToPath(url);
  }
  throw new Error('Skill catalog is absent from this CLI package');
}
export function main(argv = process.argv.slice(2), root?: string): number {
  try {
    const [action = 'list', name, ...extra] = argv;
    const host = extra[0] === '--host' && extra.length === 2 && ['claude', 'codex'].includes(extra[1]) ? extra[1] : undefined;
    if (!['list', 'resolve'].includes(action) || (extra.length && !host) || (action === 'resolve' ? !name : name !== undefined)) throw new Error('Usage: jst catalog [list | resolve NAME [--host claude|codex]]');
    root ??= catalogRoot();
    const catalog = loadCatalog(root);
    if (!catalog) throw new Error('This package predates the skill catalog');
    const resolved = action === 'resolve' ? resolveSkill(catalog, name!) : undefined;
    let body = resolved ? relative(root, sourcePath(root, resolved.canonical)) : undefined;
    if (resolved && host === 'codex') for (const candidate of [`hosts/codex/skills/${resolved.owner}/SKILL.md`, `skills/${resolved.owner}/SKILL.codex.md`]) if (existsSync(sourcePath(root, candidate))) { body = relative(root, sourcePath(root, candidate)); break; }
    body = body?.split(sep).join('/');
    const result = resolved ? { ...resolved, host: host ?? null, body } : {
      schemaVersion: catalog.schemaVersion,
      groups: catalog.categories.map(category => ({ category, skills: catalog.entries.filter(entry => entry.visibility === 'public' && entry.category === category).map(entry => ({ name: entry.name, purpose: entry.purpose, aliases: entry.aliases, nativeAliases: entry.nativeAliases ?? [] })) })),
      support: catalog.entries.filter(entry => entry.visibility === 'support').map(entry => ({ name: entry.name, when: entry.when, aliases: entry.aliases })),
    };
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return 0;
  } catch (error) { process.stderr.write(String(error) + '\n'); return 2; }
}
if (isMain(import.meta.url)) process.exitCode = main();
