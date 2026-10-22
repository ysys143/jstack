import { isMain } from './entry.js';
import { readFileSync } from 'node:fs';
import { load } from './task_state.js';
import { startRun, selectRun, runEvent, runStatus, runContext, leafContext } from './sdlc.js';
export const HELP = `Usage: jst task run start|select|event --input FILE|- --session SESSION [--workspace DIR] [--home DIR]
       jst task run status|resume|context TASK [--workspace DIR] [--home DIR] [--session SESSION]
Explicit sdlc selection only. status/resume never execute work. See contracts/sdlc.md for event schemas.
`;
export async function main(argv: string[]): Promise<number> {
  try {
    if (['--help', '-h'].includes(argv[0])) { console.log(HELP); return 0; }
    const [action, ...rest] = argv;
    if (!['start', 'select', 'event', 'status', 'resume', 'context'].includes(action)) throw new Error(HELP);
    const opts: Record<string, string> = {}; let id: string | undefined;
    for (let i = 0; i < rest.length; i++) {
      const flag = rest[i]; if (flag === '--json') continue;
      if (['--workspace', '--home', '--session', '--input'].includes(flag)) { const value = rest[++i]; if (!value || opts[flag]) throw new Error('Missing or duplicate option'); opts[flag] = value; }
      else if (!flag.startsWith('-') && !id) id = flag; else throw new Error('Unexpected argument');
    }
    const c = runContext(opts['--workspace'] ?? process.cwd(), opts['--home'], opts['--session']);
    if (['status', 'resume', 'context'].includes(action)) {
      if (!id) throw new Error('Explicit task ID required'); const t = load(c, id); if (!t.run) throw new Error('No selected run');
      const result = action === 'context' ? leafContext(t) : runStatus(c, t); console.log(JSON.stringify(result)); return action === 'resume' && !(result as any).canResume ? 1 : 0;
    }
    if (id) throw new Error('Mutation ID belongs in JSON');
    const input = JSON.parse(readFileSync(!opts['--input'] || opts['--input'] === '-' ? 0 : opts['--input'], 'utf8'));
    const t = action === 'start' ? startRun(c, input) : action === 'select' ? selectRun(c, input) : await runEvent(c, input);
    console.log(JSON.stringify({ id: t.id, revision: t.revision, run: t.run!.id, stage: t.run!.stage, state: t.run!.state })); return 0;
  } catch (error) { console.error(JSON.stringify({ error: (error as Error).message })); return 2; }
}

if (isMain(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
