import { sourcePath } from '../runtime/skill_catalog.js';
import { isMain } from '../runtime/entry.js';
/** Discover and run every contract suite; no suite is never a passing contract. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runProcess } from '../runtime/os.js';
import { sourceRoot } from './doctor-work.js';
export function inspect(name: string, root = sourceRoot(), execute = (command: string, args: string[], cwd: string) => runProcess(command, args, {cwd, timeout: 120000})) {
  if (!name || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name)) return {code: 2, lines: ['[2] valid skill name is required']};
  const directory = sourcePath(root, `skills/${name}`);
  if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) return {code: 2, lines: [`[2] ${name}: skill does not exist`]};
  const entries = (sub: string) => fs.existsSync(path.join(directory, sub)) ? fs.readdirSync(path.join(directory, sub)).filter(item => !item.startsWith('.')) : [];
  const lines = [`Skill: ${name}`]; const body = path.join(directory, 'SKILL.md');
  if (fs.existsSync(body)) lines.push(`  [L1] SKILL.md — ${(fs.readFileSync(body, 'utf8').match(/\n/g) ?? []).length} lines`);
  const layers = ['references', 'langs'].filter(sub => entries(sub).length);
  lines.push(`  [L2] ${layers.map(sub => `${sub}/`).join(' ') || '(none)'} — ${layers.reduce((n, sub) => n + entries(sub).length, 0)} items`, `  [L3] scripts/ — ${entries('scripts').length} items`);
  const candidates = entries('tests').filter(name => !name.startsWith('_') && /\.(py|[cm]?js|ts)$/.test(name) && !name.endsWith('.d.ts') && !name.endsWith('.test.ts') && !name.endsWith('.test.js'));
  const suites = [...new Set(candidates.map(name => name.replace(/\.(py|[cm]?js|ts)$/, '')))].sort();
  if (!suites.length) return {code: 1, lines: [...lines, '  Contract — none']};
  lines.push(`  Frozen references — ${entries('tests/refs').filter(name => name.endsWith('.lines')).length} items`);
  let code = 0;
  for (const suite of suites) {
    const target = [path.join(directory, 'tests', suite + '.js'), path.join(directory, 'tests', suite + '.mjs'), path.join(directory, 'tests', suite + '.cjs'), path.join(root, 'dist', path.relative(root, directory), 'tests', suite + '.js')].find(file => fs.existsSync(file));
    if (!target) { code = Math.max(code, 1); lines.push(`  [FAIL] ${suite}: compiled checker missing`); continue; }
    const result = execute(process.execPath, [target], directory);
    if ((result.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT') { code = 2; lines.push(`  [2] ${suite}: hit its time limit; nothing was measured`); continue; }
    const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
    lines.push(`  Contract ${suite} — ${output.split('\n').at(-1) || 'no output'}`);
    if (result.status !== 0) { code = Math.max(code, 1); lines.push(...output.split('\n').map(line => `    ${line}`)); }
  }
  return {code, lines};
}
if (isMain(import.meta.url)) { const result = inspect(process.argv.length === 3 ? process.argv[2]! : ''); console.log(result.lines.join('\n')); process.exitCode = result.code; }
