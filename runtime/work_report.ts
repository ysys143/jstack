#!/usr/bin/env node
/** Collect local work evidence without requiring a collaboration service. */
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { isMain } from './entry.js';
import { atomicWrite, privateDir } from './os.js';

export type EvidenceKind = 'git' | 'filesystem' | 'session';
export type EvidenceStatus = 'observed' | 'needs-confirmation';

export interface EvidenceRecord {
  id: string;
  kind: EvidenceKind;
  source: string;
  observedAt?: string;
  project?: string;
  path?: string;
  summary: string;
  status: EvidenceStatus;
}

export interface CollectionResult {
  schemaVersion: 1;
  period: { since: string; until: string };
  collectedAt: string;
  sources: { git: boolean; filesystem: boolean; sessions: boolean };
  records: EvidenceRecord[];
  warnings: string[];
}

export interface BundleResult {
  output: string;
  manifest: string;
  evidence: string;
  report: string;
  prompt: string;
  records: number;
  warnings: number;
}

const ignored = new Set(['.git', 'node_modules', '__pycache__', '.omc', '.venv', 'dist', 'build', '.hyperresearch', '.jstack']);
const iso = (value: Date) => value.toISOString();
const localDate = (value = new Date()) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;

export function dateValue(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Date must use YYYY-MM-DD: ${value}`);
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year!, month! - 1, day!);
  if (!Number.isFinite(date.getTime()) || date.getFullYear() !== year || date.getMonth() !== month! - 1 || date.getDate() !== day) throw new Error(`Invalid calendar date: ${value}`);
  return date;
}

export function shiftDate(value: string, days: number): string {
  const date = dateValue(value);
  date.setDate(date.getDate() + days);
  return localDate(date);
}

export function periodFor(kind: 'daily' | 'weekly' | 'range', date = localDate(), since?: string, until?: string): { since: string; until: string } {
  if (since) dateValue(since);
  if (until) dateValue(until);
  if (kind === 'range') {
    const start = since ?? date;
    const end = until ?? start;
    if (dateValue(start) > dateValue(end)) throw new Error('SINCE must not follow UNTIL');
    return { since: start, until: end };
  }
  if (since || until) {
    const start = since ?? until!;
    const end = until ?? since!;
    if (dateValue(start) > dateValue(end)) throw new Error('SINCE must not follow UNTIL');
    return { since: start, until: end };
  }
  const selected = dateValue(date);
  if (kind === 'daily') return { since: date, until: date };
  const mondayOffset = (selected.getDay() + 6) % 7;
  const start = shiftDate(date, -mondayOffset);
  return { since: start, until: shiftDate(start, 6) };
}

function directory(path: string): boolean { try { return statSync(path).isDirectory(); } catch { return false; } }
function children(path: string): string[] {
  if (!directory(path)) return [];
  return readdirSync(path, { withFileTypes: true }).filter(entry => entry.isDirectory() && !entry.isSymbolicLink()).map(entry => join(path, entry.name));
}
function hasGit(path: string): boolean { return existsSync(join(path, '.git')); }
function projectRoots(root: string): string[] {
  const result = new Set<string>();
  for (const top of children(root)) {
    if (hasGit(top)) result.add(resolve(top));
    for (const nested of children(top)) if (hasGit(nested)) result.add(resolve(nested));
  }
  return [...result].sort();
}
function topProjects(root: string): string[] { return children(root).sort(); }
function relativePath(root: string, path: string): string { return relative(root, path).split(sep).join('/'); }
function id(kind: EvidenceKind, source: string, value: string): string { return `${kind}:${createHash('sha256').update(`${source}\0${value}`).digest('hex').slice(0, 16)}`; }

function collectGit(root: string, since: string, until: string, records: EvidenceRecord[], warnings: string[]): void {
  for (const repo of projectRoots(root)) {
    const result = spawnSync('git', ['-C', repo, 'log', `--since=${since} 00:00:00`, `--until=${until} 23:59:59`, '--no-merges', '--pretty=format:%H%x09%aI%x09%s'], { encoding: 'utf8', timeout: 30_000, windowsHide: true });
    if (result.error || result.status !== 0) { warnings.push(`Git collection failed for ${relativePath(root, repo)}`); continue; }
    for (const line of (result.stdout ?? '').split(/\r?\n/).filter(Boolean)) {
      const [hash, observedAt, ...subjectParts] = line.split('\t');
      const summary = subjectParts.join('\t').trim();
      if (!hash || !summary) continue;
      const project = relativePath(root, repo);
      records.push({ id: id('git', project, hash), kind: 'git', source: 'git', observedAt, project, path: project, summary, status: 'needs-confirmation' });
    }
  }
}

function walkFiles(root: string, warnings: string[]): string[] {
  const result: string[] = [];
  const visit = (directoryPath: string) => {
    let entries;
    try { entries = readdirSync(directoryPath, { withFileTypes: true }); } catch { warnings.push(`Filesystem read failed: ${directoryPath}`); return; }
    for (const entry of entries) {
      if (ignored.has(entry.name) || entry.name.startsWith('.')) continue;
      const path = join(directoryPath, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) visit(path); else if (entry.isFile()) result.push(path);
    }
  };
  visit(root);
  return result;
}

function collectFilesystem(root: string, since: string, until: string, records: EvidenceRecord[], warnings: string[]): void {
  const lower = dateValue(since).getTime();
  const upper = dateValue(shiftDate(until, 1)).getTime();
  for (const projectPath of topProjects(root)) {
    const recent = walkFiles(projectPath, warnings).map(path => {
      try {
        const info = statSync(path);
        const stamp = process.platform === 'darwin' && info.birthtimeMs > 0 ? info.birthtimeMs : info.mtimeMs;
        return { path, stamp };
      } catch { warnings.push(`Filesystem stat failed: ${path}`); return undefined; }
    }).filter((value): value is { path: string; stamp: number } => !!value && value.stamp >= lower && value.stamp < upper)
      .sort((a, b) => b.stamp - a.stamp || a.path.localeCompare(b.path)).slice(0, 24);
    for (const item of recent) {
      const path = relativePath(root, item.path);
      records.push({ id: id('filesystem', path, String(item.stamp)), kind: 'filesystem', source: process.platform === 'darwin' ? 'filesystem.creation-or-modification' : 'filesystem.modification', observedAt: iso(new Date(item.stamp)), project: path.split('/')[0], path, summary: `파일 변경 관찰: ${path}`, status: 'needs-confirmation' });
    }
  }
}

function firstLine(path: string): string | undefined {
  try {
    const text = readFileSync(path, 'utf8');
    return text.split(/\r?\n/).map(line => line.trim()).find(Boolean)?.slice(0, 240);
  } catch { return undefined; }
}

function collectSessions(root: string | undefined, since: string, until: string, records: EvidenceRecord[], warnings: string[]): boolean {
  if (!root) return false;
  if (!directory(root)) { warnings.push(`Session source does not exist: ${root}`); return false; }
  const lower = dateValue(since).getTime();
  const upper = dateValue(shiftDate(until, 1)).getTime();
  const visit = (directoryPath: string) => {
    let entries;
    try { entries = readdirSync(directoryPath, { withFileTypes: true }); } catch { warnings.push(`Session read failed: ${directoryPath}`); return; }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || ignored.has(entry.name)) continue;
      const path = join(directoryPath, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && entry.name.endsWith('.md')) {
        try {
          const info = statSync(path);
          if (info.mtimeMs < lower || info.mtimeMs >= upper) continue;
          const relative = relativePath(root, path);
          records.push({ id: id('session', relative, String(info.mtimeMs)), kind: 'session', source: 'session-export', observedAt: iso(new Date(info.mtimeMs)), path: relative, summary: firstLine(path) ?? `세션 기록: ${relative}`, status: 'needs-confirmation' });
        } catch { warnings.push(`Session stat failed: ${path}`); }
      }
    }
  };
  visit(root);
  return true;
}

export function collectRecords(period: { since: string; until: string }, options: { projectsRoot?: string; sessionRoot?: string; projectFilter?: (path: string) => boolean } = {}): CollectionResult {
  const root = resolve(options.projectsRoot ?? process.env.GITHUB_DIR ?? join(homedir(), 'Documents/GitHub'));
  const records: EvidenceRecord[] = [], warnings: string[] = [];
  if (!directory(root)) throw new Error(`Collection directory does not exist: ${root}. Set GITHUB_DIR or --projects-root.`);
  const allowed = options.projectFilter;
  const gitRecords: EvidenceRecord[] = [], filesystemRecords: EvidenceRecord[] = [];
  collectGit(root, period.since, period.until, gitRecords, warnings);
  collectFilesystem(root, period.since, period.until, filesystemRecords, warnings);
  for (const record of [...gitRecords, ...filesystemRecords]) {
    const candidate = record.kind === 'filesystem' && record.path ? join(root, record.path) : record.project ? join(root, record.project) : root;
    if (!allowed || allowed(candidate)) records.push(record);
  }
  const sessions = collectSessions(options.sessionRoot ?? process.env.WRAPUP_SESSION_ROOT ?? process.env.CLAUDE_SESSIONS_PATH, period.since, period.until, records, warnings);
  const unique = new Map<string, EvidenceRecord>();
  for (const record of records) unique.set(record.id, record);
  const deduplicated = [...unique.values()].sort((a, b) => (a.observedAt ?? '').localeCompare(b.observedAt ?? '') || a.id.localeCompare(b.id));
  return { schemaVersion: 1, period, collectedAt: new Date().toISOString(), sources: { git: true, filesystem: true, sessions }, records: deduplicated, warnings };
}

function privateOutput(path: string): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  privateDir(path);
}

function reportText(collection: CollectionResult): string {
  const observed = collection.records.filter(record => record.status === 'observed');
  const confirmation = collection.records.filter(record => record.status === 'needs-confirmation');
  const rows = collection.records.map(record => `- [${record.kind}] ${record.project ?? record.path ?? record.source}: ${record.summary} (evidence ${record.id})`).join('\n');
  return `# Work report\n\n- Period: ${collection.period.since} ~ ${collection.period.until}\n- Collected: ${collection.collectedAt}\n- Records: ${collection.records.length}\n\n이 문서는 기록에서 관찰한 사실을 바탕으로 작성하는 개인 초안이다.\n커밋 메시지·파일 시각·세션 제목은 의도나 흔적이지 완료 사실이 아니므로, 보고서 작성 시 확인 필요 항목으로 남긴다.\n\n## Observed records\n\n관찰된 사실: ${observed.length}건\n\n## Needs confirmation\n\n확인 필요: ${confirmation.length}건\n\n${rows || '- 기록 없음'}\n\n## Warnings\n\n${collection.warnings.length ? collection.warnings.map(warning => `- ${warning}`).join('\n') : '- 없음'}\n\n## Source files\n\n- evidence.jsonl — 수집된 원장\n- manifest.json — 수집 범위와 파일 해시\n- prompt.md — 보고서 합성 지침\n`;
}

