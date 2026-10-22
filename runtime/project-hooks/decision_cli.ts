/** User-invoked project-check decision command. Hooks cannot record a choice. */
import { isMain } from '../entry.js';
import { readState, recordDecision, reopenDecision, resolveStateLocation, type Choice, type Host } from './state.js';
import { recommendProjectChecks } from './recommend.js';

export const HELP = `Usage: jst project-hooks status [--cwd DIR]
       jst project-hooks recommend [--path RELATIVE_FILE ...] [--cwd DIR]
       jst project-hooks choose configured|without-setup --message-ref REF [--cwd DIR] [--host claude|codex]
       jst project-hooks reopen --message-ref REF [--cwd DIR] [--host claude|codex]

Only use choose or reopen for an actual user-invoked command or an explicit user answer.
REF identifies that invocation or answer; it is not inferred from project files.
The command records a decision in the worktree Git directory or user-local state cache.
It never creates a repository .jstack/ directory, installs tools, or changes hook trust.
`;

export interface ParsedArguments { action: 'status' | 'recommend' | 'choose' | 'reopen'; choice?: Choice; cwd: string; host: Host; messageRef?: string; paths: string[]; }
export function parseArguments(argv: readonly string[], currentCwd = process.cwd()): ParsedArguments {
  const [action, ...rest] = argv;
  if (action !== 'status' && action !== 'recommend' && action !== 'choose' && action !== 'reopen') throw new Error('expected status, recommend, choose, or reopen');
  let choice: Choice | undefined;
  if (action === 'choose') {
    const value = rest.shift();
    if (value !== 'configured' && value !== 'without-setup') throw new Error('choose requires configured or without-setup');
    choice = value;
  }
  const values = new Map<string, string>();
  const paths: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i]!;
    if (flag === '--path' && action === 'recommend' && rest[i + 1] && !rest[i + 1]!.startsWith('--')) { paths.push(rest[++i]!); continue; }
    if (!['--cwd', '--host', '--message-ref'].includes(flag) || values.has(flag) || !rest[i + 1] || rest[i + 1]!.startsWith('--'))
      throw new Error(`invalid or repeated option: ${flag}`);
    values.set(flag, rest[++i]!);
  }
  if ((action === 'status' || action === 'recommend') && (values.has('--message-ref') || values.has('--host'))) throw new Error('status and recommend take only --cwd and recommend --path');
  if ((action === 'choose' || action === 'reopen') && !values.get('--message-ref')?.trim()) throw new Error('choose and reopen need --message-ref from the actual user invocation or answer');
  const host = values.get('--host') ?? 'unknown';
  if (!['claude', 'codex', 'unknown'].includes(host)) throw new Error('host must be claude or codex');
  return { action, ...(choice ? { choice } : {}), cwd: values.get('--cwd') ?? currentCwd, host: host as Host, messageRef: values.get('--message-ref'), paths };
}

export function run(argv: readonly string[], env: NodeJS.ProcessEnv = process.env, currentCwd = process.cwd()): unknown {
  const args = parseArguments(argv, currentCwd);
  if (args.action === 'recommend') throw new Error('recommend is asynchronous; use the CLI entrypoint');
  const location = resolveStateLocation(args.cwd);
  const before = readState(location);
  if (args.action === 'status') return { location: location.kind, file: location.file, status: before.status, decision: before.state.decision, explanation: before.explanation, diagnostic: before.state.diagnostic };
  const expectedRevision = before.status === 'ok' ? before.state.revision : 0;
  if (args.action === 'choose') {
    const state = recordDecision(location, { approval: {
      provenance: 'explicit-command', choice: args.choice!, host: args.host,
      recordedAt: new Date().toISOString(), messageRef: args.messageRef!,
    }, expectedRevision }, env);
    return { location: location.kind, file: location.file, decision: state.decision, revision: state.revision };
  }
  const state = reopenDecision(location, { provenance: 'explicit-command', host: args.host, messageRef: args.messageRef!, expectedRevision }, env);
  return { location: location.kind, file: location.file, decision: state.decision, revision: state.revision };
}

export async function main(argv = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env): Promise<number> {
  if (argv[0] === '--help' || argv[0] === '-h') { process.stdout.write(HELP); return 0; }
  try {
    const args = parseArguments(argv);
    const result = args.action === 'recommend' ? await recommendProjectChecks(args.cwd, args.paths, { env }) : run(argv, env);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); return 0;
  }
  catch (error) { process.stderr.write(`${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n`); return 2; }
}
if (isMain(import.meta.url)) main().then(code => { process.exitCode = code; });
