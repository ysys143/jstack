/** Cross-platform state primitives. Existing user paths are never repaired implicitly. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawnSync, type SpawnSyncOptionsWithStringEncoding } from 'node:child_process';

export class StateError extends Error {}
export const expand = (value: string): string => path.resolve(value === '~' ? os.homedir() : value.startsWith('~/') || value.startsWith('~\\') ? path.join(os.homedir(), value.slice(2)) : value);
export function stat(file: string): fs.Stats | undefined {
  try { return fs.lstatSync(file); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
}
/** Remove a caller-owned tree without following links. Missing paths still fail.
 * Older Windows Node versions silently leave non-ASCII paths in rmSync's
 * native recursive implementation (nodejs/node#56049). Use libuv primitives.
 */
export function removeTreeSync(file: string): void {
  const info = fs.lstatSync(file);
  if (info.isDirectory() && !info.isSymbolicLink()) {
    for (const name of fs.readdirSync(file)) removeTreeSync(path.join(file, name));
    fs.rmdirSync(file);
  } else fs.unlinkSync(file);
}
export function assertNoLinks(file: string, boundary = path.parse(path.resolve(file)).root): void {
  let current = path.resolve(file); const stop = path.resolve(boundary);
  if (current !== stop && (path.relative(stop, current).startsWith(`..${path.sep}`) || path.relative(stop, current) === '..' || path.isAbsolute(path.relative(stop, current)))) throw new StateError('path escaped its scope');
  for (;;) {
    if (stat(current)?.isSymbolicLink()) throw new StateError('symlink in state path');
    if (current === stop) break;
    const parent = path.dirname(current); if (parent === current) throw new StateError('path escaped its scope'); current = parent;
  }
}
export function assertCaseUnique(file: string): void {
  const parent = path.dirname(file); if (!stat(parent)?.isDirectory()) return;
  const name = path.basename(file); const key = name.normalize('NFC').toLowerCase();
  if (fs.readdirSync(parent).some(other => other !== name && other.normalize('NFC').toLowerCase() === key)) throw new StateError('case or Unicode-equivalent path collision');
}
function acl(file: string, protect: boolean): void {
  // Only built-in modules are needed. Inherited PS7 module paths cannot be
  // loaded by Windows PowerShell when Node is the intermediate process.
  const script = `$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; $env:PSModulePath=$PSHOME+'\\Modules'; try { $p=$env:JSTACK_ACL_PATH; $id=[System.Security.Principal.WindowsIdentity]::GetCurrent().User; $acl=Get-Acl -LiteralPath $p; ${protect ? `$acl.SetAccessRuleProtection($true,$false); $acl.SetOwner($id); foreach($r in @($acl.Access)){$acl.RemoveAccessRuleSpecific($r)}; $inherit=if((Get-Item -LiteralPath $p).PSIsContainer){[System.Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'}else{[System.Security.AccessControl.InheritanceFlags]::None}; foreach($sid in @($id.Value,'S-1-5-18','S-1-5-32-544')){$rule=[System.Security.AccessControl.FileSystemAccessRule]::new([System.Security.Principal.SecurityIdentifier]::new($sid),[System.Security.AccessControl.FileSystemRights]::FullControl,$inherit,[System.Security.AccessControl.PropagationFlags]::None,[System.Security.AccessControl.AccessControlType]::Allow); $acl.AddAccessRule($rule)}; Set-Acl -LiteralPath $p -AclObject $acl; $acl=Get-Acl -LiteralPath $p;` : ''} if($acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value -ne $id.Value){throw 'owner'}; foreach($r in $acl.Access){$sid=$r.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value; if($r.AccessControlType -eq 'Allow' -and $sid -notin @($id.Value,'S-1-5-18','S-1-5-32-544') -and [int]$r.FileSystemRights -ne 0){throw 'public ACL'}}; Write-Output 'ok' } catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }`;
  const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', env: { ...process.env, JSTACK_ACL_PATH: file }, timeout: 15000, windowsHide: true });
  if (result.error || result.status !== 0 || result.stdout.trim() !== 'ok') throw new StateError(`private state ACL could not be verified; inspect before repair (exit=${result.status}, error=${result.error?.message ?? 'none'}, stdout=${JSON.stringify(result.stdout?.trim())}, stderr=${JSON.stringify(result.stderr?.trim().slice(0, 3000))})`);
}
export function checkOwned(file: string, directory = false): void {
  assertNoLinks(file); const info = fs.lstatSync(file);
  if (!(directory ? info.isDirectory() : info.isFile())) throw new StateError('private state must be an owned regular file/directory');
  if (process.platform === 'win32') acl(file, false);
  else {
    if (info.uid !== process.getuid?.()) throw new StateError('private state must be an owned regular file/directory');
    if (info.mode & 0o077) throw new StateError('private state permissions must be 0700/0600; inspect before repair');
  }
}
export function privateDir(file: string, options: { exclusive?: boolean } = {}): void {
  assertNoLinks(file); assertCaseUnique(file);
  if (options.exclusive || !stat(file)) {
    fs.mkdirSync(file, { recursive: !options.exclusive, mode: 0o700 });
    if (process.platform === 'win32') acl(file, true);
  }
  checkOwned(file, true);
}
/** A parent shared with other jstack state, such as `~/.jstack`, is created 0700 but may already be 0755
 * from the installer's default umask. On POSIX an existing parent must be an owned, unlinked directory
 * that group and others cannot write; the private leaf below it still uses `privateDir`. Windows keeps
 * the ACL check unchanged. An existing parent is never repaired. */
export function sharedParent(file: string): void {
  assertNoLinks(file); assertCaseUnique(file);
  if (process.platform === 'win32' || !stat(file)) return privateDir(file);
  const info = fs.lstatSync(file);
  if (!info.isDirectory() || info.uid !== process.getuid?.()) throw new StateError('shared state parent must be an owned directory');
  if (info.mode & 0o022) throw new StateError('shared state parent must not be writable by group or others; inspect before repair');
}
/** Create an empty private file for native writers without replacing existing data. */
export function createPrivateFile(file: string): void {
  assertNoLinks(file); assertCaseUnique(file);
  const fd = fs.openSync(file, 'wx', 0o600);
  try { if (process.platform === 'win32') acl(file, true); }
  finally { fs.closeSync(fd); }
}
/** `durable` false skips the disk sync for a record that must outlive its process but not a crash of the machine. */
export function atomicWrite(file: string, data: Uint8Array, privateState = true, durable = true): void {
  assertNoLinks(file); assertCaseUnique(file);
  if (stat(file)) { if (privateState) checkOwned(file); else if (!stat(file)!.isFile()) throw new StateError('replacement requires a regular file'); }
  const mode = privateState ? 0o600 : (stat(file)?.mode ?? 0o600) & 0o777;
  const temporary = path.join(path.dirname(file), `.jstack-write-${randomUUID()}`);
  const fd = fs.openSync(temporary, 'wx', mode);
  try {
    if (process.platform === 'win32' && privateState) acl(temporary, true);
    fs.writeFileSync(fd, data); if (durable) fs.fsyncSync(fd); fs.closeSync(fd);
    assertNoLinks(file); if (privateState && stat(file)) checkOwned(file);
    fs.renameSync(temporary, file);
  } finally { try { fs.closeSync(fd); } catch {} if (stat(temporary)) fs.unlinkSync(temporary); }
}
/** Shared with portable_lock in the transitional Python writers.
 * Acquisition is mkdir, owner.json is published before entering the action, and
 * release removes the owner then directory. Never steal on age or PID alone:
 * interrupted operations require explicit inspection/recovery. Older Python
 * distributions using only flock must be stopped before switching runtimes.
 */
export function withLock<T>(file: string, action: () => T, timeoutMs = 10000): T {
  assertNoLinks(path.dirname(file)); assertCaseUnique(file);
  const started = Date.now();
  for (;;) {
    try { fs.mkdirSync(file, { mode: 0o700 }); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (!stat(file)?.isDirectory() || stat(file)?.isSymbolicLink()) throw new StateError('unsafe lock path');
      if (Date.now() - started >= timeoutMs) throw new StateError('state lock unavailable; inspect interrupted or active writer');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  try { if (process.platform === 'win32') acl(file, true); atomicWrite(path.join(file, 'owner.json'), Buffer.from(JSON.stringify({ pid: process.pid, host: os.hostname(), startedAt: new Date().toISOString() }))); return action(); }
  finally { if (stat(path.join(file, 'owner.json'))) fs.unlinkSync(path.join(file, 'owner.json')); fs.rmdirSync(file); }
}
/** Explicit recovery only, restricted to a proven dead process on this machine. */
export function recoverLock(file: string): boolean {
  if (!stat(file)) return false;
  return withLock(`${file}.recovery`, () => {
    if (!stat(file)) return false;
    checkOwned(file, true);
    const ownerFile = path.join(file, 'owner.json'); checkOwned(ownerFile);
    if (fs.readdirSync(file).sort().join(',') !== 'owner.json') throw new StateError('lock contains unrecognized files; preserve and inspect');
    const bytes = fs.readFileSync(ownerFile); const owner = JSON.parse(bytes.toString('utf8')) as { pid?: number; host?: string };
    if (owner.host !== os.hostname() || !Number.isSafeInteger(owner.pid) || owner.pid! <= 0) throw new StateError('lock owner cannot be verified on this machine');
    try { process.kill(owner.pid!, 0); throw new StateError('lock owner is still active'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
    if (!fs.readFileSync(ownerFile).equals(bytes)) throw new StateError('lock owner changed during recovery');
    const retired = `${file}.retired-${randomUUID()}`; fs.renameSync(file, retired);
    fs.unlinkSync(path.join(retired, 'owner.json')); fs.rmdirSync(retired); return true;
  });
}
/** Resolve npm's standard Node launcher without running cmd.exe or interpolating arguments. */
export function npmShimTarget(shim: string): string {
  const text = fs.readFileSync(shim, 'utf8');
  if (!/node(?:\.exe)?/i.test(text)) throw new StateError('unsupported Windows command launcher; use a native executable');
  const targets = [...text.matchAll(/"%dp0%[\\/]([^"\r\n]+)"\s+%\*/gi)].map(match => match[1]!);
  if (new Set(targets).size !== 1) throw new StateError('unsupported Windows npm launcher');
  const relative = targets[0]!.replace(/[\\/]/g, path.sep);
  if (path.isAbsolute(relative) || relative.split(path.sep).includes('..')) throw new StateError('npm launcher target escapes its package directory');
  const target = path.resolve(path.dirname(shim), relative);
  if (!fs.statSync(target).isFile() || !/\.(?:[cm]?js)$/i.test(target)) throw new StateError('npm launcher does not select a JavaScript entrypoint');
  return target;
}
export function runProcess(command: string, args: string[], options: Partial<SpawnSyncOptionsWithStringEncoding> = {}) {
  if (process.platform === 'win32') {
    const env = options.env ?? process.env;
    const search = /[\\/]/.test(command) ? [''] : String(env.PATH ?? env.Path ?? '').split(path.delimiter);
    const extensions = path.extname(command) ? [''] : ['.exe', '.com', '.cmd', '.bat', ''];
    outer: for (const directory of search) for (const extension of extensions) {
      const candidate = path.resolve(directory, command + extension); if (!stat(candidate)?.isFile()) continue;
      if (/\.(cmd|bat)$/i.test(candidate)) { args = [npmShimTarget(candidate), ...args]; command = process.execPath; }
      else command = candidate;
      break outer;
    }
  }
  return spawnSync(command, args, { encoding: 'utf8', windowsHide: true, ...options, shell: false });
}
/** Options named in `booleans` take no value; every other option needs one, so a misplaced value is an error rather than ignored. */
export function parseFlags(argv: string[], booleans: readonly string[] = ['default']): { positional: string[]; values: Record<string, string | boolean> } {
  const positional: string[] = []; const values: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) { const item = argv[i]!; if (!item.startsWith('--')) positional.push(item); else { const name = item.slice(2); if (booleans.includes(name)) values[name] = true; else { const next = argv[++i]; if (next === undefined || next.startsWith('--')) throw new StateError(`missing value for --${name}`); values[name] = next; } } }
  return { positional, values };
}
