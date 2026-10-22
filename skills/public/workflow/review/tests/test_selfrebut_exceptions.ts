/** Fail closed when any of the eight item-level self-rebuttal exceptions disappears. */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from '../../../../../runtime/entry.js';
const ROOT = dirname(dirname(fileURLToPath(import.meta.url))), DOC = join(ROOT, 'references/security-exceptions.md');
const EXPECTED = 8, UPSTREAM = 5, LOCAL = 3, MIN_VERDICT_BYTES = 24;
function fail(message: string): number { console.log('[FAIL] ' + message); return 1; }
export function main(): number {
  if (!existsSync(DOC)) return fail('exception list missing: ' + relative(ROOT, DOC));
  const text = readFileSync(DOC, 'utf8'), heads = [...text.matchAll(/^### (E-(\d+))\.\s*(.+)$/gm)], ids = heads.map(match => match[1]);
  if (heads.length !== EXPECTED) return fail(`found ${heads.length} exception entries (expected ${EXPECTED}) — ${JSON.stringify(ids)}`);
  if (ids.some((id, i) => id !== `E-${i + 1}`)) return fail(`entry IDs are not contiguous E-1..E-${EXPECTED} — ${JSON.stringify(ids)}`);
  const problems: string[] = [], rows: string[][] = []; let up = 0, loc = 0;
  for (const [i, heading] of heads.entries()) {
    const block = text.slice(heading.index, heads[i + 1]?.index ?? text.length), eid = heading[1], title = heading[3].trim();
    const verdict = /^\*\*Decider\*\*\s*—\s*(.+)$/m.exec(block);
    if (!verdict) { problems.push(`${eid} has no decider sentence`); continue; }
    const bytes = Buffer.byteLength(verdict[1].trim());
    if (bytes < MIN_VERDICT_BYTES) { problems.push(`${eid} decider is ${bytes}B, too short for a sentence`); continue; }
    const source = /^Source:\s*(upstream|local context)\s*$/m.exec(block);
    if (!source) { problems.push(`${eid} has no source marker (upstream / local context)`); continue; }
    if (source[1] === 'upstream') up++; else loc++;
    rows.push([eid, title, source[1]]); console.log(`[OK] ${eid} ${title} — source ${source[1]} · decider present`);
  }
  if (problems.length) { for (const problem of problems) console.log('[FAIL] ' + problem); return 1; }
  if (up !== UPSTREAM || loc !== LOCAL) return fail(`provenance is upstream ${up} · local ${loc}; expected ${UPSTREAM}/${LOCAL}`);
  if (rows.length !== EXPECTED) return fail(`loaded ${rows.length} entries; expected ${EXPECTED}`);
  console.log(`confirmed ${rows.length} loaded exceptions (upstream ${up} · local ${loc})`); console.log(`${rows.length}/${EXPECTED} 통과`); return 0;
}
if (isMain(import.meta.url)) process.exitCode = main();
