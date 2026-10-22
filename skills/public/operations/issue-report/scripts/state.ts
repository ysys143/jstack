import { existsSync, readFileSync, readdirSync, appendFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir, userInfo } from 'node:os';
import { createHash } from 'node:crypto';
import { atomicWrite, privateDir, checkOwned } from '../../../../../runtime/os.js';
import { KEYS } from '../../../../../packaging/check_public.js';

export type Status = 'queued' | 'drafted' | 'submitted' | 'dismissed';
export interface Candidate { id: string; signature: string; source: string; observedAt: string; skillOrCommand: string; excerpt: string; status: Status }
/** rejectedRepo is the configured repo value that failed validation; repo is then the default, and nothing is sent to it unless the user passes --repo. */
export interface Config { repo: string; lastRetro: string | null; rejectedRepo?: string }
export interface Receipt { id: string; url: string; submittedAt: string; signature: string }
export interface Roots { home: string; jstack: string; reports: string; claude: string; codex: string }

export const DEFAULT_REPO = 'ysys143/jstack';
/**
 * A GitHub OWNER/NAME slug. The owner is 1-39 letters, digits, hyphens or underscores (Enterprise
 * Managed Users have one) and starts and ends alphanumeric, so no value reads as a gh option. The
 * name is 1-100 letters, digits, dots, hyphens or underscores, never `.`, `..` or a `.git` suffix.
 */
export const REPO_PATTERN = /^(?=[^/]{1,39}\/)[A-Za-z0-9](?:[\w-]*[A-Za-z0-9])?\/(?!\.{1,2}$)(?![\w.-]*\.git$)[\w.-]{1,100}$/;
export const EXCERPT_LIMIT = 2000;

/** An explicit --home selects every default under it and ignores host-root environment overrides. */
export function roots(home?: string, env: NodeJS.ProcessEnv = process.env): Roots {
  const base = home ?? homedir(), jstack = join(base, '.jstack');
  return {
    home: base, jstack, reports: join(jstack, 'reports'),
    claude: home ? join(base, '.claude') : env.CLAUDE_CONFIG_DIR || join(base, '.claude'),
    codex: home ? join(base, '.codex') : env.CODEX_HOME || join(base, '.codex'),
  };
}
const readJson = <T>(file: string, fallback: T): T => existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as T : fallback;
const write = (file: string, value: unknown) => atomicWrite(file, Buffer.from(JSON.stringify(value, null, 2) + '\n'));
export function ensure(r: Roots): void { for (const dir of [r.reports, join(r.reports, 'queue'), join(r.reports, 'drafts')]) privateDir(dir); }

export function readConfig(r: Roots): Config {
  // Unknown fields, including a legacy optIn flag, are ignored and dropped on the next write.
  const value = readJson<Partial<Config>>(join(r.reports, 'config.json'), {}), raw: unknown = value.repo;
  const slug = typeof raw === 'string' && REPO_PATTERN.test(raw) ? raw : undefined;
  return {
    repo: slug ?? DEFAULT_REPO, lastRetro: typeof value.lastRetro === 'string' ? value.lastRetro : null,
    ...(slug === undefined && raw !== undefined && raw !== null ? { rejectedRepo: typeof raw === 'string' ? raw : JSON.stringify(raw) } : {}),
  };
}
export function saveConfig(r: Roots, change: Partial<Config>): Config {
  ensure(r); const { rejectedRepo, ...current } = readConfig(r), next: Config = { ...current, ...change };
  // A configured repo that failed validation stays in the file, so status keeps naming it until the user fixes it.
  write(join(r.reports, 'config.json'), rejectedRepo === undefined ? next : { ...next, repo: rejectedRepo });
  return rejectedRepo === undefined ? next : { ...next, rejectedRepo };
}
export function readQueue(r: Roots): Candidate[] {
  const dir = join(r.reports, 'queue'); if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(name => name.endsWith('.json')).sort().map(name => readJson<Candidate>(join(dir, name), {} as Candidate)).filter(c => typeof c.id === 'string');
}
export function saveCandidate(r: Roots, candidate: Candidate): void { ensure(r); write(join(r.reports, 'queue', `${candidate.id}.json`), candidate); }
export function findCandidate(r: Roots, id: string): Candidate {
  if (!/^rpt-[0-9a-f]{12}$/.test(id)) throw new Error(`Invalid report ID: ${id}`);
  const file = join(r.reports, 'queue', `${id}.json`);
  if (!existsSync(file)) throw new Error(`Unknown report ID: ${id}`);
  return readJson<Candidate>(file, {} as Candidate);
}
export function readReceipts(r: Roots): Receipt[] {
  const file = join(r.reports, 'receipts.jsonl'); if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(line => line.trim()).map(line => JSON.parse(line) as Receipt);
}
export function appendReceipt(r: Roots, receipt: Receipt): void {
  ensure(r); const file = join(r.reports, 'receipts.jsonl');
  if (existsSync(file)) checkOwned(file);
  appendFileSync(file, JSON.stringify(receipt) + '\n', { mode: 0o600 });
}

