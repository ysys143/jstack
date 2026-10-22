/** Optional, shadow-only TypeSafe System One judgments. No prompt or file content leaves jstack. */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { atomicWrite, checkOwned, privateDir, stat, withLock } from './os.js';

export type JevPoint = 'model-routing' | 'task-size' | 'project-checks';
export type JevMode = 'off' | 'shadow' | 'degraded' | 'cap' | 'circuit-open';
export interface ModelRoutingState {
  point: 'model-routing'; kind: 'extract' | 'implement' | 'design' | 'review';
  impact: 'low' | 'high'; constraints: 'simple' | 'complex';
  access: 'read-only' | 'workspace-write'; attempt: 1 | 2;
  eligible: { id: string; host: 'claude' | 'codex'; transport: 'native' | 'cli'; contextTokens: number }[];
}
export interface TaskSizeState {
  point: 'task-size'; workType: 'coding' | 'research' | 'document' | 'daily';
  impact: 'low' | 'high'; constraints: 'simple' | 'complex';
  changedFileCount: number; independentPartCount: number; delegationAllowed: boolean;
}
export interface ProjectChecksState {
  point: 'project-checks'; languages: ('python' | 'javascript' | 'go' | 'rust')[];
  configuredCheckerCount: number; missingManifestCount: number;
  missingCheckerCount: number; projectDecision: 'undecided' | 'configured' | 'without-setup';
}
export type JevState = ModelRoutingState | TaskSizeState | ProjectChecksState;
export type JevQuestion =
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'score'; instructions: string; criteria: string[] }
  | { type: 'noul'; instructions: string; criteria: { true: string; false: string } };
export interface JevAnswer { type: 'choice' | 'score' | 'noul'; choice?: string; score?: number; noul?: number; confidence?: number; probabilities?: Record<string, number>; }
export interface ShadowResult { answer: string; source: 'twin'; mode: JevMode; jev?: string; reason?: string; }
export interface ShadowOptions { env?: NodeJS.ProcessEnv; workspace: string; stateHome?: string; fetchFn?: typeof fetch; endpoint?: string; now?: () => number; }
export class JevConfigError extends Error {}
export class JevResponseError extends Error {}
export const JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
export const JEV_MODEL = 'jev-latest';
export const DEFAULT_TIMEOUT_MS = 250;
export const DEFAULT_MAX_REQUESTS = 20;
export const CIRCUIT_FAILURES = 3;
const POINTS: readonly JevPoint[] = ['model-routing', 'task-size', 'project-checks'];
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const boundedCount = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 2000000;
const safeId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9._:@+-]{1,80}$/.test(value);
const oneOf = (value: unknown, choices: readonly string[]) => typeof value === 'string' && choices.includes(value);
const sameKeys = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');

