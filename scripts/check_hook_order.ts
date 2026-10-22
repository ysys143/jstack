import { isMain } from '../runtime/entry.js';
/** Verify exact hook chain order and the matching documented chain. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { sourceRoot } from './doctor-work.js';
export const EXPECTED_ORDER: Record<string, Record<string,string[]>> = {'hooks/hooks.json': {
  PreToolUse: ['dispatch.js'],
  PostToolUse: ['dispatch.js'], Stop: ['commit-session.js'], SessionStart: ['load-recent-changes.js','ensure-statusline.mjs']
}};
const nameOf = (command: string) => command.match(/\/([^/"']+)["'](?:\s|$)/)?.[1]
  ?? command.split('/').at(-1)!.replace(/^["']+|["']+$/g, '');
export function checkHookOrder(root = sourceRoot(), expected?: typeof EXPECTED_ORDER): string[] {
  const problems: string[] = []; const source = path.join(root, 'hosts/claude'); const base = fs.existsSync(source) && fs.statSync(source).isDirectory() ? source : root;
  expected ??= EXPECTED_ORDER;
  for (const [relative, order] of Object.entries(expected)) {
    const file = path.join(base, relative); let document: any;
    try {document = JSON.parse(fs.readFileSync(file, 'utf8'));} catch {problems.push(`hook declaration missing or invalid: ${relative}`); continue;}
    const events = document.hooks ?? {}; const undeclared = Object.keys(events).filter(event => !(event in order)).sort();
    if (undeclared.length) problems.push(`${relative}: undeclared events ${JSON.stringify(undeclared)}`);
    for (const [event, want] of Object.entries(order)) {
      const seen = (events[event] ?? []).flatMap((entry: any) => (entry.hooks ?? []).map((hook: any) => nameOf(hook.command ?? '')).filter(Boolean));
      if (JSON.stringify(seen) !== JSON.stringify(want)) problems.push(`${relative} ${event}: order mismatch; expected ${JSON.stringify(want)}; got ${JSON.stringify(seen)}`);
    }
    const contract = path.join(path.dirname(file), 'CONTRACT.md');
    if (!fs.existsSync(contract)) {problems.push(`CONTRACT.md missing: ${path.relative(root, contract)}`); continue;}
    const rows = [...fs.readFileSync(contract, 'utf8').matchAll(/^\|\s*(\d+)\s*\|\s*`([^`]+)`\s*\|\s*`([^`]+)`\s*\|/gm)].map(m => ({index:Number(m[1]),name:m[2]!,matcher:m[3]!}));
    if (!rows.length) {problems.push(`${path.relative(root, contract)}: chain table unreadable`); continue;}
    const documented = [...rows].sort((a,b) => a.index-b.index).map(row => row.name.split('/').at(-1));
    if (JSON.stringify(documented) !== JSON.stringify(order.PreToolUse ?? [])) problems.push(`${path.relative(root, contract)}: documented order mismatch`);
    const actual = new Map<string,string>(); for (const entry of events.PreToolUse ?? []) for (const hook of entry.hooks ?? []) {const name = nameOf(hook.command ?? ''); if (!actual.has(name)) actual.set(name,entry.matcher ?? '');}
    for (const row of rows) {const name = row.name.split('/').at(-1)!; if (!actual.has(name)) problems.push(`documented hook missing: ${name}`); else if (row.matcher.replaceAll('\\|','|') !== actual.get(name)) problems.push(`matcher mismatch: ${name}`);}
  }
  return problems;
}
if (isMain(import.meta.url)) {const problems = checkHookOrder(process.argv[2] ? path.resolve(process.argv[2]) : undefined); console.log([...problems.map(p => `[FAIL] ${p}`), `Hook chain problems: ${problems.length}`].join('\n')); process.exitCode = problems.length ? 1 : 0;}
