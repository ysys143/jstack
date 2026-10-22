#!/usr/bin/env node
import { isMain } from '../runtime/entry.js';
/** Publisher/test preparation only. Runtime never downloads or compiles an addon. */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { lockedBinary, nativeHash, nativePlatform, validateNativeManifest } from '../runtime/sqlite-native.js';

export async function prepareNative(options: { sourceRoot: string; output: string; platforms?: string[]; all?: boolean; download?: (url: string) => Promise<Buffer> }): Promise<string[]> {
  const source = resolve(options.sourceRoot), output = resolve(options.output);
  const manifestBytes = readFileSync(join(source, 'packaging/native-dependencies.json'));
  const manifest = validateNativeManifest(manifestBytes);
  const keys = options.platforms ?? (options.all ? manifest.assets.map(asset => asset.key) : [nativePlatform()]);
  if (!keys.length || keys.some(key => !manifest.assets.some(asset => asset.key === key))) throw new Error('Unsupported native preparation platform');
  const download = options.download ?? (async (url: string) => {
    const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`Native preparation download failed: ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > 32 * 1024 * 1024) throw new Error('Native archive exceeds preparation bound');
    return bytes;
  });
  const prepared: string[] = [];
  for (const key of [...new Set(keys)]) {
    const asset = manifest.assets.find(row => row.key === key)!;
    const target = join(output, `${key}.tar.gz`);
    if (existsSync(target)) {
      if (nativeHash(readFileSync(target)) !== asset.sha256) throw new Error(`Existing prepared native binary changed: ${key}`);
    } else {
      const archive = await download(asset.url);
      lockedBinary(archive, asset);
      mkdirSync(dirname(target), { recursive: true });
      const temporary = `${target}.${randomUUID()}.tmp`;
      try { writeFileSync(temporary, archive, { flag: 'wx', mode: 0o644 }); renameSync(temporary, target); }
      finally { rmSync(temporary, { force: true }); }
    }
    prepared.push(target);
  }
  mkdirSync(output, { recursive: true });
  for (const [name, bytes] of [['manifest.json', manifestBytes], ['LICENSE', readFileSync(join(source, 'packaging/vendor/sqlite3/LICENSE'))], ['UPSTREAM.json', readFileSync(join(source, 'packaging/vendor/sqlite3/UPSTREAM.json'))]] as const) {
    const target = join(output, name);
    if (existsSync(target) && !readFileSync(target).equals(bytes)) throw new Error(`Existing native preparation metadata changed: ${name}`);
    if (!existsSync(target)) writeFileSync(target, bytes, { flag: 'wx', mode: 0o644 });
  }
  return prepared;
}

export const prepareNativeAssets = prepareNative;

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  const value = (name: string) => { const at = args.indexOf(name); return at < 0 ? undefined : args[at + 1]; };
  const sourceRoot = value('--source') ?? fileURLToPath(new URL('../../', import.meta.url));
  const output = value('--output') ?? resolve(sourceRoot, 'dist/native/sqlite3');
  prepareNative({ sourceRoot, output, platforms: value('--target') ? [value('--target')!] : undefined, all: args.includes('--all') })
    .then(files => process.stdout.write(JSON.stringify({ prepared: files }) + '\n'))
    .catch(error => { process.stderr.write(`${(error as Error).message}\n`); process.exitCode = 1; });
}
