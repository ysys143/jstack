#!/usr/bin/env node
/**
 * Interactive host probes drive real Claude Code and Codex TUI sessions through tmux.
 * Manual evidence only: sessions use a real login and model, so CI never runs this.
 * Each host runs in a dedicated, logged-in probe home, never the person's own home.
 * Procedure: skills/public/workflow/verify/references/interactive-cli.md.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { checkPackage, writeJson, type PackageReceipt } from './build.js';
import { codexHooks } from './host_probe.js';
import { isMain } from '../runtime/entry.js';

export type Host = 'claude' | 'codex';
export type Screen = 'login' | 'folder-trust' | 'hook-review' | 'ready' | 'other';
export type HookVerdict = 'executed' | 'not-blocked' | 'not-exercised';
export const PROBE_MARKER = '.jstack-interactive-probe';
// Built from code points so this source stays free of the characters the emoji hook rejects.
const PROMPT_GLYPH = String.fromCodePoint(0x276f), NBSP = String.fromCodePoint(0xa0), SELECT_GLYPHS = ['>', String.fromCodePoint(0x203a), PROMPT_GLYPH];
const EMOJI = String.fromCodePoint(0x1f600);
/** Earlier patterns win. Claude's input prompt is the glyph and a no-break space; its menus use a plain space. */
const SCREENS: Record<Host, [Screen, RegExp][]> = {
  codex: [['login', /Sign in with ChatGPT|Provide your own API key/], ['hook-review', /Hooks need review/], ['folder-trust', /Trust this folder\?/], ['ready', /context left|\? for shortcuts/]],
  claude: [['login', /Select login method|Log in with your Claude/i], ['folder-trust', /Do you trust the files in this folder\?|Yes, I trust this folder/], ['ready', new RegExp(`^${PROMPT_GLYPH}${NBSP}`, 'm')]],
};
export function classify(host: Host, screen: string): Screen {
  for (const [name, pattern] of SCREENS[host]) if (pattern.test(screen)) return name;
  return 'other';
}
/** Number from the Codex review header, or null when the header is absent. */
export function reviewCount(screen: string): number | null {
  const match = /(\d+) hooks? (?:is|are) new or changed/.exec(screen);
  return match ? Number(match[1]) : null;
}
/** The highlighted row of a selection list starts with a pointer glyph. */
export function highlighted(screen: string, label: string): boolean {
  return screen.split('\n').some(line => SELECT_GLYPHS.includes(line.trimStart()[0] ?? '') && line.includes(label));
}
/** Blocked content on disk proves the hook did not block; a missing control proves nothing ran. */
export function hookVerdict(outcome: { control: boolean; blockedWritten: boolean; blockMessage: boolean }): HookVerdict {
  if (outcome.blockedWritten) return 'not-blocked';
  return outcome.control && outcome.blockMessage ? 'executed' : 'not-exercised';
}
/** A probe home must carry the marker and must not be one of the person's own homes. */
export function probeHomeProblem(home: string, personal: string[]): string | null {
  if (!existsSync(join(home, PROBE_MARKER))) return `${home} has no ${PROBE_MARKER} marker`;
  const real = realpathSync(home);
  return personal.some(path => existsSync(path) && realpathSync(path) === real) ? `${home} is a personal home` : null;
}
function personalHomes(): string[] {
  const home = homedir(), codex = existsSync(home) ? readdirSync(home).filter(name => /^\.codex(?:-.*)?$/.test(name)).map(name => join(home, name)) : [];
  return [join(home, '.claude'), ...codex, process.env.CLAUDE_CONFIG_DIR, process.env.CODEX_HOME].filter((path): path is string => !!path);
}
const BLOCK_MARK = 'Emoji detected in content';
const PROMPTS: Record<Host, string> = {
  claude: `This checks a guard hook. First use the Write tool to create emoji.txt containing exactly ${EMOJI} . Then, whether or not that was blocked, use the Write tool to create ascii.txt containing exactly ok . If a write is blocked, report the message and do not retry or work around it.`,
  codex: `This checks a guard hook. First run the shell command: printf '${EMOJI}\\n' > emoji.txt . Then, whether or not that was blocked, run: printf 'ok\\n' > ascii.txt . If a command is blocked, report the message and do not retry or work around it.`,
};
const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
const pause = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const pgrep = (args: string[]) => spawnSync('pgrep', args, { encoding: 'utf8' }).stdout.split('\n').map(Number).filter(pid => pid > 0 && pid !== process.pid);
/** Terminate, wait with a deadline, then kill what is left. Synchronous so signal handlers can use it. */
function terminate(pids: number[]): number[] {
  for (const pid of pids) { try { process.kill(pid); } catch { /* already gone */ } }
  const end = Date.now() + 10_000;
  while (pids.some(alive) && Date.now() < end) pause(100);
  for (const pid of pids.filter(alive)) { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } }
  return pids;
}

