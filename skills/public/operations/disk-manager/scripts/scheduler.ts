import { existsSync, readFileSync, unlinkSync, accessSync, constants, realpathSync, readdirSync, mkdirSync, lstatSync, openSync, readSync, closeSync } from 'node:fs';
import { basename, dirname, join, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { atomicWrite, privateDir, checkOwned } from '../../../../../runtime/os.js';
import { paths, requireMac, sharedDirectory } from './storage.js';

export const label = 'io.github.ysys143.jstack.disk-manager';
const xml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
export function launchAgent(cli: string, root: string, interval: number): string {
  if (!isAbsolute(cli) || /[\0\r\n]/.test(cli) || /[\0\r\n]/.test(root) || !Number.isSafeInteger(interval) || interval < 300) throw new Error('Invalid scheduler arguments');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>
<key>Label</key><string>${label}</string>
<key>ProgramArguments</key><array><string>${xml(process.execPath)}</string><string>${xml(cli)}</string><string>disk</string><string>snapshot</string><string>--root</string><string>${xml(root)}</string><string>--json</string></array>
<key>StartInterval</key><integer>${interval}</integer><key>RunAtLoad</key><false/>
<key>StandardOutPath</key><string>${xml(join(paths(root).logs, 'collector.log'))}</string>
<key>StandardErrorPath</key><string>${xml(join(paths(root).logs, 'collector.log'))}</string>
</dict></plist>\n`;
}
export type Runner = (args: string[]) => { status: number | null; stdout?: string; stderr?: string; error?: Error };
const run: Runner = args => spawnSync('/bin/launchctl', args, { encoding: 'utf8', timeout: 10000 });
export const migrationProposal = 'Propose the migration in references/installation.md (Import an existing installation): back up, run jst disk import-legacy --source BACKUP, take one snapshot, disable the legacy launchd job only with the user\'s approval, then run jst disk schedule enable --cli "$(command -v jst)". Nothing migrates automatically; jstack never disables the legacy job.';
/** Launch agents that run the pre-jstack collector. Detection skips unreadable entries unless strict. */
export function legacyCollectors(home = homedir(), strict = false): string[] {
  const directory = join(home, 'Library/LaunchAgents');
  const legacy = (file: string) => { try { return readFileSync(file, 'utf8').includes('/.disk_cache/refresh.sh'); } catch (error) { if (strict) throw error; return false; } };
  try { return existsSync(directory) ? readdirSync(directory).filter(name => name.endsWith('.plist')).map(name => join(directory, name)).filter(legacy) : []; }
  catch (error) { if (strict) throw error; return []; }
}
export function schedule(action: string, root: string, interval: number, cli?: string, options: { home?: string; runner?: Runner; platform?: NodeJS.Platform } = {}) {
  requireMac(options.platform ?? process.platform);
  const home = options.home ?? homedir(), runner = options.runner ?? run;
  const directory = join(home, 'Library/LaunchAgents'), file = join(directory, `${label}.plist`), domain = `gui/${process.getuid!()}`, service = `${domain}/${label}`;
  const observed = runner(['print', service]);
  if (observed.error) throw observed.error;
  if (action === 'status') {
    const registered = observed.status === 0, legacy = legacyCollectors(home);
    const next = !legacy.length ? {} : { next: registered ? 'Possible duplicate collection: the jstack collector is registered and a legacy collector launch agent is still present, so both may run. Propose that the user back up and disable the legacy job; jstack never disables it.' : `Legacy disk collector detected. ${migrationProposal}` };
    return { registered, filePresent: existsSync(file), file, detail: observed.stdout ?? observed.stderr ?? '', legacyCollectors: legacy, ...next };
  }
  if (action === 'disable') {
    if (existsSync(file)) { checkOwned(file); if (!readFileSync(file, 'utf8').includes(`<string>${label}</string>`)) throw new Error('Unexpected scheduler file; refusing removal'); }
    if (observed.status === 0) { const result = runner(['bootout', service]); if (result.status !== 0) throw new Error(result.stderr || 'Unable to disable collector'); }
    if (existsSync(file)) unlinkSync(file);
    return { registered: false, historyPreserved: true };
  }
  if (action !== 'enable' || !cli) throw new Error('Use schedule enable --cli /absolute/bin/jst, status or disable');
  if (observed.status === 0 || existsSync(file)) throw new Error('Collector already configured; inspect status before replacing it');
  const resolved = realpathSync(cli);
  if (/[\\/]plugins[\\/]cache[\\/]/.test(cli + '\n' + resolved)) throw new Error('Use a stable installed jstack CLI, not a versioned plugin cache');
  accessSync(cli, constants.R_OK);
  // launchd runs `node CLI`: the plugin's payload/bin/jst, cached or loaded in place, a script whose shebang is not node,
  // and a binary shim (Volta style: no shebang, no JavaScript name) are not Node entrypoints.
  const head = Buffer.alloc(128), descriptor = openSync(resolved, 'r');
  let length = 0;
  try { length = readSync(descriptor, head, 0, head.length, 0); } finally { closeSync(descriptor); }
  const shebang = /^#![^\n]*/.exec(head.subarray(0, length).toString('utf8'))?.[0];
  const launcher = basename(resolved) === 'jst' && existsSync(join(dirname(dirname(resolved)), 'cli', 'main.js'));
  if (launcher || (shebang !== undefined ? !/\bnode\b/.test(shebang) : !/\.[cm]?js$/.test(resolved))) throw new Error('The scheduler CLI is not a Node entrypoint (the jstack plugin launcher, pnpm or Volta style shims and other wrappers are not); install the CLI package from the release with npm install -g and pass its jstack, for example --cli "$(npm prefix -g)/bin/jst"');
  // A legacy collector is user-owned. Never silently run two or unload it.
  if (legacyCollectors(home, true).length) throw new Error(`Legacy disk collector exists; back it up and explicitly disable it before enabling jstack. ${migrationProposal}`);
  sharedDirectory(paths(root).root); sharedDirectory(join(paths(root).root, 'logs')); privateDir(paths(root).logs);
  mkdirSync(directory, { recursive: true });
  const info = lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid!()) throw new Error('LaunchAgents must be an owned directory');
  atomicWrite(file, Buffer.from(launchAgent(cli, paths(root).root, interval)));
  const result = runner(['bootstrap', domain, file]);
  if (result.status !== 0) { unlinkSync(file); throw new Error(result.stderr || 'Unable to register collector'); }
  return { registered: true, file, intervalSeconds: interval, node: process.execPath, cli, cleanupScheduled: false };
}
