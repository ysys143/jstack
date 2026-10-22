/** Local project hook decision state. Never creates repository `.jstack/` and never infers approval. */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawnSync } from 'node:child_process';
import { StateError, atomicWrite, checkOwned, privateDir, stat, withLock } from '../os.js';
import type { Fingerprint } from './fingerprint.js';

export const SCHEMA_VERSION = 1;
export type Decision = 'undecided' | 'configured' | 'without-setup';
export type Choice = Exclude<Decision, 'undecided'>;
export type Host = 'claude' | 'codex' | 'unknown';
/** Only explicit sources exist. There is intentionally no `inferred` provenance. */
export type Provenance = 'explicit-user' | 'explicit-command';
export type DiagnosticStatus = 'pass' | 'fail' | 'incomplete' | 'unknown';

/**
 * Evidence of an actual user answer or user-invoked command. `messageRef` is an opaque
 * host message or command-invocation reference (never prompt text); `answerSha256`
 * hashes the user's answer so the record is checkable without storing it.
 * `explicit-user` needs both; `explicit-command` needs the invocation reference.
 */
export interface Approval {
  provenance: Provenance; choice: Choice; host: Host; recordedAt: string;
  messageRef: string;
  answerSha256?: string;
}
/** Set by hook processes (the dispatcher). Decision writers refuse to run under it. */
export const HOOK_CONTEXT_ENV = 'JSTACK_HOOK_CONTEXT';
function assertNotHook(env: NodeJS.ProcessEnv = process.env): void {
  if (env[HOOK_CONTEXT_ENV]) throw new StateError('project decisions can only be recorded or reopened from a user-invoked command, not from a hook');
}
export interface Diagnostic {
  status: DiagnosticStatus; checkedAt: string; fingerprint: Fingerprint;
  /** Attempts made against this fingerprint digest without a pass. */
  attempts: number;
  /** Short machine-generated summary; no file contents, prompts, or credentials. */
  summary?: string;
}
export interface PendingPrompt { since: string; host: Host; }
export interface HookState {
  schemaVersion: typeof SCHEMA_VERSION; revision: number;
  location: { kind: StateLocation['kind']; key: string };
  decision: Decision; approval?: Approval; history: Omit<Approval, 'messageRef' | 'answerSha256'>[];
  pending?: PendingPrompt;
  observed: { host: Host; jstackVersion: string };
  diagnostic?: Diagnostic; updatedAt: string;
}
export interface StateLocation { kind: 'git' | 'directory'; key: string; file: string; root: string; }
export type ReadStatus = 'missing' | 'ok' | 'malformed' | 'incompatible';
export interface ReadResult { state: HookState; status: ReadStatus; explanation?: string; }
export class StateConflict extends StateError {
  constructor(readonly current: ReadResult) { super(`project hook state changed concurrently (revision ${current.state.revision}); re-read before deciding`); }
}

const HOSTS: readonly Host[] = ['claude', 'codex', 'unknown'];
const PROVENANCE: readonly Provenance[] = ['explicit-user', 'explicit-command'];
const DECISIONS: readonly Decision[] = ['undecided', 'configured', 'without-setup'];
const STATUSES: readonly DiagnosticStatus[] = ['pass', 'fail', 'incomplete', 'unknown'];
const HISTORY_LIMIT = 20;
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const isoNow = (now?: number) => new Date(now ?? Date.now()).toISOString();

/** User-local cache root for non-Git workspaces. Distinct from `~/.jstack` profiles and task records. */
export function defaultStateHome(env: NodeJS.ProcessEnv = process.env, home = os.homedir()): string {
  if (env.XDG_STATE_HOME && path.isAbsolute(env.XDG_STATE_HOME)) return path.join(env.XDG_STATE_HOME, 'jstack', 'project-hooks');
  if (process.platform === 'win32' && env.LOCALAPPDATA) return path.join(env.LOCALAPPDATA, 'jstack', 'project-hooks');
  return path.join(home, '.local', 'state', 'jstack', 'project-hooks');
}