/** One private tmux server per host so the person's own sessions and tmux.conf stay untouched. */
class Terminal {
  private step = 0;
  private pane = 0;
  constructor(private socket: string, private evidence: string, private label: string) {}
  private tmux(args: string[], env?: NodeJS.ProcessEnv): string {
    const out = spawnSync('tmux', ['-L', this.socket, '-f', '/dev/null', ...args], { encoding: 'utf8', env });
    if (out.status !== 0) throw new Error(`tmux ${args[0]} failed: ${(out.stderr || out.error?.message || '').trim()}`);
    return out.stdout;
  }
  /** The first command starts the private server, so its environment is the session's. */
  start(cwd: string, argv: string[], env: NodeJS.ProcessEnv): void {
    this.tmux(['new-session', '-d', '-s', 'probe', '-x', '200', '-y', '50', '-c', cwd, 'sh', '-c', `${argv.map(quote).join(' ')}; echo "[exit=$?]"; sleep 3600`], env);
    this.pane = Number(this.tmux(['display-message', '-p', '-t', 'probe', '#{pane_pid}']).trim());
  }
  /** Classification reads the visible screen; scrollback keeps dialogs that were already answered. */
  visible(): string { return this.tmux(['capture-pane', '-p', '-J', '-t', 'probe']); }
  history(): string { return this.tmux(['capture-pane', '-p', '-J', '-t', 'probe', '-S', '-2000']); }
  type(text: string): void { this.tmux(['send-keys', '-t', 'probe', '-l', '--', text]); }
  /** Let a paste settle before Enter so the composer does not read Enter as part of it. */
  async submit(text: string): Promise<void> { this.type(text); await this.settle(500, 5_000); this.key('Enter'); }
  key(...keys: string[]): void { for (const key of keys) this.tmux(['send-keys', '-t', 'probe', key]); }
  save(name: string): void { writeFileSync(join(this.evidence, `${this.label}-${String(++this.step).padStart(2, '0')}-${name}.txt`), this.history()); }
  async waitFor(test: (screen: string) => boolean, ms: number): Promise<string | null> {
    const end = Date.now() + ms;
    for (;;) { const screen = this.visible(); if (test(screen)) return screen; if (Date.now() >= end) return null; await delay(200); }
  }
  /** Wait until the screen stops changing; a spinner keeps it busy until the deadline. */
  async settle(quietMs: number, ms: number): Promise<string> {
    const end = Date.now() + ms; let last = this.visible(), since = Date.now();
    while (Date.now() < end) { await delay(250); const now = this.visible(); if (now !== last) { last = now; since = Date.now(); } else if (Date.now() - since >= quietMs) break; }
    return last;
  }
  /** Keys sent while a dialog is still drawing are dropped, so settle first and confirm each move. */
  async choose(labels: string[]): Promise<boolean> {
    const screen = await this.settle(1000, 10_000), label = labels.find(candidate => screen.includes(candidate));
    if (!label) return false;
    for (let moves = 0; moves <= 5; moves++) {
      if (highlighted(this.visible(), label)) { this.key('Enter'); return true; }
      this.key('Down'); await this.waitFor(text => highlighted(text, label), 1_000);
    }
    return false;
  }
  /** Stop the server and wait for the pane's process tree, so nothing writes configuration afterwards. */
  stop(): number[] {
    const tree: number[] = [];
    for (let queue = this.pane ? [this.pane] : []; queue.length;) { const pid = queue.shift()!; tree.push(pid); queue.push(...pgrep(['-P', String(pid)])); }
    spawnSync('tmux', ['-L', this.socket, 'kill-server'], { encoding: 'utf8' });
    this.pane = 0;
    return terminate(tree.filter(alive));
  }
}

