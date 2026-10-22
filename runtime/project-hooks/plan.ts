/**
 * Pure batched action planning. Returns what to run and what to tell the model; it
 * never records decisions, installs anything, or treats a missing check as a pass.
 */
import type { Reuse, RetryTrigger } from './fingerprint.js';
import type { Decision, ReadStatus } from './state.js';
import { normalizeRelative, selectCheckers, type Gap, type ProjectView, type Selection } from './select.js';

/** Structural subset of the dispatcher's ChangedPath; relative paths are root-relative. */
export interface PlanChange { relative: string; op: 'add' | 'update' | 'delete' | 'move'; moveToRelative?: string; }
/** Evidence that the user asked for this run in their own message or command. */
export interface ExplicitUserRequest { messageRef: string; }
export interface PlanInput {
  trigger: RetryTrigger;
  state: { decision: Decision; status: ReadStatus; explanation?: string };
  changes: readonly PlanChange[];
  /** Dispatcher could not extract every path (for example an unparsed patch). */
  uncertain?: boolean;
  view: ProjectView;
  explicitUserRequest?: ExplicitUserRequest;
  /** Diagnostic reuse for the current fingerprint and whether a bounded retry is allowed. */
  reuse?: Reuse; retryAllowed?: boolean;
  /** False when another process already surfaced the pending question (see claimPendingPrompt). */
  surfacePending?: boolean;
  formatOptIn?: boolean;
  /** How the user reaches the decision command on this host, e.g. `/jstack:project-checks`. */
  decisionCommand?: string;
}
export type Gate = 'skip' | 'deferred' | 'pending-decision' | 'run';
export interface PendingDecision {
  choices: readonly ['configured', 'without-setup'];
  /** Model-visible instruction. It asks; it does not approve, configure, or install. */
  message: string;
  surface: boolean;
}
export interface Plan {
  gate: Gate;
  /** Ordered: diagnostic first when needed, then checks grouped per subproject. */
  actions: Selection[];
  diagnose: boolean;
  /** Validation that could not be provided; never to be reported as passing. */
  unknowns: string[];
  /** Setup proposals that require separate user authorization. */
  offers: Gap[];
  pendingDecision?: PendingDecision;
  /** True for an explicitly requested run that leaves the project decision unchanged. */
  oneOff: boolean;
  reason: string;
}

const KIND_ORDER = { format: 0, lint: 1, typecheck: 2, test: 3 } as const;
const empty = (gate: Gate, reason: string, extra: Partial<Plan> = {}): Plan => ({ gate, actions: [], diagnose: false, unknowns: [], offers: [], oneOff: false, reason, ...extra });
const hasEvidence = (request?: ExplicitUserRequest) => typeof request?.messageRef === 'string' && request.messageRef.trim().length > 0;

/** Merge successive edit groups into one batch. Later operations win; deleted paths drop out. */
export function mergeChanges(...batches: readonly (readonly PlanChange[])[]): PlanChange[] {
  const byPath = new Map<string, PlanChange>();
  for (const batch of batches) for (const change of batch) {
    byPath.set(change.relative, change);
    if (change.op === 'move' && change.moveToRelative) byPath.set(change.moveToRelative, { relative: change.moveToRelative, op: 'add' });
  }
  return [...byPath.values()].sort((a, b) => a.relative.localeCompare(b.relative));
}

/** Paths that still exist after the change. Moves without a known destination are uncertain. */
export function checkablePaths(changes: readonly PlanChange[]): { paths: string[]; uncertain: string[] } {
  const paths = new Set<string>(); const uncertain: string[] = [];
  for (const change of changes) {
    if (change.op === 'delete') continue;
    const target = change.op === 'move' ? change.moveToRelative : change.relative;
    const rel = target === undefined ? undefined : normalizeRelative(target);
    if (rel) paths.add(rel); else uncertain.push(change.relative);
  }
  return { paths: [...paths].sort(), uncertain };
}

export function pendingDecisionMessage(command = 'jst project-hooks choose configured|without-setup --message-ref <actual-user-message-or-command-ref>'): string {
  return [
    'jstack project checks are undecided for this project; no project-specific checks ran.',
    'Ask the user to choose one: (1) configure jstack project checks for this project, or (2) work in this project without jstack project setup.',
    `Both are explicit choices. Do not choose for the user or treat silence as an answer; record only their actual answer through ${command}.`,
    'This request does not authorize creating files, installing tools, or changing hook trust.',
  ].join(' ');
}

export function planActions(input: PlanInput): Plan {
  if (input.trigger === 'read-only') return empty('skip', 'read-only activity');
  const explicit = input.trigger === 'explicit';
  if (explicit && !hasEvidence(input.explicitUserRequest)) return empty('skip', 'explicit trigger without evidence of a user request', { unknowns: ['explicit check requested without a user message or command reference; nothing ran'] });

  const { paths, uncertain } = checkablePaths(input.changes);
  const selection = selectCheckers(paths, input.view, { formatOptIn: input.formatOptIn });
  const unknowns: string[] = [];
  if (input.uncertain || uncertain.length) unknowns.push('some changed paths could not be extracted reliably; no check is claimed for them');
  for (const gap of selection.gaps) unknowns.push(gap.message);
  const offers = selection.gaps.filter(gap => gap.offer);
  const relevant = selection.selections.length > 0 || selection.gaps.some(g => g.kind !== 'standalone-script');
  if (!relevant) return empty('skip', 'no changed files that project checks apply to', { unknowns: input.uncertain || uncertain.length ? unknowns : [] });

  // Missing, malformed, or incompatible state is undecided.
  const decision: Decision = input.state.status === 'ok' ? input.state.decision : 'undecided';
  if (input.state.explanation) unknowns.unshift(input.state.explanation);
  const ordered = [...selection.selections].sort((a, b) => a.subproject.localeCompare(b.subproject) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.checker.localeCompare(b.checker));

  // A user's own request can run a one-off check without changing the decision.
  if (explicit && decision !== 'configured') return { gate: 'run', actions: ordered, diagnose: false, unknowns, offers, oneOff: true, reason: `explicit user request; project decision stays ${decision}` };

  if (decision === 'undecided') {
    const surface = input.surfacePending !== false;
    return empty('pending-decision', 'project decision is undecided', {
      unknowns: ['project checks were not run because the project decision is pending', ...unknowns], offers,
      pendingDecision: { choices: ['configured', 'without-setup'] as const, message: pendingDecisionMessage(input.decisionCommand), surface },
    });
  }
  if (decision === 'without-setup') return empty('skip', 'user chose to work without jstack project setup');

  if (input.trigger === 'edit') return empty('deferred', 'single edit; checks run at the next edit batch or commit boundary');
  const reusable = input.reuse?.reuse === true;
  const diagnose = !reusable && input.retryAllowed === true;
  if (!reusable && !diagnose) unknowns.push(input.reuse?.reason === 'not-successful'
    ? 'project diagnostic did not pass and retry limit is reached for unchanged inputs; run the diagnostic command to retry'
    : 'project diagnostic is not current; checker availability is unknown');
  return { gate: 'run', actions: ordered, diagnose, unknowns, offers, oneOff: false, reason: `${input.trigger} boundary in a configured project` };
}
