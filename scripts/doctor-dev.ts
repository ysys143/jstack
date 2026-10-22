import { isMain } from '../runtime/entry.js';
/** Read-only development inventory. Node replaces the former core Python requirement. */
import { runProcess } from '../runtime/os.js';
import { pathToFileURL } from 'node:url';
export interface ProbeResult { status: number | null; stdout: string; stderr?: string }
export type Runner = (command: string, args: string[]) => ProbeResult;
export const run: Runner = (command, args) => runProcess(command, args, { timeout: 15000 });
export function available(command: string, runner: Runner = run): boolean { return ['--version', '-version'].some(flag => runner(command, [flag]).status === 0); }
export function doctorDev(runner: Runner = run): { code: number; lines: string[] } {
  const lines: string[] = []; let blocked = 0; let partial = 0;
  for (const [command, guidance] of [['node', 'Install Node.js 20 or newer'], ['git', 'Install Git for your operating system']]) {
    if (!available(command!, runner)) { lines.push(`[2] ${command} missing — ${guidance}`); blocked++; }
    else if (command === 'node') { const version = runner('node', ['--version']).stdout.trim().match(/^v?(\d+)\./); if (!version || Number(version[1]) < 20) { lines.push('[2] Node 20 or newer is required'); blocked++; } }
  }
  for (const [command, impact] of [['rg', 'search becomes slower'], ['gh', '/pr falls back to browser instructions'], ['jq', 'JSON summaries fall back to raw output'], ['jst', 'the jstack CLI is not on PATH, so `jst disk` and `jst report` commands fail. Claude Code: enable jstack and restart the session; its SessionStart hook adds the plugin payload/bin directory to the Bash tool PATH unless hooks are off (disableAllHooks, or allowManagedHooksOnly in managed settings). Codex: trust the jstack SessionStart hook in /hooks and start a new session; it links ~/.local/bin/jst, which must be on PATH, unless JSTACK_NO_PATH_LINK=1. The CLI package from the release (npm install -g ./ysys143-jstack-<version>.tgz) works on any host whatever the hooks do. Do not route around it with node or a wrapper']]) {
    if (!available(command!, runner)) { lines.push(`[1] ${command} missing — ${impact}`); partial++; }
    else if (command === 'gh' && runner('gh', ['auth', 'status']).status !== 0) { lines.push('[1] gh unauthenticated — /pr falls back to browser instructions (auth: gh auth status)'); partial++; }
  }
  if (!blocked && !partial) lines.push('[0] all required and optional tools are available');
  return { code: blocked ? 2 : partial ? 1 : 0, lines };
}
if (isMain(import.meta.url)) { const result = doctorDev(); console.log(result.lines.join('\n')); process.exitCode = result.code; }
