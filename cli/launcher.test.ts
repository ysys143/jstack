import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

// Compiled to dist/cli; the launcher source stays in the checkout.
const LAUNCHER = fileURLToPath(new URL('../../hosts/claude/bin/jst', import.meta.url));
const FAKE_MAIN = 'process.stdout.write(JSON.stringify(process.argv.slice(2)));process.exitCode=Number(process.env.FAKE_EXIT||0);\n';
const posixOnly = { skip: process.platform === 'win32' };
const TOOLS = posixOnly.skip ? [] : ['dirname', 'readlink'].map(tool => spawnSync('/bin/sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).stdout.trim());

/** A plugin root with a space in its path, the launcher in payload/bin/, and a stand-in CLI beside it. */
function plugin(withMain = true) {
  const box = mkdtempSync(join(tmpdir(), 'jstack-launcher-')), root = join(box, 'plugin root'), launcher = join(root, 'payload/bin/jst');
  mkdirSync(join(root, 'payload/bin'), { recursive: true });
  // The bare plugin needs a launcher file only where Git Bash runs it by path.
  if (withMain || process.platform === 'win32') { copyFileSync(LAUNCHER, launcher); chmodSync(launcher, 0o755); }
  if (withMain) { mkdirSync(join(root, 'payload/cli'), { recursive: true }); writeFileSync(join(root, 'payload/cli/main.js'), FAKE_MAIN); }
  // Only the tools the launcher needs, so a missing node is observable on any machine.
  const tools = join(box, 'tools'); mkdirSync(tools);
  for (const found of TOOLS) symlinkSync(found, join(tools, found.split('/').at(-1)!));
  return { box, root, tools, launcher };
}
// Shared by the tests: creating fresh executables per test costs more than the runs themselves.
const f = plugin(), bare = plugin(false);
after(() => { for (const fixture of [f, bare]) rmSync(fixture.box, { recursive: true, force: true }); });
const run = (file: string, args: string[], path: string, env: Record<string, string> = {}) =>
  spawnSync(file, args, { encoding: 'utf8', env: { PATH: path, ...env } });
// A stand-in node that prints the CLI path it was given: these cases test where the launcher
// looks, not node itself, and a real node start would dominate their time.
// On macOS it is a link to the system echo, since every new executable file costs a first-run
// check there. Elsewhere it is a script: a multicall coreutils echo refuses to run as `node`.
const standIn = join(f.box, 'stand-in node');
if (!posixOnly.skip) {
  mkdirSync(standIn);
  const node = join(standIn, 'node');
  if (process.platform === 'darwin') symlinkSync('/bin/echo', node);
  else { writeFileSync(node, '#!/bin/sh\necho "$@"\n'); chmodSync(node, 0o755); }
}
const realMain = () => join(realpathSync(f.root), 'payload', 'cli', 'main.js');

test('launcher passes arguments unchanged and preserves the exit code', posixOnly, () => {
  const args = ['disk', 'a b', `it's "quoted"`, '', '--flag=$HOME', '*'];
  const result = run(f.launcher, args, `${f.tools}:${dirname(process.execPath)}`, { FAKE_EXIT: '7' });
  assert.equal(result.status, 7, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), args);
  assert.equal(result.stderr, '');
});

test('launcher reached through a relative symlink chain on PATH resolves the real plugin root', posixOnly, () => {
  const onPath = join(f.box, 'local bin'), hop = join(f.box, 'hop');
  mkdirSync(onPath); mkdirSync(hop);
  symlinkSync('../plugin root/payload/bin/jst', join(hop, 'jst'));
  symlinkSync(join(hop, 'jst'), join(onPath, 'jst'));
  const result = run('jst', ['--version'], `${onPath}:${f.tools}:${standIn}`);
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, `${realMain()} --version\n`);
});

test('launcher resolves .. physically through a symlinked directory and never runs a decoy', posixOnly, () => {
  // home/.local/bin is a link to x/y, whose jst links to ../../plugin root/payload/bin/jst. A
  // logical cd would land in home/plugin root/payload, where a decoy CLI waits.
  const home = join(f.box, 'home'), deep = join(f.box, 'x', 'y'), decoy = join(home, 'plugin root');
  mkdirSync(join(home, '.local'), { recursive: true }); mkdirSync(deep, { recursive: true });
  mkdirSync(join(decoy, 'payload', 'bin'), { recursive: true }); mkdirSync(join(decoy, 'payload', 'cli'), { recursive: true });
  writeFileSync(join(decoy, 'payload', 'cli', 'main.js'), '');
  symlinkSync(deep, join(home, '.local', 'bin')); symlinkSync('../../plugin root/payload/bin/jst', join(deep, 'jst'));
  const entry = join(home, '.local', 'bin', 'jst'), path = `${f.tools}:${standIn}`;
  const shells = ['/bin/bash', '/bin/dash'].filter(shell => existsSync(shell)).map(shell => spawnSync(shell, [entry, '--version'], { encoding: 'utf8', env: { PATH: path } }));
  for (const result of [run(entry, ['--version'], path), ...shells]) {
    assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, `${realMain()} --version\n`);
  }
});

test('launcher ignores an exported shell function named node', posixOnly, () => {
  // bash, and the macOS sh that is bash, import BASH_FUNC_node%% as a function that command -v reports.
  const env = { 'BASH_FUNC_node%%': '() {  echo shadow; }' };
  const withNode = spawnSync('/bin/bash', [f.launcher, 'a b'], { encoding: 'utf8', env: { ...env, PATH: `${f.tools}:${standIn}` } });
  assert.equal(withNode.status, 0, withNode.stderr); assert.equal(withNode.stdout, `${realMain()} a b\n`);
  const without = spawnSync('/bin/bash', [f.launcher, '--version'], { encoding: 'utf8', env: { ...env, PATH: f.tools } });
  assert.equal(without.status, 127); assert.equal(without.stdout, '');
  assert.match(without.stderr, /^jstack: node is not on PATH; install Node\.js 20 or newer\n$/);
});

