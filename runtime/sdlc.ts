import { readEffect, type GithubReader } from './sdlc_effects.js';
/** Opt-in SDLC projection in the existing request store. Never executes a release write. */
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { context, file, load, save, reference, preserve, fresh, status, type Context, type Task, type Ref } from './task_state.js';
import { atomicWrite, assertNoLinks, privateDir, withLock } from './os.js';
import { open_task, requirements, target_hashes, hash_path, assess as workflowStatus, run_git, run_command } from '../skills/public/workflow/verify/scripts/workflow.js';

export const STAGES = ['shape', 'execute', 'inspect', 'prove', 'release'] as const;
export type Stage = typeof STAGES[number];
export type State = 'active' | 'blocked' | 'paused' | 'handed-off' | 'cancelled' | 'complete';
export interface Coordinator { id: string; host: 'claude' | 'codex'; session: string; epoch: number }
export interface Mapping { request: string; revision: number; requirement: string }
export interface Binding { task: string; contractSha256: string; mapping: Mapping[] }
export interface Evidence { basis: string; refs: Ref[]; targets: Record<string, string | null>; verdict: 'pass' | 'fail' | 'unknown'; source: string }
export interface HumanDecision extends Evidence { target?: unknown; message: string; host: string; session: string }
export interface Shape {
  spec: Ref; semantics: string;
  decisions: { id: string; status: 'settled' | 'assumed' | 'open'; material: boolean; reversible: boolean; revisit?: string; source: string }[];
  criteria: { requirement: string; when: string; actor: string; behavior: string; observable: string; failure: string; human: boolean }[];
}
export interface Run {
  id: string; task: string; recipe: 'autonomous-build'; recipeRevision: 1; root: string;
  stage: Stage; state: State; coordinator: Coordinator; selection: Ref; environment: Ref;
  endpoint: 'local-commit' | 'pr-and-ship'; method: 'ordinary' | 'tdd'; owners: Record<string, string>;
  shape?: Shape; binding?: Binding; bindings: Binding[];
  approvals: Record<string, HumanDecision>; results: Record<string, Evidence>;
  effects: Partial<Record<'commit' | 'push' | 'pr', string>>; ship?: Evidence;
  handoff?: Ref; needsReentry?: boolean; repoCheck: string;
}
const digest = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex');
function ident(x: unknown): asserts x is string { if (typeof x !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(x) || ['constructor', '__proto__', 'prototype'].includes(x)) throw new Error('Invalid identity'); }
function text(x: unknown): asserts x is string { if (typeof x !== 'string' || !x.trim() || x.includes('\0')) throw new Error('Nonempty text required'); }
function objectFile(root: string, name: unknown): { ref: Ref; data: any } {
  const ref = reference(root, name), bytes = readFileSync(ref.path);
  if (createHash('sha256').update(bytes).digest('hex') !== ref.sha256) throw new Error('Observation changed while reading');
  return { ref, data: JSON.parse(bytes.toString('utf8')) };
}
// Selection is decided only by an invocation token at the start of the message. Nothing else in the text is
// inspected; confirmRequirements checks only the digest binding; the user's yes is an agent premise.
function explicitSelection(content: string): boolean {
  return /^\s*(?:jstack:sdlc|\/sdlc|\$sdlc|\/jstack:sdlc|\$jstack:sdlc)(?=[\s,.:;!?]|$)/i.test(content);
}
// Starting or selecting a run requires the user's confirmation of the exact requirements. The agent must show
// the requirements, ask the user, and pass confirmed:true with the requirementsSha256 the runtime reports.
// The runtime checks only the digest binding. Whether the user really answered yes is the agent's premise (contracts/sdlc.md).
function confirmRequirements(t: Task, input: any): void {
  const expected = digest(t.requirements);
  if (input.confirmed !== true || input.requirementsSha256 !== expected)
    throw new Error(`Confirm the requirements with the user first; requirementsSha256=${expected}`);
}
function human(c: Context, source: any, expect: { host: string; session?: string }, selection = false): { ref: Ref; data: any } {
  const observed = objectFile(c.root, source?.observation), d = observed.data;
  if (d.role !== 'user' || !['claude', 'codex'].includes(d.host) || d.message !== source.message) throw new Error('Actual host user observation required');
  for (const value of [d.message, d.session, d.content]) text(value);
  if (d.host !== expect.host || d.session !== expect.session) throw new Error('Observation is not from the coordinator host session');
  if (selection && !explicitSelection(d.content)) throw new Error('Explicit sdlc selection required');
  return observed;
}
function environment(c: Context, name: unknown, coordinator: Coordinator): Ref {
  const { ref, data } = objectFile(c.root, name);
  if (data.host !== coordinator.host || data.session !== coordinator.session || data.competingCoordinator !== false) throw new Error('Coexistence unverified');
  for (const key of ['version', 'profile', 'hooks', 'capabilities']) text(data[key]);
  return ref;
}
function coordinator(value: any, session?: string): Coordinator {
  ident(value?.id); if (!['claude', 'codex'].includes(value.host) || value.session !== session) throw new Error('Current host session required');
  text(value.session); return { id: value.id, host: value.host, session: value.session, epoch: 1 };
}
function semantics(t: Task): string { return digest([t.requirements, t.constraints, t.constraintsRevision]); }
function basis(t: Task): string { const r = t.run!; return digest([semantics(t), r.shape, r.binding, r.endpoint, r.method]); }
function bound(t: Task): any {
  const b = t.run?.binding; if (!b) throw new Error('Missing code contract binding');
  const [root, , contract, hash] = open_task(t.root, b.task);
  if (hash !== b.contractSha256) throw new Error('Contract binding is stale');
  const rows = requirements(contract), active = t.requirements.filter(r => r.active);
  if (!active.length || active.some(r => r.kind !== 'code' || !b.mapping.some(m => m.request === r.id && m.revision === r.revision)) ||
      rows.some(row => !b.mapping.some(m => m.requirement === row['요구ID'])) || b.mapping.some(m => !active.some(r => r.id === m.request && r.revision === m.revision) || !rows.some(row => row['요구ID'] === m.requirement)))
    throw new Error('Incomplete or stale request to requirement mapping');
  return { root, contract, hash };
}
function targets(t: Task, ids?: string[]): Record<string, string | null> {
  const { contract } = bound(t), b = t.run!.binding!;
  const selected = ids ? requirements(contract).filter(row => b.mapping.some(m => ids.includes(m.request) && m.requirement === row['요구ID'])) : requirements(contract);
  return target_hashes(t.root, { 검증: selected });
}
function current(t: Task, evidence?: Evidence): boolean {
  if (!evidence || evidence.basis !== basis(t) || !evidence.refs.every(fresh)) return false;
  return Object.entries(evidence.targets).every(([name, hash]) => hash !== null && hash_path(path.resolve(t.root, name)) === hash);
}
function approval(t: Task, key: string, target?: unknown): boolean {
  const a = t.run!.approvals[key]; if (['commit', 'push', 'pr', 'ship'].includes(key) && !t.authorized.includes(key)) return false; return !!a && a.verdict === 'pass' && current(t, a) && (target === undefined || digest(a.target) === digest(target));
}
function shapeProblems(t: Task): string[] {
  const s = t.run!.shape, errors: string[] = [];
  if (!s || !fresh(s.spec) || s.semantics !== semantics(t)) return ['shape-missing-or-stale'];
  if (s.decisions.some(d => d.status === 'open' || d.status === 'assumed' && (d.material || !d.reversible || !d.revisit))) errors.push('open-material-decision');
  if (t.requirements.filter(r => r.active).some(r => !s.criteria.some(a => a.requirement === r.id))) errors.push('missing-acceptance-criterion');
  try { bound(t); } catch (e) { errors.push((e as Error).message); }
  if (!approval(t, 'shape')) errors.push('shape-acceptance-required');
  return errors;
}
function workflow(t: Task): any {
  const { root, contract, hash } = bound(t); return workflowStatus(t.root, root, contract, hash);
}
function checkProjection(t: Task, request: string): { state: string; reason?: string } {
  try {
    const { root, contract, hash } = bound(t), checked = workflowStatus(t.root, root, contract, hash);
    if (!checked.receipt) return { state: 'unknown' };
    // Keep machine results separate from missing reviews and aggregate completion.
    const stale = checked.problems.filter((p: string) => !['verification-required', 'receipt-failed'].includes(p) && !p.startsWith('review-stale:'));
    if (stale.length) return { state: 'stale', reason: stale.join(', ') };
    const receipt = JSON.parse(readFileSync(path.join(t.root, checked.receipt), 'utf8'));
    const passed = receipt.linter?.exitCode === 0 && receipt.readiness?.passed && receipt.targetsStable && receipt.securityStable &&
      (!receipt.security || receipt.security.passed) && requirements(contract).filter(row => t.run!.binding!.mapping.some(m => m.request === request && m.requirement === row['요구ID'])).every(row => receipt.requirements?.some((r: any) => r.requirementId === row['요구ID'] && r.passed));
    return { state: passed ? 'pass' : 'fail' };
  } catch (e) { return { state: 'unknown', reason: (e as Error).message }; }
}
function unresolved(t: Task): string[] {
  return Object.entries(t.external).filter(([, e]) => e.state === 'unknown' || !fresh(e.observation)).map(([key]) => key);
}
function stageProblems(t: Task, stage: Stage): string[] {
  const r = t.run!, errors = shapeProblems(t);
  if (stage === 'shape') return errors;
  if (t.attempts.some(a => a.state === 'running')) errors.push('workers-unsettled');
  if (unresolved(t).length) errors.push('external-readback-required');
  if (r.method === 'tdd' && (!approval(t, 'scenarios') || !approval(t, 'cases'))) errors.push('tdd-approvals-required');
  for (const req of t.requirements.filter(q => q.active)) {
    const result = r.results[`implemented:${req.id}`];
    if (!current(t, result) || result?.verdict !== 'pass') errors.push(`implementation-required:${req.id}`);
    if (stage !== 'execute') {
      const review = r.results[`review-approved:${req.id}`];
      if (!current(t, review) || review?.verdict !== 'pass') errors.push(`review-required:${req.id}`);
    }
  }
  if (stage === 'prove' || stage === 'release') {
    try { const w = workflow(t); if (!w.complete) errors.push(...w.problems); } catch (e) { errors.push((e as Error).message); }
    for (const a of r.shape?.criteria ?? []) if (a.human && !approval(t, `accepted:${a.requirement}`)) errors.push(`human-acceptance-required:${a.requirement}`);
  }
  if (stage === 'release') {
    for (const op of r.endpoint === 'local-commit' ? ['commit'] as const : ['commit', 'push', 'pr'] as const) {
      const key = r.effects[op], effect = key ? t.external[key] : undefined;
      if (!effect || effect.state !== 'present' || !fresh(effect.observation)) errors.push(`release-readback-required:${op}`);
      else {
        const observed = JSON.parse(readFileSync(effect.observation.path, 'utf8'));
        if (observed.head !== run_git(t.root, 'rev-parse', 'HEAD')) errors.push(`release-head-stale:${op}`);
      }
    }
    if (r.endpoint === 'pr-and-ship') {
      if (!current(t, r.ship) || r.ship?.verdict !== 'pass') errors.push('ship-required');
      else { const proof = JSON.parse(readFileSync(r.ship.refs[0].path, 'utf8')); if (proof.head !== run_git(t.root, 'rev-parse', 'HEAD') || proof.baseHead !== run_git(t.root, 'rev-parse', proof.base)) errors.push('ship-stale'); }
    }
  }
  return [...new Set(errors)];
}
export function runStatus(c: Context, t: Task): any {
  const base = status(c, t), r = t.run;
  if (!r) return base;
  if (realpathSync(c.root) !== r.root) throw new Error('Run belongs to another worktree');
  let problems: string[];
  try { problems = stageProblems(t, r.stage); } catch (e) { problems = [(e as Error).message]; }
  const projections: Record<string, unknown> = {};
  for (const req of t.requirements.filter(q => q.active)) {
    const project = (key: string) => { const e = r.results[key] ?? r.approvals[key]; return !e ? 'unknown' : !current(t, e) ? 'stale' : e.verdict; };
    projections[req.id] = { implemented: project(`implemented:${req.id}`), 'checks-passed': checkProjection(t, req.id), 'review-approved': project(`review-approved:${req.id}`), accepted: project(`accepted:${req.id}`), humanRequired: r.shape?.criteria.some(a => a.requirement === req.id && a.human) ?? false };
  }
  const runComplete = r.state === 'complete' && problems.length === 0;
  return { ...base, run: { id: r.id, stage: r.stage, state: r.state, endpoint: r.endpoint, coordinator: r.coordinator }, runComplete, projections, problems,
    canResume: !['cancelled', 'complete'].includes(r.state) && !base.unknownExternal.length && !t.attempts.some(a => a.state === 'running'),
    nextActions: runComplete ? [] : unresolved(t).length ? ['readback'] : ['task run status', 'resolve listed gates or explicitly select/reenter'],
    notApplicable: r.endpoint === 'local-commit' ? ['push', 'pr', 'ship'].map(gate => ({ gate, condition: 'endpoint=local-commit', reason: 'User selected local delivery', actor: 'autonomous-build@1', revision: t.history.find(h => h.action === 'run.start')?.revision })) : [],
    notice: 'Request disposition is separate from run completion. Readback only; no process is started.' };
}
function snapshot(c: Context, value: unknown): Ref {
  const bytes = Buffer.from(JSON.stringify(value) + '\n'), directory = path.join(c.directory, 'artifacts');
  privateDir(directory); const filename = path.join(directory, digest(value)); atomicWrite(filename, bytes); return reference('/', filename);
}
function scope(c: Context, t: Task, input: any): void {
  if (c.root !== t.root || t.run?.root !== c.root || input.run !== t.run.id) throw new Error('Wrong run or worktree');
}
function mutate(c: Context, input: any, action: (t: Task) => void): Task {
  ident(input.id); ident(input.eventId); text(input.reason);
  return withLock(path.join(c.directory, `${input.id}.lock`), () => {
    const t = load(c, input.id), old = t.history.find(h => h.action.startsWith('run.') && (h.input as any)?.eventId === input.eventId);
    if (old) { if (c.root !== t.root) throw new Error('Wrong worktree'); if (digest(old.input) !== digest(input)) throw new Error('Event ID reused with different input'); return t; }
    if (input.expectedRevision !== t.revision) throw new Error(`Revision conflict: current ${t.revision}`);
    action(t); return save(c, t, `run.${input.type ?? 'start'}`, input);
  });
}
export function startRun(c: Context, input: any): Task {
  return mutate(c, input, t => {
    if (t.run) throw new Error('Task already has a run; select it explicitly');
    if (c.root !== t.root || run_git(c.root, 'rev-parse', '--show-toplevel') !== c.root) throw new Error('Start at the task worktree root');
    if (t.attempts.some(a => a.state === 'running') || unresolved(t).length) throw new Error('Settle existing work before starting');
    if (!['local-commit', 'pr-and-ship'].includes(input.endpoint) || !['ordinary', 'tdd'].includes(input.method)) throw new Error('Choose release endpoint and execution method');
    if (!t.requirements.length || t.requirements.some(r => r.active && r.kind !== 'code')) throw new Error('Code requirements required');
    const coord = coordinator(input.coordinator, c.session), observed = human(c, input.source, { host: coord.host, session: c.session }, true); ident(input.run); text(input.repoCheck);
    confirmRequirements(t, input);
    const env = environment(c, input.environment, coord);
    t.schemaVersion = 2;
    t.run = { id: input.run, task: t.id, recipe: 'autonomous-build', recipeRevision: 1, root: c.root, stage: 'shape', state: 'active', coordinator: coord,
      selection: observed.ref, environment: env, endpoint: input.endpoint, method: input.method, owners: Object.fromEntries(t.requirements.filter(r => r.active).map(r => [r.id, coord.id])),
      bindings: [], approvals: {}, results: {}, effects: {}, repoCheck: input.repoCheck };
  });
}
function excludeTask(root: string, task: string): void {
  // Exact private runtime path only. Never hide source or all of .jstack.
  const filename = path.resolve(root, run_git(root, 'rev-parse', '--git-path', 'info/exclude'));
  assertNoLinks(filename); mkdirSync(path.dirname(filename), { recursive: true });
  withLock(filename + '.lock', () => {
    const before = existsSync(filename) ? readFileSync(filename, 'utf8') : '', line = `/.jstack/tasks/${task}/`;
    if (!before.split(/\r?\n/).includes(line)) atomicWrite(filename, Buffer.from(before + (before && !before.endsWith('\n') ? '\n' : '') + line + '\n'), false);
  });
}
export function selectRun(c: Context, input: any): Task {
  return mutate(c, { ...input, type: 'select' }, t => {
    scope(c, t, input); const r = t.run!;
    if (r.state === 'cancelled' || r.state === 'complete') throw new Error('Terminal run requires a new task');
    const next = coordinator(input.coordinator, c.session); human(c, input.source, { host: next.host, session: c.session }, true);
    confirmRequirements(t, input);
    if (r.coordinator.id !== next.id || r.coordinator.session !== next.session || r.coordinator.host !== next.host) {
      if (!['paused', 'handed-off'].includes(r.state)) throw new Error('Current coordinator must hand off or pause first');
      next.epoch = r.coordinator.epoch + 1; r.coordinator = next;
    }
    r.environment = environment(c, input.environment, r.coordinator);
    r.needsReentry = true; r.state = 'blocked'; // Selection restores context, never executes or bypasses reentry.
  });
}
function own(c: Context, t: Task, input: any): void {
  scope(c, t, input); const r = t.run!;
  if (input.coordinator !== r.coordinator.id || input.epoch !== r.coordinator.epoch || c.session !== r.coordinator.session) throw new Error('Stale coordinator');
  if (['cancelled', 'complete'].includes(r.state) && input.type !== 'readback') throw new Error('Terminal run');
}
function recordShape(c: Context, t: Task, input: any): void {
  const data = input.readiness; if (!data || !Array.isArray(data.decisions) || !Array.isArray(data.criteria) || !data.criteria.length) throw new Error('Readiness decisions and criteria required');
  const ids = new Set<string>();
  for (const d of data.decisions) {
    ident(d.id); if (ids.has(d.id)) throw new Error('Duplicate decision'); ids.add(d.id);
    if (!['settled', 'assumed', 'open'].includes(d.status) || typeof d.material !== 'boolean' || typeof d.reversible !== 'boolean') throw new Error('Invalid decision');
    text(d.source); if (d.status === 'assumed') text(d.revisit);
  }
  for (const a of data.criteria) {
    if (!t.requirements.some(r => r.active && r.id === a.requirement) || typeof a.human !== 'boolean') throw new Error('Unknown acceptance requirement');
    for (const key of ['when', 'actor', 'behavior', 'observable', 'failure']) text(a[key]);
  }
  t.run!.shape = { spec: reference(c.root, input.spec), semantics: semantics(t), decisions: data.decisions, criteria: data.criteria };
  t.run!.stage = 'shape'; t.run!.state = 'active';
}
export function assertExecutionAdmission(t: Task): void {
  if (!t.run) return;
  if (t.run.stage !== 'execute') throw new Error('Implementation requires the Execute stage');
  const problems = shapeProblems(t);
  if (t.run.method === 'tdd' && (!approval(t, 'scenarios') || !approval(t, 'cases'))) problems.push('tdd-approvals-required');
  if (problems.length) throw new Error(problems.join(', '));
}
function recordResult(c: Context, t: Task, input: any): void {
  const { ref, data } = objectFile(c.root, input.output), observed = objectFile(c.root, input.observation), observation = observed.ref;
  text(observed.data.actor); text(observed.data.host); text(observed.data.event);
  if (!['implemented', 'review-approved'].includes(data.kind) || !['pass', 'fail', 'unknown'].includes(data.verdict) || !Array.isArray(data.requirements) || !data.requirements.length) throw new Error('Invalid leaf result');
  if (data.kind === 'implemented') assertExecutionAdmission(t);
  if (data.kind === 'review-approved' && t.run!.stage !== 'inspect') throw new Error('Review results require Inspect');
  if (data.kind === 'review-approved' && (data.role !== 'reviewer' || !Array.isArray(data.blockingFindings) || data.verdict === 'pass' && data.blockingFindings.length)) throw new Error('Review blockers or reviewer result missing');
  if (data.basis !== basis(t)) throw new Error('Leaf ran against another requirement revision');
  for (const id of data.requirements) {
    if (!t.requirements.some(r => r.active && r.id === id)) throw new Error('Unknown leaf requirement');
    if (data.kind === 'review-approved' && t.requirements.find(r => r.id === id)?.independent && observed.data.actor === t.run!.coordinator.id) throw new Error('Independent assessor required');
    const hashes = targets(t, [id]); if (!Object.keys(hashes).length || Object.values(hashes).some(x => x === null)) throw new Error('Missing result artifacts');
    if (digest(data.targets) !== digest(targets(t, data.requirements))) throw new Error('Leaf input hashes changed');
    t.run!.results[`${data.kind}:${id}`] = { basis: basis(t), refs: preserve(c, c.root, [ref.path, observation.path]), targets: hashes, verdict: data.verdict, source: data.kind };
  }
}
function decide(c: Context, t: Task, input: any): void {
  const r = t.run!, key = input.gate;
  if (!['shape', 'scenarios', 'cases', 'commit', 'push', 'pr', 'ship', ...t.requirements.filter(q => q.active).map(q => `accepted:${q.id}`)].includes(key)) throw new Error('Unknown human gate');
  if (!['pass', 'fail'].includes(input.verdict)) throw new Error('Explicit human decision required');
  if (key === 'cases' && input.verdict === 'pass' && !approval(t, 'scenarios')) throw new Error('Approve scenarios before cases');
  const observed = human(c, input.source, { host: r.coordinator.host, session: r.coordinator.session });
  if (key === 'scenarios') delete r.approvals.cases;
  const hashes = key === 'shape' || key === 'scenarios' || key === 'cases' ? {} : targets(t, key.startsWith('accepted:') ? [key.slice(9)] : undefined);
  if (['commit', 'push', 'pr'].includes(key) && !input.target) throw new Error('Release approval requires an exact target');
  const artifact = ['scenarios', 'cases'].includes(key) ? reference(c.root, input.artifact) : undefined;
  if (['commit', 'push', 'pr', 'ship'].includes(key)) { t.authorized = t.authorized.filter(v => v !== key); if (input.verdict === 'pass') t.authorized.push(key); }
  r.approvals[key] = { basis: basis(t), refs: preserve(c, c.root, [observed.ref.path, ...(artifact ? [artifact.path] : [])]), targets: hashes, verdict: input.verdict, source: 'host-observed-human',
    message: observed.data.message, host: observed.data.host, session: observed.data.session, ...(input.target ? { target: input.target } : {}) };
}
function captureHandoff(c: Context, t: Task): Ref {
  return snapshot(c, { task: t.id, run: t.run, requirements: t.requirements, constraints: t.constraints, authorized: t.authorized,
    attempts: t.attempts, proofs: t.proofs, external: t.external, status: runStatus(c, t),
    dirty: run_git(t.root, 'status', '--short'), head: run_git(t.root, 'rev-parse', 'HEAD') });
}
function gitRead(root: string, args: string[]): { ok: boolean; output: string } {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 30000 }); return { ok: r.status === 0, output: r.stdout?.trim() ?? '' };
}
function validateTarget(t: Task, op: string, target: any): void {
  if (!target || !['commit', 'push', 'pr'].includes(op)) throw new Error('Invalid release target');
  const head = run_git(t.root, 'rev-parse', 'HEAD');
  if (op === 'commit') {
    if (!gitRead(t.root, ['diff', '--quiet']).ok) throw new Error('Unstaged changes differ from the verified commit');
    const declared = Object.keys(targets(t));
    const staged = run_git(t.root, 'diff', '--cached', '--name-only', '-z').split('\0').filter(Boolean);
    if (staged.some(name => !declared.some(p => name === p || name.startsWith(p + '/')))) throw new Error('Unrelated staged changes');
    if (!/^[a-f0-9]{40,64}$/.test(target.parent) || !/^[a-f0-9]{40,64}$/.test(target.tree) || target.parent !== head || run_git(t.root, 'write-tree') !== target.tree) throw new Error('Commit parent/index changed');
  } else {
    if (target.head !== head) throw new Error('Release target HEAD changed');
    text(target.branch); if (!gitRead(t.root, ['check-ref-format', `refs/heads/${target.branch}`]).ok) throw new Error('Invalid branch');
    if (op === 'push') { text(target.remote); if (!run_git(t.root, 'remote').split('\n').includes(target.remote)) throw new Error('Unknown remote'); }
    else { if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(target.repository)) throw new Error('Invalid repository'); text(target.base); }
  }
}
function invoke(c: Context, t: Task, input: any): void {
  const r = t.run!, op = input.operation as 'commit' | 'push' | 'pr';
  if (r.stage !== 'release' || r.endpoint === 'local-commit' && op !== 'commit') throw new Error('Effect outside selected Release scope');
  const problems = stageProblems(t, 'prove'); if (problems.length) throw new Error(problems.join(', '));
  for (const predecessor of op === 'push' ? ['commit'] as const : op === 'pr' ? ['commit', 'push'] as const : []) {
    const key = r.effects[predecessor], effect = key ? t.external[key] : undefined;
    if (!effect || effect.state !== 'present' || !fresh(effect.observation) || JSON.parse(readFileSync(effect.observation.path, 'utf8')).head !== run_git(t.root, 'rev-parse', 'HEAD')) throw new Error(`Current ${predecessor} readback required before ${op}`);
  }
  validateTarget(t, op, input.target);
  if (!approval(t, op, input.target)) throw new Error('Exact release approval required');
  const key = `${r.id}:${op}:${digest(input.target)}`, old = t.external[key];
  if (old && old.state !== 'absent') throw new Error('Readback required; do not repeat an unknown or present effect');
  const observation = snapshot(c, { intent: op, target: input.target, head: run_git(t.root, 'rev-parse', 'HEAD'), basis: basis(t) });
  t.external[key] = { state: 'unknown', attempt: input.eventId, observation };
  r.effects[op] = key;
}
function readback(c: Context, t: Task, input: any, provider?: GithubReader): void {
  const r = t.run!, op = input.operation as 'commit' | 'push' | 'pr', key = r.effects[op];
  if (!key || !t.external[key]) throw new Error('No recorded effect');
  const effect = t.external[key], previous = JSON.parse(readFileSync(effect.observation.path, 'utf8')), target = previous.target;
  if (!target) throw new Error('Effect target missing');
  const observed = readEffect(t.root, op, target, provider);
  effect.state = observed.outcome; effect.observation = snapshot(c, { operation: op, target, ...observed, basis: basis(t) });
}
export async function runEvent(c: Context, input: any, provider?: GithubReader): Promise<Task> {
  // A checker runs outside the task lock; mutate checks the original revision again.
  const prior = load(c, input.id);
  const duplicate = prior.history.find(h => h.action.startsWith('run.') && (h.input as any)?.eventId === input.eventId);
  if (duplicate) { scope(c, prior, input); if (digest(duplicate.input) !== digest(input)) throw new Error('Event ID reused with different input'); return prior; }
  let shipCheck: any;
  if (input.type === 'ship') {
    const t = load(c, input.id); own(c, t, input);
    if (t.run!.needsReentry || ['paused', 'handed-off'].includes(t.run!.state)) throw new Error('Select and reenter first');
    if (t.run!.endpoint !== 'pr-and-ship' || t.revision !== input.expectedRevision || !approval(t, 'ship') || t.run!.stage !== 'release') throw new Error('Current ship approval and Release required');
    if (run_git(t.root, 'status', '--short')) throw new Error('Ship requires a clean worktree');
    const head = run_git(t.root, 'rev-parse', 'HEAD');
    shipCheck = await run_command(t.run!.repoCheck, t.root);
    shipCheck.head = head;
  }
  let completionEffects: Task['external'] | undefined;
  if (input.type === 'complete' && prior.run?.endpoint === 'pr-and-ship') {
    own(c, prior, input);
    if (prior.revision !== input.expectedRevision || prior.run.stage !== 'release') throw new Error('Current Release revision required');
    const preview = structuredClone(prior);
    for (const operation of ['push', 'pr']) if (preview.run!.effects[operation as 'push' | 'pr']) readback(c, preview, { operation }, provider);
    completionEffects = preview.external;
  }
  return mutate(c, input, t => {
    own(c, t, input); const r = t.run!;
    if ((r.needsReentry || ['paused', 'handed-off'].includes(r.state)) && !['readback', 'reenter', 'cancel'].includes(input.type)) throw new Error('Select and reenter first');
    switch (input.type) {
      case 'shape': recordShape(c, t, input); break;
      case 'bind': {
        if (r.stage !== 'shape') throw new Error('Contract changes return to Shape');
        ident(input.binding?.task); if (!Array.isArray(input.binding.mapping)) throw new Error('Requirement mapping required');
        r.binding = input.binding; bound(t); excludeTask(t.root, input.binding.task); r.bindings.push(input.binding); break;
      }
      case 'result': recordResult(c, t, input); break;
      case 'approve': decide(c, t, input); break;
      case 'owner': ident(input.owner); if (!t.requirements.some(q => q.id === input.requirement && q.active) || t.attempts.some(a => a.state === 'running' && input.requirement in a.requirements)) throw new Error('Cannot replace an active or missing owner'); r.owners[input.requirement] = input.owner; break;
      case 'transition': {
        const index = STAGES.indexOf(r.stage); if (input.stage !== STAGES[index + 1]) throw new Error('Only the next stage is allowed');
        const errors = stageProblems(t, r.stage); if (errors.length) throw new Error(errors.join(', '));
        r.stage = input.stage; r.state = 'active'; break;
      }
      case 'reconsider': reference(c.root, input.observation); if (!['shape', 'execute', 'inspect', 'prove'].includes(input.stage) || STAGES.indexOf(input.stage) > STAGES.indexOf(r.stage)) throw new Error('Invalid reconsideration stage'); r.stage = input.stage; r.state = 'blocked'; break;
      case 'pause': case 'cancel': case 'handoff':
        r.handoff = captureHandoff(c, t); r.needsReentry = true; r.state = input.type === 'pause' ? 'paused' : input.type === 'cancel' ? 'cancelled' : 'handed-off'; break;
      case 'reenter':
        if (t.attempts.some(a => a.state === 'running') || unresolved(t).length || !fresh(r.environment)) throw new Error('Settle workers, readback and environment before reentry');
        if (r.handoff && !fresh(r.handoff)) throw new Error('Handoff evidence changed');
        r.needsReentry = false; r.state = 'active'; break;
      case 'invoke': invoke(c, t, input); break;
      case 'readback': readback(c, t, input, provider); break;
      case 'reuse-commit': {
        if (r.stage !== 'release' || run_git(t.root, 'status', '--short') || !workflow(t).complete) throw new Error('Reuse requires a clean, verified Release');
        const head = run_git(t.root, 'rev-parse', 'HEAD'); if (input.head !== head) throw new Error('Commit differs');
        const key = `${r.id}:commit:reuse:${head}`; t.external[key] = { state: 'present', attempt: input.eventId, observation: snapshot(c, { head, tree: run_git(t.root, 'rev-parse', 'HEAD^{tree}'), reused: true }) }; r.effects.commit = key; break;
      }
      case 'ship': {
        if (r.endpoint !== 'pr-and-ship' || !shipCheck || shipCheck.exitCode !== 0 || shipCheck.timedOut || shipCheck.head !== run_git(t.root, 'rev-parse', 'HEAD') || run_git(t.root, 'status', '--short') || !workflow(t).complete) throw new Error('Ship checks failed or stale');
        text(input.base); text(input.rollback);
        if (!gitRead(t.root, ['merge-tree', '--write-tree', 'HEAD', input.base]).ok || !gitRead(t.root, ['rev-parse', '--verify', `${input.rollback}^{commit}`]).ok) throw new Error('Merge conflict or missing rollback');
        shipCheck.base = input.base; shipCheck.baseHead = run_git(t.root, 'rev-parse', input.base);
        r.ship = { basis: basis(t), targets: targets(t), refs: [snapshot(c, shipCheck)], verdict: 'pass', source: 'ship-checker' }; break;
      }
      case 'complete': { if (r.stage !== 'release') throw new Error('Release is unfinished'); if (completionEffects) t.external = completionEffects; const errors = stageProblems(t, 'release'); if (errors.length) { r.state = 'blocked'; break; } r.state = 'complete'; break; }
      default: throw new Error('Unknown run event');
    }
  });
}
export function leafContext(t: Task): unknown { return { run: t.run!.id, basis: basis(t), binding: t.run!.binding, targets: targets(t), stage: t.run!.stage }; }
export function runContext(root: string, home?: string, session?: string): Context {
  const canonical = realpathSync(root), repo = run_git(canonical, 'rev-parse', '--show-toplevel'); return context(repo, home, session);
}
