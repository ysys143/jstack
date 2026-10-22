/** Commit and branch conventions: built-in defaults, an organization profile's conventions.json, and the repository's own history. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { Store, readJson, validateConventions, validateName, type ConventionsDocument } from './profiles.js';
import { atomicWrite, privateDir, runProcess } from './os.js';

export type Language = 'en' | 'ko';
export interface Conventions {
  commitLanguage: Language; autocommitLanguage: Language; commitTypes: string[]; subjectMax: number; bodyWrap: number;
  subjectVerbEnding: 'none' | 'korean'; footerStyle: 'conventional' | 'resolves'; branchScheme: 'type-slash-desc' | 'folder-category-desc'; branchTypes: string[]; branchFolders: string[];
}
export const DEFAULT_CONVENTIONS: Readonly<Conventions> = Object.freeze({
  commitLanguage: 'en', autocommitLanguage: 'en', commitTypes: ['feat', 'fix', 'refactor', 'test', 'docs', 'chore', 'style', 'remove', 'perf'], subjectMax: 50, bodyWrap: 72,
  subjectVerbEnding: 'none', footerStyle: 'conventional', branchScheme: 'type-slash-desc', branchTypes: ['feat', 'fix', 'refactor', 'docs', 'test', 'chore'], branchFolders: [],
});
export class ConventionsError extends Error {}
/** `digest` identifies the conventions' content, so a choice survives saves that change only the workspace settings. */
export interface Loaded { values: Conventions; source: string; profile?: string; revision?: number; digest?: string; explicit?: string[]; warnings: string[] }

/** Profile values over the defaults; an automatic commit language the profile leaves unset follows its commit language. */
function merge(document: ConventionsDocument): Conventions {
  const values = { ...DEFAULT_CONVENTIONS } as Conventions;
  for (const key of Object.keys(DEFAULT_CONVENTIONS) as (keyof Conventions)[]) if (document[key] !== undefined) (values as unknown as Record<string, unknown>)[key] = document[key];
  if (document.autocommitLanguage === undefined) values.autocommitLanguage = values.commitLanguage;
  return values;
}
const explicitKeys = (document: ConventionsDocument) => Object.keys(document).filter(key => key in DEFAULT_CONVENTIONS);
const defaults = (warnings: string[] = [], profile?: string): Loaded => ({ values: { ...DEFAULT_CONVENTIONS }, source: 'default', ...(profile ? { profile } : {}), warnings });
export function conventionsDigest(values: Conventions): string { return createHash('sha256').update(JSON.stringify(Object.keys(values).sort().map(key => [key, values[key as keyof Conventions]]))).digest('hex').slice(0, 16); }

/**
 * JSTACK_CONVENTIONS_FILE (tests only) wins, then the named (JSTACK_PROFILE) or default profile. A missing state root, profile or
 * conventions file gives the defaults without taking the profile lock; an unreadable profile gives the defaults with a warning.
 */
export function loadConventions(options: { stateRoot?: string; profile?: string; env?: NodeJS.ProcessEnv } = {}): Loaded {
  const env = options.env ?? process.env;
  if (env.JSTACK_CONVENTIONS_FILE) {
    const file = env.JSTACK_CONVENTIONS_FILE; let document: ConventionsDocument;
    try { document = readJson(file) as ConventionsDocument; validateConventions(document); }
    catch (error) { throw new ConventionsError(`JSTACK_CONVENTIONS_FILE ${file}: ${(error as Error).message}`); }
    const values = merge(document); return { values, source: `file:${file}`, digest: conventionsDigest(values), explicit: explicitKeys(document), warnings: [] };
  }
  const store = new Store(options.stateRoot);
  if (!fs.existsSync(path.join(store.root, 'profiles'))) return defaults();
  let profile = options.profile ?? (env.JSTACK_PROFILE || undefined);
  if (profile === undefined) {
    const config = path.join(store.root, 'config.json'); if (!fs.existsSync(config)) return defaults();
    try { profile = validateName((readJson(config) as { defaultProfile?: unknown }).defaultProfile); } catch (error) { return defaults([`default profile not used: ${(error as Error).message}`]); }
  }
  try { if (!fs.existsSync(path.join(store.directory(profile), 'conventions.json'))) return defaults([], profile); }
  catch (error) { return defaults([`profile conventions not used: ${(error as Error).message}`]); }
  try {
    const snapshot = store.peek(profile);
    if (!snapshot.conventions) return defaults([], snapshot.profile);
    const values = merge(snapshot.conventions);
    return { values, source: `profile:${snapshot.profile}`, profile: snapshot.profile, revision: snapshot.revision, digest: conventionsDigest(values), explicit: explicitKeys(snapshot.conventions), warnings: [] };
  } catch (error) {
    return defaults([`profile conventions not used: ${(error as Error).message}`]);
  }
}

const HANGUL = /[ㄱ-ㆎ가-힣]/;
export interface Observation { language: Language | 'mixed' | 'unknown'; sampled: number; korean: number }
/** Language of the last commit subjects: ko or en at 80% or more of at least ten subjects, else mixed (or unknown below ten). */
export function observeLanguage(subjects: string[]): Observation {
  const described = subjects.map(subject => subject.replace(/^[a-z]+(\([^)]*\))?!?:\s*/, '')).filter(Boolean);
  const korean = described.filter(subject => HANGUL.test(subject)).length, sampled = described.length;
  if (sampled < 10) return { language: 'unknown', sampled, korean };
  if (korean / sampled >= 0.8) return { language: 'ko', sampled, korean };
  if (korean / sampled <= 0.2) return { language: 'en', sampled, korean };
  return { language: 'mixed', sampled, korean };
}
export function repositorySubjects(root: string, count = 20): string[] {
  const result = runProcess('git', ['log', `-${count}`, '--no-merges', '--format=%s'], { cwd: root, encoding: 'utf8' });
  return result.status === 0 ? String(result.stdout).split('\n').filter(Boolean) : [];
}

