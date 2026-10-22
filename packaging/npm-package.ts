#!/usr/bin/env node
import { isMain } from '../runtime/entry.js';
/** Contributor-only preparation. npm install has no lifecycle side effects. */
import { cpSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPackage, checkPackage } from './build.js';
import { c as archive } from 'tar';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export async function prepareNpmPackage(sourceRoot: string) {
  const source = resolve(sourceRoot), temp = mkdtempSync(join(tmpdir(), 'jstack-npm-prepare-'));
  try {
    const built = await buildPackage(source, join(temp, 'jstack'));
    const target = join(source, 'dist/bundle');
    const prepared = join(source, 'dist/.bundle-prepared');
    if (existsSync(prepared)) throw new Error('Previous bundle preparation is present; inspect it before retrying');
    mkdirSync(prepared);
    try {
      cpSync(join(temp, 'jstack'), join(prepared, 'jstack'), { recursive: true });
      checkPackage(join(prepared, 'jstack'));
      // npm strips .gitignore even inside files-listed trees. Preserve the
      // checked publication surface inside an opaque archive.
      const wrapped = join(temp, 'package/dist/bundle');
      mkdirSync(wrapped, { recursive: true });
      renameSync(join(prepared, 'jstack'), join(wrapped, 'jstack'));
      const packed = join(prepared, 'jstack.tgz');
      await archive({ cwd: temp, file: packed, gzip: true, portable: true }, ['package/dist/bundle/jstack']);
      writeFileSync(join(prepared, 'jstack.integrity'), 'sha512-' + createHash('sha512').update(readFileSync(packed)).digest('base64'));
      if (existsSync(target)) rmSync(target, { recursive: true });
      renameSync(prepared, target);
    } finally { if (existsSync(prepared)) rmSync(prepared, { recursive: true }); }
    return { ...built, output: join(target, 'jstack.tgz'), published: false };
  } finally { rmSync(temp, { recursive: true, force: true }); }
}
if (isMain(import.meta.url)) prepareNpmPackage(resolve(dirname(fileURLToPath(import.meta.url)), '../..')).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(String(error)); process.exitCode = 1; });
