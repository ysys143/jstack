#!/usr/bin/env node
import { readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { isMain } from '../../../../../runtime/entry.js';
import { executable, runCommand } from '../../../workflow/second-opinion/scripts/bridge-common.js';
import { children, directory } from './collection-common.js';
export async function main(): Promise<number> {
  if (!executable('gws')) { console.log('gws: missing\n  Install: brew install googleworkspace-cli\n  Note: `brew install gws` is a **different same-name tool** (git workspace)\n[2] installation required'); return 2; }
  const version = await runCommand('gws', ['--version'], { timeout: 10 }), help = await runCommand('gws', ['--help'], { timeout: 10 });
  const label = version.stdout.split('\n')[0] || 'unknown';
  if (version.status !== 0 || help.status !== 0) { console.log(`gws: ${label}\n[2] executable failed; inspect runtime dependencies before authenticating`); return 2; }
  if (!/auth/i.test(help.stdout + help.stderr)) { console.log(`gws: ${label}\n  This gws has no auth subcommand — likely a **different same-name tool**\n  Check: gws --help | head -20\n  Replace: brew uninstall gws && brew install googleworkspace-cli\n[2] wrong tool`); return 2; }
  console.log(`gws: ${version.stdout.split('\n')[0] || 'installed'}`);
  const base = join(homedir(), '.config'), found = directory(base) ? children(base).filter(path => basename(path).startsWith('gws-') && readdirSync(path).some(name => /client_secret|token|credential/i.test(name))).map(path => basename(path)) : [];
  if (!found.length) { console.log('Account settings: missing\n  client_secret.json is required under ~/.config/gws-{account}/\n  Guide: /setup authentication\n[1] authentication required'); return 1; }
  console.log(`Account settings: ${found.join(', ')}\n  Always set GOOGLE_WORKSPACE_CLI_CONFIG_DIR when running\n[0] available`); return 0;
}
if (isMain(import.meta.url)) main().then(code => { process.exitCode = code; }).catch(error => { console.error((error as Error).message); process.exitCode = 2; });
