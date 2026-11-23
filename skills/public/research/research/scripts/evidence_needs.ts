/**
 * Opt-in typed information-need checks, called by coverage_matrix.ts (`--needs`).
 * Mechanical only: it checks that submitted items agree with the supplied source
 * bytes, an item-boundary rule and the report. It never proves that the source is
 * the whole population, that a quote means what an item claims, or that a
 * requirement was authorized. Requirement bindings come from the current request
 * state (`jst task`) or from the current requirements file, never from the input.
 *
 * Adapted in idea from the typed-need audit in qera4mgln `qera_core.py` (MIT, see
 * NOTICE): quote presence, item-ID sets and recomputed arithmetic. The code is a
 * native rewrite with exact decimal arithmetic and bounded readers.
 */
import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export const NEED_TYPES = ['lookup', 'enumerate', 'count', 'compute', 'compare', 'judge'] as const;
export const SCHEMA = 'jstack-evidence-needs/1';
export const LIMITATION = 'Mechanical consistency of the submitted items with the supplied source bytes, the stated item boundary and the report paragraphs of the bound requirement. It does not show that the source is the whole population, that a quote means what the item claims, or that the work was authorized.';
// Modest local-check bounds: per-file and aggregate bytes, record counts, line length and decimal width.
// `*Chars` limits count UTF-16 code units (JavaScript string length), not bytes or code points.
export const LIMITS = { fileBytes: 4 * 1024 * 1024, sourceBytes: 16 * 1024 * 1024, sources: 20, needs: 100, items: 2000, quoteChars: 2000, lineChars: 4096, decimalChars: 40, reportChars: 1024 * 1024 } as const;
export interface Binding { id: string; active: boolean; revision?: number; sha256?: string }
export type BindingMode = 'task' | 'requirements-file';
export interface EvidenceFinding { kind: string; need: string; req: string; detail: string; level: 'defect' | 'unmeasured' }
export interface NeedResult { id: string; type: string; requirement: string; subquestion?: string; status: 'consistent' | 'defective' | 'unmeasured' | 'manual'; boundaryItems?: number; submittedItems?: number; computed?: string; aggregateLine?: string }
export interface ReviewPair { need: string; item: string; value?: string; quote: string }
export interface EvidenceReport { binding: BindingMode; identity?: Identity; scope: string; mechanicalResult: 'consistent' | 'not-consistent'; covered: string[]; outsideScope: string[]; needs: NeedResult[]; findings: EvidenceFinding[]; requirements: Binding[]; review: ReviewPair[] }

const sha = (value: Buffer | string): string => createHash('sha256').update(value).digest('hex');
export const norm = (text: string): string => text.normalize('NFKC').replace(/\s+/gu, ' ').trim();
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string | undefined => typeof value === 'string' && value.trim() !== '' && !value.includes('\0') ? value : undefined;
const named = (value: string, max = 80): string => [...value].slice(0, max).join('');
export const requirementSha = (description: string): string => sha(norm(description));

// ── exact decimals: BigInt mantissa and scale, no floating point ──────────────
interface Dec { n: bigint; scale: number }
const DECIMAL = /^[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/u;
// A numeric span is the whole run of digits, separators and an exponent, so a prefix of `1,23` or `3e3` is never read as a number.
const SPAN = /(?<![\d.,])(?:(?<![\p{L}\p{N}])-)?\d(?:[\d.,_]*\d)?(?:[eE][+-]?\d+)?/gu;
/** Values travel as JSON strings: a JSON number would already be rounded by the parser, so it is never accepted. */
export function parseDecimal(value: unknown): Dec | undefined {
  if (typeof value !== 'string') return undefined;
  const t = value.normalize('NFKC').trim();
  if (t.length > LIMITS.decimalChars || !DECIMAL.test(t)) return undefined;
  const body = t.replace(/^[-+]/u, '').replaceAll(',', ''), [whole = '', frac = ''] = body.split('.');
  const n = BigInt(whole + frac);
  return { n: t.startsWith('-') ? -n : n, scale: frac.length };
}
const align = (a: Dec, b: Dec): [bigint, bigint, number] => { const s = Math.max(a.scale, b.scale); return [a.n * 10n ** BigInt(s - a.scale), b.n * 10n ** BigInt(s - b.scale), s]; };
const same = (a: Dec, b: Dec): boolean => { const [x, y] = align(a, b); return x === y; };
const add = (a: Dec, b: Dec): Dec => { const [x, y, scale] = align(a, b); return { n: x + y, scale }; };
export function formatDecimal(d: Dec): string {
  const digits = (d.n < 0n ? -d.n : d.n).toString().padStart(d.scale + 1, '0');
  const body = d.scale ? `${digits.slice(0, -d.scale)}.${digits.slice(-d.scale)}` : digits;
  return d.n < 0n ? `-${body}` : body;
}
export interface Span { raw: string; dec?: Dec }
/** Supported notation: ASCII digits, an optional leading minus, comma groups of three and one decimal point. Any other span has no `dec`. */
type Interval = [number, number];
const spanIntervals = (text: string): Interval[] => [...text.replaceAll('\u2212', '-').matchAll(SPAN)].map(m => [m.index!, m.index! + m[0].length] as Interval);
/** The quote occurs in `text` without cutting a number span at either end (`3` inside `3000`, `1` inside `1,23`, a digit after a minus sign). */
function occursWhole(text: string, quote: string, spans: Interval[]): boolean {
  for (let from = 0, tries = 0; tries < 1000; tries++) {
    const start = text.indexOf(quote, from);
    if (start < 0) return false;
    const end = start + quote.length;
    let lo = 0, hi = spans.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (spans[mid]![1] > start) hi = mid; else lo = mid + 1; }
    let clipped = false;
    for (let k = lo; k < spans.length && spans[k]![0] < end; k++) if (spans[k]![0] < start || spans[k]![1] > end) { clipped = true; break; }
    if (!clipped) return true;
    from = start + 1;
  }
  return false;
}
export const numberSpans = (value: string): Span[] => [...norm(value).replaceAll('\u2212', '-').matchAll(SPAN)].map(m => { const dec = parseDecimal(m[0]); return dec ? { raw: m[0], dec } : { raw: m[0] }; });
const hasToken = (value: string, wanted: Dec): boolean => numberSpans(value).some(t => t.dec !== undefined && same(t.dec, wanted));
/**
 * Whole-token occurrences of an ID. A dot followed by a digit continues the token on either side, so `INC-1` is not
 * found inside `INC-1.2` and `2` is not found inside `A.2`; a sentence-ending dot (`INC-1.`) does not continue it. RUN
 * below applies the same rule, so the line index and this test agree on what a token is. The test checks the
 * characters around an `indexOf` hit instead of compiling a pattern per ID: thousands of Unicode-class patterns
 * exhaust V8's code space near the item limit.
 */
