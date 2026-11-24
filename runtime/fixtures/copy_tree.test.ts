import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyTree } from './copy_tree.js';

test('copyTree copies nested files and empty directories into an existing or new target', t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'jstack-copy-tree-'))); t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, 'source'); mkdirSync(join(source, 'a/b'), { recursive: true }); mkdirSync(join(source, 'empty'));
  writeFileSync(join(source, 'top.txt'), 'top'); writeFileSync(join(source, 'a/b/deep.txt'), 'deep');
  mkdirSync(join(root, 'existing')); copyTree(source, join(root, 'existing')); copyTree(source, join(root, 'new/nested'));
  for (const target of ['existing', 'new/nested']) {
    assert.equal(readFileSync(join(root, target, 'top.txt'), 'utf8'), 'top'); assert.equal(readFileSync(join(root, target, 'a/b/deep.txt'), 'utf8'), 'deep');
    assert.ok(existsSync(join(root, target, 'empty')), `${target} keeps the empty directory`);
  }
});

test('copyTree refuses a link instead of copying or following it', t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'jstack-copy-tree-'))); t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, 'source'); mkdirSync(source); writeFileSync(join(root, 'outside.txt'), 'outside'); symlinkSync(join(root, 'outside.txt'), join(source, 'link'));
  assert.throws(() => copyTree(source, join(root, 'target')), /only files and directories/);
});
