/**
 * Protected oracle: report a change that weakens the tests that judge it.
 *
 *   oracle_guard.js --base REF [--head REF] [--reason TEXT] [--json]
 *   oracle_guard.js --diff FILE|- [--reason TEXT] [--json]
 *
 * Without --head the working tree, staged changes included, is compared with the
 * merge base of REF and HEAD. With --head the commits REF...HEAD are compared.
 *
 * Kinds, per test file: deleted-test (deleted, not renamed), skip-added and
 * focus-added (more markers added than removed), assertions-reduced (fewer
 * assertion calls than before). Markers inside string literals are test data and
 * are not counted. This is a line heuristic, not a parser: an assertion replaced
 * by a weaker one on the same line is not seen.
 *
 * A finding is accepted when the change states why: a `Test-Change-Reason:`
 * trailer in a commit of REF...HEAD, or --reason for uncommitted work.
 * A diff that touches no test file exits 0 at once.
 *
 * Exit codes: 0 no finding or every finding has a reason, 1 an unexplained
 * finding, 2 usage or git error.
 */
import { classify } from './test_smells.js';
import { runProcess } from '../../../../../runtime/os.js';
import { isMain } from '../../../../../runtime/entry.js';
import * as fs from 'node:fs';

export type Kind = 'deleted-test' | 'skip-added' | 'focus-added' | 'assertions-reduced';
export interface Finding { file: string; kind: Kind; detail: string }
export interface FileChange { path: string; deleted: boolean; added: string[]; removed: string[] }