const TOKEN_CHAR = /^[\p{L}\p{N}_-]$/u, DIGIT = /^\p{N}$/u;
const isTokenChar = (c: string): boolean => c !== '' && TOKEN_CHAR.test(c);
const before = (s: string, i: number): string => { if (i <= 0) return ''; const low = s.charCodeAt(i - 1); return i >= 2 && low >= 0xdc00 && low <= 0xdfff ? s.slice(i - 2, i) : s[i - 1]!; };
const at = (s: string, i: number): string => i >= s.length ? '' : String.fromCodePoint(s.codePointAt(i)!);
function wholeAt(s: string, start: number, end: number): boolean {
  const left = before(s, start), right = at(s, end);
  if (isTokenChar(left) || isTokenChar(right)) return false;
  if (left === '.' && isTokenChar(before(s, start - 1)) && DIGIT.test(at(s, start))) return false;
  return !(right === '.' && DIGIT.test(at(s, end + 1)));
}
/** Start offsets of the non-overlapping whole-token occurrences of `id`, left to right. */
function idOffsets(s: string, id: string): number[] {
  const out: number[] = [];
  for (let from = s.indexOf(id); from >= 0; from = s.indexOf(id, from + 1)) if (wholeAt(s, from, from + id.length) && (!out.length || from >= out[out.length - 1]! + id.length)) out.push(from);
  return out;
}
/** `normalized` is already NFKC and whitespace folded. */
const hasId = (normalized: string, normalizedId: string): boolean => normalizedId !== '' && idOffsets(normalized, normalizedId).length > 0;
const containsId = (paragraph: string, id: string): boolean => hasId(norm(paragraph), norm(id));
// A run is a maximal span of letters, digits, `_` and `-`, continued across a dot that is followed by a digit
// (`INC-1.2`, `A.1.2`). An ID made only of the plain characters occurs as a whole token exactly where it equals a run,
// so one pass over the runs finds it. Any other ID still contains its longest run as a whole run wherever it occurs as
// a whole token, so the index narrows its candidate lines before the whole-token test decides.
const SIMPLE_ID = /^[\p{L}\p{N}_-]+$/u, RUN = /[\p{L}\p{N}_-]+(?:\.\p{N}[\p{L}\p{N}_-]*)*/gu;
/**
 * A function that finds and removes every listed ID where it occurs as a whole token, so `INC-1` never cuts `INC-12`
 * down to `2` and `INC-1.2` never counts as `INC-1`. Built once per need: IDs with other characters go first, longest
 * first, then simple IDs in one pass over the runs. A simple ID cannot contain another kind of ID, so this order
 * always consumes the longer of two nested IDs first.
 */
