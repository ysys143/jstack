import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';

test('cached gh fixture is removed when the test process exits without its global after hook', t => {
  const root = mkdtempSync(join(tmpdir(), 'jstack-cleanup-regression-')), home = join(root, 'home');
  mkdirSync(home);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const helper = new URL('../skills/public/operations/issue-report/tests/_report_helpers.js', import.meta.url).href;
  const program = `import fs from 'node:fs';const h=await import(${JSON.stringify(helper)});const bin=h.stubGh(${JSON.stringify(home)},'ok');fs.writeSync(1,JSON.stringify({bin}));process.exit(0);`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', program], {
    encoding: 'utf8', env: { ...process.env, TMPDIR: root, TMP: root, TEMP: root },
  });
  assert.equal(child.status, 0, child.stderr);
  const { bin } = JSON.parse(child.stdout);
  assert.equal(existsSync(dirname(bin)), false, 'a cached executable directory must not outlive its test process');
});

test('a process-owned template directory is removed on exit even without node:test lifecycle hooks', t => {
  const root = mkdtempSync(join(tmpdir(), 'jstack-template-cleanup-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const helper = new URL('../runtime/fixtures/process_tmp.js', import.meta.url).href;
  const program = `import fs from 'node:fs';const h=await import(${JSON.stringify(helper)});const dir=h.processTemporaryDirectory('jstack-sdlc-template-');fs.writeFileSync(dir+'/fixture','owned');fs.writeSync(1,JSON.stringify({dir}));process.exit(0);`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', program], { encoding: 'utf8', env: { ...process.env, TMPDIR: root, TMP: root, TEMP: root } });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(existsSync(JSON.parse(child.stdout).dir), false);
});

test('an explicit temporary root preserves its parent and unrelated files on child exit', t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'jstack-custom-template-')));
  const sentinel = join(root, 'unrelated'); writeFileSync(sentinel, 'keep');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const helper = new URL('../runtime/fixtures/process_tmp.js', import.meta.url).href;
  const program = `const h=await import(${JSON.stringify(helper)});const dir=h.processTemporaryDirectory('owned-',${JSON.stringify(root)});process.stdout.write(JSON.stringify({dir}));`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', program], { encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  const { dir } = JSON.parse(child.stdout);
  assert.equal(dirname(dir), root, 'the caller selects the filesystem for an isolated fixture');
  assert.equal(existsSync(dir), false);
  assert.equal(existsSync(sentinel), true);
  assert.equal(existsSync(root), true);
});
