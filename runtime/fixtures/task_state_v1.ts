// Frozen mixed-writer test fixture: 65db0860 runtime/task_state.ts. Not a runtime entry.
/** Request continuity and observed work. No model selection, scheduling or provider writes. */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertNoLinks, atomicWrite, checkOwned, privateDir, withLock } from '../os.js';

export interface Source { message: string; quote: string; role: 'user'; }
export interface Requirement { id: string; text: string; kind: 'code' | 'research' | 'document'; revision: number; active: boolean; independent: boolean; }
export interface Ref { path: string; sha256: string; snapshot?: string; }
export interface Proof {
  requirement: string; revision: number; constraintsRevision: number; result: 'pass' | 'fail' | 'unknown';
  method: 'review' | 'workflow'; rationale: string; artifacts: Ref[]; sources: string[];
  observer: string; independence: 'self' | 'reported-independent' | 'unknown'; observation?: Ref; attempt?: string;
  workflow?: { cwd: string; task: string; requirement: string; receipt: Ref };
}
export interface Attempt {
  id: string; requirements: Record<string, number>; operation: string;
  state: 'running' | 'stopped' | 'ended'; handle: string; observedAt: number; observation: Ref;
  pid?: number; reason?: string; artifacts: Ref[]; constraintsRevision: number;
}
export interface Task {
  schemaVersion: 1; id: string; revision: number; workspace: string; root: string; purpose: string;
  constraints: string[]; constraintsRevision: number; authorized: string[]; sessions: string[];
  requirements: Requirement[]; attempts: Attempt[]; proofs: Proof[];
  external: Record<string, { state: 'unknown' | 'present' | 'absent'; observation: Ref; attempt: string }>;
  history: { revision: number; at: number; action: string; input: unknown }[];
  budget?: { maxAttempts?: number; seconds?: number }; startedAt?: number;
}
export interface Context { root: string; workspace: string; directory: string; session?: string; now?: number; }
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const idPattern = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
function text(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) throw new Error(`Invalid ${label}`);
}
function identifier(value: unknown): asserts value is string { if (typeof value !== 'string' || !idPattern.test(value) || ['constructor', 'prototype'].includes(value)) throw new Error('Invalid identifier'); }
function strings(value: unknown, label: string): asserts value is string[] {
  if (!Array.isArray(value)) throw new Error(`Invalid ${label}`); value.forEach(x => text(x, label));
  if (new Set(value).size !== value.length) throw new Error(`Duplicate ${label}`);
}
function source(value: unknown): asserts value is Source {
  const s = value as Source; if (!s || s.role !== 'user') throw new Error('A user message reference is required');
  text(s.message, 'message reference'); text(s.quote, 'user quote');
}
export function context(root = process.cwd(), home = homedir(), session?: string): Context {
  root = fs.realpathSync(root); home = fs.realpathSync(home);
  const git = spawnSync('git', ['rev-parse', '--git-common-dir'], { cwd: root, encoding: 'utf8', timeout: 5000 });
  const identity = git.status === 0 ? `git:${fs.realpathSync(path.resolve(root, git.stdout.trim()))}` : `directory:${root}`;
  const workspace = sha(identity);
  return { root, workspace, directory: path.join(home, '.jstack', 'workspaces', workspace), session };
}
function file(c: Context, id: string): string { identifier(id); return path.join(c.directory, `${id}.json`); }
export function load(c: Context, id: string): Task {
  const p = file(c, id); assertNoLinks(p); checkOwned(p);
  const t = JSON.parse(fs.readFileSync(p, 'utf8')) as Task;
  if (t.schemaVersion !== 1 || t.id !== id || t.workspace !== c.workspace || !Number.isInteger(t.revision)) throw new Error('Invalid task identity');
  return t;
}
function reference(root: string, name: unknown): Ref {
  text(name, 'artifact path'); const p = path.resolve(root, name);
  assertNoLinks(p);
  if (!fs.statSync(p).isFile()) throw new Error('Evidence must be a file');
  return { path: p, sha256: sha(fs.readFileSync(p)) };
}
function fresh(ref: Ref): boolean {
  try { return reference('/', ref.path).sha256 === ref.sha256; } catch { return false; }
}
function refs(root: string, names: unknown): Ref[] { strings(names, 'artifact paths'); return names.map(n => reference(root, n)); }
function preserve(c: Context, root: string, names: unknown): Ref[] {
  return refs(root, names).map(ref => {
    const directory = path.join(c.directory, 'artifacts'); privateDir(directory);
    const snapshot = path.join(directory, ref.sha256);
    const bytes = fs.readFileSync(ref.path);
    if (sha(bytes) !== ref.sha256) throw new Error('Partial output changed while preserving it');
    atomicWrite(snapshot, bytes);
    return { ...ref, snapshot };
  });
}
function workflow(cwd: string, task: string, allowFailure = false): { status: any; receipt: any; ref: Ref } {
  identifier(task);
  const script = fileURLToPath(new URL('../skills/public/workflow/verify/scripts/workflow.js', import.meta.url));
  const result = spawnSync(process.execPath, [script, 'status', task], { cwd, encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
  if (![0, 1].includes(result.status ?? -1)) throw new Error('Workflow verification is unavailable');
  const status = JSON.parse(result.stdout);
  if (!status.complete && !(allowFailure && status.receipt && status.problems?.every((p: string) => ['verification-required', 'receipt-failed'].includes(p)))) throw new Error('Workflow verification is missing, failed or stale');
  const ref = reference(cwd, status.receipt);
  const receipt = JSON.parse(fs.readFileSync(ref.path, 'utf8'));
  return { status, receipt, ref };
}
export function capture(c: Context, input: any): Task {
  identifier(input.id); source(input.source);
  privateDir(c.directory);
  return withLock(path.join(c.directory, `${input.id}.lock`), () => {
    const exists = fs.existsSync(file(c, input.id));
    const t: Task = exists ? load(c, input.id) : {
      schemaVersion: 1, id: input.id, revision: 0, workspace: c.workspace, root: c.root, purpose: '',
      constraints: [], constraintsRevision: 0, authorized: [], sessions: [], requirements: [], attempts: [], proofs: [], external: {}, history: [],
    };
    if (input.expectedRevision !== t.revision) throw new Error(`Revision conflict: current ${t.revision}`);
    if (input.purpose !== undefined) {
      text(input.purpose, 'purpose');
      if (t.purpose && t.purpose !== input.purpose) throw new Error('A different purpose needs a new task; amend its requirements instead');
      t.purpose = input.purpose;
    }
    text(t.purpose, 'purpose');
    if (input.constraints !== undefined) {
      strings(input.constraints, 'constraints');
      const combined = [...new Set([...t.constraints, ...input.constraints])];
      if (JSON.stringify(t.constraints) !== JSON.stringify(combined)) { t.constraints = combined; t.constraintsRevision++; }
    }
    if (input.removeConstraints !== undefined) {
      strings(input.removeConstraints, 'removed constraints');
      if (input.removeConstraints.some((v: string) => !t.constraints.includes(v))) throw new Error('Unknown constraint');
      t.constraints = t.constraints.filter(v => !input.removeConstraints.includes(v)); t.constraintsRevision++;
    }
    if (input.authorized !== undefined) { strings(input.authorized, 'authorized operations'); t.authorized = input.authorized; }
    if (input.requirements !== undefined) {
      if (!Array.isArray(input.requirements)) throw new Error('Invalid requirements');
      const seen = new Set<string>();
      for (const row of input.requirements) {
        identifier(row.id); text(row.text, 'requirement');
        if (seen.has(row.id) || !['code', 'research', 'document'].includes(row.kind) || row.independent !== undefined && typeof row.independent !== 'boolean') throw new Error('Invalid requirement');
        seen.add(row.id);
        const prior = t.requirements.find(r => r.id === row.id);
        const independent = row.independent ?? prior?.independent ?? false;
        if (prior) {
          if (!prior.active || prior.text !== row.text || prior.kind !== row.kind || prior.independent !== independent) prior.revision++;
          Object.assign(prior, { text: row.text, kind: row.kind, active: true, independent });
        } else t.requirements.push({ id: row.id, text: row.text, kind: row.kind, revision: 1, active: true, independent });
      }
    }
    if (input.withdraw !== undefined) {
      strings(input.withdraw, 'withdrawn requirements');
      for (const id of input.withdraw) { const req = t.requirements.find(r => r.id === id); if (!req) throw new Error('Unknown requirement'); req.active = false; req.revision++; }
    }
    if (!t.requirements.length) throw new Error('At least one requirement is required');
    if (input.budget !== undefined) {
      const b = input.budget;
      if (!b || Object.keys(b).some(k => !['maxAttempts', 'seconds'].includes(k)) || !Object.keys(b).length || Object.values(b).some(x => typeof x !== 'number' || !Number.isInteger(x) || x < 1)) throw new Error('Invalid budget');
      t.budget = b;
    }
    if (c.session && !t.sessions.includes(c.session)) t.sessions.push(c.session);
    return save(c, t, 'capture', input);
  });
}
function save(c: Context, t: Task, action: string, input: unknown): Task {
  t.revision++; t.history.push({ revision: t.revision, at: c.now ?? Date.now(), action, input });
  atomicWrite(file(c, t.id), Buffer.from(JSON.stringify(t) + '\n')); return t;
}
function budgetReason(t: Task, now: number): string | undefined {
  if (t.budget?.maxAttempts !== undefined && t.attempts.length >= t.budget.maxAttempts) return 'attempt-budget-exhausted';
  if (t.budget?.seconds !== undefined && t.startedAt !== undefined && now - t.startedAt >= t.budget.seconds * 1000) return 'time-budget-exhausted';
}
export function observe(c: Context, input: any): Task {
  identifier(input.id);
  return withLock(path.join(c.directory, `${input.id}.lock`), () => {
    const t = load(c, input.id), now = c.now ?? Date.now();
    if (input.expectedRevision !== t.revision) throw new Error(`Revision conflict: current ${t.revision}`);
    identifier(input.attempt);
    const a = t.attempts.find(x => x.id === input.attempt);
    if (input.event === 'start') {
      if (a) throw new Error('Attempt already exists');
      text(input.operation, 'operation'); text(input.handle, 'execution handle');
      if (!t.authorized.includes(input.operation)) throw new Error('Operation is not authorized by the current request');
      const exhausted = budgetReason(t, now); if (exhausted) throw new Error(exhausted);
      if (Object.values(t.external).some(e => e.state === 'unknown')) throw new Error('Reconcile unknown external outcome before starting another attempt');
      strings(input.requirements, 'requirements'); if (!input.requirements.length) throw new Error('Empty attempt scope');
      const requirements: Record<string, number> = {};
      for (const id of input.requirements) {
        const r = t.requirements.find(r => r.id === id && r.active); if (!r) throw new Error('Unknown or withdrawn requirement');
        if (t.attempts.some(x => x.state === 'running' && id in x.requirements)) throw new Error('Requirement already has a running attempt');
        requirements[id] = r.revision;
      }
      if (input.pid !== undefined && (!Number.isInteger(input.pid) || input.pid < 1)) throw new Error('Invalid process ID');
      t.attempts.push({ id: input.attempt, requirements, operation: input.operation, state: 'running', handle: input.handle,
        observation: reference(t.root, input.observation), observedAt: now, artifacts: [], constraintsRevision: t.constraintsRevision, ...(input.pid ? { pid: input.pid } : {}) });
      t.startedAt ??= now;
    } else {
      if (!a) throw new Error('Unknown attempt');
      if (input.event === 'partial') {
        // Late output is preserved, never revives or completes a terminal attempt.
        a.artifacts.push(...preserve(c, t.root, input.artifacts));
      } else if (['heartbeat', 'stop', 'end'].includes(input.event)) {
        if (a.state !== 'running') throw new Error('Attempt is already terminal');
        const observation = reference(t.root, input.observation);
        if (input.event !== 'heartbeat') { text(input.reason, 'termination reason'); a.reason = input.reason; a.state = input.event === 'stop' ? 'stopped' : 'ended'; }
        a.observation = observation; a.observedAt = now;
        if (input.artifacts !== undefined) a.artifacts.push(...preserve(c, t.root, input.artifacts));
      } else if (input.event === 'external-invoked') {
        if (a.state !== 'running') throw new Error('External invocation requires a running attempt');
        text(input.key, 'external action key');
        if (['__proto__', 'constructor', 'prototype'].includes(input.key)) throw new Error('Invalid external key');
        if (t.external[input.key] && t.external[input.key].state !== 'absent') throw new Error('External action already exists or has an unknown outcome');
        t.external[input.key] = { state: 'unknown', attempt: a.id, observation: reference(t.root, input.observation) };
      } else if (input.event === 'external-resolved') {
        text(input.key, 'external action key');
        const prior = Object.hasOwn(t.external, input.key) ? t.external[input.key] : undefined;
        if (!prior || prior.attempt !== a.id || !['present', 'absent'].includes(input.outcome)) throw new Error('Unknown external invocation or invalid outcome');
        t.external[input.key] = { ...prior, state: input.outcome, observation: reference(t.root, input.observation) };
      } else throw new Error('Unknown observation event');
    }
    return save(c, t, 'observe', input);
  });
}
export function assess(c: Context, input: any): Task {
  const initial = load(c, input.id);
  if (input.expectedRevision !== initial.revision) throw new Error('Revision conflict');
  if (!Array.isArray(input.evidence) || !input.evidence.length) throw new Error('Evidence required');
  const proofs: Proof[] = input.evidence.map((p: any) => {
    const r = initial.requirements.find(r => r.id === p.requirement && r.active);
    if (!r || p.requirementRevision !== r.revision) throw new Error('Unknown or changed requirement');
    const attempts = initial.attempts.filter(a => r.id in a.requirements);
    if (attempts.length) {
      const a = attempts.find(a => a.id === p.attempt);
      if (!a || a.state !== 'ended' || a.requirements[r.id] !== r.revision || a.constraintsRevision !== initial.constraintsRevision) throw new Error('Evidence requires a finished attempt for the current requirement');
    }
    if (!['pass', 'fail', 'unknown'].includes(p.result)) throw new Error('Invalid verdict');
    text(p.rationale, 'verification rationale'); text(p.observer, 'observer');
    const artifacts = refs(initial.root, p.artifacts); if (!artifacts.length) throw new Error('Artifact evidence required');
    strings(p.sources ?? [], 'sources');
    if (r.kind === 'research' && !(p.sources?.length)) throw new Error('Research requires source references');
    const proof: Proof = { requirement: r.id, revision: r.revision, constraintsRevision: initial.constraintsRevision,
      result: p.result, method: p.method, rationale: p.rationale, artifacts, sources: p.sources ?? [], observer: p.observer,
      independence: p.independence ?? 'unknown', ...(p.attempt ? { attempt: p.attempt } : {}), ...(p.observation ? { observation: reference(initial.root, p.observation) } : {}) };
    if (!['self', 'reported-independent', 'unknown'].includes(proof.independence)) throw new Error('Invalid independence');
    if (r.independent && (proof.independence !== 'reported-independent' || !proof.observation)) throw new Error('Independent review observation is required; a name alone is insufficient');
    if (p.method === 'workflow') {
      text(p.workflow?.cwd, 'workflow cwd');
      const cwd = fs.realpathSync(p.workflow.cwd);
      if (context(cwd).workspace !== c.workspace) throw new Error('Workflow belongs to another workspace');
      const checked = workflow(cwd, p.workflow.task, p.result !== 'pass');
      const verdict = checked.receipt.requirements?.find((v: any) => v.requirementId === p.workflow.requirement);
      if (!verdict || p.result === 'pass' && !verdict.passed || p.result === 'fail' && verdict.passed) throw new Error('Workflow requirement is not verified with the reported result');
      const targets = Object.keys(checked.receipt.targetsAfter ?? {}).map(name => path.resolve(cwd, name));
      if (artifacts.some(a => !targets.some(target => a.path === target || a.path.startsWith(target + path.sep)))) throw new Error('Artifacts are outside the verified workflow targets');
      proof.workflow = { cwd, task: p.workflow.task, requirement: p.workflow.requirement, receipt: checked.ref };
    } else if (p.method !== 'review' || r.kind === 'code') throw new Error('Code requires a current workflow receipt; non-code work accepts review evidence');
    return proof;
  });
  return withLock(path.join(c.directory, `${input.id}.lock`), () => {
    const t = load(c, input.id);
    if (t.revision !== initial.revision) throw new Error('Revision conflict: task changed while assessing');
    if (proofs.some(p => p.artifacts.some(a => !fresh(a)) || p.observation && !fresh(p.observation))) throw new Error('Evidence changed while assessing');
    t.proofs.push(...proofs); return save(c, t, 'assess', input);
  });
}
export function status(c: Context, t: Task) {
  const now = c.now ?? Date.now();
  const attempts = t.attempts.map(a => {
    let alive: boolean | undefined;
    if (a.pid) { try { process.kill(a.pid, 0); alive = true; } catch { alive = false; } }
    const known = a.state !== 'running' || alive !== false && now - a.observedAt <= 120000 && fresh(a.observation);
    const requestChanged = !t.authorized.includes(a.operation) || a.constraintsRevision !== t.constraintsRevision || Object.entries(a.requirements).some(([id, revision]) => !t.requirements.some(r => r.id === id && r.active && r.revision === revision));
    return { id: a.id, state: known ? a.state : 'unknown', requestChanged, observedAt: a.observedAt, reason: a.reason, handle: a.handle, ...(alive !== undefined ? { pidAliveAdvisory: alive } : {}) };
  });
  const requirements = t.requirements.map(r => {
    if (!r.active) return { id: r.id, text: r.text, state: 'withdrawn', reason: 'user-withdrawn' };
    const p = [...t.proofs].reverse().find(p => p.requirement === r.id && p.revision === r.revision && p.constraintsRevision === t.constraintsRevision);
    let reason = 'missing-current-evidence';
    if (p) {
      reason = p.artifacts.every(fresh) && (!p.observation || fresh(p.observation)) ? p.result : 'stale-evidence';
      if (p.workflow && reason !== 'stale-evidence') {
        try { if (!fresh(p.workflow.receipt) || workflow(p.workflow.cwd, p.workflow.task, p.result !== 'pass').ref.sha256 !== p.workflow.receipt.sha256) reason = 'stale-workflow'; } catch { reason = 'stale-workflow'; }
      }
    }
    return { id: r.id, text: r.text, revision: r.revision, state: reason === 'pass' ? 'passed' : reason === 'fail' ? 'failed' : 'unknown', reason };
  });
  const unknownExternal = Object.entries(t.external).filter(([, e]) => e.state === 'unknown' || !fresh(e.observation)).map(([key]) => key);
  const running = t.attempts.some(a => a.state === 'running');
  const active = requirements.filter(r => r.state !== 'withdrawn');
  const complete = active.length > 0 && active.every(r => r.state === 'passed') && !running && !unknownExternal.length;
  const budget = budgetReason(t, now);
  const changedRunning = attempts.some((a, i) => a.requestChanged && t.attempts[i]!.state === 'running');
  const nextActions = unknownExternal.length ? ['reconcile-external'] : changedRunning ? ['reconcile-request-change'] : running ? ['observe'] : complete ? [] : budget ? ['report-budget-exhausted'] : ['resume', 'assess'];
  return { id: t.id, revision: t.revision, purpose: t.purpose, constraints: t.constraints, authorized: t.authorized,
    complete, disposition: active.length ? complete ? 'satisfied' : 'open' : 'withdrawn', attempts, requirements, unknownExternal, budget, nextActions };
}
export function resume(c: Context, t: Task) {
  const view = status(c, t);
  const latestArtifacts = [...new Map(t.attempts.flatMap(a => a.artifacts).map(a => [a.path, a])).values()];
  const staleArtifacts = latestArtifacts.filter(a => !fresh(a)).map(a => a.path);
  const canResume = !view.complete && view.disposition !== 'withdrawn' && !view.unknownExternal.length && !view.budget && !t.attempts.some(a => a.state === 'running') && !staleArtifacts.length;
  return { ...view, canResume, staleArtifacts, artifacts: t.attempts.flatMap(a => a.artifacts).filter(fresh),
    notice: 'Readback only. No process is started; recheck current files and authorization before a new attempt.' };
}
export function selectTask(c: Context, id?: string): Task {
  if (id) return load(c, id);
  if (!c.session) throw new Error('Supply a task ID or a host session ID; no global latest-task fallback');
  assertNoLinks(c.directory);
  const candidates = fs.existsSync(c.directory) ? fs.readdirSync(c.directory).filter(n => n.endsWith('.json')).map(n => load(c, n.slice(0, -5))).filter(t => t.sessions.includes(c.session!)) : [];
  if (candidates.length !== 1) throw new Error(`Select a task explicitly: ${candidates.map(t => t.id).join(', ') || 'none bound to this session'}`);
  return candidates[0]!;
}
