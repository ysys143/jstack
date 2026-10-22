/**
 * Find test-code patterns that make suites slow or unsafe to run in parallel.
 * This is a heuristic line scan, not a parser: treat hits as places to look.
 * Adapted from an MIT-licensed source; see ../NOTICE.
 *
 *   test_smells.js [PATH...]            default: current directory
 *   test_smells.js tests/ --json out.json
 *   test_smells.js --all-files src/     scan every source file, not only tests
 *
 * Kinds: sleep, fixed-port, fixed-path, real-network, retry-flaky, serial-only,
 * focused. A line containing "test-smells: allow" followed by a reason is
 * skipped; the reason is required. The scan is advisory and exits 0, or 2 on a
 * usage error.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { isMain } from '../../../../../runtime/entry.js';

export const TEST_FILE = /(^|\/)(test_[^/]*\.py|[^/]*_test\.(py|go|rb|exs?)|[^/]*[._-](test|spec)\.[cm]?[jt]sx?|[^/]*Tests?\.(java|kt|cs|swift|scala)|[^/]*_spec\.rb|conftest\.py)$/;
export const TEST_DIR = /(^|\/)(tests?|__tests__|spec|e2e|integration)\//;
export const CONFIG_FILE = /(^|\/)(jest\.config\.[cm]?[jt]s|vitest\.config\.[cm]?[jt]s|playwright\.config\.[cm]?[jt]s|pytest\.ini|setup\.cfg|tox\.ini|pyproject\.toml|package\.json|\.mocharc\.[a-z]+|build\.gradle(\.kts)?|pom\.xml)$/;
const SOURCE = /\.(py|[cm]?[jt]sx?|go|rb|java|kt|rs|cs|swift|scala|exs?)$/;
const ALL_SOURCE = /\.(py|[cm]?[jt]sx?|go|rb|java|kt|rs)$/;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'target', '.venv', 'venv', '__pycache__', '.next', 'coverage', 'vendor']);
const ALLOW = /test-smells:\s*allow\s+\S/;

export type Kind = 'sleep' | 'fixed-port' | 'fixed-path' | 'real-network' | 'retry-flaky' | 'serial-only' | 'focused';
type Rule = [Kind, RegExp, ((match: RegExpExecArray) => boolean) | null];
const MS = String.raw`(\d[\d_]*)`;
const ms = (text: string) => Number.parseInt(text.replaceAll('_', ''), 10);
export const RULES: Rule[] = [
  ['sleep', new RegExp(String.raw`setTimeout\(\s*\w+\s*,\s*` + MS + String.raw`\s*\)`, 'g'), m => ms(m[1]!) >= 100],
  ['sleep', new RegExp(String.raw`\b(?:sleep|delay|wait|pause)\(\s*` + MS + String.raw`\s*\)`, 'g'), m => ms(m[1]!) >= 100],
  ['sleep', new RegExp(String.raw`\b(?:waitForTimeout|cy\.wait)\(\s*` + MS, 'g'), m => ms(m[1]!) >= 100],
  ['sleep', /\b(?:time|asyncio|gevent|trio)\.sleep\(\s*([\d.]+)\s*\)/g, m => Number(m[1]) >= 0.1],
  ['sleep', new RegExp(String.raw`Thread\.sleep\(\s*` + MS, 'g'), m => ms(m[1]!) >= 100],
  ['sleep', /TimeUnit\.\w+\.sleep\(/g, null],
  ['sleep', /time\.Sleep\(\s*(\d+)\s*\*\s*time\.(Second|Millisecond|Minute)/g, m => m[2] !== 'Millisecond' || Number(m[1]) >= 100],
  ['sleep', /^\s*sleep[\s(]+([\d.]+)/g, m => Number(m[1]) >= 0.1],
  ['sleep', /sleep\(\s*Duration::from_(secs|millis)\(\s*(\d+)/g, m => m[1] === 'secs' || Number(m[2]) >= 100],
  ['fixed-port', /\b(?:listen|port\s*[:=]|PORT\s*[:=]|bind)\s*\(?\s*['"]?(?:(?:localhost|127\.0\.0\.1|0\.0\.0\.0)?:)?(\d{4,5})\b/g, m => m[1] !== '0'],
  ['fixed-port', /(?:localhost|127\.0\.0\.1):(\d{4,5})\b/g, null],
  ['fixed-path', /['"](\/tmp\/[^'"]+|\/var\/tmp\/[^'"]+|C:\\\\Temp\\\\[^'"]+)['"]/g, null],
  ['real-network', /\b(?:fetch|urlopen|axios(?:\.\w+)?|requests\.\w+|httpx\.\w+|http\.(?:Get|Post|get|request)|got|superagent\.\w+|RestTemplate\.\w+|HttpRequest\.newBuilder|reqwest::get|Net::HTTP\.\w+|open-uri|curl)\s*\(?\s*['"`]https?:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|[\w.-]*example\.(?:com|org|net)|[\w.-]+\.(?:test|example|invalid|localhost)\b)/g, null],
  ['retry-flaky', /@(?:flaky|pytest\.mark\.flaky|RepeatedTest|Retry|RetryingTest)\b|\bjest\.retryTimes\(|\bretries\s*:\s*[1-9]|\bthis\.retries\(|--reruns\b|rerunFailingTestsCount/g, null],
  ['serial-only', /--runInBand|\b-i\b(?=.*jest)|--test-concurrency=1\b|maxWorkers\s*:\s*1\b|--maxWorkers=1\b|fileParallelism\s*:\s*false|singleThread\s*:\s*true|workers\s*:\s*1\b|-p\s+no:xdist|maxParallelForks\s*=\s*1\b|--test-threads=1\b|-parallel\s+1\b|-p\s+1\b(?=.*go test)/g, null],
  ['focused', /\b(?:describe|it|test|context)\.only\(|\bf(?:it|describe)\(|@pytest\.mark\.only\b|\.only\s*=\s*true/g, null],
];
export const ADVICE: Record<Kind, string> = {
  'sleep': 'wait for the condition (poll with a deadline) or fake the clock; make app intervals configurable',
  'fixed-port': 'bind port 0 and read the assigned port, so files can run side by side',
  'fixed-path': 'use a per-test temp dir (mkdtemp / tmp_path / t.TempDir / Files.createTempDirectory)',
  'real-network': 'stub the host or run a local fake; real hosts make tests slow and flaky',
  'retry-flaky': 'find the root cause (timing, order, shared state) instead of rerunning',
  'serial-only': 'find the shared state that forces serial runs, isolate it, then run in parallel',
  'focused': 'remove before committing: the rest of the suite is silently skipped',
};
export interface Hit { file: string; line: number; kind: Kind; text: string }

export function scanText(file: string, text: string, isConfig: boolean): Hit[] {
  const hits: Hit[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (line.length > 2000 || ALLOW.test(line)) return;
    for (const [kind, regex, keep] of RULES) {
      if (isConfig && kind !== 'serial-only' && kind !== 'retry-flaky') continue;
      regex.lastIndex = 0;
      for (let match = regex.exec(line); match; match = regex.exec(line)) {
        if (match[0] === '') { regex.lastIndex++; continue; }
        if (keep && !keep(match)) continue;
        hits.push({ file, line: index + 1, kind, text: line.trim().slice(0, 160) });
        break;
      }
    }
  });
  return hits;
}

export function classify(rel: string, allFiles: boolean): { scan: boolean; config: boolean } {
  const isConfig = CONFIG_FILE.test(rel);
  const isTest = TEST_FILE.test(rel) || (TEST_DIR.test(rel) && SOURCE.test(rel));
  return { scan: isTest || isConfig || (allFiles && ALL_SOURCE.test(rel)), config: isConfig && !isTest };
}

export function scanPaths(paths: string[], allFiles = false): Hit[] {
  const hits: Hit[] = [];
  const visitFile = (file: string) => {
    const rel = file.split(path.sep).join('/');
    const { scan, config } = classify(rel, allFiles);
    if (!scan) return;
    let text: string;
    try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
    hits.push(...scanText(rel, text, config));
  };
  const visit = (dir: string) => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) visit(full); }
      else if (entry.isFile()) visitFile(full);
    }
  };
  for (const root of paths) {
    let stat: fs.Stats;
    try { stat = fs.statSync(root); } catch { continue; }
    if (stat.isFile()) visitFile(root); else visit(root);
  }
  return hits;
}

export function render(hits: Hit[]): string[] {
  if (!hits.length) return ['no smells found'];
  const byKind = new Map<Kind, Hit[]>();
  for (const hit of hits) byKind.set(hit.kind, [...(byKind.get(hit.kind) ?? []), hit]);
  const lines: string[] = [];
  for (const [kind, list] of [...byKind.entries()].sort((a, b) => b[1].length - a[1].length)) {
    lines.push('', kind + ' (' + list.length + '): ' + ADVICE[kind]);
    for (const hit of list.slice(0, 25)) lines.push('  ' + hit.file + ':' + hit.line + '  ' + hit.text);
    if (list.length > 25) lines.push('  ... ' + (list.length - 25) + ' more');
  }
  return lines;
}

export function main(argv = process.argv.slice(2)): number {
  const paths: string[] = [];
  let json: string | undefined, allFiles = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--help' || arg === '-h') { console.log('test_smells.js [PATH...] [--json PATH] [--all-files]'); return 0; }
    if (arg === '--all-files') allFiles = true;
    else if (arg === '--json') { json = argv[++i]; if (json === undefined) { console.error('--json needs a value'); return 2; } }
    else if (arg.startsWith('--')) { console.error('unknown option ' + arg); return 2; }
    else paths.push(arg);
  }
  const hits = scanPaths(paths.length ? paths : ['.'], allFiles);
  for (const line of render(hits)) console.log(line);
  if (json) fs.writeFileSync(json, JSON.stringify(hits, null, 2) + '\n');
  return 0;
}

if (isMain(import.meta.url)) process.exitCode = main();
