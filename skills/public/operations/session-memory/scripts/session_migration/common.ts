// MigrationPlan and receipt interfaces are defined in ./types.ts; ./types.js is
// the empty emitted companion, with no runtime initialization or dependencies.
/** Byte-preserving migration primitives and the legacy Python JSON representation. */
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { SqlReal } from '../../../../../../runtime/sqlite.js';

export class MigrationError extends Error {}
export type JsonObject = Record<string, any>;
const keyOrder = new WeakMap<object, string[]>();
export const digest = (data: Uint8Array): string => createHash('sha256').update(data).digest('hex');
const utf8 = new TextDecoder('utf-8', { fatal: true });
const codepointCompare = (a: string, b: string) => {
  const first = [...a], second = [...b];
  for (let index = 0; index < Math.min(first.length, second.length); index++) { const order = first[index]!.codePointAt(0)! - second[index]!.codePointAt(0)!; if (order) return order; }
  return first.length - second.length;
};
export function pythonFloat(value: number): string {
  if (!Number.isFinite(value)) throw new MigrationError('Non-finite JSON numbers cannot be migrated');
  if (Object.is(value, -0)) return '-0.0';
  const scientific = value.toExponential();
  const exponent = Number(scientific.split('e')[1]);
  if (value !== 0 && (exponent < -4 || exponent >= 16)) return scientific.replace(/e([+-])(\d+)$/, (_all, sign: string, digits: string) => `e${sign}${digits.padStart(2, '0')}`);
  const text = value.toString();
  return text.includes('.') ? text : `${text}.0`;
}

/** Parse integer tokens before Number can round them; remember float/insertion-order semantics. */
export function parseJson(source: string | Buffer): any {
  const text = typeof source === 'string' ? source : utf8.decode(source);
  let at = 0;
  const whitespace = () => { while (/[\t\r\n ]/.test(text[at] ?? '') && at < text.length) at++; };
  const string = (): string => {
    const start = at++;
    while (at < text.length) {
      const ch = text[at++];
      if (ch === '\\') { at++; continue; }
      if (ch === '"') return JSON.parse(text.slice(start, at)) as string;
    }
    throw new MigrationError('Unterminated JSON string');
  };
  const value = (): any => {
    whitespace(); const ch = text[at];
    if (ch === '"') return string();
    if (ch === '{') {
      at++; const object: JsonObject = Object.create(null), keys: string[] = []; whitespace();
      if (text[at] === '}') { at++; keyOrder.set(object, keys); return object; }
      for (;;) {
        whitespace(); if (text[at] !== '"') throw new MigrationError('Expected a JSON object key');
        const key = string(); whitespace(); if (text[at++] !== ':') throw new MigrationError('Expected JSON colon');
        if (!Object.hasOwn(object, key)) keys.push(key);
        object[key] = value(); whitespace();
        const end = text[at++]; if (end === '}') break; if (end !== ',') throw new MigrationError('Expected JSON object separator');
      }
      keyOrder.set(object, keys); return object;
    }
    if (ch === '[') {
      at++; const array: any[] = []; whitespace(); if (text[at] === ']') { at++; return array; }
      for (;;) { array.push(value()); whitespace(); const end = text[at++]; if (end === ']') return array; if (end !== ',') throw new MigrationError('Expected JSON array separator'); }
    }
    for (const [token, result] of [['true', true], ['false', false], ['null', null]] as const) if (text.startsWith(token, at)) { at += token.length; return result; }
    const number = text.slice(at).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (!number) throw new MigrationError('Invalid JSON value');
    const token = number[0]; at += token.length;
    if (/[.eE]/.test(token)) return new SqlReal(Number(token));
    const integer = BigInt(token);
    return integer >= BigInt(Number.MIN_SAFE_INTEGER) && integer <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(integer) : integer;
  };
  const result = value(); whitespace(); if (at !== text.length) throw new MigrationError('Trailing JSON content'); return result;
}

