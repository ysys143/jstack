#!/usr/bin/env node
import { isDeepStrictEqual } from 'node:util';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { isMain } from '../runtime/entry.js';
import { buildPackage, checkPackage, BuildError, writeJson } from './build.js';
import { inspectPublic } from './check_public.js';

const json = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
export const MARKETPLACE = 'jstack';
export function registries(marketplace = MARKETPLACE) {
  return {
    '.claude-plugin/marketplace.json': { name: marketplace, owner: { name: 'jstack' }, plugins: [{ name: 'jstack', source: './plugins/jstack' }] },
    '.agents/plugins/marketplace.json': { name: marketplace, interface: { displayName: 'jstack' }, plugins: [{ name: 'jstack', source: { source: 'local', path: './plugins/jstack' }, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity' }] },
  };
}
function allFiles(root: string): string[] {
  const rows: string[] = [];
  function visit(directory: string) {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name), stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw new BuildError('Release contains a symlink');
      if (stat.isDirectory()) visit(path);
      else if (stat.isFile()) rows.push(relative(root, path).split(sep).join('/'));
      else throw new BuildError('Release contains a special file');
    }
  }
  visit(root); return rows.sort();
}
/** Verify registries, exact delivery membership and the canonical receipt. */
export async function checkRelease(directory: string, privateValues: string[] = []) {
  const root = resolve(directory);
  const files = allFiles(root);
  const checked = checkPackage(join(root, 'plugins/jstack'), privateValues);
  const record = json(join(root, 'release.json'));
  let expectedRegistries: ReturnType<typeof registries>;
  const pluginCount = 1;
  const allowed = new Set(['README.md', 'release.json', '.claude-plugin/marketplace.json', '.agents/plugins/marketplace.json']);
  if (record.schemaVersion === 1) {
    expectedRegistries = registries();
    const expected = { schemaVersion: 1, marketplace: MARKETPLACE, name: 'jstack', version: checked.version, sourceSha256: checked.sourceSha256, packageFileCount: checked.files, remotePublished: false };
    if (!isDeepStrictEqual(record, expected)) throw new BuildError('Release record is not bound to the package receipt');
  } else throw new BuildError('Unsupported release record version');
  for (const [path, expected] of Object.entries(expectedRegistries)) if (!isDeepStrictEqual(json(join(root, path)), expected)) throw new BuildError('Marketplace registry differs from the delivery contract');
  for (const path of files) if (!path.startsWith('plugins/jstack/') && !allowed.has(path)) throw new BuildError('Unexpected release file outside the package');
  const report = inspectPublic(root, privateValues); if (!report.passed) throw new BuildError(`Release publication boundary failed: ${JSON.stringify(report)}`);
  return { passed: true, version: checked.version, marketplace: record.marketplace, publicSkills: checked.publicSkills, scannedFiles: report.scannedFiles, pluginCount, sourceSha256: checked.sourceSha256, remotePublished: false, accepted: false };
}
/** Build the single-package marketplace for both hosts. */
export async function createRelease(sourceRoot: string, outputRoot: string, privateValues: string[] = []) {
  const source = realpathSync(sourceRoot), output = resolve(outputRoot);
  let ancestor = dirname(output);
  while (!existsSync(ancestor) && dirname(ancestor) !== ancestor) ancestor = dirname(ancestor);
  const actualOutput = resolve(realpathSync(ancestor), relative(ancestor, output));
  const rel = relative(source, actualOutput);
  if (!rel || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))) throw new BuildError('Release output must be outside source');
  try { lstatSync(output); throw new BuildError('Release output must not exist'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  mkdirSync(dirname(output), { recursive: true });
  const temp = mkdtempSync(join(dirname(output), '.jstack-release-'));
  try {
    const root = join(temp, 'marketplace');
    const built = await buildPackage(source, join(root, 'plugins/jstack'), privateValues);
    for (const [path, value] of Object.entries(registries())) writeJson(join(root, path), value);
    writeFileSync(join(root, 'README.md'), '# jstack local marketplace\n\nA checked local candidate for both hosts. No remote publication has occurred.\n');
    writeJson(join(root, 'release.json'), { schemaVersion: 1, marketplace: MARKETPLACE, name: 'jstack', version: built.version, sourceSha256: built.sourceSha256, packageFileCount: built.files, remotePublished: false });
    const checked = await checkRelease(root, privateValues); renameSync(root, output); return { ...checked, output };
  } finally { rmSync(temp, { recursive: true, force: true }); }
}
export async function main(args = process.argv.slice(2)): Promise<number> {
  const options = new Map<string, string>();
  for (let i = 0; i < args.length; i++) { if (!['--source', '--output', '--check', '--private-values'].includes(args[i]) || !args[i + 1] || options.has(args[i])) throw new BuildError('Usage: release --source DIR --output NEW_DIRECTORY | --check DIRECTORY'); options.set(args[i], args[++i]); }
  if (options.has('--output') === options.has('--check')) throw new BuildError('Choose exactly one of --output or --check');
  const values = options.has('--private-values') ? json(options.get('--private-values')!) : [];
  if (!Array.isArray(values) || values.some(value => typeof value !== 'string')) throw new BuildError('Private comparison must be a list of strings');
  const result = options.has('--check') ? await checkRelease(options.get('--check')!, values) : await createRelease(options.get('--source') ?? process.cwd(), options.get('--output')!, values);
  console.log(JSON.stringify(result, null, 2)); return 0;
}
if (isMain(import.meta.url)) main().then(code => { process.exitCode = code; }).catch(error => { console.error(String(error)); process.exitCode = 2; });
