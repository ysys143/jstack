#!/usr/bin/env node
/** Explicit decision-boundary recorder for optional Jev shadow comparisons. */
import { isMain } from './entry.js';
import { compareShadow, jevSettings, questionFor, validateJevState, type ShadowOptions, type TaskSizeState } from './jev.js';

export const HELP = `Usage: jst jev task-size --decision local|single|parallel
  --work-type coding|research|document|daily --impact low|high
  --constraints simple|complex --changed-files COUNT --independent-parts COUNT
  --delegation-allowed true|false [--workspace DIR]

Record the decision already made at a task-splitting boundary. This command
does not choose a team, authorize delegation, or send prompt or file contents.
It sends nothing unless TYPESAFE_API_KEY and JSTACK_JEV=task-size are both set.
Even then, Jev is shadow-only and the supplied decision always wins.
`;

export interface TaskSizeInput { decision: 'local' | 'single' | 'parallel'; workspace: string; state: TaskSizeState; }
const flags = ['--decision', '--work-type', '--impact', '--constraints', '--changed-files', '--independent-parts', '--delegation-allowed', '--workspace'];
function count(value: string | undefined, flag: string): number {
  if (value === undefined || !/^(?:0|[1-9][0-9]*)$/.test(value)) throw new Error(`${flag} must be a nonnegative integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > 2000000) throw new Error(`${flag} is out of range`);
  return parsed;
}
export function parseTaskSize(argv: readonly string[], cwd = process.cwd()): TaskSizeInput {
  if (argv[0] !== 'task-size') throw new Error('expected jev task-size');
  const values = new Map<string, string>();
  for (let i = 1; i < argv.length; i++) {
    const flag = argv[i]!, value = argv[i + 1];
    if (!flags.includes(flag) || values.has(flag) || !value || value.startsWith('--')) throw new Error(`invalid or repeated option: ${flag}`);
    values.set(flag, value); i++;
  }
  const decision = values.get('--decision');
  if (decision !== 'local' && decision !== 'single' && decision !== 'parallel') throw new Error('--decision must be local, single, or parallel');
  const workType = values.get('--work-type');
  if (workType !== 'coding' && workType !== 'research' && workType !== 'document' && workType !== 'daily') throw new Error('invalid --work-type');
  const impact = values.get('--impact');
  if (impact !== 'low' && impact !== 'high') throw new Error('invalid --impact');
  const constraints = values.get('--constraints');
  if (constraints !== 'simple' && constraints !== 'complex') throw new Error('invalid --constraints');
  const delegation = values.get('--delegation-allowed');
  if (delegation !== 'true' && delegation !== 'false') throw new Error('--delegation-allowed must be true or false');
  const state: TaskSizeState = { point: 'task-size', workType, impact, constraints,
    changedFileCount: count(values.get('--changed-files'), '--changed-files'),
    independentPartCount: count(values.get('--independent-parts'), '--independent-parts'),
    delegationAllowed: delegation === 'true' };
  validateJevState(state);
  if (!Object.hasOwn(questionFor(state).criteria, decision)) throw new Error('the decision is outside the authorized execution choices');
  return { decision, workspace: values.get('--workspace') ?? cwd, state };
}
export async function compareTaskSize(input: TaskSizeInput, options: Partial<ShadowOptions> = {}) {
  jevSettings(options.env);
  if (Object.keys(questionFor(input.state).criteria).length <= 1) return { answer: input.decision, source: 'twin' as const, mode: 'off' as const };
  return compareShadow(input.state, input.decision, { ...options, workspace: input.workspace });
}
export async function main(argv = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env): Promise<number> {
  if (argv[0] === '--help' || argv[0] === '-h' || !argv.length || (argv[0] === 'task-size' && (argv[1] === '--help' || argv[1] === '-h') && argv.length === 2)) {
    process.stdout.write(HELP); return 0;
  }
  try {
    const input = parseTaskSize(argv);
    const result = await compareTaskSize(input, { env });
    process.stdout.write(JSON.stringify({ decision: result.answer, jevMode: result.mode, ...(result.jev ? { jevSuggestion: result.jev } : {}),
      ...(result.reason ? { reason: result.reason } : {}) }) + '\n');
    return 0;
  } catch (error) {
    process.stderr.write(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }) + '\n');
    return 2;
  }
}
if (isMain(import.meta.url)) main().then(code => { process.exitCode = code; });
