#!/usr/bin/env node
/** Plan a conservative set of installed owner contracts for an exact Git diff. */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export type SelectionMode = 'shadow' | 'enforce';
export interface DiffFile { status: string; oldPath?: string; newPath?: string }
export interface PackageMember { source: string; target: string }
export interface CatalogEntry { owner: string; name: string; visibility: 'public' | 'support'; category?: string }
export interface ContractSuiteDependencies {
  schemaVersion: 1;
  eligibleSourceRoots: Record<string, string[]>;
  ownerConsumers: Record<string, string[]>;
  rootConsumers: Record<string, string[]>;
}
export interface PlannerSnapshot {
  packageFiles: unknown;
  catalog: unknown;
  deletionFloors: unknown;
  dependencies?: unknown;
}
export interface PlanInput {
  base: string;
  head: string;
  mode?: SelectionMode;
  diff: DiffFile[];
  baseSnapshot?: PlannerSnapshot;
  headSnapshot?: PlannerSnapshot;
  baseCommit?: string | null;
  headCommit?: string | null;
  baseTree?: string | null;
  headTree?: string | null;
  initialReasons?: string[];
}
export interface ContractSuitePlan {
  schemaVersion: 1;
  mode: SelectionMode;
  base: string;
  head: string;
  baseCommit: string | null;
  headCommit: string | null;
  baseTree: string | null;
  headTree: string | null;
  diff: DiffFile[];
  changedPaths: string[];
  scope: 'full' | 'scoped';
  execution: 'full' | 'selected';
  integrationMode: 'quick' | 'full';
  selectedSuites: string[];
  quickSuites: string[];
  expectedOwningSuites: string[];
  expectedOwningLabels: string[];
  expectedRootSuites: string[];
  reasons: string[];
}

interface ValidSnapshot {
  members: Map<string, PackageMember[]>;
  owners: Map<string, CatalogEntry>;
  ownerPrefixes: Map<string, string>;
  floorLabels: Set<string>;
  dependencies: ContractSuiteDependencies;
}
interface SuiteRef { kind: 'owner' | 'root'; selector: string; label: string }
class UnsafeSnapshot extends Error {}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_PATH = (value: string) => Boolean(value) && !value.startsWith('/') && !value.includes('\\') && !value.includes('\0') && !value.split('/').some(part => !part || part === '.' || part === '..');
const ROOT_SUITE = /^tests\/(test_[^/]+)\.(?:py|js|ts)$/;

function compare(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
function uniqueSorted(values: Iterable<string>): string[] { return [...new Set(values)].sort(compare); }

/** Only instruction and owner-suite assertion edits can defer integration controls. */
export function integrationModeForPaths(paths: string[]): 'quick' | 'full' {
  if (!paths.length) return 'full';
  const rootDocuments = new Set(['README.md', 'CAPABILITIES.md', 'NOTICE.md', 'AGENTS.md']);
  const owner = /^skills\/(?:public\/[^/]+\/[^/]+|support\/[^/]+)\//;
  return paths.every(path => {
    if (rootDocuments.has(path)) return true;
    if (/^tests\/test_[^/]+\.(?:ts|py)$/.test(path)) return true;
    if (/^tests\/refs\/.*\.lines$/.test(path)) return true;
    if (/^hosts\/(?:claude\/(?:agents|commands|output-styles)|codex\/skills)\/.*\.md$/.test(path)) return true;
    if (!owner.test(path)) return false;
    const tail = path.replace(owner, '');
    return tail === 'SKILL.md' || tail === 'NOTICE' || tail === 'NOTICE.md'
      || /^references\/.*\.md$/.test(tail)
      || /^tests\/refs\/.*\.lines$/.test(tail)
      || /^tests\/run_tests\.(?:ts|py)$/.test(tail);
  }) ? 'quick' : 'full';
}
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function expectString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value) throw new UnsafeSnapshot(`${label} must be a nonempty string`);
  return value;
}

