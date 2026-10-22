/**
 * Profile test units one by one: wall time against CPU time, the long pole, and
 * the wall time more workers would give. A unit whose wall time far exceeds its
 * CPU time is waiting (sleeps, retry backoff, timers that keep a process alive,
 * network timeouts), not working. Budget flags turn the report into a gate for
 * new or changed tests. Adapted from an MIT-licensed source; see ../NOTICE.
 *
 * Usage:
 *   test_profile.js --cmd "node --test {file}" "test/**\/*.test.js"
 *   test_profile.js --cmd "python -m pytest -q {file}" "tests/test_*.py" --workers 8
 *   test_profile.js --cmd "go test ./{file}" pkg/a pkg/b      # {file} can be any unit
 *   test_profile.js --cmd "..." --json report.json UNITS...
 *   test_profile.js --cmd "..." --max-seconds 2 --fail-on-waiting --repeat 5 FILES
 *
 * CPU time is measured with bash's time keyword, which includes every child the
 * command waited for. Without bash, CPU is reported as unmeasured and WAITING
 * cannot be classified; --fail-on-waiting then exits 2.
 *
 * Exit codes: 0 every unit passed within limits; 1 a unit failed, timed out,
 * was FLAKY, or violated a budget; 2 usage error, nothing matched, or a
 * requested measurement was unavailable.
 */
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { isMain } from '../../../../../runtime/entry.js';

export const WAITING_RATIO = 0.35;
export const WAITING_MIN_SECONDS = 1.5;
export const EXIT_OK = 0, EXIT_VIOLATION = 1, EXIT_USAGE = 2;
const SKIP_DIRS = new Set(['.git', 'node_modules', '__pycache__', '.venv', 'venv', 'dist', 'build', 'target', 'vendor', 'coverage']);

export interface Options {
  cmd: string; units: string[]; workers: number; cwd?: string; timeout: number; top: number; json?: string;
  maxSeconds?: number; failOnWaiting: boolean; repeat: number; waitingRatio: number; waitingMinSeconds: number;
  bash?: string | null;
}
export interface RunResult { wall: number; cpu: number | null; exit: number | 'timeout' | 'error'; stderrTail: string }
export interface Row {
  unit: string; wall_s: number; cpu_s: number | null; cpu_ratio: number | null; exit: number | 'timeout' | 'error';
  runs: number; flaky: boolean; waiting: boolean | null; over: boolean; stderr_tail: string;
}

export function shellQuote(value: string): string {
  return /^[\w@%+=:,./-]+$/.test(value) ? value : "'" + value.replaceAll("'", "'\\''") + "'";
}

export function findBash(env: NodeJS.ProcessEnv = process.env): string | null {
  const dirs = (env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean);
  const names = process.platform === 'win32' ? ['bash.exe', 'bash'] : ['bash'];
  for (const dir of dirs) for (const name of names) {
    const file = path.join(dir, name);
    try { if (fs.statSync(file).isFile()) return file; } catch { /* not here */ }
  }
  return null;
}

/** Translate one glob to a regular expression: ** crosses directories, * and ? do not. */
export function globToRegExp(pattern: string): RegExp {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        i++;
        if (pattern[i + 1] === '/') { i++; out += '(?:.*/)?'; } else out += '.*';
      } else out += '[^/]*';
    } else if (c === '?') out += '[^/]';
    else if (c === '[') {
      const close = pattern.indexOf(']', i + 1);
      if (close < 0) out += '\\[';
      else { out += '[' + pattern.slice(i + 1, close).replace(/^!/, '^').replaceAll('\\', '\\\\') + ']'; i = close; }
    } else out += c.replace(/[.+^${}()|\\]/g, '\\$&');
  }
  return new RegExp('^' + out + '$');
}

function walk(root: string, start: string): string[] {
  const found: string[] = [];
  const visit = (dir: string) => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) { found.push(full); visit(full); } }
      else found.push(full);
    }
  };
  visit(start);
  return found.map(file => path.relative(root, file).split(path.sep).join('/'));
}

