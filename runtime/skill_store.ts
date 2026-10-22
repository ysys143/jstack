import { isMain } from './entry.js';
/** Place a user-owned canonical skill and connect host discovery without staging Git. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { assertCaseUnique, assertNoLinks, atomicWrite, expand, parseFlags, removeTreeSync, runProcess, stat, withLock } from './os.js';

export class PlacementError extends Error {}
export type Scope = 'project' | 'global';
export type DigestVersion = 1 | 2;
export interface PlacementOptions { project?: string; home?: string; claudeHome?: string }
export interface OwnershipRow { scope: Scope; digest: string; digestVersion?: DigestVersion; shared: boolean; relativeTarget: string }
interface OwnershipState { schemaVersion: 1; skills: Record<string, OwnershipRow> }
function git(project: string, args: string[], check = true) {
  const result = runProcess('git', ['-C', project, ...args]);
  if (result.error || (check && result.status !== 0)) throw new PlacementError('Git inspection failed'); return result;
}
function gitPath(project: string, name: string) { const raw = git(project, ['rev-parse', '--git-path', name]).stdout.trim(); return path.resolve(project, raw); }
function codepointCompare(a: string, b: string): number {
  const aa = [...a], bb = [...b]; for (let i = 0; i < Math.min(aa.length, bb.length); i++) { const difference = aa[i]!.codePointAt(0)! - bb[i]!.codePointAt(0)!; if (difference) return difference; } return aa.length - bb.length;
}
function treeFiles(root: string): string[] {
  if (!stat(root)?.isDirectory() || stat(root)?.isSymbolicLink()) throw new PlacementError('skill source must be a real directory');
  const files: string[] = [];
  function walk(directory: string) {
    const keys = new Set<string>();
    for (const name of fs.readdirSync(directory)) {
      const key = name.normalize('NFC').toLowerCase(); if (keys.has(key)) throw new PlacementError('case or Unicode-equivalent skill path collision'); keys.add(key);
      const file = path.join(directory, name); const info = fs.lstatSync(file);
      if (info.isSymbolicLink()) throw new PlacementError('user skill source links require explicit review before placement');
      if (info.isDirectory()) walk(file); else if (info.isFile()) files.push(file); else throw new PlacementError('skill source contains a non-regular file');
    }
  }
  walk(root); return files.sort((a, b) => {
    const aa = path.relative(root, a).split(path.sep), bb = path.relative(root, b).split(path.sep);
    for (let i = 0; i < Math.min(aa.length, bb.length); i++) { const difference = codepointCompare(aa[i]!, bb[i]!); if (difference) return difference; }
    return aa.length - bb.length;
  });
}
export function treeDigest(root: string, version: DigestVersion = 1): string {
  const digest = createHash('sha256');
  if (version === 2) digest.update('jstack-skill-tree-v2\0');
  for (const file of treeFiles(root)) {
    const rel = Buffer.from(path.relative(root, file).split(path.sep).join('/')); const data = fs.readFileSync(file);
    const size = Buffer.alloc(8); size.writeBigUInt64BE(BigInt(rel.length)); digest.update(size); digest.update(rel);
    // v1 preserves historical POSIX evidence. v2 deliberately excludes host-specific modes.
    if (version === 1) { const mode = Buffer.alloc(4); mode.writeUInt32BE(fs.statSync(file).mode & 0o777); digest.update(mode); }
    size.writeBigUInt64BE(BigInt(data.length)); digest.update(size); digest.update(data);
  }
  return digest.digest('hex');
}
export function validateSkill(root: string, name: string, version: DigestVersion = 1): string {
  const file = path.join(root, 'SKILL.md'); if (!stat(file)?.isFile() || stat(file)?.isSymbolicLink()) throw new PlacementError('SKILL.md is required');
  const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n'); const match = /^---\s*\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
  if (!match || !new RegExp(`^name:\\s*['"]?${name}['"]?\\s*$`, 'm').test(match[1]!)) throw new PlacementError('SKILL.md frontmatter name must match the destination');
  if (!/^description:\s*\S/m.test(match[1]!)) throw new PlacementError('SKILL.md description is required'); return treeDigest(root, version);
}
export function verifyOwnershipDigest(root: string, row: OwnershipRow): boolean {
  if (row.digestVersion !== undefined && row.digestVersion !== 1 && row.digestVersion !== 2) throw new PlacementError('unsupported skill digest version');
  return treeDigest(root, row.digestVersion ?? 1) === row.digest;
}
export function ignoreEscape(file: string): string { return '/' + [...file].map(c => '\\*?[]!# '.includes(c) ? `\\${c}` : c).join(''); }
function removeOwned(file: string, expected: string, expectedTarget: string) {
  if (stat(file)?.isSymbolicLink()) {
    const actual = fs.readlinkSync(file);
    if (process.platform === 'win32' ? path.toNamespacedPath(path.resolve(path.dirname(file), actual)).toLowerCase() !== path.toNamespacedPath(path.resolve(path.dirname(file), expectedTarget)).toLowerCase() : actual !== expectedTarget) throw new PlacementError('rollback found a changed host link; preserve and inspect');
    fs.unlinkSync(file);
  }
  else if (stat(file)?.isDirectory()) { if (treeDigest(file, 2) !== expected) throw new PlacementError('rollback found a user-modified skill; preserve and inspect'); removeTreeSync(file); }
}
export class Placement {
  readonly name: string; readonly scope: Scope; readonly home: string; project: string; readonly gitRoot?: string;
  readonly canonical: string; readonly link: string; readonly boundaries: [string, string]; readonly exclude?: string; readonly state: string; readonly begin: string; readonly end: string;
  constructor(name: string, scope: Scope, options: PlacementOptions = {}) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) throw new PlacementError('skill name must be lower-case kebab-case');
    if (scope !== 'project' && scope !== 'global') throw new PlacementError('an explicit project/global scope is required');
    this.name = name; this.scope = scope; this.home = expand(options.home ?? os.homedir()); this.project = expand(options.project ?? process.cwd());
    if (scope === 'project') {
      const result = git(this.project, ['rev-parse', '--show-toplevel'], false);
      if (result.status === 0) this.gitRoot = this.project = fs.realpathSync(result.stdout.trim());
      this.canonical = path.join(this.project, '.agents', 'skills', name); this.link = path.join(this.project, '.claude', 'skills', name); this.boundaries = [this.project, this.project];
      this.exclude = this.gitRoot ? gitPath(this.project, 'info/exclude') : undefined;
      this.state = this.gitRoot ? gitPath(this.project, 'jstack-skill-store.json') : path.join(this.project, '.jstack', 'skill-store.json');
    } else {
      const config = expand(options.claudeHome ?? process.env.CLAUDE_CONFIG_DIR ?? path.join(this.home, '.claude'));
      this.canonical = path.join(this.home, '.agents', 'skills', name); this.link = path.join(config, 'skills', name); this.boundaries = [this.home, config]; this.state = path.join(this.home, '.jstack', 'skill-store.json');
    }
    this.begin = `# BEGIN jstack skill ${name}\n`; this.end = `# END jstack skill ${name}\n`;
  }
  checkPaths(): void {
    [this.canonical, this.link].forEach((target, i) => { assertNoLinks(path.dirname(target), this.boundaries[i]!); assertCaseUnique(target); });
    if (stat(this.canonical)?.isSymbolicLink()) throw new PlacementError('canonical skill must not be a symlink');
    if (stat(this.link)?.isSymbolicLink()) {
      if (!fs.existsSync(this.link) || fs.realpathSync(this.link) !== fs.realpathSync(this.canonical)) throw new PlacementError('conflicting or broken link; preserve and inspect before repair');
      if (process.platform !== 'win32' && fs.readlinkSync(this.link) !== path.relative(path.dirname(this.link), this.canonical)) throw new PlacementError('conflicting link; preserve and inspect before repair');
    } else if (stat(this.link)) throw new PlacementError('host discovery path is occupied by a real file/directory');
    if (this.exclude) assertNoLinks(this.exclude); assertNoLinks(this.state);
  }
  tracked(): string[] { return this.gitRoot ? git(this.project, ['ls-files', '--', ...[this.canonical, this.link].map(p => path.relative(this.project, p).split(path.sep).join('/'))]).stdout.trim().split('\n').filter(Boolean) : []; }
  exclusion(original: Uint8Array, shared: boolean): Buffer {
    let text = Buffer.from(original).toString('utf8');
    if (text.includes(this.begin) || text.includes(this.end)) {
      if (text.split(this.begin).length !== 2 || text.split(this.end).length !== 2 || text.indexOf(this.end) < text.indexOf(this.begin)) throw new PlacementError('ambiguous jstack exclude ownership block');
      text = text.slice(0, text.indexOf(this.begin)) + text.slice(text.indexOf(this.end) + this.end.length);
    }
    if (!shared) { if (text && !text.endsWith('\n')) text += '\n'; text += this.begin + [this.canonical, this.link].map(p => ignoreEscape(path.relative(this.project, p).split(path.sep).join('/'))).join('\n') + '\n' + this.end; }
    return Buffer.from(text);
  }
  private locked<T>(action: () => T): T {
    assertNoLinks(this.state); fs.mkdirSync(path.dirname(this.state), { recursive: true, mode: 0o700 });
    return withLock(`${this.state}.lock-v2`, action);
  }
  inspection(): Record<string, unknown> {
    this.checkPaths(); return { scope: this.scope, canonical: this.canonical, claudeLink: this.link, relativeTarget: path.relative(path.dirname(this.link), this.canonical), canonicalExists: stat(this.canonical)?.isDirectory() ?? false, linked: !!stat(this.link)?.isSymbolicLink() && fs.existsSync(this.link), tracked: this.tracked(), gitExclude: this.exclude ?? null, gitCommonDir: this.gitRoot ? git(this.project, ['rev-parse', '--git-common-dir']).stdout.trim() : null, verification: 'filesystem and Git only; host discovery is not yet proven', limitations: this.gitRoot || this.scope === 'global' ? [] : ['No Git repository: future git init does not preserve local exclusion'] };
  }
  private connectLink(): void {
    if (!stat(this.link)) fs.symlinkSync(process.platform === 'win32' ? this.canonical : path.relative(path.dirname(this.link), this.canonical), this.link, process.platform === 'win32' ? 'junction' : 'dir');
  }
  connect(): Record<string, unknown> {
    this.locked(() => { this.checkPaths(); validateSkill(this.canonical, this.name); fs.mkdirSync(path.dirname(this.link), { recursive: true, mode: 0o700 }); this.connectLink(); });
    return { ...this.inspection(), sharing: 'unchanged' };
  }
  place(source?: string, options: { shared?: boolean } = {}): Record<string, unknown> {
    const shared = options.shared ?? false; if (this.scope === 'global' && shared) throw new PlacementError('Git sharing applies only to project skills');
    source = source ? expand(source) : this.canonical; assertNoLinks(source); this.checkPaths(); const digest = validateSkill(source, this.name, 2);
    const check = () => {
      this.checkPaths(); if (stat(this.canonical) && validateSkill(this.canonical, this.name, 2) !== digest) throw new PlacementError('existing skill differs; preserve it and choose an explicit edit or a new name');
      if (!shared && this.tracked().length) throw new PlacementError('tracked skill cannot become local through exclude; automatic untracking is forbidden');
    };
    check(); const selected = source;
    this.locked(() => {
      check(); if (validateSkill(selected, this.name, 2) !== digest) throw new PlacementError('source skill changed while waiting');
      const originalExclude = this.exclude && stat(this.exclude) ? fs.readFileSync(this.exclude) : undefined; const originalState = stat(this.state) ? fs.readFileSync(this.state) : undefined;
      const state = originalState ? JSON.parse(originalState.toString('utf8')) as OwnershipState : { schemaVersion: 1 as const, skills: {} };
      if (state.schemaVersion !== 1 || !state.skills || typeof state.skills !== 'object' || Array.isArray(state.skills)) throw new PlacementError('unsupported skill ownership state');
      const created: string[] = []; const createdDirs: string[] = []; let touchedExclude = false; let touchedState = false;
      try {
        for (const parent of [path.dirname(this.canonical), path.dirname(this.link)]) {
          const absent: string[] = []; let current = parent; while (!stat(current)) { absent.push(current); current = path.dirname(current); }
          for (const directory of absent.reverse()) { fs.mkdirSync(directory, { mode: 0o700 }); createdDirs.push(directory); }
        }
        if (!stat(this.canonical)) {
          // Exclusive directory creation cannot replace an intervening user directory.
          fs.mkdirSync(this.canonical, { mode: 0o700 }); created.push(this.canonical);
          // Node 26 applies errorOnExist to directories as well as files.
          // Keep the exclusive destination reservation, then copy each new child.
          // The filter selects Node's JS traversal: older Windows native cp
          // corrupts non-ASCII directory paths (nodejs/node#61950).
          for (const name of fs.readdirSync(selected)) fs.cpSync(path.join(selected, name), path.join(this.canonical, name), { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true, filter: () => true });
          if (validateSkill(this.canonical, this.name, 2) !== digest) throw new PlacementError('skill changed while copying');
        }
        if (!stat(this.link)) { this.connectLink(); created.push(this.link); }
        if (this.exclude) {
          fs.mkdirSync(path.dirname(this.exclude), { recursive: true }); atomicWrite(this.exclude, this.exclusion(originalExclude ?? Buffer.alloc(0), shared), false); touchedExclude = true;
          for (const target of [path.join(this.canonical, 'SKILL.md'), this.link]) {
            const ignored = git(this.project, ['check-ignore', '--no-index', '-q', '--', target], false);
            if (ignored.status !== 0 && ignored.status !== 1) throw new PlacementError('Git ignore verification failed');
            if (shared && ignored.status === 0) throw new PlacementError('another ignore rule prevents sharing; rule was not changed');
            if (!shared && ignored.status !== 0) throw new PlacementError('local exclusion was not effective');
          }
        }
        state.skills[this.name] = { scope: this.scope, digest, digestVersion: 2, shared, relativeTarget: path.relative(path.dirname(this.link), this.canonical) };
        atomicWrite(this.state, Buffer.from(JSON.stringify(state, null, 2) + '\n'), false); touchedState = true;
      } catch (error) {
        if (touchedExclude && this.exclude) { if (originalExclude) atomicWrite(this.exclude, originalExclude, false); else fs.unlinkSync(this.exclude); }
        if (touchedState) { if (originalState) atomicWrite(this.state, originalState, false); else fs.unlinkSync(this.state); }
        try {
          for (const file of created.reverse()) removeOwned(file, digest, process.platform === 'win32' ? this.canonical : path.relative(path.dirname(this.link), this.canonical));
        } catch (rollbackError) {
          throw new AggregateError([error, rollbackError], `Placement failed: ${String(error)}; rollback preserved data: ${String(rollbackError)}`);
        }
        for (const directory of createdDirs.reverse()) { try { fs.rmdirSync(directory); } catch {} } throw error;
      }
    });
    return { ...this.inspection(), sharing: shared ? 'shared' : this.scope === 'project' ? 'local' : 'global', digest, digestVersion: 2 };
  }
}
export function main(argv = process.argv.slice(2)): number {
  try {
    const { positional: [action], values } = parseFlags(argv); if (typeof values.name !== 'string' || typeof values.scope !== 'string') throw new PlacementError('--name and --scope are required');
    const placement = new Placement(values.name, values.scope as Scope, { project: values.project as string | undefined, home: values.home as string | undefined, claudeHome: values['claude-home'] as string | undefined });
    if (!['inspect', 'place', 'connect', 'share', 'local'].includes(action ?? '')) throw new PlacementError('expected inspect, place, connect, share, or local');
    if (action === 'place' && typeof values.source !== 'string') throw new PlacementError('place requires --source');
    if (action !== 'place' && values.source) throw new PlacementError('only place accepts --source');
    const result = action === 'inspect' ? placement.inspection() : action === 'connect' ? placement.connect() : placement.place(values.source as string | undefined, { shared: action === 'share' });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return 0;
  } catch (error) { process.stderr.write(JSON.stringify({ error: (error as Error).message }) + '\n'); return 2; }
}
if (isMain(import.meta.url)) process.exitCode = main();
