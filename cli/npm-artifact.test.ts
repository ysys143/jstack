import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

test('installed npm tarball runs recall and offline SQLite outside the checkout', { skip: !process.env.JSTACK_TEST_NPM_TARBALL }, async () => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'jstack-npm-artifact-'));
  const home = join(root, 'home'), prefix = join(root, 'installed');
  mkdirSync(home); mkdirSync(prefix);
  const env = { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: join(home, '.claude'), CODEX_HOME: join(home, '.codex'), XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache'), npm_config_cache: join(root, 'npm-cache'), npm_config_userconfig: join(root, 'empty.npmrc') };
  writeFileSync(env.npm_config_userconfig, '');
  const run = (command: string, args: string[]) => {
    const result = spawnSync(command, args, { cwd: root, env, encoding: 'utf8', timeout: 120_000 });
    assert.equal(result.status, 0, `${command} ${args.join(' ')}\n${result.stderr}\n${result.stdout}`);
    return result.stdout;
  };
  let checked: { sourceRoot: string; dispose(): void } | undefined;
  try {
    run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', prefix, resolve(process.env.JSTACK_TEST_NPM_TARBALL!)]);
    const pkg = join(prefix, 'node_modules/@ysys143/jstack');
    const { unpackBundle } = await import(pathToFileURL(join(pkg, 'dist/cli/download.js')).href);
    checked = await unpackBundle(readFileSync(join(pkg, 'dist/bundle/jstack.tgz')), readFileSync(join(pkg, 'dist/bundle/jstack.integrity'), 'utf8'), false);
    const payload = join(checked!.sourceRoot, 'payload');
    const bin = process.platform === 'win32' ? join(pkg, 'dist/cli/main.js') : join(prefix, 'node_modules/.bin/jst');
    assert.match(run(process.execPath, [bin, '--help']), /Usage: jstack/);
    assert.match(run(process.execPath, [bin, 'task', 'run', '--help']), /start\|select\|event/);
    assert.match(run(process.execPath, [bin, 'task', '--help']), /runtime[\\/]TASKS\.md/);
    const catalog = JSON.parse(run(process.execPath, [bin, 'catalog', 'resolve', 'sdlc']));
    assert.equal(catalog.owner, 'sdlc');
    assert.equal(catalog.body, 'skills/sdlc/SKILL.md');
    const recall = join(payload, 'skills/recall/scripts/migrate_sessions.js');
    assert.match(run(process.execPath, [recall, '--help']), /migrate_sessions plan/);
    const old = join(root, 'missing-old'), project = join(root, 'project'), source = join(root, 'source'), destination = join(root, 'destination');
    for (const path of [project, source, destination]) mkdirSync(path);
    const encoded = (path: string) => path.replace(/[\\/:]/g, '-');
    const original = join(source, 'projects', encoded(old), 'one.jsonl');
    mkdirSync(dirname(original), { recursive: true });
    const before = JSON.stringify({ sessionId: 'one', cwd: old, message: old }) + '\n';
    writeFileSync(original, before);
    const plan = join(root, 'plan.json'), receipt = join(root, 'receipt');
    run(process.execPath, [recall, 'plan', '--host', 'claude', '--source-data-dir', source, '--data-dir', destination, '--old-project', old, '--project', project, '--output', plan]);
    run(process.execPath, [recall, 'apply', plan, '--receipt', receipt]);
    assert.equal(JSON.parse(run(process.execPath, [recall, 'verify', receipt])).status, 'verified');
    const migrated = join(destination, 'projects', encoded(project), 'one.jsonl');
    assert.deepEqual(JSON.parse(readFileSync(migrated, 'utf8')), { sessionId: 'one', cwd: project, message: old });
    run(process.execPath, [recall, 'rollback', receipt]);
    assert.equal(existsSync(migrated), false);
    assert.equal(readFileSync(original, 'utf8'), before);
    const probe = join(root, 'sqlite-probe.mjs');
    writeFileSync(probe, `import assert from 'node:assert/strict';
import { SqliteDatabase } from ${JSON.stringify(pathToFileURL(join(payload, 'runtime/sqlite.js')).href)};
globalThis.fetch = () => { throw new Error('runtime network forbidden'); };
const db = await SqliteDatabase.open(${JSON.stringify(join(root, 'probe.sqlite'))}, { readonly: false, fileMustExist: false });
try {
  await db.exec('CREATE TABLE items(value INTEGER)');
  await db.execute('INSERT INTO items VALUES (?)', [9223372036854775807n]);
  assert.equal((await db.typedRows('items'))[0].value, 9223372036854775807n);
  console.log('offline SQLite int64 verified');
} finally { await db.close(); }
`);
    assert.match(run(process.execPath, [probe]), /offline SQLite int64 verified/);
  } finally { checked?.dispose(); rmSync(root, { recursive: true, force: true }); }
});
