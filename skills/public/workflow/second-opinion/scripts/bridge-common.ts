/** Shared literal-argv CLI transport. No shell evaluation or user startup-file sourcing. */
import { accessSync, constants, readFileSync, statSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { constants as osConstants } from 'node:os';

export function executable(name: string, env = process.env): string | null {
  const paths = isAbsolute(name) || /[\\/]/.test(name) ? [resolve(name)] : (env.PATH ?? '').split(delimiter).map(directory => join(directory || '.', name));
  const extensions = process.platform === 'win32' && !/\.[^\\/]+$/.test(name) ? ['', ...(env.PATHEXT ?? '.EXE;.COM;.CMD;.BAT').split(';')] : [''];
  for (const path of paths) for (const extension of extensions) {
    const candidate = path + extension;
    try { if (statSync(candidate).isFile()) { accessSync(candidate, process.platform === 'win32' ? constants.F_OK : constants.X_OK); return candidate; } } catch { /* Try the next PATH entry. */ }
  }
  return null;
}
export interface CommandResult { status: number; stdout: string; stderr: string; timedOut: boolean }
export function commandInvocation(binary: string, args: string[], platform: NodeJS.Platform = process.platform): { command: string; args: string[] } {
  if (platform !== 'win32' || !/\.(?:cmd|bat)$/i.test(binary)) return { command: binary, args };
  // Standard npm cmd-shim launchers contain a Node entry path. Invoke that
  // reviewed path directly instead of sending caller-controlled argv through cmd.
  const text = readFileSync(binary, 'utf8');
  const match = /"%_prog%"\s+"%dp0%\\([^"\r\n]+\.(?:c?js|mjs))"\s+%\*/i.exec(text);
  if (!match || /[%\r\n]/.test(match[1]!)) throw new Error('Unsupported Windows command shim; use a native executable or standard npm Node launcher');
  const entry = resolve(dirname(binary), match[1]!.replace(/\\/g, '/'));
  if (!statSync(entry).isFile()) throw new Error('Windows npm launcher target is missing');
  return { command: process.execPath, args: [entry, ...args] };
}
export async function runCommand(command: string, args: string[], options: { timeout: number; input?: string; cwd?: string; env?: NodeJS.ProcessEnv; maxBytes?: number }): Promise<CommandResult> {
  const env = options.env ?? process.env, binary = executable(command, env);
  if (!binary) return { status: 127, stdout: '', stderr: `Executable not found: ${command}\n`, timedOut: false };
  if (!Number.isFinite(options.timeout) || options.timeout <= 0) throw new Error('Timeout must be a positive number of seconds');
  let invocation: ReturnType<typeof commandInvocation>;
  try { invocation = commandInvocation(binary, args); }
  catch (error) { return { status: 127, stdout: '', stderr: `${(error as Error).message}\n`, timedOut: false }; }
  return new Promise(resolveResult => {
    const child = spawn(invocation.command, invocation.args, { cwd: options.cwd, env, shell: false, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', timedOut = false, exceeded = false, bytes = 0, settled = false;
    const outDecoder = new StringDecoder('utf8'), errDecoder = new StringDecoder('utf8');
    const kill = () => {
      if (!child.pid) return;
      if (process.platform === 'win32') { spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5000, stdio: 'ignore' }); child.kill('SIGKILL'); }
      else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
    };
    const timer = setTimeout(() => { timedOut = true; kill(); }, Math.min(options.timeout * 1000, 2_147_483_647));
    const finish = (status: number) => { if (settled) return; settled = true; clearTimeout(timer); stdout += outDecoder.end(); stderr += errDecoder.end(); resolveResult({ status: timedOut ? 124 : exceeded ? 125 : status, stdout, stderr, timedOut }); };
    const collect = (kind: 'stdout' | 'stderr', buffer: Buffer) => {
      bytes += buffer.length;
      if (bytes > (options.maxBytes ?? 16 * 1024 * 1024)) { if (!exceeded) { exceeded = true; stderr += 'CLI output exceeded the configured limit\n'; kill(); } return; }
      if (kind === 'stdout') stdout += outDecoder.write(buffer); else stderr += errDecoder.write(buffer);
    };
    child.stdout.on('data', (buffer: Buffer) => collect('stdout', buffer)); child.stderr.on('data', (buffer: Buffer) => collect('stderr', buffer));
    child.stdin.on('error', () => { /* A process may exit before consuming stdin. Its exit status remains authoritative. */ });
    child.on('error', error => { stderr += `${error.message}\n`; finish(127); });
    child.on('close', (code, signal) => finish(code ?? (signal ? 128 + (osConstants.signals[signal] ?? 0) : 1)));
    child.stdin.end(options.input ?? '');
  });
}
export function parseOptions(argv: string[], allowed: string[], defaults: Record<string, string> = {}): Record<string, string> {
  const result = { ...defaults };
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]!;
    if (!allowed.includes(key)) throw new Error(`Unknown option: ${key}`);
    if (argv[index + 1] === undefined) throw new Error(`${key} requires a value`);
    result[key] = argv[index + 1]!;
  }
  if ('--timeout' in result && (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(result['--timeout']!) || Number(result['--timeout']) <= 0 || Number(result['--timeout']) > 2_147_483)) throw new Error('--timeout must be a positive number of seconds below 2147483');
  return result;
}
export function fileContext(files: string | undefined): string {
  let context = '';
  for (const item of (files ?? '').split(',').filter(Boolean)) {
    const path = item.trim();
    try { if (!statSync(path).isFile()) throw new Error('not a file'); context += `\n--- FILE: ${path} ---\n${readFileSync(path, 'utf8').replace(/\n+$/g, '')}\n--- END FILE ---\n`; }
    catch { process.stderr.write(`WARNING: File not found: ${path}\n`); }
  }
  return context ? `\n\n## Reference Files\n${context}` : '';
}