function validateDependencies(raw: unknown, owners: Map<string, CatalogEntry>, floorLabels: Set<string>, ownerPrefixes: Map<string, string>): ContractSuiteDependencies {
  if (raw === undefined) throw new UnsafeSnapshot('contract-suite-dependencies.json is missing; no scoped owner eligibility can be proven');
  if (!isRecord(raw) || raw.schemaVersion !== 1) throw new UnsafeSnapshot('contract-suite-dependencies.json has an unsupported schema');
  const readMap = (value: unknown, label: string, keyCheck: (key: string) => boolean, targetCheck: (target: string) => boolean): Record<string, string[]> => {
    if (value === undefined) return {};
    if (!isRecord(value)) throw new UnsafeSnapshot(`${label} must be an object`);
    const result: Record<string, string[]> = {};
    for (const [key, targets] of Object.entries(value)) {
      if (!keyCheck(key) || !Array.isArray(targets) || !targets.every(target => typeof target === 'string' && targetCheck(target))) {
        throw new UnsafeSnapshot(`${label} has an invalid dependency row for ${key}`);
      }
      result[key] = uniqueSorted(targets as string[]);
    }
    return result;
  };
  const ownerConsumers = readMap(raw.ownerConsumers, 'ownerConsumers', key => owners.has(key), target => owners.has(target));
  const rootConsumers = readMap(raw.rootConsumers, 'rootConsumers', key => owners.has(key), target => /^tests\/test_[a-zA-Z0-9_-]+\.py$/.test(target) && floorLabels.has(target));
  const eligibleSourceRoots = readMap(raw.eligibleSourceRoots, 'eligibleSourceRoots', key => owners.has(key), target => SAFE_PATH(target));
  const catalogOwners = new Set(owners.keys());
  for (const [name, map] of [['ownerConsumers', ownerConsumers], ['rootConsumers', rootConsumers]] as const) {
    const missing = [...catalogOwners].filter(owner => !Object.hasOwn(map, owner));
    if (missing.length) throw new UnsafeSnapshot(`${name} is incomplete for catalog owners: ${missing.sort(compare).join(', ')}`);
  }
  for (const [owner, roots] of Object.entries(eligibleSourceRoots)) {
    const canonical = ownerPrefixes.get(owner)!, allowed = new Set([canonical, `hosts/codex/${canonical}`]);
    if (!roots.length || roots.some(root => !allowed.has(root))) throw new UnsafeSnapshot(`eligibleSourceRoots has an unreviewed or noncanonical path for ${owner}`);
  }
  return { schemaVersion: 1, eligibleSourceRoots, ownerConsumers, rootConsumers };
}

