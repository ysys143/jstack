#!/usr/bin/env node
/**
 * Budget check for Node test files that a change adds or modifies. Each changed
 * *.test.ts is profiled from its compiled dist/*.test.js, one file at a time so
 * that other files cannot make it look idle, and fails when it exceeds its
 * group's time budget, mostly waits, or gives different outcomes across repeated
 * runs. Test smells in the changed sources are printed as advice.
 *
 *   node dist/scripts/test_budget.js --base origin/master [--head HEAD]
 *   node dist/scripts/test_budget.js --files a.test.ts b.test.ts
 *
 * Budgets and the integration list live in scripts/node-test-groups.json.
 * Exit codes: 0 within budget or nothing to check; 1 a violation; 2 usage error,
 * a missing compiled file, or unmeasurable CPU time.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { delimiter, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from '../runtime/entry.js';
import { prepareNative } from '../packaging/prepare-native.js';
import { profile, WAITING_MIN_SECONDS, WAITING_RATIO } from '../skills/public/workflow/verify/scripts/test_profile.js';
import { render, scanPaths } from '../skills/public/workflow/verify/scripts/test_smells.js';
import ts from 'typescript';

export interface Budget { maxSeconds: number; repeat: number }
export interface Groups { integration: string[]; budget: { fast: Budget; integration: Budget } }
export interface Planned { source: string; compiled: string; group: 'fast' | 'integration' }

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const rootBuildTestSourcesByRoot = new Map<string, Set<string>>();

function rootBuildTestSources(root: string): Set<string> {
  const project = resolve(root), cached = rootBuildTestSourcesByRoot.get(project);
  if (cached) return cached;
  const configPath = join(project, 'tsconfig.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, project, undefined, configPath);
  if (parsed.errors.length) throw new Error(parsed.errors.map(error => ts.flattenDiagnosticMessageText(error.messageText, '\n')).join('\n'));
  const sources = new Set(parsed.fileNames.map(file => relative(project, file).split(sep).join('/')));
  rootBuildTestSourcesByRoot.set(project, sources);
  return sources;
}

export function loadGroups(root = ROOT): Groups {
  const data = JSON.parse(readFileSync(join(root, 'scripts', 'node-test-groups.json'), 'utf8'));
  if (!Array.isArray(data.integration) || !data.budget?.fast || !data.budget?.integration) throw new Error('node-test-groups.json lacks integration or budget');
  return data as Groups;
}

export function isNodeTest(path: string, root = ROOT): boolean {
  const source = path.split('\\').join('/');
  if (!/\.test\.ts$/.test(source) || source.split('/').some(part => ['node_modules', 'dist'].includes(part))) return false;
  // Budget only test files included by the root TypeScript build; vendored Vitest suites outside that build are excluded.
  return rootBuildTestSources(root).has(source);
}

export function plan(sources: string[], groups: Groups, root = ROOT): Planned[] {
  const integration = new Set(groups.integration);
  return [...new Set(sources.map(source => source.split('\\').join('/')))].filter(source => isNodeTest(source, root)).sort().map(source => ({
    source, compiled: join('dist', source.replace(/\.ts$/, '.js')), group: integration.has(source) ? 'integration' as const : 'fast' as const,
  }));
}

export function changedTests(base: string, head: string, root = ROOT): string[] {
  const out = execFileSync('git', ['diff', '--name-only', '--diff-filter=AM', base + '...' + head], { cwd: root, encoding: 'utf8' });
  return out.split(/\r?\n/).filter(Boolean).filter(source => isNodeTest(source, root));
}

/**
 * Give changed test files the environment scripts/run-node-tests.mjs gives them:
 * the support rules.json beside its compiled installer and the locked native
 * SQLite archive. A fresh build has neither, and the minimal CI lane does not
 * run run-node-tests.mjs before this gate.
 */
