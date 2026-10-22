#!/usr/bin/env node
import { isMain } from '../runtime/entry.js';
/** Reviewed dual-host package construction; consumer validation needs only Node 20. */
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { inspectPublic, PRIVATE_DIRS } from './check_public.js';
import { prepareNativeAssets } from './prepare-native.js';
import { skillExports, loadCatalog, sourcePath, deliveryPath, type SkillExport } from '../runtime/skill_catalog.js';

export class BuildError extends Error {}
export interface Member { source: string; target: string }
export interface Membership { schemaVersion: 1; files: Member[] }
interface FileDigest { path: string; sha256: string; mode?: number }
export interface PackageReceipt { schemaVersion: 1 | 2; name: string; version: string; publicSkills: string[]; files: FileDigest[]; sourceSha256: string; generatedFiles?: string[]; vendors?: string[]; runtimeSourcePolicy?: 'source-and-compiled'|'compiled-only' }
const COMPONENTS = ['cli', 'skills', 'runtime', 'scripts', 'tests', 'evals', 'contracts', 'packaging'];
const TOP_ASSETS = ['README.md', 'CAPABILITIES.md', 'CHANGELOG.md', 'NOTICE.md', 'LICENSE'];
const HOST_KINDS = ['bin', 'commands', 'agents', 'hooks', 'mods', 'output-styles'];
// Codex reads these hook files through its manifest; Claude discovers hooks/hooks.json itself.
const CODEX_HOOK_FILES = ['hooks/hooks.json', 'hooks/codex-hooks.json'];
// Claude merges a hook file its manifest names with hooks/hooks.json; Codex never reads this one.
const CLAUDE_HOOK_FILE = 'hooks/claude-hooks.json';
// Host-specific hook files whose commands must each run a shipped module.
const HOST_HOOK_FILES: Record<string, string> = { 'hooks/codex-hooks.json': 'Codex', [CLAUDE_HOOK_FILE]: 'Claude' };
// The launcher ships in the payload: claude.ai and Cowork refuse a plugin with a top-level bin/.
const LAUNCHER = 'bin/jst';
const SKIP = new Set([...PRIVATE_DIRS, 'results', '.mypy_cache', 'target', '.DS_Store', '.suite-body-deleted']);
export const RECEIPT = 'package-receipt.json';
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const gitBlob = (value: Buffer) => createHash('sha1').update(`blob ${value.length}\0`).update(value).digest('hex');

/** Carry reviewed reference provenance across deterministic payload transformations. */
export function transformFrozenReference(frozen: string, source: Buffer, payload: Buffer, skillBody: boolean): string {
  if (source.equals(payload) || !frozen.startsWith(`# blob:${gitBlob(source)}\n`)) return frozen;
  const normalized = (value: Buffer) => {
    let text = value.toString('utf8');
    if (skillBody) text = text.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '');
    return text.split(/\r?\n/).map(line => line.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
  };
  // Never refresh a stale or hand-edited answer key as a side effect of building.
  if (frozen.slice(frozen.indexOf('\n') + 1).trimEnd() !== normalized(source)) return frozen;
  return `# blob:${gitBlob(payload)}\n${normalized(payload)}${frozen.endsWith('\n') ? '\n' : ''}`;
}
const posix = (value: string) => value.split(sep).join('/');
const json = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function writeJson(path: string, value: unknown): void { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`); }
export function safeRelative(value: string): string {
  if (typeof value !== 'string' || !value || isAbsolute(value) || value.includes('\\') || value.includes(':') || value.includes('\0') || value.split('/').some(p => !p || p === '.' || p === '..')) throw new BuildError('Manifest paths must be safe relative POSIX paths');
  return value;
}
const inside = (root: string, path: string) => { const rel = relative(root, path); return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`); };

export function validatePortableTargets(rows: Member[]): void {
  const seen = new Set<string>();
  for (const row of rows) {
    const key = safeRelative(row.target).normalize('NFC').toLowerCase();
    if (seen.has(key)) throw new BuildError(`Duplicate or nonportable package target: ${row.target}`);
    seen.add(key);
  }
  for (const row of compiledMembers({ schemaVersion: 1, files: rows })) {
    const target = row.target.replace(/\.ts$/, '.js').normalize('NFC').toLowerCase();
    if (seen.has(target)) throw new BuildError(`Compiled output shadows source member: ${row.target}`);
    seen.add(target);
  }
}

function walkSource(root: string, directory: string, active: string[] = [], excluded = new Set<string>()): string[] {
  const real = realpathSync(directory);
  if (!inside(root, real) || active.includes(real)) throw new BuildError('External or cyclic source link');
  const files: string[] = [];
  for (const name of readdirSync(directory).sort()) {
    const path = join(directory, name);
    if (SKIP.has(name) || /\.py[co]$/.test(name) || excluded.has(posix(relative(root, path)))) continue;
    const info = lstatSync(path);
    if (info.isSymbolicLink() && (isAbsolute(readlinkSync(path)) || !existsSync(path) || !inside(root, realpathSync(path)))) throw new BuildError('Absolute, broken or external source link');
    if (statSync(path).isDirectory()) files.push(...walkSource(root, path, [...active, real], excluded));
    else if (statSync(path).isFile()) files.push(path);
    else throw new BuildError('Unsupported source file type');
  }
  return files;
}

