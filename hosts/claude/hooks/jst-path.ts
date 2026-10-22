/**
 * Claude Code SessionStart hook: put the plugin's payload/bin, which holds the `jstack`
 * launcher, on the Bash tool's PATH for this session. claude.ai and Cowork refuse a
 * plugin with a top-level bin/, so the launcher is not where Claude Code would add it.
 * The hook appends one export to CLAUDE_ENV_FILE, after the user's own PATH entries,
 * so a `jstack` the user installed (the npm CLI package) still wins. It writes nothing
 * else, prints nothing, and exits 0 on every error. Codex also reads hooks.json but
 * sets no CLAUDE_ENV_FILE, so there it does nothing.
 */
import { accessSync, appendFileSync, constants, existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isMain } from '../../../runtime/entry.js';

export type PathState = 'appended' | 'present' | 'skipped' | 'failed';

/** A directory as Git Bash spells it on Windows (cygpath -u), long-path prefixes removed; unchanged elsewhere. */
export function shellPath(directory: string, platform: NodeJS.Platform = process.platform): string {
  if (platform !== 'win32') return directory;
  let value = directory;
  if (value.startsWith('\\\\?\\UNC\\')) value = `\\\\${value.slice(8)}`;
  else if (value.startsWith('\\\\?\\')) value = value.slice(4);
  const drive = /^([A-Za-z]):[\\/]*(.*)$/.exec(value);
  return drive ? `/${drive[1]!.toLowerCase()}/${drive[2]!.replaceAll('\\', '/')}` : value.replaceAll('\\', '/');
}

/** The one line this hook writes: the directory goes last, in single quotes. */
export function exportLine(directory: string): string {
  return `export PATH="$PATH":'${directory.replaceAll("'", `'\\''`)}'`;
}

export interface PathInput { envFile?: string; pluginRoot?: string; env: Record<string, string | undefined>; platform?: NodeJS.Platform; warn?: (line: string) => void }

export function persistPath(input: PathInput): PathState {
  if (!input.envFile || !input.pluginRoot || /^(1|true|yes|on)$/i.test((input.env.JSTACK_NO_PATH_LINK ?? '').trim())) return 'skipped';
  const bin = join(input.pluginRoot, 'payload', 'bin'), launcher = join(bin, 'jst');
  try {
    try { accessSync(launcher, constants.X_OK); if (!statSync(launcher).isFile()) return 'skipped'; } catch { return 'skipped'; }
    // A line break would split the export and a colon would split PATH itself.
    const directory = shellPath(bin, input.platform);
    if (/[\n\r:]/.test(directory)) return 'skipped';
    const line = exportLine(directory);
    if (existsSync(input.envFile) && readFileSync(input.envFile, 'utf8').split(/\r?\n/).includes(line)) return 'present';
    // Other SessionStart hooks may append at the same time: never depend on how the file ends.
    appendFileSync(input.envFile, `\n${line}\n`);
    return 'appended';
  } catch (error) {
    // stderr of a SessionStart hook that exits 0 is informational and not added to Claude's context.
    (input.warn ?? (text => process.stderr.write(text)))(`jstack: could not add ${bin} to PATH through CLAUDE_ENV_FILE (${(error as NodeJS.ErrnoException).code ?? 'error'}).\n`);
    return 'failed';
  }
}

/** Hook entry: nothing on stdout, and status 0 whatever happens. */
export function main(env: NodeJS.ProcessEnv = process.env): number {
  try { persistPath({ envFile: env.CLAUDE_ENV_FILE, pluginRoot: env.CLAUDE_PLUGIN_ROOT, env }); }
  catch { /* A hook that cannot decide steps aside. */ }
  return 0;
}
if (isMain(import.meta.url)) process.exitCode = main();
