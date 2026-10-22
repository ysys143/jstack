import { isMain } from '../runtime/entry.js';
/** Validate adapted style rules, local references, and retained licenses. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { sourceRoot } from './doctor-work.js';
import { sourcePath } from '../runtime/skill_catalog.js';
export function styleSections(text: string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const section of text.split(/^## /m).slice(1)) {const title = section.split(/\r?\n/)[0]!.trim(); const count = [...section.matchAll(/^\d+\./gm)].length; result[title] = count; result[title.replaceAll(' ', '')] = count; result[title.toLowerCase().replaceAll(' ', '-')] = count; if (title === 'Sentence level') result['문장단위'] = count; if (title === 'Phrase level') result['구단위'] = count;}
  return result;
}
export function checkAttribution(root = sourceRoot()) {
  const problems: string[] = []; const lines: string[] = [];
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return {code: 2, problems: ['directory missing'], lines: [`[ERROR] directory missing: ${root}`]};
  const read = (rel: string) => {let file = sourcePath(root, rel); if (!fs.existsSync(file) && rel.startsWith('output-styles/')) file = path.join(root, 'hosts/claude', rel); return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined;};
  const paths = ['output-styles/fluent-korean.md','output-styles/ATTRIBUTION.md','skills/humanize/references/ai-tell-taxonomy.md']; const [style, attrib, tax] = paths.map(read);
  for (let i = 0; i < paths.length; i++) if ([style, attrib, tax][i] === undefined) problems.push(`file missing: ${paths[i]}`);
  if (style === undefined || attrib === undefined || tax === undefined) return {code: 1, problems, lines: problems.map(p => `[FAIL] ${p}`)};
  if (read('output-styles/fluent-korean-not-coding.md') === undefined) problems.push('alternate prevention style missing');
  const ported = new Set([...tax.matchAll(/^###\s+([A-Z]-\d+)\..*fluent-korean\s*(?:이식|port)/gm)].map(m => m[1]!));
  const note = tax.split(/\r?\n/).find(line => line.startsWith('>') && line.includes('fluent-korean') && (line.includes('이식') || line.includes('ported'))) ?? '';
  const declared = new Set([...note.matchAll(/([A-Z]-\d+)\s*\(/g)].map(m => m[1]!));
  if (!ported.size) problems.push('No adapted rules discovered');
  for (const rule of declared) if (!ported.has(rule)) problems.push(`declared rule missing: ${rule}`);
  for (const rule of ported) if (!declared.has(rule)) problems.push(`adapted rule not declared: ${rule}`);
  const blocks: Record<string,string> = {}; for (const block of tax.split(/^###\s+/m).slice(1)) {const match = /^([A-Z]-\d+)\./.exec(block); if (match) blocks[match[1]!] = block;}
  for (const rule of ported) if (!blocks[rule]?.includes('snflkd/fluent-korean')) problems.push(`${rule}: upstream attribution missing`);
  const sections = styleSections(style); const references = new Set([...tax.matchAll(/output-style\s+([가-힣]+|sentence-level|phrase-level)-(\d+)/g)].map(m => JSON.stringify([m[1],m[2]])));
  for (const ref of references) {const [name, number] = JSON.parse(ref); if (sections[name] === undefined || Number(number) > sections[name]!) problems.push(`invalid section reference: ${name}-${number}`);}
  for (const match of attrib.matchAll(/`(skills\/[^`]+\.md)`/g)) if (!fs.existsSync(sourcePath(root, match[1]!))) problems.push(`ATTRIBUTION path missing: ${match[1]}`);
  if (!attrib.includes('MIT License') || !attrib.includes('WITHOUT WARRANTY')) problems.push('MIT license text missing');
  lines.push(...problems.map(p => `[FAIL] ${p}`), `Adapted rules: ${ported.size}; section references: ${references.size}; problems: ${problems.length}`);
  return {code: problems.length ? 1 : 0, problems, lines};
}
if (isMain(import.meta.url)) {const result = checkAttribution(process.argv[2] ? path.resolve(process.argv[2]) : undefined); console.log(result.lines.join('\n')); process.exitCode = result.code;}
