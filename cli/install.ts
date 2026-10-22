import { createHash, randomUUID } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { CLAUDE_ID, CODEX_ID, MARKETPLACE, command, hostIsStopped, listPlugins, locations, requestedHosts, jstackRows } from './hosts.js';
import type { Host, HostOptions, PluginRow } from './hosts.js';

export interface LifecycleOptions extends HostOptions { sourceRoot?: string; version?: string; from?: string }
interface Deployment { version: string; digest: string; target: string; pluginId: string; previous?: string }
interface Receipt { schemaVersion: 1; hosts: Partial<Record<Host, Deployment>> }
export interface HostState { host: Host; installed: boolean; discovered: boolean; version?: string; digest?: string; hookTrust: 'not-verified'; restartRequired: boolean; restoredPluginId?: string; error?: string }
export interface LifecycleResult { ok: boolean; hosts: HostState[]; recoveryRequired?: string[] }
interface Snapshot { version: string; digest: string; root: string }
const RECEIPT = 'installation.json';
const owner = () => ({ pid: process.pid, hostname: hostname(), startedAt: new Date().toISOString() });

function json(path: string): any { return JSON.parse(readFileSync(path, 'utf8')); }
function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, path);
}

/** Hash relative names and bytes; links and special files are never installer input. */
export function treeDigest(root: string): string {
  const hash = createHash('sha256');
  function walk(path: string) {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error(`Symlinks are not supported: ${path}`);
    if (stat.isDirectory()) for (const entry of readdirSync(path).sort()) walk(join(path, entry));
    else if (stat.isFile()) {
      hash.update(relative(root, path).split(sep).join('/')); hash.update('\0');
      hash.update(readFileSync(path)); hash.update('\0');
    } else throw new Error(`Unsupported package entry: ${path}`);
  }
  walk(root);
  return hash.digest('hex');
}

function safeVersion(value: string): string {
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value)) throw new Error(`Invalid version: ${value}`);
  return value;
}
function receipt(options: LifecycleOptions): Receipt {
  const path = join(locations(options).root, RECEIPT);
  if (!existsSync(path)) return { schemaVersion: 1, hosts: {} };
  const value = json(path);
  if (value.schemaVersion !== 1 || !value.hosts || typeof value.hosts !== 'object') throw new Error('Unsupported installation receipt');
  return value;
}
function save(options: LifecycleOptions, value: Receipt) { writeJson(join(locations(options).root, RECEIPT), value); }

function lock<T>(options: LifecycleOptions, run: () => T): T {
  const root = locations(options).root;
  noLinkedAncestors(root, locations(options).home);
  for (const name of ['versions', 'transactions', 'installation.json', 'marketplace', 'install.lock', 'recovery.lock']) noLinkedAncestors(join(root, name), root);
  mkdirSync(root, { recursive: true });
  if (existsSync(join(root, 'recovery.lock'))) throw new Error('Another recovery operation is active; preserve its lock');
  const pending = pendingTransactions(options);
  if (pending.length) throw new Error(`An interrupted transaction requires inspection before another mutation: ${pending.join(', ')}`);
  const path = join(root, 'install.lock');
  try { mkdirSync(path); } catch { throw new Error(`Another lifecycle operation is active, or a previous operation was interrupted: ${path}. Inspect its journal before removing the lock.`); }
  writeJson(join(path, 'owner.json'), owner());
  try {
    if (existsSync(join(root, 'recovery.lock'))) throw new Error('Recovery acquired the lifecycle guard; retry later');
    return run();
  } finally { rmSync(path, { recursive: true, force: true }); }
}

function pendingTransactions(options: LifecycleOptions): string[] {
  const root = join(locations(options).root, 'transactions');
  if (!existsSync(root)) return [];
  return readdirSync(root).filter(name => name.endsWith('.json')).map(name => join(root, name))
    .filter(path => !['committed', 'rolled-back'].includes(json(path).status));
}