/** Pending cleanups run on SIGINT and SIGTERM too, so an interrupted probe restores its home. */
const pending = new Set<() => void>();
function guarded(cleanup: () => void): () => void {
  let done = false;
  const once = () => { if (done) return; done = true; pending.delete(once); cleanup(); };
  pending.add(once);
  return once;
}
function cleanEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  const drop = (key: string) => ['API_KEY', 'AUTH_TOKEN', 'OAUTH_TOKEN'].some(token => key.includes(token)) || ['CLAUDECODE', 'CLAUDE_ENV_FILE', 'TMUX', 'TMUX_PANE'].includes(key) || ['CLAUDE_CODE_', 'JSTACK_', 'CODEX_SANDBOX'].some(prefix => key.startsWith(prefix));
  for (const key of Object.keys(env)) if (!(key in extra) && drop(key)) delete env[key];
  return env;
}
function filesUnder(root: string, since: number): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => { const path = join(root, entry.name); return entry.isDirectory() ? filesUnder(path, since) : statSync(path).mtimeMs >= since ? [path] : []; });
}
const mentions = (files: string[], mark: string) => files.some(file => readFileSync(file, 'utf8').includes(mark));
type Row = { host: Host; status: 'passed' | 'failed' | 'blocked'; reason?: string; modelPromptSent: boolean; [key: string]: unknown };
interface Options { packageRoot: string; root: string; claudeHome?: string; codexHome?: string; modelMs: number }
const loginHint: Record<Host, string> = {
  claude: 'mkdir -p DIR && touch DIR/.jstack-interactive-probe && CLAUDE_CONFIG_DIR=DIR claude auth login; then rerun with --claude-config-dir DIR',
  codex: 'mkdir -p DIR && touch DIR/.jstack-interactive-probe && CODEX_HOME=DIR codex login; then rerun with --codex-home DIR',
};
function homeProblem(host: Host, home: string | undefined): string | null {
  if (!home) return `no dedicated ${host} probe home; ${loginHint[host]}`;
  if (!existsSync(home)) return `${home} does not exist; ${loginHint[host]}`;
  const problem = probeHomeProblem(home, personalHomes());
  return problem && `${problem}; ${loginHint[host]}`;
}

/** Ask for the blocked write first, so the control file appears only after that attempt. */
async function hookCheck(term: Terminal, host: Host, project: string, transcripts: () => string[], row: Row, ms: number): Promise<HookVerdict> {
  await term.submit(PROMPTS[host]); row.modelPromptSent = true;
  await term.waitFor(() => existsSync(join(project, 'ascii.txt')), ms);
  await term.settle(3000, 60_000); term.save('hook-check');
  const blocked = join(project, 'emoji.txt');
  return hookVerdict({ control: existsSync(join(project, 'ascii.txt')), blockedWritten: existsSync(blocked) && readFileSync(blocked, 'utf8').includes(EMOJI), blockMessage: term.history().includes(BLOCK_MARK) || mentions(transcripts(), BLOCK_MARK) });
}

