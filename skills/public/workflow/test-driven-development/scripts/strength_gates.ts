/**
 * Judge test strength on changed code from reports the project's own tools wrote.
 *
 *   strength_gates.js crap --diff FILE|- --complexity lizard.csv --coverage FILE [--threshold 30]
 *   strength_gates.js mutation --diff FILE|- --report FILE
 *   strength_gates.js duplication --diff FILE|- --report jscpd-report.json
 *
 * `--files PATH...` instead of --diff judges whole files (a requirement's files).
 * Only code the diff added is judged; untouched code is outside every gate.
 *
 * crap: CRAP = c² × (1 − coverage)³ + c per function (Savoia and Evans, Crap4j),
 *   c = cyclomatic complexity from `lizard --csv`, coverage = covered share of the
 *   function's measured lines (lcov, Cobertura, JaCoCo, Go). Default threshold 30
 *   is the Crap4j original. A function with no measured line counts as uncovered.
 * mutation: surviving or uncovered mutants on judged lines. Reports: Stryker, mull
 *   and other mutation-testing-elements JSON, PIT mutations.xml, cargo-mutants
 *   outcomes.json, gremlins JSON, and mutmut `mutants/<file>.meta` (judged at the
 *   range of the mutated function, read from <file> relative to the working directory).
 * duplication: jscpd clones with either fragment on judged lines.
 *
 * Exit codes: 0 no finding, 1 findings, 2 usage, unreadable or unsupported report.
 */
import { readFileSync } from 'node:fs';
import { DOMParser } from '@xmldom/xmldom';
import { isMain } from '../../../../../runtime/entry.js';
import { parse_diff, parse_coverage, match_path } from './test_gates.js';

/** Judged lines per path; 'all' judges every line of the file. */
export type Scope = Record<string, Set<number> | 'all'>;
export interface Finding { file: string; line: number; detail: string }

export function scopeFromDiff(diff: string): Scope { return parse_diff(diff); }
export function scopeFromFiles(files: string[]): Scope { return Object.fromEntries(files.map(file => [file, 'all' as const])); }

function judged(scope: Scope, file: string, first: number, last = first): boolean {
  const key = match_path(file, Object.keys(scope));
  if (key === null) return false;
  const lines = scope[key]!;
  if (lines === 'all') return true;
  for (const line of lines) if (line >= first && line <= last) return true;
  return false;
}

/** Minimal RFC 4180 row splitter for lizard's quoted CSV. */
export function csvRow(line: string): string[] {
  const out: string[] = []; let cell = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quoted) { if (c === '"' && line[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c; }
    else if (c === '"') quoted = true; else if (c === ',') { out.push(cell); cell = ''; } else cell += c;
  }
  out.push(cell);
  return out;
}

export interface FunctionCrap { file: string; name: string; start: number; end: number; complexity: number; coverage: number | null; crap: number }

export function crapScores(complexityCsv: string, coverageText: string, scope: Scope): FunctionCrap[] {
  const [coverage] = parse_coverage(coverageText);
  const out: FunctionCrap[] = [];
  for (const line of complexityCsv.split(/\r?\n/)) {
    const cells = csvRow(line);
    if (cells.length < 11 || !/^\d+$/.test(cells[1]!)) continue;
    const complexity = Number(cells[1]), file = cells[6]!, name = cells[7]!, start = Number(cells[9]), end = Number(cells[10]);
    if (!judged(scope, file, start, end)) continue;
    const key = match_path(file, Object.keys(coverage));
    let measured = 0, covered = 0;
    if (key !== null) for (let n = start; n <= end; n++) if (n in coverage[key]!) { measured++; if (coverage[key]![n]! > 0) covered++; }
    const share = measured ? covered / measured : null, uncovered = 1 - (share ?? 0);
    out.push({ file, name, start, end, complexity, coverage: share, crap: Math.round((complexity ** 2 * uncovered ** 3 + complexity) * 100) / 100 });
  }
  return out;
}