function validateSnapshot(snapshot: PlannerSnapshot): ValidSnapshot {
  if (!isRecord(snapshot.packageFiles) || snapshot.packageFiles.schemaVersion !== 1 || !Array.isArray(snapshot.packageFiles.files) || !snapshot.packageFiles.files.length) {
    throw new UnsafeSnapshot('package-files.json is missing, empty, or malformed');
  }
  const members = new Map<string, PackageMember[]>(), targets = new Set<string>();
  for (const raw of snapshot.packageFiles.files) {
    if (!isRecord(raw)) throw new UnsafeSnapshot('package-files.json contains a malformed member');
    const source = expectString(raw.source, 'package member source'), target = expectString(raw.target, 'package member target');
    if (!SAFE_PATH(source) || !SAFE_PATH(target) || targets.has(target)) throw new UnsafeSnapshot(`package-files.json has an invalid or duplicate target: ${target}`);
    const member = { source, target };
    const rows = members.get(source) ?? [];
    rows.push(member);
    members.set(source, rows);
    targets.add(target);
  }

  const catalogRaw = snapshot.catalog;
  if (!isRecord(catalogRaw) || catalogRaw.schemaVersion !== 1 || catalogRaw.sourceLayout !== 'hierarchical' || !Array.isArray(catalogRaw.categories) || !Array.isArray(catalogRaw.entries) || !catalogRaw.entries.length) {
    throw new UnsafeSnapshot('skill-catalog.json is missing, malformed, or not hierarchical');
  }
  if (!catalogRaw.categories.every(item => typeof item === 'string' && SLUG.test(item)) || new Set(catalogRaw.categories).size !== catalogRaw.categories.length) throw new UnsafeSnapshot('skill-catalog.json has invalid or duplicate categories');
  const categories = new Set(catalogRaw.categories as string[]);
  const owners = new Map<string, CatalogEntry>(), ownerPrefixes = new Map<string, string>();
  const catalogNames = new Set<string>();
  for (const raw of catalogRaw.entries) {
    if (!isRecord(raw) || !SLUG.test(String(raw.owner ?? '')) || !SLUG.test(String(raw.name ?? '')) || !['public', 'support'].includes(String(raw.visibility))) {
      throw new UnsafeSnapshot('skill-catalog.json contains a malformed owner');
    }
    const entry = { owner: String(raw.owner), name: String(raw.name), visibility: raw.visibility as 'public' | 'support', ...(typeof raw.category === 'string' ? { category: raw.category } : {}) };
    if (owners.has(entry.owner)) throw new UnsafeSnapshot(`skill-catalog.json duplicates owner ${entry.owner}`);
    let prefix: string;
    if (entry.visibility === 'public') {
      if (!entry.category || !categories.has(entry.category)) throw new UnsafeSnapshot(`skill-catalog.json has an invalid category for ${entry.owner}`);
      prefix = `skills/public/${entry.category}/${entry.name}`;
    } else {
      prefix = `skills/support/${entry.name}`;
    }
    const aliases = raw.aliases;
    if (!Array.isArray(aliases) || !aliases.every(alias => typeof alias === 'string' && SLUG.test(alias))) throw new UnsafeSnapshot(`skill-catalog.json has invalid aliases for ${entry.owner}`);
    for (const name of [entry.name, ...aliases as string[]]) {
      if (catalogNames.has(name)) throw new UnsafeSnapshot(`skill-catalog.json has an ambiguous name or alias: ${name}`);
      catalogNames.add(name);
    }
    owners.set(entry.owner, entry);
    ownerPrefixes.set(entry.owner, prefix);
  }

  if (!isRecord(snapshot.deletionFloors) || !isRecord(snapshot.deletionFloors.floors)) throw new UnsafeSnapshot('deletion-floors.json is missing or malformed');
  const floorRows = Object.entries(snapshot.deletionFloors.floors);
  if (floorRows.some(([, count]) => typeof count !== 'number' || !Number.isInteger(count) || count < 0)) throw new UnsafeSnapshot('deletion-floors.json contains an invalid measured floor');
  const floorLabels = new Set(floorRows.map(([label]) => label));
  for (const label of floorLabels) if (!/^skills\/[a-z0-9-]+$/.test(label) && !/^tests\/test_[a-zA-Z0-9_-]+\.py$/.test(label)) throw new UnsafeSnapshot(`deletion-floors.json has an invalid label ${label}`);
  const missingOwners = [...owners.keys()].filter(owner => !floorLabels.has(`skills/${owner}`));
  const retiredOwners = [...floorLabels].filter(label => label.startsWith('skills/') && !owners.has(label.slice('skills/'.length)));
  if (missingOwners.length || retiredOwners.length) throw new UnsafeSnapshot(`deletion-floors.json owner population differs from the catalog (missing: ${missingOwners.join(', ') || 'none'}; retired: ${retiredOwners.join(', ') || 'none'})`);
  const missingRootSuites = [...floorLabels].filter(label => label.startsWith('tests/') && ![label, label.replace(/\.py$/, '.ts'), label.replace(/\.py$/, '.js')].some(target => targets.has(target)));
  if (missingRootSuites.length) throw new UnsafeSnapshot(`deletion-floors.json root suite population is absent from membership: ${missingRootSuites.sort(compare).join(', ')}`);
  const dependencies = validateDependencies(snapshot.dependencies, owners, floorLabels, ownerPrefixes);
  return { members, owners, ownerPrefixes, floorLabels, dependencies };
}