/** Resolve any existing symlinked parent before privateDir checks the state path. */
function canonicalStateHome(requested: string): string {
  const target = path.resolve(requested);
  let existing = target;
  while (!fs.existsSync(existing) && path.dirname(existing) !== existing) existing = path.dirname(existing);
  return path.join(fs.realpathSync(existing), path.relative(existing, target));
}

/**
 * Resolve the worktree-specific Git directory (not the common directory, which linked
 * worktrees share). Falls back to a keyed user-local cache outside the workspace.
 */
export function resolveStateLocation(cwd = process.cwd(), options: { stateHome?: string } = {}): StateLocation {
  const real = fs.realpathSync(cwd);
  const git = spawnSync('git', ['rev-parse', '--absolute-git-dir', '--show-toplevel'], { cwd: real, encoding: 'utf8', timeout: 5000, windowsHide: true });
  const lines = git.status === 0 ? git.stdout.split(/\r?\n/).filter(Boolean) : [];
  if (lines.length === 2) {
    const gitDir = fs.realpathSync(lines[0]!); const root = fs.realpathSync(lines[1]!);
    return { kind: 'git', key: sha(`git:${gitDir}`), file: path.join(gitDir, 'jstack', 'hook-state.json'), root };
  }
  // Bare repositories and non-Git directories: key by real path so a moved or copied
  // directory does not carry consent to a different location.
  const key = sha(`directory:${real}`);
  return { kind: 'directory', key, file: path.join(canonicalStateHome(options.stateHome ?? defaultStateHome()), key, 'hook-state.json'), root: real };
}

export function initialState(location: StateLocation, observed: HookState['observed'] = { host: 'unknown', jstackVersion: 'unknown' }, now?: number): HookState {
  return { schemaVersion: SCHEMA_VERSION, revision: 0, location: { kind: location.kind, key: location.key }, decision: 'undecided', history: [], observed, updatedAt: isoNow(now) };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isIso = (v: unknown) => typeof v === 'string' && !Number.isNaN(Date.parse(v));
const shortText = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max && !v.includes('\0');

export function validateApproval(value: unknown): asserts value is Approval {
  if (!isObject(value)) throw new StateError('approval must be an object');
  if (!PROVENANCE.includes(value.provenance as Provenance)) throw new StateError('approval provenance must be explicit-user or explicit-command');
  if (value.choice !== 'configured' && value.choice !== 'without-setup') throw new StateError('approval choice must be configured or without-setup');
  if (!HOSTS.includes(value.host as Host)) throw new StateError('approval host is invalid');
  if (!isIso(value.recordedAt)) throw new StateError('approval recordedAt must be an ISO timestamp');
  if (!shortText(value.messageRef, 200)) throw new StateError('approval needs a messageRef naming the actual user message or command invocation');
  if (value.answerSha256 !== undefined && !(typeof value.answerSha256 === 'string' && /^[0-9a-f]{64}$/.test(value.answerSha256))) throw new StateError('approval answerSha256 must be a SHA-256 hex digest');
  if (value.provenance === 'explicit-user' && value.answerSha256 === undefined) throw new StateError('explicit-user approval needs answerSha256 of the actual answer');
}
/** Hash a user's answer for Approval.answerSha256. The text itself is not stored. */
export const answerDigest = (answer: string) => sha(answer.normalize('NFC').trim());
function validFingerprint(v: unknown): boolean {
  return isObject(v) && typeof v.digest === 'string' && /^[0-9a-f]{64}$/.test(v.digest) && isObject(v.components)
    && Object.values(v.components).every(c => typeof c === 'string');
}
function validDiagnostic(v: unknown): v is Diagnostic {
  return isObject(v) && STATUSES.includes(v.status as DiagnosticStatus) && isIso(v.checkedAt) && validFingerprint(v.fingerprint)
    && Number.isSafeInteger(v.attempts) && (v.attempts as number) >= 0 && (v.summary === undefined || shortText(v.summary, 500));
}
function parseState(raw: string, location: StateLocation): ReadResult | HookState {
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return fallback(location, 'malformed', 'project hook state is not valid JSON; treating the project as undecided'); }
  if (!isObject(data)) return fallback(location, 'malformed', 'project hook state is not a JSON object; treating the project as undecided');
  if (data.schemaVersion !== SCHEMA_VERSION) return fallback(location, 'incompatible', `project hook state schema ${JSON.stringify(data.schemaVersion)} is not supported (expected ${SCHEMA_VERSION}); treating the project as undecided`);
  const loc = data.location;
  if (!isObject(loc) || loc.kind !== location.kind || loc.key !== location.key) return fallback(location, 'incompatible', 'project hook state belongs to a different location; local consent is not portable, treating the project as undecided');
  const bad = (why: string) => fallback(location, 'malformed', `project hook state ${why}; treating the project as undecided`);
  if (!Number.isSafeInteger(data.revision) || (data.revision as number) < 0) return bad('has an invalid revision');
  if (!DECISIONS.includes(data.decision as Decision)) return bad('has an unknown decision');
  if (data.decision === 'undecided' ? data.approval !== undefined : data.approval === undefined) return bad('decision and approval disagree');
  if (data.approval !== undefined) {
    try { validateApproval(data.approval); } catch (error) { return bad(`has an invalid approval (${(error as Error).message})`); }
    if ((data.approval as Approval).choice !== data.decision) return bad('approval choice does not match the decision');
  }
  if (!Array.isArray(data.history)) return bad('has invalid history');
  if (data.pending !== undefined && !(isObject(data.pending) && isIso(data.pending.since) && HOSTS.includes(data.pending.host as Host))) return bad('has an invalid pending prompt');
  if (!isObject(data.observed) || !HOSTS.includes(data.observed.host as Host) || typeof data.observed.jstackVersion !== 'string') return bad('has invalid observed metadata');
  if (data.diagnostic !== undefined && !validDiagnostic(data.diagnostic)) return bad('has an invalid diagnostic');
  if (!isIso(data.updatedAt)) return bad('has an invalid timestamp');
  return data as unknown as HookState;
}
function fallback(location: StateLocation, status: ReadStatus, explanation: string): ReadResult {
  return { state: initialState(location), status, explanation };
}