function idScanner(ids: string[]): (value: string) => { rest: string; found: Set<string> } {
  const all = [...new Set(ids.map(norm))].filter(Boolean), simple = new Set(all.filter(x => SIMPLE_ID.test(x)));
  const other = all.filter(x => !simple.has(x)).sort((a, b) => b.length - a.length);
  return value => {
    let rest = value; const found = new Set<string>();
    for (const id of other) {
      const offsets = idOffsets(rest, id);
      if (!offsets.length) continue;
      found.add(id);
      rest = offsets.reduceRight((text, start) => text.slice(0, start) + ' ' + text.slice(start + id.length), rest);
    }
    if (simple.size) rest = rest.replace(RUN, run => { if (!simple.has(run)) return run; found.add(run); return ' '; });
    return { rest, found };
  };
}
const idDropper = (ids: string[]): (value: string) => string => { const scan = idScanner(ids); return value => scan(value).rest; };

// ── line index: whole-token lookups without scanning every line per item ──────
interface LineIndex { lines: string[]; byToken: Map<string, number[]> }
function indexLines(lines: string[]): LineIndex {
  const byToken = new Map<string, number[]>();
  lines.forEach((line, i) => { for (const token of new Set(line.match(RUN) ?? [])) { const at = byToken.get(token); if (at) at.push(i); else byToken.set(token, [i]); } });
  return { lines, byToken };
}
/** Indices of the lines that name `normalizedId` as a whole token, in line order. */
function linesNaming(index: LineIndex, normalizedId: string): number[] {
  if (SIMPLE_ID.test(normalizedId)) return index.byToken.get(normalizedId) ?? [];
  const key = (normalizedId.match(RUN) ?? []).reduce((a, b) => b.length > a.length ? b : a, '');
  const candidates = key ? index.byToken.get(key) ?? [] : index.lines.map((_, i) => i);
  return candidates.filter(i => hasId(index.lines[i]!, normalizedId));
}

// ── bounded reads ─────────────────────────────────────────────────────────────
/**
 * Read at most LIMITS.fileBytes from a regular file. The open is non-blocking and
 * refuses a symlinked leaf, so a FIFO or device cannot hang the checker; fstat on the
 * open descriptor decides regular-file status, and the read stops at max+1 bytes even if
 * the file grows after the check. With `base`, `path` is resolved against it and must
 * stay inside it with no symbolic link in any directory below it. The directory and
 * leaf checks run before the open, so a link swapped in between can still be followed
 * (on Windows, which lacks O_NOFOLLOW, even at the leaf).
 */
export function readRegularFile(path: string, base?: string): Buffer {
  if (base !== undefined) path = confined(base, path);
  // The leaf check makes refusal independent of O_NOFOLLOW (absent on Windows) and keeps a FIFO from being opened at all.
  const leaf = lstatSync(path);
  if (leaf.isSymbolicLink()) throw new Error('symbolic link');
  if (!leaf.isFile()) throw new Error('not a regular file');
  const flags = constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (constants.O_NOFOLLOW ?? 0);
  const fd = openSync(path, flags);
  try {
    if (!fstatSync(fd).isFile()) throw new Error('not a regular file');
    const buffer = Buffer.alloc(LIMITS.fileBytes + 1); let length = 0;
    while (length < buffer.length) { const got = readSync(fd, buffer, length, buffer.length - length, null); if (!got) break; length += got; }
    if (length > LIMITS.fileBytes) throw new Error(`larger than ${LIMITS.fileBytes} bytes`);
    return buffer.subarray(0, length);
  } finally { closeSync(fd); }
}
/** `path` resolved against `base`; refused when it leaves `base` or a directory below `base` is a symbolic link. */
function confined(base: string, path: string): string {
  const lexicalBase = resolve(base), realBase = realpathSync(lexicalBase), full = resolve(lexicalBase, path);
  const inside = (rel: string): boolean => rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
  let rel = relative(lexicalBase, full);
  if (!inside(rel)) rel = relative(realBase, full);
  if (!inside(rel)) throw new Error('outside the directory of the needs file');
  if (realpathSync(dirname(full)) !== dirname(join(realBase, rel))) throw new Error('a directory on the path is a symbolic link');
  return full;
}
export function readNeedsFile(path: string): unknown {
  const bytes = readRegularFile(path);
  try { return JSON.parse(bytes.toString('utf8')); } catch { throw new Error(`Evidence input is not valid JSON: ${path}`); }
}
interface Row { text: string; spans: Interval[] }
interface Source { problem?: { kind: string; detail: string }; text: string; rows?: Row[]; index?: LineIndex }
function loadSources(raw: unknown, baseDir: string): Map<string, Source> {
  const out = new Map<string, Source>(); let total = 0;
  if (!isRecord(raw)) return out;
  const entries = Object.entries(raw);
  if (entries.length > LIMITS.sources) throw new Error(`Evidence input names more than ${LIMITS.sources} sources`);
  for (const [id, entry] of entries) {
    const path = isRecord(entry) ? text(entry.path) : undefined, want = isRecord(entry) ? text(entry.sha256)?.toLowerCase() : undefined;
    const fail = (kind: string, detail: string): void => { out.set(id, { problem: { kind, detail }, text: '' }); };
    if (!path || !want || !/^[0-9a-f]{64}$/u.test(want)) { fail('INVALID_SOURCE', `source ${id} needs path and a 64-hex sha256`); continue; }
    let bytes: Buffer;
    try { bytes = readRegularFile(path, baseDir); } catch (error) { fail('SOURCE_MISSING', `source ${id} (${path}) is unreadable: ${error instanceof Error ? error.message : String(error)}`); continue; }
    total += bytes.length;
    if (total > LIMITS.sourceBytes) { fail('SOURCE_TOO_LARGE', `sources together exceed ${LIMITS.sourceBytes} bytes`); continue; }
    if (sha(bytes) !== want) { fail('STALE_SOURCE', `source ${id} (${path}) bytes differ from the recorded sha256`); continue; }
    out.set(id, { text: bytes.toString('utf8') });
  }
  return out;
}

