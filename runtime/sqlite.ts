/** Pinned N-API SQLite adapter. Typed projections never coerce int64 through Number. */
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { preparedNative, type NativeOptions } from './sqlite-native.js';
export { nativePlatform } from './sqlite-native.js';
export type { NativeOptions } from './sqlite-native.js';

/** Preserve REAL storage when serializing a legacy Python plan containing 1.0. */
export class SqlReal {
  constructor(readonly value: number) { if (!Number.isFinite(value)) throw new Error('Non-finite SQLite REAL is not supported'); }
  valueOf(): number { return this.value; }
}
export type SqlValue = string | number | bigint | SqlReal | Buffer | null;
export type SqlRow = Record<string, SqlValue>;
type Callback<T = unknown> = (error: Error | null, result: T) => void;
interface NativeStatement {
  all(args: (string | number | Buffer | null)[], callback: Callback<Record<string, string | number | Buffer | null>[]>): void;
  run(args: (string | number | Buffer | null)[], callback: Callback): void;
  finalize(callback: (error: Error | null) => void): void;
}
interface NativeDatabase {
  exec(sql: string, callback: (error: Error | null) => void): void;
  close(callback: (error: Error | null) => void): void;
  configure(option: string, value: number): void;
}
interface Binding {
  Database: { new (path: string, mode: number, callback: (error: Error | null) => void): NativeDatabase; prototype: object };
  Statement: { new (db: NativeDatabase, sql: string, callback: (error: Error | null) => void): NativeStatement; prototype: object };
  Backup: { prototype: object };
  OPEN_READONLY: number; OPEN_READWRITE: number; OPEN_CREATE: number; OPEN_FULLMUTEX: number;
  VERSION: string;
}
const require = createRequire(import.meta.url);
const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;
export const identifier = quote;

/** Replace only anonymous placeholders outside SQL literals/comments. */
function parameters(sql: string, values: SqlValue[]): { sql: string; bindings: (string | number | Buffer | null)[] } {
  let output = '', index = 0;
  for (let at = 0; at < sql.length;) {
    const char = sql[at]!;
    if (char === "'" || char === '"' || char === '`' || char === '[') {
      const end = char === '[' ? ']' : char; output += char; at++;
      while (at < sql.length) {
        const part = sql[at++]!; output += part;
        if (part === end) { if (sql[at] === end && end !== ']') { output += sql[at++]; } else break; }
      }
    } else if (sql.startsWith('--', at)) {
      const end = sql.indexOf('\n', at); output += sql.slice(at, end < 0 ? sql.length : end); at = end < 0 ? sql.length : end;
    } else if (sql.startsWith('/*', at)) {
      const end = sql.indexOf('*/', at + 2); if (end < 0) throw new Error('Unterminated SQL comment'); output += sql.slice(at, end + 2); at = end + 2;
    } else if (char === '?') {
      if (/\d/.test(sql[at + 1] ?? '')) throw new Error('Use anonymous SQLite bind parameters');
      if (index >= values.length) throw new Error('Missing SQLite bind value');
      output += typeof values[index++] === 'bigint' ? 'CAST(? AS INTEGER)' : '?'; at++;
    } else { output += char; at++; }
  }
  if (index !== values.length) throw new Error('Unexpected SQLite bind value');
  return { sql: output, bindings: values.map(value => {
    if (typeof value === 'bigint') {
      if (value < -9223372036854775808n || value > 9223372036854775807n) throw new Error('SQLite integer exceeds signed 64-bit range');
      return value.toString();
    }
    if (value instanceof SqlReal) return value.value;
    if (typeof value === 'number' && (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))) throw new Error('Use BigInt for SQLite integers outside the safe Number range');
    return value;
  }) };
}

