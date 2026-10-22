import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, box, write } from './_fixtures.js';
function fixture(t: TestContext) {
  const root = box(t, 'jstack-root-onboarding-'), state = join(root, 'state'), config = join(root, 'account'), log = join(root, 'gws-events.jsonl'), bin = join(root, 'bin'); mkdirSync(config); mkdirSync(bin); write(join(config, 'identity'), 'fixture-account-a');
  const executable = write(join(bin, 'gws'), `#!${process.execPath}\nconst fs=require('node:fs'), path=require('node:path'), config=process.env.GOOGLE_WORKSPACE_CLI_CONFIG_DIR, args=process.argv.slice(2); fs.appendFileSync(process.env.FIXTURE_GWS_LOG,JSON.stringify({argv:args,config})+'\\n'); const command=args.slice(0,3).join(' '); if(command==='drive about get') console.log(JSON.stringify({user:{permissionId:fs.readFileSync(path.join(config,'identity'),'utf8')}})); else if(command==='drive drives list') console.log(JSON.stringify({drives:[{id:'fixture-drive',name:'Work'}]})); else if(command==='drive files list') console.log(JSON.stringify({files:[{id:'fixture-reports',name:'Reports'},{id:'fixture-scrum',name:'Scrum'}]})); else if(args.slice(0,2).join(' ')==='gmail +send') console.log(JSON.stringify({id:'fixture-message'})); else {console.log(JSON.stringify({error:'unexpected operation'}));process.exitCode=9;}\n`, 0o755); chmodSync(executable, 0o755);
  const env = { ...process.env, HOME: root, USERPROFILE: root, PATH: bin, FIXTURE_GWS_LOG: log };
  const run = (...args: string[]) => spawnSync(process.execPath, [fileURLToPath(new URL('../runtime/profiles.js', import.meta.url)), '--state-root', state, ...args], { env, encoding: 'utf8', timeout: 20000 });
  const privateJson = (name: string, data: unknown) => write(join(root, name), JSON.stringify(data));
  const configure = () => {
    const discovery = run('discover', '--config-dir', config); assert.equal(discovery.status, 0, discovery.stderr); const data = JSON.parse(discovery.stdout); assert.equal(existsSync(state), false);
    const workspace = privateJson('workspace.json', Object.fromEntries(['schemaVersion', 'configDir', 'account', 'source', 'checkedAt'].map(key => [key, data[key]]))), reporting = privateJson('reporting.json', { schemaVersion: 1, subjectName: 'Example User', mailTo: 'recipient@example.invalid' });
    const saved = run('save', 'work', '--workspace', workspace, '--reporting', reporting, '--expected-revision', '0', '--default'); assert.equal(saved.status, 0, saved.stderr); const loaded = run('load'); assert.equal(loaded.status, 0, loaded.stderr); return privateJson('snapshot.json', JSON.parse(loaded.stdout));
  };
  const events = () => readFileSync(log, 'utf8').trim().split('\n').map(row => JSON.parse(row));
  return { root, config, run, configure, events };
}
test('onboarding: discovery/save never send or modify remote resources', { skip: process.platform === 'win32' }, t => { const f = fixture(t); f.configure(); const events = f.events(); assert.ok(events.length); assert.ok(events.every(row => row.argv[0] === 'drive' && ['get', 'list'].includes(row.argv[2]))); assert.ok(events.every(row => row.config === f.config)); const inspection = f.run('inspect'); assert.equal(inspection.status, 0); assert.deepEqual(f.events(), events); assert.deepEqual(JSON.parse(inspection.stdout).profiles[0].missing.reportUpload, ['reportFolderId']); });
test('onboarding: account changes block the real send entrypoint before fake transport', { skip: process.platform === 'win32' }, t => { const f = fixture(t), snapshot = f.configure(), body = write(join(f.root, 'body.txt'), 'Explicit synthetic draft'); writeFileSync(join(f.config, 'identity'), 'fixture-account-b'); const refused = f.run('send-mail', '--snapshot', snapshot, '--subject', 'Fixture', '--body-file', body); assert.notEqual(refused.status, 0); assert.equal(f.events().some(row => row.argv[0] === 'gmail'), false); writeFileSync(join(f.config, 'identity'), 'fixture-account-a'); const sent = f.run('send-mail', '--snapshot', snapshot, '--subject', 'Fixture', '--body-file', body); assert.equal(sent.status, 0, sent.stderr); assert.equal(JSON.parse(sent.stdout).messageId, 'fixture-message'); const sends = f.events().filter(row => row.argv[0] === 'gmail'); assert.equal(sends.length, 1); assert.ok(sends[0].argv.includes('recipient@example.invalid')); });
test('onboarding: public instructions preserve scope and task initialization', () => {
  const guide = readFileSync(join(ROOT, 'runtime/ONBOARDING.md'), 'utf8'), capture = readFileSync(join(ROOT, 'runtime/SKILL-STORAGE.md'), 'utf8');
  for (const marker of ['Read', 'candidates', 'unset', 'existing', 'revision', 'verify-account', '~/.jstack/profiles/<name>/']) assert.ok(guide.includes(marker), marker);
  assert.ok(guide.indexOf('profiles.js\" inspect') < guide.indexOf('profiles.js\" discover')); assert.ok(guide.indexOf('profiles.js\" discover') < guide.indexOf(' save <profile>'));
  for (const marker of ['project/global', 'answer', 'Default local project storage', 'relative symlink', 'Never untrack automatically', 'without stage, commit, or\npush']) assert.ok(capture.includes(marker), marker);
  const commands = existsSync(join(ROOT, 'hosts/claude/commands')) ? 'hosts/claude/commands' : 'commands', init = readFileSync(join(ROOT, commands, 'init.md'), 'utf8'); assert.match(init.replaceAll('skills/verify/scripts/', ''), /workflow\.(?:py|js) init/); assert.match(init, /separate/); assert.match(init, /remote writes or mail delivery/);
});