// ── bindings ──────────────────────────────────────────────────────────────────
export interface Identity { task: string; workspace: string; constraintsRevision: number }
/** Live request state: ID, active flag, semantic revision and constraint revision, read at check time. */
export async function taskBindings(task: string, workspace: string, home: string): Promise<{ bindings: Map<string, Binding>; identity: Identity }> {
  const state = await import('../../../../../runtime/task_state.js');
  const c = state.context(workspace, home), loaded = state.load(c, task);
  return { bindings: new Map(loaded.requirements.map(r => [r.id, { id: r.id, active: r.active, revision: r.revision }])), identity: { task: loaded.id, workspace: c.workspace, constraintsRevision: loaded.constraintsRevision } };
}
export const fileBindings = (reqs: Record<string, string>): Map<string, Binding> => new Map(Object.entries(reqs).map(([id, description]) => [id, { id, active: true, sha256: requirementSha(description) }]));

// ── item boundary: anchored literal line prefix ───────────────────────────────
/** Every source line that starts with `prefix` is one row; its ID runs to `delimiter` (default: first whitespace). */
function boundaryRows(source: Source, prefix: string, delimiter: string | undefined): { rows: Map<string, string[]>; skipped: number; overflow: boolean } {
  const rows = new Map<string, string[]>(); let skipped = 0, overflow = false;
  for (const line of source.text.split(/\r\n|[\n\r]/u)) {
    const body = line.replace(/^[ \t]+/u, '');
    if (!body.startsWith(prefix)) continue;
    if (body.length > LIMITS.lineChars) { skipped++; continue; }
    const cut = delimiter === undefined ? body.search(/\s/u) : body.indexOf(delimiter);
    const id = norm(cut < 0 ? body : body.slice(0, cut));
    const kept = rows.get(id);
    if (kept) { if (kept.length < 2) kept.push(norm(body)); continue; } // two rows already prove the ID is ambiguous
    if (rows.size >= LIMITS.items) { overflow = true; break; }
    rows.set(id, [norm(body)]);
  }
  return { rows, skipped, overflow };
}

// ── report association ────────────────────────────────────────────────────────
const CITATION = /\[\p{N}{1,3}\]/gu;
const DATE = /\p{N}{4}[-./]\p{N}{1,2}[-./]\p{N}{1,2}|\p{N}{4}년|\p{N}{1,2}월|\p{N}{1,2}일/gu;
/** Remove identifiers, Markdown citations and dates so their digits cannot stand in for a reported value. */
function stripNoise(value: string, drop: (value: string) => string): string {
  return drop(norm(value)).replace(CITATION, ' ').replace(DATE, ' ');
}
const rowsOf = (paragraphs: string[]): string[] => paragraphs.flatMap(p => p.split(/\r\n|[\n\r]/u));

/** Physical source rows, normalized with their number spans; a quote must lie inside one of them. */
const sourceRows = (source: Source): Row[] => source.rows ??= source.text.split(/\r\n|[\n\r]/u).map(norm).filter(Boolean).map(text => ({ text, spans: spanIntervals(text) }));
const sourceIndex = (source: Source): LineIndex => source.index ??= indexLines(sourceRows(source).map(r => r.text));

interface Context { sources: Map<string, Source>; bindings: Map<string, Binding>; mode: BindingMode; paragraphs: string[] }
const VALUE_TYPES = new Set(['compute', 'lookup']);

