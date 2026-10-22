#!/usr/bin/env node
/**
 * SessionStart hook: opt-in recovery trigger for the dashboard status line.
 *
 * Off by default. When the user enabled automatic recovery (dashboard setup or
 * `install-statusline.mjs optin --auto-repair on`, recorded in this plugin's data
 * directory, or JSTACK_DASHBOARD_STATUSLINE=1), it runs the installer's idempotent
 * repair: a healthy configuration is left untouched and nothing is printed.
 * This hook is not a project discovery hook and never reads the working directory.
 *
 * @handbook 4.8-version-agnostic-statusline
 * @tested scripts/__tests__/ensure-statusline.test.ts
 */
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  realpathSync,
  statSync,
  unlinkSync,
  chmodSync,
} from 'fs';
import path from 'path';
import { homedir } from 'os';
import { fileURLToPath, pathToFileURL } from 'url';

// Deliberately not exported: the tests pin this filename as a literal instead, because it
// is a published contract — the dashboard setup command writes the same string by hand and users'
// settings.json points at it. A test importing this constant would keep passing if the
// value changed while the doc snippet did not.
const SHIM_FILENAME = 'statusline.mjs';

/**
 * Write to a temp file and rename, so a reader never sees a half-written file: a status
 * line render in another session may load the shim at this instant, and a crashed write
 * must not truncate settings.json. The temp name carries the pid so concurrent
 * SessionStart hooks — several sessions launching at once, e.g. after a restart — don't
 * interleave writes to one shared temp path.
 *
 * When `mode` is given it is applied twice on purpose: writeFileSync's option is
 * umask-filtered and only approximates the requested mode, so chmodSync afterward makes
 * it exact. That chmod is best-effort — failing to restore permissions must not abort the
 * write it was decorating.
 */
function atomicWrite(target, content, mode) {
  const tmp = `${target}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, content, mode === undefined ? {} : { mode });
    if (mode !== undefined) {
      try {
        chmodSync(tmp, mode);
      } catch {
        // Best-effort; see above.
      }
    }
    renameSync(tmp, target);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      // Best-effort cleanup; the original error is what matters.
    }
    throw err;
  }
}

/**
 * Copy the bundled shim template into the plugin's persistent data directory.
 * Writing only on difference keeps the hook a no-op in the common case, and lets a
 * future plugin version upgrade the shim itself.
 */
export function syncShim(pluginRoot, pluginData) {
  // Local change: this code ships as a **skill** inside `jstack`.
  // Upstream expects `scripts/` directly beneath the plugin root. Here `pluginRoot`
  // is the payload root that contains both `hooks/` and `skills/`; the caller derives
  // it from this file's location because CLAUDE_PLUGIN_ROOT names the package root
  // one level above `payload/`.
  const source = path.join(
    pluginRoot, 'skills', 'dashboard', 'scripts', 'statusline-shim.mjs');
  if (!existsSync(source)) return null;

  const dest = path.join(pluginData, SHIM_FILENAME);
  const content = readFileSync(source, 'utf8');
  if (existsSync(dest) && readFileSync(dest, 'utf8') === content) return dest;

  mkdirSync(pluginData, { recursive: true });
  atomicWrite(dest, content);
  return dest;
}

/**
 * Matches only this plugin's version-pinned command. Three branches, not a blanket wildcard,
 * to avoid swallowing flags (`--inspect`) or wrapper arguments (`my-wrapper.js`):
 * - Double-quoted path (can contain spaces, typical Windows)
 * - Single-quoted path (can contain spaces)
 * - Unquoted path (no spaces allowed, just non-whitespace before the pinned path tail)
 * Any other form — flags, arguments, wrappers — leaves the command alone.
 */
// Local change: no fixed marketplace or plugin name. The installed
// identity is chosen by whoever installs the package, so any
// plugins/cache/<marketplace>/<plugin>/<version>/ path ending in this package's
// dashboard build matches. The build location matches DIST_SUBPATHS in
// skills/dashboard/scripts/statusline-shim.mjs; `payload/` is optional so a command pinned by an
// earlier candidate layout is still repointed rather than left dead.
const PINNED_TAIL = String.raw`[/\\]plugins[/\\]cache[/\\][^/\\"']+[/\\][^/\\"']+[/\\][^/\\"'\s]+[/\\](?:payload[/\\])?skills[/\\]dashboard[/\\]dist[/\\]index\.js`;
const PINNED_COMMAND = new RegExp(
  `^\\s*node\\s+(?:"[^"]*${PINNED_TAIL}"|'[^']*${PINNED_TAIL}'|(?!["'])\\S*${PINNED_TAIL})\\s*$`
);

/**
 * Earlier hook behavior, kept for callers and upstream comparison; the hook entry
 * point below uses the installer's repair instead.
 *
 * Point statusLine.command at the stable shim, but only when it currently holds this
 * plugin's pinned path. Anything else — a user-authored line, another tool, an
 * already-migrated path — is left alone.
 */