/** Expand globs relative to cwd; literal units pass through unchanged. Order is stable and duplicates are removed. */
export function expandUnits(patterns: string[], cwd: string): string[] {
  const units: string[] = [];
  for (const pattern of patterns) {
    let matches: string[];
    if (/[*?[]/.test(pattern)) {
      const normalized = pattern.split('\\').join('/').replace(/^\.\//, '');
      const fixed: string[] = [];
      for (const part of normalized.split('/')) { if (/[*?[]/.test(part)) break; fixed.push(part); }
      const regex = globToRegExp(normalized);
      matches = walk(cwd, path.join(cwd, ...fixed)).filter(rel => regex.test(rel)).sort();
    } else matches = [pattern];
    for (const match of matches) if (!units.includes(match)) units.push(match);
  }
  return units;
}

/** Longest-processing-time-first schedule: an estimate of wall time with N workers. */
export function lptMakespan(durations: number[], workers: number): number {
  const loads = new Array(Math.max(1, workers)).fill(0) as number[];
  for (const d of [...durations].sort((a, b) => b - a)) {
    let min = 0;
    for (let i = 1; i < loads.length; i++) if (loads[i]! < loads[min]!) min = i;
    loads[min] = loads[min]! + d;
  }
  return Math.max(...loads);
}

export function runOne(cmdTemplate: string, unit: string, cwd: string | undefined, timeoutSeconds: number, bash: string | null): Promise<RunResult> {
  const command = cmdTemplate.replaceAll('{file}', shellQuote(unit));
  const timeFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jstack-test-profile-')), 'time');
  const script = bash
    ? "exec 3>&2; TIMEFORMAT='%U %S'; { time { " + command + "\n} 2>&3; } 2>\"$JSTACK_TEST_PROFILE_TIME\""
    : command;
  return new Promise(resolve => {
    const started = performance.now();
    const posix = process.platform !== 'win32';
    const child = bash
      ? spawn(bash, ['-c', script], { cwd, env: { ...process.env, JSTACK_TEST_PROFILE_TIME: timeFile }, stdio: ['ignore', 'ignore', 'pipe'], detached: posix })
      : spawn(script, { cwd, shell: true, stdio: ['ignore', 'ignore', 'pipe'], detached: posix });
    let tail = '';
    child.stderr?.on('data', (chunk: Buffer) => { tail = (tail + chunk.toString('utf8')).slice(-400); });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { if (posix && child.pid) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { /* already gone */ }
    }, timeoutSeconds * 1000);
    let done = false;
    const finish = (exit: RunResult['exit']) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const wall = (performance.now() - started) / 1000;
      let cpu: number | null = null;
      if (bash && !timedOut) {
        try {
          const fields = fs.readFileSync(timeFile, 'utf8').trim().split(/\s+/).map(Number);
          if (fields.length >= 2 && fields.every(Number.isFinite)) cpu = fields[0]! + fields[1]!;
        } catch { /* no report */ }
      }
      fs.rmSync(path.dirname(timeFile), { recursive: true, force: true });
      resolve({ wall, cpu, exit: timedOut ? 'timeout' : exit, stderrTail: exit === 0 && !timedOut ? '' : tail });
    };
    child.on('error', error => { tail = String(error.message); finish('error'); });
    child.on('close', code => finish(code ?? 'error'));
  });
}

export function summarize(unit: string, runs: RunResult[], options: Pick<Options, 'maxSeconds' | 'waitingRatio' | 'waitingMinSeconds'>): Row {
  const worst = runs.reduce((a, b) => (b.wall > a.wall ? b : a));
  const failing = runs.find(run => run.exit !== 0);
  const flaky = new Set(runs.map(run => run.exit === 0)).size > 1;
  const ratio = worst.cpu === null || worst.wall <= 0 ? null : worst.cpu / worst.wall;
  const waiting = ratio === null ? null : worst.wall >= options.waitingMinSeconds && ratio < options.waitingRatio;
  const round = (n: number) => Math.round(n * 1000) / 1000;
  return {
    unit, wall_s: round(worst.wall), cpu_s: worst.cpu === null ? null : round(worst.cpu), cpu_ratio: ratio === null ? null : round(ratio),
    exit: failing ? failing.exit : worst.exit, runs: runs.length, flaky, waiting,
    over: options.maxSeconds !== undefined && worst.wall > options.maxSeconds, stderr_tail: failing ? failing.stderrTail : '',
  };
}

async function pool<T, R>(items: T[], workers: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(workers, items.length)) }, async () => {
    while (next < items.length) { const index = next++; results[index] = await work(items[index]!); }
  });
  await Promise.all(lanes);
  return results;
}