/** Read without side effects. Malformed or incompatible state is left in place and reported as undecided. */
export function readState(location: StateLocation): ReadResult {
  if (!stat(location.file)) return { state: initialState(location), status: 'missing' };
  try { checkOwned(location.file); }
  catch (error) { return fallback(location, 'malformed', `project hook state is not a private owned file (${(error as Error).message}); treating the project as undecided`); }
  const parsed = parseState(fs.readFileSync(location.file, 'utf8'), location);
  return 'status' in parsed && 'state' in parsed ? parsed as ReadResult : { state: parsed as HookState, status: 'ok' };
}

/**
 * Compare-and-swap update under the shared mkdir lock. The mutation sees the freshly
 * re-read state; a revision mismatch throws StateConflict so callers re-read rather
 * than prompting or deciding twice. Malformed state is only replaced by an explicit
 * decision (see recordDecision), never by bookkeeping writes.
 */
function update(location: StateLocation, expectedRevision: number, mutate: (current: ReadResult) => HookState, options: { replaceInvalid?: boolean } = {}): HookState {
  privateDir(path.dirname(location.file));
  return withLock(`${location.file}.lock`, () => {
    const current = readState(location);
    if ((current.status === 'malformed' || current.status === 'incompatible') && !options.replaceInvalid)
      throw new StateError(`${current.explanation}; only an explicit decision may replace it`);
    const currentRevision = current.status === 'ok' ? current.state.revision : 0;
    if (currentRevision !== expectedRevision) throw new StateConflict(current);
    const next = mutate(current);
    next.revision = currentRevision + 1;
    atomicWrite(location.file, Buffer.from(`${JSON.stringify(next, null, 2)}\n`));
    return next;
  });
}

export interface RecordDecisionInput { approval: Approval; expectedRevision: number; observed?: HookState['observed']; now?: number; }
/**
 * Record the user's actual answer. Only a user-invoked command path may call this;
 * hooks return a pending decision instead. Replaces malformed state only because the
 * choice is explicit.
 */