function mapMember(snapshot: ValidSnapshot, member: PackageMember, source: string): SuiteRef | undefined {
  const rootMatch = ROOT_SUITE.exec(member.target);
  if (rootMatch && source.startsWith('tests/')) {
    const label = `tests/${rootMatch[1]}.py`;
    return { kind: 'root', selector: label, label };
  }
  const ownerMatch = /^skills\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\/|$)/.exec(member.target);
  if (!ownerMatch) return undefined;
  const owner = ownerMatch[1], entry = snapshot.owners.get(owner), prefix = snapshot.ownerPrefixes.get(owner);
  if (!entry || !prefix) return undefined;
  const canonical = source === prefix || source.startsWith(`${prefix}/`)
    || source === `hosts/codex/${prefix}` || source.startsWith(`hosts/codex/${prefix}/`);
  if (!canonical) return undefined;
  return { kind: 'owner', selector: owner, label: `skills/${owner}` };
}
interface SourceMapping { refs: SuiteRef[]; unmappedTargets: string[] }
function mapSource(snapshot: ValidSnapshot, source: string): SourceMapping | undefined {
  const members = snapshot.members.get(source);
  if (!members) return undefined;
  const refs = new Map<string, SuiteRef>(), unmappedTargets: string[] = [];
  for (const member of members) {
    const ref = mapMember(snapshot, member, source);
    if (ref) refs.set(`${ref.kind}:${ref.selector}`, ref);
    else unmappedTargets.push(member.target);
  }
  return { refs: [...refs.values()], unmappedTargets: uniqueSorted(unmappedTargets) };
}

function hasOwnerSuite(snapshot: ValidSnapshot, owner: string): boolean {
  const label = `skills/${owner}`;
  const prefix = `${label}/tests/`;
  return snapshot.floorLabels.has(label) && [...snapshot.members.values()].flat().some(member => {
    if (!member.target.startsWith(prefix)) return false;
    const name = member.target.slice(prefix.length);
    return !name.includes('/') && !name.startsWith('_') && !/\.test\.(?:js|ts)$/.test(name) && /\.(?:js|ts)$/.test(name);
  });
}
function hasRootSuite(snapshot: ValidSnapshot, label: string): boolean {
  return snapshot.floorLabels.has(label) && [...snapshot.members.values()].flat().some(member => member.target === label || member.target === label.replace(/\.py$/, '.ts') || member.target === label.replace(/\.py$/, '.js'));
}
function normalizeDiff(diff: DiffFile[]): DiffFile[] {
  return diff.map(row => ({ status: row.status, ...(row.oldPath ? { oldPath: row.oldPath } : {}), ...(row.newPath ? { newPath: row.newPath } : {}) }))
    .sort((a, b) => compare(a.newPath ?? a.oldPath ?? '', b.newPath ?? b.oldPath ?? '') || compare(a.status, b.status));
}