function promptText(collection: CollectionResult): string {
  return `# Work-report drafting prompt\n\n기간: ${collection.period.since} ~ ${collection.period.until}\n\n1. Read evidence.jsonl and separate observed facts, interpretation, and needs-confirmation.\n2. Report what the user's records support; do not turn a commit title or file timestamp into a completed-work claim.\n3. Keep project names and measurements when they identify the work. Mark missing or ambiguous sources explicitly.\n4. Write a concise Korean personal report in report.md.\n5. Publishing is a separate action. Do not call a remote adapter while drafting.\n`;
}

export function writeBundle(collection: CollectionResult, outputDirectory: string): BundleResult {
  const output = resolve(outputDirectory);
  privateOutput(output);
  const evidence = join(output, 'evidence.jsonl'), manifest = join(output, 'manifest.json'), report = join(output, 'report.md'), prompt = join(output, 'prompt.md');
  const evidenceText = collection.records.map(record => JSON.stringify(record)).join('\n') + (collection.records.length ? '\n' : '');
  atomicWrite(evidence, Buffer.from(evidenceText));
  const manifestValue = { schemaVersion: 1, period: collection.period, collectedAt: collection.collectedAt, sources: collection.sources, recordCount: collection.records.length, warningCount: collection.warnings.length, warnings: collection.warnings, files: { evidence: { path: 'evidence.jsonl', sha256: createHash('sha256').update(evidenceText).digest('hex') }, report: 'report.md', prompt: 'prompt.md' } };
  atomicWrite(manifest, Buffer.from(JSON.stringify(manifestValue, null, 2) + '\n'));
  atomicWrite(report, Buffer.from(reportText(collection)));
  atomicWrite(prompt, Buffer.from(promptText(collection)));
  return { output, manifest, evidence, report, prompt, records: collection.records.length, warnings: collection.warnings.length };
}