/** Reject caller-provided text and paths before constructing an external request. */
export function validateJevState(state: JevState): void {
  if (!object(state) || !POINTS.includes(state.point)) throw new JevConfigError('unknown Jev judgment point');
  if (state.point === 'model-routing') {
    if (!sameKeys(state, ['point','kind','impact','constraints','access','attempt','eligible']) ||
      !oneOf(state.kind, ['extract','implement','design','review']) || !oneOf(state.impact, ['low','high']) ||
      !oneOf(state.constraints, ['simple','complex']) || !oneOf(state.access, ['read-only','workspace-write']) ||
      ![1,2].includes(state.attempt) || !Array.isArray(state.eligible) || state.eligible.length < 1 || state.eligible.length > 64 ||
      new Set(state.eligible.map(row=>row.id)).size !== state.eligible.length ||
      state.eligible.some(row=>!object(row) || !sameKeys(row, ['id','host','transport','contextTokens']) || !safeId(row.id) ||
        !oneOf(row.host, ['claude','codex']) || !oneOf(row.transport, ['native','cli']) || !boundedCount(row.contextTokens)))
      throw new JevConfigError('model-routing state contains an unapproved field or value');
  } else if (state.point === 'task-size') {
    if (!sameKeys(state, ['point','workType','impact','constraints','changedFileCount','independentPartCount','delegationAllowed']) ||
      !oneOf(state.workType, ['coding','research','document','daily']) || !oneOf(state.impact, ['low','high']) ||
      !oneOf(state.constraints, ['simple','complex']) || !boundedCount(state.changedFileCount) ||
      !boundedCount(state.independentPartCount) || typeof state.delegationAllowed !== 'boolean')
      throw new JevConfigError('task-size state contains an unapproved field or value');
  } else if (!sameKeys(state, ['point','languages','configuredCheckerCount','missingManifestCount','missingCheckerCount','projectDecision']) ||
    !Array.isArray(state.languages) || state.languages.length > 4 ||
    new Set(state.languages).size !== state.languages.length || state.languages.some(name=>!oneOf(name,['python','javascript','go','rust'])) ||
    !boundedCount(state.configuredCheckerCount) || !boundedCount(state.missingManifestCount) ||
    !boundedCount(state.missingCheckerCount) || !oneOf(state.projectDecision,['undecided','configured','without-setup']))
    throw new JevConfigError('project-checks state contains an unapproved field or value');
}

export function questionFor(state: JevState): JevQuestion & { type: 'choice' } {
  validateJevState(state);
  if (state.point === 'model-routing') return { type: 'choice', instructions: 'Which already eligible candidate best fits the structured task requirements?',
    criteria: Object.fromEntries(state.eligible.map(row=>[row.id, `${row.host} ${row.transport} candidate with ${row.contextTokens} context tokens`])) };
  if (state.point === 'task-size') return { type: 'choice', instructions: 'Which bounded execution shape fits this task?',
    criteria: {
      local: 'Keep work with the current agent',
      ...(state.delegationAllowed && state.independentPartCount >= 1 ? { single: 'Delegate one separately checkable task' } : {}),
      ...(state.delegationAllowed && state.independentPartCount >= 2 ? { parallel: 'Split independent tasks across agents' } : {}),
    } };
  return { type: 'choice', instructions: 'What project-check action should be recommended for review?',
    criteria: { 'use-existing': 'Use already configured project checkers', 'offer-setup': 'Offer missing project or checker configuration', 'ask-user': 'Ask the user to decide whether to configure project checks' } };
}

/** Validate the current official lowercase answer contract, including the chosen criterion. */
export function validateAnswer(question: JevQuestion, value: unknown): JevAnswer {
  if (!object(value) || value.type !== question.type) throw new JevResponseError('Jev answer type does not match the question');
  if (question.type === 'choice') {
    if (typeof value.choice !== 'string' || !Object.hasOwn(question.criteria, value.choice) ||
      typeof value.confidence !== 'number' || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1 ||
      !object(value.probabilities) || Object.keys(value.probabilities).sort().join('\0') !== Object.keys(question.criteria).sort().join('\0') ||
      Object.values(value.probabilities).some(p=>typeof p !== 'number' || !Number.isFinite(p) || p < 0 || p > 1))
      throw new JevResponseError('invalid Jev choice answer');
  } else if (question.type === 'noul') {
    if (typeof value.noul !== 'number' || !Number.isFinite(value.noul) || value.noul < 0 || value.noul > 1)
      throw new JevResponseError('invalid Jev noul answer');
  } else if (typeof value.score !== 'number' || !Number.isFinite(value.score) || value.score < 0 || value.score > question.criteria.length - 1 ||
    typeof value.confidence !== 'number' || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1)
    throw new JevResponseError('invalid Jev score answer');
  return value as unknown as JevAnswer;
}

