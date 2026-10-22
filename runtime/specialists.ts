#!/usr/bin/env node
/** Explicit, hash-locked Python environments for optional specialist features. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { atomicWrite, checkOwned, privateDir, runProcess, withLock } from './os.js';
import { isMain } from './entry.js';

export interface Specialist { id: string; python: string; lock: string; importCheck: string; targetPlatforms: string[]; sources: string[] }
export interface SpecialistOptions { home?: string; root?: string; uv?: string; runner?: typeof runProcess }
const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export function specialistRoot(moduleUrl = import.meta.url): string {
  for (const url of ['../bundle/jstack/payload/', '../', '../../']) {
    const root = fileURLToPath(new URL(url, moduleUrl));
    const manifest = join(root, 'contracts/ts-migration/specialists.json');
    if (!existsSync(manifest)) continue;
    const features = JSON.parse(readFileSync(manifest, 'utf8')).features as Specialist[];
    // TypeScript copies the imported manifest into dist without its lock files.
    // Select a complete source or installed payload, not that partial copy.
    if (features.length && features.every(feature => existsSync(join(root, feature.lock)))) return root;
  }
  throw new Error('Optional integration manifest is missing');
}
function context(id: string, options: SpecialistOptions) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new Error('Invalid optional feature name');
  const root = resolve(options.root ?? specialistRoot());
  const manifest = JSON.parse(readFileSync(join(root, 'contracts/ts-migration/specialists.json'), 'utf8'));
  const feature = manifest.features.find((row: Specialist) => row.id === id) as Specialist | undefined;
  if (!feature) throw new Error(`Unknown optional feature: ${id}`);
  const platform = process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : process.platform;
  if (!feature.targetPlatforms.includes(platform)) throw new Error(`${id} requires ${feature.targetPlatforms.join(' or ')}; current platform is ${platform}`);
  const lock = resolve(root, feature.lock), rel = relative(root, lock);
  if (isAbsolute(feature.lock) || rel === '..' || rel.startsWith('..' + sep)) throw new Error('Lock file escapes the package');
  const lockBytes = readFileSync(lock), identity = hash(JSON.stringify({ feature: id, python: feature.python, platform: process.platform, architecture: process.arch, lockSha256: hash(lockBytes) }));
  const requestedHome = resolve(options.home ?? homedir());
  let existingHome = requestedHome;
  while (!existsSync(existingHome) && dirname(existingHome) !== existingHome) existingHome = dirname(existingHome);
  const home = resolve(realpathSync(existingHome), relative(existingHome, requestedHome));
  const parent = join(home, '.jstack/environments', id), directory = join(parent, identity);
  const python = join(directory, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  return { root, feature, lock, lockSha256: hash(lockBytes), identity, home, parent, directory, python, receipt: join(directory, 'jstack-environment.json') };
}
export function specialistStatus(id: string, options: SpecialistOptions = {}) {
  const ctx = context(id, options);
  if (!existsSync(ctx.receipt)) return { feature: id, state: 'absent', directory: ctx.directory, python: ctx.python };
  checkOwned(ctx.directory, true); checkOwned(ctx.receipt);
  const receipt = JSON.parse(readFileSync(ctx.receipt, 'utf8'));
  if (receipt.identity !== ctx.identity || receipt.lockSha256 !== ctx.lockSha256 || receipt.feature !== id) throw new Error('Optional environment ownership or lock identity differs');
  return { ...receipt, directory: ctx.directory, python: ctx.python, state: receipt.state === 'ready' && existsSync(ctx.python) ? 'ready' : 'incomplete' };
}
export function setupSpecialist(id: string, options: SpecialistOptions = {}) {
  const ctx = context(id, options), run = options.runner ?? runProcess, uv = options.uv ?? 'uv';
  const previous = specialistStatus(id, options);
  if (previous.state === 'ready') return previous;
  if (existsSync(ctx.directory)) throw new Error('Incomplete or unmanaged optional environment exists; preserve it and inspect before retrying');
  const probe = run(uv, ['--version'], { timeout: 10_000 });
  if (probe.status !== 0 || !probe.stdout?.trim()) throw new Error('uv is unavailable. Install uv before setting up optional Python integrations.');
  for (const path of [join(ctx.home, '.jstack'), join(ctx.home, '.jstack/environments'), ctx.parent]) privateDir(path);
  return withLock(join(ctx.parent, '.setup.lock'), () => {
    if (existsSync(ctx.directory)) throw new Error('Optional environment appeared during setup; inspect before retrying');
    privateDir(ctx.directory);
    const env: NodeJS.ProcessEnv = { ...process.env, UV_CACHE_DIR: join(ctx.home, '.jstack/uv-cache'), UV_PYTHON_INSTALL_DIR: join(ctx.home, '.jstack/python'), UV_NO_CONFIG: '1' };
    for (const key of ['PYTHONPATH', 'PYTHONHOME', 'VIRTUAL_ENV']) delete env[key];
    const receipt: Record<string, unknown> = { schemaVersion: 1, feature: id, identity: ctx.identity, lockSha256: ctx.lockSha256, platform: process.platform, architecture: process.arch, uvVersion: probe.stdout.trim(), state: 'preparing' };
    const save = () => atomicWrite(ctx.receipt, Buffer.from(JSON.stringify(receipt, null, 2) + '\n'));
    save();
    const execute = (command: string, args: string[]) => {
      const result = run(command, args, { cwd: ctx.directory, env, timeout: 600_000, maxBuffer: 8 * 1024 * 1024 });
      if (result.status !== 0) throw new Error(`Optional setup command failed (${result.status ?? result.error?.message}): ${args[0] ?? 'python check'}`);
      return result.stdout.trim();
    };
    try {
      execute(uv, ['venv', '--no-project', '--managed-python', '--python', ctx.feature.python, '--allow-existing', ctx.directory]);
      execute(uv, ['pip', 'install', '--python', ctx.python, '--require-hashes', '--only-binary', ':all:', '--requirements', ctx.lock]);
      receipt.pythonVersion = execute(ctx.python, ['--version']);
      execute(ctx.python, ['-I', '-c', ctx.feature.importCheck]);
      receipt.state = 'ready'; receipt.importsVerified = true; receipt.featureArtifactVerified = false; save();
      return { ...receipt, directory: ctx.directory, python: ctx.python };
    } catch (error) { receipt.state = 'failed'; receipt.failure = String(error); save(); throw error; }
  });
}
export function runSpecialist(id: string, script: string, args: string[], options: SpecialistOptions = {}): number {
  const ctx = context(id, options);
  if (!ctx.feature.sources.includes(script)) throw new Error('Script does not belong to the selected optional feature');
  const path = resolve(ctx.root, script), rel = relative(ctx.root, path);
  if (isAbsolute(script) || rel === '..' || rel.startsWith('..' + sep)) throw new Error('Optional script escapes the package');
  const environment = setupSpecialist(id, options);
  const result = (options.runner ?? runProcess)(environment.python, [path, ...args], { stdio: 'inherit' });
  return result.status ?? 2;
}
export function main(argv = process.argv.slice(2)): number {
  const [command, id, ...rest] = argv;
  if (!command || ['--help', '-h'].includes(command)) { console.log('jst optional setup|status FEATURE [--home DIRECTORY]\njst optional run FEATURE PACKAGE_SCRIPT -- [arguments]'); return 0; }
  if (!id) throw new Error('Optional feature name is required');
  if (command === 'run') { const script = rest.shift(); if (!script) throw new Error('Package script is required'); if (rest[0] === '--') rest.shift(); return runSpecialist(id, script, rest); }
  const options: SpecialistOptions = {};
  if (rest.length) { if (rest.length !== 2 || rest[0] !== '--home') throw new Error('Expected --home DIRECTORY'); options.home = rest[1]; }
  if (!['setup', 'status'].includes(command)) throw new Error('Unknown optional environment command');
  console.log(JSON.stringify(command === 'setup' ? setupSpecialist(id, options) : specialistStatus(id, options), null, 2)); return 0;
}
if (isMain(import.meta.url)) { try { process.exitCode = main(); } catch (error) { console.error(String(error)); process.exitCode = 2; } }