export function discoverMembership(directory: string): Membership {
  const root = realpathSync(directory), excluded = new Set<string>();
  const aliases = join(root, 'packaging/excluded-aliases.json');
  for (const row of existsSync(aliases) ? json(aliases) : []) {
    const alias = join(root, safeRelative(row.source)), canonical = join(root, safeRelative(row.canonical));
    if (!row.reason || !lstatSync(alias).isSymbolicLink() || isAbsolute(readlinkSync(alias)) || !statSync(canonical).isDirectory() || realpathSync(alias) !== realpathSync(canonical) || !inside(root, realpathSync(canonical))) throw new BuildError('Excluded alias no longer matches canonical directory');
    excluded.add(row.source);
  }
  const catalog = existsSync(join(root, 'contracts/skill-catalog.json')) ? loadCatalog(root) : undefined;
  const files: Member[] = [];
  for (const component of COMPONENTS.sort()) {
    if (!existsSync(join(root, component))) continue;
    for (const path of walkSource(root, join(root, component), [], excluded)) {
      const rel = posix(relative(root, path));
      // The membership list is configuration, not a distributable product input.
      if (rel !== 'packaging/package-files.json') files.push({ source: rel, target: deliveryPath(catalog, rel) });
    }
  }
  for (const kind of HOST_KINDS.sort()) {
    const dir = join(root, 'hosts/claude', kind);
    if (existsSync(dir)) for (const path of walkSource(root, dir)) files.push({ source: posix(relative(root, path)), target: `${kind}/${posix(relative(dir, path))}` });
  }
  const codexHooks = join(root, 'hosts/codex/hooks');
  if (existsSync(codexHooks)) for (const path of walkSource(root, codexHooks)) files.push({ source: posix(relative(root, path)), target: `hooks/${posix(relative(codexHooks, path))}` });
  const native = join(root, 'hosts/codex/skills');
  if (existsSync(native)) for (const path of walkSource(root, native).filter(path => basename(path) === 'SKILL.md')) {
    const rel = posix(relative(join(root, 'hosts/codex'), path));
    const target = deliveryPath(catalog, rel).replace(/SKILL\.md$/, 'SKILL.codex.md');
    if (!/^skills\/[a-z0-9-]+\/SKILL\.codex\.md$/.test(target)) throw new BuildError('Unowned Codex body: ' + rel);
    files.push({ source: posix(relative(root, path)), target });
  }
  if (existsSync(join(root, 'packaging/AGENTS.package.md'))) files.push({ source: 'packaging/AGENTS.package.md', target: 'AGENTS.md' });
  for (const asset of TOP_ASSETS) if (existsSync(join(root, asset))) files.push({ source: asset, target: asset });
  for (const [asset, target] of [['package.json', 'packaging/source-package.json'], ['package-lock.json', 'packaging/source-package-lock.json'], ['tsconfig.json', 'packaging/source-tsconfig.json']]) if (existsSync(join(root, asset))) files.push({ source: asset, target });
  return { schemaVersion: 1, files: files.sort((a, b) => a.target < b.target ? -1 : a.target > b.target ? 1 : 0) };
}