export async function prepareTestAssets(root = ROOT): Promise<void> {
  const asset = join('skills', 'support', 'runtime-adaptation', 'scripts', 'rules.json');
  mkdirSync(dirname(join(root, 'dist', asset)), { recursive: true });
  copyFileSync(join(root, asset), join(root, 'dist', asset));
  await prepareNative({ sourceRoot: root, output: join(root, 'dist', 'native', 'sqlite3') });
}

export interface BudgetOptions { root?: string; waitingRatio?: number; waitingMinSeconds?: number; groups?: Groups; bash?: string | null }

export async function runBudget(sources: string[], options: BudgetOptions = {}): Promise<{ code: number; lines: string[] }> {
  const root = options.root ?? ROOT, groups = options.groups ?? loadGroups(root), planned = plan(sources, groups, root), lines: string[] = [];
  if (!planned.length) return { code: 0, lines: ['test budget: no added or changed Node test files'] };
  const missing = planned.filter(item => !existsSync(join(root, item.compiled)));
  if (missing.length) return { code: 2, lines: missing.map(item => 'test budget: compiled file missing for ' + item.source + ' (' + item.compiled + '); run npm run build') };
  const smells = scanPaths(planned.map(item => join(root, item.source)));
  if (smells.length) lines.push('test smells in changed files (advice):', ...render(smells).map(line => line.split(root + '/').join('')));
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: dirname(process.execPath) + delimiter + (process.env.PATH ?? ''), JSTACK_LOOPBACK_TEST: process.env.JSTACK_LOOPBACK_TEST ?? '1' };
  // A parent node --test run sets NODE_TEST_CONTEXT; a child that inherits it
  // reports to that parent instead of running its file.
  delete env.NODE_TEST_CONTEXT;
  const saved = process.env;
  let code = 0;
  for (const group of ['fast', 'integration'] as const) {
    const units = planned.filter(item => item.group === group).map(item => item.compiled);
    if (!units.length) continue;
    const budget = groups.budget[group];
    lines.push('', group + ' tests: budget ' + budget.maxSeconds + ' s, ' + budget.repeat + ' runs each, one file at a time');
    process.env = env;
    try {
      const report = await profile({ cmd: '"' + process.execPath + '" --test {file}', units, workers: 1, cwd: root, timeout: Math.max(60, budget.maxSeconds * 4), top: units.length,
        maxSeconds: budget.maxSeconds, failOnWaiting: true, repeat: budget.repeat, waitingRatio: options.waitingRatio ?? WAITING_RATIO,
        waitingMinSeconds: options.waitingMinSeconds ?? WAITING_MIN_SECONDS, bash: options.bash });
      lines.push(...report.lines);
      code = Math.max(code, report.code);
    } finally { process.env = saved; }
  }
  if (code === 1) lines.push('', 'Fix WAITING, OVER, or FLAKY files in the test or in the timers it exercises; do not raise the budget.');
  return { code, lines };
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  let base: string | undefined, head = 'HEAD'; const files: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--help' || arg === '-h') { console.log('test_budget.js --base REF [--head REF] | --files FILE...'); return 0; }
    if (arg === '--base') base = argv[++i];
    else if (arg === '--head') head = argv[++i] ?? '';
    else if (arg === '--files') { while (argv[i + 1] && !argv[i + 1]!.startsWith('--')) files.push(argv[++i]!); }
    else { console.error('unknown argument ' + arg); return 2; }
  }
  if (!files.length && !base) { console.error('--base or --files is required'); return 2; }
  let sources = files;
  if (!files.length) {
    try { sources = changedTests(base!, head); } catch (error) { console.error('test budget: cannot diff ' + base + '...' + head + ': ' + (error as Error).message); return 2; }
  }
  if (plan(sources, loadGroups()).length) {
    try { await prepareTestAssets(); } catch (error) { console.error('test budget: cannot prepare test assets: ' + (error as Error).message); return 2; }
  }
  const result = await runBudget(sources);
  for (const line of result.lines) console.log(line);
  return result.code;
}

if (isMain(import.meta.url)) main().then(code => { process.exitCode = code; });
