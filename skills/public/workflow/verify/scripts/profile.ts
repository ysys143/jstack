/**
 * Project verification profile: which optional checks this repository uses.
 *
 *   profile.js check [--repo DIR]              validate .jstack/verification.json
 *   profile.js draft                           print a starting profile; writes nothing
 *   profile.js run --base REF [--kind KIND]... [--repo DIR] [--json]
 *
 * The profile is committed with the repository so a team shares it. Without it
 * every optional check is off and nothing extra runs. `run` executes the checks
 * whose `apply` is "change" on the files changed since the merge base of REF and
 * HEAD, working tree included; checks with `apply: "requirement"` run only when a
 * version 2 requirement selects them (workflow.js).
 *
 * A command token `{FILES}` expands to the changed files. A declared check whose
 * tool cannot start is a gap, not a pass. Mode "report" records a nonzero exit
 * without failing; mode "fail" fails. Exit codes: 0 every check passed or only
 * reported, 1 a check failed or a declared tool is missing, 2 an invalid profile,
 * usage, or git error.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { runProcess } from '../../../../../runtime/os.js';
import { isMain } from '../../../../../runtime/entry.js';
import { splitCommand } from './red_probe.js';
import { crapScores, mutationSurvivors, duplicateClones, scopeFromFiles, scopeFromDiff, type Scope, type Finding } from '../../test-driven-development/scripts/strength_gates.js';

export const PROFILE_PATH = '.jstack/verification.json';
export const KINDS = ['mutation', 'crap', 'duplication', 'direction', 'holdout', 'authorSplit'] as const;
export type CheckKind = typeof KINDS[number];
/** Kinds run as a command over files; holdout and authorSplit change who sees what instead. */
export const COMMAND_KINDS: CheckKind[] = ['mutation', 'crap', 'duplication', 'direction'];
export interface CheckSpec { command?: string; report?: string; complexity?: string; coverage?: string; threshold?: number; dir?: string; mode: 'report' | 'fail'; apply: 'requirement' | 'change' }
export interface Profile { schemaVersion: 1; checks: Partial<Record<CheckKind, CheckSpec>> }

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Validate parsed JSON; returns the normalized profile or the list of problems. */
export function validate(data: unknown): { profile?: Profile; problems: string[] } {
  const problems: string[] = [];
  if (!object(data)) return { problems: ['the profile is not a JSON object'] };
  if (data.schemaVersion !== 1) problems.push('schemaVersion must be 1');
  if (!object(data.checks)) return { problems: [...problems, 'checks must be an object'] };
  const checks: Partial<Record<CheckKind, CheckSpec>> = {};
  for (const [kind, raw] of Object.entries(data.checks)) {
    if (!(KINDS as readonly string[]).includes(kind)) { problems.push(`checks.${kind} is not a known kind (${KINDS.join(', ')})`); continue; }
    if (!object(raw)) { problems.push(`checks.${kind} must be an object`); continue; }
    const mode = raw.mode ?? 'report', apply = raw.apply ?? 'requirement';
    if (mode !== 'report' && mode !== 'fail') problems.push(`checks.${kind}.mode must be "report" or "fail"`);
    if (apply !== 'requirement' && apply !== 'change') problems.push(`checks.${kind}.apply must be "requirement" or "change"`);
    for (const field of ['command', 'report', 'complexity', 'coverage', 'dir'] as const) if (raw[field] !== undefined && (typeof raw[field] !== 'string' || !(raw[field] as string).trim())) problems.push(`checks.${kind}.${field} must be a nonempty string`);
    if (raw.threshold !== undefined && (typeof raw.threshold !== 'number' || !Number.isFinite(raw.threshold) || raw.threshold < 0)) problems.push(`checks.${kind}.threshold must be a number of at least 0`);
    if (COMMAND_KINDS.includes(kind as CheckKind) && typeof raw.command !== 'string') problems.push(`checks.${kind}.command is required: jstack runs the project's tool, it does not choose one`);
    if (kind === 'crap' && typeof raw.report === 'string') problems.push('checks.crap reads `complexity` (lizard --csv) and `coverage`, not `report`');
    if (kind === 'crap' && (typeof raw.complexity === 'string') !== (typeof raw.coverage === 'string')) problems.push('checks.crap needs both `complexity` and `coverage`, or neither');
    if (kind === 'holdout' && typeof raw.dir !== 'string') problems.push('checks.holdout.dir is required');
    if (kind === 'holdout' && typeof raw.command !== 'string') problems.push('checks.holdout.command is required');
    if (kind === 'holdout' && typeof raw.dir === 'string' && (path.isAbsolute(raw.dir) || raw.dir.split(/[\\/]/).includes('..'))) problems.push('checks.holdout.dir must be a relative path inside the repository');
    if (kind === 'holdout' && apply === 'change') problems.push('checks.holdout.apply must be "requirement": a holdout belongs to a requirement');
    if (kind === 'authorSplit' && apply === 'change') problems.push('checks.authorSplit.apply must be "requirement": author separation is chosen per requirement');
    checks[kind as CheckKind] = { ...(raw as object), mode, apply } as CheckSpec;
  }
  return problems.length ? { problems } : { profile: { schemaVersion: 1, checks }, problems };
}