function numericEnv(value: string | undefined, fallback: number, max: number, name: string): number {
  if (value === undefined || value === '') return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > max) throw new JevConfigError(`${name} must be an integer from 1 to ${max}`);
  return number;
}
export function jevSettings(env: NodeJS.ProcessEnv = process.env): { enabled: Set<JevPoint>; timeoutMs: number; maxRequests: number; apiKey?: string } {
  const raw = env.JSTACK_JEV?.trim() ?? '';
  const active = env.JSTACK_JEV_ACTIVE_POINTS?.trim() ?? '';
  if (active && active !== 'off') throw new JevConfigError('active Jev points are not implemented; shadow mode only');
  const enabled = new Set<JevPoint>();
  if (raw && raw !== 'off') for (const name of raw.split(',')) {
    const point = name.trim();
    if (!POINTS.includes(point as JevPoint) || enabled.has(point as JevPoint)) throw new JevConfigError(`unknown or repeated Jev point: ${point}`);
    enabled.add(point as JevPoint);
  }
  return { enabled, timeoutMs: numericEnv(env.JSTACK_JEV_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 2000, 'JSTACK_JEV_TIMEOUT_MS'),
    maxRequests: numericEnv(env.JSTACK_JEV_MAX_REQUESTS, DEFAULT_MAX_REQUESTS, 100, 'JSTACK_JEV_MAX_REQUESTS'), apiKey: env.TYPESAFE_API_KEY };
}

export async function queryJev(state: JevState, question: JevQuestion, apiKey: string, timeoutMs: number,
  fetchFn: typeof fetch = fetch, endpoint = JEV_ENDPOINT): Promise<JevAnswer> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new JevResponseError('Jev request timed out')); }, timeoutMs); });
    const response = await Promise.race([fetchFn(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ state, questions: { decision: question }, model: JEV_MODEL }), signal: controller.signal }), timeout]);
    if (!response.ok) throw new JevResponseError(`Jev HTTP ${response.status}`);
    const data: unknown = await Promise.race([response.json(), timeout]);
    if (!object(data) || typeof data.model !== 'string' || !object(data.usage) ||
      !boundedCount(data.usage.input_tokens) || !boundedCount(data.usage.output_tokens) ||
      !object(data.answers) || !data.answers.decision) throw new JevResponseError('Jev response is missing required fields');
    return validateAnswer(question, data.answers.decision);
  } finally { if (timer) clearTimeout(timer); }
}

interface Budget { schemaVersion: 1; requests: number; failures: Record<JevPoint, number>; updatedAt: string; }
const fresh = (): Budget => ({ schemaVersion: 1, requests: 0, failures: { 'model-routing': 0, 'task-size': 0, 'project-checks': 0 }, updatedAt: new Date().toISOString() });
function canonicalHome(requested: string): string {
  const target = path.resolve(requested); let existing = target;
  while (!fs.existsSync(existing) && path.dirname(existing) !== existing) existing = path.dirname(existing);
  return path.join(fs.realpathSync(existing), path.relative(existing, target));
}
function statePaths(options: ShadowOptions): { dir: string; budget: string; log: string } {
  const env = options.env ?? process.env;
  const root = canonicalHome(options.stateHome ?? (env.XDG_STATE_HOME && path.isAbsolute(env.XDG_STATE_HOME) ? env.XDG_STATE_HOME : path.join(env.HOME ?? env.USERPROFILE ?? os.homedir(), '.local', 'state')));
  const session = env.JSTACK_JEV_SESSION_ID;
  if (session && !/^[A-Za-z0-9._-]{1,128}$/.test(session)) throw new JevConfigError('JSTACK_JEV_SESSION_ID must be an opaque identifier');
  const workspace = fs.realpathSync(options.workspace);
  const key = sha(JSON.stringify([workspace, session ?? 'workspace']));
  const dir = path.join(root, 'jstack', 'jev', key);
  return { dir, budget: path.join(dir, 'budget.json'), log: path.join(dir, 'shadow.jsonl') };
}
function readBudget(file: string): Budget {
  if (!stat(file)) return fresh();
  checkOwned(file);
  const data: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!object(data) || data.schemaVersion !== 1 || !boundedCount(data.requests) || !object(data.failures) ||
    !sameKeys(data.failures, POINTS) || POINTS.some(point=>!boundedCount((data.failures as Record<string, unknown>)[point])) || typeof data.updatedAt !== 'string')
    throw new JevConfigError('Jev budget state is malformed; no request was sent');
  return data as unknown as Budget;
}
function updateBudget(paths: ReturnType<typeof statePaths>, mutate: (budget: Budget) => boolean | void): Budget {
  privateDir(paths.dir);
  return withLock(`${paths.budget}.lock`, () => {
    const budget = readBudget(paths.budget);
    if (mutate(budget) === false) return budget;
    budget.updatedAt = new Date().toISOString();
    atomicWrite(paths.budget, Buffer.from(JSON.stringify(budget) + '\n'));
    return budget;
  });
}
function appendShadow(paths: ReturnType<typeof statePaths>, record: Record<string, unknown>): void {
  privateDir(paths.dir);
  withLock(`${paths.log}.lock`, () => {
    const previous = stat(paths.log) ? (checkOwned(paths.log), fs.readFileSync(paths.log)) : Buffer.alloc(0);
    const next = Buffer.concat([previous, Buffer.from(JSON.stringify(record) + '\n')]);
    if (next.length > 256 * 1024) throw new JevConfigError('Jev shadow log reached its size limit');
    atomicWrite(paths.log, next);
  });
}