async function probeClaude(options: Options, receipt: PackageReceipt): Promise<Row> {
  const row: Row = { host: 'claude', status: 'failed', modelPromptSent: false }, folder = join(options.root, 'claude'), project = join(folder, 'project');
  const problem = homeProblem('claude', options.claudeHome);
  if (problem) return { ...row, status: 'blocked', reason: problem };
  const home = options.claudeHome!, env = cleanEnv({ CLAUDE_CONFIG_DIR: home });
  let loggedIn = false; try { loggedIn = JSON.parse(spawnSync('claude', ['auth', 'status'], { encoding: 'utf8', env }).stdout).loggedIn === true; } catch { /* not JSON */ }
  if (!loggedIn) return { ...row, status: 'blocked', reason: `${home} is not logged in; ${loginHint.claude}` };
  mkdirSync(project, { recursive: true }); spawnSync('git', ['init', '-q'], { cwd: project });
  const term = new Terminal(`jstack-probe-${process.pid}-claude`, folder, 'claude'), started = Date.now();
  const transcripts = () => filesUnder(join(home, 'projects', realpathSync(project).replace(/[^A-Za-z0-9]/g, '-')), started);
  const cleanup = guarded(() => { row.stoppedProcesses = term.stop(); });
  try {
    row.version = spawnSync('claude', ['--version'], { encoding: 'utf8', env }).stdout.trim();
    term.start(project, ['claude', '--plugin-dir', options.packageRoot, '--setting-sources', '', '--strict-mcp-config', '--permission-mode', 'acceptEdits'], env);
    let screen = await term.waitFor(text => classify('claude', text) !== 'other', 60_000);
    row.folderTrustDialog = screen !== null && classify('claude', screen) === 'folder-trust';
    if (row.folderTrustDialog) {
      term.save('folder-trust');
      if (!(await term.choose(['Yes, I trust this folder', 'Yes, proceed']))) { term.save('selection'); return { ...row, reason: 'could not select the trust option' }; }
      screen = await term.waitFor(text => classify('claude', text) === 'ready', 30_000);
    }
    if (!screen) { term.save('startup-timeout'); return { ...row, reason: 'no prompt within 60 s' }; }
    if (classify('claude', screen) === 'login') { term.save('login'); return { ...row, status: 'blocked', reason: 'login screen appeared' }; }
    term.save('ready');
    term.type('/jstack:');
    const names = receipt.publicSkills.map(name => `jstack:${name}`);
    row.discovery = (await term.waitFor(text => names.some(name => text.includes(name)), 15_000)) !== null;
    term.save('discovery');
    if (!row.discovery) return { ...row, reason: 'typing /jstack: showed no jstack skill' };
    // Escape and C-u leave the typed text in place; delete it character by character.
    term.key(...Array<string>(8).fill('BSpace'));
    if (!(await term.waitFor(text => !text.split('\n').some(line => line.startsWith(PROMPT_GLYPH) && line.includes('/jstack:')), 5_000))) { term.save('input-not-cleared'); return { ...row, reason: 'could not clear the discovery input' }; }
    row.emojiHook = await hookCheck(term, 'claude', project, transcripts, row, options.modelMs);
    if (row.emojiHook !== 'executed') return { ...row, reason: `emoji hook ${row.emojiHook}` };
    row.status = 'passed'; return row;
  } finally { cleanup(); }
}

async function ownHooks(project: string, env: NodeJS.ProcessEnv, plugin: string): Promise<any[]> {
  const data = (await codexHooks(project, env)).find(message => message.id === 2)?.result?.data;
  return Array.isArray(data) ? data.flatMap((entry: any) => entry.hooks ?? []).filter((hook: any) => hook.pluginId === plugin) : [];
}

