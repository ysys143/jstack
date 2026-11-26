import { existsSync, readFileSync, unlinkSync, accessSync, constants, realpathSync, readdirSync, mkdirSync, lstatSync, openSync, readSync, closeSync } from 'node:fs';
import { basename, dirname, join, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { atomicWrite, privateDir, checkOwned } from '../../../../../runtime/os.js';
import { paths, requireMac, sharedDirectory, xdgPath, maxRunTimeoutSeconds } from './storage.js';

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
export function schedule(action: string, root: string, interval: number, cli?: string, options: { home?: string; runner?: Runner; platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv } = {}) {
  if ((options.platform ?? process.platform) === 'linux') return systemdSchedule(action, root, interval, cli, options);
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
  validateCli(cli);
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

/** Both schedulers require the same stable Node CLI; plugin/native host entrypoints remain unchanged. */
function validateCli(cli: string): void {
  if (!isAbsolute(cli) || /[\0\r\n]/.test(cli)) throw new Error('Use a stable absolute Node CLI path');
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
}

export const systemdUnit = 'jstack-disk-manager';
const unitMarker = '# jstack disk-manager user collection; managed by jst disk schedule';
const unitQuote = (value: string) => '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%') + '"';
const execQuote = (value: string) => unitQuote(value.replace(/\$/g, '$$$$'));
/**
 * The start timeout covers the largest valid collection deadline plus state and SQLite work, so a profile changed after
 * registration never has systemd kill a run early. Each run's own deadline comes from the profile it reads.
 */
export const systemdStartTimeoutSeconds = maxRunTimeoutSeconds + 120;
export function systemdUnits(cli: string, root: string, interval: number, cacheHome = xdgPath(process.env, 'XDG_CACHE_HOME', join(homedir(), '.cache'))) {
  if (![cli, root, cacheHome].every(path => isAbsolute(path) && !/[\0\r\n]/.test(path)) || !Number.isSafeInteger(interval) || interval < 300 || interval > 2592000) throw new Error('Invalid systemd scheduler arguments');
  return {
    service: `${unitMarker}
[Unit]
Description=jstack disk usage snapshot
[Service]
Type=oneshot
ExecStart=${[process.execPath, cli, 'disk', 'snapshot', '--root', paths(root).root, '--json'].map(execQuote).join(' ')}
Environment="LC_ALL=C" "LANG=C" ${unitQuote('XDG_CACHE_HOME=' + cacheHome)}
TimeoutStartSec=${systemdStartTimeoutSeconds}s
TimeoutStopSec=5s
KillMode=control-group
Nice=10
IOSchedulingClass=idle
CPUWeight=10
CPUQuota=20%
IOWeight=10
MemoryHigh=256M
MemoryMax=512M
NoNewPrivileges=yes
StandardOutput=journal
StandardError=journal
`,
    timer: `${unitMarker}
[Unit]
Description=jstack disk snapshot interval
[Timer]
OnActiveSec=${interval}s
OnUnitInactiveSec=${interval}s
AccuracySec=1min
Persistent=false
WakeSystem=false
Unit=${systemdUnit}.service
[Install]
WantedBy=timers.target
`,
  };
}
function systemdSchedule(action: string, root: string, interval: number, cli: string | undefined, options: { home?: string; runner?: Runner; env?: NodeJS.ProcessEnv }) {
  if (!['status', 'enable', 'disable'].includes(action)) throw new Error('Use schedule enable --cli /absolute/bin/jst, status or disable');
  const home = options.home ?? homedir(), env = options.env ?? process.env;
  const config = xdgPath(env, 'XDG_CONFIG_HOME', join(home, '.config')), directory = join(config, 'systemd/user');
  const service = `${systemdUnit}.service`, timer = `${systemdUnit}.timer`, file = join(directory, timer), serviceFile = join(directory, service);
  const runner = options.runner ?? ((args: string[]) => spawnSync('/usr/bin/systemctl', args, { encoding: 'utf8', timeout: 10000, killSignal: 'SIGKILL', env: { ...env, LC_ALL: 'C', LANG: 'C' } }));
  const call = (...args: string[]) => runner(['--user', ...args]);
  const available = call('show', '--property=Version');
  if (available.error || available.status !== 0) {
    const reason = `systemd user manager unavailable: ${available.error?.message ?? available.stderr ?? 'systemctl failed'}. Use manual snapshots; jstack never falls back to cron, root services or enabling linger.`;
    if (action !== 'status') throw new Error(reason);
    return { supported: false, registered: false, file, filePresent: existsSync(file), serviceFile, reason };
  }
  const inspect = (unit: string) => {
    const result = call('show', unit, '--property=LoadState', '--property=ActiveState', '--property=UnitFileState', '--property=FragmentPath', '--property=DropInPaths');
    if (result.error || result.status !== 0) throw new Error(result.error?.message ?? result.stderr ?? `Unable to inspect systemd ${unit}`);
    const fields = Object.fromEntries((result.stdout ?? '').trim().split('\n').map(line => { const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)]; }));
    if (!fields.LoadState) throw new Error('Unexpected systemd unit state; inspect it before changing schedules');
    return { result, fields };
  };
  const { result: observed, fields } = inspect(timer), { fields: serviceState } = inspect(service);
  const registered = fields.ActiveState === 'active' || ['enabled', 'enabled-runtime'].includes(fields.UnitFileState);
  // A masked, broken or otherwise unusual unit is reported by status; schedule changes refuse it.
  const unusual = [[timer, fields.LoadState], [service, serviceState.LoadState]].filter(([, state]) => !['loaded', 'not-found'].includes(state));
  const attention = unusual.length ? `${unusual.map(([unit, state]) => `${unit} LoadState=${state}`).join(', ')}; inspect it with systemctl --user status before changing schedules` : undefined;
  if (action === 'status') return { supported: true, registered, active: fields.ActiveState === 'active', enabled: ['enabled', 'enabled-runtime'].includes(fields.UnitFileState), loadState: fields.LoadState, serviceLoadState: serviceState.LoadState, ...(attention ? { attention } : {}), filePresent: existsSync(file), file, serviceFile, detail: observed.stdout ?? '', cleanupScheduled: false };
  if (attention) throw new Error(`Unexpected systemd unit state: ${attention}`);
  const owned = (path: string) => { if (existsSync(path)) { checkOwned(path); if (!readFileSync(path, 'utf8').startsWith(unitMarker + '\n')) throw new Error('Unexpected scheduler file; refusing replacement or removal'); } };
  const checked = (...args: string[]) => { const result = call(...args); if (result.error || result.status !== 0) throw new Error(result.error?.message ?? result.stderr ?? `systemctl ${args[0]} failed`); };
  const same = (a: string | undefined, b: string) => { try { return !!a && realpathSync(a) === realpathSync(b); } catch { return false; } };
  if (action === 'disable') {
    owned(file); owned(serviceFile);
    // Compare real paths as enable does, so an equivalent spelling of the same directory is not refused.
    if ((fields.FragmentPath && !same(fields.FragmentPath, file)) || (serviceState.FragmentPath && !same(serviceState.FragmentPath, serviceFile)) || fields.DropInPaths || serviceState.DropInPaths) throw new Error('Unit is loaded from another location or has overrides; refusing to change it');
    if (!existsSync(file) && !existsSync(serviceFile)) { if (fields.LoadState !== 'not-found' || serviceState.LoadState !== 'not-found') throw new Error('Timer is not jstack-managed at this location'); return { registered: false, historyPreserved: true }; }
    // Stop any current collector too, so disabling leaves no diagnostic process behind.
    checked('stop', timer, service); checked('disable', timer);
    for (const path of [file, serviceFile]) if (existsSync(path)) unlinkSync(path);
    checked('daemon-reload');
    return { registered: false, historyPreserved: true };
  }
  if (!cli) throw new Error('Use schedule enable --cli /absolute/bin/jst');
  validateCli(cli);
  if (fields.LoadState !== 'not-found' || serviceState.LoadState !== 'not-found' || fields.DropInPaths || serviceState.DropInPaths || existsSync(file) || existsSync(serviceFile)) throw new Error('Collector already configured; inspect status before replacing it');
  sharedDirectory(config); sharedDirectory(join(config, 'systemd')); sharedDirectory(directory);
  const units = systemdUnits(cli, root, interval, xdgPath(env, 'XDG_CACHE_HOME', join(home, '.cache')));
  let wroteService = false, wroteTimer = false, reloaded = false, enabling = false;
  try {
    atomicWrite(serviceFile, Buffer.from(units.service)); wroteService = true;
    atomicWrite(file, Buffer.from(units.timer)); wroteTimer = true;
    reloaded = true; checked('daemon-reload');
    // The directory comes from this shell's XDG_CONFIG_HOME; the user manager searches its own environment's paths.
    const loaded = { timer: inspect(timer).fields.FragmentPath, service: inspect(service).fields.FragmentPath };
    if (!same(loaded.timer, file) || !same(loaded.service, serviceFile)) throw new Error(`systemd user manager did not load the units just written to ${directory} (timer FragmentPath=${loaded.timer || 'none'}, service FragmentPath=${loaded.service || 'none'}). This shell's XDG_CONFIG_HOME may differ from the user manager's environment (systemctl --user show-environment); the written units were removed`);
    enabling = true; checked('enable', '--now', timer);
  } catch (error) {
    // A failed enable may have created its symlink before returning an error. Units never enabled need no disable.
    if (enabling) {
      const rollback = call('disable', '--now', timer);
      if (rollback.error || rollback.status !== 0) throw new Error(`Schedule enable failed (${String(error)}); rollback failed (${rollback.error?.message ?? rollback.stderr ?? rollback.status}); inspect ${file} before retrying`);
    }
    if (wroteTimer) unlinkSync(file); if (wroteService) unlinkSync(serviceFile);
    if (reloaded) {
      const reload = call('daemon-reload');
      if (reload.error || reload.status !== 0) throw new Error(`Schedule enable failed (${String(error)}); files removed but daemon-reload failed; inspect systemd status`);
    }
    throw error;
  }
  return { supported: true, registered: true, file, serviceFile, intervalSeconds: interval, node: process.execPath, cli, cleanupScheduled: false, firstRun: 'after one full interval; no boot or catch-up scan' };
}
