import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { mkdtempSync, readFileSync, rmSync, cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { c as archive } from 'tar';
import { unpackBundle, fetchBytes } from './download.js';
import { checkPackage } from '../packaging/build.js';
function integrity(bytes: Buffer) { return 'sha512-' + createHash('sha512').update(bytes).digest('base64'); }
function entry(name: string, type = '0') {
  const header = Buffer.alloc(512); header.write(name, 0, 100); header.write('0000600\0', 100); header.write('0000000\0', 108); header.write('0000000\0', 116); header.write('00000000000\0', 124); header.write('00000000000\0', 136); header.fill(32, 148, 156); header.write(type, 156); if (['1', '2'].includes(type)) header.write('../../outside', 157); header.write('ustar\0', 257); header.write('00', 263); const checksum = header.reduce((sum, byte) => sum + byte, 0); header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148); return gzipSync(Buffer.concat([header, Buffer.alloc(1024)]));
}
test('download rejects unsafe URLs without issuing a request', async () => { for (const url of ['http://registry.example.invalid/x', 'https://secret@registry.example.invalid/x', 'file:///tmp/x']) await assert.rejects(fetchBytes(url), /Invalid registry/); });
test('download rejects traversal, links, and special tar entries before installation', async () => {
  for (const [name, type] of [['../outside', '0'], ['/outside', '0'], ['package/../outside', '0'], ['package\\outside', '0'], ['C:/outside', '0'], ['package/dist/bundle/jstack/link', '2'], ['package/dist/bundle/jstack/link', '1'], ['package/dist/bundle/jstack/device', '3']]) { const bytes = entry(name, type); await assert.rejects(unpackBundle(bytes, integrity(bytes)), /Unsafe archive|links and special|TAR_ENTRY_ERROR|Archive contains no jstack bundle/, `${name} (${type})`); }
});
test('download validates actual checked bundle after extraction', { skip: !process.env.JSTACK_TEST_CHECKED_PACKAGE }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'jstack-download-test-')); let unpacked: Awaited<ReturnType<typeof unpackBundle>> | undefined;
  try { const source = process.env.JSTACK_TEST_CHECKED_PACKAGE!, expected = checkPackage(source); cpSync(source, join(root, 'package/dist/bundle/jstack'), { recursive: true }); const file = join(root, 'package.tgz'); await archive({ cwd: root, file, gzip: true }, ['package']); const bytes = readFileSync(file); unpacked = await unpackBundle(bytes, integrity(bytes)); assert.deepEqual(checkPackage(unpacked.sourceRoot), expected); const extracted = unpacked.sourceRoot; unpacked.dispose(); unpacked = undefined; assert.equal(existsSync(extracted), false); }
  finally { unpacked?.dispose(); rmSync(root, { recursive: true, force: true }); }
});
test('npm envelope preserves checked dotfiles and rejects modified inner bytes', { skip: !process.env.JSTACK_TEST_CHECKED_PACKAGE }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'jstack-envelope-test-'));
  let unpacked: Awaited<ReturnType<typeof unpackBundle>> | undefined;
  try {
    const source = process.env.JSTACK_TEST_CHECKED_PACKAGE!, expected = checkPackage(source);
    cpSync(source, join(root, 'inner/package/dist/bundle/jstack'), { recursive: true });
    const wrapper = join(root, 'outer/package/dist/bundle'); mkdirSync(wrapper, { recursive: true });
    const inner = join(wrapper, 'jstack.tgz'); await archive({ cwd: join(root, 'inner'), file: inner, gzip: true }, ['package']);
    writeFileSync(join(wrapper, 'jstack.integrity'), integrity(readFileSync(inner)));
    const outer = join(root, 'outer.tgz'); await archive({ cwd: join(root, 'outer'), file: outer, gzip: true }, ['package']);
    let bytes = readFileSync(outer); unpacked = await unpackBundle(bytes, integrity(bytes));
    assert.deepEqual(checkPackage(unpacked.sourceRoot), expected);
    assert.equal(existsSync(join(unpacked.sourceRoot, 'payload/skills/science/repos/academic/.gitignore')), true);
    unpacked.dispose(); unpacked = undefined;
    writeFileSync(inner, Buffer.from('modified'));
    await archive({ cwd: join(root, 'outer'), file: outer, gzip: true }, ['package']);
    bytes = readFileSync(outer); await assert.rejects(unpackBundle(bytes, integrity(bytes)), /integrity mismatch/);
  } finally { unpacked?.dispose(); rmSync(root, { recursive: true, force: true }); }
});

test('download rejects an archive with no bundle explicitly', async () => { const bytes = entry('package/README.md'); await assert.rejects(unpackBundle(bytes, integrity(bytes)), /Archive contains no jstack bundle/); });

test('a failed temporary cleanup never hides the unpack error', async () => {
  // Windows can refuse to remove a briefly locked temporary directory; the caller must still see why unpacking failed.
  const left: string[] = [];
  const failing = (path: string) => { left.push(path); throw Object.assign(new Error('ENOTEMPTY: directory not empty'), { code: 'ENOTEMPTY' }); };
  try {
    const unsafe = entry('../outside');
    await assert.rejects(unpackBundle(unsafe, integrity(unsafe), true, failing), /Unsafe archive path/);
    const empty = entry('package/README.md');
    await assert.rejects(unpackBundle(empty, integrity(empty), true, failing), /Archive contains no jstack bundle/);
    assert.equal(left.length, 2);
  } finally { for (const path of left) rmSync(path, { recursive: true, force: true }); }
});
