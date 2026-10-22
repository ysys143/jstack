import { isMain } from '../runtime/entry.js';
/** Local line citation audit. Unresolvable citations are counted, never silently accepted as measured. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { sourceRoot } from './doctor-work.js';
import { CATALOG_PATH, sourcePath, type SkillCatalog } from '../runtime/skill_catalog.js';
const cite = /(?<path>[A-Za-z0-9_./-]+\.(?:md|py|js|sh|yaml|toml|xml|json)):(?<a>\d+)(?:-(?<b>\d+))?\b/g;
const directory = (p: string) => fs.existsSync(p) && fs.statSync(p).isDirectory();
const regular = (p: string) => fs.existsSync(p) && fs.statSync(p).isFile();
export function resolveCitation(skillDirectory: string, target: string, root: string): string | undefined {
  if (!target.includes('/')) return undefined;
  return [skillDirectory, path.dirname(skillDirectory), root, path.join(root, 'skills')].map(base => sourcePath(root, path.relative(root, path.resolve(base, target)).split(path.sep).join('/'))).find(regular);
}
export function checkSpecRefs(root = sourceRoot()) {
  let total = 0; const outside: string[] = []; const bad: string[] = [];
  const skills = path.join(root, 'skills');
  const catalogFile = path.join(root, CATALOG_PATH);
  const owners = fs.existsSync(catalogFile) ? (JSON.parse(fs.readFileSync(catalogFile, 'utf8')) as SkillCatalog).entries.map(entry => entry.owner) : directory(skills) ? fs.readdirSync(skills).sort() : [];
  for (const skill of owners) {
    const sd = sourcePath(root, `skills/${skill}`); if (skill === '__pycache__' || !directory(sd)) continue;
    for (const sub of ['', 'references']) { const dir = path.join(sd, sub); if (!directory(dir)) continue;
      for (const name of fs.readdirSync(dir).sort().filter(name => name.endsWith('.md'))) {
        const doc = path.join(dir, name); const rel = path.relative(root, doc).split(path.sep).join('/');
        for (const match of fs.readFileSync(doc, 'utf8').matchAll(cite)) {
          total++; const {path: target, a, b} = match.groups!; const file = resolveCitation(sd, target!, root);
          if (!file) {outside.push(`${rel} -> ${target}:${Number(a)}`); continue;}
          const text = fs.readFileSync(file, 'utf8'); const count = text ? text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').length - (text.endsWith('\n') || text.endsWith('\r') ? 1 : 0) : 0;
          if (Number(b ?? a) > count) bad.push(`${rel} -> ${target}:${a}${b ? `-${b}` : ''} (${count} lines)`);
        }
      }
    }
  }
  const inside = total - outside.length; const lines = [`Line citations: ${total}; local: ${inside}; ambiguous/external: ${outside.length}; dead: ${bad.length}`, ...outside.map(item => `  [external] ${item}`), ...bad.map(item => `  [FAIL] ${item}`)];
  if (!total) lines.push('[FAIL] no citations discovered'); else if (!inside) lines.push('[FAIL] no measurable local citations'); else if (inside * 4 < total) lines.push(`[notice] only ${inside}/${total} citations are measurable`);
  return {code: bad.length || !total || !inside ? 1 : 0, lines, total, inside, outside, bad};
}
if (isMain(import.meta.url)) {const result = checkSpecRefs(process.argv[2] ? path.resolve(process.argv[2]) : undefined); console.log(result.lines.join('\n')); process.exitCode = result.code;}
