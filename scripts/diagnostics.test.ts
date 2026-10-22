import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { doctorDev, type Runner } from './doctor-dev.js';
import { doctorWork } from './doctor-work.js';
import { inspect } from './inspect.js';
const missing: Runner = () => ({status: 1, stdout: ''});
test('development inventory distinguishes unauthenticated gh and does not require Python', () => {
  const calls: string[] = [];
  const result = doctorDev((command, args) => { calls.push(command); return {status: command === 'gh' && args[0] === 'auth' ? 1 : 0, stdout: command === 'node' ? 'v20.0.0' : ''}; });
  assert.equal(result.code, 1); assert.match(result.lines.join('\n'), /unauthenticated/); assert.ok(!calls.includes('python3'));
  assert.equal(doctorDev(missing).code, 2);
});
test('development inventory reports a missing jstack CLI instead of hiding it', () => {
  const present = doctorDev(command => ({status: 0, stdout: command === 'node' ? 'v20.0.0' : ''}));
  assert.equal(present.code, 0); assert.deepEqual(present.lines, ['[0] all required and optional tools are available']);
  const absent = doctorDev(command => ({status: command === 'jst' ? 1 : 0, stdout: command === 'node' ? 'v20.0.0' : ''}));
  assert.equal(absent.code, 1);
  assert.match(absent.lines.join('\n'), /^\[1\] jst missing/m); assert.match(absent.lines.join('\n'), /PATH/); assert.match(absent.lines.join('\n'), /not route around it/);
  for (const remedy of [/restart the session/, /SessionStart hook adds the plugin payload\/bin directory/, /disableAllHooks/, /works on any host whatever the hooks do/, /trust the jstack SessionStart hook in \/hooks/, /~\/\.local\/bin\/jst, which must be on PATH/, /JSTACK_NO_PATH_LINK=1/, /npm install -g/]) assert.match(absent.lines.join('\n'), remedy);
});
test('feature inventory preserves self-contained research and never installs office', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jstack-doctor-')); t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  for (const skill of ['research', 'office']) { fs.mkdirSync(path.join(root, 'skills', skill, 'scripts'), {recursive: true}); fs.writeFileSync(path.join(root, 'skills', skill, 'SKILL.md'), 'fixture'); }
  for (const script of ['cite_check.js', 'coverage_matrix.js']) fs.writeFileSync(path.join(root, 'skills/research/scripts', script), '');
  const calls: string[][] = [];
  const runner: Runner = (cmd, args) => { calls.push([cmd, ...args]); return {status: cmd === 'python3' ? 0 : 1, stdout: ''}; };
  assert.equal(doctorWork('research', {root, runner}).diagnoses[0]!.status, 'self-contained');
  assert.equal(doctorWork('office', {root, runner}).code, 1);
  assert.ok(calls.every(call => !['npx', 'npm', 'uv', 'pip'].includes(call[0]!)));
  assert.equal(doctorWork('unknown', {root, runner}).code, 1);
});
test('inspect discovers every suite and includes langs; missing suites never pass', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jstack-inspect-')); t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const skill = path.join(root, 'skills/example'); fs.mkdirSync(path.join(skill, 'langs'), {recursive: true}); fs.writeFileSync(path.join(skill, 'langs', 'lang.md'), '');
  assert.equal(inspect('example', root).code, 1); assert.equal(inspect('../outside', root).code, 2);
  fs.mkdirSync(path.join(skill, 'tests')); for (const suite of ['first.js', 'first.py', 'second.js', '_helper.js']) fs.writeFileSync(path.join(skill, 'tests', suite), '');
  const seen: string[] = [];
  const result = inspect('example', root, ((_: string, args: string[]) => { seen.push(path.basename(args[0]!)); return {status: seen.length === 1 ? 1 : 0, stdout: 'fixture', stderr: ''}; }) as any);
  assert.equal(result.code, 1); assert.deepEqual(seen, ['first.js', 'second.js']); assert.match(result.lines.join('\n'), /langs\/ — 1 items/);
});

test('inspect fails closed for Python-only suites without invoking Python', t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'jstack-inspect-no-python-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const dir=path.join(root,'skills/example/tests');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'only.py'),'');let called=false;const result=inspect('example',root,(()=>{called=true;throw new Error('unexpected process');}) as any);assert.equal(result.code,1);assert.equal(called,false);assert.match(result.lines.join('\n'),/compiled checker missing/);
});
