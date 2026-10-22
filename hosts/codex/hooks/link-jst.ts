/**
 * Codex SessionStart hook: put this plugin's `jst` launcher on PATH.
 *
 * Claude Code adds a plugin's top-level bin/ to the Bash tool's PATH; Codex does
 * not, so this links HOME/.local/bin/jst to PLUGIN_ROOT/payload/bin/jst (claude.ai
 * and Cowork refuse a plugin with a top-level bin/). The states follow
 * the design of ysys143/xsm (install_cli): a link that already points here is
 * current, a link into an older jstack plugin version is replaced, a newer one is
 * kept, and anything else is left alone. When another jstack, such as the npm CLI
 * package, is anywhere on PATH, the hook never creates or refreshes its link and
 * removes its own, so that jstack wins. Only that one link (and its directory) is
 * ever written, and every failure ends with status 0, because a broken hook must
 * not break a Codex session. Codex adds the output to the agent's context, so it
 * reports facts for the agent to relay and never instructs a change.
 */
import { randomBytes } from 'node:crypto';
import { accessSync, constants, lstatSync, mkdirSync, readFileSync, readlinkSync, realpathSync, renameSync, type Stats, statSync, symlinkSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { isMain } from '../../../runtime/entry.js';

export type LinkState = 'current' | 'linked' | 'replaced' | 'newer' | 'kept' | 'existing' | 'yielded' | 'foreign' | 'opted-out' | 'no-launcher' | 'failed';
export interface LinkInput { home: string; path: string; env: Record<string, string | undefined>; pluginRoot: string }
export interface LinkResult { state: LinkState; link: string; launcher: string; message: string }

// The launcher in a jstack version folder of a host plugin cache: .../plugins/cache/MARKETPLACE/jstack/VERSION/payload/bin/jst.
const CACHED_LAUNCHER = /\/plugins\/cache\/[^/]+\/jstack\/[^/]+\/payload\/bin\/jst$/;
const versionRoot = (launcher: string) => dirname(dirname(dirname(launcher)));

const executable = (file: string) => { try { accessSync(file, constants.X_OK); return statSync(file).isFile(); } catch { return false; } };
const real = (file: string) => { try { return realpathSync(file); } catch { return undefined; } };

/** The jstack version a plugin root declares, or undefined when it is not a readable jstack plugin. */
export function pluginVersion(root: string): string | undefined {
  try {
    const manifest = JSON.parse(readFileSync(join(root, '.codex-plugin', 'plugin.json'), 'utf8'));
    return manifest?.name === 'jstack' && typeof manifest.version === 'string' ? manifest.version : undefined;
  } catch { return undefined; }
}

/** Semantic-version order: numeric core first, then a release sorts after its prereleases; build metadata is ignored. */
export function compareVersions(a: string, b: string): number {
  const split = (value: string) => { const [core, pre] = value.split('+')[0]!.split(/-(.+)/); return { core: core!.split('.').map(part => Number(part) || 0), pre }; };
  const left = split(a), right = split(b);
  for (let i = 0; i < Math.max(left.core.length, right.core.length); i++) {
    const delta = (left.core[i] ?? 0) - (right.core[i] ?? 0);
    if (delta) return Math.sign(delta);
  }
  if (left.pre === right.pre) return 0;
  if (left.pre === undefined) return 1;
  if (right.pre === undefined) return -1;
  return Math.sign(left.pre.localeCompare(right.pre, 'en', { numeric: true }));
}

/** Whether a resolved path is a jstack plugin launcher in a host plugin cache; a vanished one counts when allowed. */
function cachedLauncher(path: string, vanishedCounts: boolean): boolean {
  if (!CACHED_LAUNCHER.test(path)) return false;
  return executable(path) ? pluginVersion(versionRoot(path)) !== undefined : vanishedCounts;
}

/** The first executable `jst` on PATH that is not a jstack plugin launcher; relative entries are skipped so the cwd cannot decide. */
export function otherJstackOnPath(pathValue: string, launcher?: string): string | undefined {
  for (const directory of pathValue.split(delimiter)) {
    if (!directory || !isAbsolute(directory)) continue;
    const candidate = join(directory, 'jst'), resolved = real(candidate);
    if (resolved && executable(candidate) && resolved !== launcher && !cachedLauncher(resolved, false)) return candidate;
  }
  return undefined;
}

export function linkJst(input: LinkInput, retried = false): LinkResult {
  const launcher = join(input.pluginRoot, 'payload', 'bin', 'jst'), bin = join(input.home, '.local', 'bin'), link = join(bin, 'jst');
  const result = (state: LinkState, message = ''): LinkResult => ({ state, link, launcher, message });
  if (/^(1|true|yes|on)$/i.test((input.env.JSTACK_NO_PATH_LINK ?? '').trim())) return result('opted-out');
  try {
    const ours = real(launcher);
    let entry: Stats | undefined, resolved: string | undefined;
    try { entry = lstatSync(link); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (entry?.isSymbolicLink()) { const target = resolve(dirname(link), readlinkSync(link)); resolved = real(target) ?? target; }
    const own = resolved !== undefined && ((ours !== undefined && resolved === ours) || cachedLauncher(resolved, true));
    // Another jstack, such as the npm CLI package, wins: never create or refresh the link, and remove only our own.
    const other = otherJstackOnPath(input.path, ours);
    if (other) {
      if (!own) return result('existing');
      unlinkSync(link);
      return result('yielded', `jstack: removed the plugin link ${link} because ${other} is on PATH and takes precedence.`);
    }
    if (!executable(launcher)) return result('no-launcher', `jstack: ${launcher} is missing or not executable, so jstack was not linked onto PATH; tell the user if jstack is needed.`);
    const realBin = real(bin);
    const onPath = input.path.split(delimiter).some(item => item && isAbsolute(item) && (resolve(item) === resolve(bin) || (realBin !== undefined && real(item) === realBin)));
    const hint = onPath ? '' : ` ${bin} is not on PATH, so jstack will not resolve until the user adds it to their shell profile and starts a new session; tell the user if jstack is needed.`;
    if (own) {
      if (resolved === ours) return result('current');
      const theirs = pluginVersion(versionRoot(resolved!)), version = pluginVersion(input.pluginRoot);
      if (executable(resolved!)) {
        // A working link is replaced only by a version known to be newer.
        if (version === undefined || theirs === undefined) return result('kept');
        const order = compareVersions(theirs, version);
        if (order > 0) return result('newer');
        if (order === 0) return result('current');
      }
      // Swap atomically, so a concurrent session start never sees the link missing.
      const temporary = join(bin, `.jstack-${process.pid}-${randomBytes(4).toString('hex')}`);
      symlinkSync(launcher, temporary);
      try { renameSync(temporary, link); } catch (error) { try { unlinkSync(temporary); } catch { /* already gone */ } throw error; }
      return result('replaced', `jstack: relinked ${link} from an older jstack plugin version to ${launcher}.${hint}`);
    }
    if (entry) return result('foreign', `jstack: ${link} exists and is not a jstack plugin link, so it was left alone; if jstack is needed, tell the user and do not change that file without their consent.`);
    mkdirSync(bin, { recursive: true, mode: 0o755 });
    symlinkSync(launcher, link);
    return result('linked', `jstack: linked ${link} to ${launcher}.${hint}`);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // A concurrent session start changed the link between the check and the write: look once more.
    if (!retried && (code === 'EEXIST' || code === 'ENOENT')) return linkJst(input, true);
    return result('failed', `jstack: could not link ${link} (${code ?? 'error'}), so jstack may not be on PATH in this session; tell the user if jstack is needed.`);
  }
}

/** The SessionStart source from the hook input, or undefined when there is no readable input. */
function readSource(read: () => string): string | undefined {
  try { const source = JSON.parse(read())?.source; return typeof source === 'string' ? source : undefined; } catch { return undefined; }
}

/**
 * Hook entry: any failure, including a missing plugin root, ends quietly with status 0.
 * On Windows it does nothing: the launcher is a POSIX script, so Codex there needs the CLI package.
 * It reports only on startup (or without hook input); a resumed session stays silent.
 */
export function main(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, readInput: () => string = () => (process.stdin.isTTY ? '' : readFileSync(0, 'utf8'))): number {
  try {
    const pluginRoot = env.PLUGIN_ROOT || env.CLAUDE_PLUGIN_ROOT, home = env.HOME ?? homedir();
    if (!pluginRoot || platform === 'win32' || !home || !isAbsolute(home)) return 0;
    const source = readSource(readInput);
    const outcome = linkJst({ home, path: env.PATH ?? '', env, pluginRoot });
    if (outcome.message && (source === undefined || source === 'startup')) process.stdout.write(`${outcome.message}\n`);
  } catch { /* A hook that cannot decide steps aside. */ }
  return 0;
}
if (isMain(import.meta.url)) process.exitCode = main();
