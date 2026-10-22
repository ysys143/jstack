#!/usr/bin/env node
/** Research's self-contained path needs only Node; optional breadth is separate. */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runProcess } from '../../../../../runtime/os.js';
import { isMain } from '../../../../../runtime/entry.js';
export function main(): number {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const name of ['cite_check.js', 'coverage_matrix.js']) if (!existsSync(join(here, name))) { console.log(`[2] ${name} is absent: skill installation is broken`); return 2; }
  console.log('Self-contained checkers: cite_check.js / coverage_matrix.js available');
  const result = runProcess('hyperresearch', ['--version'], { timeout: 10_000 });
  if (!result.error && result.status === 0) {
    console.log(`hyperresearch: ${result.stdout.split(/\r?\n/)[0]}`);
    console.log('[0] Self-contained path and broad sweep both available'); return 0;
  }
  console.log('[1] Only self-contained path available: this is the normal default');
  console.log('\n    For a broad sweep of 55-80 sources:\n      uv tool install hyperresearch\n\n    Still run our own citation and requirements checks:\n    upstream cite-check checks only one of two pairs (references/cite-check.md).');
  return 1;
}
if (isMain(import.meta.url)) process.exitCode = main();
