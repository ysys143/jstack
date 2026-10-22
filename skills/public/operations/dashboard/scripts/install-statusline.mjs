#!/usr/bin/env node
/**
 * Install, inspect, and repair the dashboard status line.
 *
 *   node scripts/install-statusline.mjs status  [--config-dir DIR]... [--codex-home DIR]
 *   node scripts/install-statusline.mjs install [--config-dir DIR] [--replace] [--auto-repair on|off]
 *   node scripts/install-statusline.mjs repair  [--config-dir DIR]... [--trigger command|hook] [--codex]
 *   node scripts/install-statusline.mjs optin   [--config-dir DIR] [--auto-repair on|off]
 *        [--allow-replace ID]... [--deny-replace ID]... [--sync-glob GLOB]...
 *        [--clear-sync-globs] [--known-managed ID=SUBSTRING]... [--codex on|off]
 *   node scripts/install-statusline.mjs codex   status|repair [--codex-home DIR] [--config-dir DIR]
 *   node scripts/install-statusline.mjs watch   [--config-dir DIR]... [--interval SECONDS]
 *
 * Local file (not upstream). Upstream's setup command pasted a node snippet
 * that scanned the plugin cache by hand and assumed one installation identity. This
 * script reuses the shim's own resolver, so the build that setup and repair verify is
 * the build every render loads.
 *
 * Ownership classes (ours, empty, known-managed-by-another-tool, user), cause types,
 * opt-in settings, and recovery steps are described in references/recovery.md.
 *
 * Recovery is off by default. `install` and `repair` run only when a user invokes
 * them. The SessionStart hook and `watch` call repair with trigger `hook`, which does
 * nothing unless this config directory's opt-in record enables autoRepair (or
 * JSTACK_DASHBOARD_STATUSLINE=1; `=0` disables it regardless of the record).
 *
 * Output is one JSON object on stdout (`repair --trigger hook` prints nothing).
 * Exit codes:
 *   0  reported, healthy, installed, or repaired
 *   1  no dashboard build that the shim can resolve
 *   2  usage error, or a configuration file that could not be parsed (nothing written)
 *   3  statusLine belongs to the user or another tool; nothing written
 *   4  Codex configuration layout this script does not edit safely (nothing written)
 *
 * Node built-ins only: this runs before anything is installed.
 */
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  realpathSync,
  statSync,
  unlinkSync,
  chmodSync,
  watch as fsWatch,
} from 'fs';
import path from 'path';
import { homedir } from 'os';
import { fileURLToPath, pathToFileURL } from 'url';
import {
  SHIM_MARKER,
  dataIdFor,
  distUnder,
  readInstalledPlugins,
  resolveDashboard,
} from './statusline-shim.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHIM_SOURCE = path.join(HERE, 'statusline-shim.mjs');
const SHIM_FILENAME = 'statusline.mjs';
const OPTIN_FILENAME = 'statusline-repair.json';
const BACKUP_SUFFIX = '.jstack-dashboard.bak';
const CODEX_DEFAULT_STATUS_LINE = '["model", "context-remaining", "git-branch"]';
export const OWNER = Object.freeze({
  OURS: 'ours',
  EMPTY: 'empty',
  MANAGED: 'known-managed-by-another-tool',
  USER: 'user',
});

// ---------------------------------------------------------------------------
// File helpers

/**
 * Temp file and rename, so a reader never sees a half-written file. The temp name
 * carries the pid so concurrent writers do not share one temp path. `mode` is applied
 * twice: writeFileSync's option is umask-filtered, and chmod makes it exact.
 */
