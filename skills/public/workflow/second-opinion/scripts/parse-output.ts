#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { isMain } from '../../../../../runtime/entry.js';
export const stripAnsi = (text: string) => text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\([0-9;]*[a-zA-Z]/g, '');
export function parseOutput(input: string, format = 'text'): string {
  // Shell command substitution removed terminal newlines before parsing.
  const text = input.replace(/\n+$/g, '');
  if (format === 'text') return stripAnsi(text).split('\n').map(line => line.trim()).join('\n');
  if (format !== 'json-extract') return text;
  try {
    const data: unknown = JSON.parse(text);
    if (data && typeof data === 'object' && !Array.isArray(data)) for (const key of ['result', 'response', 'output', 'content', 'text', 'message']) {
      const value = (data as Record<string, unknown>)[key];
      if (typeof value === 'string') return value + '\n';
      if (Array.isArray(value)) return value.flatMap(item => typeof item === 'string' ? [item] : item && typeof item === 'object' && 'text' in item ? [String(item.text)] : []).map(item => item + '\n').join('');
    }
    if (data === null || (typeof data !== 'object' && typeof data !== 'string')) return stripAnsi(text);
    return JSON.stringify(data, null, 2) + '\n';
  } catch { return stripAnsi(text); }
}
export function main(argv = process.argv.slice(2)): number { process.stdout.write(parseOutput(readFileSync(0, 'utf8'), argv[0] ?? 'text')); return 0; }
if (isMain(import.meta.url)) process.exitCode = main();
