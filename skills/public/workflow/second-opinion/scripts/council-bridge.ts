#!/usr/bin/env node
import { isMain } from '../../../../../runtime/entry.js';
import { checkCli } from './check-cli.js';
import { executable, fileContext, parseOptions, runCommand } from './bridge-common.js';
import { parseOutput } from './parse-output.js';
export async function main(argv = process.argv.slice(2)): Promise<number> {
  try {
    const args = parseOptions(argv, ['--prompt', '--mode', '--files', '--workdir', '--timeout', '--codex-model'], { '--mode': 'research', '--workdir': process.cwd(), '--timeout': '180' });
    if (!args['--prompt']) throw new Error('ERROR: --prompt is required');
    const prefixes: Record<string, string> = { research: 'Answer the following question thoroughly and analytically:', review: 'Review the following code for bugs, edge cases, security issues, and potential improvements. Be specific with line references:', debug: 'Diagnose the following bug or issue. Identify the root cause, explain why it happens, and suggest a minimal fix:' };
    if (!prefixes[args['--mode']!]) throw new Error('--mode must be research, review, or debug');
    if (!executable('codex')) { console.error('ERROR: Codex CLI is not installed.'); checkCli('codex'); return 1; }
    const prompt = `${prefixes[args['--mode']!]}\n\n${args['--prompt']}${fileContext(args['--files'])}`, timeout = Number(args['--timeout']);
    console.error('Council: querying the Codex participant...');
    const result = await runCommand('codex', ['exec', '--sandbox', 'read-only', '--skip-git-repo-check', '-C', args['--workdir']!, ...(args['--codex-model'] ? ['-m', args['--codex-model']] : []), '-'], { timeout, input: prompt + '\n' });
    let failures = 0;
    process.stdout.write('=== CODEX RESPONSE ===\n');
    if (result.status === 0 && result.stdout) process.stdout.write(parseOutput(result.stdout) + '\n');
    else if (result.status === 124) { process.stdout.write(`[ERROR: Codex timed out after ${args['--timeout']}s]\n`); failures++; }
    else { process.stdout.write(`[ERROR: Codex failed with exit code ${result.status}]\n${result.stderr}`); failures++; }
    process.stdout.write('=== END CODEX ===\n');
    console.error(`\nCouncil: ${1 - failures}/1 AIs responded successfully.`);
    // Zero successful reviewers is not success.
    return failures ? 1 : 0;
  } catch (error) { console.error((error as Error).message); return 1; }
}
if (isMain(import.meta.url)) main().then(code => { process.exitCode = code; });