test('launcher names a node found only through a relative PATH entry', posixOnly, () => {
  const relative = join(f.box, 'relative-node'); mkdirSync(relative); symlinkSync(process.execPath, join(relative, 'node'));
  // bash and dash report such a node relatively; the macOS sh makes it absolute.
  for (const shell of ['/bin/bash', '/bin/dash'].filter(path => existsSync(path))) {
    const result = spawnSync(shell, [f.launcher, '--version'], { encoding: 'utf8', cwd: f.box, env: { PATH: `${f.tools}:relative-node` } });
    assert.equal(result.status, 127, shell); assert.equal(result.stdout, '');
    assert.match(result.stderr, /^jstack: node on PATH is not an absolute path \(relative-node\/node\); use an absolute PATH entry\n$/);
  }
});

test('launcher fails with one stderr line and status 127 when node or the CLI is missing', posixOnly, () => {
  const noNode = run(f.launcher, ['--version'], f.tools);
  assert.equal(noNode.status, 127); assert.equal(noNode.stdout, '');
  assert.match(noNode.stderr, /^jstack: node is not on PATH; install Node\.js 20 or newer\n$/);
  // The launcher text with a $0 inside the bare plugin: no new executable is needed for this case.
  const noMain = spawnSync('/bin/sh', ['-c', readFileSync(LAUNCHER, 'utf8'), bare.launcher, '--version'], { encoding: 'utf8', env: { PATH: `${bare.tools}:${dirname(process.execPath)}` } });
  assert.equal(noMain.status, 127); assert.equal(noMain.stdout, '');
  assert.match(noMain.stderr, /^jstack: no CLI at .*plugin root\/payload\/cli\/main\.js \(this launcher must stay inside the installed jstack plugin\)\n$/);
});

test('launcher stops on a symlink cycle instead of looping', posixOnly, () => {
  symlinkSync(join(f.box, 'b'), join(f.box, 'a')); symlinkSync(join(f.box, 'a'), join(f.box, 'b'));
  // A kernel cannot execute a cyclic link, so give the launcher text that link as $0.
  const result = spawnSync('/bin/sh', ['-c', readFileSync(LAUNCHER, 'utf8'), join(f.box, 'a')], { encoding: 'utf8', env: { PATH: `${f.tools}:${dirname(process.execPath)}` }, timeout: 5000 });
  assert.equal(result.signal, null); assert.equal(result.status, 127);
  assert.match(result.stderr, /^jstack: no CLI at /);
});

/** Git Bash, where Claude Code runs its Bash tool on Windows; git-core sits three levels below Git's root. */
function gitBash(): string | undefined {
  if (process.env.JSTACK_TEST_GIT_BASH) return process.env.JSTACK_TEST_GIT_BASH;
  const execPath = spawnSync('git', ['--exec-path'], { encoding: 'utf8' });
  const bash = execPath.status === 0 ? join(execPath.stdout.trim(), '..', '..', '..', 'bin', 'bash.exe') : '';
  return bash && existsSync(bash) ? bash : undefined;
}
const BASH = process.platform === 'win32' ? gitBash() : undefined;
const windowsOnly = { skip: process.platform !== 'win32' ? 'POSIX hosts run the launcher directly' : BASH ? false : 'Git Bash was not found' };
/** Run a bash script file: the arguments live in the script, so no Windows command-line quoting is involved. */
function bashScript(name: string, lines: string[]) {
  const script = join(f.box, name);
  writeFileSync(script, ['export PATH="/usr/bin:$PATH"', ...lines].join('\n') + '\n');
  return spawnSync(BASH!, [script], { encoding: 'utf8' });
}
const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

test('Git Bash runs the launcher by path and by PATH lookup with arguments and status unchanged', windowsOnly, () => {
  const args = ['disk', 'a b', `it's "quoted"`, '', '--flag=$HOME', '*'], line = args.map(quote).join(' ');
  const result = bashScript('drive.sh', [
    'export FAKE_EXIT=7', `root=$(cygpath -u ${quote(f.root)})`,
    `"$root/payload/bin/jst" ${line}; echo " status=$?"`,
    `sh "$root/payload/bin/jst" ${line}; echo " status=$?"`,
    `PATH="$root/payload/bin:$PATH" jst ${line}; echo " status=$?"`,
  ]);
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stderr, '');
  const rows = result.stdout.trim().split(/\r?\n/).map(row => /^(\[.*\]) status=(\d+)$/.exec(row));
  assert.equal(rows.length, 3, result.stdout);
  for (const row of rows) { assert.ok(row, result.stdout); assert.deepEqual(JSON.parse(row[1]!), args); assert.equal(row[2], '7'); }
});

test('Git Bash reports a missing node or CLI with status 127', windowsOnly, () => {
  const result = bashScript('missing.sh', [
    `root=$(cygpath -u ${quote(f.root)}); bare=$(cygpath -u ${quote(bare.root)})`,
    'PATH="$root/payload/bin:/usr/bin" jst --version; echo "status=$?"',
    '"$bare/payload/bin/jst" --version; echo "status=$?"',
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split(/\r?\n/), ['status=127', 'status=127']);
  assert.match(result.stderr, /^jstack: node is not on PATH; install Node\.js 20 or newer\r?\njstack: no CLI at .*plugin root\/payload\/cli\/main\.js /);
});