export function sourceManifest(root: string): Membership {
  const declared = json(join(root, 'packaging/package-files.json')) as Membership;
  if (declared.schemaVersion !== 1 || !Array.isArray(declared.files) || !declared.files.length) throw new BuildError('Missing or empty package membership');
  const found = discoverMembership(root);
  if (!equal(declared, found)) {
    const keys = (rows: Member[]) => new Set(rows.map(row => `${row.source} -> ${row.target}`));
    const old = keys(declared.files), next = keys(found.files);
    throw new BuildError(`Membership drift; review inventory: ${JSON.stringify({ undeclared: [...next].filter(v => !old.has(v)), missing: [...old].filter(v => !next.has(v)) })}`);
  }
  validatePortableTargets(declared.files);
  for (const member of declared.files) {
    const source = join(root, safeRelative(member.source)), target = safeRelative(member.target);
    if (!inside(root, realpathSync(source)) || !statSync(source).isFile()) throw new BuildError('Missing or escaping member');
    if (target === RECEIPT || target.startsWith('entries/') || ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json', 'package.json'].includes(target)) throw new BuildError('Source shadows generated output');
  }
  return declared;
}

export function publicSkills(root: string): string[] {
  return skillExports(root).map(entry => entry.name);
}
function selectedEntry(root: string, name: string, host: string): string {
  if (host === 'codex') for (const path of [`hosts/codex/skills/${name}/SKILL.md`, `skills/${name}/SKILL.codex.md`]) if (existsSync(sourcePath(root, path))) return sourcePath(root, path);
  return sourcePath(root, `skills/${name}/SKILL.md`);
}
function entryBody(text: string, exported: SkillExport, host: string, support: { body: string; when: string }[] = []): string {
  const { owner: name } = exported;
  const rootPath = Array(2 + exported.path.split('/').length).fill('..').join('/');
  const front = text.match(/^---\n[\s\S]*?\n---\n/);
  if (!front || !new RegExp(`^name: (?:${name}|${exported.name})$`, 'm').test(front[0])) throw new BuildError('Public entry requires matching YAML name');
  if (text.includes('${CLAUDE_PLUGIN_ROOT}')) throw new BuildError(`Shared entry uses Claude-only root notation: ${name}`);
  const note = `\n## Installed root and host boundary\n\nThis is the generated ${host} entry for \`${exported.name}\`. Resolve this SKILL.md\ndirectory's \`${rootPath}\` as the installed package root. Its \`payload/\` is\nJSTACK_PLUGIN_ROOT. Use \`payload/skills/${name}/\` as the source working directory\nfor relative scripts, references and assets. Never use the publisher checkout.\nRun \`node scripts/inspect-root.mjs\` from this entry to inspect installed paths.\nInstalling files does not grant hook trust or prove automatic hook execution;\nconsult CAPABILITIES.md and the current host's hook status.\n\nFor task requests and corrections, apply \`payload/runtime/TASKS.md\` once per session.\nStandalone questions do not create task records.\n\n`;
  const catalogNote = exported.path.includes('/') ? `Resolve previous jstack skill names with \`node \${JSTACK_PLUGIN_ROOT}/runtime/catalog_cli.js resolve NAME --host ${host}\`. Public results identify the native skill; support results identify a body to read only when needed. Do not invoke hidden support as a native skill or load the whole catalog eagerly.\n\n` : '';
  const supportNote = support.length ? 'Conditional support (load only for the stated condition):\n\n' + support.map(row => `- ${row.when} Read \`${row.body}\`.`).join('\n') + '\n\n' : '';
  return front[0].replace(`name: ${name}\n`, `name: ${exported.name}\n`).replace(/\n---\n$/, exported.invocation === 'explicit' && host === 'claude' && !front[0].includes('disable-model-invocation:') ? '\ndisable-model-invocation: true\n---\n' : '\n---\n') + note + catalogNote + supportNote + text.slice(front[0].length);
}
/** Hook files a Codex manifest must name: an explicit list replaces default hooks/hooks.json discovery. */
export function codexHookFiles(membership: Membership): string[] {
  const present = CODEX_HOOK_FILES.filter(path => membership.files.some(row => row.target === path));
  return present.includes('hooks/codex-hooks.json') ? present : [];
}
export function manifests(product: any, exports?: SkillExport[], hookFiles: string[] = [], claudeHooks = false): Record<'claude' | 'codex', any> {
  if (product.name !== 'jstack' || !product.version || !product.description || !product.author) throw new BuildError('Invalid product identity');
  if (product.skillCatalog && !exports) throw new BuildError('Catalog exports are required for host manifests');
  const common = { name: product.name, version: product.version, description: product.description, author: product.author };
  return {
    claude: { ...common, skills: product.skillCatalog ? exports!.map(entry => './entries/claude/' + entry.path) : ['./entries/claude'], commands: ['./hosts/claude/commands'], ...(claudeHooks ? { hooks: `./${CLAUDE_HOOK_FILE}` } : {}), experimental: { evals: 'payload/evals' } },
    codex: { ...common, skills: './entries/codex', ...(hookFiles.length ? { hooks: hookFiles.map(path => `./${path}`) } : {}), interface: { displayName: 'jstack', shortDescription: product.description.slice(0, 100), longDescription: product.description, developerName: product.author.name, category: 'Productivity', capabilities: ['Read', 'Write'], defaultPrompt: ['Perform the current task according to the jstack procedure.'] } },
  };
}
export function digestFiles(root: string, version = 2): FileDigest[] {
  const rows: FileDigest[] = [];
  function walk(dir: string) {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name), stat = lstatSync(path), rel = posix(relative(root, path));
      if (stat.isSymbolicLink()) throw new BuildError('Package contains a symlink');
      if (stat.isDirectory()) walk(path);
      else if (stat.isFile() && rel !== RECEIPT) rows.push(version === 1 ? { path: rel, mode: stat.mode & 0o7777, sha256: sha(readFileSync(path)) } : { path: rel, sha256: sha(readFileSync(path)) });
      else if (!stat.isFile()) throw new BuildError('Package contains a special file');
    }
  }
  walk(root);
  return rows.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