/** Pure conservative mapping. Any evidence gap moves the result to full scope. */
export function planContractSuites(input: PlanInput): ContractSuitePlan {
  const mode = input.mode ?? 'shadow';
  if (mode !== 'shadow' && mode !== 'enforce') throw new Error(`Invalid selection mode: ${String(mode)}`);
  const diff = normalizeDiff(input.diff), changedPaths = uniqueSorted(diff.flatMap(row => [row.oldPath, row.newPath].filter((path): path is string => Boolean(path))));
  const reasons = new Set(input.initialReasons ?? []), owners = new Set<string>(), rootSuites = new Set<string>();
  const quickUnmapped = new Set<string>();
  let baseSnapshot: ValidSnapshot | undefined, headSnapshot: ValidSnapshot | undefined;
  try { if (!input.baseSnapshot || !input.headSnapshot) throw new UnsafeSnapshot('base or head snapshot could not be resolved'); baseSnapshot = validateSnapshot(input.baseSnapshot); headSnapshot = validateSnapshot(input.headSnapshot); }
  catch (error) { reasons.add(`Full run: ${String(error instanceof Error ? error.message : error)}`); }
  if (!diff.length) reasons.add('Full run: no changed paths were available to prove a nonempty scoped plan.');

  const addRefs = (mapping: SourceMapping | undefined, path: string, side: string, snapshot: ValidSnapshot) => {
    if (!mapping) { quickUnmapped.add(path); reasons.add(`Full run: ${side} package membership does not map ${path} to an owner or root suite.`); return; }
    if (mapping.unmappedTargets.length) { quickUnmapped.add(path); reasons.add(`Full run: ${side} package membership maps ${path} to unclassified target(s): ${mapping.unmappedTargets.join(', ')}.`); }
    if (!mapping.refs.length) { quickUnmapped.add(path); reasons.add(`Full run: ${side} package membership has no owner or root suite target for ${path}.`); return; }
    for (const ref of mapping.refs) {
      if (ref.kind === 'owner') {
        owners.add(ref.selector);
        const eligible = snapshot.dependencies.eligibleSourceRoots[ref.selector] ?? [];
        if (!eligible.some(root => path === root || path.startsWith(`${root}/`))) reasons.add(`Full run: ${path} is outside the reviewed scoped source roots for ${ref.selector}.`);
      } else {
        rootSuites.add(ref.selector);
        reasons.add(`Full run: root contract source ${path} changed; run the full root population.`);
      }
    }
  };
  if (baseSnapshot && headSnapshot) {
    for (const row of diff) {
      const status = row.status[0];
      if (status === 'A') {
        if (!row.newPath) { reasons.add('Full run: add diff record has no new path.'); continue; }
        addRefs(mapSource(headSnapshot, row.newPath), row.newPath, 'head', headSnapshot);
      } else if (status === 'D') {
        if (!row.oldPath) { reasons.add('Full run: delete diff record has no old path.'); continue; }
        addRefs(mapSource(baseSnapshot, row.oldPath), row.oldPath, 'base', baseSnapshot);
      } else if (status === 'R' || status === 'C') {
        if (!row.oldPath || !row.newPath) { reasons.add(`Full run: ${status} diff record is missing a path.`); continue; }
        addRefs(mapSource(baseSnapshot, row.oldPath), row.oldPath, 'base', baseSnapshot);
        addRefs(mapSource(headSnapshot, row.newPath), row.newPath, 'head', headSnapshot);
      } else if (status === 'M' || status === 'T') {
        const oldPath = row.oldPath ?? row.newPath, newPath = row.newPath ?? row.oldPath;
        if (!oldPath || !newPath) { reasons.add(`Full run: ${status} diff record is missing a path.`); continue; }
        addRefs(mapSource(baseSnapshot, oldPath), oldPath, 'base', baseSnapshot);
        addRefs(mapSource(headSnapshot, newPath), newPath, 'head', headSnapshot);
      } else {
        reasons.add(`Full run: unsupported Git diff status ${row.status || '(empty)'}.`);
      }
    }

    // Host instruction files have root consumers rather than a skill owner.
    // Keep the stricter full-integration fallback above; this only narrows quick checks.
    for (const path of changedPaths) {
      if (/^hosts\/claude\/agents\/.*\.md$/.test(path)) {
        rootSuites.add('tests/test_dev_agents.py'); rootSuites.add('tests/test_work_agents.py'); quickUnmapped.delete(path);
      } else if (/^hosts\/claude\/commands\/.*\.md$/.test(path) || /^tests\/refs\/.*\.lines$/.test(path)) {
        rootSuites.add('tests/test_dev_commands.py'); rootSuites.add('tests/test_work_commands.py'); quickUnmapped.delete(path);
      } else if (/^hosts\/claude\/output-styles\/.*\.md$/.test(path)) {
        owners.add('humanize'); rootSuites.add('tests/test_work_commands.py'); quickUnmapped.delete(path);
      }
    }

    // Dependencies are reviewed edges. Resolve the full transitive closure;
    // catalog usedBy metadata is intentionally not read here.
    const queue = [...owners], expanded = new Set<string>();
    while (queue.length) {
      const owner = queue.shift()!;
      if (expanded.has(owner)) continue;
      expanded.add(owner);
      for (const snapshot of [baseSnapshot, headSnapshot]) {
        for (const consumer of snapshot.dependencies.ownerConsumers[owner] ?? []) {
          if (!owners.has(consumer)) { owners.add(consumer); queue.push(consumer); }
        }
        for (const consumer of snapshot.dependencies.rootConsumers[owner] ?? []) rootSuites.add(consumer);
      }
    }
    for (const owner of owners) {
      if (!hasOwnerSuite(headSnapshot, owner)) reasons.add(`Full run: selected owner suite skills/${owner} is absent from head membership or deletion floors.`);
    }
    for (const suite of rootSuites) {
      if (!hasRootSuite(headSnapshot, suite)) reasons.add(`Full run: selected root suite ${suite} is absent from head membership or deletion floors.`);
    }
  }

  const full = reasons.size > 0;
  const scopedSuites = uniqueSorted([...owners, ...rootSuites]);
  const fullSuites = headSnapshot ? uniqueSorted([...headSnapshot.floorLabels].map(label => label.startsWith('skills/') ? label.slice('skills/'.length) : label)) : [];
  const selectedSuites = full ? fullSuites : scopedSuites;
  const quickSafe = Boolean(baseSnapshot && headSnapshot) && !input.initialReasons?.length
    && diff.length > 0 && diff.every(row => /^(?:A|D|M|T|R\d{1,3}|C\d{1,3})$/.test(row.status))
    && quickUnmapped.size === 0 && scopedSuites.length > 0
    && [...owners].every(owner => hasOwnerSuite(headSnapshot!, owner))
    && [...rootSuites].every(suite => hasRootSuite(headSnapshot!, suite));
  const quickSuites = mode === 'enforce' && quickSafe ? scopedSuites : fullSuites;
  const expectedOwningSuites = full && headSnapshot
    ? uniqueSorted([...headSnapshot.floorLabels].filter(label => label.startsWith('skills/')).map(label => label.slice('skills/'.length)))
    : uniqueSorted(owners);
  const expectedOwningLabels = expectedOwningSuites.map(owner => `skills/${owner}`);
  const expectedRootSuites = full && headSnapshot
    ? uniqueSorted([...headSnapshot.floorLabels].filter(label => label.startsWith('tests/')))
    : uniqueSorted(rootSuites);
  return {
    schemaVersion: 1,
    mode,
    base: input.base,
    head: input.head,
    baseCommit: input.baseCommit ?? null,
    headCommit: input.headCommit ?? null,
    baseTree: input.baseTree ?? null,
    headTree: input.headTree ?? null,
    diff,
    changedPaths,
    scope: full ? 'full' : 'scoped',
    execution: !full && mode === 'enforce' ? 'selected' : 'full',
    integrationMode: integrationModeForPaths(changedPaths),
    selectedSuites,
    quickSuites,
    expectedOwningSuites,
    expectedOwningLabels,
    expectedRootSuites,
    reasons: uniqueSorted(reasons),
  };
}