function atomicWrite(target, content, mode) {
  const tmp = `${target}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, content, mode === undefined ? {} : { mode });
    if (mode !== undefined) {
      try {
        chmodSync(tmp, mode);
      } catch {
        // Best-effort; failing to restore permissions must not abort the write.
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
 * Back up `raw` beside `target` before a rewrite. The first backup is `<file>.bak`
 * and is never overwritten, so it keeps the state before jstack first wrote. Later
 * backups replace one rolling `<file>.jstack-dashboard.bak`, so repeated repairs do
 * not accumulate files.
 */
function backupBeside(target, raw, mode) {
  const first = `${target}.bak`;
  const backup = existsSync(first) ? `${target}${BACKUP_SUFFIX}` : first;
  atomicWrite(backup, raw, mode);
  return backup;
}

/** Real target and mode of an existing file, so a symlinked file is written through. */
function writeTarget(file) {
  const target = realpathSync(file);
  return { target, mode: statSync(target).mode & 0o7777 };
}

function readJsonObject(file) {
  if (!existsSync(file)) return { state: 'missing', raw: null, value: {} };
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (err) {
    return { state: 'unreadable', raw: null, value: null, error: String(err?.message ?? err) };
  }
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { state: 'unparsable', raw, value: null, error: 'not a JSON object' };
    }
    return { state: 'ok', raw, value };
  } catch (err) {
    return { state: 'unparsable', raw, value: null, error: String(err?.message ?? err) };
  }
}

function jsonIndent(raw) {
  return raw?.match(/^[{[]\r?\n([ \t]+)\S/)?.[1] ?? 2;
}

// ---------------------------------------------------------------------------
// Locations

export function claudeConfigDir(env = process.env, home = homedir()) {
  return path.resolve(env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'));
}

export function codexHome(env = process.env, home = homedir()) {
  return path.resolve(env.CODEX_HOME || path.join(home, '.codex'));
}

function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function realOrSelf(p) {
  try {
    return realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

/**
 * The plugin data directory the status line should use: that of the installation the
 * resolver prefers (user scope, newest version), so every installed copy agrees on
 * one target. Without a resolvable build, CLAUDE_PLUGIN_DATA when it belongs to this
 * config directory.
 */
export function dataDirFor(configDir, resolution, env = process.env) {
  const dataRoot = path.join(configDir, 'plugins', 'data');
  if (resolution) return path.join(dataRoot, resolution.dataId);
  if (env.CLAUDE_PLUGIN_DATA) {
    const candidate = path.resolve(env.CLAUDE_PLUGIN_DATA);
    if (path.dirname(candidate) === dataRoot) return candidate;
  }
  return null;
}

/** The installed package that contains this running script, or null (e.g. a checkout). */
function selfInstallation(configDir) {
  const self = realOrSelf(HERE);
  for (const row of readInstalledPlugins(path.join(configDir, 'plugins'))) {
    if (isInside(self, realOrSelf(row.installPath))) return row;
  }
  return null;
}

/** `node "<shim>"`: quoted unconditionally because statusLine.command is shell-evaluated. */
export function shimCommand(shim) {
  return `node ${JSON.stringify(shim)}`;
}

function resolveFor(configDir, preferDataId = null) {
  return resolveDashboard({
    shimFile: null,
    env: { CLAUDE_CONFIG_DIR: configDir },
    home: null,
    preferDataId,
  });
}

// ---------------------------------------------------------------------------
// Opt-in record (per config directory, inside our data directory)

const OPTIN_DEFAULTS = Object.freeze({
  schema: 1,
  autoRepair: false,
  allowReplace: [],
  knownManaged: [],
  syncGlobs: [],
  codex: false,
});

export function readOptin(dataDir) {
  const file = dataDir ? path.join(dataDir, OPTIN_FILENAME) : null;
  const read = file ? readJsonObject(file) : { state: 'missing', value: {} };
  const value = read.state === 'ok' ? read.value : {};
  const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x) : []);
  return {
    file,
    state: read.state,
    autoRepair: value.autoRepair === true,
    allowReplace: list(value.allowReplace),
    knownManaged: Array.isArray(value.knownManaged)
      ? value.knownManaged.filter((k) => k && typeof k.id === 'string' && typeof k.match === 'string' && k.match)
      : [],
    syncGlobs: list(value.syncGlobs),
    codex: value.codex === true,
    installedCommand: typeof value.installedCommand === 'string' ? value.installedCommand : null,
    codexStatusLine: typeof value.codexStatusLine === 'string' ? value.codexStatusLine : null,
  };
}

function writeOptin(optin, changes) {
  if (!optin.file) throw new Error('No plugin data directory for this config directory');
  // A damaged record is never replaced by defaults: that would drop the user's
  // allowReplace, knownManaged, and syncGlobs choices.
  if (optin.state === 'unparsable' || optin.state === 'unreadable') {
    throw new Error(`${optin.file} could not be parsed; fix or remove it first`);
  }
  const next = {
    ...OPTIN_DEFAULTS,
    autoRepair: optin.autoRepair,
    allowReplace: optin.allowReplace,
    knownManaged: optin.knownManaged,
    syncGlobs: optin.syncGlobs,
    codex: optin.codex,
    ...(optin.installedCommand ? { installedCommand: optin.installedCommand } : {}),
    ...(optin.codexStatusLine ? { codexStatusLine: optin.codexStatusLine } : {}),
    ...changes,
  };
  const content = `${JSON.stringify(next, null, 2)}\n`;
  if (existsSync(optin.file) && readFileSync(optin.file, 'utf8') === content) return false;
  mkdirSync(path.dirname(optin.file), { recursive: true });
  atomicWrite(optin.file, content);
  return true;
}

/** Hook-triggered recovery: the record decides unless the environment overrides it. */
export function autoRepairEnabled(optin, env = process.env) {
  if (env.JSTACK_DASHBOARD_STATUSLINE === '0') return false;
  if (env.JSTACK_DASHBOARD_STATUSLINE === '1') return true;
  return optin.autoRepair;
}

// ---------------------------------------------------------------------------
// Classification

const NODE_SCRIPT = /^\s*node\s+(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|([^\s"']+))\s*$/;
const PINNED_BUILD =
  /[/\\]plugins[/\\]cache[/\\]([^/\\]+)[/\\]([^/\\]+)[/\\][^/\\]+[/\\](?:payload[/\\])?skills[/\\]dashboard[/\\]dist[/\\]index\.js$/;
const PLUGIN_AREA = /[/\\]plugins[/\\](cache|data)[/\\]([^/\\"'\s]+)(?:[/\\]([^/\\"'\s]+))?/;

function scriptPathOf(command) {
  const m = NODE_SCRIPT.exec(command);
  if (!m) return null;
  if (m[1] !== undefined) {
    try {
      return JSON.parse(`"${m[1]}"`);
    } catch {
      return m[1];
    }
  }
  return m[2] ?? m[3];
}

/** A shim file is ours when it carries the marker, or is an earlier jstack shim. */
function isOurShimFile(file) {
  try {
    const text = readFileSync(file, 'utf8');
    return text.includes(SHIM_MARKER) || text.includes("'skills', 'dashboard', 'dist', 'index.js'");
  } catch {
    return false;
  }
}

/**
 * Classify one statusLine command. `ourDataIds` are data ids of installations that
 * contain a dashboard build; `knownManaged` are user-declared identities.
 */
export function classify(command, { ourDataIds = [], knownManaged = [] } = {}) {
  if (typeof command !== 'string' || !command.trim()) return { owner: OWNER.EMPTY, identity: null };
  const script = scriptPathOf(command);
  if (script) {
    const pinned = PINNED_BUILD.exec(script);
    if (pinned) {
      const identity = `${pinned[2]}@${pinned[1]}`;
      if (ourDataIds.includes(dataIdFor(identity))) {
        return { owner: OWNER.OURS, identity, form: 'pinned', path: script };
      }
      return { owner: OWNER.MANAGED, identity, source: 'plugin-directory' };
    }
    const dataDir = path.dirname(script);
    if (path.basename(script) === SHIM_FILENAME && path.basename(path.dirname(dataDir)) === 'data') {
      const id = path.basename(dataDir);
      const present = existsSync(script);
      if ((present && isOurShimFile(script)) || (!present && ourDataIds.includes(id))) {
        return { owner: OWNER.OURS, identity: id, form: 'shim', path: script, present };
      }
    }
  }
  for (const k of knownManaged) {
    if (command.includes(k.match)) return { owner: OWNER.MANAGED, identity: k.id, source: 'declared' };
  }
  const area = PLUGIN_AREA.exec(script ?? command.replace(/\\\\/g, '\\'));
  if (area) {
    const identity = area[1] === 'cache' && area[3] ? `${area[3]}@${area[2]}` : area[2];
    return { owner: OWNER.MANAGED, identity, source: 'plugin-directory' };
  }
  return { owner: OWNER.USER, identity: null };
}

function replaceAllowed(cls, optin) {
  if (cls.owner === OWNER.EMPTY || cls.owner === OWNER.OURS) return true;
  if (cls.owner !== OWNER.MANAGED) return false;
  return optin.allowReplace.includes(OWNER.MANAGED) || optin.allowReplace.includes(cls.identity);
}

// ---------------------------------------------------------------------------
// Inspection

function shimSource() {
  return readFileSync(SHIM_SOURCE, 'utf8');
}

/** Read-only health report for one Claude config directory. Never writes. */
export function inspect(configDir, env = process.env) {
  configDir = path.resolve(configDir);
  const settingsPath = path.join(configDir, 'settings.json');
  const settings = readJsonObject(settingsPath);
  const resolution = resolveFor(configDir);
  const dataDir = dataDirFor(configDir, resolution, env);
  const dataId = dataDir ? path.basename(dataDir) : null;
  const optin = readOptin(dataDir);
  const ourDataIds = readInstalledPlugins(path.join(configDir, 'plugins'))
    .filter((r) => distUnder(r.installPath))
    .map((r) => r.dataId);
  if (dataId) ourDataIds.push(dataId);

  const statusLine = settings.value?.statusLine;
  const command = statusLine && typeof statusLine === 'object' ? statusLine.command ?? null : null;
  const cls = settings.state === 'ok' || settings.state === 'missing'
    ? classify(command, { ourDataIds, knownManaged: optin.knownManaged })
    : { owner: null, identity: null };
  const shim = dataDir ? path.join(dataDir, SHIM_FILENAME) : null;
  const shimPresent = !!shim && existsSync(shim);
  const shimCurrent = shimPresent && readFileSync(shim, 'utf8') === shimSource();
  const desiredCommand = shim ? shimCommand(shim) : null;

  const causes = [];
  if (settings.state === 'unparsable' || settings.state === 'unreadable') {
    causes.push({ type: 'settings-unparsable', evidence: settings.error });
  }
  if (!resolution) {
    causes.push({
      type: cls.owner === OWNER.OURS ? 'installation-removed' : 'no-build',
      evidence: `no dashboard build under ${path.join(configDir, 'plugins')} (installed_plugins.json or cache)`,
    });
  }
  if (cls.owner === OWNER.OURS) {
    if (cls.form === 'pinned') {
      causes.push({
        type: existsSync(cls.path) ? 'pinned-version' : 'installation-removed',
        evidence: cls.path,
      });
    } else if (desiredCommand && command !== desiredCommand) {
      causes.push({ type: 'identity-mismatch', evidence: `${cls.identity} != ${dataId}` });
    }
    if (cls.form === 'shim' && !cls.present) causes.push({ type: 'shim-missing', evidence: cls.path });
  }
  if (shim && !shimPresent && cls.owner === OWNER.OURS && command === desiredCommand) {
    causes.push({ type: 'shim-missing', evidence: shim });
  } else if (shimPresent && !shimCurrent) {
    causes.push({ type: 'shim-stale', evidence: shim });
  }
  if (cls.owner === OWNER.EMPTY) {
    causes.push(optin.installedCommand
      ? { type: 'whole-file-restoration', evidence: `statusLine absent; recorded ${optin.installedCommand}` }
      : { type: 'not-configured', evidence: settingsPath });
  }
  if ((cls.owner === OWNER.USER || cls.owner === OWNER.MANAGED) && optin.installedCommand) {
    causes.push({ type: 'ownership-contention', evidence: `${cls.owner}${cls.identity ? ` (${cls.identity})` : ''}` });
  }

  const typeOk = statusLine?.type === 'command';
  if (cls.owner === OWNER.OURS && command === desiredCommand && !typeOk) {
    causes.push({ type: 'status-line-type', evidence: String(statusLine?.type) });
  }
  const snapshotsPending = settings.state === 'ok' && desiredCommand
    ? pendingSnapshots(settingsPath, optin, desiredCommand, dataId)
    : [];
  if (snapshotsPending.length) causes.push({ type: 'snapshot-out-of-sync', evidence: snapshotsPending.join(', ') });
  const self = selfInstallation(configDir);
  const healthy = settings.state === 'ok' && !!resolution && cls.owner === OWNER.OURS &&
    command === desiredCommand && typeOk && shimCurrent && snapshotsPending.length === 0;
  return {
    configDir,
    settingsPath,
    settingsState: settings.state,
    command,
    owner: cls.owner,
    identity: cls.identity ?? null,
    dataDir,
    shim,
    shimPresent,
    shimCurrent,
    desiredCommand,
    resolves: resolution?.dist ?? null,
    resolvedFrom: resolution?.source ?? null,
    installation: resolution ? resolution.key : null,
    version: resolution?.version ?? null,
    optin: {
      file: optin.file,
      state: optin.state,
      autoRepair: optin.autoRepair,
      autoRepairEffective: autoRepairEnabled(optin, env),
      allowReplace: optin.allowReplace,
      syncGlobs: optin.syncGlobs,
      codex: optin.codex,
    },
    runningInstallation: self?.key ?? null,
    preferred: !self || !resolution || self.installPath === resolution.installPath,
    healthy,
    causes,
    _raw: settings.raw,
    _cls: cls,
    _optin: optin,
  };
}

function publicReport(report) {
  const { _raw, _cls, _optin, ...rest } = report;
  return rest;
}

// ---------------------------------------------------------------------------
// Repair

function syncShimTo(shim) {
  const content = shimSource();
  if (existsSync(shim) && readFileSync(shim, 'utf8') === content) return false;
  mkdirSync(path.dirname(shim), { recursive: true });
  atomicWrite(shim, content);
  return true;
}

async function verifyInstalledShim(shim) {
  const mod = await import(`${pathToFileURL(shim).href}?v=${Date.now()}`);
  return mod.resolveDashboard({ shimFile: shim })?.dist ?? null;
}

function writeStatusLine(settingsPath, rawBefore, desired, { backup: makeBackup = true } = {}) {
  const exists = rawBefore !== null;
  const current = exists ? readFileSync(settingsPath, 'utf8') : null;
  if (exists && current !== rawBefore) return { changed: false, deferred: 'changed-during-repair' };
  if (!exists && existsSync(settingsPath)) return { changed: false, deferred: 'changed-during-repair' };
  const settings = exists ? JSON.parse(rawBefore) : {};
  let target = settingsPath;
  let mode;
  let backup = null;
  if (exists) {
    ({ target, mode } = writeTarget(settingsPath));
    if (makeBackup) backup = backupBeside(target, rawBefore, mode);
  } else {
    mkdirSync(path.dirname(settingsPath), { recursive: true });
  }
  const statusLine = settings.statusLine && typeof settings.statusLine === 'object' ? settings.statusLine : {};
  statusLine.type = 'command';
  statusLine.command = desired;
  settings.statusLine = statusLine;
  atomicWrite(target, `${JSON.stringify(settings, null, jsonIndent(rawBefore))}\n`, mode);
  return { changed: true, backup };
}

function globToRegExp(glob) {
  const body = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/\\\\]*').replace(/\?/g, '[^/\\\\]');
  return new RegExp(`^${body}$`);
}

/**
 * Sibling files selected by the user's basename globs. Excludes settings.json itself,
 * temp files, and backups this script made of another matched file or of settings.json.
 */
function snapshotFiles(settingsPath, globs) {
  const dir = path.dirname(settingsPath);
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const present = new Set(names);
  const base = (name) =>
    name.endsWith(BACKUP_SUFFIX) ? name.slice(0, -BACKUP_SUFFIX.length)
      : name.endsWith('.bak') ? name.slice(0, -'.bak'.length) : null;
  const files = new Set();
  for (const glob of globs) {
    if (glob.includes('/') || glob.includes('\\')) continue;
    const re = globToRegExp(glob);
    for (const name of names) {
      const file = path.join(dir, name);
      if (!re.test(name) || file === settingsPath || name.endsWith('.tmp')) continue;
      if (base(name) !== null && present.has(base(name))) continue;
      files.add(file);
    }
  }
  return [...files];
}

/** Snapshot files whose status line is empty or ours but not yet the desired command. */
function pendingSnapshots(settingsPath, optin, desired, dataId) {
  if (!optin.syncGlobs.length) return [];
  return snapshotFiles(settingsPath, optin.syncGlobs).filter((file) => {
    const snap = readJsonObject(file);
    if (snap.state !== 'ok') return false;
    const command = snap.value.statusLine?.command ?? null;
    if (command === desired) return false;
    const cls = classify(command, { ourDataIds: dataId ? [dataId] : [], knownManaged: optin.knownManaged });
    return cls.owner === OWNER.EMPTY || cls.owner === OWNER.OURS;
  });
}

/**
 * Update statusLine in user-selected sibling snapshot files, so a later whole-file
 * restoration from them keeps the status line. Only basename globs in the settings
 * directory; only files whose own statusLine is empty or ours; each is backed up.
 */
function syncSnapshots(report, desired) {
  const results = [];
  for (const glob of report._optin.syncGlobs) {
    if (glob.includes('/') || glob.includes('\\')) results.push({ glob, skipped: 'only sibling basename globs are supported' });
  }
  for (const file of pendingSnapshots(report.settingsPath, report._optin, desired, path.basename(report.dataDir))) {
    const snap = readJsonObject(file);
    results.push({ file, ...writeStatusLine(file, snap.raw, desired) });
  }
  return results;
}

/**
 * Idempotent health check and repair for one config directory.
 *
 * trigger `command`: a user invoked it; repairs `empty` and broken `ours`, and a
 *   known-managed value only when the record allows that identity or class.
 * trigger `hook`: automatic; does nothing unless autoRepair is enabled.
 * replace: only `install` passes this, after the user agreed in setup; it allows
 *   replacing whatever currently owns statusLine. Repair itself never replaces `user`.
 */
export async function repair(configDir, { trigger = 'command', replace = false, env = process.env } = {}) {
  const before = inspect(configDir, env);
  const base = publicReport(before);
  if (trigger === 'hook' && !before.optin.autoRepairEffective) {
    return { code: 0, report: { ...base, action: 'disabled' } };
  }
  if (before.settingsState === 'unparsable' || before.settingsState === 'unreadable') {
    return { code: 2, report: { ...base, action: 'deferred', error: 'settings.json could not be parsed; nothing was written' } };
  }
  // Two installed copies (another marketplace, or an older session still running)
  // would otherwise take turns rewriting the shim and command. Only the installation
  // the resolver prefers repairs automatically.
  if (trigger === 'hook' && !before.preferred) {
    return { code: 0, report: { ...base, action: 'not-preferred' } };
  }
  if (!before.resolves || !before.shim) {
    return {
      code: 1,
      report: {
        ...base,
        action: 'blocked',
        error: `No dashboard build resolvable under ${path.join(before.configDir, 'plugins')}. ` +
          'Install or update the jstack plugin in this Claude config directory first.',
      },
    };
  }
  if (before.healthy) return { code: 0, report: { ...base, action: 'unchanged' } };

  const allowed = replace
    ? before.owner !== null
    : replaceAllowed(before._cls, before._optin);
  if (!allowed) {
    return {
      code: 3,
      report: {
        ...base,
        action: 'preserved',
        error: before.owner === OWNER.USER
          ? 'statusLine holds a user value; repair never replaces it. Nothing was written.'
          : `statusLine is managed by ${before.identity}; replacing it needs the user's explicit opt-in ` +
            `(optin --allow-replace ${before.identity}). Nothing was written.`,
      },
    };
  }

  const wroteShim = syncShimTo(before.shim);
  const renders = await verifyInstalledShim(before.shim);
  if (!renders) {
    return { code: 1, report: { ...base, action: 'blocked', error: `Installed shim ${before.shim} resolves no build` } };
  }

  let settingsResult = { changed: false, backup: null };
  if (before.command !== before.desiredCommand || before.causes.some((c) => c.type === 'status-line-type')) {
    settingsResult = writeStatusLine(before.settingsPath, before._raw, before.desiredCommand);
    if (settingsResult.deferred) {
      return { code: 2, report: { ...base, action: 'deferred', error: 'settings.json changed during repair; retry later' } };
    }
  }
  const snapshots = before._optin.syncGlobs.length ? syncSnapshots(before, before.desiredCommand) : [];
  if (before._optin.installedCommand !== before.desiredCommand && before._optin.state !== 'unparsable' &&
      before._optin.state !== 'unreadable') {
    writeOptin(before._optin, { installedCommand: before.desiredCommand });
  }

  const after = inspect(configDir, env);
  return {
    code: after.healthy ? 0 : 2,
    report: {
      ...publicReport(after),
      action: settingsResult.changed || wroteShim || snapshots.some((x) => x.changed) ? 'repaired' : 'unchanged',
      trigger,
      previousCommand: before.command,
      previousOwner: before.owner,
      previousCauses: before.causes,
      renders,
      backup: settingsResult.backup,
      snapshots,
    },
  };
}