function exposed(target: string): boolean { return ['commands', 'agents', 'output-styles'].includes(target.split('/')[0]) || CODEX_HOOK_FILES.includes(target) || target === CLAUDE_HOOK_FILE || [...TOP_ASSETS, 'AGENTS.md'].includes(target); }
/** Canonical authoring paths in documents become reviewed installed addresses. */
export function runtimeSkillReferences(text: string, membership: Membership): string {
  const targets = new Map(membership.files.map(row => [row.source, row.target]));
  return text.replace(/https?:\/\/[^\s"'<>`]+|(?<![\w./-])skills\/(?:public\/[a-z-]+|support)\/[\w./-]+/g, ref => targets.get(ref) ?? ref);
}
function runtimeText(text: string, target: string, membership: Membership, member: (target: string) => string | undefined = () => undefined): string {
  const compiled = new Set(compiledMembers(membership).map(row => row.target.replace(/\.ts$/, '.js')));
  if (target === 'hooks/hooks.json') {
    const value = JSON.parse(text);
    // Codex reads this file too and has no function-hook modules.
    if ('modules' in value) throw new BuildError('hooks/hooks.json is shared with Codex; declare modules in hooks/claude-hooks.json');
    for (const groups of Object.values(value.hooks ?? {}) as any[]) for (const group of groups) for (const hook of group.hooks ?? []) {
      if (typeof hook.command !== 'string') continue;
      const match = hook.command.match(/^(?:python3|bash)\s+"\$\{CLAUDE_PLUGIN_ROOT\}\/([^"\n]+)"(.*)$/);
      if (!match) continue;
      const path = match[1].replace(/\.(?:py|sh)$/, '.js');
      if (compiled.has(path)) hook.command = `node "\${CLAUDE_PLUGIN_ROOT}/${path}"${match[2]}`;
      else throw new BuildError(`Registered core hook is not ported: ${match[1]}`);
    }
    return JSON.stringify(value, null, 2) + '\n';
  }
  if (target in HOST_HOOK_FILES) {
    // The host runs these commands as written once it substitutes the plugin root. Only
    // ${CLAUDE_PLUGIN_ROOT} is rewritten to the payload, so another variable would point at nothing.
    const shipped = new Set([...compiled, ...runtimeMembers(membership).map(row => row.target)]);
    for (const groups of Object.values(JSON.parse(text).hooks ?? {}) as any[]) for (const group of groups) for (const hook of group.hooks ?? []) {
      const match = typeof hook.command === 'string' ? /^node "\$\{CLAUDE_PLUGIN_ROOT\}\/([^"\n]+)"$/.exec(hook.command) : null;
      if (!match || !shipped.has(match[1])) throw new BuildError(`Registered ${HOST_HOOK_FILES[target]} hook does not run a shipped module: ${hook.command}`);
    }
    // Function-hook modules resolve from the package-root hooks/ directory into an uncompiled mod.
    const modules = JSON.parse(text).modules;
    if (modules !== undefined) {
      if (target !== CLAUDE_HOOK_FILE) throw new BuildError(`Only the Claude hook file may declare function-hook modules: ${target}`);
      // Claude Code refuses a second hooks module in one plugin.
      if (!Array.isArray(modules) || modules.length !== 1) throw new BuildError('Claude Code loads one hooks module per plugin; hooks/claude-hooks.json must name exactly one');
      const module = modules[0];
      const path = typeof module === 'string' ? /^\.\.\/payload\/(mods\/[a-z0-9-]+)\/hooks\/([^/]+\.tsx?)$/.exec(module) : null;
      if (!path || !shipped.has(`${path[1]}/hooks/${path[2]}`)) throw new BuildError(`Claude hook module is not a shipped mod file: ${module}`);
      // Only the entry point the mod itself declares, so claude plugin test exercises what jstack loads.
      let own: unknown;
      try { own = JSON.parse(member(`${path[1]}/hooks/hooks.json`) ?? 'null')?.modules; } catch { own = undefined; }
      if (!Array.isArray(own) || !own.includes(`./${path[2]}`)) throw new BuildError(`Claude hook module is not the entry point its mod declares in hooks/hooks.json: ${module}`);
    }
    return text;
  }
  if (target === 'hooks/CONTRACT.md') {
    for (const path of compiled) text = text.replaceAll(path.split('/').at(-1)!.replace(/\.js$/, '.py'), path.split('/').at(-1)!).replaceAll(path.split('/').at(-1)!.replace(/\.js$/, '.sh'), path.split('/').at(-1)!);
  }
  return text;
}
function compiledMembers(membership: Membership): Member[] { return membership.files.filter(row => /\.ts$/.test(row.source) && !row.source.endsWith('.d.ts') && (!row.target.startsWith('skills/dashboard/') || row.target.startsWith('skills/dashboard/tests/')) && !row.source.includes('/repos/') && !/^mods\/[^/]+\//.test(row.target)); }
function runtimeMembers(membership: Membership): Member[] {
  const compiled=new Set(compiledMembers(membership).map(row=>row.target));
  const nativeJavaScript=new Set(membership.files.filter(row=>row.source.endsWith('.js')&&!row.source.includes('/repos/')).map(row=>row.target));
  return membership.files.filter(row=>!compiled.has(row.target)&&!(/\.(?:py|sh)$/.test(row.target)&&(compiled.has(row.target.replace(/\.(?:py|sh)$/,'.ts'))||nativeJavaScript.has(row.target.replace(/\.(?:py|sh)$/,'.js')))));
}
const VENDORS = ['tar', 'yaml', 'fflate', '@xmldom/xmldom', 'typescript', 'smol-toml'] as const;
function generatedSurface(membership: Membership, exports: SkillExport[], version: number, nativeKeys: string[] = [], vendors: readonly string[] = VENDORS, runtimeSourcePolicy='source-and-compiled'): Set<string> {
  const surface = new Set(['.claude-plugin/plugin.json', '.codex-plugin/plugin.json', 'payload/packaging/package-files.json', 'payload/.claude-plugin/plugin.json']);
  if (version === 2) {
    surface.add('package.json'); surface.add('payload/package.json');
    if (membership.files.some(row => row.source.endsWith('/validation-hook-template/validate_template.ts'))) { surface.add('payload/skills/author/references/templates/validation-hook-template/toml.mjs'); surface.add('payload/skills/author/references/templates/validation-hook-template/toml.LICENSE'); }
    for (const row of compiledMembers(membership)) surface.add(`payload/${row.target.replace(/\.ts$/, '.js')}`);
    for (const vendor of vendors) { surface.add(`payload/runtime/vendor/${vendor}.mjs`); surface.add(`payload/runtime/vendor/${vendor}.LICENSE`); }
    if (nativeKeys.length) for (const file of [...nativeKeys.map(key => `${key}.tar.gz`), 'manifest.json', 'LICENSE', 'UPSTREAM.json']) surface.add(`payload/native/sqlite3/${safeRelative(file)}`);
  }
  for (const row of version === 2 && runtimeSourcePolicy==='compiled-only' ? runtimeMembers(membership) : membership.files) {
    surface.add(`payload/${safeRelative(row.target)}`);
    if (exposed(row.target)) surface.add(`${row.target.startsWith('commands/') ? 'hosts/claude/' : ''}${row.target}`);
  }
  for (const host of ['claude', 'codex']) for (const entry of exports) {
    surface.add(`entries/${host}/${entry.path}/SKILL.md`);
    if (host === 'codex' && entry.invocation === 'explicit') surface.add(`entries/${host}/${entry.path}/agents/openai.yaml`);
    surface.add(`entries/${host}/${entry.path}/scripts/inspect-root.${version === 1 ? 'py' : 'mjs'}`);
  }
  return surface;
}

/** v1 mode-sensitive receipts remain readable; v2 compares portable names/bytes. */
export function checkPackage(directory: string, privateValues: string[] = []) {
  const root = realpathSync(directory), receipt = json(join(root, RECEIPT)) as PackageReceipt;
  if (![1, 2].includes(receipt.schemaVersion) || !receipt.files?.length || !receipt.publicSkills?.length || receipt.publicSkills.some(name => !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name))) throw new BuildError('Invalid or empty package receipt');
  const membership = json(join(root, 'payload/packaging/package-files.json')) as Membership;
  if (membership.schemaVersion !== 1 || !membership.files?.length) throw new BuildError('Package membership missing');
  const nativeManifest = join(root, 'payload/packaging/native-dependencies.json');
  const nativeKeys = receipt.schemaVersion === 2 && existsSync(nativeManifest) ? json(nativeManifest).assets.map((asset: any) => asset.key) : [];
  const vendors = receipt.vendors ?? ['tar', 'yaml', 'fflate', '@xmldom/xmldom', 'typescript'];
  if (!Array.isArray(vendors) || !vendors.length || new Set(vendors).size !== vendors.length || vendors.some(name => !VENDORS.includes(name as typeof VENDORS[number]))) throw new BuildError('Invalid vendor delivery manifest');
  if(receipt.runtimeSourcePolicy!==undefined&&!['source-and-compiled','compiled-only'].includes(receipt.runtimeSourcePolicy))throw new BuildError('Invalid runtime source policy');
  const exports = skillExports(join(root, 'payload'));
  if (!equal(exports.map(entry => entry.name), receipt.publicSkills)) throw new BuildError('Receipt public skills differ from catalog');
  const rows = digestFiles(root, receipt.schemaVersion), declared = generatedSurface(membership, exports, receipt.schemaVersion, nativeKeys, vendors,receipt.runtimeSourcePolicy);
  if (existsSync(join(root, 'bin'))) throw new BuildError('Package root has a top-level bin/ directory, which claude.ai and Cowork refuse to install; ship executables under payload/');
  // Both hosts' PATH hooks point at the launcher, so a launcher its owner cannot execute is no command.
  // Only the owner bit counts: npm bundles unpack under the user's umask. Windows reports no execute bits, so a
  // package checked there skips the mode, and one built there carries no execute bit and fails this check on POSIX.
  const launcher = join(root, 'payload', LAUNCHER);
  if (membership.files.some(row => row.target === LAUNCHER) && (!existsSync(launcher) || (process.platform !== 'win32' && (statSync(launcher).mode & 0o100) === 0))) throw new BuildError(`Package launcher payload/${LAUNCHER} is missing or not executable`);
  if (rows.length !== declared.size || rows.some(row => !declared.has(row.path))) throw new BuildError('Package publication surface differs from declared membership');
  if (!equal(rows, receipt.files)) throw new BuildError('Package bytes or modes differ from receipt');
  const product = json(join(root, 'payload/packaging/product.json')), expected = manifests(product, exports, codexHookFiles(membership), membership.files.some(row => row.target === CLAUDE_HOOK_FILE));
  if (receipt.name !== product.name || receipt.version !== product.version || !/^[0-9a-f]{64}$/.test(receipt.sourceSha256)) throw new BuildError('Receipt product/source identity mismatch');
  if (existsSync(join(root, 'skills')) || existsSync(join(root, 'commands')) || !existsSync(join(root, 'hosts/claude/commands'))) throw new BuildError('Unsafe or missing implicit discovery surface');
  for (const host of ['claude', 'codex'] as const) {
    if (!equal(json(join(root, `.${host}-plugin/plugin.json`)), expected[host])) throw new BuildError('Host manifest mismatch');
    const actual = walkSource(root, join(root, 'entries', host)).filter(path => basename(path) === 'SKILL.md').map(path => posix(relative(join(root, 'entries', host), dirname(path)))).sort();
    if (!equal(actual, exports.map(entry => entry.path).sort())) throw new BuildError('Unexpected skill discovery surface');
    for (const entry of exports) {
      if (!existsSync(join(root, 'payload/skills', entry.owner, 'SKILL.md'))) throw new BuildError('Missing canonical dependency');
      if (entry.invocation === 'explicit') {
        const directory = join(root, 'entries', host, entry.path);
        const front = host === 'claude' ? /^---\n([\s\S]*?)\n---\n/.exec(readFileSync(join(directory, 'SKILL.md'), 'utf8'))?.[1] : undefined;
        const flags = front?.split('\n').filter(line => line.startsWith('disable-model-invocation:')) ?? [];
        if (host === 'claude' ? flags.length !== 1 || flags[0] !== 'disable-model-invocation: true' : readFileSync(join(directory, 'agents/openai.yaml'), 'utf8') !== 'policy:\n  allow_implicit_invocation: false\n') throw new BuildError('Explicit invocation policy differs');
      }
    }
  }
  const privacy = inspectPublic(root, privateValues);
  if (!privacy.passed) throw new BuildError(`Publication boundary failed: ${JSON.stringify(privacy)}`);
  return { passed: true, version: product.version as string, publicSkills: receipt.publicSkills.length, files: rows.length, sourceSha256: receipt.sourceSha256, privacy };
}

export async function buildPackage(directory: string, destination: string, privateValues: string[] = []) {
  const source = realpathSync(directory), output = resolve(destination);
  if (existsSync(output)) throw new BuildError('Output must not exist');
  if (inside(source, output)) throw new BuildError('Output must be outside source root');
  const membership = sourceManifest(source), product = json(join(source, 'packaging/product.json')), exports = skillExports(source), skills = exports.map(entry => entry.name);
  const catalog = loadCatalog(source);
  const inputs = [...new Set([...membership.files.map(row => row.source), 'packaging/package-files.json', ...['claude', 'codex'].flatMap(host => exports.map(entry => posix(relative(source, selectedEntry(source, entry.owner, host)))))])].sort();
  const before = inputs.map(path => [path, sha(readFileSync(join(source, path)))]);
  mkdirSync(dirname(output), { recursive: true });
  const temp = mkdtempSync(join(dirname(output), '.jstack-build-')), root = join(temp, 'jstack');
  try {
    mkdirSync(join(root, 'hosts/claude/commands'), { recursive: true });
    for (const row of runtimeMembers(membership)) {
      const target = join(root, 'payload', row.target);
      mkdirSync(dirname(target), { recursive: true }); copyFileSync(join(source, row.source), target); chmodSync(target, statSync(join(source, row.source)).mode & 0o777);
      if (row.source.endsWith('.md') && !row.source.includes('/repos/')) writeFileSync(target, runtimeSkillReferences(readFileSync(target, 'utf8'), membership));
      const owner = catalog?.entries.find(entry => row.target === `skills/${entry.owner}/SKILL.md` || row.target === `skills/${entry.owner}/SKILL.codex.md`);
      if (owner) writeFileSync(target, readFileSync(target, 'utf8').replace(new RegExp(`^name: ${owner.name}$`, 'm'), `name: ${owner.owner}`));
      if (['hooks/hooks.json', 'hooks/CONTRACT.md', ...Object.keys(HOST_HOOK_FILES)].includes(row.target)) {
        const member = (wanted: string) => { const found = membership.files.find(file => file.target === wanted); return found ? readFileSync(join(source, found.source), 'utf8') : undefined; };
        writeFileSync(target, runtimeText(readFileSync(target, 'utf8'), row.target, membership, member));
      }
      if (exposed(row.target)) {
        const exposedPath = join(root, row.target.startsWith('commands/') ? 'hosts/claude' : '', row.target);
        mkdirSync(dirname(exposedPath), { recursive: true });
        if (['commands', 'agents', 'hooks'].includes(row.target.split('/')[0])) writeFileSync(exposedPath, readFileSync(target, 'utf8').replaceAll('${CLAUDE_PLUGIN_ROOT}', '${CLAUDE_PLUGIN_ROOT}/payload'));
        else copyFileSync(target, exposedPath);
        chmodSync(exposedPath, statSync(target).mode & 0o777);
      }
    }
    const documents = new Map(runtimeMembers(membership).filter(row => row.source.endsWith('.md')).map(row => [gitBlob(readFileSync(join(source, row.source))), row]));
    for (const row of runtimeMembers(membership).filter(row => row.source.endsWith('.lines'))) {
      const path = join(root, 'payload', row.target), frozen = readFileSync(path, 'utf8');
      const document = documents.get(/^# blob:([0-9a-f]{40})\n/.exec(frozen)?.[1] ?? '');
      if (document) writeFileSync(path, transformFrozenReference(frozen, readFileSync(join(source, document.source)), readFileSync(join(root, 'payload', document.target)), document.target.endsWith('/SKILL.md')));
    }
    // Compiler is a contributor-only dependency, loaded only during construction.
    const emitted = compiledMembers(membership);
    const imported = await import('typescript'); const ts = imported.default ?? imported;
    const sourceTargets = new Map(membership.files.map(row => [row.source, row.target]));
    function specifier(value: string, row: Member): string {
      let target: string | undefined;
      if (value === 'smol-toml' && row.source.includes('/templates/validation-hook-template/')) return './toml.mjs';
      if (VENDORS.some(name => name === value)) target = `runtime/vendor/${value}.mjs`;
      else if (value.startsWith('.')) {
        const referenced = posix(relative(source, resolve(source, dirname(row.source), value)));
        const direct = sourceTargets.get(referenced), typed = sourceTargets.get(referenced.replace(/\.js$/, '.ts'));
        target = direct ?? typed?.replace(/\.ts$/, '.js');
      }
      if (!target) return value;
      const rel = posix(relative(dirname(row.target), target)); return rel.startsWith('.') ? rel : `./${rel}`;
    }
    if (emitted.length) {
      for (const row of emitted) {
        const transform: import('typescript').TransformerFactory<import('typescript').SourceFile> = context => file => {
          const visit: import('typescript').Visitor = node => {
            if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) return context.factory.updateImportDeclaration(node, node.modifiers, node.importClause, context.factory.createStringLiteral(specifier(node.moduleSpecifier.text, row)), node.attributes);
            if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) return context.factory.updateExportDeclaration(node, node.modifiers, node.isTypeOnly, node.exportClause, context.factory.createStringLiteral(specifier(node.moduleSpecifier.text, row)), node.attributes);
            if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) return context.factory.updateCallExpression(node, node.expression, node.typeArguments, [context.factory.createStringLiteral(specifier(node.arguments[0].text, row))]);
            if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'URL' && node.arguments?.length === 2 && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text.startsWith('.') && node.arguments[1].getText() === 'import.meta.url') {
              const referenced = posix(relative(source, resolve(source, dirname(row.source), node.arguments[0].text)));
              if (!referenced.startsWith('../')) {
                const target = deliveryPath(catalog, referenced);
                let rel = posix(relative(dirname(row.target), target));
                if (!rel.startsWith('.')) rel = './' + rel;
                if (node.arguments[0].text.endsWith('/') && !rel.endsWith('/')) rel += '/';
                return context.factory.updateNewExpression(node, node.expression, node.typeArguments, [context.factory.createStringLiteral(rel), node.arguments[1]]);
              }
            }
            return ts.visitEachChild(node, visit, context);
          };
          return ts.visitNode(file, visit) as import('typescript').SourceFile;
        };
        const result = ts.transpileModule(readFileSync(join(source, row.source), 'utf8'), { fileName: row.source, reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, declaration: false }, transformers: { before: [transform] } });
        if (result.diagnostics?.some(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)) throw new BuildError(`TypeScript syntax errors in ${row.source}; run the contributor typecheck`);
        const compiledPath=join(root,'payload',row.target.replace(/\.ts$/,'.js'));mkdirSync(dirname(compiledPath),{recursive:true});writeFileSync(compiledPath,result.outputText);
      }
    }
    // Bundle only third-party libraries; keep owned modules separate so their
    // import.meta.url entry guards and relative resource paths retain meaning.
    const esbuild = await import('esbuild');
    const vendorRoot = join(root, 'payload/runtime/vendor'); mkdirSync(vendorRoot, { recursive: true });
    for (const vendor of VENDORS) {
      const vendorExports = Object.keys(createRequire(import.meta.url)(vendor)).filter(name => name !== 'default' && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name));
      const vendorEntry = `import * as value from ${JSON.stringify(vendor)};${vendorExports.map(name => `export const ${name} = value.${name};`).join('\n')}${vendor === 'typescript' ? `export default value.default ?? value;` : ''}`;
      const built = await esbuild.build({ stdin: { contents: vendorEntry, resolveDir: dirname(createRequire(import.meta.url).resolve(vendor)) }, bundle: true, platform: 'node', target: 'node20', format: 'esm', outfile: join(vendorRoot, `${vendor}.mjs`), banner: { js: "import { createRequire as __jstackCreateRequire } from 'node:module'; import { fileURLToPath as __jstackFileURLToPath } from 'node:url'; import { dirname as __jstackDirname } from 'node:path'; const require = __jstackCreateRequire(import.meta.url); const __filename = __jstackFileURLToPath(import.meta.url); const __dirname = __jstackDirname(__filename);" }, metafile: true, logLevel: 'silent' });
      const dependencyRoots = new Set<string>();
      for (const input of Object.keys(built.metafile!.inputs).filter(path => !path.startsWith('<'))) {
        let current = dirname(resolve(input));
        while (dirname(current) !== current) {
          const manifest = join(current, 'package.json');
          if (existsSync(manifest) && json(manifest).name) { dependencyRoots.add(current); break; }
          current = dirname(current);
        }
      }
      if (!dependencyRoots.size) throw new BuildError(`Missing vendor provenance: ${vendor}`);
      const licenses = [...dependencyRoots].sort().map(packageRoot => {
        const metadata = json(join(packageRoot, 'package.json'));
        const license = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENSE-MIT', 'license'].map(name => join(packageRoot, name)).find(existsSync);
        if (!license) throw new BuildError(`Missing vendor license: ${metadata.name}`);
        const notices = ['NOTICE', 'NOTICE.md', 'ThirdPartyNoticeText.txt', 'THIRD_PARTY_NOTICES.txt'].map(name => join(packageRoot, name)).filter(existsSync).map(path => readFileSync(path, 'utf8'));
        return `${metadata.name}@${metadata.version}\n\n${[readFileSync(license, 'utf8'), ...notices].join('\n\n')}`;
      });
      writeFileSync(join(vendorRoot, `${vendor}.LICENSE`), licenses.join('\n\n---\n\n'));
      if (vendor === 'smol-toml' && existsSync(join(root, 'payload/skills/author/references/templates/validation-hook-template/validate_template.js'))) { for (const [from, to] of [['smol-toml.mjs','toml.mjs'], ['smol-toml.LICENSE','toml.LICENSE']]) copyFileSync(join(vendorRoot, from), join(root, 'payload/skills/author/references/templates/validation-hook-template', to)); }
    }
    if (existsSync(join(source, 'packaging/native-dependencies.json'))) {
      const prepared = join(source, 'dist/native/sqlite3');
      await prepareNativeAssets({ sourceRoot: source, output: prepared, all: true });
      const nativeRoot = join(root, 'payload/native/sqlite3'); mkdirSync(nativeRoot, { recursive: true });
      for (const name of readdirSync(prepared)) {
        if (!name.endsWith('.tar.gz') && !['manifest.json', 'LICENSE', 'UPSTREAM.json'].includes(name)) continue;
        copyFileSync(join(prepared, name), join(nativeRoot, name));
      }
    }
    writeJson(join(root, 'package.json'), { type: 'module' }); writeJson(join(root, 'payload/package.json'), { type: 'module' });
    writeJson(join(root, 'payload/packaging/package-files.json'), membership);
    writeJson(join(root, 'payload/.claude-plugin/plugin.json'), { ...product, experimental: { evals: 'evals' } });
    for (const [host, manifest] of Object.entries(manifests(product, exports, codexHookFiles(membership), membership.files.some(row => row.target === CLAUDE_HOOK_FILE)))) {
      writeJson(join(root, `.${host}-plugin/plugin.json`), manifest);
      for (const exported of exports) {
        const name = exported.owner;
        const entry = join(root, 'entries', host, exported.path);
        const inspectorRoot = '../'.repeat(3 + exported.path.split('/').length);
        mkdirSync(join(entry, 'scripts'), { recursive: true });
        const support = (catalog?.entries ?? []).filter(row => row.visibility === 'support' && row.usedBy!.includes(name)).map(row => ({
          body: `payload/skills/${row.owner}/${host === 'codex' && selectedEntry(source, row.owner, host) !== sourcePath(source, `skills/${row.owner}/SKILL.md`) ? 'SKILL.codex.md' : 'SKILL.md'}`, when: row.when!,
        }));
        const selected = selectedEntry(source, name, host);
        const canonicalBody = host === 'codex' && selected !== sourcePath(source, `skills/${name}/SKILL.md`) ? 'SKILL.codex.md' : 'SKILL.md';
        const body = exported.aliasFor
          ? `---\nname: ${exported.name}\ndescription: Compatibility entry for explicit jstack:${exported.name} requests. Use jstack:${exported.aliasFor} for new requests.\ndisable-model-invocation: true\n---\n\nRead \`payload/skills/${name}/${canonicalBody}\` under the installed package root and perform the original request with that body. Preserve all arguments and constraints. This compatibility entry has no independent workflow.\n`
          : readFileSync(selected, 'utf8');
        writeFileSync(join(entry, 'SKILL.md'), entryBody(body, exported, host, support));
        if (host === 'codex' && exported.invocation === 'explicit') {
          mkdirSync(join(entry, 'agents'), { recursive: true });
          writeFileSync(join(entry, 'agents/openai.yaml'), 'policy:\n  allow_implicit_invocation: false\n');
        }
        writeFileSync(join(entry, 'scripts/inspect-root.mjs'), `import {fileURLToPath} from 'node:url';\nimport {existsSync} from 'node:fs';\nconst root=fileURLToPath(new URL('${inspectorRoot}',import.meta.url));\nconst canonical=root+'payload/skills/${name}';\nconsole.log(JSON.stringify({host:${JSON.stringify(host)},skill:${JSON.stringify(exported.name)},root,canonical,runtimePresent:existsSync(root+'payload/runtime/profiles.js'),sourcePresent:existsSync(canonical+'/SKILL.md')}));\n`);
      }
    }
    if (!equal(before, inputs.map(path => [path, sha(readFileSync(join(source, path)))]))) throw new BuildError('Source changed during build');
    const receipt: PackageReceipt = { schemaVersion: 2, runtimeSourcePolicy:'compiled-only', name: 'jstack', version: product.version, publicSkills: skills, vendors: [...VENDORS], files: digestFiles(root), sourceSha256: sha(JSON.stringify(before)) };
    writeJson(join(root, RECEIPT), receipt);
    const result = checkPackage(root, privateValues);
    renameSync(root, output);
    return { ...result, output };
  } finally { rmSync(temp, { recursive: true, force: true }); }
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  const option = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const source = option('--source') || process.cwd(), output = option('--output');
  const values = option('--private-values') ? json(resolve(option('--private-values')!)) : [];
  if (command === 'inventory' && output) { const result = discoverMembership(source); writeJson(output, result); console.log(JSON.stringify({ files: result.files.length, reviewRequired: true, output })); }
  else if (command === 'build' && output) console.log(JSON.stringify(await buildPackage(source, output, values), null, 2));
  else if (command === 'check' && args[0]) console.log(JSON.stringify(checkPackage(args[0], values), null, 2));
  else throw new BuildError('Usage: build inventory|build --source DIR --output NEW_DIR_OR_FILE; build check PACKAGE');
}
if (isMain(import.meta.url)) main().catch(error => { console.error(JSON.stringify({ error: String(error) })); process.exitCode = 2; });