function gitBuffer(root: string, args: string[]): { status: number | null; stdout: Buffer; stderr: string } {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, windowsHide: true, env });
  return { status: result.status, stdout: result.stdout ?? Buffer.alloc(0), stderr: (result.stderr ?? Buffer.alloc(0)).toString('utf8') };
}
function gitText(root: string, args: string[]): string | undefined {
  const result = gitBuffer(root, args);
  return result.status === 0 ? result.stdout.toString('utf8').trim() : undefined;
}
function resolveCommit(root: string, revision: string): string | undefined {
  if (!revision || revision.startsWith('-')) return undefined;
  const commit = gitText(root, ['rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`]);
  return commit && /^[0-9a-f]{40,64}$/i.test(commit) ? commit : undefined;
}
function readBlob(root: string, commit: string, path: string): unknown | undefined {
  const result = gitBuffer(root, ['show', `${commit}:${path}`]);
  if (result.status !== 0) return undefined;
  try { return JSON.parse(result.stdout.toString('utf8')); }
  catch { return null; }
}
function snapshotAt(root: string, commit: string): PlannerSnapshot | undefined {
  const packageFiles = readBlob(root, commit, 'packaging/package-files.json');
  const catalog = readBlob(root, commit, 'contracts/skill-catalog.json');
  const deletionFloors = readBlob(root, commit, 'contracts/ts-migration/deletion-floors.json');
  const dependencyBlob = readBlob(root, commit, 'contracts/contract-suite-dependencies.json');
  if (packageFiles === undefined || catalog === undefined || deletionFloors === undefined) return undefined;
  return { packageFiles, catalog, deletionFloors, ...(dependencyBlob === undefined ? {} : { dependencies: dependencyBlob }) };
}
function parseNameStatus(stdout: Buffer): DiffFile[] {
  const tokens = stdout.toString('utf8').split('\0');
  if (tokens.at(-1) === '') tokens.pop();
  const diff: DiffFile[] = [];
  for (let i = 0; i < tokens.length;) {
    const status = tokens[i++];
    if (!status) throw new Error('Git returned an empty diff status');
    if (status.startsWith('R') || status.startsWith('C')) {
      const oldPath = tokens[i++], newPath = tokens[i++];
      if (!oldPath || !newPath) throw new Error(`Git returned an incomplete ${status} record`);
      diff.push({ status, oldPath, newPath });
    } else {
      const path = tokens[i++];
      if (!path) throw new Error(`Git returned an incomplete ${status} record`);
      if (status[0] === 'A') diff.push({ status, newPath: path });
      else if (status[0] === 'D') diff.push({ status, oldPath: path });
      else diff.push({ status, oldPath: path, newPath: path });
    }
  }
  return normalizeDiff(diff);
}

export interface CreatePlanOptions { root: string; base: string; head: string; mode?: SelectionMode }
/** Resolve commits, snapshots and a rename-aware diff without invoking a shell. */
export function createContractSuitePlan(options: CreatePlanOptions): ContractSuitePlan {
  const root = resolve(options.root), initialReasons: string[] = [];
  const baseCommit = resolveCommit(root, options.base), headCommit = resolveCommit(root, options.head);
  const baseTree = baseCommit ? gitText(root, ['rev-parse', '--verify', '--end-of-options', `${baseCommit}^{tree}`]) ?? null : null;
  const headTree = headCommit ? gitText(root, ['rev-parse', '--verify', '--end-of-options', `${headCommit}^{tree}`]) ?? null : null;
  let diff: DiffFile[] = [];
  if (!baseCommit || !headCommit) initialReasons.push('Full run: Git could not resolve both base and head commits.');
  else {
    const result = gitBuffer(root, ['diff', '--name-status', '-z', '--find-renames=50%', baseCommit, headCommit]);
    if (result.status !== 0) initialReasons.push(`Full run: Git diff failed${result.stderr.trim() ? ` (${result.stderr.trim()})` : ''}.`);
    else {
      try { diff = parseNameStatus(result.stdout); }
      catch (error) { initialReasons.push(`Full run: Git diff could not be parsed (${String(error)}).`); }
    }
  }
  const baseSnapshot = baseCommit ? snapshotAt(root, baseCommit) : undefined;
  const headSnapshot = headCommit ? snapshotAt(root, headCommit) : undefined;
  if (!baseSnapshot || !headSnapshot) initialReasons.push('Full run: package membership, skill catalog, or deletion floors could not be read from both revisions.');
  return planContractSuites({ base: options.base, head: options.head, mode: options.mode, diff, baseSnapshot, headSnapshot, baseCommit, headCommit, baseTree, headTree, initialReasons });
}

export function main(argv = process.argv.slice(2)): number {
  try {
    let root = process.cwd(), base: string | undefined, head: string | undefined, mode: SelectionMode = 'shadow';
    for (let i = 0; i < argv.length; i++) {
      if (argv[i] === '--root' && argv[i + 1]) root = argv[++i];
      else if (argv[i] === '--base' && argv[i + 1]) base = argv[++i];
      else if (argv[i] === '--head' && argv[i + 1]) head = argv[++i];
      else if (argv[i] === '--mode' && argv[i + 1]) {
        const value = argv[++i];
        if (value !== 'shadow' && value !== 'enforce') throw new Error(`Invalid --mode: ${value}`);
        mode = value;
      } else throw new Error(`Unknown or incomplete argument: ${argv[i]}`);
    }
    if (!base || !head) throw new Error('Usage: select_contract_suites.js --base <ref> --head <ref> [--mode shadow|enforce] [--root <repo>]');
    console.log(JSON.stringify(createContractSuitePlan({ root, base, head, mode }), null, 2));
    return 0;
  } catch (error) {
    console.error(String(error));
    return 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) process.exitCode = main();
