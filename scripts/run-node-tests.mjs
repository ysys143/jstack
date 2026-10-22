#!/usr/bin/env node
// Enumerate test files ourselves: shell globs differ between Node versions and OSes.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { delimiter, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
function discover(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && ['bundle', '.bundle-prepared', 'node_modules', 'native'].includes(entry.name)) return [];
    return entry.isDirectory() ? discover(path) : entry.name.endsWith('.test.js') && existsSync(join(root, relative(resolve(root, 'dist'), path).replace(/\.js$/, '.ts'))) ? [path] : [];
  });
}
const tests = discover(resolve(root, 'dist')).sort();
if (tests.length === 0) {
  console.error('No compiled Node test files found; run npm run build first.');
  process.exit(1);
}
const groupArg = process.argv[2] ?? 'all';
if (!['all', 'fast', 'integration'].includes(groupArg) || process.argv.length > 3) {
  console.error('Usage: node scripts/run-node-tests.mjs [all|fast|integration]');
  process.exit(2);
}
// Integration files exercise complete CLI, package, host, or workflow lifecycles.
// New tests remain in fast by default so no test is silently omitted.
const integrationSources = new Set(JSON.parse(readFileSync(join(root, 'scripts', 'node-test-groups.json'), 'utf8')).integration);
const sourceFor = path => relative(resolve(root, 'dist'), path).replace(/\.js$/, '.ts').split('\\').join('/');
const discoveredSources = new Set(tests.map(sourceFor));
for (const source of integrationSources) if (!discoveredSources.has(source)) {
  console.error(`Integration test is missing: ${source}`);
  process.exit(2);
}
const selected = tests.filter(path => groupArg === 'all' || (integrationSources.has(sourceFor(path)) === (groupArg === 'integration')));
if (!selected.length) {
  console.error(`No ${groupArg} Node tests discovered.`);
  process.exit(2);
}
console.log(`Node ${groupArg} tests: ${selected.length} files (${tests.length} total)`);
const supportAsset = join('skills', 'support', 'runtime-adaptation', 'scripts', 'rules.json');
const sourceAsset = join(root, supportAsset);
const compiledAsset = join(root, 'dist', supportAsset);
if (!existsSync(sourceAsset)) {
  console.error(`Missing local Node test asset: ${sourceAsset}`);
  process.exit(1);
}
mkdirSync(dirname(compiledAsset), { recursive: true });
copyFileSync(sourceAsset, compiledAsset);

// This migration suite temporarily substitutes the shared rules.json. Run it
// after package-identity readers so concurrent test files always see the
// canonical support asset, then let its after hook restore that asset.
const migrationPath = join('dist', 'skills', 'support', 'runtime-adaptation', 'tests', 'bridge_migration.test.js');
const migrationTests = selected.filter(path => relative(root, path) === migrationPath);
const ordinaryTests = selected.filter(path => relative(root, path) !== migrationPath);
const env = { ...process.env, PATH: dirname(process.execPath) + delimiter + process.env.PATH };
let failed = false;
for (const group of [ordinaryTests, migrationTests]) {
  if (group.length === 0) continue;
  const result = spawnSync(process.execPath, ['--test', ...group], { cwd: root, stdio: 'inherit', env });
  if (result.error) console.error(result.error.message);
  if (result.error || result.status !== 0) failed = true;
}
process.exit(failed ? 1 : 0);