export function recordDecision(location: StateLocation, input: RecordDecisionInput, env: NodeJS.ProcessEnv = process.env): HookState {
  assertNotHook(env);
  validateApproval(input.approval);
  return update(location, input.expectedRevision, current => {
    const base = current.status === 'ok' ? current.state : initialState(location);
    const { messageRef: _m, answerSha256: _a, ...summary } = input.approval;
    return {
      ...base, decision: input.approval.choice, approval: input.approval, pending: undefined,
      history: [...base.history, summary].slice(-HISTORY_LIMIT),
      observed: input.observed ?? base.observed, updatedAt: isoNow(input.now),
    };
  }, { replaceInvalid: true });
}

/** Explicit user command to reopen the question. The next relevant action asks again. */
export function reopenDecision(location: StateLocation, input: { provenance: Provenance; host: Host; messageRef: string; expectedRevision: number; now?: number }, env: NodeJS.ProcessEnv = process.env): HookState {
  assertNotHook(env);
  if (!PROVENANCE.includes(input.provenance)) throw new StateError('reopening requires an explicit provenance');
  if (!shortText(input.messageRef, 200)) throw new StateError('reopening needs a messageRef naming the user command invocation');
  return update(location, input.expectedRevision, current => {
    const { approval: _approval, ...rest } = current.state;
    return { ...rest, decision: 'undecided', pending: undefined, updatedAt: isoNow(input.now) };
  }, { replaceInvalid: true });
}

/**
 * Claim the single pending prompt for an undecided project. Returns false when another
 * process already surfaced it within `ttlMs`, so concurrent first actions do not
 * duplicate the question. This records that a question was asked, never an answer.
 */
export function claimPendingPrompt(location: StateLocation, input: { host: Host; ttlMs?: number; now?: number }): { claimed: boolean; state: HookState } {
  const now = input.now ?? Date.now(); const ttl = input.ttlMs ?? 10 * 60 * 1000;
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = readState(location);
    if (current.status === 'malformed' || current.status === 'incompatible') return { claimed: true, state: current.state };
    if (current.state.decision !== 'undecided') return { claimed: false, state: current.state };
    const pending = current.state.pending;
    if (pending && now - Date.parse(pending.since) < ttl) return { claimed: false, state: current.state };
    try {
      const state = update(location, current.state.revision, c => ({ ...c.state, pending: { since: isoNow(now), host: input.host }, updatedAt: isoNow(now) }));
      return { claimed: true, state };
    } catch (error) { if (!(error instanceof StateConflict)) throw error; }
  }
  throw new StateError('could not claim the pending project decision after repeated concurrent updates');
}

/**
 * Record a diagnostic result. Attempts accumulate per fingerprint digest until a pass,
 * so callers can bound retries. A non-pass result is stored but never reused as success.
 */
export function recordDiagnostic(location: StateLocation, input: { status: DiagnosticStatus; fingerprint: Fingerprint; summary?: string; expectedRevision: number; now?: number }): HookState {
  if (!STATUSES.includes(input.status)) throw new StateError('invalid diagnostic status');
  if (input.summary !== undefined && !shortText(input.summary, 500)) throw new StateError('diagnostic summary must be 1-500 characters');
  return update(location, input.expectedRevision, current => {
    const previous = current.state.diagnostic;
    const carried = previous && previous.status !== 'pass' && previous.fingerprint.digest === input.fingerprint.digest ? previous.attempts : 0;
    const attempts = input.status === 'pass' ? 0 : carried + 1;
    const diagnostic: Diagnostic = { status: input.status, checkedAt: isoNow(input.now), fingerprint: input.fingerprint, attempts, ...(input.summary ? { summary: input.summary } : {}) };
    return { ...current.state, diagnostic, updatedAt: isoNow(input.now) };
  });
}

/** Human-facing description of the current decision for diagnostics and the reopen command. */
export function describeState(result: ReadResult): string {
  const { state } = result;
  const lines = [`decision: ${state.decision}`];
  if (result.explanation) lines.push(`note: ${result.explanation}`);
  if (state.approval) lines.push(`approved: ${state.approval.provenance} via ${state.approval.host} at ${state.approval.recordedAt}`);
  if (state.diagnostic) lines.push(`diagnostic: ${state.diagnostic.status} at ${state.diagnostic.checkedAt}${state.diagnostic.summary ? ` (${state.diagnostic.summary})` : ''}`);
  return lines.join('\n');
}