export interface Report { rows: Row[]; lines: string[]; violations: string[]; cpuMeasured: boolean; code: number; json: Record<string, unknown> }

export async function profile(options: Options): Promise<Report> {
  const cwd = path.resolve(options.cwd ?? '.');
  const units = expandUnits(options.units, cwd);
  if (!units.length) return { rows: [], lines: ['no test units matched'], violations: [], cpuMeasured: false, code: EXIT_USAGE, json: {} };
  const bash = options.bash === undefined ? findBash() : options.bash;
  const started = performance.now();
  const rows = await pool(units, options.workers, async unit => {
    const runs: RunResult[] = [];
    for (let i = 0; i < Math.max(1, options.repeat); i++) runs.push(await runOne(options.cmd, unit, cwd, options.timeout, bash));
    return summarize(unit, runs, options);
  });
  const elapsed = (performance.now() - started) / 1000;
  return reportRows(rows, options, elapsed, os.availableParallelism?.() ?? os.cpus().length);
}

/** Classify captured measurements without depending on the scheduling of a test fixture. */
export function reportRows(rows: Row[], options: Options, elapsed: number, cpus: number): Report {
  rows.sort((a, b) => b.wall_s - a.wall_s);
  const cpuMeasured = rows.every(row => row.cpu_s !== null);
  const totalWall = rows.reduce((sum, row) => sum + row.wall_s, 0);
  const totalCpu = rows.reduce((sum, row) => sum + (row.cpu_s ?? 0), 0);
  const waiting = rows.filter(row => row.waiting === true);
  const waitSeconds = waiting.reduce((sum, row) => sum + row.wall_s - (row.cpu_s ?? 0), 0);
  const failed = rows.filter(row => row.exit !== 0);
  const projections: Record<string, number> = {};
  for (const n of [...new Set([1, 2, 4, 8, 10, 16, cpus])].sort((a, b) => a - b)) projections[String(n)] = Math.round(lptMakespan(rows.map(row => row.wall_s), n) * 10) / 10;
  const f1 = (n: number) => n.toFixed(1);
  const lines: string[] = [];
  const shown = rows.slice(0, options.top);
  const width = Math.max(4, ...shown.map(row => row.unit.length));
  lines.push(['unit'.padEnd(width), 'wall s'.padStart(7), 'cpu s'.padStart(7), 'cpu%'.padStart(5), ' note'].join('  '));
  for (const row of shown) {
    const note: string[] = [];
    if (row.waiting) note.push('WAITING');
    if (row.flaky) note.push('FLAKY');
    if (row.exit !== 0) note.push('exit=' + row.exit);
    if (row.over) note.push('OVER ' + options.maxSeconds + 's');
    lines.push([row.unit.padEnd(width), f1(row.wall_s).padStart(7), (row.cpu_s === null ? '-' : f1(row.cpu_s)).padStart(7),
      (row.cpu_ratio === null ? '-' : Math.round(row.cpu_ratio * 100) + '%').padStart(5), ' ' + note.join(' ')].join('  '));
  }
  lines.push('');
  lines.push(rows.length + ' units, serial sum ' + f1(totalWall) + ' s, CPU ' + (cpuMeasured ? f1(totalCpu) + ' s' : 'unmeasured') + ', profiled in ' + f1(elapsed) + ' s with ' + options.workers + ' workers');
  if (cpuMeasured) lines.push('waiting: ' + waiting.length + ' units spend about ' + f1(waitSeconds) + ' s (' + (totalWall ? Math.round(waitSeconds / totalWall * 100) : 0) + '% of serial time) not using the CPU');
  else lines.push('waiting: unmeasured; bash was not found, so CPU time and WAITING are unknown');
  lines.push('projected wall time by workers (longest first): ' + Object.entries(projections).map(([n, s]) => n + ': ' + s + ' s').join(', '));
  lines.push('long pole: ' + rows[0]!.unit + ' (' + f1(rows[0]!.wall_s) + ' s); no worker count finishes faster than this');
  if (failed.length) {
    lines.push('');
    lines.push(failed.length + ' units failed or timed out when run alone (order or shared-state dependence?):');
    for (const row of failed.slice(0, 10)) lines.push('  ' + row.unit + ' exit=' + row.exit + ' ' + (row.stderr_tail.trim().split(/\r?\n/).pop() ?? ''));
  }
  const violations: string[] = [];
  if (options.maxSeconds !== undefined) for (const row of rows) if (row.over) violations.push(row.unit + ': ' + f1(row.wall_s) + ' s > budget ' + options.maxSeconds + ' s');
  if (options.failOnWaiting) for (const row of waiting) violations.push(row.unit + ': WAITING (' + Math.round((row.cpu_ratio ?? 0) * 100) + '% CPU over ' + f1(row.wall_s) + ' s)');
  for (const row of rows) if (row.flaky) violations.push(row.unit + ': FLAKY (outcomes differed across ' + row.runs + ' runs)');
  if (violations.length) { lines.push(''); lines.push('BUDGET VIOLATIONS:'); for (const v of violations) lines.push('  ' + v); }
  else if (options.maxSeconds !== undefined || options.failOnWaiting || options.repeat > 1) { lines.push(''); lines.push('budget: all units within limits'); }
  let code = failed.length || violations.length ? EXIT_VIOLATION : EXIT_OK;
  if (options.failOnWaiting && !cpuMeasured) { lines.push('--fail-on-waiting needs CPU time; install bash or drop the flag'); code = EXIT_USAGE; }
  const json = { units: rows, serial_wall_s: Math.round(totalWall * 10) / 10, cpu_s: cpuMeasured ? Math.round(totalCpu * 10) / 10 : null,
    cpu_measured: cpuMeasured, waiting_units: waiting.map(row => row.unit), waiting_s: Math.round(waitSeconds * 10) / 10,
    projected_wall_s: projections, long_pole: rows[0]!.unit, cpus, violations };
  return { rows, lines, violations, cpuMeasured, code, json };
}

