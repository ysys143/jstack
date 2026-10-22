#!/usr/bin/env node
/** Build and validate a disposable Git snapshot, preserving the user's index. */
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildPackage } from './build.js';
import { runSuitesConcurrent } from '../scripts/run_suites.js';
import { isMain } from '../runtime/entry.js';
import { runProcess } from '../runtime/os.js';
import { integrationModeForPaths } from '../scripts/select_contract_suites.js';

export function initializeSnapshot(runtime: string, env: NodeJS.ProcessEnv, hooks: string): string {
  const git = (args: string[]) => {
    const result = spawnSync('git', ['-c', 'core.hooksPath=' + hooks, ...args], { cwd: runtime, env, encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) throw new Error(`Disposable Git command failed: ${result.stderr || result.error?.message}`);
    return result.stdout.trim();
  };
  git(['init', '-q']);
  // Worker copies require stable loose objects. A commit may otherwise launch
  // background maintenance while cpSync is walking this disposable repository.
  git(['config', 'gc.auto', '0']);
  git(['config', 'maintenance.auto', 'false']);
  git(['add', '.']);
  git(['-c', 'user.name=jstack validation', '-c', 'user.email=validation@example.invalid', 'commit', '-qm', 'test: bind disposable runtime snapshot']);
  return git(['rev-parse', 'HEAD']);
}

export interface ContractOptions { source: string; selected?: string[]; output?: string; planFile?: string; timingHistory?: string; quick?: boolean; followup?: boolean; deletion?: boolean }

/** A plan controls scope only when it is bound to the clean checkout being built. */
export function selectionFromPlan(plan: unknown, checkout: { head: string; tree: string; clean: boolean }): { selected: string[]; reason: string } {
  const value = plan as Record<string, unknown> | null;
  if (!value || value.schemaVersion !== 1 || !['shadow', 'enforce'].includes(String(value.mode)) ||
      !['full', 'scoped'].includes(String(value.scope)) || !['full', 'selected'].includes(String(value.execution)) ||
      !Array.isArray(value.selectedSuites) || (value.selectedSuites.length === 0 && !(value.scope === 'full' && value.execution === 'full')) ||
      value.selectedSuites.some(label => typeof label !== 'string' || !/^(?:[a-z0-9]+(?:-[a-z0-9]+)*|tests\/test_[a-z0-9_]+\.py)$/.test(label)) ||
      new Set(value.selectedSuites).size !== value.selectedSuites.length) throw new Error('Invalid contract selection plan');
  if (value.mode === 'shadow' && value.execution !== 'full') throw new Error('Shadow plan cannot select execution');
  if (value.execution === 'selected' && value.scope !== 'scoped') throw new Error('Selected execution needs a scoped plan');
  if (!checkout.clean || value.headCommit !== checkout.head || value.headTree !== checkout.tree) return { selected: [], reason: 'Plan does not match a clean checkout; running all contracts' };
  if (value.mode === 'shadow' || value.execution === 'full') return { selected: [], reason: value.mode === 'shadow' ? 'Shadow selection; running all contracts' : 'Planner requested full coverage' };
  return { selected: value.selectedSuites as string[], reason: 'Enforced selection bound to checkout' };
}

export function parseContractArgs(argv: string[]): Omit<ContractOptions, 'source'> {
  const result: Omit<ContractOptions, 'source'> = { selected: [] };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--quick') { result.quick = true; continue; }
    if (flag === '--followup') { result.followup = true; continue; }
    if (flag === '--deletion') { result.deletion = true; continue; }
    if (['--output', '--plan', '--timing-history'].includes(flag)) {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
      if (flag === '--output') result.output = value;
      else if (flag === '--plan') result.planFile = value;
      else result.timingHistory = value;
    } else if (flag.startsWith('--')) throw new Error(`Unknown contract option: ${flag}`);
    else result.selected!.push(flag);
  }
  if (result.planFile && result.selected!.length) throw new Error('Do not combine a selection plan with explicit suites');
  if (result.followup && (!result.quick || !result.planFile)) throw new Error('--followup requires --quick and --plan');
  if (result.deletion && result.quick) throw new Error('--deletion cannot be combined with --quick; quick contracts omit deletion controls');
  return result;
}
export async function runContracts(options: ContractOptions): Promise<number> {
  const source = resolve(options.source);
  let selected = options.selected ?? [], selectionPlan: unknown, selectionReason = selected.length ? 'Explicit suites' : 'Full coverage';
  if (options.planFile) {
    if (selected.length) throw new Error('Do not combine a selection plan with explicit suites');
    const bytes = readFileSync(options.planFile);
    if (bytes.length > 1024 * 1024) throw new Error('Contract selection plan exceeds 1 MiB');
    selectionPlan = JSON.parse(bytes.toString('utf8'));
    const git = (args: string[]) => {
      const result = spawnSync('git', args, { cwd: source, encoding: 'utf8', windowsHide: true });
      if (result.status !== 0) throw new Error('Cannot bind contract selection to source Git tree');
      return result.stdout.trim();
    };
    const selection = selectionFromPlan(selectionPlan, { head: git(['rev-parse', 'HEAD']), tree: git(['rev-parse', 'HEAD^{tree}']), clean: git(['status', '--porcelain', '--untracked-files=all']) === '' });
    selected = selection.selected; selectionReason = selection.reason;
    if (options.quick) {
      const value = selectionPlan as Record<string, unknown>;
      if (selection.reason === 'Plan does not match a clean checkout; running all contracts' ||
          !Array.isArray(value.changedPaths) || !value.changedPaths.every(path => typeof path === 'string') ||
          (!options.followup && (value.integrationMode !== 'quick' || integrationModeForPaths(value.changedPaths as string[]) !== 'quick')) ||
          !Array.isArray(value.quickSuites) || value.quickSuites.length === 0 ||
          value.quickSuites.some(label => typeof label !== 'string' || !/^(?:[a-z0-9]+(?:-[a-z0-9]+)*|tests\/test_[a-z0-9_]+\.py)$/.test(label)) ||
          new Set(value.quickSuites).size !== value.quickSuites.length ||
          value.quickSuites.some(label => !(value.selectedSuites as string[]).includes(label))) {
        throw new Error('Quick contracts require a matching, classified change plan');
      }
      selected = value.quickSuites as string[];
      selectionReason = `Quick owner and host selection (${selected.length} suites)`;
    }
  }
  const root = options.output ? resolve(options.output) : mkdtempSync(join(tmpdir(), 'jstack-contracts-node-'));
  if (options.output) mkdirSync(root, { recursive: false });
  console.log(`Contract evidence: ${root}`);
  console.log(`${options.quick ? 'Quick contracts (deletion controls omitted)' : options.deletion ? 'Full contracts with deletion controls' : 'Contracts without deletion controls (pass --deletion to run them)'}: ${selectionReason}`);
  if (selectionPlan) writeFileSync(join(root, 'selection-plan.json'), JSON.stringify(selectionPlan, null, 2) + '\n');
  const built = await buildPackage(source, join(root, 'package')), runtime = join(root, 'jstack');
  cpSync(join(root, 'package/payload'), runtime, { recursive: true });
  const lookup = spawnSync('git', ['rev-parse', '--git-path', 'index'], { cwd: source, encoding: 'utf8' });
  if (lookup.status !== 0) throw new Error('Cannot locate source Git index');
  const indexPath = resolve(source, lookup.stdout.trim());
  const indexHash = () => existsSync(indexPath) ? createHash('sha256').update(readFileSync(indexPath)).digest('hex') : null;
  const before = indexHash();
  const env: NodeJS.ProcessEnv = { ...process.env, JSTACK_RUNTIME_ROOT: runtime, JSTACK_SUITE_EVIDENCE_DIR: join(root, 'suites'), JSTACK_PACKAGE_ROOT: join(root, 'package') };
  // Deletion controls are opt-in: they multiply owning-suite work and only guard
  // against contracts that no longer depend on the instructions they cover.
  // The environment is set explicitly so an inherited value cannot change the mode.
  if (options.quick) env.JSTACK_QUICK_CONTRACTS = '1';
  else delete env.JSTACK_QUICK_CONTRACTS;
  if (options.deletion) delete env.JSTACK_SKIP_DELETION;
  else env.JSTACK_SKIP_DELETION = '1';
  // Inherited Git overrides must not redirect disposable operations to the source index.
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  let code = 2, head: string | null = null, failure: string | undefined;
  try {
    head = initializeSnapshot(runtime, env, join(root, 'empty-hooks'));
    // Frozen reference headers can point to older blobs outside the current tree.
    // Copy only those immutable objects; never borrow or modify the source index.
    const frozenBlobs = new Set<string>();
    const scanReferences = (directory: string) => { for (const entry of readdirSync(directory, {withFileTypes:true})) { const path=join(directory,entry.name); if(entry.isDirectory()&&!['.git','node_modules','repos'].includes(entry.name))scanReferences(path); else if(entry.isFile()&&entry.name.endsWith('.lines')) { const match=/^# blob:\s*([0-9a-f]{7,40})\b/m.exec(readFileSync(path,'utf8')); if(match)frozenBlobs.add(match[1]); } } };
    scanReferences(runtime);
    for(const blob of frozenBlobs){
      if(spawnSync('git',['cat-file','-e',blob],{cwd:runtime,env}).status===0)continue;
      const original=spawnSync('git',['cat-file','blob',blob],{cwd:source,env,maxBuffer:64*1024*1024});
      if(original.status!==0)throw new Error(`Frozen reference blob is unavailable: ${blob}`);
      const copied=spawnSync('git',['hash-object','-w','--stdin'],{cwd:runtime,env,input:original.stdout,encoding:'utf8'});
      if(copied.status!==0||!copied.stdout.trim().startsWith(blob))throw new Error(`Frozen reference blob copy failed: ${blob}`);
    }
    if (!selected.length || selected.includes('dashboard')) {
      const dependencyRoot = join(root, 'dashboard-build-environment'); mkdirSync(dependencyRoot);
      for (const file of ['package.json', 'package-lock.json']) cpSync(join(runtime, 'skills/dashboard', file), join(dependencyRoot, file));
      const result = runProcess('npm', ['ci', '--no-audit', '--no-fund'], { cwd: dependencyRoot, env, maxBuffer: 16 * 1024 * 1024 });
      writeFileSync(join(root, 'dashboard-dependencies.log'), (result.stdout ?? '') + (result.stderr ?? ''));
      if (result.status !== 0) throw new Error('Disposable dashboard dependency installation failed');
      env.JSTACK_DASHBOARD_DEPENDENCIES = join(dependencyRoot, 'node_modules');
    }
    if (!selected.length || selected.some(label => /test_repack\.(?:py|js)$/.test(label))) {
      const dependencyRoot = join(root, 'contributor-build-environment'); mkdirSync(dependencyRoot);
      for (const file of ['package.json', 'package-lock.json']) cpSync(join(source, file), join(dependencyRoot, file));
      const result = runProcess('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: dependencyRoot, env, maxBuffer: 16 * 1024 * 1024 });
      writeFileSync(join(root, 'contributor-dependencies.log'), (result.stdout ?? '') + (result.stderr ?? ''));
      if (result.status !== 0) throw new Error('Disposable contributor dependency installation failed');
      env.JSTACK_BUILD_DEPENDENCIES = join(dependencyRoot, 'node_modules');
    }
    code = await runSuitesConcurrent({ root: runtime, selected, evidence: env.JSTACK_SUITE_EVIDENCE_DIR, env, inputFingerprint: built.sourceSha256, timingHistory: options.timingHistory, deferFloorParity: !options.deletion });
  } catch (error) { failure = String(error); console.error(failure); }
  finally {
    const preserved = before === indexHash();
    if (!preserved) code = 2;
    writeFileSync(join(root, 'summary.json'), JSON.stringify({ schemaVersion: 2, package: built, skills: selected, selectionReason, validationMode: options.quick ? options.followup ? 'quick-followup' : 'quick' : options.deletion ? 'full' : 'full-no-deletion', exitCode: code, sourceIndexPreserved: preserved, deletionSkipped: env.JSTACK_SKIP_DELETION === '1', nodeVersion: process.version, platform: process.platform, architecture: process.arch, runtimeGitHead: head, failure }, null, 2) + '\n');
  }
  return code;
}
export async function main(argv = process.argv.slice(2)): Promise<number> {
  return runContracts({ source: resolve(dirname(fileURLToPath(import.meta.url)), '../..'), ...parseContractArgs(argv) });
}
if (isMain(import.meta.url)) main().then(code => { process.exitCode = code; }).catch(error => { console.error(String(error)); process.exitCode = 2; });
