#!/usr/bin/env node
/** Invoke OfficeCLI only; never run its global agent-skill installer. */
import { runProcess } from '../../../../../runtime/os.js';
import { isMain } from '../../../../../runtime/entry.js';
export const PKG = '@officecli/officecli@latest';
export function main(): number {
  const installed = runProcess('officecli', ['--version'], { timeout: 30_000 });
  if (!installed.error && installed.status === 0 && installed.stdout.trim()) {
    console.log(`officecli: ${installed.stdout.split(/\r?\n/)[0]} (PATH)\n[0] 사용 가능`); return 0;
  }
  const version = runProcess('npx', ['--yes', PKG, '--version'], { timeout: 120_000 });
  if ((version.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
    console.log('[2] Node/npx unavailable: cannot invoke OfficeCLI\n    Install: https://nodejs.org or brew install node'); return 2;
  }
  if (version.error || version.status !== 0 || !version.stdout.trim()) {
    console.log(`[1] npx exists but could not fetch ${PKG}\n    Check network or registry access`); return 1;
  }
  console.log(`officecli: ${version.stdout.split(/\r?\n/)[0]} (npx)\n[0] 사용 가능`); return 0;
}
if (isMain(import.meta.url)) process.exitCode = main();
