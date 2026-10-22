import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';

export type Host = 'claude' | 'codex';
export interface CommandResult { status: number; stdout: string; stderr: string }
export type Runner = (host: Host, args: string[], env: NodeJS.ProcessEnv, cwd?: string) => CommandResult;
export interface HostOptions { home?: string; hosts?: Host[]; runner?: Runner; hostStopped?: (host: Host) => boolean }
export interface PluginRow { id: string; name: string; version?: string; enabled: boolean; scope?: string; path?: string }
export const MARKETPLACE = 'jstack';
export const CODEX_ID = `jstack@${MARKETPLACE}`;
export const CLAUDE_ID = `jstack@${MARKETPLACE}`;

function executable(host: Host, env: NodeJS.ProcessEnv): { file: string; prefix: string[] } {
  if (process.platform !== 'win32') return { file: host, prefix: [] };
  const pathValue = Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1] ?? '';
  for (const directory of pathValue.split(delimiter).filter(Boolean)) {
    for (const extension of ['.exe', '.com']) {
      const file = join(directory, `${host}${extension}`);
      if (existsSync(file)) return { file, prefix: [] };
    }
    if (existsSync(join(directory, `${host}.cmd`))) {
      // npm's Windows wrappers require cmd.exe. Resolve the known JS entrypoint
      // instead, so paths and arguments never pass through a command shell.
      const entry = host === 'codex' ? '@openai/codex/bin/codex.js' : '@anthropic-ai/claude-code/cli.js';
      for (const base of [join(directory, 'node_modules'), dirname(directory)]) {
        const script = join(base, entry);
        if (existsSync(script)) return { file: process.execPath, prefix: [script] };
      }
      throw new Error(`Cannot safely resolve ${host}.cmd. Install the native CLI or an official npm package.`);
    }
  }
  return { file: host, prefix: [] };
}

export const defaultRunner: Runner = (host, args, env, cwd) => {
  const selected = executable(host, env);
  const result = spawnSync(selected.file, [...selected.prefix, ...args], { env, cwd, encoding: 'utf8', timeout: 60_000, windowsHide: true, shell: false });
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.error?.message ?? result.stderr ?? '' };
};

export function locations(options: HostOptions) {
  const home = resolve(options.home ?? homedir());
  return {
    home,
    root: join(home, '.jstack'),
    claude: options.home ? join(home, '.claude') : resolve(process.env.CLAUDE_CONFIG_DIR || join(home, '.claude')),
    codex: options.home ? join(home, '.agents') : resolve(process.env.CODEX_HOME || join(home, '.agents')),
  };
}

export function hostEnvironment(options: HostOptions): NodeJS.ProcessEnv {
  const paths = locations(options);
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: paths.home, USERPROFILE: paths.home, CLAUDE_CONFIG_DIR: paths.claude, CODEX_HOME: paths.codex };
  if (options.home) {
    Object.assign(env, { XDG_CONFIG_HOME: join(paths.home, '.config'), XDG_CACHE_HOME: join(paths.home, '.cache'), XDG_STATE_HOME: join(paths.home, '.state') });
    for (const key of Object.keys(env)) if (/API_KEY|AUTH_TOKEN|OAUTH_TOKEN/.test(key) || key === 'CLAUDECODE') delete env[key];
  }
  return env;
}

export function command(options: HostOptions, host: Host, args: string[]): string {
  const result = (options.runner ?? defaultRunner)(host, args, hostEnvironment(options));
  if (result.status !== 0) throw new Error(`${host} ${args.join(' ')} failed: ${result.stderr.trim() || result.stdout.trim()}`);
  return result.stdout;
}

export function listPlugins(options: HostOptions, host: Host): PluginRow[] {
  const data = JSON.parse(command(options, host, ['plugin', 'list', '--json']));
  const rows = Array.isArray(data) ? data : data.installed ?? data.plugins;
  if (!Array.isArray(rows)) throw new Error(`${host}: unsupported plugin list schema`);
  return rows.map((row: Record<string, unknown>) => {
    const id = String(row.pluginId ?? row.id ?? '');
    if (!id) throw new Error(`${host}: plugin listing omitted identity`);
    return { id, name: String(row.name ?? id.split('@')[0]), version: row.version as string | undefined,
      enabled: row.enabled !== false, scope: row.scope as string | undefined,
      path: (row.installPath ?? row.installedPath) as string | undefined };
  });
}

export function jstackRows(rows: PluginRow[]): PluginRow[] {
  return rows.filter(row => row.name === 'jstack');
}

export function requestedHosts(options: HostOptions): Host[] {
  const hosts = [...new Set<Host>(options.hosts ?? ['claude', 'codex'])];
  if (!hosts.length || hosts.some(host => host !== 'claude' && host !== 'codex')) throw new Error('Select claude, codex, or both hosts');
  return hosts;
}

/** Fail closed: no destructive host-cache command without a successful process scan. */
export function hostIsStopped(options: HostOptions, host: Host): boolean {
  if (options.hostStopped) return options.hostStopped(host) === true;
  const scan = process.platform === 'win32'
    ? spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_Process | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress'], { encoding: 'utf8', timeout: 10_000, windowsHide: true })
    : spawnSync('ps', ['-A', '-o', 'pid=,args='], { encoding: 'utf8', timeout: 10_000 });
  if (scan.error || scan.status !== 0 || !scan.stdout.trim()) return false;
  let lines: string[];
  try {
    if (process.platform === 'win32') {
      const data = JSON.parse(scan.stdout);
      const rows = Array.isArray(data) ? data : [data];
      if (!rows.length || rows.some(row => typeof row.Name !== 'string')) return false;
      lines = rows.map(row => `${row.Name} ${row.CommandLine ?? ''}`);
    } else lines = scan.stdout.split('\n');
  } catch { return false; }
  // Include native binaries, npm entrypoints and wrappers; false positives defer safely.
  const pattern = new RegExp(`(^|[\\s/\\\\])${host}(?:[.\\s/\\\\]|$)`, 'i');
  return !lines.some(line => pattern.test(line) || (host === 'claude' && line.includes('@anthropic-ai/claude-code')));
}