const SKIP = /\b(?:describe|it|test|context|suite)\.skip\(|\bx(?:it|describe|test)\(|\btest\.todo\(|@pytest\.mark\.(?:skip|skipif|xfail)\b|\bpytest\.skip\(|@unittest\.skip|\bself\.skipTest\(|\bt\.Skip(?:f|Now)?\(|#\[ignore\]|@Disabled\b|@Ignore\b|\bskip\s*:\s*(?:true\b|['"`])/g;
const FOCUS = /\b(?:describe|it|test|context)\.only\(|\bf(?:it|describe)\(|@pytest\.mark\.only\b|\bonly\s*:\s*true\b/g;
const ASSERT = /^\s*assert\s|\bassert(?:_\w+|[A-Z]\w*)?!?\s*[(.!]|\bexpect\s*\(|\.should\b|\brequire\.\w+\(|\bt\.(?:Error|Errorf|Fatal|Fatalf|Fail|FailNow)\(|\bcheck\s*\(/g;

/** Blank the inside of string literals so a marker quoted as test data is not counted. */
export function code(line: string): string {
  return line.replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g, quote => quote[0] + ' '.repeat(Math.max(0, quote.length - 2)) + quote[0]);
}

function count(lines: string[], pattern: RegExp): number {
  let total = 0;
  for (const line of lines) total += line.match(pattern)?.length ?? 0;
  return total;
}

export function isTestFile(rel: string): boolean {
  const { scan, config } = classify(rel, false);
  return scan && !config;
}

/** Parse `git diff` output, keeping added and removed lines per new-side path. */
export function parseDiff(text: string): FileChange[] {
  const files: FileChange[] = [];
  let current: FileChange | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('diff --git ')) {
      const match = / b\/(.*)$/.exec(line);
      current = { path: match ? match[1]! : '', deleted: false, added: [], removed: [] };
      files.push(current);
    } else if (!current) continue;
    else if (line.startsWith('deleted file mode')) current.deleted = true;
    else if (line.startsWith('--- a/') && current.deleted) current.path = line.slice(6);
    else if (line.startsWith('+++ b/')) current.path = line.slice(6);
    else if (line.startsWith('+++ ') || line.startsWith('--- ')) continue;
    else if (line.startsWith('+')) current.added.push(line.slice(1));
    else if (line.startsWith('-')) current.removed.push(line.slice(1));
  }
  return files.filter(file => file.path);
}

export function findWeakening(changes: FileChange[]): { tests: string[]; findings: Finding[] } {
  const tests: string[] = [], findings: Finding[] = [];
  for (const change of changes) {
    if (!isTestFile(change.path)) continue;
    tests.push(change.path);
    if (change.deleted) {
      findings.push({ file: change.path, kind: 'deleted-test', detail: count(change.removed, ASSERT) + ' assertion calls removed with the file' });
      continue;
    }
    const net = (pattern: RegExp) => count(change.added, pattern) - count(change.removed, pattern);
    const markers = (pattern: RegExp) => count(change.added.map(code), pattern) - count(change.removed.map(code), pattern);
    const skips = markers(SKIP), focus = markers(FOCUS), asserts = net(ASSERT);
    if (skips > 0) findings.push({ file: change.path, kind: 'skip-added', detail: skips + ' more skip marker(s)' });
    if (focus > 0) findings.push({ file: change.path, kind: 'focus-added', detail: focus + ' more focus marker(s); the rest of the suite stops running' });
    if (asserts < 0) findings.push({ file: change.path, kind: 'assertions-reduced', detail: -asserts + ' fewer assertion call(s)' });
  }
  return { tests, findings };
}

export function reasonsFrom(log: string): string[] {
  const reasons: string[] = [];
  for (const match of log.matchAll(/^Test-Change-Reason:[ \t]*(\S.*)$/gim)) reasons.push(match[1]!.trim());
  return reasons;
}

function git(cwd: string, args: string[]): string {
  const result = runProcess('git', args, { cwd, maxBuffer: 256 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(('git ' + args[0] + ': ' + (result.stderr || '').trim()).trim());
  return result.stdout;
}

const DIFF = ['diff', '--no-color', '--no-ext-diff', '--unified=0', '-M'];

export function collect(cwd: string, base: string, head?: string): { diff: string; log: string } {
  if (head) return { diff: git(cwd, [...DIFF, base + '...' + head]), log: git(cwd, ['log', '--format=%B', base + '..' + head]) };
  const mergeBase = git(cwd, ['merge-base', base, 'HEAD']).trim();
  return { diff: git(cwd, [...DIFF, mergeBase]), log: git(cwd, ['log', '--format=%B', mergeBase + '..HEAD']) };
}

export interface Report { tests: string[]; findings: Finding[]; reasons: string[]; verdict: 'pass' | 'accepted' | 'weakened' }

export function judge(diff: string, reasons: string[]): Report {
  const { tests, findings } = findWeakening(parseDiff(diff));
  const verdict = !findings.length ? 'pass' : reasons.length ? 'accepted' : 'weakened';
  return { tests, findings, reasons, verdict };
}

export function render(report: Report): string[] {
  if (!report.tests.length) return ['oracle guard: no test files changed'];
  const lines = ['oracle guard: ' + report.tests.length + ' test file(s) changed'];
  for (const finding of report.findings) lines.push('  ' + finding.kind + '  ' + finding.file + '  ' + finding.detail);
  if (report.verdict === 'pass') lines.push('no weakening found');
  else if (report.verdict === 'accepted') lines.push('accepted with stated reason(s):', ...report.reasons.map(reason => '  ' + reason));
  else lines.push('unexplained: state why with a `Test-Change-Reason:` commit trailer, or --reason for uncommitted work');
  return lines;
}

const USAGE = 'oracle_guard.js --base REF [--head REF] | --diff FILE|-  [--reason TEXT] [--json]';

export function main(argv = process.argv.slice(2), cwd = process.cwd()): number {
  let base: string | undefined, head: string | undefined, diffFile: string | undefined, json = false;
  const reasons: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!, value = argv[i + 1];
    if (arg === '--help' || arg === '-h') { console.log(USAGE); return 0; }
    if (arg === '--json') { json = true; continue; }
    if (!['--base', '--head', '--diff', '--reason'].includes(arg) || value === undefined) { console.error(USAGE); return 2; }
    i++;
    if (arg === '--base') base = value;
    else if (arg === '--head') head = value;
    else if (arg === '--diff') diffFile = value;
    else if (value.trim()) reasons.push(value.trim());
  }
  if (!base === !diffFile || (head && !base)) { console.error(USAGE); return 2; }
  let diff: string;
  try {
    if (diffFile) diff = fs.readFileSync(diffFile === '-' ? 0 : diffFile, 'utf8');
    else { const collected = collect(cwd, base!, head); diff = collected.diff; reasons.push(...reasonsFrom(collected.log)); }
  } catch (error) { console.error('oracle guard: ' + (error as Error).message); return 2; }
  const report = judge(diff, reasons);
  if (json) console.log(JSON.stringify(report, null, 1));
  else for (const line of render(report)) console.log(line);
  return report.verdict === 'weakened' ? 1 : 0;
}

if (isMain(import.meta.url)) process.exitCode = main();
