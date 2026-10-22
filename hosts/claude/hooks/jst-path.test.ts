import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { exportLine, main, persistPath, shellPath } from './jst-path.js';

// Compiled to dist/hosts/claude/hooks; the launcher source stays in the checkout.
const LAUNCHER = fileURLToPath(new URL('../../../../hosts/claude/bin/jst', import.meta.url));
const posixOnly = { skip: process.platform === 'win32' };

/** A plugin root under the given name, with the real launcher (unless omitted) and a stand-in CLI. */
function plugin(box: string, name: string, launcher = true) {
  const root = join(box, name), bin = join(root, 'payload', 'bin');
  mkdirSync(bin, { recursive: true }); mkdirSync(join(root, 'payload', 'cli'));
  if (launcher) { copyFileSync(LAUNCHER, join(bin, 'jst')); chmodSync(join(bin, 'jst'), 0o755); }
  writeFileSync(join(root, 'payload', 'cli', 'main.js'), 'process.stdout.write("plugin " + process.argv.slice(2).join(" "));\n');
  return { root, bin };
}
// One temporary box for the file: fresh executables cost more than the checks themselves.
const box = mkdtempSync(join(tmpdir(), 'jst-path-'));
after(() => rmSync(box, { recursive: true, force: true }));
let files = 0;
const envFile = () => join(box, `session-env-${files++}.sh`);

test('Windows directories are written the way Git Bash spells them', () => {
  assert.equal(shellPath('C:\\Users\\a b\\plugins\\jstack\\payload\\bin', 'win32'), '/c/Users/a b/plugins/jstack/payload/bin');
  assert.equal(shellPath('D:/a/_temp\\jstack package/payload/bin', 'win32'), '/d/a/_temp/jstack package/payload/bin');
  assert.equal(shellPath('\\\\?\\C:\\long\\payload\\bin', 'win32'), '/c/long/payload/bin');
  assert.equal(shellPath('\\\\?\\UNC\\server\\share\\payload\\bin', 'win32'), '//server/share/payload/bin');
  assert.equal(shellPath('/opt/jstack/payload/bin', 'linux'), '/opt/jstack/payload/bin');
  assert.equal(exportLine("/x/it's"), `export PATH="$PATH":'/x/it'\\''s'`);
});

test('the export is appended once on its own line, whatever the file held before', posixOnly, () => {
  const p = plugin(box, "plugin root's"), file = envFile();
  writeFileSync(file, 'export OTHER=1');
  const input = { envFile: file, pluginRoot: p.root, env: {} };
  assert.equal(persistPath(input), 'appended');
  assert.equal(persistPath(input), 'present');
  assert.equal(readFileSync(file, 'utf8'), `export OTHER=1\n${exportLine(p.bin)}\n`);
});

test('opting out, a missing launcher, no env file, an unsafe path or an unwritable file writes nothing to stdout', posixOnly, () => {
  const p = plugin(box, 'opt root'), bare = plugin(box, 'bare root', false), file = envFile(), warnings: string[] = [];
  const input = { envFile: file, pluginRoot: p.root, env: {}, warn: (line: string) => { warnings.push(line); } };
  for (const value of ['1', 'true']) assert.equal(persistPath({ ...input, env: { JSTACK_NO_PATH_LINK: value } }), 'skipped');
  assert.equal(persistPath({ ...input, pluginRoot: bare.root }), 'skipped');
  assert.equal(persistPath({ ...input, envFile: undefined }), 'skipped');
  // A colon would split PATH and a line break would split the export.
  for (const name of ['colon:root', 'line\nroot']) assert.equal(persistPath({ ...input, pluginRoot: plugin(box, name).root }), 'skipped');
  assert.equal(existsSync(file), false); assert.deepEqual(warnings, []);
  mkdirSync(file);
  assert.equal(persistPath(input), 'failed');
  assert.equal(warnings.length, 1); assert.match(warnings[0]!, /^jstack: could not add .*opt root\/payload\/bin to PATH through CLAUDE_ENV_FILE \(EISDIR\)\.\n$/);
  const write = process.stdout.write, printed: string[] = [];
  process.stdout.write = ((chunk: string) => { printed.push(String(chunk)); return true; }) as typeof process.stdout.write;
  try { assert.equal(main({ CLAUDE_ENV_FILE: envFile(), CLAUDE_PLUGIN_ROOT: p.root }), 0); } finally { process.stdout.write = write; }
  assert.deepEqual(printed, []);
});

test('the sourced line puts jstack last on PATH, so an earlier jstack wins', posixOnly, () => {
  const p = plugin(box, 'shell root'), file = envFile();
  assert.equal(persistPath({ envFile: file, pluginRoot: p.root, env: {} }), 'appended');
  const nodeOnly = join(box, 'node-only'), earlier = join(box, 'npm bin');
  mkdirSync(nodeOnly); symlinkSync(process.execPath, join(nodeOnly, 'node'));
  mkdirSync(earlier); writeFileSync(join(earlier, 'jst'), '#!/bin/sh\necho npm "$@"\n'); chmodSync(join(earlier, 'jst'), 0o755);
  const shell = (path: string) => spawnSync('/bin/sh', ['-c', '. "$1" && command -v jst && jst --version', 'sh', file], { encoding: 'utf8', env: { PATH: path } });
  const plain = shell(`/usr/bin:/bin:${nodeOnly}`);
  assert.equal(plain.status, 0, plain.stderr); assert.equal(plain.stdout, `${join(p.bin, 'jst')}\nplugin --version`);
  const npm = shell(`${earlier}:/usr/bin:/bin:${nodeOnly}`);
  assert.equal(npm.status, 0, npm.stderr); assert.equal(npm.stdout, `${join(earlier, 'jst')}\nnpm --version\n`);
});
