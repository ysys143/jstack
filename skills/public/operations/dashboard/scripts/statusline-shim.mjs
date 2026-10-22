#!/usr/bin/env node
/**
 * Stable entry point for the claude-dashboard status line.
 *
 * Copied to <config>/plugins/data/<id>/statusline.mjs by the dashboard installer or
 * the opt-in SessionStart hook, and referenced from settings.json by an absolute path
 * that survives plugin updates. Resolves the installed dashboard build at render time,
 * so a plugin update needs no settings edit.
 *
 * Runs from outside the plugin directory: Node built-ins only, no plugin imports.
 *
 * JSTACK-DASHBOARD-SHIM (ownership marker; the installer classifies a command as ours
 * only when the file it runs carries this marker)
 *
 * @handbook 4.8-version-agnostic-statusline
 * @tested scripts/__tests__/statusline-shim.test.ts
 */
import { readdirSync, readFileSync, existsSync, realpathSync } from 'fs';
import path from 'path';
import { homedir } from 'os';
import { fileURLToPath, pathToFileURL } from 'url';
import { spawnSync } from 'child_process';

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*))?$/;

// --- Local change ---------------------------------------------
// Upstream locates dist under the fixed identity
// cache/claude-dashboard/claude-dashboard/<version>/dist/index.js. jstack ships this code
// as a skill inside a package whose marketplace name is chosen by whoever installs it
// (a checked local marketplace, a renamed one, a development link). Fixing the
// marketplace or plugin name made every render resolve nothing when the installed
// identity differed, so this file assumes neither.
//
// Resolution reads the host's per-profile installation metadata and
// locates the dashboard build beneath each recorded installPath. Only when metadata
// is missing or names no usable build does it fall back to a bounded scan of
// plugins/cache/<marketplace>/<plugin>/<version>/. The only fixed string is the build
// location inside the package, which packaging/package-files.json controls.
// `payload/` is the current package layout; the second entry accepts a build laid
// out by an earlier candidate layout.
export const DIST_SUBPATHS = [
  ['payload', 'skills', 'dashboard', 'dist', 'index.js'],
  ['skills', 'dashboard', 'dist', 'index.js'],
];
export const SHIM_MARKER = 'JSTACK-DASHBOARD-SHIM';
// --- End local change ---------------------------------------------------------

/**
 * Claude Code names a plugin's data directory after its installed key
 * `<plugin>@<marketplace>` as `<plugin>-<marketplace>`: every character outside
 * [A-Za-z0-9_-], including `@` and `.`, becomes `-`.
 */
export function dataIdFor(key) {
  return String(key).replace(/[^A-Za-z0-9_-]/g, '-');
}

function compareVersionNames(a, b) {
  const ma = SEMVER.exec(a);
  const mb = SEMVER.exec(b);
  if (ma && !mb) return -1;
  if (!ma && mb) return 1;
  if (!ma && !mb) return String(b).localeCompare(String(a));
  for (const i of [1, 2, 3]) {
    const diff = Number(mb[i]) - Number(ma[i]);
    if (diff) return diff;
  }
  // A stable release outranks its own prereleases.
  const pa = ma[4] ?? null;
  const pb = mb[4] ?? null;
  if (pa === null || pb === null) return Number(pa !== null) - Number(pb !== null);
  return String(pb).localeCompare(String(pa));
}

/** The dashboard build beneath one installed package root, or null. */
export function distUnder(packageRoot) {
  if (typeof packageRoot !== 'string' || !packageRoot) return null;
  for (const sub of DIST_SUBPATHS) {
    const dist = path.join(packageRoot, ...sub);
    if (existsSync(dist)) return dist;
  }
  return null;
}

/**
 * Newest <pluginRoot>/<version>/ holding a dashboard build, as { versionDir, dist },
 * or null. Ordering is numeric per component; string sort would rank 1.9.0 above
 * 1.31.1. Non-semver directory names rank after semver ones.
 */
export function latestVersionUnder(pluginRoot) {
  let entries;
  try {
    entries = readdirSync(pluginRoot, { withFileTypes: true });
  } catch {
    return null;
  }
  const names = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  names.sort(compareVersionNames);
  // Sort first, then probe newest-first and stop at the first hit: sorting is in
  // memory while each probe is a syscall, and this runs on every render.
  for (const name of names) {
    const versionDir = path.join(pluginRoot, name);
    // Claude Code marks versions awaiting cleanup; never render a removed install.
    if (existsSync(path.join(versionDir, '.orphaned_at'))) continue;
    const dist = distUnder(versionDir);
    if (dist) return { versionDir, dist };
  }
  return null;
}

/** Newest dashboard build beneath a plugin cache directory of versions, or null. */
export function resolveLatestDist(pluginRoot) {
  return latestVersionUnder(pluginRoot)?.dist ?? null;
}

/**
 * installed_plugins.json entries as flat rows; [] when absent or unreadable. The
 * array's `metadata` property tells whether the file was read at all.
 */
export function readInstalledPlugins(pluginsDir) {
  let data;
  const none = Object.assign([], { metadata: false });
  try {
    data = JSON.parse(readFileSync(path.join(pluginsDir, 'installed_plugins.json'), 'utf8'));
  } catch {
    return none;
  }
  const table = data && typeof data === 'object' && data.plugins && typeof data.plugins === 'object'
    ? data.plugins
    : data;
  const rows = Object.assign([], { metadata: true });
  if (!table || typeof table !== 'object') return rows;
  for (const [key, value] of Object.entries(table)) {
    if (typeof key !== 'string' || !key.includes('@')) continue;
    for (const entry of Array.isArray(value) ? value : [value]) {
      if (!entry || typeof entry !== 'object' || typeof entry.installPath !== 'string') continue;
      rows.push({
        key,
        dataId: dataIdFor(key),
        scope: typeof entry.scope === 'string' ? entry.scope : null,
        projectPath: typeof entry.projectPath === 'string' ? entry.projectPath : null,
        installPath: entry.installPath,
        version: typeof entry.version === 'string' ? entry.version : path.basename(entry.installPath),
      });
    }
  }
  return rows;
}