const SURVIVED = new Set(['Survived', 'NoCoverage', 'SURVIVED', 'NO_COVERAGE', 'LIVED', 'NOT COVERED', 'MissedMutant']);

export function mutationSurvivors(reportText: string, scope: Scope, options: { mutmutSource?: string; mutmutFile?: string } = {}): { format: string; findings: Finding[] } {
  const head = reportText.trimStart(), findings: Finding[] = [];
  const keep = (file: string, line: number, status: string, what: string) => { if (SURVIVED.has(status) && judged(scope, file, line)) findings.push({ file, line, detail: `${status}: ${what}` }); };
  if (head.startsWith('<')) {
    const doc = new DOMParser().parseFromString(reportText, 'text/xml'), root = doc.documentElement;
    if (!root || root.tagName !== 'mutations') throw new Error('XML report is not a PIT mutations.xml');
    for (const node of Array.from(root.getElementsByTagName('mutation'))) {
      const text = (tag: string) => node.getElementsByTagName(tag)[0]?.textContent ?? '';
      const cls = text('mutatedClass'), pkg = cls.includes('.') ? cls.slice(0, cls.lastIndexOf('.')).split('.').join('/') + '/' : '';
      keep(pkg + text('sourceFile'), Number(text('lineNumber')), node.getAttribute('status') ?? '', text('description') || text('mutator'));
    }
    return { format: 'pit', findings };
  }
  const data = JSON.parse(reportText);
  if (data && typeof data.files === 'object' && !Array.isArray(data.files) && 'schemaVersion' in data) {
    for (const [file, entry] of Object.entries<any>(data.files)) for (const m of entry.mutants ?? []) keep(file, Number(m.location?.start?.line), String(m.status), `${m.mutatorName ?? 'mutant'}${m.replacement ? ' → ' + m.replacement : ''}`);
    return { format: 'mutation-testing-elements', findings };
  }
  if (data && Array.isArray(data.outcomes)) {
    for (const outcome of data.outcomes) { const mutant = outcome.scenario?.Mutant; if (mutant) keep(String(mutant.file), Number(mutant.span?.start?.line), String(outcome.summary), String(mutant.name ?? 'mutant')); }
    return { format: 'cargo-mutants', findings };
  }
  if (data && Array.isArray(data.files) && 'go_module' in data) {
    for (const file of data.files) for (const m of file.mutations ?? []) keep(String(file.file_name), Number(m.line), String(m.status), String(m.type));
    return { format: 'gremlins', findings };
  }
  if (data && typeof data.exit_code_by_key === 'object' && options.mutmutSource !== undefined) {
    // mutmut 3 keeps no line numbers: judge each survivor at the range of its function.
    const source = options.mutmutSource.split(/\r?\n/), file = options.mutmutFile!;
    const range = (name: string): [number, number] | null => {
      const start = source.findIndex(line => new RegExp(`^(\\s*)(?:async\\s+)?def\\s+${name}\\s*\\(`).test(line));
      if (start < 0) return null;
      const indent = /^\s*/.exec(source[start]!)![0].length;
      let end = start;
      for (let i = start + 1; i < source.length; i++) { const line = source[i]!; if (!line.trim()) continue; if (/^\s*/.exec(line)![0].length <= indent) break; end = i; }
      return [start + 1, end + 1];
    };
    for (const [key, code] of Object.entries<any>(data.exit_code_by_key)) {
      if (code !== 0) continue;
      const name = /\.x[_ǁ]?(\w+?)__mutmut_\d+$/.exec(key)?.[1]?.replace(/^.*ǁ/, '');
      const lines = name ? range(name) : null;
      if (lines && judged(scope, file, lines[0], lines[1])) findings.push({ file, line: lines[0], detail: `survived: ${key} (function ${name}, lines ${lines[0]}-${lines[1]})` });
    }
    return { format: 'mutmut', findings };
  }
  throw new Error('unsupported mutation report (Stryker, mull and other mutation-testing-elements JSON, PIT mutations.xml, cargo-mutants outcomes.json, gremlins JSON, mutmut mutants/<file>.meta)');
}