export function parseArgs(argv: string[]): Options | string {
  const options: Options = { cmd: '', units: [], workers: Math.min(8, os.availableParallelism?.() ?? os.cpus().length), timeout: 600, top: 15,
    failOnWaiting: false, repeat: 1, waitingRatio: WAITING_RATIO, waitingMinSeconds: WAITING_MIN_SECONDS };
  const numberFlags: Record<string, (value: number) => void> = {
    '--workers': v => { options.workers = v; }, '--timeout': v => { options.timeout = v; }, '--top': v => { options.top = v; },
    '--max-seconds': v => { options.maxSeconds = v; }, '--repeat': v => { options.repeat = v; },
    '--waiting-ratio': v => { options.waitingRatio = v; }, '--waiting-min-seconds': v => { options.waitingMinSeconds = v; },
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--fail-on-waiting') options.failOnWaiting = true;
    else if (arg === '--cmd' || arg === '--cwd' || arg === '--json') {
      const value = argv[++i];
      if (value === undefined) return arg + ' needs a value';
      if (arg === '--cmd') options.cmd = value; else if (arg === '--cwd') options.cwd = value; else options.json = value;
    } else if (Object.hasOwn(numberFlags, arg)) {
      const value = Number(argv[++i]);
      if (!Number.isFinite(value) || value <= 0) return arg + ' needs a positive number';
      numberFlags[arg]!(value);
    } else if (arg.startsWith('--')) return 'unknown option ' + arg;
    else options.units.push(arg);
  }
  if (!options.cmd) return '--cmd is required';
  if (!options.cmd.includes('{file}')) return '--cmd must contain {file}';
  if (!options.units.length) return 'at least one unit or glob is required';
  options.workers = Math.floor(options.workers); options.repeat = Math.floor(options.repeat);
  return options;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('test_profile.js --cmd "COMMAND {file}" UNIT_OR_GLOB... [--workers N] [--cwd DIR] [--timeout S] [--top N] [--json PATH] [--max-seconds S] [--fail-on-waiting] [--repeat N] [--waiting-ratio R] [--waiting-min-seconds S]');
    return EXIT_OK;
  }
  const options = parseArgs(argv);
  if (typeof options === 'string') { console.error(options); return EXIT_USAGE; }
  const report = await profile(options);
  for (const line of report.lines) console.log(line);
  if (options.json && report.rows.length) fs.writeFileSync(options.json, JSON.stringify(report.json, null, 2) + '\n');
  return report.code;
}

if (isMain(import.meta.url)) main().then(code => { process.exitCode = code; });
