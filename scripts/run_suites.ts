#!/usr/bin/env node
/** Run owning contract suites, preserving measured floors and isolation gates. */
import { createHash, randomUUID } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { isMain } from '../runtime/entry.js';
import { parseMeasurement, suiteFiles } from './check_floor_parity.js';

export interface SuiteOptions {
  root: string;
  selected?: string[];
  evidence?: string;
  env?: NodeJS.ProcessEnv;
  /** Optional scheduling hint. It never skips or satisfies a check. */
  timingHistory?: string;
  /** Package source fingerprint supplied by the package builder when available. */
  inputFingerprint?: string;
  /** @internal Only the isolated worker launcher should set this. */
  internalChild?: boolean;
  /**
   * Skip floor parity because deletion controls, which measure the floors, were
   * omitted. An option rather than an environment variable, so suites that run
   * this runner as a fixture do not inherit the caller's mode.
   */
  deferFloorParity?: boolean;
}

interface RunEnvironment { nodeVersion: string; platform: string; architecture: string }
interface RunIdentity { runId: string; inputFingerprint: string; environment: RunEnvironment }
interface SuiteTiming { label: string; copyMs: number; runMs: number; cleanupMs: number; totalMs: number; failed: boolean }
interface MetaCheck { name: string; exitCode: number | null; missing?: boolean }
interface TimingHistory {
  schemaVersion: 1;
  runId: string;
  inputFingerprint: string;
  environment: RunEnvironment;
  suites: SuiteTiming[];
}
interface TimingEvidence extends RunIdentity {
  schemaVersion: 1;
  complete: boolean;
  startedAt: string;
  durationMs: number;
  suites: SuiteTiming[];
  metaChecks: MetaCheck[];
  exitCode: number;
  timingHistory?: { path: string; applied: boolean; inputFingerprint?: string; runId?: string; reason?: string };
}

const CHILD_FLAG = '--internal-suite-child';
const TIMING_FILE = 'timings.json';
const IGNORED_FINGERPRINT_DIRS = new Set(['.git', 'node_modules', 'results', '.mypy_cache', '.pytest_cache', '__pycache__', 'target']);
const elapsed = (start: number) => Math.max(0, performance.now() - start);

function suiteGroups(root: string): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const row of suiteFiles(root)) {
    const files = groups.get(row.label) ?? [];
    files.push(row.path);
    groups.set(row.label, files);
  }
  return groups;
}

function selectedLabels(selected: string[], available: Map<string, string[]>): string[] {
  return selected.map(name => {
    if (/^tests\/test_[^/]+\.(?:py|js)$/.test(name)) return name.replace(/\.js$/, '.py');
    if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) return `skills/${name}`;
    throw new Error(`Invalid suite selector: ${name}`);
  });
}

function assertCoverage(root: string, labels: string[], groups: Map<string, string[]>, full: boolean): void {
  if (full) {
    const population = join(root, 'contracts/ts-migration/deletion-floors.json');
    if (!existsSync(population)) throw new Error('Measured floor population is missing');
    for (const label of Object.keys(JSON.parse(readFileSync(population, 'utf8')).floors)) {
      if (!labels.includes(label)) throw new Error(`Compiled owning suite is missing: ${label}`);
    }
  }
  if (!labels.length) throw new Error('No suites to run');
  for (const label of labels) if (!groups.has(label)) throw new Error(`Suite is missing: ${label}`);
}

function fingerprintTree(root: string): string {
  const hash = createHash('sha256');
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      if (IGNORED_FINGERPRINT_DIRS.has(entry.name)) continue;
      const path = join(directory, entry.name), rel = relative(root, path).split(sep).join('/');
      if (entry.isDirectory()) { hash.update(`dir\0${rel}\n`); visit(path); }
      else if (entry.isSymbolicLink()) hash.update(`link\0${rel}\0${readlinkSync(path)}\n`);
      else if (entry.isFile()) {
        hash.update(`file\0${rel}\0`);
        hash.update(readFileSync(path));
        hash.update('\n');
      }
    }
  };
  visit(root);
  return hash.digest('hex');
}

