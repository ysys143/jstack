/** Public discovery is a reviewed contract, never inferred from every SKILL.md. */
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export const CATALOG_PATH = 'contracts/skill-catalog.json';
export interface CatalogEntry {
  owner: string;
  name: string;
  visibility: 'public' | 'support';
  aliases: string[];
  nativeAliases?: string[];
  invocation?: 'explicit';
  category?: string;
  purpose?: string;
  usedBy?: string[];
  when?: string;
}
export interface SkillCatalog { schemaVersion: 1; sourceLayout?: 'hierarchical'; categories: string[]; entries: CatalogEntry[] }
export interface SkillExport { owner: string; name: string; path: string; invocation?: 'explicit'; aliasFor?: string }
const slug = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
const unique = (items: string[]) => new Set(items).size === items.length;
const nonempty = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
const same = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

export function sourceOwners(root: string): string[] {
  if (existsSync(join(root, 'skills/public'))) {
    const owners: string[] = [];
    const scan = (dir: string) => {
      if (existsSync(join(dir, 'SKILL.md'))) {
        const name = readFileSync(join(dir, 'SKILL.md'), 'utf8').match(/^name: ([a-z0-9-]+)$/m)?.[1];
        if (!name) throw new Error('Source skill is missing its identity');
        owners.push(name); return; // Embedded upstream trees belong to this owner.
      }
      for (const row of readdirSync(dir, { withFileTypes: true })) if (row.isDirectory() && !row.name.startsWith('.') && row.name !== '__pycache__') scan(join(dir, row.name));
    };
    scan(join(root, 'skills')); return owners.sort();
  }
  return readdirSync(join(root, 'skills')).filter(name => !name.startsWith('_') && existsSync(join(root, 'skills', name, 'SKILL.md'))).sort();
}

export function authoredSkillPath(entry: CatalogEntry): string {
  return entry.visibility === 'public' ? `skills/public/${entry.category}/${entry.name}` : `skills/support/${entry.name}`;
}

/** Stable payload addresses are mapped to the sole authored source when in a checkout. */
export function sourcePath(root: string, logical: string): string {
  const file = join(root, CATALOG_PATH);
  if (!existsSync(file) || !existsSync(join(root, 'skills/public'))) return join(root, logical);
  const catalog = JSON.parse(readFileSync(file, 'utf8')) as SkillCatalog;
  for (const entry of catalog.entries) {
    const prefix = `skills/${entry.owner}`;
    if (logical === prefix || logical.startsWith(prefix + '/')) return join(root, authoredSkillPath(entry), logical.slice(prefix.length));
    const native = `hosts/codex/skills/${entry.owner}`;
    if (logical === native || logical.startsWith(native + '/')) return join(root, 'hosts/codex', authoredSkillPath(entry), logical.slice(native.length));
  }
  return join(root, logical);
}

export function deliveryPath(catalog: SkillCatalog | undefined, source: string): string {
  if (catalog?.sourceLayout === 'hierarchical') for (const entry of catalog.entries) {
    const prefix = authoredSkillPath(entry);
    if (source === prefix || source.startsWith(prefix + '/')) return `skills/${entry.owner}` + source.slice(prefix.length);
  }
  return source;
}