function checkNeed(raw: unknown, ctx: Context, seen: Set<string>, review: ReviewPair[]): { result: NeedResult; findings: EvidenceFinding[] } {
  const findings: EvidenceFinding[] = [];
  const need = isRecord(raw) ? raw : {};
  const id = text(need.id) ?? '?', type = text(need.type) ?? '?', req = text(need.requirement) ?? '';
  const subquestion = text(need.subquestion);
  const flag = (kind: string, detail: string, level: 'defect' | 'unmeasured' = 'defect'): void => { findings.push({ kind, need: id, req, detail, level }); };
  const done = (extra: Partial<NeedResult> = {}): { result: NeedResult; findings: EvidenceFinding[] } => {
    const status = findings.some(f => f.level === 'defect') ? 'defective' : findings.some(f => f.kind === 'MANUAL') ? 'manual' : findings.length ? 'unmeasured' : 'consistent';
    return { result: { id, type, requirement: req, ...(subquestion ? { subquestion } : {}), status, ...extra }, findings };
  };
  if (!isRecord(raw) || id === '?') { flag('INVALID_NEED', 'a need requires a nonblank string id'); return done(); }
  if (seen.has(id)) { flag('DUPLICATE_NEED', `need id ${id} is used more than once`); return done(); }
  seen.add(id);
  if (!(NEED_TYPES as readonly string[]).includes(type)) { flag('INVALID_NEED', `type must be one of ${NEED_TYPES.join(', ')}`); return done(); }
  // Binding comes from the current request state, never from the input's own claims.
  const bound = ctx.bindings.get(req);
  if (!req || !bound) { flag('UNKNOWN_REQUIREMENT', `requirement ${req || '(missing)'} is not in the current requirements`); return done(); }
  if (!bound.active) { flag('INACTIVE_REQUIREMENT', `requirement ${req} is withdrawn; its evidence cannot pass`); return done(); }
  if (ctx.mode === 'task' ? need.requirementRevision !== bound.revision : text(need.requirementSha256)?.toLowerCase() !== bound.sha256) {
    flag('STALE_REQUIREMENT', ctx.mode === 'task' ? `requirementRevision ${JSON.stringify(need.requirementRevision ?? null)} is not the current revision ${bound.revision}` : 'requirementSha256 does not match the current requirement text');
    return done();
  }
  if (type === 'compare' || type === 'judge') { flag('MANUAL', `${type} has no automated check; a person or reviewer must assess it`, 'unmeasured'); return done(); }
  // `claimed` is validated before the items, so an invalid claim is reported even when every item is invalid too.
  const claim = text(need.claimed);
  if (need.claimed !== undefined && claim === undefined) flag('INVALID_NEED', 'claimed must be a nonblank JSON string');
  const items = Array.isArray(need.items) ? need.items : [];
  if (!items.length) { flag('EMPTY_EVIDENCE', 'items is missing or empty; an empty list cannot pass'); return done(); }

  const parsed: { id: string; value?: string; quote: string; source: string }[] = []; let broken = false;
  for (const entry of items) {
    const itemId = isRecord(entry) ? text(entry.id) : undefined, source = isRecord(entry) ? text(entry.source) : undefined, quote = isRecord(entry) ? text(entry.quote) : undefined;
    if (!isRecord(entry) || !itemId || !source || !quote || quote.length > LIMITS.quoteChars || itemId.length > LIMITS.quoteChars) { flag('INVALID_ITEM', `every item needs id, source and a quote of at most ${LIMITS.quoteChars} characters`); broken = true; continue; }
    const origin = ctx.sources.get(source);
    if (!origin) { flag('INVALID_ITEM', `item ${named(itemId)} names unknown source ${source}`); broken = true; continue; }
    if (origin.problem) { if (!findings.some(f => f.kind === origin.problem!.kind && f.detail === origin.problem!.detail)) flag(origin.problem.kind, origin.problem.detail); broken = true; continue; }
    if (entry.value !== undefined && text(entry.value) === undefined) { flag('INVALID_ITEM', `item ${named(itemId)} value must be a nonblank JSON string`); broken = true; continue; }
    parsed.push({ id: norm(itemId), quote: norm(quote), source, ...(entry.value !== undefined ? { value: entry.value as string } : {}) });
  }
  if (broken && !parsed.length) return done();
  const counts = new Map<string, number>();
  for (const item of parsed) counts.set(item.id, (counts.get(item.id) ?? 0) + 1);
  for (const [itemId, n] of counts) if (n > 1) flag('DUPLICATE_ITEM', `item ${named(itemId)} is submitted ${n} times`);
  const distinct = [...counts.keys()], itemIds = distinct, dropItems = idDropper(itemIds), dropAll = idDropper([...itemIds, req]);

  // Completeness is measured only against a declared, anchored line rule; the declared source is the measurement scope.
  // A lookup needs no boundary, but when it declares one the item must be one boundary row and lie in it.
  let boundaryItems: number | undefined, rows: Map<string, string[]> | undefined, boundarySource: string | undefined;
  const boundary = isRecord(need.boundary) ? need.boundary : undefined;
  if (type !== 'lookup' || boundary) {
    const sourceId = boundary ? text(boundary.source) : undefined, prefix = boundary ? text(boundary.linePrefix) : undefined;
    const delimiter = boundary && boundary.delimiter !== undefined ? text(boundary.delimiter) : undefined;
    const origin = sourceId ? ctx.sources.get(sourceId) : undefined;
    if (!boundary) flag('UNMEASURED', `${type} has no boundary; completeness against the source is unmeasured, not complete`, 'unmeasured');
    else if (!origin || origin.problem || !prefix || (boundary.delimiter !== undefined && (!delimiter || delimiter.length > 8))) flag('INVALID_BOUNDARY', 'boundary needs a readable source, a nonblank linePrefix and optionally a delimiter of at most 8 characters');
    else {
      const measured = boundaryRows(origin, prefix, delimiter);
      rows = measured.rows; boundarySource = sourceId; boundaryItems = rows.size;
      if (measured.overflow) flag('INVALID_BOUNDARY', `the boundary holds more than ${LIMITS.items} items; refused rather than measured in part`);
      if (measured.skipped) flag('INVALID_BOUNDARY', `${measured.skipped} boundary lines exceed ${LIMITS.lineChars} characters and were not measured`);
      if (measured.overflow) boundaryItems = undefined;
      else if (!rows.size) flag('EMPTY_BOUNDARY', `no source line starts with ${JSON.stringify(prefix)}; the boundary measured nothing`);
      else {
        const omitted = type === 'lookup' ? [] : [...rows.keys()].filter(x => !counts.has(x)), unknown = distinct.filter(x => !rows!.has(x));
        const repeated = [...rows].filter(([k, v]) => v.length > 1 && (type !== 'lookup' || counts.has(k))).map(([k]) => k);
        if (omitted.length) flag('OMITTED', `${omitted.length} boundary item(s) not submitted: ${omitted.slice(0, 10).map(x => named(x, 40)).join(', ')}`);
        if (unknown.length) flag('UNKNOWN_ITEM', `${unknown.length} submitted item(s) outside the boundary: ${unknown.slice(0, 10).map(x => named(x, 40)).join(', ')}`);
        if (repeated.length) flag('AMBIGUOUS_ROW', `${repeated.length} item id(s) have several boundary rows (corrections?): ${repeated.slice(0, 10).map(x => named(x, 40)).join(', ')}; resolve them first`);
      }
    }
  }

  // Quote support: the quote exists in the hash-checked source, carries the item ID and, under a boundary, lies in that item's own row.
  const unsupported = new Set<string>();
  for (const item of parsed) {
    const origin = ctx.sources.get(item.source)!;
    const own = rows?.get(item.id);
    const reason = !hasId(item.quote, item.id) ? 'does not contain the item id as a whole token'
      : own && item.source !== boundarySource ? 'names a source other than the boundary source'
        : own ? (own.some(r => occursWhole(r, item.quote, spanIntervals(r))) ? '' : 'is not inside the boundary row of this item, or cuts a number short')
          : linesNaming(sourceIndex(origin), item.id).some(i => { const r = sourceRows(origin)[i]!; return r.text.includes(item.quote) && occursWhole(r.text, item.quote, r.spans); }) ? '' : `does not occur inside one row of source ${item.source} that names the item id, or cuts a number short`;
    if (reason) { flag('QUOTE_NOT_SUPPORTED', `quote for ${named(item.id)} ${reason}`); unsupported.add(item.id); continue; }
    // Without a boundary a lookup cannot tell a corrected row from the original: several rows naming the ID are ambiguous.
    const naming = type === 'lookup' && !boundary ? linesNaming(sourceIndex(origin), item.id).length : 0;
    if (naming > 1) flag('AMBIGUOUS_ROW', `${naming} rows of source ${item.source} name ${named(item.id)} (corrections?); declare a boundary or resolve them first`);
    else review.push({ need: id, item: item.id, ...(item.value !== undefined ? { value: item.value } : {}), quote: item.quote });
  }

  // Numeric grounding: the value is a number token of the quote, not of the ID.
  const numbers = new Map<string, Dec>(), labels = new Map<string, string>();
  if (VALUE_TYPES.has(type)) for (const item of parsed) {
    if (numbers.has(item.id) || labels.has(item.id) || unsupported.has(item.id)) continue;
    if (item.value === undefined) { flag('VALUE_MISSING', `item ${named(item.id)} has no value`); continue; }
    const rest = dropItems(item.quote);
    const wanted = parseDecimal(item.value);
    if (!wanted) {
      if (type === 'compute') { flag('VALUE_NOT_NUMERIC', `item ${named(item.id)} value is not a plain decimal`); continue; }
      const label = norm(item.value);
      if (!hasId(norm(rest), label)) flag('VALUE_NOT_IN_QUOTE', `value of ${named(item.id)} does not occur in its quote as a whole word`); else labels.set(item.id, label);
      continue;
    }
    const spans = numberSpans(rest), badSpans = spans.filter(t => !t.dec);
    if (badSpans.length) { flag('MALFORMED_NUMBER', `quote for ${named(item.id)} holds ${badSpans.map(t => JSON.stringify(t.raw)).slice(0, 3).join(', ')}, a number notation this check does not support (scientific, European or irregular separators)`); continue; }
    const tokens = spans.map(t => t.dec!);
    if (!tokens.some(t => same(t, wanted))) { flag('VALUE_NOT_IN_QUOTE', `value ${item.value} of ${named(item.id)} is not a number token of its quote`); continue; }
    if (tokens.filter((t, i) => tokens.findIndex(u => same(u, t)) === i).length > 1) { flag('AMBIGUOUS_VALUE', `quote for ${named(item.id)} holds several numbers; quote a narrower span that names this value`); continue; }
    if (!/\p{L}/u.test(rest.replace(SPAN, ' '))) { flag('QUOTE_TOO_BARE', `quote for ${named(item.id)} is only a number; include the words that name it`); continue; }
    numbers.set(item.id, wanted);
  }

  // The report must show the result inside the paragraphs of the bound requirement, on rows that name the item.
  const context = ctx.paragraphs.filter(p => containsId(p, req)), lines = rowsOf(context).map(norm), nreq = norm(req);
  const report = indexLines(lines);
  // A row names the item only where the longest-first scan finds it (`INC-1.2` is not `INC-1`), and a value is shown
  // only on a row of its own: a line that also names another submitted item could pair either value with either ID.
  const scanItems = idScanner(itemIds);
  const row = (itemId: string, value?: Dec | string): boolean => linesNaming(report, itemId).some(i => {
    const line = lines[i]!, { found } = scanItems(line);
    if (!found.has(itemId)) return false;
    if (value === undefined) return true;
    if (found.size > 1) return false;
    if (typeof value !== 'string') return hasToken(stripNoise(line, dropAll), value);
    return hasId(dropAll(line), value);
  });
  // A count or total is read from ONE declared report line: it starts with the need's `reportPrefix`, names no item ID,
  // and ends in exactly one number. Item rows and unrelated numbers on other lines are never aggregate evidence.
  let aggregateLine: string | undefined;
  const aggregate = (wanted: Dec, label: string): void => {
    const prefix = text(need.reportPrefix) ? norm(need.reportPrefix as string) : '';
    if (!prefix) { flag('PREFIX_MISSING', `${type} needs reportPrefix: the label that starts its one aggregate report line, for example "합계" or "Total cost"`); return; }
    const hits = lines.map(line => { let body = line.replace(/^[-*+]\s+/u, ''); if (body.startsWith(nreq)) body = body.slice(nreq.length).replace(/^[\s:：,-]+/u, ''); return body; })
      .filter(body => body.startsWith(prefix) && !itemIds.some(x => body.includes(x)));
    if (hits.length !== 1) { flag(hits.length ? 'AMBIGUOUS_AGGREGATE' : 'NOT_IN_REPORT', hits.length ? `${hits.length} report lines in ${req} start with ${JSON.stringify(prefix)}; keep exactly one` : `no report line in ${req} starts with ${JSON.stringify(prefix)} and names no item ID (${label})`); return; }
    aggregateLine = hits[0];
    const spans = numberSpans(stripNoise(hits[0]!.slice(prefix.length), idDropper([req])));
    if (spans.length !== 1 || !spans[0]!.dec) { flag('AGGREGATE_NOT_SINGLE_NUMBER', `the ${JSON.stringify(prefix)} line must end in exactly one supported number: ${JSON.stringify(named(hits[0]!, 100))}`); return; }
    if (!same(spans[0]!.dec, wanted)) flag('AGGREGATE_MISMATCH', `the ${JSON.stringify(prefix)} line states ${formatDecimal(spans[0]!.dec)} but ${label} is ${formatDecimal(wanted)}`);
  };
  const absent = (what: string): void => flag('NOT_IN_REPORT', `${what} is not reported in a body paragraph that names ${req}`);
  if (!context.length) absent('the result');
  const claimed = claim === undefined ? undefined : parseDecimal(claim);
  let computed: string | undefined;
  if (type === 'enumerate') {
    if (context.length) for (const itemId of distinct) if (!unsupported.has(itemId) && !row(itemId)) absent(`item ${named(itemId)}`);
  } else if (type === 'count') {
    if (!claimed || claimed.scale !== 0 || claimed.n < 0n) flag('CLAIM_MISSING', 'count needs `claimed` as a nonnegative integer');
    else {
      const stated = Number(claimed.n);
      if (stated !== distinct.length) flag('COUNT_MISMATCH', `claimed ${stated} but ${distinct.length} distinct item(s) were submitted`);
      if (boundaryItems !== undefined && stated !== boundaryItems) flag('COUNT_MISMATCH', `claimed ${stated} but the boundary holds ${boundaryItems} item(s)`);
      if (context.length) aggregate(claimed, `the count`);
    }
  } else if (type === 'compute') {
    if (need.operation !== 'sum') flag('UNSUPPORTED_OPERATION', 'compute supports only operation "sum" over explicit source items', 'unmeasured');
    else if (numbers.size === distinct.length && !findings.some(f => f.kind === 'DUPLICATE_ITEM')) {
      const sum = [...numbers.values()].reduce<Dec>(add, { n: 0n, scale: 0 }); computed = formatDecimal(sum);
      if (!claimed) flag('CLAIM_MISSING', 'compute needs `claimed` (the total the report states)');
      else if (!same(claimed, sum)) flag('ARITHMETIC_MISMATCH', `claimed ${formatDecimal(claimed)} but the items sum to ${computed}`);
      if (context.length) {
        for (const [itemId, value] of numbers) if (!row(itemId, value)) absent(`item ${named(itemId)} with value ${formatDecimal(value)}`);
        aggregate(sum, 'the recomputed total');
      }
    }
  } else if (type === 'lookup') {
    if (distinct.length !== 1) flag('INVALID_NEED', 'lookup takes exactly one item');
    else {
      const only = distinct[0]!, number = numbers.get(only), label = labels.get(only);
      if (claim === undefined) flag('CLAIM_MISSING', 'lookup needs `claimed`');
      else if (number !== undefined || label !== undefined) {
        if (number !== undefined ? !claimed || !same(claimed, number) : norm(claim) !== label) flag('VALUE_MISMATCH', `claimed ${claim} differs from the value grounded in the quote`);
        else if (context.length && !row(only, number ?? label)) absent(`item ${named(only)} with value ${claim}`);
      }
    }
  }
  return done({ submittedItems: distinct.length, ...(boundaryItems !== undefined ? { boundaryItems } : {}), ...(computed !== undefined ? { computed } : {}), ...(aggregateLine !== undefined ? { aggregateLine } : {}) });
}