export function duplicateClones(reportText: string, scope: Scope): Finding[] {
  const data = JSON.parse(reportText);
  if (!data || !Array.isArray(data.duplicates)) throw new Error('report is not a jscpd JSON report (no duplicates list)');
  const findings: Finding[] = [];
  for (const clone of data.duplicates) {
    const a = clone.firstFile, b = clone.secondFile;
    if (!a || !b) continue;
    const pair = `${a.name}:${a.start}-${a.end} = ${b.name}:${b.start}-${b.end}`;
    if (judged(scope, a.name, a.start, a.end)) findings.push({ file: a.name, line: a.start, detail: pair });
    else if (judged(scope, b.name, b.start, b.end)) findings.push({ file: b.name, line: b.start, detail: pair });
  }
  return findings;
}

const USAGE = 'usage: strength_gates.js crap|mutation|duplication (--diff FILE|- | --files PATH...) [--report FILE] [--complexity FILE --coverage FILE --threshold N]';

export function main(argv: string[]): number {
  const [command, ...rest] = argv, options: Record<string, string> = {}, files: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const key = rest[i]!;
    if (key === '--files') { while (rest[i + 1] !== undefined && !rest[i + 1]!.startsWith('--')) files.push(rest[++i]!); continue; }
    if (!['--diff', '--report', '--complexity', '--coverage', '--threshold'].includes(key) || rest[i + 1] === undefined) { console.error(USAGE); return 2; }
    options[key.slice(2)] = rest[++i]!;
  }
  if (!['crap', 'mutation', 'duplication'].includes(command ?? '') || (options.diff === undefined) === !files.length) { console.error(USAGE); return 2; }
  const read = (file: string) => readFileSync(file === '-' ? 0 : file, 'utf8');
  const scope = options.diff !== undefined ? scopeFromDiff(read(options.diff)) : scopeFromFiles(files);
  if (!Object.keys(scope).length) { console.log(`[SKIP] ${command}: the diff adds no lines — pass`); return 0; }
  let findings: Finding[], label: string;
  try {
    if (command === 'crap') {
      if (!options.complexity || !options.coverage) { console.error(USAGE); return 2; }
      const threshold = Number(options.threshold ?? 30);
      if (!Number.isFinite(threshold) || threshold < 0) { console.error('--threshold must be a number of at least 0'); return 2; }
      const scores = crapScores(read(options.complexity), read(options.coverage), scope);
      findings = scores.filter(score => score.crap > threshold).map(score => ({ file: score.file, line: score.start, detail: `${score.name}: CRAP ${score.crap} > ${threshold} (complexity ${score.complexity}, coverage ${score.coverage === null ? 'unmeasured' : Math.round(score.coverage * 100) + '%'})` }));
      label = `crap: ${scores.length} changed function(s), threshold ${threshold}`;
    } else if (command === 'mutation') {
      if (!options.report) { console.error(USAGE); return 2; }
      const meta = /(?:^|\/)mutants\/(.+)\.meta$/.exec(options.report.replaceAll('\\', '/'));
      const result = mutationSurvivors(read(options.report), scope, meta ? { mutmutFile: meta[1]!, mutmutSource: read(meta[1]!) } : {});
      findings = result.findings; label = `mutation (${result.format})`;
    } else {
      if (!options.report) { console.error(USAGE); return 2; }
      findings = duplicateClones(read(options.report), scope); label = 'duplication (jscpd)';
    }
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    console.error(err.code === 'ENOENT' ? `[ERROR] file not found: ${err.path}` : `[ERROR] ${err.message}`);
    return 2;
  }
  console.log(`[${findings.length ? 'FAIL' : 'PASS'}] ${label}: ${findings.length} finding(s) on judged lines`);
  for (const finding of findings.slice(0, 50)) console.log(`  ${finding.file}:${finding.line}  ${finding.detail}`);
  if (findings.length > 50) console.log(`  ... ${findings.length - 50} more`);
  return findings.length ? 1 : 0;
}

if (isMain(import.meta.url)) process.exitCode = main(process.argv.slice(2));