export function validateCatalog(value: unknown, owners: string[]): SkillCatalog {
  const catalog = value as SkillCatalog;
  if (!catalog || catalog.schemaVersion !== 1 || !Array.isArray(catalog.categories) || !catalog.categories.length || !catalog.categories.every(slug) || !unique(catalog.categories) || !Array.isArray(catalog.entries) || !catalog.entries.length) throw new Error('Invalid skill catalog');
  if (catalog.sourceLayout !== undefined && catalog.sourceLayout !== 'hierarchical') throw new Error('Unsupported source layout');
  const names = new Set<string>();
  for (const entry of catalog.entries) {
    if (!entry || !slug(entry.owner) || !slug(entry.name) || !['public', 'support'].includes(entry.visibility) || !Array.isArray(entry.aliases) || !entry.aliases.every(slug)) throw new Error('Invalid catalog entry');
    for (const name of [entry.name, ...entry.aliases]) {
      if (names.has(name)) throw new Error(`Ambiguous catalog name or alias: ${name}`);
      names.add(name);
    }
    if (entry.name !== entry.owner && !entry.aliases.includes(entry.owner)) throw new Error(`Missing previous-name resolution: ${entry.owner}`);
    if (entry.invocation !== undefined && (entry.visibility !== 'public' || entry.invocation !== 'explicit')) throw new Error('Invalid invocation policy');
    if (entry.nativeAliases !== undefined && (entry.visibility !== 'public' || !Array.isArray(entry.nativeAliases) || !unique(entry.nativeAliases) || !entry.nativeAliases.every(name => entry.aliases.includes(name)))) throw new Error(`Invalid native compatibility aliases: ${entry.owner}`);
    if (entry.visibility === 'public') {
      if (!catalog.categories.includes(entry.category!) || !nonempty(entry.purpose) || entry.usedBy !== undefined || entry.when !== undefined) throw new Error(`Invalid public ownership: ${entry.owner}`);
    } else if (entry.category !== undefined || entry.purpose !== undefined || !Array.isArray(entry.usedBy) || !entry.usedBy.length || !entry.usedBy.every(slug) || !unique(entry.usedBy) || !nonempty(entry.when)) throw new Error(`Invalid support ownership: ${entry.owner}`);
  }
  if (!unique(catalog.entries.map(entry => entry.owner)) || !same(catalog.entries.map(entry => entry.owner), owners)) throw new Error('Catalog must classify every source owner exactly once');
  const publicOwners = new Set(catalog.entries.filter(entry => entry.visibility === 'public').map(entry => entry.owner));
  if (!publicOwners.size) throw new Error('Catalog has no public workflow');
  for (const entry of catalog.entries) for (const owner of entry.usedBy ?? []) if (!publicOwners.has(owner)) throw new Error(`Support consumer is not a public owner: ${entry.owner} -> ${owner}`);
  return catalog;
}

export function loadCatalog(root: string): SkillCatalog | undefined {
  const product = JSON.parse(readFileSync(join(root, 'packaging/product.json'), 'utf8'));
  if (product.skillCatalog === undefined) {
    if (existsSync(join(root, CATALOG_PATH))) throw new Error('Product must opt into the present skill catalog');
    return undefined; // Compatibility for checked packages predating the catalog.
  }
  if (product.skillCatalog !== CATALOG_PATH) throw new Error('Unsupported skill catalog location');
  const raw = JSON.parse(readFileSync(join(root, CATALOG_PATH), 'utf8')) as SkillCatalog;
  const hierarchical = existsSync(join(root, 'skills/public'));
  if (hierarchical && raw.sourceLayout !== 'hierarchical') throw new Error('Hierarchical source requires its catalog layout declaration');
  const discovered = sourceOwners(root);
  const catalog = validateCatalog(raw, hierarchical ? discovered.map(name => raw.entries.find(row => row.name === name)?.owner ?? name) : discovered);
  for (const entry of catalog.entries) {
    const path = sourcePath(root, `skills/${entry.owner}/SKILL.md`);
    const rel = relative(realpathSync(root), realpathSync(path));
    if (rel === '..' || rel.startsWith('..' + sep)) throw new Error('Catalog source escapes package');
    const front = readFileSync(path, 'utf8').match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/)?.[0];
    if (!front || !new RegExp(`^name: ${hierarchical ? entry.name : entry.owner}\r?$`, 'm').test(front)) throw new Error(`Source identity differs from catalog owner: ${entry.owner}`);
  }
  return catalog;
}

export function catalogExports(catalog: SkillCatalog): SkillExport[] {
  return catalog.entries.filter(entry => entry.visibility === 'public').flatMap(entry => [
    { owner: entry.owner, name: entry.name, path: `${entry.category}/${entry.name}`, ...(entry.invocation ? { invocation: entry.invocation } : {}) },
    ...(entry.nativeAliases ?? []).map(name => ({ owner: entry.owner, name, path: `${entry.category}/${name}`, aliasFor: entry.name })),
  ]).sort((a,b) => a.name.localeCompare(b.name));
}
export function skillExports(root: string): SkillExport[] {
  const catalog = loadCatalog(root);
  if (catalog) return catalogExports(catalog);
  const owners = sourceOwners(root);
  if (!owners.length || !owners.every(slug)) throw new Error('Missing or invalid public skills');
  return owners.map(name => ({ owner: name, name, path: name }));
}

/** A compatibility lookup, not an invented native slash-command alias. */
export function resolveSkill(catalog: SkillCatalog, input: string) {
  const name = input.replace(/^[/$]?jstack:/, '');
  const entry = catalog.entries.find(row => row.name === name || row.aliases.includes(name));
  if (!entry) throw new Error(`Unknown jstack capability: ${input}`);
  return { ...entry, canonical: `skills/${entry.owner}/SKILL.md`, invocation: entry.visibility === 'public' ? `jstack:${entry.name}` : null, resolution: entry.visibility === 'public' ? 'native-skill' : 'read-support' };
}