export function defaultOutput(period: { since: string; until: string }): string { return join(homedir(), '.jstack', 'state', 'work-reports', `${period.since}_${period.until}`); }

export function main(argv = process.argv.slice(2)): number {
  try {
    let kind: 'daily' | 'weekly' | 'range' = 'daily', date = localDate(), since: string | undefined, until: string | undefined, output: string | undefined, projectsRoot: string | undefined, sessionRoot: string | undefined, asJson = false;
    for (let index = 0; index < argv.length; index++) {
      const arg = argv[index]!;
      if (arg === '--period') { const value = argv[++index]; if (!['daily', 'weekly', 'range'].includes(value ?? '')) throw new Error('--period must be daily, weekly, or range'); kind = value as typeof kind; }
      else if (arg === '--date') date = argv[++index] ?? (() => { throw new Error('--date requires a value'); })();
      else if (arg === '--since') since = argv[++index] ?? (() => { throw new Error('--since requires a value'); })();
      else if (arg === '--until') until = argv[++index] ?? (() => { throw new Error('--until requires a value'); })();
      else if (arg === '--output') output = argv[++index] ?? (() => { throw new Error('--output requires a directory'); })();
      else if (arg === '--projects-root') projectsRoot = argv[++index] ?? (() => { throw new Error('--projects-root requires a directory'); })();
      else if (arg === '--session-root') sessionRoot = argv[++index] ?? (() => { throw new Error('--session-root requires a directory'); })();
      else if (arg === '--json') asJson = true;
      else throw new Error(`Unknown option: ${arg}`);
    }
    const period = periodFor(kind, date, since, until), collection = collectRecords(period, { projectsRoot, sessionRoot }), result = writeBundle(collection, output ?? defaultOutput(period));
    if (asJson) process.stdout.write(JSON.stringify(result) + '\n');
    else process.stdout.write(`Work-report evidence written: ${result.output}\nRecords: ${result.records}; warnings: ${result.warnings}\nReview report.md, then choose a publish adapter explicitly.\n`);
    return 0;
  } catch (error) { process.stderr.write(`${(error as Error).message}\n`); return 2; }
}

if (isMain(import.meta.url)) process.exitCode = main();
