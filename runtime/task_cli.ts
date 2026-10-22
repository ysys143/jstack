import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { context, capture, observe, assess, status, resume, selectTask } from './task_state.js';

const ACTIONS = ['capture', 'observe', 'assess', 'status', 'resume'];
const VALUE_OPTIONS = ['--input', '--workspace', '--home', '--session'];
const isHelp = (token: string | undefined) => token === '--help' || token === '-h';

// An installed package ships the protocol document beside this module; a source checkout does not.
const protocol = fileURLToPath(new URL('./TASKS.md', import.meta.url));

export const HELP = `Usage: jst task capture|observe|assess [--input FILE|-] [--workspace DIR] [--session ID]
       jst task run --help
       jst task status|resume [ID] [--workspace DIR] [--session ID] [--json]

Keep a request connected to its work and evidence.

capture, observe and assess record state from one JSON object read from stdin
or --input FILE (relative to the current directory). Every object has "id" (the
task) and "expectedRevision" (the revision you last read; 0 for a new task).
After a revision conflict, read the status again instead of resubmitting.
Paths inside the JSON (observation, artifacts) are relative to the directory
where the task was captured, not to the current directory.

  capture   Purpose, requirements, constraints and authorized actions:
            source {role:"user", message, quote}, purpose,
            authorized [operation] (observe start needs its operation here),
            requirements [{id, text, kind: code|research|document}] (add
            independent: true to require an independent review);
            optional constraints [text], removeConstraints [text],
            withdraw [id], budget {maxAttempts, seconds}.
  observe   An actual execution event of an attempt: attempt, event, and
            start: operation, handle, requirements [id], observation FILE,
                   optional pid
            partial: artifacts [FILE]
            heartbeat: observation FILE
            stop|end: reason, observation FILE, optional artifacts [FILE]
            external-invoked: key, observation FILE
            external-resolved: key, outcome present|absent, observation FILE
  assess    Evidence per requirement: evidence [{requirement,
            requirementRevision (its revision in status --json),
            method: review|workflow, result: pass|fail|unknown, rationale,
            observer, artifacts [FILE] (not empty), sources [URL],
            independence: self|reported-independent|unknown, attempt,
            observation FILE, workflow {cwd, task, requirement}}]
            attempt: the ended attempt; required once the requirement has an
              observed attempt
            sources: required for a research requirement
            method workflow with workflow {...}: required for a code requirement
            observation FILE: required for an independent requirement, which
              also needs independence reported-independent

  status    Show purpose, progress, unmet requirements and the next action.
  resume    Return a brief for continuing the task; it never starts work.
${existsSync(protocol) ? `\nProtocol and examples: ${protocol}\n` : ''}`;

// -h and --help count anywhere an option value does not consume them, so `--input -h` names a file.
function wantsHelp(argv: string[]): boolean {
  if (isHelp(argv[0])) return true;
  if (!ACTIONS.includes(argv[0] ?? '')) return false;
  for (let i = 1; i < argv.length; i++) {
    if (VALUE_OPTIONS.includes(argv[i]!)) i++;
    else if (isHelp(argv[i])) return true;
  }
  return false;
}

export async function main(argv: string[]): Promise<number> {
  if (argv[0] === 'run') return (await import('./sdlc_cli.js')).main(argv.slice(1));
  if (wantsHelp(argv)) { process.stdout.write(HELP); return 0; }
  try {
    const [action, ...rest] = argv;
    if (!action || !ACTIONS.includes(action)) throw new Error('Usage: jst task capture|observe|assess|status|resume [ID] [--input FILE|-] [--workspace DIR] [--session ID] [--json]');
    const options: Record<string, string> = {}; let id: string | undefined; let json = false;
    for (let i = 0; i < rest.length; i++) {
      const token = rest[i]!;
      if (token === '--json') { json = true; continue; }
      if (VALUE_OPTIONS.includes(token)) {
        const value = rest[++i]; if (!value || options[token]) throw new Error('Missing or duplicate option'); options[token] = value;
      } else if (!token.startsWith('-') && !id) id = token;
      else throw new Error(`Unexpected argument: ${token}`);
    }
    const c = context(options['--workspace'], options['--home'], options['--session']);
    let result: any;
    if (['capture', 'observe', 'assess'].includes(action)) {
      if (id) throw new Error('Mutation task ID belongs in the JSON input');
      const input = JSON.parse(readFileSync(!options['--input'] || options['--input'] === '-' ? 0 : options['--input'], 'utf8'));
      const t = action === 'capture' ? capture(c, input) : action === 'observe' ? observe(c, input) : assess(c, input);
      result = { id: t.id, revision: t.revision, recorded: action };
    } else {
      const t = selectTask(c, id); result = t.run ? (await import('./sdlc.js')).runStatus(c, t) : action === 'resume' ? resume(c, t) : status(c, t);
    }
    if (json || result.recorded) process.stdout.write(JSON.stringify(result) + '\n');
    else {
      const unmet = result.requirements.filter((r: any) => !['passed', 'withdrawn'].includes(r.state));
      const execution = result.attempts.length ? result.attempts.map((a: any) => `${a.id}:${a.state}`).join(', ') : 'not started';
      process.stdout.write(`${result.id} (revision ${result.revision}): ${result.disposition}${result.run ? `; run ${result.run.state}/${result.run.stage} (complete: ${result.runComplete})` : ''}\n${result.purpose}\nExecution: ${execution}\nUnmet: ${unmet.map((r: any) => `${r.id} (${r.reason})`).join(', ') || 'none'}\nNext: ${result.nextActions.join(', ') || 'none'}${result.budget ? '\nLimit: ' + result.budget : ''}\n`);
    }
    return action === 'resume' && !result.canResume ? 1 : 0;
  } catch (error) { process.stderr.write(JSON.stringify({ error: (error as Error).message }) + '\n'); return 2; }
}
