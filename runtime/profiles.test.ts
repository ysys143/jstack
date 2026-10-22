import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { Store, accountEnv, discover, jsonBytes, sendMail, validate, verifySnapshot, type MetadataReader } from './profiles.js';
import { atomicWrite, privateDir, removeTreeSync, withLock } from './os.js';
function fixture(t: TestContext) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jstack-profiles-'))); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new Store(path.join(root, '한글 state')); const ws = { schemaVersion: 1, configDir: root, account: 'fixture-account' }; const report = { schemaVersion: 1, subjectName: 'Test' }; return { root, store, ws, report };
}
test('empty inspect and missing named profile do not create state', t => { const { store } = fixture(t); assert.deepEqual(store.inspect(), { configured: false, profiles: [] }); assert.throws(() => store.load('missing')); assert.equal(fs.existsSync(store.root), false); });
test('save/load, revision conflicts and default snapshot binding', t => {
  const { store, ws, report } = fixture(t); const snapshot = store.save('work', ws, report, 0, { makeDefault: true });
  assert.deepEqual(store.load(), snapshot); assert.equal(snapshot.revision, 1); assert.throws(() => store.save('work', ws, report, 0), /changed/);
  store.save('personal', ws, report, 0, { makeDefault: true }); assert.equal(store.load().profile, 'personal');
  const reader: MetadataReader = () => ({ user: { permissionId: 'fixture-account' } }); assert.equal(verifySnapshot(snapshot, reader).profile, 'work'); assert.throws(() => verifySnapshot(snapshot, () => ({ user: { permissionId: 'other' } })), /binding changed/);
});
test('profile rejects secrets, invalid numbers, schema and paths before creation', t => {
  const { store, ws, report } = fixture(t); for (const invalid of [{ ...ws, token: 'secret' }, { ...ws, schemaVersion: 2 }, { ...ws, revision: true }, { ...ws, configDir: 'relative' }]) assert.throws(() => store.save('work', invalid as never, report, 0));
  for (const name of ['../escape', '', '/absolute', 'a/b']) assert.throws(() => store.save(name, ws, report, 0));
  assert.equal(fs.existsSync(store.root), false); assert.throws(() => validate(ws, { ...report, nameColumn: 'AAAA' }));
});
test('partial pair is preserved and reported', t => { const { store, ws, report } = fixture(t); store.save('work', ws, report, 0); fs.unlinkSync(path.join(store.directory('work'), 'reporting.json')); assert.throws(() => store.save('work', ws, report, 1), /partial/); assert.equal(store.inspect().profiles[0]!.valid, false); });
test('interrupted v1 journal restores exact prior bytes', t => {
  const { store, ws, report } = fixture(t); store.save('work', ws, report, 0); const directory = store.directory('work');
  const files = ['workspace.json', 'reporting.json'].map(f => path.join(directory, f)); const previous = files.map(f => fs.readFileSync(f, 'utf8'));
  atomicWrite(path.join(directory, '.transaction.json'), jsonBytes({ schemaVersion: 1, previous })); atomicWrite(files[0]!, jsonBytes({ ...ws, revision: 2 }));
  assert.throws(() => store.load('work'), /interrupted/); store.recover('work'); assert.deepEqual(files.map(f => fs.readFileSync(f, 'utf8')), previous); assert.equal(store.load('work').revision, 1);
});
test('malformed recovery data cannot replace files', t => { const { store, ws, report } = fixture(t); store.save('work', ws, report, 0); atomicWrite(path.join(store.directory('work'), '.transaction.json'), jsonBytes({ schemaVersion: 1, previous: [42, null] })); assert.throws(() => store.recover('work'), /invalid recovery/); });
test('POSIX public state is rejected without chmod repair', { skip: process.platform === 'win32' }, t => { const { store, ws, report } = fixture(t); store.save('work', ws, report, 0); const file = path.join(store.directory('work'), 'workspace.json'); fs.chmodSync(file, 0o644); assert.throws(() => store.load('work'), /permissions/); assert.equal(fs.statSync(file).mode & 0o777, 0o644); });
test('symlink state does not alter outside target', t => { const { root, store, ws, report } = fixture(t); store.save('work', ws, report, 0); const directory = store.directory('work'); const outside = path.join(root, 'outside'); fs.mkdirSync(outside); removeTreeSync(directory); fs.symlinkSync(outside, directory, process.platform === 'win32' ? 'junction' : 'dir'); assert.throws(() => store.load('work'), /symlink/); assert.deepEqual(fs.readdirSync(outside), []); });
test('case-equivalent profile names cannot alias', t => { const { store, ws, report } = fixture(t); store.save('Work', ws, report, 0); assert.throws(() => store.save('work', ws, report, 0), /collision/); });
test('discovery paginates, strips unexpected candidate fields, and does not save', t => {
  const { root } = fixture(t); const reader: MetadataReader = (_config, args) => {
    if (args[1] === 'about') return { user: { permissionId: 'fixture-account' } }; if (args[1] === 'drives') return { drives: [] };
    const params = JSON.parse(args[4]!); return params.pageToken ? { files: [{ id: 'second', secret: 'excluded' }] } : { files: [{ id: 'first' }], nextPageToken: 'second' };
  };
  const result = discover(root, reader); assert.equal(result.saved, false); assert.deepEqual((result.candidates as Record<string, unknown>).files, [{ id: 'first' }, { id: 'second' }]);
  assert.throws(() => discover(root, (_c, args) => args[1] === 'about' ? { user: { permissionId: 'same' } } : args[1] === 'drives' ? { drives: [], nextPageToken: 'loop' } : { files: [] }), /pagination repeated/);
});
test('selected account environment drops all competing credential overrides', () => {
  const old = process.env.GOOGLE_APPLICATION_CREDENTIALS; process.env.GOOGLE_APPLICATION_CREDENTIALS = 'must-not-leak';
  try { const env = accountEnv(os.tmpdir()); assert.equal(env.GOOGLE_APPLICATION_CREDENTIALS, undefined); assert.equal(env.GOOGLE_WORKSPACE_CLI_CONFIG_DIR, path.resolve(os.tmpdir())); } finally { if (old === undefined) delete process.env.GOOGLE_APPLICATION_CREDENTIALS; else process.env.GOOGLE_APPLICATION_CREDENTIALS = old; }
});
test('two processes cannot commit the same expected revision', async t => {
  const { store, ws, report, root } = fixture(t); store.save('work', ws, report, 0); const module = new URL('./profiles.js', import.meta.url).href;
  const source = `import {Store} from ${JSON.stringify(module)}; const [root,ws,r]=JSON.parse(process.env.JSTACK_TEST_INPUT); try {new Store(root).save('work',ws,r,1);process.exitCode=0}catch{process.exitCode=2}`;
  const child = () => new Promise<number | null>((resolve, reject) => { const processChild = spawn(process.execPath, ['--input-type=module', '-e', source], { cwd: root, env: { ...process.env, JSTACK_TEST_INPUT: JSON.stringify([store.root, ws, report]) }, stdio: 'ignore' }); processChild.once('error', reject); processChild.once('exit', resolve); });
  assert.deepEqual((await Promise.all([child(), child()])).sort(), [0, 2]); assert.equal(store.load('work').revision, 2);
});
test('unknown existing lock fails closed and is not stolen', t => { const { root } = fixture(t); const lock = path.join(root, 'lock'); privateDir(lock); assert.throws(() => withLock(lock, () => assert.fail('lock stolen'), 20), /unavailable/); assert.ok(fs.statSync(lock).isDirectory()); });
test('explicit recovery refuses a live owner and releases a proven dead owner', async t => {
  const { store, ws, report } = fixture(t); store.save('work', ws, report, 0); const lock = path.join(store.directory('work'), '.lock-v2'); privateDir(lock);
  const owner = path.join(lock, 'owner.json'); atomicWrite(owner, jsonBytes({ pid: process.pid, host: os.hostname() })); assert.throws(() => store.recoverLock('work'), /still active/);
  const pid = await new Promise<number>((resolve, reject) => { const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' }); child.once('error', reject); child.once('exit', () => resolve(child.pid!)); });
  atomicWrite(owner, jsonBytes({ pid, host: os.hostname() })); assert.equal(store.recoverLock('work').lockRecovered, true); assert.equal(store.load('work').revision, 1);
});

test('ordinary failure on the second profile file restores both previous files', t => {
  const { store, ws, report } = fixture(t); const before = store.save('work', ws, report, 0); const module = new URL('./profiles.js', import.meta.url).href;
  const source = `import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';import {Store} from ${JSON.stringify(module)};const [root,ws,r]=JSON.parse(process.env.JSTACK_TEST_INPUT);const original=fs.renameSync;let failed=false;fs.renameSync=function(a,b){if(String(b).endsWith('reporting.json')&&!failed){failed=true;throw new Error('injected write failure')}return original(a,b)};syncBuiltinESMExports();try{new Store(root).save('work',ws,{...r,subjectName:'new'},1);process.exitCode=3}catch(e){if(!failed||e.message!=='injected write failure')process.exitCode=4}`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], { env: { ...process.env, JSTACK_TEST_INPUT: JSON.stringify([store.root, ws, report]) }, encoding: 'utf8' }); assert.equal(result.status, 0, result.stderr); assert.deepEqual(store.load('work'), before);
});
test('explicit send uses selected account and literal body; inspect never sends', t => {
  const { root, store, ws, report } = fixture(t); const snapshot = store.save('work', ws, { ...report, mailTo: 'fixture@example.invalid' }, 0); const bin = path.join(root, 'bin'); fs.mkdirSync(bin);
  const entry = path.join(bin, 'node_modules', 'fixture', 'gws.cjs'); fs.mkdirSync(path.dirname(entry), { recursive: true }); const log = path.join(root, 'requests.jsonl');
  fs.writeFileSync(entry, `const fs=require('node:fs'); const a=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({args:a,config:process.env.GOOGLE_WORKSPACE_CLI_CONFIG_DIR})+'\\n');console.log(JSON.stringify(a[0]==='drive'?{user:{permissionId:'fixture-account'}}:{id:'synthetic-message'}))`);
  const launcher = process.platform === 'win32' ? path.join(bin, 'gws.cmd') : path.join(bin, 'gws');
  if (process.platform === 'win32') fs.writeFileSync(launcher, '@ECHO off\nSET "_prog=node"\n"%_prog%" "%dp0%\\node_modules\\fixture\\gws.cjs" %*\n');
  else { fs.writeFileSync(launcher, `#!${process.execPath}\nrequire(${JSON.stringify(entry)});\n`, { mode: 0o755 }); }
  const oldPath = process.env.PATH; process.env.PATH = bin + path.delimiter + oldPath; t.after(() => { process.env.PATH = oldPath; });
  store.inspect(); assert.equal(fs.existsSync(log), false); const body = path.join(root, 'body.txt'); atomicWrite(body, Buffer.from('한글 & %PATH%\nline two'));
  const result = sendMail(snapshot, 'Subject & literal', body); assert.equal(result.messageId, 'synthetic-message');
  const rows = fs.readFileSync(log, 'utf8').trim().split('\n').map(row => JSON.parse(row)); assert.equal(rows.length, 2); assert.equal(rows[1].config, root); assert.equal(rows[1].args.at(-1), '한글 & %PATH%\nline two');
});
