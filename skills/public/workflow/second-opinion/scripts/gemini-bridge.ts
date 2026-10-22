#!/usr/bin/env node
import { isMain } from '../../../../../runtime/entry.js';
import { checkCli } from './check-cli.js';
import { parseOptions } from './bridge-common.js';
export async function main(argv = process.argv.slice(2)): Promise<number> {
  try {
    const args = parseOptions(argv, ['--task', '--prompt', '--files', '--output-format', '--timeout', '--model'], { '--timeout': '120', '--output-format': 'text' });
    if (!args['--prompt']) throw new Error('ERROR: --prompt is required');
    if (!['text', 'json'].includes(args['--output-format']!)) throw new Error('--output-format must be text or json');
    if (checkCli('agy')) return 1;
    // No reviewed agy adapter currently enforces the read-only consultation contract.
    // CLI presence and help text alone do not establish permission isolation.
    throw new Error('ERROR: agy is installed but read-only consultation is unsupported; use an authorized native reviewer or Codex read-only consultation. No model was invoked.');
  } catch (error) { console.error((error as Error).message); return 1; }
}
if (isMain(import.meta.url)) main().then(code => { process.exitCode = code; });
