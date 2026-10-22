import { isMain } from './entry.js';
/** Private profiles shared by both hosts; remote writes require the explicit send action. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { pathToFileURL } from 'node:url';
import { assertNoLinks, atomicWrite, checkOwned, expand, parseFlags, privateDir, recoverLock, removeTreeSync, runProcess, stat, withLock } from './os.js';

export class ProfileError extends Error {}
export type ProfileDocument = { schemaVersion: number; revision?: number; [key: string]: string | number | undefined };
export type ConventionsDocument = { schemaVersion: number; revision?: number; [key: string]: string | number | string[] | undefined };
/** Workspace and reporting form one pair that is present or absent together; conventions are independent. A profile holds at least one. */
export interface Snapshot { profile: string; revision: number; workspace?: ProfileDocument; reporting?: ProfileDocument; conventions?: ConventionsDocument; missing?: Record<string, string[]> }
const WS_FIELDS = new Set(['schemaVersion', 'configDir', 'account', 'driveId', 'reportFolderId', 'scrumFolderId', 'checkedAt', 'source', 'revision']);
const REPORT_FIELDS = new Set(['schemaVersion', 'subjectName', 'sheetNamePattern', 'nameColumn', 'dateColumn', 'learnedColumn', 'goalColumn', 'mailTo', 'revision']);
const FILES = ['workspace.json', 'reporting.json', 'conventions.json'] as const;
const LANGUAGES = ['en', 'ko'];
/** Closed conventions schema: enumerations, short slugs and bounded integers only, so no prose or path can be stored. */
export const CONVENTION_FIELDS: Record<string, (value: unknown) => boolean> = {
  schemaVersion: value => value === 1,
  revision: value => Number.isSafeInteger(value) && (value as number) >= 0,
  commitLanguage: value => LANGUAGES.includes(value as string),
  autocommitLanguage: value => LANGUAGES.includes(value as string),
  subjectVerbEnding: value => ['none', 'korean'].includes(value as string),
  footerStyle: value => ['conventional', 'resolves'].includes(value as string),
  branchScheme: value => ['type-slash-desc', 'folder-category-desc'].includes(value as string),
  commitTypes: value => slugList(value, 1), branchTypes: value => slugList(value, 1), branchFolders: value => slugList(value, 0),
  subjectMax: value => Number.isSafeInteger(value) && (value as number) >= 20 && (value as number) <= 200,
  bodyWrap: value => Number.isSafeInteger(value) && (value as number) >= 40 && (value as number) <= 200,
  source: value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,39}$/.test(value),
  checkedAt: value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value)),
};
function slugList(value: unknown, minimum: number): boolean { return Array.isArray(value) && value.length >= minimum && value.length <= 20 && new Set(value).size === value.length && value.every(item => typeof item === 'string' && /^[a-z][a-z0-9-]{0,19}$/.test(item)); }
export function validateConventions(document: ConventionsDocument): void {
  if (!document || typeof document !== 'object' || Array.isArray(document) || document.schemaVersion !== 1) throw new ProfileError('unsupported conventions schemaVersion');
  for (const [key, value] of Object.entries(document)) {
    const check = CONVENTION_FIELDS[key];
    if (!check) throw new ProfileError('unknown conventions field; free-form instructions are not accepted');
    if (!check(value)) throw new ProfileError(`invalid conventions field ${key}`);
  }
  if (document.branchScheme === 'folder-category-desc' && !(document.branchFolders as string[] | undefined)?.length) throw new ProfileError('folder-category-desc needs branchFolders');
}
export const jsonBytes = (value: unknown) => Buffer.from(JSON.stringify(value, null, 2) + '\n');
export function validateName(name: unknown): string { if (typeof name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(name)) throw new ProfileError('profile name must use letters, digits, hyphens or underscores'); return name; }
export function readJson(file: string): Record<string, unknown> {
  checkOwned(file); let value: unknown;
  try { value = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { throw new ProfileError('unreadable profile JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ProfileError('profile must be a JSON object');
  return value as Record<string, unknown>;
}
export function validate(workspace: ProfileDocument, reporting: ProfileDocument): void {
  for (const [data, fields] of [[workspace, WS_FIELDS], [reporting, REPORT_FIELDS]] as const) {
    if (!data || typeof data !== 'object' || Array.isArray(data) || data.schemaVersion !== 1) throw new ProfileError('unsupported profile schemaVersion');
    if (Object.keys(data).some(key => !fields.has(key))) throw new ProfileError('unknown profile field; credentials and free-form instructions are not accepted');
    for (const [key, value] of Object.entries(data)) {
      if (key === 'schemaVersion' || key === 'revision') { if (!Number.isSafeInteger(value) || (value as number) < (key === 'schemaVersion' ? 1 : 0)) throw new ProfileError('invalid profile version/revision'); }
      else if (typeof value !== 'string' || [...value].length > 2048 || value.includes('\0')) throw new ProfileError('invalid profile field type or size');
    }
  }
  if (!workspace.configDir || !workspace.account) throw new ProfileError('workspace requires configDir and an observed account identity');
  const config = workspace.configDir as string;
  if (!(path.isAbsolute(config) || config === '~' || config.startsWith('~/') || config.startsWith('~\\'))) throw new ProfileError('configDir must be absolute');
  for (const field of ['nameColumn', 'dateColumn', 'learnedColumn', 'goalColumn']) if (field in reporting && !/^[A-Z]{1,3}$/.test(reporting[field] as string)) throw new ProfileError('invalid Sheets column');
}
export function missingFields(workspace?: ProfileDocument, reporting?: ProfileDocument): Record<string, string[]> {
  if (!workspace || !reporting) return { reportUpload: ['workspace.json'], scrum: ['workspace.json', 'reporting.json'], draftMail: ['reporting.json'] };
  return { reportUpload: ['reportFolderId'].filter(k => !workspace[k]), scrum: [...['scrumFolderId'].filter(k => !workspace[k]), ...['subjectName', 'sheetNamePattern', 'nameColumn', 'dateColumn', 'learnedColumn', 'goalColumn'].filter(k => !reporting[k])], draftMail: ['mailTo'].filter(k => !reporting[k]) };
}
export class Store {
  readonly root: string;
  constructor(root = path.join(os.homedir(), '.jstack')) { this.root = expand(root); }
  directory(name: string): string { return path.join(this.root, 'profiles', validateName(name)); }
  private lock<T>(directory: string, action: () => T, create = false): T {
    for (const file of [this.root, path.join(this.root, 'profiles'), directory]) create ? privateDir(file) : checkOwned(file, true);
    return withLock(path.join(directory, '.lock-v2'), action);
  }
  private present(directory: string): boolean[] {
    const present = FILES.map(file => !!stat(path.join(directory, file)));
    if (present[0] !== present[1]) throw new ProfileError('partial profile exists; inspect before repair');
    return present;
  }
  private read(name: string): Snapshot {
    const directory = this.directory(name);
    if (stat(path.join(directory, '.transaction.json'))) throw new ProfileError('interrupted profile transaction; run recover before use');
    const [pair, , hasConventions] = this.present(directory);
    if (!pair && !hasConventions) throw new ProfileError('profile has no settings');
    const snapshot: Snapshot = { profile: name, revision: 0 }; const revisions: unknown[] = [];
    if (pair) {
      const workspace = readJson(path.join(directory, 'workspace.json')) as ProfileDocument, reporting = readJson(path.join(directory, 'reporting.json')) as ProfileDocument;
      validate(workspace, reporting); Object.assign(snapshot, { workspace, reporting }); revisions.push(workspace.revision, reporting.revision);
    }
    if (hasConventions) { const conventions = readJson(path.join(directory, 'conventions.json')) as ConventionsDocument; validateConventions(conventions); snapshot.conventions = conventions; revisions.push(conventions.revision); }
    if (pair && hasConventions && revisions[0] === revisions[1] && typeof revisions[2] === 'number' && typeof revisions[0] === 'number' && revisions[2] < revisions[0])
      throw new ProfileError(`conventions.json is at revision ${revisions[2]} but the workspace pair is at ${revisions[0]}; an older jstack saved the pair. Save the conventions again with --expected-revision ${revisions[0]}, or remove them with --remove-conventions`);
    if (!revisions[0] || revisions.some(value => value !== revisions[0])) throw new ProfileError('profile revisions do not match');
    snapshot.revision = revisions[0] as number; snapshot.missing = missingFields(snapshot.workspace, snapshot.reporting);
    return snapshot;
  }
  /** Reads without the profile lock for read-only callers (a read-only state directory still works); an interrupted or mid-save state is retried once, then reported. */
  peek(name: string): Snapshot {
    const directory = this.directory(name); for (const file of [this.root, path.join(this.root, 'profiles'), directory]) checkOwned(file, true);
    try { return this.read(name); } catch (error) { if (/interrupted|revisions do not match|partial/.test((error as Error).message)) return this.read(name); throw error; }
  }
  load(name?: string): Snapshot {
    if (name === undefined) {
      checkOwned(this.root, true); const config = readJson(path.join(this.root, 'config.json'));
      if (config.schemaVersion !== 1 || Object.keys(config).sort().join(',') !== 'defaultProfile,schemaVersion') throw new ProfileError('unsupported default profile configuration');
      name = validateName(config.defaultProfile);
    }
    const selected = name; return this.lock(this.directory(selected), () => this.read(selected));
  }
  /**
   * Writes the given documents. A document passed as undefined keeps its file, rewritten with the new revision; null removes it.
   * Workspace and reporting are given, kept or removed together. The previous revision is kept under history/ for restore.
   */
  save(name: string, workspace: ProfileDocument | null | undefined, reporting: ProfileDocument | null | undefined, expectedRevision: number, options: { makeDefault?: boolean; conventions?: ConventionsDocument | null } = {}): Snapshot {
    validateName(name); if ((workspace === undefined) !== (reporting === undefined) || (workspace === null) !== (reporting === null)) throw new ProfileError('workspace and reporting are saved together');
    if (workspace && reporting) validate(workspace, reporting); if (options.conventions) validateConventions(options.conventions);
    const directory = this.directory(name);
    const result = this.lock(directory, () => {
      const journal = path.join(directory, '.transaction.json'); if (stat(journal)) throw new ProfileError('interrupted profile transaction; recover explicitly');
      const existing = this.present(directory); const current = existing.some(Boolean) ? this.readForSave(name, options.conventions !== undefined) : undefined;
      const oldRevision = current?.revision ?? 0;
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== oldRevision) throw new ProfileError('profile changed; reread and resolve the conflict');
      const revision = oldRevision + 1; if (!Number.isSafeInteger(revision)) throw new ProfileError('profile revision exhausted');
      const pick = <T>(given: T | null | undefined, kept: T | undefined) => given === null ? undefined : given ?? kept;
      const next: (ProfileDocument | ConventionsDocument | undefined)[] = [pick(workspace, current?.workspace), pick(reporting, current?.reporting), pick(options.conventions, current?.conventions)];
      if (!next.some(Boolean)) throw new ProfileError('profile has no settings');
      const paths = FILES.map(file => path.join(directory, file));
      const previous = paths.map((file, i) => existing[i] ? fs.readFileSync(file, 'utf8') : null);
      if (current) this.keepHistory(directory, oldRevision, previous);
      atomicWrite(journal, jsonBytes({ schemaVersion: 1, files: [...FILES], previous }));
      try { next.forEach((document, i) => { if (document) atomicWrite(paths[i]!, jsonBytes({ ...document, revision })); else if (existing[i]) { checkOwned(paths[i]!); fs.unlinkSync(paths[i]!); } }); }
      catch (error) { this.restore(directory, previous); fs.unlinkSync(journal); throw error; }
      fs.unlinkSync(journal); return this.read(name);
    }, true);
    if (options.makeDefault) withLock(path.join(this.root, '.default-lock-v2'), () => atomicWrite(path.join(this.root, 'config.json'), jsonBytes({ schemaVersion: 1, defaultProfile: name })));
    return result;
  }
  private keepHistory(directory: string, revision: number, previous: (string | null)[]): void {
    const history = path.join(directory, 'history'), kept = path.join(history, `r${revision}`), staging = path.join(history, `.r${revision}-${process.pid}-${Date.now()}`); privateDir(history);
    // Files are written exclusively at 0600 into a staging directory that is renamed into place, so a listed revision is always complete.
    privateDir(staging, { exclusive: true });
    try { FILES.forEach((file, i) => { const data = previous[i]; if (typeof data === 'string') fs.writeFileSync(path.join(staging, file), data, { mode: 0o600, flag: 'wx' }); }); }
    catch (error) { removeTreeSync(staging); throw error; }
    // A copy left by an interrupted save is replaced; removal does not follow links.
    if (stat(kept)) { assertNoLinks(kept); removeTreeSync(kept); }
    fs.renameSync(staging, kept);
  }
  /** Like read, but tolerates conventions left behind by an older writer when this save replaces or removes them. */
  private readForSave(name: string, replacesConventions: boolean): Snapshot {
    try { return this.read(name); }
    catch (error) {
      if (!replacesConventions || !/^conventions\.json is at revision/.test((error as Error).message)) throw error;
      const directory = this.directory(name), workspace = readJson(path.join(directory, 'workspace.json')) as ProfileDocument, reporting = readJson(path.join(directory, 'reporting.json')) as ProfileDocument;
      validate(workspace, reporting);
      return { profile: name, revision: workspace.revision as number, workspace, reporting, conventions: readJson(path.join(directory, 'conventions.json')) as ConventionsDocument };
    }
  }
  /** Revisions kept before each save, newest first. */
  history(name: string): number[] {
    const directory = this.directory(name); if (!stat(directory)) throw new ProfileError('no such profile');
    const base = path.join(directory, 'history'); if (!stat(base)) return [];
    checkOwned(base, true); return fs.readdirSync(base).map(entry => /^r(\d+)$/.exec(entry)?.[1]).filter(Boolean).map(Number).sort((a, b) => b - a);
  }
  /** Saves a kept revision as the next revision; the current one is kept in turn, so a restore can itself be restored. */
  restoreRevision(name: string, revision: number, expectedRevision: number): Snapshot {
    const kept = path.join(this.directory(name), 'history', `r${revision}`); if (!Number.isSafeInteger(revision) || !stat(kept)) throw new ProfileError('no kept revision with that number');
    checkOwned(kept, true); const doc = (file: string) => stat(path.join(kept, file)) ? readJson(path.join(kept, file)) : undefined;
    const [workspace, reporting, conventions] = FILES.map(doc);
    // The kept revision is restored exactly: a file it did not have is removed.
    const strip = <T extends Record<string, unknown>>(value: T | undefined) => { if (!value) return null; const { revision: _, ...rest } = value; return rest as T; };
    return this.save(name, strip(workspace) as ProfileDocument | null, strip(reporting) as ProfileDocument | null, expectedRevision, { conventions: strip(conventions) as ConventionsDocument | null });
  }
  private restore(directory: string, previous: (string | null)[], files: readonly string[] = FILES): void {
    files.forEach((filename, i) => { const file = path.join(directory, filename); const data = previous[i]; if (data === null) { if (stat(file)) { checkOwned(file); fs.unlinkSync(file); } } else if (typeof data === 'string') atomicWrite(file, Buffer.from(data)); });
  }
  recoverLock(name: string): { profile: string; lockRecovered: boolean } {
    const directory = this.directory(name); checkOwned(directory, true);
    return { profile: name, lockRecovered: recoverLock(path.join(directory, '.lock-v2')) };
  }
  recover(name: string): { profile: string; recovered: true } {
    const directory = this.directory(name); this.recoverLock(name); return this.lock(directory, () => {
      const journal = path.join(directory, '.transaction.json'); const data = readJson(journal); const previous = data.previous;
      // Journals written before conventions existed name no files and hold the workspace and reporting pair.
      const files = data.files === undefined ? FILES.slice(0, 2) : data.files;
      if (data.schemaVersion !== 1 || !Array.isArray(previous) || !Array.isArray(files) || ![2, 3].includes(files.length) || previous.length !== files.length || !files.every((file, i) => file === FILES[i])) throw new ProfileError('invalid recovery journal');
      if (!previous.every(v => v === null || typeof v === 'string')) throw new ProfileError('invalid recovery data');
      this.restore(directory, previous as (string | null)[], files as string[]); fs.unlinkSync(journal); return { profile: name, recovered: true };
    });
  }
  inspect(): { configured: boolean; profiles: Record<string, unknown>[] } {
    if (!stat(this.root)) return { configured: false, profiles: [] }; checkOwned(this.root, true);
    const base = path.join(this.root, 'profiles'); const rows: Record<string, unknown>[] = [];
    if (stat(base)) { checkOwned(base, true); for (const name of fs.readdirSync(base).sort()) { try { const loaded = this.load(name); rows.push({ profile: name, revision: loaded.revision, missing: loaded.missing, ...(loaded.conventions ? { hasConventions: true } : {}), valid: true }); } catch (error) { rows.push({ profile: name, valid: false, error: (error as Error).message }); } } }
    return { configured: rows.length > 0, profiles: rows };
  }
}
export function accountEnv(configDir: string): NodeJS.ProcessEnv {
  const env = { ...process.env }; for (const key of Object.keys(env)) if (key.startsWith('GOOGLE_WORKSPACE_CLI_') || key === 'GOOGLE_APPLICATION_CREDENTIALS') delete env[key];
  env.GOOGLE_WORKSPACE_CLI_CONFIG_DIR = expand(configDir); return env;
}
export type MetadataReader = (configDir: string, args: string[]) => Record<string, unknown>;
export const gwsJson: MetadataReader = (configDir, args) => {
  if (!new Set(['drive about get', 'drive drives list', 'drive files list', 'drive files get', 'sheets spreadsheets get']).has(args.slice(0, 3).join(' '))) throw new ProfileError('discovery accepts metadata reads only');
  if (!stat(expand(configDir))?.isDirectory()) throw new ProfileError('selected account config directory does not exist');
  const result = runProcess('gws', [...args, '--format', 'json'], { env: accountEnv(configDir), timeout: 45000 });
  if (result.error) throw new ProfileError('gws unavailable or metadata request timed out');
  if (result.status !== 0) throw new ProfileError('gws metadata request failed; inspect authentication and access for the selected account');
  let data: unknown; try { data = JSON.parse(result.stdout); } catch { throw new ProfileError('gws returned non-JSON metadata'); }
  if (!data || typeof data !== 'object' || Array.isArray(data) || 'error' in data) throw new ProfileError('gws returned invalid or failed metadata'); return data as Record<string, unknown>;
};
export function identity(configDir: string, reader: MetadataReader = gwsJson): string {
  const raw = reader(configDir, ['drive', 'about', 'get', '--params', JSON.stringify({ fields: 'user(emailAddress,permissionId)' })]);
  const user = raw.user as Record<string, unknown> | undefined; const account = user?.permissionId || user?.emailAddress;
  if (typeof account !== 'string' || !account) throw new ProfileError('selected account identity could not be verified'); return account;
}
export function discover(configDir: string, reader: MetadataReader = gwsJson): Record<string, unknown> {
  const account = identity(configDir, reader); const groups: Record<string, unknown[]> = {};
  const resources: [string, string, Record<string, unknown>][] = [['drives', 'drives', { pageSize: 100, fields: 'nextPageToken,drives(id,name)' }], ['files', 'files', { pageSize: 100, fields: 'nextPageToken,files(id,name,mimeType,parents,driveId)', q: "trashed = false and (mimeType = 'application/vnd.google-apps.folder' or mimeType = 'application/vnd.google-apps.spreadsheet')", supportsAllDrives: true, includeItemsFromAllDrives: true }]];
  for (const [resource, field, params] of resources) {
    const items: unknown[] = []; const seen = new Set<string>(); let complete = false;
    for (let page = 0; page < 100; page++) {
      const raw = reader(configDir, ['drive', resource, 'list', '--params', JSON.stringify(params)]); const batch = raw[field];
      if (!Array.isArray(batch) || batch.some(x => !x || typeof x !== 'object' || Array.isArray(x))) throw new ProfileError('invalid candidate list');
      items.push(...batch.map(item => Object.fromEntries(Object.entries(item).filter(([key]) => ['id', 'name', 'mimeType', 'parents', 'driveId'].includes(key)))));
      const token = raw.nextPageToken; if (!token) { complete = true; break; }
      if (typeof token !== 'string' || seen.has(token)) throw new ProfileError('metadata pagination repeated; candidate list incomplete'); seen.add(token); params.pageToken = token;
    }
    if (!complete) throw new ProfileError('candidate limit reached; narrow the selected account scope'); groups[field] = items;
  }
  if (identity(configDir, reader) !== account) throw new ProfileError('selected account changed during discovery');
  return { schemaVersion: 1, configDir: expand(configDir), account, checkedAt: new Date().toISOString(), source: 'gws metadata', candidates: groups, saved: false };
}
export function verifySnapshot(snapshot: Snapshot, reader: MetadataReader = gwsJson): Record<string, unknown> {
  validateName(snapshot.profile); if (!snapshot.workspace || !snapshot.reporting) throw new ProfileError('profile has no workspace settings'); validate(snapshot.workspace, snapshot.reporting);
  if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 1 || [snapshot.workspace, snapshot.reporting].some(v => v.revision !== snapshot.revision)) throw new ProfileError('snapshot revisions do not match');
  if (identity(snapshot.workspace.configDir as string, reader) !== snapshot.workspace.account) throw new ProfileError('account binding changed; stop the current task');
  return { profile: snapshot.profile, revision: snapshot.revision, accountVerified: true };
}
export function sendMail(snapshot: Snapshot, subject: string, bodyFile: string, recipient?: string): Record<string, unknown> {
  verifySnapshot(snapshot); recipient ||= snapshot.reporting!.mailTo as string | undefined;
  if (!recipient || /[\r\n]/.test(recipient) || /[\r\n]/.test(subject)) throw new ProfileError('recipient and single-line subject are required'); checkOwned(bodyFile);
  const result = runProcess('gws', ['gmail', '+send', '--to', recipient, '--subject', subject, '--body', fs.readFileSync(bodyFile, 'utf8')], { env: accountEnv(snapshot.workspace!.configDir as string), timeout: 120000 });
  if (result.error || result.status !== 0) throw new ProfileError('mail request failed or timed out; inspect delivery before retrying');
  let data: Record<string, unknown>; try { data = JSON.parse(result.stdout); } catch { throw new ProfileError('mail response could not be verified; do not blindly retry'); }
  if (!data || typeof data !== 'object' || !data.id) throw new ProfileError('mail response has no message ID; do not blindly retry');
  return { sent: true, messageId: data.id, profile: snapshot.profile, revision: snapshot.revision };
}
const positionalExtra = (argv: string[]) => parseFlags(argv, ['default', 'remove-conventions']).positional.length > 2;
export function main(argv = process.argv.slice(2)): number {
  try {
    const { positional: [command, name], values } = parseFlags(argv, ['default', 'remove-conventions']); const required = (key: string) => { const value = values[key]; if (typeof value !== 'string') throw new ProfileError(`--${key} is required`); return value; };
    const store = new Store(values['state-root'] as string | undefined); let result: unknown;
    switch (command) {
      case 'inspect': result = store.inspect(); break;
      case 'discover': result = discover(required('config-dir')); break;
      case 'load': result = store.load(values.profile as string | undefined); break;
      case 'save': {
        const optional = (key: string) => typeof values[key] === 'string' ? readJson(values[key] as string) : undefined;
        if (values['remove-conventions'] === true && typeof values.conventions === 'string') throw new ProfileError('--conventions and --remove-conventions cannot be combined');
        if (command === 'save' && positionalExtra(argv)) throw new ProfileError('unexpected argument; --remove-conventions and --default take no value');
        const conventions = values['remove-conventions'] === true ? null : optional('conventions') as ConventionsDocument | undefined;
        result = store.save(validateName(name), optional('workspace') as ProfileDocument | undefined, optional('reporting') as ProfileDocument | undefined, Number(required('expected-revision')), { makeDefault: values.default === true, conventions }); break;
      }
      case 'history': result = { profile: validateName(name), revisions: store.history(name) }; break;
      case 'restore': result = store.restoreRevision(validateName(name), Number(required('revision')), Number(required('expected-revision'))); break;
      case 'recover': result = store.recover(validateName(name)); break;
      case 'recover-lock': result = store.recoverLock(validateName(name)); break;
      case 'verify-account': result = verifySnapshot(readJson(required('snapshot')) as unknown as Snapshot); break;
      case 'send-mail': result = sendMail(readJson(required('snapshot')) as unknown as Snapshot, required('subject'), required('body-file'), values.to as string | undefined); break;
      default: throw new ProfileError('expected inspect, discover, load, save, history, restore, recover, verify-account, or send-mail');
    }
    process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return 0;
  } catch (error) { process.stderr.write(JSON.stringify({ error: (error as Error).message }) + '\n'); return 2; }
}
if (isMain(import.meta.url)) process.exitCode = main();