/** The twin always controls behavior. This runs only at an explicit decision boundary, never inside a blocking hook. */
export async function compareShadow(state: JevState, twin: string, options: ShadowOptions): Promise<ShadowResult> {
  const settings = jevSettings(options.env);
  if (!settings.enabled.has(state.point) || !settings.apiKey) return { answer: twin, source: 'twin', mode: 'off' };
  const question = questionFor(state);
  if (!Object.hasOwn(question.criteria, twin)) throw new JevConfigError('actual twin answer is not a declared choice');
  const paths = statePaths(options);
  let mode: JevMode = 'shadow', reason: string | undefined, jev: string | undefined;
  try {
    let gate: 'run' | 'cap' | 'circuit-open' = 'run';
    updateBudget(paths, budget => {
      if (budget.failures[state.point] >= CIRCUIT_FAILURES) { gate = 'circuit-open'; return false; }
      else if (budget.requests >= settings.maxRequests) { gate = 'cap'; return false; }
      else budget.requests++;
    });
    if (gate !== 'run') return { answer: twin, source: 'twin', mode: gate };
  } catch { return { answer: twin, source: 'twin', mode: 'degraded', reason: 'Jev budget unavailable; no request was sent' }; }
  const started = options.now?.() ?? Date.now();
  try {
    const answer = await queryJev(state, question, settings.apiKey, settings.timeoutMs, options.fetchFn, options.endpoint);
    jev = answer.choice!;
    updateBudget(paths, budget => { budget.failures[state.point] = 0; });
  } catch (error) {
    mode = 'degraded'; reason = error instanceof JevResponseError ? error.message : 'Jev transport failed';
    try { updateBudget(paths, budget => { budget.failures[state.point]++; }); }
    catch { reason = 'Jev request and budget update failed'; }
  }
  try {
    appendShadow(paths, { point: state.point, schemaVersion: 1, inputSha256: sha(JSON.stringify(state)), twin, jev: jev ?? null,
      mode, reason: reason ?? null, latencyMs: Math.max(0, (options.now?.() ?? Date.now()) - started) });
  } catch { mode = 'degraded'; reason = 'Jev shadow log could not be recorded'; }
  return { answer: twin, source: 'twin', mode, ...(jev ? { jev } : {}), ...(reason ? { reason } : {}) };
}
