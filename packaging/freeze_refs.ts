#!/usr/bin/env node
/** Regenerate reviewed contract references; this does not approve contracts or floors. */
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ref_lines, split_frontmatter } from '../skills/_suite_lib.js';
import { isMain } from '../runtime/entry.js';
export function freeze(root: string, source: string, destination?: string): string {
  root = realpathSync(root); source = realpathSync(source);
  const relRoot = relative(root, source);
  if (relRoot === '..' || relRoot.startsWith('..' + sep) || isAbsolute(relRoot)) throw new Error('source outside product');
  if (!destination) {
    let skill = dirname(source);
    while (skill !== root && !existsSync(join(skill, 'SKILL.md'))) skill = dirname(skill);
    if (skill === root) throw new Error('non-skill sources require an explicit snapshot destination');
    let rel = relative(skill, source);
    if (rel.split(sep)[0] === 'references' && !existsSync(join(skill, 'tests/refs', rel + '.lines'))) rel = rel.split(sep).slice(1).join(sep);
    destination = join(skill, 'tests/refs', rel + '.lines');
    if (basename(source) !== 'SKILL.md' && basename(destination).toLowerCase() === 'skill.md.lines' && dirname(destination) === join(skill, 'tests/refs')) throw new Error('case-insensitive SKILL.md collision: specify --destination');
  }
  let text = readFileSync(source, 'utf8');
  if (basename(source) === 'SKILL.md') text = split_frontmatter(text)[1];
  // Frozen references may outlive the commit that contains their source. Store
  // the blob so disposable contract snapshots can import the reviewed input.
  const digest = execFileSync('git', ['hash-object', '-w', source], { encoding: 'utf8' }).trim();
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, '# blob:' + digest + '\n' + ref_lines(text).join('\n') + '\n');
  return destination;
}
export function main(argv = process.argv.slice(2)): number {
  let root: string | undefined, destination: string | undefined; const sources: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') { console.log('freeze_refs.js --root DIRECTORY [--destination FILE] SOURCE...'); return 0; }
    if (arg === '--root' || arg === '--destination') { const value = argv[++i]; if (!value) throw new Error(`${arg} requires a value`); if (arg === '--root') root = value; else destination = value; }
    else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`); else sources.push(arg);
  }
  if (!root || !sources.length || (destination && sources.length !== 1)) throw new Error('--root and sources are required; --destination requires exactly one source');
  for (const source of sources) console.log(freeze(resolve(root), resolve(source), destination && resolve(destination)));
  return 0;
}
if (isMain(import.meta.url)) { try { process.exitCode = main(); } catch (error) { console.error(String(error)); process.exitCode = 2; } }