function stage(options: LifecycleOptions): Snapshot {
  if (!options.sourceRoot) throw new Error('sourceRoot is required for install/update');
  const source = resolve(options.sourceRoot);
  const claude = json(join(source, '.claude-plugin/plugin.json'));
  const codex = json(join(source, '.codex-plugin/plugin.json'));
  const version = safeVersion(claude.version);
  if (claude.name !== 'jstack' || codex.name !== 'jstack' || codex.version !== version) throw new Error('The bundle must contain matching jstack manifests for both hosts');
  if (options.version && options.version !== version) throw new Error('Requested version differs from bundled version');
  const digest = treeDigest(source);
  const root = join(locations(options).root, 'versions', version);
  if (existsSync(root)) {
    if (treeDigest(root) !== digest) throw new Error(`Immutable version ${version} already exists with different bytes`);
  } else {
    mkdirSync(dirname(root), { recursive: true });
    const temp = `${root}.${randomUUID()}.tmp`;
    try { cpSync(source, temp, { recursive: true, errorOnExist: true, force: false });
      if (treeDigest(temp) !== digest) throw new Error('Bundle changed while copying');
      renameSync(temp, root);
    } finally { rmSync(temp, { recursive: true, force: true }); }
  }
  const evidence = join(locations(options).root, 'version-receipts', `${version}.json`);
  if (existsSync(evidence) && json(evidence).digest !== digest) throw new Error(`Retained version ${version} differs from its receipt`);
  writeJson(evidence, { version, digest });
  return { root, digest, version };
}

function retained(options: LifecycleOptions, version: string): Snapshot {
  const root = join(locations(options).root, 'versions', safeVersion(version));
  const digest = treeDigest(root);
  const evidence = json(join(locations(options).root, 'version-receipts', `${version}.json`));
  if (evidence.version !== version || evidence.digest !== digest) throw new Error('Retained package bytes differ from their installation receipt');
  const manifest = json(join(root, '.claude-plugin/plugin.json'));
  if (manifest.version !== version || manifest.name !== 'jstack') throw new Error('Retained package identity mismatch');
  return { root, version, digest };
}
function target(options: LifecycleOptions, host: Host): string {
  return join(locations(options).root, 'marketplace', 'plugins', host, 'jstack');
}
function ensureOwned(options: LifecycleOptions, host: Host, deployment?: Deployment) {
  const path = target(options, host);
  noLinkedAncestors(path, locations(options).root);
  if (deployment && resolve(deployment.target) !== resolve(path)) throw new Error(`${host}: configured home differs from installation receipt`);
  if (existsSync(path)) {
    if (!deployment) throw new Error(`${host}: existing unowned path preserved: ${path}`);
    if (treeDigest(path) !== deployment.digest) throw new Error(`${host}: managed files were modified; preserved ${path}`);
  } else if (deployment) throw new Error(`${host}: managed installation is missing; inspect doctor output`);
}
function conflicts(options: LifecycleOptions, host: Host, previous?: Deployment): PluginRow[] {
  const ownId = host === 'claude' ? CLAUDE_ID : CODEX_ID;
  return jstackRows(listPlugins(options, host)).filter(row => row.enabled && (row.id !== ownId || !previous));
}