/** Read the profile of a repository. A missing file is not an error: every optional check is off. */
export function loadProfile(repo: string): { profile: Profile | null; problems: string[] } {
  const file = path.join(repo, PROFILE_PATH);
  if (!fs.existsSync(file)) return { profile: null, problems: [] };
  let data: unknown;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { return { profile: null, problems: [`${PROFILE_PATH} is not valid JSON: ${(error as Error).message}`] }; }
  const result = validate(data);
  return { profile: result.profile ?? null, problems: result.problems };
}

export const DRAFT: Profile = {
  schemaVersion: 1,
  checks: {
    mutation: { command: 'npx stryker run --mutate {FILES}', report: 'reports/mutation/mutation.json', mode: 'report', apply: 'requirement' },
    duplication: { command: 'npx jscpd --reporters json --output reports/jscpd {FILES}', report: 'reports/jscpd/jscpd-report.json', mode: 'report', apply: 'change' },
  },
};

export interface CheckResult { kind: CheckKind; command: string; exitCode: number | null; mode: 'report' | 'fail'; outcome: 'passed' | 'reported' | 'failed' | 'gap'; detail: string }

/** Run one declared command check over the given files. */
/** Judge a report the declared command wrote; null when the kind or profile names no report. */
export function judgeReport(repo: string, kind: CheckKind, spec: CheckSpec, scope: Scope): { findings: Finding[]; label: string } | null {
  const read = (rel: string) => fs.readFileSync(path.resolve(repo, rel), 'utf8');
  if (kind === 'crap' && spec.complexity && spec.coverage) {
    const threshold = spec.threshold ?? 30, scores = crapScores(read(spec.complexity), read(spec.coverage), scope);
    return { label: `CRAP above ${threshold}`, findings: scores.filter(score => score.crap > threshold).map(score => ({ file: score.file, line: score.start, detail: `${score.name} CRAP ${score.crap}` })) };
  }
  if (kind === 'mutation' && spec.report) return { label: 'surviving mutants', findings: mutationSurvivors(read(spec.report), scope).findings };
  if (kind === 'duplication' && spec.report) return { label: 'clones', findings: duplicateClones(read(spec.report), scope) };
  return null;
}

export function runCheck(repo: string, kind: CheckKind, spec: CheckSpec, files: string[], tokens: Record<string, string[]> = {}, timeoutSeconds = 600, scope: Scope = scopeFromFiles(files)): CheckResult {
  const command = spec.command ?? '';
  let argv: string[];
  try { argv = splitCommand(command).flatMap(token => token === '{FILES}' ? files : tokens[token] ?? [Object.entries(tokens).reduce((text, [key, values]) => values.length === 1 ? text.replaceAll(key, values[0]!) : text, token)]); } catch (error) { return { kind, command, exitCode: null, mode: spec.mode, outcome: 'gap', detail: (error as Error).message }; }
  if (!argv.length) return { kind, command, exitCode: null, mode: spec.mode, outcome: 'gap', detail: 'empty command' };
  const result = runProcess(argv[0]!, argv.slice(1), { cwd: repo, timeout: timeoutSeconds * 1000, maxBuffer: 64 * 1024 * 1024 });
  const tail = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim().split(/\r?\n/).slice(-3).join('\n');
  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    return { kind, command, exitCode: null, mode: spec.mode, outcome: 'gap', detail: code === 'ENOENT' ? `the declared tool ${argv[0]} is not installed` : code === 'ETIMEDOUT' ? `timed out after ${timeoutSeconds} s` : result.error.message };
  }
  if (result.status === 0) {
    let judged: ReturnType<typeof judgeReport>;
    try { judged = judgeReport(repo, kind, spec, scope); } catch (error) { return { kind, command, exitCode: 0, mode: spec.mode, outcome: 'gap', detail: `the report could not be judged: ${(error as Error).message}` }; }
    if (!judged || !judged.findings.length) return { kind, command, exitCode: 0, mode: spec.mode, outcome: 'passed', detail: judged ? `no ${judged.label} on judged lines` : tail };
    const shown = judged.findings.slice(0, 5).map(finding => `${finding.file}:${finding.line} ${finding.detail}`).join('\n');
    return { kind, command, exitCode: 0, mode: spec.mode, outcome: spec.mode === 'fail' ? 'failed' : 'reported', detail: `${judged.findings.length} ${judged.label} on judged lines\n${shown}` };
  }
  if (result.status === 127) return { kind, command, exitCode: 127, mode: spec.mode, outcome: 'gap', detail: 'the declared tool could not start (exit 127)' };
  return { kind, command, exitCode: result.status, mode: spec.mode, outcome: spec.mode === 'fail' ? 'failed' : 'reported', detail: tail };
}

