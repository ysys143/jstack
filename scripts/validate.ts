#!/usr/bin/env node
/** Validate deliverables by format; missing optional checkers return status 2. */
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { sourceRoot } from './doctor-work.js';
import { runProcess } from '../runtime/os.js';
import { specialistStatus } from '../runtime/specialists.js';
import { isMain } from '../runtime/entry.js';
export function main(argv = process.argv.slice(2), root = sourceRoot()): number {
  let req: string | undefined; const files: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--help' || argv[i] === '-h') { console.log('validate.js [--req requirements.txt] FILE...'); return 0; }
    if (argv[i] === '--req') { req = argv[++i]; if (!req) throw new Error('--req requires a file'); }
    else if (argv[i].startsWith('-')) throw new Error(`Unknown option: ${argv[i]}`); else files.push(argv[i]);
  }
  if (!files.length) { console.error('[STOP] no files were provided for validation'); return 2; }
  let failed = false, skipped = false;
  const run = (label: string, command: string, args: string[]) => {
    const result = runProcess(command, args, { maxBuffer: 8 * 1024 * 1024 });
    console.log(`  [${result.status === 0 ? 'PASS' : 'FAIL'}] ${label}`);
    if (result.status !== 0) { failed = true; console.log((result.stdout + result.stderr).split('\n').slice(0,12).map(line => '         ' + line).join('\n')); }
  };
  const node = (label: string, script: string, args: string[]) => run(label, process.execPath, [join(root, script), ...args]);
  for (const file of files) {
    if (!existsSync(file) || !statSync(file).isFile()) { console.error(`[STOP] file is missing: ${file}`); skipped = true; continue; }
    console.log(`== ${file}`);
    if (/\.hwpx$/.test(file)) {
      try {
        const status = specialistStatus('hwpx', { root });
        if (status.state !== 'ready') { console.log('  [SKIP] hwpx environment is unavailable — run jst optional setup hwpx'); skipped = true; }
        else run('hwpx structural and semantic validation', status.python, [join(root, 'skills/hwpx/scripts/validate_hwpx.py'), file, '--semantic']);
      } catch (error) { console.log(`  [SKIP] ${String(error)}`); skipped = true; }
    } else if (/\.(svg|html)$/.test(file)) node('diagram geometry validation', 'skills/diagram/scripts/verify-geometry.js', [file]);
    else if (/\.(docx|pptx|xlsx)$/.test(file)) node('East Asian font contract', 'skills/office/scripts/check_cjk_font.js', [file]);
    else if (/\.md$/.test(file)) {
      node('citation integrity (all pairs)', 'skills/research/scripts/cite_check.js', [file]);
      if (req) node('requirements mapping', 'skills/research/scripts/coverage_matrix.js', ['--req', req, '--report', file]);
    } else if (/\.txt$/.test(file)) node('character and byte measurement', 'skills/proof/scripts/korean_character_count.js', ['--file', file, '--format', 'text']);
    else { console.log('  [SKIP] no checker exists for this format'); skipped = true; }
    console.log('');
  }
  return failed ? 1 : skipped ? 2 : 0;
}
if (isMain(import.meta.url)) { try { process.exitCode = main(); } catch (error) { console.error(String(error)); process.exitCode = 2; } }
