import { createHash, timingSafeEqual } from 'node:crypto';
import { request } from 'node:https';
import { existsSync, readFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { x as extract } from 'tar';
import { checkPackage } from '../packaging/build.js';

const MAX_ARCHIVE = 256 * 1024 * 1024;
const REGISTRY = 'https://registry.npmjs.org/@ysys143%2fjstack';
const VERSION = /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$/;
export function verifyIntegrity(bytes: Buffer, integrity: string): void {
  const tokens = integrity.split(/\s+/).filter(token => token.startsWith('sha512-'));
  if (!tokens.length) throw new Error('Registry archive is missing SHA-512 integrity');
  const actual = createHash('sha512').update(bytes).digest();
  if (!tokens.some(token => { const expected = Buffer.from(token.slice(7), 'base64'); return expected.length === actual.length && timingSafeEqual(actual, expected); })) throw new Error('Registry archive integrity mismatch');
}
export function fetchBytes(raw: string, limit = MAX_ARCHIVE, redirects = 0): Promise<Buffer> {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || redirects > 5) return Promise.reject(new Error('Invalid registry download URL'));
  return new Promise((resolve, reject) => {
    const req = request(url, { headers: { 'user-agent': 'jstack-installer', accept: 'application/json, application/octet-stream' } }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0) && response.headers.location) {
        response.resume(); fetchBytes(new URL(response.headers.location, url).href, limit, redirects + 1).then(resolve, reject); return;
      }
      if (response.statusCode !== 200) { response.resume(); reject(new Error(`Registry request failed with HTTP ${response.statusCode}`)); return; }
      const chunks: Buffer[] = []; let size = 0;
      response.on('data', (chunk: Buffer) => { size += chunk.length; if (size > limit) response.destroy(new Error('Registry response exceeds size limit')); else chunks.push(chunk); });
      response.on('error', reject); response.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.setTimeout(60_000, () => req.destroy(new Error('Registry request timed out'))); req.on('error', reject); req.end();
  });
}
/** Windows can briefly lock a temporary directory (scanners, indexers); retry before giving up. */
const TEMPORARY_REMOVAL = { recursive: true, force: true, maxRetries: 5, retryDelay: 100 } as const;
export function removeTemporary(path: string): void { rmSync(path, TEMPORARY_REMOVAL); }
function bestEffort(remove: (path: string) => void, path: string): void {
  try { remove(path); } catch { /* A leftover temporary directory must not replace the result or the original error. */ }
}
export async function unpackBundle(bytes: Buffer, integrity: string, allowEnvelope = true, remove: (path: string) => void = removeTemporary): Promise<{ sourceRoot: string; dispose(): void }> {
  verifyIntegrity(bytes, integrity);
  const root = mkdtempSync(join(tmpdir(), 'jstack-download-'));
  try {
    const archive = join(root, 'package.tgz'); writeFileSync(archive, bytes, { mode: 0o600 });
    const destination = join(root, 'unpacked'); mkdirSync(destination);
    let count = 0, size = 0; let invalid: Error | undefined;
    const rejectEntry = (message: string): false => { invalid ??= new Error(message); return false; };
    await extract({ file: archive, cwd: destination, strict: true, preservePaths: false, noChmod: true, filter(path, entry) {
      if (path.includes('\\') || path.startsWith('/') || path.includes(':') || path.split('/').some(part => part === '..' || part === '.')) return rejectEntry('Unsafe archive path');
      const type = 'type' in entry ? entry.type : entry.isDirectory() ? 'Directory' : entry.isFile() ? 'File' : 'Other';
      if (!['File', 'OldFile', 'Directory'].includes(type)) return rejectEntry('Archive links and special files are forbidden');
      size += entry.size; count++;
      if (count > 100_000 || size > 1024 * 1024 * 1024) return rejectEntry('Expanded archive exceeds limit');
      return !invalid && (path.startsWith('package/dist/bundle/jstack/') || allowEnvelope && ['package/dist/bundle/jstack.tgz', 'package/dist/bundle/jstack.integrity'].includes(path));
    } });
    if (invalid) throw invalid;
    const nested = join(destination, 'package/dist/bundle/jstack.tgz');
    if (allowEnvelope && existsSync(nested)) {
      const unpacked = await unpackBundle(readFileSync(nested), readFileSync(join(destination, 'package/dist/bundle/jstack.integrity'), 'utf8'), false, remove);
      bestEffort(remove, root);
      return unpacked;
    }
    const sourceRoot = join(destination, 'package/dist/bundle/jstack');
    if (!existsSync(sourceRoot)) throw new Error('Archive contains no jstack bundle');
    checkPackage(sourceRoot);
    return { sourceRoot, dispose() { bestEffort(remove, root); } };
  } catch (error) { bestEffort(remove, root); throw error; }
}
export async function downloadBundle(version?: string): Promise<{ sourceRoot: string; version: string; dispose(): void }> {
  if (version && !VERSION.test(version)) throw new Error('Version must be an exact semantic version');
  const metadata = JSON.parse((await fetchBytes(REGISTRY, 32 * 1024 * 1024)).toString('utf8'));
  const selected: string = version ?? metadata['dist-tags']?.latest;
  if (!VERSION.test(selected ?? '') || (!version && selected.includes('-'))) throw new Error('No stable release is available');
  const release = metadata.versions?.[selected];
  if (release?.name !== '@ysys143/jstack' || release.version !== selected || typeof release.dist?.tarball !== 'string' || typeof release.dist?.integrity !== 'string') throw new Error('Invalid registry release metadata');
  const downloaded = await unpackBundle(await fetchBytes(release.dist.tarball), release.dist.integrity);
  try { if (checkPackage(downloaded.sourceRoot).version !== selected) throw new Error('Bundle version differs from registry version'); }
  catch (error) { downloaded.dispose(); throw error; }
  return { ...downloaded, version: selected };
}
