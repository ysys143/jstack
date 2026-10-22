#!/usr/bin/env node
import { isMain } from '../runtime/entry.js';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { install, update, rollback, uninstall, status, doctor, migrate, recover } from './install.js';
import type { LifecycleOptions } from './install.js';
import type { Host } from './hosts.js';
import { checkPackage } from '../packaging/build.js';
import { downloadBundle, unpackBundle } from './download.js';
import { main as profiles } from '../runtime/profiles.js';
import { main as skills } from '../runtime/skill_store.js';
import { main as route } from '../runtime/route_cli.js';
import { main as task } from '../runtime/task_cli.js';
import { main as review } from '../runtime/review_cycles.js';
import { main as optional } from '../runtime/specialists.js';
import { main as catalog, catalogRoot } from '../runtime/catalog_cli.js';
import { main as disk } from '../skills/public/operations/disk-manager/scripts/main.js';
import { main as report } from '../skills/public/operations/issue-report/scripts/main.js';
import { main as hostAudit } from '../skills/support/host-audit/scripts/main.js';
import { main as initialize } from './init.js';
import { main as projectHooks } from '../runtime/project-hooks/decision_cli.js';
import { main as jev } from '../runtime/jev_cli.js';

export const HELP = `jstack — managed Claude Code and Codex installation (Node 20+)\n\nUsage: jst <command> [options]\n\nCommands: install, update, rollback, uninstall, status, doctor, migrate, recover\n          init [--capture-app-defaults]\n          profiles <action>, skills <action>, optional setup|status|run\n          catalog list|resolve NAME [--host claude|codex]\n          disk context|remember|status|scan|snapshot|diff|history|schedule\n          report status|note|scan|list|dismiss|draft|submit|finish\n          host-audit [--host claude|codex|all] [--package DIR] [--project DIR]\n                     [--verify-docs] [--measure] [--model ID]\n          route plan|run|record|probe\n          task capture|observe|assess|status|resume|run\n          review check|record TASK --input FILE|-\n          project-hooks status|recommend|choose|reopen\n          jev task-size\n\nOptions:\n  --host claude|codex|all   Select hosts (default: all)\n  --scope user            Current-user scope only\n  --version VERSION       Exact version for install/update\n  --from PLUGIN_ID         Existing user-scoped identity for migrate\n  --json                  Machine-readable result\n  --home DIRECTORY        Explicit alternate user home\n  --source DIRECTORY      Checked local bundle (contributor/candidate use)\n\nHost roots: Claude ~/.claude (CLAUDE_CONFIG_DIR), Codex ~/.agents (CODEX_HOME).\n--home uses these defaults under DIRECTORY and ignores host-root environment overrides.\n\nInstalling the npm CLI does not activate plugins. Run jst install explicitly.\nHook trust and host restart requirements are reported separately.\n`;
export class UsageError extends Error {}
export function parseArguments(argv: string[]): { command: string; options: LifecycleOptions } {
  const [command, ...rest] = argv;
  if (!['install', 'update', 'rollback', 'uninstall', 'status', 'doctor', 'migrate', 'recover'].includes(command)) throw new UsageError('Unknown command; run jst --help');
  const values = new Map<string, string>();
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i]; if (flag === '--json') continue;
    if (!['--host', '--scope', '--version', '--from', '--home', '--source'].includes(flag) || values.has(flag) || !rest[i + 1] || rest[i + 1].startsWith('--')) throw new UsageError(`Invalid or repeated option: ${flag}`);
    values.set(flag, rest[++i]);
  }
  if (values.has('--scope') && values.get('--scope') !== 'user') throw new UsageError('Only user scope is supported');
  const host = values.get('--host') ?? 'all';
  if (!['claude', 'codex', 'all'].includes(host)) throw new UsageError('Host must be claude, codex, or all');
  if (values.has('--from') && command !== 'migrate') throw new UsageError('--from is valid only for migrate');
  if (values.has('--version') && !['install', 'update'].includes(command)) throw new UsageError('--version is valid only for install/update');
  if (values.has('--source') && !['install', 'update', 'migrate'].includes(command)) throw new UsageError('--source is valid only for install/update/migrate');
  if (command === 'migrate' && !values.has('--from')) throw new UsageError('migrate requires --from PLUGIN_ID');
  const version = values.get('--version');
  if (version && !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$/.test(version)) throw new UsageError('Version must be an exact semantic version');
  return { command, options: { hosts: host === 'all' ? ['claude', 'codex'] : [host as Host], home: values.get('--home'), sourceRoot: values.get('--source'), version, from: values.get('--from') } };
}
export async function main(argv = process.argv.slice(2)): Promise<number> {
  try {
    if (Number(process.versions.node.split('.')[0]) < 20) throw new UsageError('jstack requires Node 20 or newer');
    if (!argv.length || argv[0] === '--help' || argv[0] === '-h') { process.stdout.write(HELP); return 0; }
    if (argv[0] === '--version') {
      const path = [new URL('../packaging/product.json', import.meta.url), new URL('../../package.json', import.meta.url)].map(url => fileURLToPath(url)).find(existsSync);
      if (!path) throw new UsageError('Product metadata is absent');
      process.stdout.write(JSON.parse(readFileSync(path, 'utf8')).version + '\n'); return 0;
    }
    if (argv[0] === 'route') return route(argv.slice(1));
    // Prepared npm installs carry the complete runtime in a checked archive.
    // Use that runtime for commands needing catalog, protocol and identity assets.
    let root: string | undefined;
    try { root = catalogRoot(); } catch { /* The npm CLI itself has no payload assets. */ }
    const archive = fileURLToPath(new URL('../bundle/jstack.tgz', import.meta.url));
    if (!root && existsSync(archive)) {
      const checked = await unpackBundle(readFileSync(archive), readFileSync(fileURLToPath(new URL('../bundle/jstack.integrity', import.meta.url)), 'utf8'), false);
      try {
        const entry = await import(pathToFileURL(resolve(checked.sourceRoot, 'payload/cli/main.js')).href);
        const args = [...argv];
        if (['install', 'migrate'].includes(args[0]) && !args.includes('--source') && !args.includes('--version')) args.push('--source', checked.sourceRoot);
        return await entry.main(args);
      } finally { checked.dispose(); }
    }
    if (argv[0] === 'init') return initialize(argv.slice(1));
    if (argv[0] === 'disk') return disk(argv.slice(1));
    if (argv[0] === 'report') return report(argv.slice(1));
    if (argv[0] === 'host-audit') return hostAudit(argv.slice(1));
    if (argv[0] === 'task') return task(argv.slice(1));
    if (argv[0] === 'review') return review(argv.slice(1));
    if (argv[0] === 'project-hooks') return projectHooks(argv.slice(1));
    if (argv[0] === 'jev') return jev(argv.slice(1));
    if (argv[0] === 'profiles') return profiles(argv.slice(1));
    if (argv[0] === 'skills') return skills(argv.slice(1));
    if (argv[0] === 'optional') return optional(argv.slice(1));
    if (argv[0] === 'catalog') {
      let root: string | undefined;
      try { root = catalogRoot(); } catch { /* Prepared npm installs carry an opaque checked bundle. */ }
      if (root) return catalog(argv.slice(1), root);
      const bundle = fileURLToPath(new URL('../bundle/jstack.tgz', import.meta.url));
      if (!existsSync(bundle)) throw new UsageError('Bundled skill catalog is absent');
      const unpacked = await unpackBundle(readFileSync(bundle), readFileSync(fileURLToPath(new URL('../bundle/jstack.integrity', import.meta.url)), 'utf8'), false);
      try { return catalog(argv.slice(1), resolve(unpacked.sourceRoot, 'payload')); }
      finally { unpacked.dispose(); }
    }
    const { command, options } = parseArguments(argv);
    let downloaded: Awaited<ReturnType<typeof unpackBundle>> | undefined;
    try {
      if (['install', 'update', 'migrate'].includes(command)) {
        if (!options.sourceRoot && (command === 'update' || options.version)) { downloaded = await downloadBundle(options.version); options.sourceRoot = downloaded.sourceRoot; }
        const bundledArchive = fileURLToPath(new URL('../bundle/jstack.tgz', import.meta.url));
        if (!options.sourceRoot && existsSync(bundledArchive)) {
          downloaded = await unpackBundle(readFileSync(bundledArchive), readFileSync(fileURLToPath(new URL('../bundle/jstack.integrity', import.meta.url)), 'utf8'), false);
          options.sourceRoot = downloaded.sourceRoot;
        }
        options.sourceRoot ??= fileURLToPath(new URL('../bundle/jstack/', import.meta.url));
        if (!existsSync(options.sourceRoot)) throw new UsageError('Bundled release is absent. Use a prepared npm package or --source CHECKED_BUNDLE.');
        checkPackage(options.sourceRoot);
      }
      const actions = { install, update, rollback, uninstall, status, doctor, migrate, recover };
      const result = actions[command as keyof typeof actions](options);
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); return result.ok ? 0 : 1;
    } finally { downloaded?.dispose(); }
  } catch (error) { process.stderr.write(`${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}\n`); return error instanceof UsageError ? 2 : 1; }
}
if (isMain(import.meta.url)) main().then(code => { process.exitCode = code; });