async function probeCodex(options: Options): Promise<Row> {
  const row: Row = { host: 'codex', status: 'failed', modelPromptSent: false }, folder = join(options.root, 'codex'), project = join(folder, 'project'), market = join(folder, 'market');
  const marketplace = 'jstack-interactive-probe', plugin = `jstack@${marketplace}`;
  const problem = homeProblem('codex', options.codexHome);
  if (problem) return { ...row, status: 'blocked', reason: problem };
  const home = options.codexHome!, env = cleanEnv({ CODEX_HOME: home }), status = spawnSync('codex', ['login', 'status'], { encoding: 'utf8', env });
  if (status.status !== 0 || /not logged in/i.test(status.stdout + status.stderr)) return { ...row, status: 'blocked', reason: `${home} is not logged in; ${loginHint.codex}` };
  mkdirSync(project, { recursive: true }); spawnSync('git', ['init', '-q'], { cwd: project });
  const configPath = join(home, 'config.toml'), before = existsSync(configPath) ? readFileSync(configPath) : null, cache = join(home, 'plugins/cache', marketplace);
  // Daemons leave the pane's process tree, so remember what already named this home.
  const existing = new Set(pgrep(['-f', home]));
  const term = new Terminal(`jstack-probe-${process.pid}-codex`, folder, 'codex'), started = Date.now();
  const transcripts = () => filesUnder(join(home, 'sessions'), started);
  const run = (argv: string[]) => { const out = spawnSync(argv[0], argv.slice(1), { cwd: project, env, encoding: 'utf8', timeout: 60_000 }); if (out.status !== 0) throw new Error(`${argv.slice(0, 4).join(' ')} failed: ${(out.stderr ?? '').trim()}`); return out.stdout; };
  const launch = () => term.start(project, ['codex', '--sandbox', 'workspace-write', '--ask-for-approval', 'never'], env);
  const cleanup = guarded(() => {
    row.stoppedProcesses = [...term.stop(), ...terminate(pgrep(['-f', home]).filter(pid => !existing.has(pid)))];
    if (before === null) rmSync(configPath, { force: true }); else writeFileSync(configPath, before);
    rmSync(cache, { recursive: true, force: true });
    row.configRestored = before === null ? !existsSync(configPath) : readFileSync(configPath).equals(before);
  });
  try {
    row.version = run(['codex', '--version']).trim();
    cpSync(options.packageRoot, join(market, 'plugins/jstack'), { recursive: true });
    writeJson(join(market, '.agents/plugins/marketplace.json'), { name: marketplace, interface: { displayName: 'jstack interactive probe' }, plugins: [{ name: 'jstack', source: { source: 'local', path: './plugins/jstack' }, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity' }] });
    run(['codex', 'plugin', 'marketplace', 'add', market]); run(['codex', 'plugin', 'add', plugin]);
    const initial = await ownHooks(project, env, plugin);
    row.hooksBefore = initial.map((hook: any) => ({ key: hook.key, trust: hook.trustStatus }));
    if (!initial.length || initial.some((hook: any) => hook.trustStatus !== 'untrusted')) return { ...row, reason: 'installed jstack hooks are missing or not untrusted before review' };
    launch();
    let screen = await term.waitFor(text => !['other', 'ready'].includes(classify('codex', text)), 60_000);
    if (screen && classify('codex', screen) === 'folder-trust') {
      term.save('folder-trust'); row.folderTrustScreen = true;
      if (!(await term.choose(['Trust and continue']))) { term.save('selection'); return { ...row, reason: 'could not select Trust and continue' }; }
      screen = await term.waitFor(text => !['other', 'ready', 'folder-trust'].includes(classify('codex', text)), 60_000);
    }
    if (!screen) { term.save('startup-timeout'); return { ...row, reason: 'no hook review modal within 60 s although jstack hooks are untrusted' }; }
    if (classify('codex', screen) === 'login') { term.save('login'); return { ...row, status: 'blocked', reason: 'login screen appeared' }; }
    term.save('hook-review');
    row.reviewCount = reviewCount(screen);
    if (row.reviewCount !== initial.length) return { ...row, reason: `review modal counts ${row.reviewCount} hooks; ${initial.length} are installed` };
    if (!(await term.choose(['Trust all and continue']))) { term.save('selection'); return { ...row, reason: 'could not select Trust all and continue' }; }
    // The option asks for explicit confirmation; answer it until the modal closes.
    for (let attempt = 0; attempt < 3 && classify('codex', await term.settle(1000, 5_000)) === 'hook-review'; attempt++) { term.save('confirm'); term.key('Enter'); }
    if (classify('codex', term.visible()) === 'hook-review') { term.save('still-review'); return { ...row, reason: 'hook review modal did not close after trusting' }; }
    term.save('after-trust');
    const trusted = await ownHooks(project, env, plugin), config = readFileSync(configPath, 'utf8');
    row.hooksAfter = trusted.map((hook: any) => ({ key: hook.key, trust: hook.trustStatus }));
    row.persistedTrust = trusted.length === initial.length && trusted.every((hook: any) => hook.trustStatus === 'trusted') && (config.match(/trusted_hash/g) ?? []).length >= initial.length;
    if (!row.persistedTrust) return { ...row, reason: 'hooks/list or config.toml does not show every jstack hook as trusted' };
    if (!(await term.waitFor(text => classify('codex', text) === 'ready', 30_000))) { term.save('not-ready'); return { ...row, reason: 'no prompt after trusting' }; }
    row.emojiHook = await hookCheck(term, 'codex', project, transcripts, row, options.modelMs);
    if (row.emojiHook !== 'executed') return { ...row, reason: `emoji hook ${row.emojiHook}` };
    term.stop(); launch();
    // A prompt can draw before a late modal, so judge the restart only after the screen settles.
    await term.waitFor(text => classify('codex', text) !== 'other', 60_000);
    const restarted = classify('codex', await term.settle(2000, 15_000)); term.save('restart');
    row.restartWithoutReview = restarted === 'ready' && (await ownHooks(project, env, plugin)).every((hook: any) => hook.trustStatus === 'trusted');
    if (!row.restartWithoutReview) return { ...row, reason: `restart settled on ${restarted} or lost hook trust` };
    row.status = 'passed'; return row;
  } finally { cleanup(); }
}

export async function probe(options: Options, hosts: Host[]): Promise<Row[]> {
  if (spawnSync('tmux', ['-V'], { encoding: 'utf8' }).status !== 0) throw new Error('tmux is required for interactive probes');
  checkPackage(options.packageRoot);
  const receipt = JSON.parse(readFileSync(join(options.packageRoot, 'package-receipt.json'), 'utf8')) as PackageReceipt, rows: Row[] = [];
  for (const host of hosts) {
    let row: Row;
    try { row = host === 'claude' ? await probeClaude(options, receipt) : await probeCodex(options); }
    catch (error) { row = { host, status: 'failed', reason: String(error), modelPromptSent: false }; }
    rows.push(row); writeJson(join(options.root, 'summary.json'), { packageSourceSha256: receipt.sourceSha256, hosts: rows }); console.log(JSON.stringify(row));
  }
  return rows;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const args = new Map<string, string>(), flags = ['--package', '--host', '--output', '--claude-config-dir', '--codex-home', '--model-seconds'];
  for (let i = 0; i < argv.length; i += 2) {
    if (argv[i] === '--help') { console.log('interactive_probe.js --package DIRECTORY [--host claude|codex|both] [--output NEW_DIRECTORY] [--claude-config-dir PROBE_HOME] [--codex-home PROBE_HOME] [--model-seconds N]'); return 0; }
    if (!flags.includes(argv[i]) || !argv[i + 1]) throw new Error('Invalid probe arguments');
    args.set(argv[i], argv[i + 1]);
  }
  if (!args.has('--package')) throw new Error('--package is required');
  const host = args.get('--host') ?? 'both'; if (!['both', 'claude', 'codex'].includes(host)) throw new Error('Invalid host');
  const seconds = Number(args.get('--model-seconds') ?? '300'); if (!(seconds > 0)) throw new Error('--model-seconds must be positive');
  const root = args.has('--output') ? resolve(args.get('--output')!) : mkdtempSync(join(tmpdir(), 'jstack-interactive-'));
  if (args.has('--output')) mkdirSync(root);
  console.log('Evidence:', root);
  for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]] as const) process.once(signal, () => { for (const cleanup of [...pending]) { try { cleanup(); } catch { /* keep cleaning */ } } process.exit(code); });
  const home = (flag: string) => args.has(flag) ? resolve(args.get(flag)!) : undefined;
  const rows = await probe({ packageRoot: realpathSync(resolve(args.get('--package')!)), root, claudeHome: home('--claude-config-dir'), codexHome: home('--codex-home'), modelMs: seconds * 1000 }, host === 'both' ? ['claude', 'codex'] : [host as Host]);
  return rows.every(row => row.status === 'passed') ? 0 : 1;
}
if (isMain(import.meta.url)) main().then(code => { process.exitCode = code; }).catch(error => { console.error(String(error)); process.exitCode = 2; });
