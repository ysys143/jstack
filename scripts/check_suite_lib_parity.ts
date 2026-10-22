import { isMain } from '../runtime/entry.js';
/** Require unique canonical files in both source and built payload layouts. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { sourceRoot } from './doctor-work.js';
export const CANONICAL: Record<string, string> = {'skills/_suite_lib.ts':'skills/_suite_lib.ts','scripts/run_suites.ts':'scripts/run_suites.ts','hosts/claude/hooks/block_emoji.ts':'hooks/block_emoji.ts'};
export function check(root = sourceRoot(), canonical = CANONICAL): string[] {
  const problems: string[] = []; let rows: {source?: string; target?: string}[];
  try {rows = JSON.parse(fs.readFileSync(path.join(root, 'packaging/package-files.json'), 'utf8')).files; if (!Array.isArray(rows)) throw new Error('files must be an array');}
  catch (error) {return [`package membership unreadable: ${(error as Error).message}`];}
  const sourceLayout = fs.existsSync(path.join(root, 'hosts/claude')) && fs.statSync(path.join(root, 'hosts/claude')).isDirectory();
  for (const [source, target] of Object.entries(canonical)) {
    const file = path.join(root, sourceLayout ? source : target.replace(/\.ts$/,".js"));
    if (!fs.existsSync(file) || !fs.statSync(file).isFile() || !fs.statSync(file).size) problems.push(`canonical file missing or empty: ${path.relative(root, file)}`);
    const bindings = rows.filter(row => row.source === source || row.target === target);
    if (bindings.length !== 1 || bindings[0]!.source !== source || bindings[0]!.target !== target || Object.keys(bindings[0]!).sort().join(',') !== 'source,target') problems.push(`canonical membership is not unique: ${source}`);
  }
  const walk = (dir: string): void => {if (!fs.existsSync(dir)) return; for (const item of fs.readdirSync(dir, {withFileTypes: true})) {const file = path.join(dir, item.name); if (item.isDirectory()) walk(file); else if (/^_suite_lib\.(?:py|ts|js)$/.test(item.name) && path.dirname(file) !== path.join(root,'skills')) problems.push(`duplicate suite library: ${path.relative(root, file)}`);}};
  walk(path.join(root, 'skills'));
  for (const name of ['staging', 'refactor', 'plugins']) if (fs.existsSync(path.join(root, name))) problems.push(`retired source tree remains: ${name}`);
  return problems;
}
if (isMain(import.meta.url)) {const problems = check(process.argv[2] ? path.resolve(process.argv[2]) : undefined); console.log([...problems.map(p => `[FAIL] ${p}`), `Canonical files: ${Object.keys(CANONICAL).length}; problems: ${problems.length}`].join('\n')); process.exitCode = problems.length ? 1 : 0;}