/** First installation from setup: repair with the user's consent flags. */
export async function install(configDir, { replace = false, autoRepair = null, env = process.env } = {}) {
  const result = await repair(configDir, { trigger: 'command', replace, env });
  if (result.code === 0 && autoRepair !== null) {
    const report = inspect(configDir, env);
    writeOptin(report._optin, { autoRepair });
    result.report.optin = publicReport(inspect(configDir, env)).optin;
  }
  if (result.code === 3 && !replace) {
    result.report.error = `${result.report.error} Ask the user; after they agree, rerun install with --replace.`;
  }
  return result;
}

// Kept for callers of the earlier interface.
export function status(configDir, env = process.env) {
  return publicReport(inspect(configDir, env));
}

// ---------------------------------------------------------------------------
// Codex tui.status_line

const TOML_HEADER = /^\s*(\[\[?)\s*([^\]]+?)\s*(\]\]?)\s*(?:#.*)?$/;
const TOML_KEY = /^\s*((?:[A-Za-z0-9_-]+|"[^"]*"|'[^']*')(?:\s*\.\s*(?:[A-Za-z0-9_-]+|"[^"]*"|'[^']*'))*)\s*=\s*(.*)$/;

function normKey(key) {
  return key.split('.').map((part) => part.trim().replace(/^(["'])(.*)\1$/, '$2')).join('.');
}

/** Bracket depth change of a TOML value fragment, ignoring strings and comments. */
function scanValue(text, state) {
  for (let i = 0; i < text.length; i += 1) {
    if (state.multi) {
      if (text.startsWith(state.multi, i)) {
        i += state.multi.length - 1;
        state.multi = null;
      }
      continue;
    }
    const c = text[i];
    if (text.startsWith('"""', i) || text.startsWith("'''", i)) {
      state.multi = text.slice(i, i + 3);
      i += 2;
    } else if (c === '"') {
      for (i += 1; i < text.length && text[i] !== '"'; i += 1) if (text[i] === '\\') i += 1;
    } else if (c === "'") {
      for (i += 1; i < text.length && text[i] !== "'"; i += 1);
    } else if (c === '#') {
      break;
    } else if (c === '[' || c === '{') {
      state.depth += 1;
    } else if (c === ']' || c === '}') {
      state.depth -= 1;
    }
  }
}

/**
 * Line-level structure of a TOML file: enough to find tui.status_line and place one
 * safely. Anything it cannot place with certainty is reported as `unsupported`.
 */
export function analyzeCodexToml(text) {
  const lines = text.split(/\r?\n/);
  const state = { depth: 0, multi: null };
  const out = { lines, tuiHeaders: [], firstHeader: -1, statusLine: null, rootDottedTui: false, inlineTui: false, errors: [] };
  let table = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (state.multi || state.depth > 0) {
      scanValue(line, state);
      continue;
    }
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const header = TOML_HEADER.exec(line);
    if (header && trimmed.startsWith('[')) {
      if (header[1].length !== header[3].length) {
        out.errors.push(`line ${i + 1}: malformed table header`);
        continue;
      }
      table = header[1] === '[[' ? `[[${normKey(header[2])}]]` : normKey(header[2]);
      if (out.firstHeader < 0) out.firstHeader = i;
      if (table === 'tui') out.tuiHeaders.push(i);
      if (table === '[[tui]]') out.tuiArray = true;
      continue;
    }
    const kv = TOML_KEY.exec(line);
    if (!kv) {
      out.errors.push(`line ${i + 1}: not a key, table, or comment`);
      continue;
    }
    const key = normKey(kv[1]);
    const full = table ? `${table}.${key}` : key;
    if (full === 'tui.status_line') out.statusLine = { line: i, form: table ? 'table' : 'dotted' };
    if (!table && key.startsWith('tui.')) out.rootDottedTui = true;
    if (!table && key === 'tui') {
      out.inlineTui = true;
      if (/\bstatus_line\s*=/.test(kv[2])) out.statusLine = { line: i, form: 'inline' };
    }
    scanValue(kv[2], state);
    if (state.depth < 0) out.errors.push(`line ${i + 1}: unbalanced brackets`);
  }
  if (state.multi) out.errors.push('unterminated multi-line string');
  if (state.depth !== 0) out.errors.push('unterminated array or inline table');
  if (out.tuiHeaders.length > 1) out.errors.push('duplicate [tui] table');
  if (out.tuiArray) out.errors.push('[[tui]] array of tables');
  if (out.tuiHeaders.length && (out.rootDottedTui || out.inlineTui)) out.errors.push('[tui] defined twice');
  return out;
}

function statusLineValueText(analysis) {
  const at = analysis.statusLine;
  if (!at || at.form === 'inline') return null;
  const lines = [analysis.lines[at.line].replace(/^[^=]*=\s*/, '')];
  const state = { depth: 0, multi: null };
  scanValue(lines[0], state);
  for (let i = at.line + 1; (state.depth > 0 || state.multi) && i < analysis.lines.length; i += 1) {
    lines.push(analysis.lines[i]);
    scanValue(analysis.lines[i], state);
  }
  return lines.join('\n').replace(/\s*#[^\n\]]*$/, '').trim();
}

export function inspectCodex(home, optin = null) {
  const configPath = path.join(home, 'config.toml');
  if (!existsSync(home)) {
    return { codexHome: home, configPath, state: 'no-codex-home', present: false, statusLine: null, recorded: optin?.codexStatusLine ?? null, causes: [] };
  }
  if (!existsSync(configPath)) {
    return { codexHome: home, configPath, state: 'missing', present: false, statusLine: null, recorded: optin?.codexStatusLine ?? null, causes: [] };
  }
  let text;
  try {
    text = readFileSync(configPath, 'utf8');
  } catch (err) {
    return { codexHome: home, configPath, state: 'unreadable', present: false, error: String(err?.message ?? err), causes: [] };
  }
  const analysis = analyzeCodexToml(text);
  const present = !!analysis.statusLine;
  const causes = [];
  if (!present && optin?.codexStatusLine) {
    causes.push({ type: 'codex-status-line-lost', evidence: `tui.status_line absent; recorded ${optin.codexStatusLine}` });
  }
  return {
    codexHome: home,
    configPath,
    state: analysis.errors.length ? 'unsupported' : 'ok',
    errors: analysis.errors,
    present,
    form: analysis.statusLine?.form ?? null,
    statusLine: statusLineValueText(analysis),
    recorded: optin?.codexStatusLine ?? null,
    causes,
    _text: text,
    _analysis: analysis,
  };
}

function publicCodex(report) {
  const { _text, _analysis, ...rest } = report;
  return rest;
}

/**
 * Add tui.status_line when it is missing. Never replaces or reorders an existing
 * value, including one chosen through Codex's /statusline picker.
 */
export function repairCodex(home, optin = null, { record = false } = {}) {
  const before = inspectCodex(home, optin);
  const base = publicCodex(before);
  if (before.state === 'unreadable') return { code: 2, report: { ...base, action: 'deferred' } };
  if (before.state === 'no-codex-home') {
    return { code: 0, report: { ...base, action: 'skipped', error: 'Codex home not found; Codex configuration is not created here' } };
  }
  if (before.state === 'unsupported') {
    return { code: 4, report: { ...base, action: 'deferred', error: 'config.toml layout not edited automatically; nothing was written' } };
  }
  if (before.present) {
    // Only an explicit user command records the layout; automatic runs never write
    // when the key is present.
    if (record && optin?.file && before.statusLine && optin.codexStatusLine !== before.statusLine) {
      writeOptin(optin, { codexStatusLine: before.statusLine });
    }
    return { code: 0, report: { ...base, action: 'unchanged' } };
  }
  const value = optin?.codexStatusLine || CODEX_DEFAULT_STATUS_LINE;
  const text = before._text ?? '';
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text === '' ? [] : text.split(/\r?\n/);
  const a = before._analysis ?? analyzeCodexToml('');
  let next;
  if (a.tuiHeaders.length === 1) {
    next = [...lines.slice(0, a.tuiHeaders[0] + 1), `status_line = ${value}`, ...lines.slice(a.tuiHeaders[0] + 1)];
  } else if (a.inlineTui) {
    return { code: 4, report: { ...base, action: 'deferred', error: 'tui is an inline table; nothing was written' } };
  } else if (a.rootDottedTui) {
    const at = a.firstHeader < 0 ? lines.length : a.firstHeader;
    next = [...lines.slice(0, at), `tui.status_line = ${value}`, ...lines.slice(at)];
  } else {
    const body = lines.length && lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines;
    next = [...body, ...(body.length ? [''] : []), '[tui]', `status_line = ${value}`, ''];
  }
  const content = next.join(eol);
  const check = analyzeCodexToml(content);
  if (check.errors.length || !check.statusLine || check.tuiHeaders.length > 1) {
    return { code: 4, report: { ...base, action: 'deferred', error: `validation failed: ${check.errors.join('; ') || 'status_line not found'}` } };
  }
  const configPath = before.configPath;
  let target = configPath;
  let mode;
  let backup = null;
  if (before.state === 'ok') {
    if (readFileSync(configPath, 'utf8') !== text) {
      return { code: 2, report: { ...base, action: 'deferred', error: 'config.toml changed during repair; retry later' } };
    }
    ({ target, mode } = writeTarget(configPath));
    backup = backupBeside(target, text, mode);
  }
  atomicWrite(target, content, mode);
  const after = inspectCodex(home, optin);
  return {
    code: after.present && after.state === 'ok' ? 0 : 2,
    report: { ...publicCodex(after), action: 'repaired', inserted: value, backup },
  };
}

// ---------------------------------------------------------------------------
// Watch adapter (optional; no OS service required)

/**
 * Foreground watcher. A file-change event waits briefly for the writer to finish,
 * then rereads; a periodic pass covers replacement-by-rename that a watcher misses.
 * Repairs only when autoRepair is enabled, and prints one line only when it acts.
 */
export function watch(configDirs, { intervalSeconds = 300, settleMs = 750, env = process.env } = {}) {
  const timers = new Map();
  const run = async (dir) => {
    try {
      const { report } = await repair(dir, { trigger: 'hook', env });
      if (report.action === 'repaired') console.log(JSON.stringify({ configDir: dir, action: report.action, causes: report.previousCauses }));
    } catch {
      // A failed pass retries at the next event or interval.
    }
  };
  const schedule = (dir) => {
    clearTimeout(timers.get(dir));
    timers.set(dir, setTimeout(() => run(dir), settleMs));
  };
  const watchers = [];
  for (const dir of configDirs) {
    try {
      watchers.push(fsWatch(dir, (_event, name) => {
        if (!name || String(name).startsWith('settings.json')) schedule(dir);
      }));
    } catch {
      // Directory missing or unwatchable: the periodic pass still runs.
    }
    run(dir);
  }
  const interval = setInterval(() => configDirs.forEach(run), Math.max(10, intervalSeconds) * 1000);
  return () => {
    clearInterval(interval);
    watchers.forEach((w) => w.close());
    timers.forEach((t) => clearTimeout(t));
  };
}

// ---------------------------------------------------------------------------
// CLI

function parseArgs(argv) {
  const [action, ...rest] = argv;
  const o = {
    action,
    sub: null,
    configDirs: [],
    codexHome: null,
    replace: false,
    autoRepair: null,
    trigger: 'command',
    codex: null,
    allowReplace: [],
    denyReplace: [],
    syncGlobs: [],
    clearSyncGlobs: false,
    knownManaged: [],
    interval: 300,
  };
  const onOff = (v) => (v === 'on' ? true : v === 'off' ? false : undefined);
  let i = 0;
  if (action === 'codex') {
    o.sub = rest[0];
    i = 1;
    if (!['status', 'repair'].includes(o.sub)) return null;
  }
  for (; i < rest.length; i += 1) {
    const flag = rest[i];
    const next = rest[i + 1];
    const needs = () => {
      if (next === undefined) throw new Error(`${flag} needs a value`);
      i += 1;
      return next;
    };
    try {
      if (flag === '--config-dir') o.configDirs.push(path.resolve(needs()));
      else if (flag === '--codex-home') o.codexHome = path.resolve(needs());
      else if (flag === '--replace') o.replace = true;
      else if (flag === '--auto-repair') {
        o.autoRepair = onOff(needs());
        if (o.autoRepair === undefined) return null;
      } else if (flag === '--trigger') {
        o.trigger = needs();
        if (!['command', 'hook'].includes(o.trigger)) return null;
      } else if (flag === '--codex') {
        if (action === 'optin') {
          o.codex = onOff(needs());
          if (o.codex === undefined) return null;
        } else o.codex = true;
      } else if (flag === '--allow-replace') o.allowReplace.push(needs());
      else if (flag === '--deny-replace') o.denyReplace.push(needs());
      else if (flag === '--sync-glob') o.syncGlobs.push(needs());
      else if (flag === '--clear-sync-globs') o.clearSyncGlobs = true;
      else if (flag === '--known-managed') {
        const [id, ...match] = needs().split('=');
        if (!id || !match.join('=')) return null;
        o.knownManaged.push({ id, match: match.join('=') });
      } else if (flag === '--interval') o.interval = Number(needs());
      else return null;
    } catch {
      return null;
    }
  }
  if (!['status', 'install', 'repair', 'optin', 'codex', 'watch'].includes(action)) return null;
  if (['install', 'optin'].includes(action) && o.configDirs.length > 1) return null;
  if (action === 'install' && o.trigger !== 'command') return null;
  return o;
}

async function main(argv, env = process.env) {
  const o = parseArgs(argv);
  if (!o) {
    return {
      code: 2,
      stderr: 'usage: install-statusline.mjs status|install|repair|optin|watch [--config-dir DIR]... | codex status|repair [--codex-home DIR]',
    };
  }
  const dirs = o.configDirs.length ? o.configDirs : [claudeConfigDir(env)];
  const cxHome = o.codexHome ?? codexHome(env);

  if (o.action === 'status') {
    const reports = dirs.map((d) => status(d, env));
    const first = inspect(dirs[0], env);
    const codex = publicCodex(inspectCodex(cxHome, first._optin));
    const out = reports.length === 1 ? { ...reports[0], codex } : { homes: reports, codex };
    return { code: 0, out };
  }
  if (o.action === 'install') {
    const { code, report } = await install(dirs[0], { replace: o.replace, autoRepair: o.autoRepair, env });
    return { code, out: report };
  }
  if (o.action === 'repair') {
    const results = [];
    let code = 0;
    for (const dir of dirs) {
      const r = await repair(dir, { trigger: o.trigger, env });
      results.push(r.report);
      code = Math.max(code, r.code);
      const optin = inspect(dir, env)._optin;
      const wantCodex = o.codex === true || (optin.codex && (o.trigger === 'command' || autoRepairEnabled(optin, env)));
      if (wantCodex && dir === dirs[0]) {
        const c = repairCodex(cxHome, optin);
        r.report.codex = c.report;
        code = Math.max(code, c.code);
      }
    }
    if (o.trigger === 'hook') return { code: 0, out: null };
    return { code, out: results.length === 1 ? results[0] : { homes: results } };
  }
  if (o.action === 'optin') {
    const report = inspect(dirs[0], env);
    const optin = report._optin;
    if (!optin.file) {
      return { code: 1, out: { ...publicReport(report), error: 'No installed dashboard build; install the jstack plugin in this config directory first.' } };
    }
    const changes = {};
    if (o.autoRepair !== null) changes.autoRepair = o.autoRepair;
    if (o.codex !== null) changes.codex = o.codex;
    if (o.allowReplace.length || o.denyReplace.length) {
      changes.allowReplace = [...new Set([...optin.allowReplace, ...o.allowReplace])]
        .filter((id) => !o.denyReplace.includes(id));
    }
    if (o.clearSyncGlobs || o.syncGlobs.length) {
      changes.syncGlobs = [...new Set([...(o.clearSyncGlobs ? [] : optin.syncGlobs), ...o.syncGlobs])];
    }
    if (o.knownManaged.length) changes.knownManaged = [...optin.knownManaged, ...o.knownManaged];
    if (o.codex === true) {
      const c = inspectCodex(cxHome, optin);
      if (c.statusLine) changes.codexStatusLine = c.statusLine;
    }
    const wrote = Object.keys(changes).length ? writeOptin(optin, changes) : false;
    return { code: 0, out: { ...publicReport(inspect(dirs[0], env)).optin, changed: wrote } };
  }
  if (o.action === 'codex') {
    const optin = inspect(dirs[0], env)._optin;
    if (o.sub === 'status') return { code: 0, out: publicCodex(inspectCodex(cxHome, optin)) };
    const { code, report } = repairCodex(cxHome, optin, { record: optin.codex });
    return { code, out: report };
  }
  if (o.action === 'watch') {
    watch(dirs, { intervalSeconds: o.interval, env });
    return { code: null, out: null };
  }
  return { code: 2, stderr: 'unreachable' };
}

function isInvokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(path.resolve(process.argv[1])) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isInvokedDirectly()) {
  try {
    const { code, out, stderr } = await main(process.argv.slice(2));
    if (stderr) console.error(stderr);
    if (out) console.log(JSON.stringify(out, null, 2));
    if (code !== null) process.exitCode = code;
  } catch (err) {
    console.log(JSON.stringify({ error: String(err?.message ?? err) }, null, 2));
    process.exitCode = 2;
  }
}