/** Paths, numbers, timestamps and identifiers are removed so repeated failures share one signature. */
export function normalize(text: string): string {
  return text.toLowerCase()
    .replace(/\d{4}-\d{2}-\d{2}[t ][\d:.]+z?/g, '<time>')
    .replace(/(?:[a-z]:)?(?:~|\.{1,2})?(?:[\\/][\w.@%+~-]+)+[\\/]?/g, '<path>')
    .replace(/\b[0-9a-f]{7,}\b/g, '<id>')
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ').trim().slice(0, 600);
}
export function signature(surface: string, text: string): string {
  return createHash('sha256').update(`${surface.toLowerCase().trim()}\n${normalize(text)}`).digest('hex');
}
export const idFor = (sig: string) => `rpt-${sig.slice(0, 12)}`;
export function known(r: Roots): Map<string, string> {
  const seen = new Map<string, string>();
  for (const c of readQueue(r)) seen.set(c.signature, `${c.id} (${c.status})`);
  for (const receipt of readReceipts(r)) seen.set(receipt.signature, `${receipt.id} (submitted ${receipt.url})`);
  return seen;
}

export interface Redactor { (text: string): string }
function profileValues(r: Roots): [string, string][] {
  const found: [string, string][] = [], dir = join(r.jstack, 'profiles');
  const visit = (value: unknown, field: string) => {
    if (typeof value === 'string' && value.trim().length >= 4 && !/^(?:true|false|null)$/i.test(value)) found.push([value, field]);
    else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) visit(child, Array.isArray(value) ? field : key);
  };
  const files = (path: string, depth: number): string[] => {
    try { return readdirSync(path, { withFileTypes: true }).flatMap(item => item.isDirectory() && depth > 0 ? files(join(path, item.name), depth - 1) : item.isFile() && item.name.endsWith('.json') ? [join(path, item.name)] : []); }
    catch { return []; }
  };
  // Depth 3 reaches history/r<N>/ copies of earlier revisions. conventions.json holds common words (feat, main, ko);
  // replacing them would garble every draft.
  for (const file of files(dir, 3).filter(path => basename(path) !== 'conventions.json')) { try { visit(JSON.parse(readFileSync(file, 'utf8')), basename(file, '.json')); } catch { /* An unreadable profile contributes no values. */ } }
  return found.sort((a, b) => b[0].length - a[0].length);
}
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Credential shapes extend the publication scanner's list with the reporting-only formats. */
const TOKENS = new RegExp(`${KEYS.source}|(?<![A-Za-z0-9_])(?:github_pat_[A-Za-z0-9_]{20,}|gh[ousr]_[A-Za-z0-9]{25,}|xox[a-z]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,})`, 'g');
export function redactor(r: Roots, user = safeUser()): Redactor {
  const profiles = profileValues(r), homes = [...new Set([r.home, homedir()])].filter(h => h.length > 1).sort((a, b) => b.length - a.length);
  return (text: string) => {
    let out = text;
    for (const [value, field] of profiles) out = out.split(value).join(`<${field}>`);
    out = out.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer <redacted>').replace(TOKENS, '<redacted>')
      .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<redacted>');
    for (const home of homes) out = out.replace(new RegExp(`${escape(home)}(?=$|[\\\\/"'\\s:;,)])`, 'g'), '~');
    out = out.replace(/(\/(?:Users|home)\/|[A-Za-z]:\\Users\\)(?!<user>)[^/\\\s"']+/g, '$1<user>');
    if (user && user.length >= 3) out = out.replace(new RegExp(`(?<![A-Za-z0-9_<])${escape(user)}(?![A-Za-z0-9_>])`, 'g'), '<user>');
    return out;
  };
}
function safeUser(): string { try { return userInfo().username; } catch { return ''; } }
/** The first line that says more than the call or its exit status. */
export const headline = (excerpt: string) => excerpt.split('\n').map(line => line.trim()).find(line => /\p{L}/u.test(line) && !/^(?:call:|exit code \d+$|exit \d+$)/i.test(line)) ?? '';
export function cap(text: string, limit = EXCERPT_LIMIT): string { return text.length > limit ? `${text.slice(0, limit)}\n[truncated]` : text; }
/**
 * The longest prefix of whole grapheme clusters, so a cut never splits a surrogate pair, a joined
 * emoji or a flag. One cluster longer than max cannot be kept whole; then the cut falls between
 * code points. Only the first max + 2 units are segmented, enough to include the whole code
 * point at the cut, so a huge input costs no more.
 */
function wholeClusters(text: string, max: number): string {
  const head = text.slice(0, max + 2);
  let out = '';
  for (const { segment } of new Intl.Segmenter().segment(head)) { if (out.length + segment.length > max) break; out += segment; }
  if (out) return out;
  for (const char of head) { if (out.length + char.length > max) break; out += char; }
  return out;
}
/** ANSI CSI sequences; then C0 controls and DEL other than the line breaks and tabs that clip turns into spaces. */
const CSI = /\u001b\[[0-?]*[ -/]*[@-~]/g, CONTROLS = /[\u0000-\u0008\u000e-\u001f\u007f]/g, BREAKS = /[\t\n\v\f\r\u2028\u2029]+/g;
/**
 * One line of at most limit characters. Terminal escapes and control characters are removed, each
 * run of line breaks and tabs becomes one space, ordinary spaces stay, and the ends are trimmed.
 * A longer line ends at the last whole word that fits, or at the limit when its only spaces sit in
 * the first half, and an ellipsis marks the cut. The cut never splits a grapheme cluster. Markup
 * is left alone: a literal backtick, asterisk or bracket is ordinary text, and a cut may leave a
 * span open.
 */
export function clip(text: string, limit: number): string {
  const flat = text.replace(CSI, '').replace(CONTROLS, '').replace(BREAKS, ' ').trim();
  if (flat.length <= limit) return flat;
  const space = flat.lastIndexOf(' ', limit - 1);
  const cut = space >= limit / 2 ? flat.slice(0, space) : wholeClusters(flat, limit - 1);
  return `${cut.replace(/[\s,;:(-]+$/, '') || cut}…`;
}
