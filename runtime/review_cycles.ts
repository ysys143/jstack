/** Recorded review repetition. Advice only: this never changes completion evidence. */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { context, load, type Context } from './task_state.js';
import { assertNoLinks, atomicWrite, checkOwned, privateDir, withLock } from './os.js';

export interface ReviewInput {
  context: string;
  purpose: string;
  scopeHash: string;
  inputHash: string;
  mode: 'broad' | 'focused';
}
export interface ReviewEvent extends ReviewInput {
  id: string;
  verdict: 'pass' | 'fail' | 'unknown';
  resultHash: string;
  blockingFindings: string[];
  rawOutput?: string;
}
export interface ReviewAdvice {
  action: 'review' | 'reuse' | 'focus' | 'reassess';
  signals: ('unchanged-review' | 'review-cycle' | 'stalled-findings')[];
  broadRounds: number;
  blockingFindings: string[];
}
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const normalize = (purpose: string) => purpose.trim().replace(/\s+/g, ' ');
function text(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) throw new Error(`Invalid ${name}`);
}
export function validateReview(input: ReviewInput): void {
  for (const key of ['context', 'purpose', 'scopeHash', 'inputHash'] as const) text(input[key], key);
  if (!['broad', 'focused'].includes(input.mode)) throw new Error('Invalid review mode');
}
export function validateEvent(event: ReviewEvent): void {
  validateReview(event); text(event.id, 'review execution ID'); text(event.resultHash, 'result hash');
  if (!['pass', 'fail', 'unknown'].includes(event.verdict)) throw new Error('Invalid review verdict');
  if (!Array.isArray(event.blockingFindings)) throw new Error('Blocking findings must be an array');
  event.blockingFindings.forEach(id => text(id, 'finding ID'));
  if (new Set(event.blockingFindings).size !== event.blockingFindings.length) throw new Error('Duplicate finding IDs');
  if (event.verdict === 'pass' && event.blockingFindings.length) throw new Error('Passing review has unresolved blocking findings');
}

/** Adapted conceptually from anti-samcheonpo's workspace + purpose counter.
 * Unlike that counter, broad-round accounting survives edits and scope changes.
 * Findings and purpose are coordinator-supplied, not semantic/model judgments.
 */
export function reviewAdvice(history: ReviewEvent[], input: ReviewInput, findings?: string[]): ReviewAdvice {
  validateReview(input); history.forEach(validateEvent);
  const related = history.filter(row => row.context === input.context && normalize(row.purpose) === normalize(input.purpose));
  const previous = [...related].reverse().find(row => row.scopeHash === input.scopeHash && row.inputHash === input.inputHash);
  let lastPass = -1;
  related.forEach((row, index) => { if (row.verdict === 'pass') lastPass = index; });
  const active = related.slice(lastPass + 1);
  const broadRounds = active.filter(row => row.mode === 'broad').length;
  const signals: ReviewAdvice['signals'] = [];
  let action: ReviewAdvice['action'] = 'review';
  if (previous) { signals.push('unchanged-review'); action = previous.verdict === 'pass' ? 'reuse' : 'focus'; }
  if (input.mode === 'broad' && broadRounds >= 2) {
    signals.push('review-cycle'); if (action !== 'reuse') action = 'focus';
  }
  const failures = active.slice(-2);
  const stalled = findings?.filter(id => failures.length === 2 && failures.every(row => row.verdict === 'fail' && row.blockingFindings.includes(id))) ?? [];
  if (stalled.length) { signals.push('stalled-findings'); action = 'reassess'; }
  return { action, signals, broadRounds, blockingFindings: stalled };
}

/** Re-importing one delivery is idempotent; reusing its ID for another result fails. */
export function appendReview(history: ReviewEvent[], event: ReviewEvent): { history: ReviewEvent[]; advice: ReviewAdvice; duplicate: boolean } {
  validateEvent(event); history.forEach(validateEvent);
  const previous = history.find(row => row.id === event.id);
  if (previous && sha(previous) !== sha(event)) throw new Error('Review execution ID already binds a different result');
  return {
    history: previous ? history : [...history, event],
    advice: reviewAdvice(previous ? history.filter(row => row.id !== event.id) : history, event, event.blockingFindings),
    duplicate: !!previous,
  };
}