function changedScope(repo: string, base: string): { files: string[]; scope: Scope } {
  const git = (args: string[]) => {
    const result = runProcess('git', args, { cwd: repo });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(('git ' + args[0] + ': ' + (result.stderr || '').trim()).trim());
    return result.stdout;
  };
  const mergeBase = git(['merge-base', base, 'HEAD']).trim();
  const tracked = git(['diff', '--name-only', '--diff-filter=ACMR', mergeBase]), untracked = git(['ls-files', '--others', '--exclude-standard']).split(/\r?\n/).filter(Boolean);
  const files = [...new Set((tracked + '\n' + untracked.join('\n')).split(/\r?\n/).filter(file => file && !file.startsWith('.jstack/')))].sort();
  const scope: Scope = { ...scopeFromDiff(git(['diff', '--no-color', '--no-ext-diff', '--unified=0', mergeBase])), ...scopeFromFiles(untracked) };
  return { files, scope };
}

export function renderResults(results: CheckResult[]): string[] {
  if (!results.length) return ['verification profile: no check applies to this change'];
  return results.map(result => `${result.outcome.padEnd(8)} ${result.kind}  ${result.command}${result.detail ? '\n           ' + result.detail.split('\n').join('\n           ') : ''}`);
}

const USAGE = 'profile.js check [--repo DIR] | draft | run --base REF [--kind KIND]... [--repo DIR] [--json]';

export function main(argv = process.argv.slice(2)): number {
  const [action, ...rest] = argv;
  let repo = process.cwd(), base: string | undefined, json = false;
  const kinds: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!, value = rest[i + 1];
    if (arg === '--json') { json = true; continue; }
    if (!['--repo', '--base', '--kind'].includes(arg) || value === undefined) { console.error(USAGE); return 2; }
    i++;
    if (arg === '--repo') repo = path.resolve(value); else if (arg === '--base') base = value; else kinds.push(value);
  }
  if (action === 'draft') { console.log(JSON.stringify(DRAFT, null, 2)); return 0; }
  if (action !== 'check' && action !== 'run') { console.error(USAGE); return action === '--help' || action === '-h' ? 0 : 2; }
  const { profile, problems } = loadProfile(repo);
  if (problems.length) { for (const problem of problems) console.error(problem); return 2; }
  if (action === 'check') {
    if (!profile) { console.log(`no ${PROFILE_PATH}: every optional check is off`); return 0; }
    console.log(JSON.stringify(profile, null, 2));
    return 0;
  }
  if (!base) { console.error(USAGE); return 2; }
  const unknown = kinds.filter(kind => !(COMMAND_KINDS as string[]).includes(kind));
  if (unknown.length) { console.error(`--kind accepts ${COMMAND_KINDS.join(', ')}; got ${unknown.join(', ')}`); return 2; }
  let files: string[], scope: Scope;
  try { ({ files, scope } = changedScope(repo, base)); } catch (error) { console.error('verification profile: ' + (error as Error).message); return 2; }
  const results: CheckResult[] = [];
  for (const kind of COMMAND_KINDS) {
    const spec = profile?.checks[kind];
    if (!spec || (kinds.length ? !kinds.includes(kind) : spec.apply !== 'change')) continue;
    results.push(files.length ? runCheck(repo, kind, spec, files, {}, 600, scope) : { kind, command: spec.command ?? '', exitCode: null, mode: spec.mode, outcome: 'passed', detail: 'no changed files' });
  }
  if (json) console.log(JSON.stringify(results, null, 1)); else for (const line of renderResults(results)) console.log(line);
  return results.some(result => result.outcome === 'failed' || result.outcome === 'gap') ? 1 : 0;
}

if (isMain(import.meta.url)) process.exitCode = main();