export function parseCover(value: string | undefined): string[] | 'all' {
  if (value === undefined || value.trim() === 'all') return 'all';
  const ids = value.split(',').map(s => s.trim());
  if (ids.some(s => !s || s === 'all')) throw new Error('--cover needs one or more requirement IDs separated by commas');
  return [...new Set(ids)];
}

/** `paragraphs` are report paragraphs outside the sources section. */
export function check_evidence(input: unknown, baseDir: string, paragraphs: string[], bindings: Map<string, Binding>, mode: BindingMode, cover: string[] | 'all' = 'all', identity?: Identity): EvidenceReport {
  if (!isRecord(input) || input.schema !== SCHEMA) throw new Error(`Evidence input must be an object with schema "${SCHEMA}"`);
  const findings: EvidenceFinding[] = [], results: NeedResult[] = [], review: ReviewPair[] = [];
  if (paragraphs.reduce((n, p) => n + p.length, 0) > LIMITS.reportChars) throw new Error(`The report body is longer than ${LIMITS.reportChars} characters; typed evidence checks need a smaller report`);
  const global = (kind: string, detail: string, req = ''): void => { findings.push({ kind, need: '', req, detail, level: 'defect' }); };
  const raw = Array.isArray(input.needs) ? input.needs : [];
  if (!raw.length) global('EMPTY_EVIDENCE', 'needs is missing or empty; an empty CHECK cannot pass');
  if (raw.length > LIMITS.needs) throw new Error(`Evidence input has more than ${LIMITS.needs} needs`);
  // A manifest replayed from another task, workspace or constraint set is stale even when requirement IDs and revisions agree.
  if (identity) for (const key of ['task', 'workspace', 'constraintsRevision'] as const) if (input[key] !== identity[key]) global('STALE_TASK', `${key} ${JSON.stringify(input[key] ?? null)} is not the current ${JSON.stringify(identity[key])}`);
  const totalItems = raw.reduce<number>((n, need) => n + (isRecord(need) && Array.isArray(need.items) ? need.items.length : 0), 0);
  if (totalItems > LIMITS.items) throw new Error(`Evidence input has more than ${LIMITS.items} items`);
  const ctx: Context = { sources: loadSources(input.sources, baseDir), bindings, mode, paragraphs };
  const seen = new Set<string>();
  for (const entry of raw) { const one = checkNeed(entry, ctx, seen, review); results.push(one.result); findings.push(...one.findings); }
  // Default scope is every active requirement of the authoritative projection; --cover narrows it to a named set.
  const wanted = cover === 'all' ? [...bindings.values()].filter(b => b.active).map(b => b.id) : cover;
  if (!wanted.length) global('NO_ACTIVE_REQUIREMENT', 'the covered requirement set is empty; nothing can pass');
  for (const rid of wanted) {
    const bound = bindings.get(rid);
    if (!bound) global('UNKNOWN_REQUIREMENT', `--cover names ${rid}, which is not in the current requirements`, rid);
    else if (!bound.active) global('INACTIVE_REQUIREMENT', `--cover names ${rid}, which is withdrawn`, rid);
    else if (!results.some(r => r.requirement === rid)) global('NO_NEED', `no evidence need is bound to active requirement ${rid}`, rid);
  }
  const outsideScope = [...bindings.values()].filter(b => b.active && !wanted.includes(b.id)).map(b => b.id);
  const consistent = results.length > 0 && wanted.length > 0 && results.every(r => r.status === 'consistent') && !findings.length;
  return { binding: mode, ...(identity ? { identity } : {}), scope: LIMITATION, mechanicalResult: consistent ? 'consistent' : 'not-consistent', covered: wanted, outsideScope, needs: results, findings, requirements: [...bindings.values()], review };
}
export const needsBase = (needsPath: string): string => dirname(resolve(needsPath));