function fingerprint(c: Context, input: any, task: string): ReviewInput {
  text(input.purpose, 'review purpose');
  if (!Array.isArray(input.files) || !input.files.length) throw new Error('Review files are required');
  const files = input.files.map((name: unknown) => {
    text(name, 'review file');
    if (path.isAbsolute(name)) throw new Error('Review files must be relative to the workspace');
    const file = path.resolve(c.root, name), relative = path.relative(c.root, file);
    if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative) || relative.split(path.sep).includes('.git')) throw new Error('Review file escaped its scope');
    assertNoLinks(file); if (!fs.statSync(file).isFile()) throw new Error('Review inputs must be regular files');
    return { path: relative.split(path.sep).join('/'), hash: createHash('sha256').update(fs.readFileSync(file)).digest('hex') };
  }).sort((a: { path: string }, b: { path: string }) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  if (new Set(files.map((row: { path: string }) => row.path)).size !== files.length) throw new Error('Duplicate review files');
  const t = load(c, task);
  const result: ReviewInput = {
    context: sha([c.root, t.id, t.purpose, t.constraintsRevision, t.requirements]),
    purpose: normalize(input.purpose), scopeHash: sha(files.map((row: { path: string }) => row.path)), inputHash: sha(files), mode: input.mode ?? 'broad',
  };
  validateReview(result); return result;
}
function ledgerFile(c: Context, task: string): string { return path.join(c.directory, 'reviews', task + '.json'); }
function historyAt(c: Context, task: string): ReviewEvent[] {
  const file = ledgerFile(c, task); assertNoLinks(file);
  if (!fs.existsSync(file)) return [];
  checkOwned(file);
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (value.schemaVersion !== 1 || value.task !== task || value.workspace !== c.workspace || !Array.isArray(value.events)) throw new Error('Invalid review history');
  value.events.forEach(validateEvent); return value.events;
}
export function checkReview(c: Context, task: string, input: any): ReviewInput & { advice: ReviewAdvice; previousReview?: ReviewEvent } {
  const candidate = fingerprint(c, input, task);
  if (input.blockingFindings !== undefined) {
    if (!Array.isArray(input.blockingFindings)) throw new Error('Blocking findings must be an array');
    input.blockingFindings.forEach((id: unknown) => text(id, 'finding ID'));
  }
  const history = historyAt(c, task), advice = reviewAdvice(history, candidate, input.blockingFindings);
  const previousReview = [...history].reverse().find(row => row.context === candidate.context && normalize(row.purpose) === candidate.purpose && row.scopeHash === candidate.scopeHash && row.inputHash === candidate.inputHash);
  if (advice.action === 'reuse') {
    try {
      text(previousReview?.rawOutput, 'previous review output'); assertNoLinks(previousReview.rawOutput);
      if (createHash('sha256').update(fs.readFileSync(previousReview.rawOutput)).digest('hex') !== previousReview.resultHash) advice.action = 'review';
    } catch { advice.action = 'review'; }
  }
  return { ...candidate, advice, previousReview };
}
export function recordReview(c: Context, task: string, input: any): { advice: ReviewAdvice; duplicate: boolean } {
  const candidate = fingerprint(c, input, task);
  if (candidate.inputHash !== input.expectedInputHash || candidate.context !== input.expectedContext || candidate.scopeHash !== input.expectedScopeHash) throw new Error('Review inputs or requirements changed; check the current scope before recording');
  text(input.rawOutput, 'raw review output');
  const raw = path.resolve(c.root, input.rawOutput); assertNoLinks(raw);
  if (!fs.statSync(raw).isFile()) throw new Error('Raw review output must be a regular file');
  const bytes = fs.readFileSync(raw); if (!bytes.length) throw new Error('Raw review output is empty');
  const event: ReviewEvent = { ...candidate, id: input.id, verdict: input.verdict, resultHash: createHash('sha256').update(bytes).digest('hex'), blockingFindings: input.blockingFindings ?? [], rawOutput: raw };
  validateEvent(event);
  const directory = path.dirname(ledgerFile(c, task)); privateDir(directory);
  return withLock(ledgerFile(c, task) + '.lock', () => {
    const result = appendReview(historyAt(c, task), event);
    if (!result.duplicate) atomicWrite(ledgerFile(c, task), Buffer.from(JSON.stringify({ schemaVersion: 1, task, workspace: c.workspace, events: result.history }) + '\n'));
    return { advice: result.advice, duplicate: result.duplicate };
  });
}

export async function main(argv: string[]): Promise<number> {
  try {
    const [action, task, ...rest] = argv;
    if (!['check', 'record'].includes(action) || !task) throw new Error('Usage: jst review check|record TASK --input FILE|- [--workspace DIR] [--home DIR]');
    const flags: Record<string, string> = {};
    for (let i = 0; i < rest.length; i++) {
      const flag = rest[i]!, value = rest[++i];
      if (!['--input', '--workspace', '--home'].includes(flag) || !value || flags[flag]) throw new Error('Missing, duplicate or unknown option');
      flags[flag] = value;
    }
    const c = context(flags['--workspace'], flags['--home']);
    const input = JSON.parse(fs.readFileSync(!flags['--input'] || flags['--input'] === '-' ? 0 : flags['--input'], 'utf8'));
    const result = action === 'check' ? checkReview(c, task, input) : recordReview(c, task, input);
    process.stdout.write(JSON.stringify({ ...result, boundary: 'Recorded reviews only; advice does not establish completion, reviewer independence, or hook interception.' }) + '\n');
    return 0;
  } catch (error) { process.stderr.write(JSON.stringify({ error: (error as Error).message }) + '\n'); return 2; }
}