export function stringifyJson(value: any, options: { ascii?: boolean; sortKeys?: boolean; indent?: number; compact?: boolean } = {}): string {
  const quote = (text: string) => { const escaped = JSON.stringify(text); return options.ascii ? escaped.replace(/[\u007f-\uffff]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`) : escaped; };
  const walk = (item: any, depth: number): string => {
    if (item === null) return 'null';
    if (typeof item === 'string') return quote(item);
    if (typeof item === 'boolean' || typeof item === 'bigint') return String(item);
    if (item instanceof SqlReal) return pythonFloat(item.value);
    if (typeof item === 'number') { if (!Number.isFinite(item)) throw new MigrationError('Non-finite JSON number'); return Number.isInteger(item) ? String(item) : pythonFloat(item); }
    if (Buffer.isBuffer(item)) throw new MigrationError('Legacy v1 plans do not represent SQLite BLOB values');
    if (!item || typeof item !== 'object') throw new MigrationError('Unsupported JSON value');
    const array = Array.isArray(item);
    let keys = keyOrder.get(item) ?? Object.keys(item);
    // Include newly added metadata without reordering integer-looking original keys.
    keys = [...keys.filter(key => Object.hasOwn(item, key)), ...Object.keys(item).filter(key => !keys.includes(key))];
    if (options.sortKeys) keys = [...keys].sort(codepointCompare);
    const separator = options.indent || options.compact === false ? ': ' : ':';
    const entries = array ? item.map((part: any) => walk(part, depth + 1)) : keys.map(key => `${quote(key)}${separator}${walk(item[key], depth + 1)}`);
    const [open, close] = array ? ['[', ']'] : ['{', '}'];
    if (!entries.length) return open! + close!;
    if (options.indent) { const padding = ' '.repeat(options.indent * (depth + 1)); return `${open}\n${padding}${entries.join(`,\n${padding}`)}\n${' '.repeat(options.indent * depth)}${close}`; }
    return `${open}${entries.join(options.compact === false ? ', ' : ',')}${close}`;
  };
  return walk(value, 0);
}
export const stable = (value: any): string => digest(Buffer.from(stringifyJson(value, { ascii: true, sortKeys: true })));
export function equal(a: any, b: any): boolean {
  if (a === b) return true;
  const first = a instanceof SqlReal ? a.value : a, second = b instanceof SqlReal ? b.value : b;
  if (['number', 'bigint'].includes(typeof first) && ['number', 'bigint'].includes(typeof second)) {
    if (typeof first === typeof second) return first === second;
    const integer = typeof first === 'bigint' ? first : second;
    const number = typeof first === 'number' ? first : second;
    return Number.isInteger(number) && BigInt(number) === integer;
  }
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || a instanceof SqlReal || b instanceof SqlReal || Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((value: any, index: number) => equal(value, b[index]));
  const keys = Object.keys(a); return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && equal(a[key], b[key]));
}
export function read(file: string): Buffer | null {
  try { const info = lstatSync(file); if (info.isSymbolicLink()) throw new MigrationError(`Symlink requires explicit resolution: ${file}`); return info.isFile() ? readFileSync(file) : null; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
export const fingerprint = (file: string): string | null => { const bytes = read(file); return bytes === null ? null : digest(bytes); };
export function bounded(file: string, profile: string): string {
  const path = resolve(file), boundary = resolve(profile), rel = relative(boundary, path);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel) || path !== file) throw new MigrationError(`Path escapes its explicit profile or uses a symlink: ${file}`);
  for (let current = path;; current = dirname(current)) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new MigrationError(`Path escapes its explicit profile or uses a symlink: ${file}`);
    if (current === boundary) break;
  }
  return file;
}
export function write(file: string, data: Buffer, exclusive = false): void {
  const before = read(file); mkdirSync(dirname(file), { recursive: true });
  const temporary = joinTemporary(file), mode = before === null ? 0o600 : lstatSync(file).mode & 0o777;
  const fd = openSync(temporary, 'wx', mode); let closed = false;
  try {
    writeFileSync(fd, data); fsyncSync(fd); closeSync(fd); closed = true;
    if (exclusive) linkSync(temporary, file); else renameSync(temporary, file);
  } finally { if (!closed) closeSync(fd); if (existsSync(temporary)) unlinkSync(temporary); }
}
const joinTemporary = (file: string) => `${dirname(file)}/.session-migration-${randomUUID()}`;
export const save = (file: string, value: any): void => write(file, Buffer.from(stringifyJson(value, { indent: 2 }) + '\n'));
export const load = (file: string): any => { const value = read(file); if (value === null) throw new MigrationError(`Missing migration JSON: ${file}`); return parseJson(value); };
export function lines(data: Buffer): Buffer[] {
  const output: Buffer[] = []; let start = 0;
  for (let index = 0; index < data.length; index++) if (data[index] === 10 || data[index] === 13) {
    if (data[index] === 13 && data[index + 1] === 10) index++;
    output.push(data.subarray(start, index + 1)); start = index + 1;
  }
  if (start < data.length) output.push(data.subarray(start)); return output;
}
export const blank = (data: Buffer): boolean => data.every(byte => [9, 10, 11, 12, 13, 32].includes(byte));
export function records(data: Buffer): JsonObject[] {
  try { return lines(data).filter(line => !blank(line)).map(line => parseJson(line)); }
  catch (error) { throw new MigrationError(`Incomplete or malformed JSONL; wait for its writer to finish: ${(error as Error).message}`); }
}
export function transform(data: Buffer, host: string, old: string, next: string): Buffer {
  return Buffer.concat(lines(data).map(line => {
    if (blank(line)) return line;
    const row = records(line)[0]!;
    const metadata = host === 'claude' ? row : ['session_meta', 'turn_context'].includes(row.type) ? row.payload : undefined;
    if (metadata && typeof metadata === 'object' && !Array.isArray(metadata) && metadata.cwd === old) {
      metadata.cwd = next;
      return Buffer.from(stringifyJson(row) + '\n');
    }
    return line;
  }));
}
export function compatible(current: Buffer, incoming: Buffer): Buffer {
  const a = records(current), b = records(incoming), count = Math.min(a.length, b.length);
  for (let index = 0; index < count; index++) if (!equal(a[index], b[index])) throw new MigrationError('Divergent session histories; preserve both and resolve explicitly');
  return b.length > a.length ? incoming : current;
}
export function noWriter(file: string): void {
  if (!existsSync(file)) return;
  if (process.platform === 'win32') {
    // FileShare.None fails while any session holds this file. This uses installed
    // Windows facilities, never a downloaded helper or an on-device compilation.
    const code = "$ErrorActionPreference='Stop';$f=[System.IO.File]::Open($env:JSTACK_MIGRATION_FILE,[System.IO.FileMode]::Open,[System.IO.FileAccess]::ReadWrite,[System.IO.FileShare]::None);$f.Dispose();Write-Output 'closed'";
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(code, 'utf16le').toString('base64')], { encoding: 'utf8', env: { ...process.env, JSTACK_MIGRATION_FILE: file }, timeout: 10_000, windowsHide: true });
    if (result.error || result.status !== 0 || result.stdout.trim() !== 'closed') throw new MigrationError('Cannot determine whether the destination has active writers; close its sessions');
    return;
  }
  const result = spawnSync('lsof', ['-Fpa', '--', file], { encoding: 'utf8', timeout: 10_000 });
  if (result.error) throw new MigrationError('Replacing existing session files requires lsof and stopped writers');
  if (![0, 1].includes(result.status ?? -1) || (result.status === 1 && result.stdout.trim())) throw new MigrationError('Cannot determine whether the destination has active writers');
  const fields = result.stdout.split(/\r?\n/);
  if (fields.some(line => line === 'aw' || line === 'au')) throw new MigrationError(`Active destination writer; close the session first: ${file}`);
  if (result.status === 0 && !fields.some(line => /^p\d+$/.test(line))) throw new MigrationError('Cannot determine whether the destination has active writers');
}