function packageFingerprint(root: string, env: NodeJS.ProcessEnv, supplied?: string): string {
  if (supplied) return supplied;
  if (env.JSTACK_SUITE_INPUT_FINGERPRINT) return env.JSTACK_SUITE_INPUT_FINGERPRINT;
  const packageRoot = env.JSTACK_PACKAGE_ROOT ? resolve(env.JSTACK_PACKAGE_ROOT) : root;
  const receipt = join(packageRoot, 'package-receipt.json');
  if (existsSync(receipt)) {
    try {
      const sourceSha256 = JSON.parse(readFileSync(receipt, 'utf8')).sourceSha256;
      if (typeof sourceSha256 === 'string' && sourceSha256) return sourceSha256;
    } catch { /* Use a deterministic tree digest when a receipt is unavailable. */ }
  }
  return fingerprintTree(root);
}

function runEnvironment(): RunEnvironment {
  return { nodeVersion: process.version, platform: process.platform, architecture: process.arch };
}

function sameEnvironment(left: RunEnvironment, right: RunEnvironment): boolean {
  return left.nodeVersion === right.nodeVersion && left.platform === right.platform && left.architecture === right.architecture;
}

function runIdentity(root: string, env: NodeJS.ProcessEnv, supplied?: string, runId?: string): RunIdentity {
  return { runId: runId ?? env.JSTACK_SUITE_RUN_ID ?? randomUUID(), inputFingerprint: packageFingerprint(root, env, supplied), environment: runEnvironment() };
}

function identityEnvironment(env: RunEnvironment): string { return JSON.stringify(env); }

function writeTimings(evidence: string, identity: RunIdentity, startedAt: string, started: number, suites: SuiteTiming[], metaChecks: MetaCheck[], exitCode: number, complete: boolean, history?: TimingEvidence['timingHistory']): void {
  const document: TimingEvidence = {
    schemaVersion: 1,
    complete,
    ...identity,
    startedAt,
    durationMs: elapsed(started),
    suites: suites.filter(Boolean),
    metaChecks,
    exitCode,
    ...(history ? { timingHistory: history } : {}),
  };
  const target = join(evidence, TIMING_FILE), temporary = join(evidence, `.${TIMING_FILE}.${process.pid}.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`);
    renameSync(temporary, target);
  } finally { rmSync(temporary, { force: true }); }
}