export class SqliteDatabase {
  private closed = false;
  private inTransaction = false;
  private constructor(private readonly binding: Binding, private readonly native: NativeDatabase) {}
  static async open(path: string, options: NativeOptions & { readonly?: boolean; fileMustExist?: boolean; timeout?: number } = {}): Promise<SqliteDatabase> {
    const readonly = options.readonly ?? true;
    if ((options.fileMustExist ?? true) && !existsSync(path)) throw new Error('SQLite database must already exist');
    const binding = require(preparedNative(options)) as Binding;
    // The pinned upstream JS wrapper adds EventEmitter methods to these native
    // prototypes. Retain that protocol without loading npm install dependencies.
    for (const type of [binding.Database, binding.Statement, binding.Backup]) Object.assign(type.prototype, EventEmitter.prototype);
    const mode = (readonly ? binding.OPEN_READONLY : binding.OPEN_READWRITE | (options.fileMustExist === false ? binding.OPEN_CREATE : 0)) | binding.OPEN_FULLMUTEX;
    const native = await new Promise<NativeDatabase>((done, reject) => { const db = new binding.Database(path, mode, error => error ? reject(error) : done(db)); });
    native.configure('busyTimeout', options.timeout ?? 20_000);
    const db = new SqliteDatabase(binding, native);
    try { await db.exec('PRAGMA foreign_keys=ON'); return db; } catch (error) { await db.close(); throw error; }
  }
  get version(): string { return this.binding.VERSION; }
  private async statement(sql: string, values: SqlValue[], method: 'run' | 'all'): Promise<Record<string, string | number | Buffer | null>[]> {
    if (this.closed) throw new Error('SQLite connection is closed');
    const prepared = parameters(sql, values);
    const statement = await new Promise<NativeStatement>((done, reject) => { const result = new this.binding.Statement(this.native, prepared.sql, error => error ? reject(error) : done(result)); });
    try {
      return await new Promise((done, reject) => {
        if (method === 'all') statement.all(prepared.bindings, (error, rows) => error ? reject(error) : done(rows));
        else statement.run(prepared.bindings, error => error ? reject(error) : done([]));
      });
    } finally { await new Promise<void>((done, reject) => statement.finalize(error => error ? reject(error) : done())); }
  }
  async execute(sql: string, values: SqlValue[] = []): Promise<void> { await this.statement(sql, values, 'run'); }
  /** Structure/PRAGMA queries only. Session rows must use typedRows(). */
  async query(sql: string, values: SqlValue[] = []): Promise<Record<string, string | number | Buffer | null>[]> {
    const rows = await this.statement(sql, values, 'all');
    if (rows.some(row => Object.values(row).some(value => typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value)))) throw new Error('Unsafe SQLite integer result; use typedRows');
    return rows;
  }
  async exec(sql: string): Promise<void> {
    if (this.closed) throw new Error('SQLite connection is closed');
    await new Promise<void>((done, reject) => this.native.exec(sql, error => error ? reject(error) : done()));
  }
  async columns(table: string, schema = 'main'): Promise<string[]> {
    return (await this.query(`PRAGMA ${quote(schema)}.table_info(${quote(table)})`)).map(row => String(row.name));
  }
  async typedRows(table: string, where = '1', values: SqlValue[] = [], schema = 'main'): Promise<SqlRow[]> {
    const names = await this.columns(table, schema);
    if (!names.length) throw new Error(`Unsupported SQLite schema: missing ${table}`);
    const fields = names.flatMap((name, index) => [
      `typeof(${quote(name)}) AS ${quote(`t${index}`)}`,
      `CASE WHEN typeof(${quote(name)})='integer' THEN CAST(${quote(name)} AS TEXT) ELSE ${quote(name)} END AS ${quote(`v${index}`)}`,
    ]).join(',');
    const rows = await this.statement(`SELECT ${fields} FROM ${quote(schema)}.${quote(table)} WHERE ${where} ORDER BY rowid`, values, 'all');
    return rows.map(row => Object.fromEntries(names.map((name, index) => {
      let value: SqlValue = row[`v${index}`]!;
      switch (row[`t${index}`]) {
        case 'integer': {
          if (typeof value !== 'string' || !/^-?\d+$/.test(value)) throw new Error('Invalid typed SQLite integer');
          const integer = BigInt(value); value = integer <= BigInt(Number.MAX_SAFE_INTEGER) && integer >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(integer) : integer; break;
        }
        case 'real': if (typeof value !== 'number') throw new Error('Invalid SQLite REAL'); value = new SqlReal(value); break;
        case 'text': if (typeof value !== 'string') throw new Error('Invalid SQLite TEXT'); break;
        case 'blob': if (!Buffer.isBuffer(value)) throw new Error('Invalid SQLite BLOB'); break;
        case 'null': if (value !== null) throw new Error('Invalid SQLite NULL'); break;
        default: throw new Error('Unsupported SQLite storage class');
      }
      return [name, value];
    })));
  }
  async transaction<T>(action: () => Promise<T>): Promise<T> {
    if (this.inTransaction) throw new Error('Nested/concurrent migration transactions are not supported');
    this.inTransaction = true;
    try {
      await this.exec('BEGIN IMMEDIATE');
      try { const result = await action(); await this.exec('COMMIT'); return result; }
      catch (error) { try { await this.exec('ROLLBACK'); } catch {} throw error; }
    } finally { this.inTransaction = false; }
  }
  async close(): Promise<void> {
    if (this.closed) return;
    await new Promise<void>((done, reject) => this.native.close(error => error ? reject(error) : done()));
    this.closed = true;
  }
}
