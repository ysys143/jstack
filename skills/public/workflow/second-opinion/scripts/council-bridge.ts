#!/usr/bin/env node
import { isMain } from '../../../../../runtime/entry.js';
import { checkCli } from './check-cli.js';
import { executable, fileContext, parseOptions, runCommand, type CommandResult } from './bridge-common.js';
import { parseOutput } from './parse-output.js';
export async function main(argv = process.argv.slice(2)): Promise<number> {
  try {
    const args = parseOptions(argv, ['--prompt', '--mode', '--files', '--workdir', '--timeout', '--codex-model', '--agy-model'], { '--mode': 'research', '--workdir': process.cwd(), '--timeout': '180' });
    if (!args['--prompt']) throw new Error('ERROR: --prompt is required');
    const prefixes: Record<string, string> = { research: 'Answer the following question thoroughly and analytically:', review: 'Review the following code for bugs, edge cases, security issues, and potential improvements. Be specific with line references:', debug: 'Diagnose the following bug or issue. Identify the root cause, explain why it happens, and suggest a minimal fix:' };
    if (!prefixes[args['--mode']!]) throw new Error('--mode must be research, review, or debug');
    const agy = executable('agy'), codex = executable('codex');
    if (!agy && !codex) { console.error('ERROR: Neither agy nor Codex CLI is installed.'); checkCli('agy'); checkCli('codex'); return 1; }
    const prompt = `${prefixes[args['--mode']!]}\n\n${args['--prompt']}${fileContext(args['--files'])}`, timeout = Number(args['--timeout']);
    console.error('Council: querying available AIs in parallel...');
    const results = await Promise.all([
      agy ? Promise.resolve({ status: 126, stdout: '', stderr: 'agy read-only consultation is unsupported; no model was invoked', timedOut: false }) : null,
      codex ? runCommand('codex', ['exec', '--sandbox', 'read-only', '--skip-git-repo-check', '-C', args['--workdir']!, ...(args['--codex-model'] ? ['-m', args['--codex-model']] : []), '-'], { timeout, input: prompt + '\n' }) : null,
    ]);
    let failures = 0;
    const print = (name: string, result: CommandResult | null) => {
      const tag = name.toUpperCase(); process.stdout.write(`=== ${tag} RESPONSE ===\n`);
      if (!result) process.stdout.write(`[${name} CLI not installed - skipped]\n`);
      else if (result.status === 0 && result.stdout) process.stdout.write(parseOutput(result.stdout));
      else if (result.status === 124) { process.stdout.write(`[ERROR: ${name} timed out after ${args['--timeout']}s]\n`); failures++; }
      else { process.stdout.write(`[ERROR: ${name} failed with exit code ${result.status}]\n${result.stderr}`); failures++; }
      process.stdout.write(`=== END ${tag} ===\n`);
    };
    print('agy', results[0]!); process.stdout.write('\n'); print('Codex', results[1]!);
    const total = Number(Boolean(agy)) + Number(Boolean(codex)); console.error(`\nCouncil: ${total - failures}/${total} AIs responded successfully.`);
    // Preserve partial results, but zero successful reviewers is not success.
    return total > failures ? 0 : 1;
  } catch (error) { console.error((error as Error).message); return 1; }
}
if (isMain(import.meta.url)) main().then(code => { process.exitCode = code; });
