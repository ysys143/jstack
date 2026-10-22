#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isMain } from '../../../../runtime/entry.js';
import { executable, fileContext, parseOptions, runCommand } from '../../../public/workflow/second-opinion/scripts/bridge-common.js';
import { stripAnsi } from '../../../public/workflow/second-opinion/scripts/parse-output.js';
export function codexProbe(): number {
  if (!executable('codex')) { console.error('ERROR: codex CLI was not found.\n  Install: npm install -g @openai/codex   # or: brew install codex (macOS)\n  Documentation: https://github.com/openai/codex'); return 2; }
  if (!process.env.OPENAI_API_KEY && !existsSync(join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'auth.json'))) { console.error('WARNING: codex CLI is installed but unauthenticated; execution cannot be delegated.\n  Authenticate: export OPENAI_API_KEY="..."   or: codex login'); return 1; }
  return 0;
}
export async function main(argv = process.argv.slice(2)): Promise<number> {
  try {
    const args = parseOptions(argv, ['--prompt', '--sandbox', '--workdir', '--model', '--files', '--timeout'], { '--workdir': process.cwd(), '--timeout': '300', '--sandbox': 'read-only' });
    if (!args['--prompt']) throw new Error('ERROR: --prompt is required');
    if (!['read-only', 'workspace-write', 'danger-full-access'].includes(args['--sandbox']!)) throw new Error('--sandbox must be read-only, workspace-write, or danger-full-access');
    if (codexProbe()) return 1;
    const prompt = args['--prompt'] + fileContext(args['--files']);
    const cliArgs = ['exec', '-s', args['--sandbox']!, '--skip-git-repo-check', '-C', args['--workdir']!, ...(args['--model'] ? ['-m', args['--model']] : []), '-'];
    const result = await runCommand('codex', cliArgs, { timeout: Number(args['--timeout']), input: prompt + '\n' });
    if (result.status === 124) throw new Error(`ERROR: Codex CLI timed out after ${args['--timeout']}s`);
    if (result.status !== 0) { process.stderr.write(`ERROR: Codex CLI exited with code ${result.status}\n${result.stderr}`); return 1; }
    if (!result.stdout) throw new Error('ERROR: Codex returned empty output');
    // Unlike parse-output, the direct Codex bridge preserves its final newline.
    process.stdout.write(stripAnsi(result.stdout).split('\n').map(line => line.trim()).join('\n')); return 0;
  } catch (error) { console.error((error as Error).message); return 1; }
}
if (isMain(import.meta.url)) main().then(code => { process.exitCode = code; });