export type Choice = 'repository' | 'profile';
export interface ChoiceRecord { schemaVersion: 1; choice: Choice; profile: string; conventionsDigest: string; observed: Language; decidedAt: string }
/** Stored beside the shared Git directory, so every linked worktree of a repository sees the same choice. */
export function choicePath(root: string): string | undefined {
  const result = runProcess('git', ['rev-parse', '--git-common-dir'], { cwd: root, encoding: 'utf8' });
  return result.status === 0 ? path.join(path.resolve(root, String(result.stdout).trim()), 'jstack', 'conventions-choice.json') : undefined;
}
function readChoice(file: string | undefined): ChoiceRecord | undefined {
  if (!file || !fs.existsSync(file)) return undefined;
  try { const value = JSON.parse(fs.readFileSync(file, 'utf8')) as ChoiceRecord; return value.schemaVersion === 1 && ['repository', 'profile'].includes(value.choice) && typeof value.conventionsDigest === 'string' ? value : undefined; } catch { return undefined; }
}

const LANGUAGE_FIELDS = ['commitLanguage', 'autocommitLanguage'] as const;
export interface Conflict { fields: (typeof LANGUAGE_FIELDS[number])[]; profileValues: Partial<Record<typeof LANGUAGE_FIELDS[number], Language>>; observed: Observation; recommendation: Choice; reason: string }
export interface Effective { values: Conventions; loaded: Loaded; conflict?: Conflict; choice?: ChoiceRecord }
function followRepository(values: Conventions, language: Language): Conventions {
  return { ...values, commitLanguage: language, autocommitLanguage: language, subjectVerbEnding: language === 'en' ? 'none' : values.subjectVerbEnding };
}

/**
 * A profile language that differs from a clear repository history is a conflict the user decides; nothing is picked silently.
 * A recorded choice for the same conventions keeps applying while the history is mixed or too short, and is asked again only
 * when the history turns to the other language. Subjects are read only for profile conventions.
 */
export function effectiveConventions(root: string, loaded = loadConventions(), subjects?: string[]): Effective {
  if (!loaded.source.startsWith('profile:')) return { values: loaded.values, loaded };
  const observed = observeLanguage(subjects ?? repositorySubjects(root));
  const choiceRecord = readChoice(choicePath(root));
  const choice = choiceRecord && choiceRecord.profile === loaded.profile && choiceRecord.conventionsDigest === loaded.digest ? choiceRecord : undefined;
  const clear = observed.language === 'en' || observed.language === 'ko' ? observed.language : undefined;
  if (choice && (!clear || clear === choice.observed)) return { values: choice.choice === 'profile' ? loaded.values : followRepository(loaded.values, choice.observed), loaded, choice };
  if (!clear) return { values: loaded.values, loaded };
  // Only a language the profile states can disagree with the repository; an unset one is a default, not a claim.
  const fields = LANGUAGE_FIELDS.filter(field => (loaded.explicit ?? []).includes(field) && loaded.values[field] !== clear);
  if (!fields.length) return { values: loaded.values, loaded };
  const reason = `${observed.sampled} recent commit subjects here are consistently ${clear === 'ko' ? 'Korean' : 'English'}; following the repository keeps its history readable for the people who already work in it.`;
  return { values: loaded.values, loaded, conflict: { fields, profileValues: Object.fromEntries(fields.map(field => [field, loaded.values[field]])), observed, recommendation: 'repository', reason } };
}

export function describeConflict(effective: Effective): string[] {
  const conflict = effective.conflict!, { loaded } = effective, name = loaded.profile!;
  const language = conflict.observed.language === 'ko' ? 'Korean' : 'English';
  const share = conflict.observed.language === 'ko' ? conflict.observed.korean : conflict.observed.sampled - conflict.observed.korean;
  const settings = conflict.fields.map(field => `${field}=${conflict.profileValues[field]}`).join(' and ');
  return [
    '[decision needed] commit language for this repository',
    `  Current state: profile ${name} (revision ${loaded.revision}) sets ${settings}; ${share} of the last ${conflict.observed.sampled} commit subjects here are ${language}.`,
    `  Recommendation: ${conflict.recommendation} — ${conflict.reason}`,
    '  Choices: follow this repository (--choose repository), follow the profile (--choose profile), or change the profile itself.',
    `  Rollback: a choice is recorded for this repository and can be changed by choosing again. The profile keeps each earlier revision after its first save: \`jst profiles history ${name}\` lists them, \`jst profiles restore ${name} --revision N --expected-revision ${loaded.revision}\` brings one back with all of its files, Workspace settings included, and \`jst profiles save ${name} --remove-conventions --expected-revision ${loaded.revision}\` removes the conventions.`,
    '  Ask the user which to use before committing; do not choose for them.',
  ];
}

export function recordChoice(root: string, choice: Choice, effective: Effective): ChoiceRecord {
  if (!effective.conflict && !effective.choice) throw new ConventionsError('no conventions conflict to decide in this repository');
  const file = choicePath(root); if (!file) throw new ConventionsError('not a Git repository');
  const observed = (effective.conflict ? effective.conflict.observed.language : effective.choice!.observed) as Language;
  const record: ChoiceRecord = { schemaVersion: 1, choice, profile: effective.loaded.profile!, conventionsDigest: effective.loaded.digest!, observed, decidedAt: new Date().toISOString() };
  privateDir(path.dirname(file)); atomicWrite(file, Buffer.from(JSON.stringify(record, null, 2) + '\n'));
  return record;
}