export function migrateStatusLine(settingsPath, shimPath) {
  if (!existsSync(settingsPath)) return 'no-settings';

  let raw;
  let settings;
  try {
    raw = readFileSync(settingsPath, 'utf8');
    settings = JSON.parse(raw);
  } catch {
    return 'unparsable';
  }

  const current = settings?.statusLine?.command;
  if (typeof current !== 'string' || !PINNED_COMMAND.test(current)) return 'skipped';

  // Resolve the real file before writing: settingsPath may traverse a symlink (a
  // dotfiles-managed ~/.claude/settings.json), and the backup + rewrite must land on the
  // file the symlink actually points at, not replace the symlink with a plain copy.
  // (The existsSync check above already returned for a missing file, so settingsPath is
  // known to exist here.)
  const target = realpathSync(settingsPath);
  // The mode is preserved explicitly so a deliberately-restricted settings.json (env
  // secrets, apiKeyHelper) doesn't widen on migration, and the .bak copy stays exactly as
  // private as the source it was copied from. atomicWrite applies it; see there for why
  // that takes both a writeFileSync option and a follow-up chmod.
  const mode = statSync(target).mode;

  // Atomic here too, not just tidiness: the `!existsSync` guard means a backup truncated
  // by a crashed write would be mistaken for a good one and never rewritten, losing the
  // original for good.
  const backup = `${target}.bak`;
  if (!existsSync(backup)) atomicWrite(backup, raw, mode);

  // Quote unconditionally: a space-only check misses shell metacharacters (e.g. a config
  // dir at `/home/user(a)/.claude`), which `sh` then fails to parse since statusLine.command
  // is shell-evaluated. JSON.stringify always quotes and correctly escapes embedded quotes
  // and backslashes too.
  settings.statusLine.command = `node ${JSON.stringify(shimPath)}`;

  // JSON.stringify(settings, null, 2) reformats the whole file to 2-space indentation —
  // a hand-maintained settings.json with different spacing gets rewritten to match. This
  // is an accepted trade-off; the `.bak` above preserves the original exactly.
  atomicWrite(target, `${JSON.stringify(settings, null, 2)}\n`, mode);
  return 'migrated';
}

// Guarded so the test suite can import the functions without running the hook.
// Realpath comparison: settingsPath.command may traverse a symlinked config dir
// (`~/.claude` -> dotfiles repo), which Node's ESM loader resolves for import.meta.url
// while argv keeps the literal path. Never throws: a missing/unreadable argv path must
// not crash a hook that must never block session start.
function isInvokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(path.resolve(process.argv[1])) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

// --- Local change ----------------------------------------------
// **Off by default.** Upstream rewrites settings.json on every SessionStart. This
// repository rejects hooks that mutate machine state every session without consent:
// one session changing shared state has broken running work in other sessions.
//
// Opt-in is explicit and per config directory. The record lives in this plugin's
// data directory (statusline-repair.json, `autoRepair: true`), written only by
// dashboard setup or `install-statusline.mjs optin`. JSTACK_DASHBOARD_STATUSLINE=1
// enables it for one environment; `=0` disables it regardless of the record.
// A repository's decision to use jstack project checks never enables this.
//
// The repair itself lives in skills/dashboard/scripts/install-statusline.mjs so that setup, the
// repair command, a watcher, and this hook share one implementation: ownership
// classification (ours / empty / known-managed-by-another-tool / user), deferral
// on unparsable files, backup before atomic rewrite, and no write when healthy.
// Restore: settings.json.bak holds the state before jstack first wrote.
const OPTIN_FILENAME = 'statusline-repair.json';

export function jstackEnabled(env = process.env, pluginData = env.CLAUDE_PLUGIN_DATA) {
  if (env.JSTACK_DASHBOARD_STATUSLINE === '0') return false;
  if (env.JSTACK_DASHBOARD_STATUSLINE === '1') return true;
  if (!pluginData) return false;
  try {
    return JSON.parse(readFileSync(path.join(pluginData, OPTIN_FILENAME), 'utf8'))?.autoRepair === true;
  } catch {
    return false;
  }
}
// --- End local change -----------------------------------------------------

if (isInvokedDirectly()) {
  try {
    // Cheap exit first: no import, no settings read, unless the user opted in.
    if (jstackEnabled()) {
      // The payload root is this hook's parent directory in every layout;
      // CLAUDE_PLUGIN_ROOT is the package root above `payload/` and cannot be used.
      const payloadRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
      const installer = path.join(
        payloadRoot, 'skills', 'dashboard', 'scripts', 'install-statusline.mjs');
      if (existsSync(installer)) {
        const { repair } = await import(pathToFileURL(installer).href);
        const configDir = process.env.CLAUDE_CONFIG_DIR || path.join(homedir(), '.claude');
        await repair(configDir, { trigger: 'hook' });
      }
    }
  } catch {
    // Never block session start, and never print: an unrecoverable state is
    // reported by /jstack:dashboard-repair, not on every session.
  }
  process.exit(0);
}
