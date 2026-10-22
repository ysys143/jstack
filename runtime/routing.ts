/** Task routing. Model names are identifiers, never capability or quality rankings. */
import { createHash } from 'node:crypto';

export type TaskKind = 'extract' | 'implement' | 'design' | 'review';
export type Access = 'read-only' | 'workspace-write';
export interface Candidate {
  id: string; model: string; host: 'codex' | 'claude'; transport: 'native' | 'cli';
  available: boolean; tools: string[]; access: Access[]; contextTokens: number;
  efforts: string[]; contextModes: string[]; runtimeVersion?: string;
  measurement?: { reviewed: true; contextKey: string; samples: number; successes: number; cost?: number; latencyMs?: number };
}
export interface RouteRequest {
  schemaVersion: 1; taskId: string; kind: TaskKind; prompt: string; deliverable: string;
  verification: string; cwd: string; ownedFiles: string[]; access: Access;
  tools: string[]; contextTokens: number; contextMode: string;
  impact: 'low' | 'high'; constraints: 'simple' | 'complex';
  delegationAllowed: boolean; allowedTransports: ('native' | 'cli')[];
  candidates: Candidate[]; inheritedCandidate?: string; priority?: string[];
  requestedModel?: string; allowedFallbackModels?: string[]; effort?: string;
  timeoutSeconds: number; maxCost?: number;
}
export interface Decision {
  schemaVersion: 1; id: string; request: RouteRequest; attempt: 1 | 2; createdAt: number;
  state: 'ready' | 'local' | 'unavailable'; selected?: Candidate; effort?: string;
  reason: string; excluded: { id: string; reason: string }[];
  guidance: ('core' | 'constraint-checklist' | 'failure-evidence')[];
}
export const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string' && !!x && !x.includes('\0'));
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
export function validateRequest(value: unknown): asserts value is RouteRequest {
  const r = value as RouteRequest;
  if (!r || r.schemaVersion !== 1 || !/^[a-zA-Z0-9_-]{1,64}$/.test(r.taskId)) throw new Error('Invalid routing schema or taskId');
  for (const key of ['prompt', 'deliverable', 'verification', 'cwd', 'contextMode'] as const)
    if (typeof r[key] !== 'string' || !r[key].trim() || r[key].includes('\0')) throw new Error(`Missing or invalid ${key}`);
  if (!['extract', 'implement', 'design', 'review'].includes(r.kind) || !['read-only', 'workspace-write'].includes(r.access) || !['low', 'high'].includes(r.impact) || !['simple', 'complex'].includes(r.constraints)) throw new Error('Invalid task requirements');
  if (r.kind === 'review' && r.access !== 'read-only') throw new Error('Review is read-only; classify authorized fixes as implementation');
  if (!strings(r.tools) || !strings(r.ownedFiles) || !finite(r.contextTokens) || !Number.isInteger(r.contextTokens) || !finite(r.timeoutSeconds) || r.timeoutSeconds < 1 || r.timeoutSeconds > 3600 || typeof r.delegationAllowed !== 'boolean') throw new Error('Invalid tools, files or execution limits');
  if (!strings(r.allowedTransports) || r.allowedTransports.some(x => !['native', 'cli'].includes(x))) throw new Error('Invalid allowed transports');
  if (r.access === 'workspace-write' && !r.ownedFiles.length) throw new Error('Write work requires exclusive ownedFiles');
  if (r.ownedFiles.some(p => p.startsWith('/') || p.includes('\\') || p.split('/').some(x => ['', '.', '..'].includes(x)))) throw new Error('ownedFiles must be exact relative paths');
  if (!Array.isArray(r.candidates) || new Set(r.candidates.map(c => c.id)).size !== r.candidates.length) throw new Error('Invalid or duplicate candidates');
  for (const c of r.candidates) {
    if (!c || !strings([c.id, c.model]) || !['native', 'cli'].includes(c.transport) || !['codex', 'claude'].includes(c.host) || typeof c.available !== 'boolean' || !strings(c.tools) || !strings(c.access) || c.access.some(x => !['read-only', 'workspace-write'].includes(x)) || !strings(c.efforts) || !strings(c.contextModes) || !finite(c.contextTokens)) throw new Error('Invalid candidate capabilities');
    const m = c.measurement;
    if (m && (m.reviewed !== true || !strings([m.contextKey]) || !Number.isInteger(m.samples) || m.samples < 2 || !Number.isInteger(m.successes) || m.successes < 0 || m.successes > m.samples || (m.cost !== undefined && !finite(m.cost)) || (m.latencyMs !== undefined && !finite(m.latencyMs)))) throw new Error('Invalid reviewed measurement; one run is not a rate');
  }
  if (r.priority !== undefined && (!strings(r.priority) || r.priority.some(id => !r.candidates.some(c => c.id === id)))) throw new Error('Invalid candidate priority');
  if (r.allowedFallbackModels !== undefined && !strings(r.allowedFallbackModels)) throw new Error('Invalid fallback models');
  for (const key of ['effort', 'requestedModel', 'inheritedCandidate'] as const) if (r[key] !== undefined && !strings([r[key]!])) throw new Error(`Invalid ${key}`);
  if (r.maxCost !== undefined && !finite(r.maxCost)) throw new Error('Invalid cost limit');
}
/** Measurements are comparable only under the same task and execution requirements. */
export function contextKey(r: RouteRequest, c: Candidate): string {
  return digest([r.kind, r.impact, r.constraints, r.access, [...r.tools].sort(), r.contextTokens, r.contextMode, r.effort ?? null, r.verification, c.host, c.transport, c.runtimeVersion ?? 'unknown']);
}
export function select(r: RouteRequest, options: { attempt?: 1 | 2; failedModel?: string; createdAt?: number } = {}): Decision {
  validateRequest(r);
  const attempt = options.attempt ?? 1;
  const out: Decision = { schemaVersion: 1, id: '', request: structuredClone(r), attempt, createdAt: options.createdAt ?? Date.now(), state: 'unavailable', excluded: [], reason: '', guidance: ['core'] };
  if (r.constraints === 'complex') out.guidance.push('constraint-checklist');
  if (attempt === 2) out.guidance.push('failure-evidence');
  const finish = () => { out.id = digest({ ...out, id: '' }); return out; };
  if (!r.delegationAllowed) { out.state = 'local'; out.reason = 'Delegation is not authorized; coordinator retains the task'; return finish(); }
  let eligible = r.candidates.filter(c => {
    let reason = '';
    if (!c.available) reason = 'availability unverified or unavailable';
    else if (!r.allowedTransports.includes(c.transport)) reason = 'transport not authorized';
    else if (r.requestedModel && c.model !== r.requestedModel && !(attempt === 2 && r.allowedFallbackModels?.includes(c.model))) reason = 'explicit model constraint';
    else if (c.model === options.failedModel) reason = 'previously failed model';
    else if (!c.access.includes(r.access) || r.tools.some(t => !c.tools.includes(t)) || c.contextTokens < r.contextTokens || !c.contextModes.includes(r.contextMode)) reason = 'required capability is absent';
    else if (r.effort && !c.efforts.includes(r.effort)) reason = 'effort override unsupported';
    // A local bridge cannot provide a hard monetary cap for subscription/opaque billing.
    else if (r.maxCost !== undefined) reason = 'hard monetary cap cannot be enforced by this transport';
    else if (c.transport === 'cli' && (r.contextMode !== 'fresh' || c.host === 'claude' && (r.access !== 'read-only' || r.tools.some(t => t !== 'Read')))) reason = 'CLI adapter cannot enforce these requirements';
    if (reason) out.excluded.push({ id: c.id, reason });
    return !reason;
  });
  if (eligible.some(c => c.transport === 'native')) {
    for (const c of eligible.filter(c => c.transport !== 'native')) out.excluded.push({ id: c.id, reason: 'eligible native candidate preferred' });
    eligible = eligible.filter(c => c.transport === 'native');
  }
  const measured = eligible.filter(c => c.runtimeVersion && c.measurement?.contextKey === contextKey(r, c));
  let chosen: Candidate | undefined;
  if (measured.length) {
    chosen = measured.sort((a, b) => {
      const x = a.measurement!, y = b.measurement!;
      return y.successes / y.samples - x.successes / x.samples ||
        (x.cost ?? Infinity) - (y.cost ?? Infinity) || (x.latencyMs ?? Infinity) - (y.latencyMs ?? Infinity) || a.id.localeCompare(b.id);
    })[0];
    out.reason = 'Comparable reviewed success rate, then known cost and latency';
  } else {
    chosen = eligible.find(c => c.id === r.inheritedCandidate);
    out.reason = 'No comparable reviewed measurement; retain eligible inherited model';
    if (!chosen) { chosen = r.priority?.map(id => eligible.find(c => c.id === id)).find(Boolean); out.reason = 'No comparable reviewed measurement; use explicit candidate priority'; }
    if (!chosen && r.requestedModel) { chosen = eligible.find(c => c.model === r.requestedModel); out.reason = 'Explicit requested model'; }
  }
  if (!chosen) { out.reason = eligible.length ? 'No inherited candidate or configured priority; explicit selection required' : 'No candidate satisfies the task contract'; return finish(); }
  out.selected = structuredClone(chosen); out.effort = r.effort;
  out.state = 'ready'; return finish();
}
export function validateDecision(d: Decision): void {
  validateRequest(d.request);
  if (d.schemaVersion !== 1 || ![1, 2].includes(d.attempt) || !finite(d.createdAt) || d.id !== digest({ ...d, id: '' })) throw new Error('Decision integrity mismatch');
  if (d.state === 'ready' && (!d.selected || !d.request.candidates.some(c => digest(c) === digest(d.selected)))) throw new Error('Selected candidate is not in request');
}
