#!/usr/bin/env node
/** Preserve the OOXML East Asian font assignment checker without Python. */
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { isMain } from '../../../../../runtime/entry.js';

export function inspect(bytes: Uint8Array, requireFont?: string): { code: number; lines: string[] } {
  let total = 0;
  const files = unzipSync(bytes, { filter: entry => {
    const included = entry.name.endsWith('.xml') && /^(?:ppt\/slides\/|word\/|xl\/)/.test(entry.name);
    if (included) { total += entry.originalSize; if (total > 128 * 1024 * 1024) throw new Error('OOXML XML exceeds the 128 MiB inspection limit'); }
    return included;
  } });
  const hangul: string[] = [], fonts = new Set<string>();
  for (const [name, data] of Object.entries(files)) {
    const xml = Buffer.from(data).toString('utf8');
    const texts = [...xml.matchAll(/<a:t>(.*?)<\/a:t>/gs), ...xml.matchAll(/<w:t[^>]*>(.*?)<\/w:t>/gs)].map(match => match[1]);
    if (texts.some(text => /[가-힣]/.test(text))) hangul.push(name);
    for (const match of [...xml.matchAll(/<a:ea[^>]*typeface="([^"]*)"/g), ...xml.matchAll(/w:eastAsia="([^"]*)"/g)]) if (match[1]) fonts.add(match[1]);
  }
  if (!hangul.length) return { code: 0, lines: ['No Korean text: CJK font contract does not apply'] };
  const lines = [`Parts containing Korean: ${hangul.length}: ${hangul.slice(0, 3).join(', ')}${hangul.length > 3 ? ' …' : ''}`];
  if (!fonts.size) return { code: 1, lines: [...lines, '[FAIL] East Asian font assignments (<a:ea> / w:eastAsia): 0', '       Korean uses viewer fallback fonts and differs across machines', '       Fix: officecli set <file> "<path>" --prop font.ea="Pretendard"'] };
  lines.push(`Assigned East Asian fonts: ${[...fonts].sort((a, b) => { const left = [...a], right = [...b]; for (let i = 0; i < Math.min(left.length, right.length); i++) { const delta = left[i].codePointAt(0)! - right[i].codePointAt(0)!; if (delta) return delta; } return left.length - right.length; }).join(', ')}`);
  if (requireFont) {
    if (![...fonts].some(font => font.toLowerCase().includes(requireFont.toLowerCase()))) return { code: 1, lines: [...lines, `[FAIL] Required font '${requireFont}' is absent`] };
    lines.push(`[OK] Required font '${requireFont}' confirmed`);
  }
  return { code: 0, lines };
}
export function main(argv = process.argv.slice(2)): number {
  if (argv.includes('--help') || argv.includes('-h')) { console.log('check_cjk_font.js FILE [--require-font NAME]'); return 0; }
  if (argv.length !== 1 && !(argv.length === 3 && argv[1] === '--require-font')) { console.error('Expected FILE [--require-font NAME]'); return 2; }
  try { const result = inspect(readFileSync(argv[0]), argv[2]); result.lines.forEach(line => console.log(line)); return result.code; }
  catch (error) { console.error(`[ERROR] Cannot open: ${(error as Error).message}`); return 2; }
}
if (isMain(import.meta.url)) process.exitCode = main();