function runMetaChecks(root: string, evidence: string, env: NodeJS.ProcessEnv, selected: string[], deferFloors = false): { checks: MetaCheck[]; exitCode: number } {
  const selectedRun = selected.length > 0;
  const quick = env.JSTACK_QUICK_CONTRACTS === '1';
  // Floors are measured by deletion controls; without them there is nothing to compare.
  const floorsDeferred = quick || deferFloors;
  const checks: MetaCheck[] = [];
  let exitCode = 0;
  const floorArgs = ['--root', root, '--from-dir', evidence, ...(selectedRun ? selected : [])];
  const tasks: [string, string, string[]][] = [
    ...(floorsDeferred ? [] : [['floor parity', 'check_floor_parity.js', floorArgs] as [string, string, string[]]]),
    ['shared-library behavior', 'check_suite_lib_behaviour.js', [root]],
    ['canonical suite-library parity', 'check_suite_lib_parity.js', [root]],
  ];
  if (floorsDeferred) console.log(`[${quick ? 'quick' : 'no-deletion'}] Deletion floor parity deferred to a run with deletion controls.`);
  for (const [name, file, args] of tasks) {
    const checker = join(root, 'scripts', file);
    if (!existsSync(checker)) {
      console.error(`[2] Contract checker is missing: ${file}`);
      checks.push({ name, exitCode: 2, missing: true });
      exitCode = Math.max(exitCode, 2);
      continue;
    }
    const result = spawnSync(process.execPath, [checker, ...args], { cwd: root, env, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
    console.log((result.stdout ?? '') + (result.stderr ?? ''));
    const code = result.status ?? 2;
    checks.push({ name, exitCode: code });
    if (code !== 0 || result.error) exitCode = Math.max(exitCode, result.error ? 2 : 1);
  }
  return { checks, exitCode };
}

function suiteVerdict(name: string, output: string, failed: boolean): string {
  const verdicts = output.trimEnd().split('\n').filter(line => !line.startsWith('@@jstack-suite-'));
  const failedVerdict = verdicts.filter(line => {
    const match = line.match(/^(\d+)\/(\d+) (?:통과|passed)/);
    return match && match[1] !== match[2];
  }).at(-1);
  return `[${failed ? 'FAIL' : 'ok'}] ${name} ${failed ? failedVerdict ?? verdicts.at(-1) : verdicts.at(-1)}`;
}

/** Run suites sequentially in isolated temporary directories. */
export function runSuites(options: SuiteOptions): number {
  const root = resolve(options.root), selected = options.selected ?? [], env = { ...process.env, ...options.env };
  // An independent suite must not inherit a parent node:test IPC reporter or internal worker switch.
  delete env.NODE_TEST_CONTEXT;
  const internalChild = options.internalChild === true;
  const groups = suiteGroups(root), labels = selected.length ? selectedLabels(selected, groups) : [...groups.keys()];
  assertCoverage(root, labels, groups, selected.length === 0);
  const ownedEvidence = !options.evidence && !env.JSTACK_SUITE_EVIDENCE_DIR;
  const evidence = options.evidence ?? env.JSTACK_SUITE_EVIDENCE_DIR ?? mkdtempSync(join(tmpdir(), 'jstack-suite-output-'));
  mkdirSync(evidence, { recursive: true });
  if (readdirSync(evidence).length) throw new Error('Evidence directory is not empty');
  const deletionTimingDir = env.JSTACK_DELETION_TIMING_DIR ?? join(evidence, 'deletions');
  mkdirSync(deletionTimingDir, { recursive: true });
  const identity = runIdentity(root, env, options.inputFingerprint);
  const startedAt = new Date().toISOString(), started = performance.now();
  const suiteTimings: SuiteTiming[] = [];
  let failures = 0, leaks = 0;
  try {
    for (const label of labels) {
      const suiteStarted = performance.now(), copyMs = 0, name = label.startsWith('skills/') ? basename(label) : label;
      const box = mkdtempSync(join(tmpdir(), 'jstack-suite-box-'));
      const reach = env.JSTACK_REACH_DIR ? join(env.JSTACK_REACH_DIR, name.replaceAll('/', '_') + '.json') : '';
      const childEnv = { ...env, TMPDIR: box, TMP: box, TEMP: box, JSTACK_REACH_OUT: reach, JSTACK_DELETION_TIMING_DIR: deletionTimingDir,
        JSTACK_SUITE_EVIDENCE_DIR: evidence, JSTACK_SUITE_RUN_ID: identity.runId,
        JSTACK_SUITE_INPUT_FINGERPRINT: identity.inputFingerprint, JSTACK_SUITE_ENVIRONMENT: identityEnvironment(identity.environment) };
      let output = '', failed = false, runMs = 0, cleanupMs = 0;
      const dependencyRoot = label === 'skills/dashboard' ? env.JSTACK_DASHBOARD_DEPENDENCIES : label === 'tests/test_repack.py' ? env.JSTACK_BUILD_DEPENDENCIES : undefined;
      const dependencyLink = join(root, label === 'skills/dashboard' ? 'skills/dashboard/node_modules' : 'node_modules');
      let linked = false;
      try {
        if (dependencyRoot) {
          try { lstatSync(dependencyLink); throw new Error('Test dependency path is occupied; preserving it'); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
          symlinkSync(dependencyRoot, dependencyLink, process.platform === 'win32' ? 'junction' : 'dir'); linked = true;
        }
        for (const suite of groups.get(label)!) {
          const cwd = label.startsWith('skills/') ? dirname(dirname(suite)) : root;
          const runStarted = performance.now();
          const result = spawnSync(process.execPath, [suite], { cwd, env: childEnv, encoding: 'utf8', windowsHide: true, timeout: 2_700_000, maxBuffer: 64 * 1024 * 1024 });
          runMs += elapsed(runStarted);
          const text = (result.stdout ?? '') + (result.stderr ?? '') + (result.error ? `\n[FAIL] suite process: ${result.error.message}\n` : '');
          const reserved = /^@@jstack-suite-/m.test(text);
          const body = reserved ? text.replace(/^@@jstack-suite-/gm, '[invalid frame] ') : text;
          output += `@@jstack-suite-begin\n${body}${body.endsWith('\n') ? '' : '\n'}@@jstack-suite-end ${reserved ? 2 : result.status ?? 2}\n`;
          if (reserved || result.status !== 0 || !parseMeasurement(text).green) failed = true;
        }
      } catch (error) { output += `[FAIL] ${String(error)}\n`; failed = true; }
      finally {
        const cleanupStarted = performance.now();
        try {
          if (linked && lstatSync(dependencyLink).isSymbolicLink() && resolve(dirname(dependencyLink), readlinkSync(dependencyLink)) === resolve(dependencyRoot!)) unlinkSync(dependencyLink);
          const left = readdirSync(box).filter(entry => entry !== 'node-compile-cache');
          if (left.length) { leaks++; console.log(`[leak] ${name}: ${left.length} temporary entries (${left.slice(0, 4).join(', ')})`); }
        } catch (error) { failed = true; output += `[FAIL] suite cleanup: ${String(error)}\n`; }
        try { rmSync(box, { recursive: true, force: true }); }
        catch (error) { failed = true; output += `[FAIL] temporary cleanup: ${String(error)}\n`; }
        cleanupMs = elapsed(cleanupStarted);
      }
      writeFileSync(join(evidence, name.replaceAll('/', '_') + '.out'), output);
      console.log(suiteVerdict(name, output, failed));
      if (failed) { failures++; output.split('\n').filter(line => line.startsWith('[FAIL]')).forEach(line => console.log('         ' + line)); }
      suiteTimings.push({ label, copyMs, runMs, cleanupMs, totalMs: elapsed(suiteStarted), failed });
    }
    const seconds = Math.floor(elapsed(started) / 1000);
    console.log(`Suites ${labels.length} / failures ${failures} / leaks ${leaks} / suite time ${seconds}s`);
    if (!selected.length && (basename(root) !== 'jstack' || seconds > 2700)) { failures++; console.log('[FAIL] Missing or exceeded suite time budget (jstack: 2700s)'); }
    let metaChecks: MetaCheck[] = [], metaExitCode = 0;
    if (!internalChild) {
      try {
        const meta = runMetaChecks(root, evidence, env, selected.length ? labels : [], options.deferFloorParity === true);
        metaChecks = meta.checks;
        metaExitCode = meta.exitCode;
        failures = Math.max(failures, meta.exitCode === 2 ? 2 : failures + (meta.exitCode ? 1 : 0));
      } catch (error) {
        console.error(`[2] Contract meta-check failed to start: ${String(error)}`);
        metaChecks = [{ name: 'meta-check aggregation', exitCode: 2 }];
        metaExitCode = 2;
        failures = Math.max(failures, 2);
      }
    }
    const code = metaExitCode === 2 ? 2 : failures || leaks ? 1 : 0;
    writeTimings(evidence, identity, startedAt, started, suiteTimings, metaChecks, code, true);
    return code;
  } finally { if (ownedEvidence) rmSync(evidence, { recursive: true, force: true }); }
}

function validateTimingRow(value: unknown): value is SuiteTiming {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<SuiteTiming>;
  return typeof row.label === 'string' && /^(?:skills\/[a-z0-9-]+|tests\/test_[^/]+\.py)$/.test(row.label)
    && ['copyMs', 'runMs', 'cleanupMs', 'totalMs'].every(key => typeof row[key as keyof SuiteTiming] === 'number' && Number.isFinite(row[key as keyof SuiteTiming]) && (row[key as keyof SuiteTiming] as number) >= 0)
    && typeof row.failed === 'boolean';
}

function readTimingHistory(path: string, environment: RunEnvironment, currentLabels: string[]): { durations: Map<string, number>; provenance: NonNullable<TimingEvidence['timingHistory']>; reason?: string } {
  const resolvedPath = resolve(path);
  const fallback = (reason: string, inputFingerprint?: string, runId?: string) => ({ durations: new Map<string, number>(), provenance: { path: resolvedPath, applied: false, inputFingerprint, runId, reason } });
  try {
    const parsed = JSON.parse(readFileSync(resolvedPath, 'utf8')) as Partial<TimingHistory>;
    if (parsed.schemaVersion !== 1 || typeof parsed.runId !== 'string' || !parsed.runId || typeof parsed.inputFingerprint !== 'string' || !parsed.inputFingerprint || !parsed.environment || !Array.isArray(parsed.suites)) return fallback('invalid timing schema', parsed.inputFingerprint, parsed.runId);
    if (!parsed.environment || !sameEnvironment(parsed.environment, environment)) return fallback('environment mismatch', parsed.inputFingerprint, parsed.runId);
    const all = new Map<string, number>();
    for (const value of parsed.suites) {
      if (!validateTimingRow(value) || all.has(value.label)) return fallback('invalid or duplicate suite timing row', parsed.inputFingerprint, parsed.runId);
      all.set(value.label, value.totalMs);
    }
    const current = new Map([...all].filter(([label]) => currentLabels.includes(label)));
    if (!current.size) return fallback('no label-matched suite timings', parsed.inputFingerprint, parsed.runId);
    return { durations: current, provenance: { path: resolvedPath, applied: true, inputFingerprint: parsed.inputFingerprint, runId: parsed.runId } };
  } catch (error) { return fallback(`unreadable timing file: ${(error as Error).message}`); }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function scheduleLabels(labels: string[], history: Map<string, number>): string[] {
  if (!history.size) return [...labels];
  const fallbackDuration = median([...history.values()]);
  return labels.map((label, index) => ({ label, index, duration: history.get(label) ?? fallbackDuration }))
    .sort((a, b) => b.duration - a.duration || a.index - b.index)
    .map(row => row.label);
}

/** Each worker receives the same immutable Git snapshot in its own directory. */
export async function runSuitesConcurrent(options: SuiteOptions, concurrency = 4): Promise<number> {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new Error('Invalid suite concurrency');
  const root = resolve(options.root), selected = options.selected ?? [], env = { ...process.env, ...options.env };
  delete env.NODE_TEST_CONTEXT;
  const groups = suiteGroups(root), labels = selected.length ? selectedLabels(selected, groups) : [...groups.keys()];
  assertCoverage(root, labels, groups, selected.length === 0);
  const owned = !options.evidence && !env.JSTACK_SUITE_EVIDENCE_DIR;
  const evidence = options.evidence ?? env.JSTACK_SUITE_EVIDENCE_DIR ?? mkdtempSync(join(tmpdir(), 'jstack-suite-output-'));
  mkdirSync(evidence, { recursive: true });
  if (readdirSync(evidence).length) throw new Error('Evidence directory is not empty');
  const deletionTimingDir = join(evidence, 'deletions');
  mkdirSync(deletionTimingDir, { recursive: true });
  const identity = runIdentity(root, env, options.inputFingerprint, randomUUID());
  const childIdentityEnv = {
    ...env,
    JSTACK_SUITE_RUN_ID: identity.runId,
    JSTACK_SUITE_INPUT_FINGERPRINT: identity.inputFingerprint,
    JSTACK_SUITE_ENVIRONMENT: identityEnvironment(identity.environment),
  };
  const historyPath = options.timingHistory ?? env.JSTACK_SUITE_TIMING_HISTORY;
  const history = historyPath ? readTimingHistory(historyPath, identity.environment, labels) : undefined;
  if (history && !history.provenance.applied) console.log(`[timing] history ignored: ${history.provenance.reason}`);
  const scheduled = scheduleLabels(labels, history?.durations ?? new Map());
  if (history?.provenance.applied) console.log(`[timing] longest-first schedule from ${history.provenance.path}`);
  const startedAt = new Date().toISOString(), started = performance.now();
  const timings: SuiteTiming[] = new Array(scheduled.length);
  let cursor = 0, failures = 0;
  try {
    const worker = async (): Promise<void> => {
      while (cursor < scheduled.length) {
        const index = cursor++, label = scheduled[index]!, workerStarted = performance.now();
        const name = label.startsWith('skills/') ? basename(label) : label;
        let box = '';
        let output = '', failed = false, copyMs = 0, runMs = 0, cleanupMs = 0, status: number | null = 2;
        try {
          box = mkdtempSync(join(tmpdir(), 'jstack-suite-worker-'));
          const copy = join(box, 'jstack'), logs = join(box, 'evidence');
          mkdirSync(logs, { recursive: true });
          const copyStarted = performance.now();
          try { cpSync(root, copy, { recursive: true }); }
          finally { copyMs = elapsed(copyStarted); }
          const runStarted = performance.now();
          const result = await new Promise<{ status: number | null; output: string }>(resolveResult => {
            const selector = label.startsWith('skills/') ? basename(label) : label;
            const args = [join(copy, 'scripts/run_suites.js'), CHILD_FLAG, selector];
            const child = spawn(process.execPath, args, { cwd: copy, env: { ...childIdentityEnv, JSTACK_RUNTIME_ROOT: copy, JSTACK_SUITE_EVIDENCE_DIR: logs, JSTACK_DELETION_TIMING_DIR: deletionTimingDir }, windowsHide: true });
            let text = '', bytes = 0, overflow = false;
            const receive = (data: Buffer) => {
              bytes += data.length;
              if (bytes > 64 * 1024 * 1024) { overflow = true; child.kill(); return; }
              text += data.toString();
            };
            child.stdout.on('data', receive);
            child.stderr.on('data', receive);
            child.on('error', error => { text += `\n[FAIL] ${error.message}`; });
            child.on('close', code => resolveResult({ status: overflow ? 2 : code, output: text }));
          });
          runMs = elapsed(runStarted);
          output = result.output;
          status = result.status;
          const path = join(logs, name.replaceAll('/', '_') + '.out');
          if (!existsSync(path)) throw new Error('Worker did not create suite evidence');
          const body = readFileSync(path, 'utf8');
          writeFileSync(join(evidence, name.replaceAll('/', '_') + '.out'), body);
          if (status !== 0 || !parseMeasurement(body).green) failed = true;
          console.log(output.trim().split('\n').filter(line => /^\[(?:ok|FAIL|leak)\]|^         /.test(line)).join('\n'));
        } catch (error) {
          failed = true;
          const message = `[FAIL] Worker: ${String(error)}\n${output}`;
          try { writeFileSync(join(evidence, name.replaceAll('/', '_') + '.out'), message); } catch { /* Preserve the timing failure even if evidence storage also fails. */ }
          console.error(`[FAIL] ${name}: ${String(error)}`);
        } finally {
          if (box) {
            // Even a worker that never wrote its verdict may have captured partial
            // upstream output. Preserve its one named sidecar before removing it.
            const details = join(box, 'evidence', name.replaceAll('/', '_') + '.details.json');
            try {
              if (existsSync(details)) {
                if (!lstatSync(details).isFile()) throw new Error('Suite details must be a regular file');
                writeFileSync(join(evidence, name.replaceAll('/', '_') + '.details.json'), readFileSync(details));
              }
            } catch (error) { failed = true; console.error(`[FAIL] ${name} details: ${String(error)}`); }
            const cleanupStarted = performance.now();
            try { rmSync(box, { recursive: true, force: true }); }
            catch (error) { failed = true; console.error(`[FAIL] ${name} cleanup: ${String(error)}`); }
            cleanupMs = elapsed(cleanupStarted);
          }
          timings[index] = { label, copyMs, runMs, cleanupMs, totalMs: elapsed(workerStarted), failed };
          if (failed) failures++;
          try { writeTimings(evidence, identity, startedAt, started, timings, [], failures ? 1 : 2, false, history?.provenance); }
          catch (error) { console.error(`[FAIL] Could not checkpoint timing evidence: ${String(error)}`); }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, scheduled.length) }, worker));
    const seconds = Math.floor(elapsed(started) / 1000);
    console.log(`Suites ${scheduled.length} / failures ${failures} / isolated workers ${concurrency} / suite time ${seconds}s`);
    if (!selected.length && (basename(root) !== 'jstack' || seconds > 2700)) { failures++; console.log('[FAIL] Missing or exceeded suite time budget (jstack: 2700s)'); }
    let meta: { checks: MetaCheck[]; exitCode: number };
    try { meta = runMetaChecks(root, evidence, env, selected.length ? labels : [], options.deferFloorParity === true); }
    catch (error) {
      console.error(`[2] Contract meta-check failed to start: ${String(error)}`);
      meta = { checks: [{ name: 'meta-check aggregation', exitCode: 2 }], exitCode: 2 };
    }
    if (meta.exitCode) failures = meta.exitCode === 2 ? Math.max(failures, 2) : failures + 1;
    const code = failures ? (meta.exitCode === 2 ? 2 : 1) : 0;
    writeTimings(evidence, identity, startedAt, started, timings, meta.checks, code, true, history?.provenance);
    return code;
  } finally { if (owned) rmSync(evidence, { recursive: true, force: true }); }
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const internalChild = argv[0] === CHILD_FLAG;
  const args = internalChild ? argv.slice(1) : argv;
  let root = process.env.JSTACK_RUNTIME_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '..');
  if (basename(root) === 'dist') root = dirname(root);
  if (existsSync(join(root, 'hosts/claude')) && !existsSync(join(root, '.claude-plugin/plugin.json'))) {
    const { runContracts } = await import('../packaging/run_contracts.js');
    return runContracts({ source: root, selected: args });
  }
  return runSuites({ root, selected: args, internalChild });
}
if (isMain(import.meta.url)) main().then(code => { process.exitCode = code; }).catch(error => { console.error(`[2] ${String(error)}`); process.exitCode = 2; });