/**
 * Bounded scan: plugins/cache/<marketplace>/<plugin>/<version>/<dist subpath>. Two
 * directory listings plus one per plugin; never recursive beyond that.
 */
export function scanCache(pluginsDir) {
  const cache = path.join(pluginsDir, 'cache');
  const found = [];
  let marketplaces;
  try {
    marketplaces = readdirSync(cache, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const m of marketplaces) {
    if (!m.isDirectory()) continue;
    let plugins;
    try {
      plugins = readdirSync(path.join(cache, m.name), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const p of plugins) {
      if (!p.isDirectory()) continue;
      const hit = latestVersionUnder(path.join(cache, m.name, p.name));
      if (hit) {
        const key = `${p.name}@${m.name}`;
        found.push({
          key,
          dataId: dataIdFor(key),
          installPath: hit.versionDir,
          version: path.basename(hit.versionDir),
          dist: hit.dist,
        });
      }
    }
  }
  return found;
}

/**
 * Candidate plugins directories. A shim installed at
 * <config>/plugins/data/<id>/statusline.mjs uses only its own config directory, so a
 * render never loads another home's build. Otherwise CLAUDE_CONFIG_DIR, then the
 * home default. Nothing is assumed about the operating system beyond `path`.
 */
export function pluginsDirsFor(shimFile, env = process.env, home = homedir()) {
  const dirs = [];
  let dataId = null;
  if (shimFile) {
    const dataDir = path.dirname(shimFile);
    if (path.basename(path.dirname(dataDir)) === 'data') {
      dataId = path.basename(dataDir);
      return { dataId, dirs: [path.resolve(path.dirname(path.dirname(dataDir)))] };
    }
  }
  if (env.CLAUDE_CONFIG_DIR) dirs.push(path.join(path.resolve(env.CLAUDE_CONFIG_DIR), 'plugins'));
  if (home) dirs.push(path.join(home, '.claude', 'plugins'));
  return { dataId, dirs: [...new Set(dirs.map((d) => path.resolve(d)))] };
}

/**
 * Resolve the dashboard build a render should load.
 *
 * Returns { dist, source, key, dataId, installPath, version, pluginsDir } or null.
 * Preference within one plugins directory: an installation whose data id matches the
 * shim's own data directory, then user scope, then the newest version. The cache
 * scan runs only for a plugins directory whose installed_plugins.json is unreadable.
 */
export function resolveDashboard({ shimFile = null, env = process.env, home = homedir(), preferDataId = null } = {}) {
  const { dataId, dirs } = pluginsDirsFor(shimFile, env, home);
  const want = preferDataId ?? dataId;
  const rank = (a, b) =>
    Number(b.dataId === want) - Number(a.dataId === want) ||
    Number(b.scope === 'user') - Number(a.scope === 'user') ||
    compareVersionNames(a.version, b.version);

  const unread = [];
  for (const pluginsDir of dirs) {
    const rows = readInstalledPlugins(pluginsDir);
    if (!rows.metadata) unread.push(pluginsDir);
    for (const row of rows.sort(rank)) {
      if (existsSync(path.join(row.installPath, '.orphaned_at'))) continue;
      const dist = distUnder(row.installPath);
      if (dist) return { ...row, dist, source: 'metadata', pluginsDir };
    }
  }
  // Metadata that names no build means the package is not installed there; only a
  // directory without readable metadata is scanned.
  for (const pluginsDir of unread) {
    const rows = scanCache(pluginsDir).sort(rank);
    if (rows.length) return { ...rows[0], scope: null, source: 'cache-scan', pluginsDir };
  }
  return null;
}

/**
 * True when this file was invoked directly as the process entry point (not merely
 * imported by a test). Guarded against symlinks: settings.json can hold a path that
 * traverses a symlinked config dir (`~/.claude` -> dotfiles repo), which Node's ESM
 * loader resolves via realpath while argv keeps the literal path. Never throws.
 */
function isInvokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(path.resolve(process.argv[1])) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isInvokedDirectly()) {
  // Resolve against the literal argv path: a symlinked config dir must still map to
  // the plugins directory the user configured, not the symlink target's parent.
  let resolved = null;
  try {
    resolved = resolveDashboard({ shimFile: path.resolve(process.argv[1]) });
  } catch {
    resolved = null;
  }
  if (process.argv[2] === '--check-usage') {
    const script = resolved && path.join(path.dirname(resolved.dist), 'check-usage.js');
    if (!script || !existsSync(script)) {
      process.stderr.write('jstack dashboard usage is unavailable in this configuration directory\n');
      process.exitCode = 1;
    } else {
      const result = spawnSync(process.execPath, [script, ...process.argv.slice(3)], { stdio: 'inherit', env: process.env, windowsHide: true });
      process.exitCode = result.status ?? 1;
    }
  } else if (resolved) {
    // Silent exit: a warning here would print on every single render.
    try {
      await import(pathToFileURL(resolved.dist).href);
    } catch {
      // Module evaluation failed or threw. Silent exit to prevent render spam.
    }
  }
}
