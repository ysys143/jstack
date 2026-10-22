/** Offline, hash-bound SQLite addon loading. No installer scripts or runtime downloads. */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { atomicWrite, checkOwned, privateDir } from './os.js';

export interface NativeAsset { key: string; url: string; sha256: string; archivePath: string; binarySha256: string; size: number; archiveSize: number }
export interface NativeManifest { schemaVersion: 1; dependency: 'sqlite3'; version: string; napiVersion: number; upstream: string; license: string; sqliteVersion: string; assets: NativeAsset[] }
export interface NativeOptions { nativeRoot?: string; cacheRoot?: string }
export const nativeHash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export function nativePlatform(): string {
  if (process.platform !== 'linux') return `${process.platform}-${process.arch}`;
  const header = (process.report.getReport() as { header?: { glibcVersionRuntime?: string } }).header;
  return `linux-${process.arch}${header?.glibcVersionRuntime ? '' : '-musl'}`;
}

export function validateNativeManifest(bytes: Buffer): NativeManifest {
  const manifest = JSON.parse(bytes.toString('utf8')) as NativeManifest;
  if (manifest.schemaVersion !== 1 || manifest.dependency !== 'sqlite3' || manifest.version !== '5.1.7' || manifest.napiVersion !== 6 || !Array.isArray(manifest.assets)) throw new Error('Unreviewed native dependency manifest');
  const keys = new Set<string>();
  for (const asset of manifest.assets) {
    if (!/^(?:darwin|linux|win32)-(?:x64|arm64|ia32)(?:-musl)?$/.test(asset.key) || keys.has(asset.key) || !/^[0-9a-f]{64}$/.test(asset.sha256) || !/^[0-9a-f]{64}$/.test(asset.binarySha256) || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > 32 * 1024 * 1024 || !Number.isSafeInteger(asset.archiveSize) || asset.archiveSize <= 0 || asset.archiveSize > 32 * 1024 * 1024 || !asset.url.startsWith('https://github.com/TryGhost/node-sqlite3/releases/download/v5.1.7/')) throw new Error('Invalid native asset lock');
    keys.add(asset.key);
  }
  return manifest;
}

/** The exact locked upstream archives contain one regular addon; never extract arbitrary paths. */
export function lockedBinary(archive: Buffer, asset: NativeAsset): Buffer {
  if (archive.length !== asset.archiveSize || nativeHash(archive) !== asset.sha256) throw new Error(`Native archive integrity failed: ${asset.key}`);
  const tar = gunzipSync(archive, { maxOutputLength: 64 * 1024 * 1024 });
  const matches: Buffer[] = [];
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const field = (start: number, size: number) => header.subarray(start, start + size).toString('utf8').replace(/\0.*$/s, '');
    const name = [field(345, 155), field(0, 100)].filter(Boolean).join('/');
    const textSize = field(124, 12).trim();
    if (!/^[0-7]+$/.test(textSize)) throw new Error('Unsupported locked native archive size');
    const size = parseInt(textSize, 8), type = field(156, 1);
    if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > tar.length) throw new Error('Truncated native archive');
    if (name === asset.archivePath) {
      if (type !== '0' && type !== '') throw new Error('Native archive member must be a regular file');
      matches.push(tar.subarray(offset + 512, offset + 512 + size));
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  if (matches.length !== 1 || matches[0]!.length !== asset.size || nativeHash(matches[0]!) !== asset.binarySha256) throw new Error('Native binary identity mismatch');
  return matches[0]!;
}

function regular(path: string): Buffer {
  if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error('Native input must be a regular file');
  return readFileSync(path);
}

export function preparedNative(options: NativeOptions = {}): string {
  const root = resolve(options.nativeRoot ?? fileURLToPath(new URL('../native/sqlite3', import.meta.url)));
  if (!existsSync(join(root, 'manifest.json'))) throw new Error('This package is missing its prepared SQLite assets; reinstall a complete jstack package');
  if (lstatSync(root).isSymbolicLink()) throw new Error('Native asset root must not be a symlink');
  const manifest = validateNativeManifest(regular(join(root, 'manifest.json')));
  const asset = manifest.assets.find(row => row.key === nativePlatform());
  if (!asset) throw new Error(`SQLite prebuilt is unavailable for ${nativePlatform()}; no compiler or network fallback is permitted`);
  const archive = regular(join(root, `${asset.key}.tar.gz`));
  if (archive.length !== asset.archiveSize || nativeHash(archive) !== asset.sha256) throw new Error('Packaged native archive was modified');
  const cache = resolve(options.cacheRoot ?? join(homedir(), '.jstack/native/sqlite3'));
  privateDir(cache);
  const target = join(cache, asset.binarySha256), binary = join(target, 'node_sqlite3.node');
  const verify = () => {
    privateDir(target);
    checkOwned(binary);
    const bytes = regular(binary);
    if (bytes.length !== asset.size || nativeHash(bytes) !== asset.binarySha256) throw new Error('Cached SQLite addon was modified; preserve and inspect before clearing its hash directory');
    return binary;
  };
  if (existsSync(target)) return verify();
  const temporary = join(cache, `.prepare-${randomUUID()}`);
  privateDir(temporary);
  try {
    atomicWrite(join(temporary, 'node_sqlite3.node'), lockedBinary(archive, asset));
    // The directory rename publishes a complete addon. A concurrent publisher may
    // win; verify its immutable bytes instead of overwriting or deleting them.
    try { renameSync(temporary, target); }
    catch (error) { if (!existsSync(target)) throw error; }
    return verify();
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}