function marketplace(options: LifecycleOptions, host: Host) {
  const root = join(locations(options).root, 'marketplace');
  const path = host === 'claude' ? join(root, '.claude-plugin', 'marketplace.json') : join(root, '.agents', 'plugins', 'marketplace.json');
  noLinkedAncestors(path, locations(options).root);
  const contents = host === 'claude'
    ? { name: MARKETPLACE, owner: { name: 'jstack' }, plugins: [{ name: 'jstack', source: './plugins/claude/jstack' }] }
    : { name: MARKETPLACE, interface: { displayName: 'jstack' }, plugins: [{ name: 'jstack', source: { source: 'local', path: './plugins/codex/jstack' }, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity' }] };
  if (existsSync(path) && JSON.stringify(json(path)) !== JSON.stringify(contents)) throw new Error('Managed marketplace was modified; preserving it');
  writeJson(path, contents);
  try { command(options, host, ['plugin', 'marketplace', 'add', root]); }
  catch (error) {
    if (!/already (?:exists|added|registered)/i.test(String(error))) throw error;
  }
}

function register(options: LifecycleOptions, host: Host, snapshot: Snapshot, updating = false, obsoleteId?: string): void {
  marketplace(options, host);
  if (host === 'codex') {
    const result = JSON.parse(command(options, host, ['plugin', 'add', CODEX_ID, '--json']));
    if (result.pluginId !== CODEX_ID || result.version !== snapshot.version || typeof result.installedPath !== 'string') throw new Error('Codex returned an unexpected installation identity');
    if (treeDigest(result.installedPath) !== snapshot.digest) throw new Error('Codex cached package does not match the release');
  } else {
    const action = updating ? 'update' : 'install';
    command(options, host, ['plugin', action, CLAUDE_ID, '--scope', 'user', '--json', '--yes']);
  }
  if (obsoleteId && obsoleteId !== (host === 'claude' ? CLAUDE_ID : CODEX_ID)) {
    try { command(options, host, ['plugin', host === 'claude' ? 'uninstall' : 'remove', obsoleteId, ...(host === 'claude' ? ['--scope', 'user'] : []), '--json']); }
    catch (error) { if (!/not installed|not found/i.test(String(error))) throw error; }
  }
  const ownId = host === 'claude' ? CLAUDE_ID : CODEX_ID;
  const active = jstackRows(listPlugins(options, host)).filter(row => row.enabled);
  if (active.length !== 1 || active[0]?.id !== ownId || active[0]?.version !== snapshot.version) throw new Error(`${host}: expected one active ${ownId} at ${snapshot.version}`);
}

function deploy(options: LifecycleOptions, host: Host, snapshot: Snapshot, state: Receipt, transaction?: { journal: string; parent: string }): HostState {
  const recorded = state.hosts[host];
  const path = target(options, host);
  const legacy = recorded && (resolve(recorded.target) !== resolve(path) || recorded.pluginId !== (host === 'claude' ? CLAUDE_ID : CODEX_ID)) ? recorded : undefined;
  const previous = legacy ? undefined : recorded;
  if (legacy) {
    const boundary = resolve(legacy.target).startsWith(`${resolve(locations(options).root)}${sep}`)
      ? locations(options).root : (host === 'claude' ? locations(options).claude : locations(options).root);
    noLinkedAncestors(legacy.target, boundary);
    if (!existsSync(legacy.target) || treeDigest(legacy.target) !== legacy.digest) throw new Error(`${host}: legacy managed files differ from their receipt; preserved`);
  } else ensureOwned(options, host, previous);
  const ownIds = new Set([host === 'claude' ? CLAUDE_ID : CODEX_ID, legacy?.pluginId]);
  const collision = jstackRows(listPlugins(options, host)).filter(row => row.enabled && (!ownIds.has(row.id) || (!previous && !legacy)));
  if (collision.length) throw new Error(`${host}: existing active jstack installation preserved: ${collision.map(row => row.id).join(', ')}. Use explicit migrate.`);
  mkdirSync(dirname(path), { recursive: true });
  // Backups must never sit under a host's skill discovery directory: Claude
  // discovers every sibling manifest, including a renamed previous deployment.
  const scratch = join(dirname(dirname(path)), '.jstack-lifecycle', randomUUID());
  noLinkedAncestors(scratch, locations(options).root);
  mkdirSync(scratch, { recursive: true });
  const temp = join(scratch, 'new'), backup = join(scratch, 'old'), legacyBackup = join(scratch, 'legacy');
  cpSync(snapshot.root, temp, { recursive: true });
  if (treeDigest(temp) !== snapshot.digest) throw new Error('Deployment copy verification failed');
  const journal = transaction?.journal ?? join(locations(options).root, 'transactions', `${randomUUID()}.json`);
  const entry = { owner: owner(), parent: transaction?.parent, operation: 'deploy', host, target: path, backup, temporary: temp, previous, next: snapshot.version, digest: snapshot.digest, status: 'prepared' };
  writeJson(journal, entry);
  let replaced = false, activated = false, legacyMoved = false;
  try {
    if (legacy) { renameSync(legacy.target, legacyBackup); legacyMoved = true; }
    if (existsSync(path)) { renameSync(path, backup); replaced = true; }
    renameSync(temp, path); activated = true;
    writeJson(journal, { ...entry, status: 'activating' });
    register(options, host, snapshot, Boolean(previous), legacy?.pluginId);
    state.hosts[host] = { version: snapshot.version, digest: snapshot.digest, target: path, pluginId: host === 'claude' ? CLAUDE_ID : CODEX_ID,
      previous: recorded?.version !== snapshot.version ? recorded?.version : recorded?.previous };
    save(options, state);
    writeJson(journal, { ...entry, status: 'committed' });
    // Retain previous bytes outside discovery; open sessions may still reference them.
    return { host, installed: true, discovered: true, version: snapshot.version, digest: snapshot.digest, hookTrust: 'not-verified', restartRequired: true };
  } catch (error) {
    const failures: string[] = [];
    try {
      if (activated && existsSync(path)) {
        if (treeDigest(path) !== snapshot.digest) throw new Error('Activation changed managed files; compensation preserved them');
        renameSync(path, join(scratch, `failed-${randomUUID()}`));
      }
      if (replaced) {
        if (!previous || treeDigest(backup) !== previous.digest || existsSync(path)) throw new Error('Cannot prove safe backup restoration; files preserved');
        renameSync(backup, path);
      }
      if (legacyMoved) {
        const ownedLegacy = legacy!;
        if (existsSync(ownedLegacy.target) || treeDigest(legacyBackup) !== ownedLegacy.digest) throw new Error('Cannot prove safe legacy restoration; files preserved');
        renameSync(legacyBackup, ownedLegacy.target);
      }
      if (legacy) {
        const active = jstackRows(listPlugins(options, host)).filter(row => row.enabled);
        if (!active.some(row => row.id === legacy.pluginId && row.version === legacy.version)) throw new Error('Legacy host registration was not preserved');
      } else if (host === 'codex' || host === 'claude') {
        if (previous) register(options, host, retained(options, previous.version), true);
        else {
          if (!hostIsStopped(options, host)) throw new Error(`Close ${host} sessions before recovery; cache removal deferred`);
          command(options, host, ['plugin', host === 'claude' ? 'uninstall' : 'remove', host === 'claude' ? CLAUDE_ID : CODEX_ID, '--scope', 'user', '--json']);
        }
      }
      if (recorded) state.hosts[host] = recorded; else delete state.hosts[host];
      save(options, state);
    } catch (compensation) { failures.push(String(compensation)); }
    writeJson(journal, { ...entry, status: failures.length ? 'recovery-required' : 'rolled-back', error: String(error), recoveryErrors: failures });
    throw new Error(`${String(error)}${failures.length ? `; recovery required: ${failures.join('; ')}; see ${journal}` : '; previous deployment restored'}`);
  } finally {
    rmSync(temp, { recursive: true, force: true });
    if (!existsSync(backup)) rmSync(scratch, { recursive: true, force: true });
  }
}

function prepareHomes(options: LifecycleOptions, hosts: Host[]) {
  for (const host of hosts) { const path = locations(options)[host]; noLinkedAncestors(path, path); mkdirSync(path, { recursive: true }); }
}
function execute(options: LifecycleOptions, select: (state: Receipt, host: Host) => Snapshot): LifecycleResult {
  return lock(options, () => {
    const state = receipt(options), hosts = requestedHosts(options);
    prepareHomes(options, hosts);
    const results = hosts.map(host => {
      try { return deploy(options, host, select(state, host), state); }
      catch (error) { return { host, installed: Boolean(state.hosts[host]), discovered: false, version: state.hosts[host]?.version, hookTrust: 'not-verified' as const, restartRequired: false, error: String(error) }; }
    });
    return { ok: results.every(row => !row.error), hosts: results };
  });
}
export function install(options: LifecycleOptions = {}): LifecycleResult {
  let snapshot: Snapshot | undefined;
  return execute(options, () => snapshot ??= stage(options));
}
export function update(options: LifecycleOptions = {}): LifecycleResult {
  let snapshot: Snapshot | undefined;
  return execute(options, (state, host) => { if (!state.hosts[host]) throw new Error(`${host}: install before updating`); return snapshot ??= stage(options); });
}
export function rollback(options: LifecycleOptions = {}): LifecycleResult {
  return execute(options, (state, host) => {
    const version = options.version ?? state.hosts[host]?.previous;
    if (!state.hosts[host] || !version) throw new Error(`${host}: no retained rollback version`);
    return retained(options, version);
  });
}
export function status(options: LifecycleOptions = {}): LifecycleResult {
  const state = receipt(options);
  const hosts = requestedHosts(options).map(host => {
    const deployment = state.hosts[host];
    // A fresh CLI list proves discovery, not whether an already-open session
    // has reloaded. Keep the restart requirement conservative in status output.
    const result: HostState = { host, installed: Boolean(deployment), discovered: false, version: deployment?.version, digest: deployment?.digest, hookTrust: 'not-verified', restartRequired: Boolean(deployment) };
    try {
      if (deployment) {
        ensureOwned(options, host, deployment);
        const active = jstackRows(listPlugins(options, host)).filter(row => row.enabled);
        result.discovered = active.length === 1 && active[0]?.id === deployment.pluginId && active[0]?.version === deployment.version;
        if (!result.discovered) result.error = 'Host discovery differs from installation receipt';
      } else {
        const active = jstackRows(listPlugins(options, host)).filter(row => row.enabled);
        if (active.length) result.error = `jstack is installed outside this manager: ${active.map(row => row.id).join(', ')}`;
      }
    } catch (error) { result.error = String(error); }
    return result;
  });
  const recoveryRequired = pendingTransactions(options);
  return { ok: hosts.every(row => !row.error) && !recoveryRequired.length, hosts, ...(recoveryRequired.length ? { recoveryRequired } : {}) };
}
export function doctor(options: LifecycleOptions = {}): LifecycleResult { return status(options); }
export function uninstall(options: LifecycleOptions = {}): LifecycleResult {
  return lock(options, () => {
    const state = receipt(options);
    const hosts = requestedHosts(options).map(host => {
      try {
        const deployment = state.hosts[host];
        if (deployment) {
          ensureOwned(options, host, deployment);
          if (host === 'codex' && !hostIsStopped(options, host)) throw new Error('Close Codex sessions and retry uninstall; destructive cache removal deferred');
          const backup = join(dirname(dirname(deployment.target)), '.jstack-lifecycle', randomUUID(), 'removed');
          noLinkedAncestors(backup, locations(options).root);
          mkdirSync(dirname(backup), { recursive: true });
          const journal = join(locations(options).root, 'transactions', `${randomUUID()}.json`);
          const entry = { owner: owner(), operation: 'uninstall', host, target: deployment.target, backup, previous: deployment };
          writeJson(journal, { ...entry, status: 'prepared' });
          let moved = false, unregistered = false;
          try {
            command(options, host, ['plugin', host === 'claude' ? 'uninstall' : 'remove', host === 'claude' ? CLAUDE_ID : CODEX_ID, ...(host === 'claude' ? ['--scope', 'user'] : []), '--json']); unregistered = true;
            renameSync(deployment.target, backup); moved = true;
            if (jstackRows(listPlugins(options, host)).some(row => row.id === deployment.pluginId && row.enabled)) throw new Error('Host still discovers the removed plugin');
            delete state.hosts[host]; save(options, state);
            writeJson(journal, { ...entry, status: 'committed' });
            // Preserve the removed deployment outside discovery; no eager garbage collection.
          } catch (error) {
            const recoveryErrors: string[] = [];
            try {
              if (moved) renameSync(backup, deployment.target);
              if (unregistered) register(options, host, retained(options, deployment.version));
              state.hosts[host] = deployment; save(options, state);
            } catch (recovery) { recoveryErrors.push(String(recovery)); }
            writeJson(journal, { ...entry, status: recoveryErrors.length ? 'recovery-required' : 'rolled-back', error: String(error), recoveryErrors });
            throw new Error(`${String(error)}${recoveryErrors.length ? `; recovery required: ${journal}` : '; previous deployment restored'}`);
          }
        }
        return { host, installed: false, discovered: false, hookTrust: 'not-verified' as const, restartRequired: true };
      } catch (error) { return { host, installed: Boolean(state.hosts[host]), discovered: false, hookTrust: 'not-verified' as const, restartRequired: true, error: String(error) }; }
    });
    return { ok: hosts.every(row => !row.error), hosts };
  });
}

/** Migration is explicit and limited to a single user-scoped legacy Claude identity. */
export function migrate(options: LifecycleOptions = {}): LifecycleResult {
  if (!options.from) throw new Error('migrate requires an explicit legacy plugin identity in from');
  if (requestedHosts(options).some(host => host !== 'claude')) throw new Error('Codex migration requires a separately reviewed registration transition; no existing installation was changed');
  return lock(options, () => {
    const state = receipt(options);
    prepareHomes(options, ['claude']);
    const existing = jstackRows(listPlugins(options, 'claude')).filter(row => row.enabled);
    if (existing.length !== 1 || existing[0]?.id !== options.from || existing[0]?.scope !== 'user') throw new Error('Migration requires exactly the specified active user-scoped jstack plugin');
    if (state.hosts.claude) throw new Error('Claude already has a managed deployment; migration only accepts an unmanaged legacy installation');
    ensureOwned(options, 'claude');
    const snapshot = stage(options);
    const journal = join(locations(options).root, 'transactions', `${randomUUID()}.json`);
    const child = join(locations(options).root, 'transactions', `${randomUUID()}.json`);
    const entry = { owner: owner(), operation: 'migrate', host: 'claude', from: options.from, previous: existing[0], next: snapshot.version, digest: snapshot.digest, child };
    writeJson(journal, { ...entry, status: 'prepared' });
    try {
      command(options, 'claude', ['plugin', 'disable', options.from, '--scope', 'user']);
      const result = deploy(options, 'claude', snapshot, state, { journal: child, parent: journal });
      writeJson(journal, { ...entry, status: 'committed' });
      return { ok: true, hosts: [result] };
    } catch (error) {
      try {
        command(options, 'claude', ['plugin', 'enable', options.from, '--scope', 'user']);
        writeJson(journal, { ...entry, status: 'rolled-back', error: String(error) });
      } catch (recovery) {
        writeJson(journal, { ...entry, status: 'recovery-required', error: String(error), recoveryError: String(recovery) });
        throw new Error(`${String(error)}; legacy activation recovery required: ${journal}`);
      }
      throw error;
    }
  });
}

function stoppedOwner(value: any): void {
  if (!value || value.hostname !== hostname() || !Number.isSafeInteger(value.pid) || value.pid <= 0) throw new Error('Cannot establish interrupted owner identity; lock preserved');
  try { process.kill(value.pid, 0); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return; throw new Error('Cannot establish owner cessation; lock preserved'); }
  throw new Error('Transaction owner is still live; lock preserved');
}
function noLinkedAncestors(path: string, boundary: string): void {
  if (resolve(path) !== resolve(boundary) && !resolve(path).startsWith(`${resolve(boundary)}${sep}`)) throw new Error('Recovery path escaped its ownership boundary');
  for (let current = resolve(path); ; current = dirname(current)) {
    let entry; try { entry = lstatSync(current); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (entry?.isSymbolicLink()) throw new Error(`Linked installer path preserved: ${current}`);
    if (current === resolve(boundary)) break;
  }
}

/** Explicit interrupted-operation recovery. Always restores the last receipt-backed deployment. */
export function recover(options: LifecycleOptions = {}): LifecycleResult {
  const root = locations(options).root, lockPath = join(root, 'install.lock'), guard = join(root, 'recovery.lock');
  noLinkedAncestors(root, locations(options).home);
  mkdirSync(root, { recursive: true });
  try { mkdirSync(guard); } catch { throw new Error('Another recovery operation is active; preserve its lock'); }
  try {
    if (existsSync(lockPath)) { noLinkedAncestors(lockPath, root); stoppedOwner(json(join(lockPath, 'owner.json'))); }
    const journals = pendingTransactions(options);
    // A migration's enable compensation may finish while deployment compensation
    // remains pending. Reconcile its recorded parent even if it was marked terminal.
    for (const path of [...journals]) {
      const entry = json(path);
      if (entry.operation === 'deploy' && entry.parent !== undefined) {
        if (typeof entry.parent !== 'string' || dirname(entry.parent) !== join(root, 'transactions') || !/^[0-9a-f-]{36}\.json$/.test(entry.parent.split(sep).pop() ?? '')) throw new Error('Invalid deployment parent journal');
        noLinkedAncestors(entry.parent, root);
        const parent = json(entry.parent);
        if (parent.operation !== 'migrate' || parent.child !== path) throw new Error('Deployment parent does not own its child journal');
        if (!journals.includes(entry.parent)) journals.push(entry.parent);
      }
    }
    const state = receipt(options);
    const selected = requestedHosts(options);
    const migrations = journals.filter(path => json(path).operation === 'migrate').map(path => {
      noLinkedAncestors(path, root);
      const entry = json(path);
      stoppedOwner(entry.owner);
      if (entry.host !== 'claude' || !selected.includes('claude')) throw new Error('Recovery must include the recorded migration host');
      if (typeof entry.from !== 'string' || entry.previous?.id !== entry.from || entry.previous?.scope !== 'user' || entry.previous?.enabled !== true) throw new Error('Invalid recorded legacy migration identity');
      if (!hostIsStopped(options, 'claude')) throw new Error('Close Claude sessions before migration recovery; registration changes deferred');
      if (typeof entry.child !== 'string' || dirname(entry.child) !== join(root, 'transactions') || !/^[0-9a-f-]{36}\.json$/.test(entry.child.split(sep).pop() ?? '')) throw new Error('Invalid migration child journal');
      const legacyRows = jstackRows(listPlugins(options, 'claude'));
      const legacy = legacyRows.filter(row => row.id === entry.from);
      if (legacy.length !== 1 || legacy[0].scope !== 'user' || legacy[0].version !== entry.previous.version || legacy[0].name !== entry.previous.name) throw new Error('Legacy registration changed since migration; preserved');
      if (legacyRows.some(row => row.enabled && ![entry.from, CLAUDE_ID].includes(row.id))) throw new Error('Unrelated active legacy registration preserved');
      if (existsSync(entry.child)) {
        noLinkedAncestors(entry.child, root);
        const child = json(entry.child);
        if (child.parent !== path || child.operation !== 'deploy' || child.host !== 'claude' || child.previous || child.next !== entry.next || child.digest !== entry.digest) throw new Error('Migration deployment journal does not match its parent');
        if (child.status !== 'rolled-back' && !journals.includes(entry.child)) journals.push(entry.child);
        if (child.status === 'rolled-back') ensureOwned(options, 'claude');
      } else {
        ensureOwned(options, 'claude');
        if (state.hosts.claude) throw new Error('Managed receipt appeared before migration deployment; preserved');
      }
      return { path, entry };
    });
    if (migrations.length > 1) throw new Error('Overlapping migrations require review; preserved');
    const work = journals.filter(path => json(path).operation !== 'migrate').map(path => {
      noLinkedAncestors(path, root);
      const entry = json(path);
      stoppedOwner(entry.owner);
      const host: Host = entry.host;
      if (!selected.includes(host)) throw new Error('Recovery must include every interrupted host');
      if (!['deploy', 'uninstall'].includes(entry.operation)) throw new Error('Unknown transaction operation; no files changed');
      const destination = target(options, host);
      if (entry.target !== destination) throw new Error('Recovery destination does not match configured home');
      const scratchRoot = join(dirname(dirname(destination)), '.jstack-lifecycle');
      if (typeof entry.backup !== 'string' || dirname(dirname(entry.backup)) !== scratchRoot || !/^[0-9a-f-]{36}$/.test(dirname(entry.backup).split(sep).pop() ?? '') || !['old', 'removed'].includes(entry.backup.split(sep).pop() ?? '')) throw new Error('Unowned recovery backup path preserved');
      for (const candidate of [destination, entry.backup]) noLinkedAncestors(candidate, root);
      const previous: Deployment | undefined = entry.previous;
      if (previous && (previous.target !== destination || previous.pluginId !== (host === 'claude' ? CLAUDE_ID : CODEX_ID))) throw new Error('Invalid previous deployment ownership');
      if (previous) noLinkedAncestors(join(root, 'versions', safeVersion(previous.version)), root);
      if (entry.operation === 'deploy') noLinkedAncestors(join(root, 'versions', safeVersion(entry.next)), root);
      const old = previous ? retained(options, previous.version) : undefined;
      if (old && old.digest !== previous!.digest) throw new Error('Previous deployment hash differs from retained evidence');
      const next = entry.operation === 'deploy' ? retained(options, entry.next) : undefined;
      if (next && next.digest !== entry.digest) throw new Error('Next deployment hash differs from retained evidence');
      const current = state.hosts[host];
      if (current && (current.target !== destination || ![old?.digest, next?.digest].includes(current.digest))) throw new Error('Installation receipt changed after interrupted operation');
      const present = existsSync(destination) ? treeDigest(destination) : undefined;
      if (present && ![old?.digest, next?.digest].includes(present)) throw new Error('Managed files were modified; recovery preserved them');
      if (existsSync(entry.backup) && (!old || treeDigest(entry.backup) !== old.digest)) throw new Error('Recovery backup was modified; preserved');
      if (host === 'codex' && !hostIsStopped(options, host)) throw new Error('Close Codex sessions before recovery; destructive cache changes deferred');
      return { path, entry, host, destination, previous, old, next, present };
    });
    if (new Set(work.map(row => row.host)).size !== work.length) throw new Error('Overlapping host transactions require review; preserved');
    for (const item of work) {
      const { path, entry, host, destination, previous, old, present } = item;
      // All paths and bytes were verified before the first mutation. Keep retained
      // versions and backup bytes until the receipt and host registration commit.
      if (old && present !== old.digest) {
        const scratch = dirname(entry.backup);
        noLinkedAncestors(scratch, locations(options).root);
        mkdirSync(scratch, { recursive: true });
        const ready = join(scratch, `restore-${randomUUID()}`);
        cpSync(old.root, ready, { recursive: true });
        if (treeDigest(ready) !== old.digest) throw new Error('Recovery copy failed verification; destination preserved');
        if (existsSync(destination)) renameSync(destination, join(scratch, `superseded-${randomUUID()}`));
        renameSync(ready, destination);
      } else if (!old && existsSync(destination)) {
        mkdirSync(dirname(entry.backup), { recursive: true });
        renameSync(destination, join(dirname(entry.backup), `superseded-${randomUUID()}`));
      }
      if (old) register(options, host, old);
      else command(options, host, ['plugin', host === 'claude' ? 'uninstall' : 'remove', host === 'claude' ? CLAUDE_ID : CODEX_ID, ...(host === 'claude' ? ['--scope', 'user'] : []), '--json']);
      if (previous) state.hosts[host] = previous; else delete state.hosts[host];
      save(options, state);
      writeJson(path, { ...entry, status: 'rolled-back', recoveredAt: new Date().toISOString() });
      // Backups remain outside discovery for review; recovery never garbage-collects them.
    }
    for (const { path, entry } of migrations) {
      // Reconcile the exact user-scoped identity through the official CLI, never registry edits.
      const before = jstackRows(listPlugins(options, 'claude')).filter(row => row.id === entry.from);
      if (before.length !== 1 || before[0].scope !== 'user' || before[0].version !== entry.previous.version) throw new Error('Legacy registration changed during recovery; journal retained');
      if (!before[0].enabled) command(options, 'claude', ['plugin', 'enable', entry.from, '--scope', 'user']);
      const active = jstackRows(listPlugins(options, 'claude')).filter(row => row.enabled);
      if (active.length !== 1 || active[0].id !== entry.from || active[0].version !== entry.previous.version || active[0].scope !== 'user') throw new Error('Legacy activation recovery did not restore the recorded identity');
      writeJson(path, { ...entry, status: 'rolled-back', recoveredAt: new Date().toISOString() });
    }
    if (existsSync(lockPath)) rmSync(lockPath, { recursive: true });
    const result = status(options);
    for (const { entry } of migrations) {
      const index = result.hosts.findIndex(row => row.host === 'claude');
      result.hosts[index] = { host: 'claude', installed: false, discovered: true, version: entry.previous.version, restoredPluginId: entry.from, hookTrust: 'not-verified', restartRequired: true };
    }
    result.ok = result.hosts.every(row => !row.error) && !result.recoveryRequired?.length;
    return result;
  } finally { rmSync(guard, { recursive: true, force: true }); }
}
