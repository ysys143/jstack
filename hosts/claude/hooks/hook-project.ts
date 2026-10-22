// Project lane: connect normalized events to runtime/project-hooks state, selection,
// fingerprinting, and planning. Loaded only after the dispatcher's cheap prefilter.
// It never records a project decision, installs tools, formats files, or creates .jstack/.
import { realpathSync, readFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
    HOOK_CONTEXT_ENV, claimPendingPrompt, computeFingerprint, diagnosticReuse, fileProjectView, planActions,
    readState, recordDiagnostic, relevantConfigPaths, resolveExecutable, resolveStateLocation, retryAllowed, selectCheckers,
    checkablePaths, type Fingerprint, type Plan, type PlanChange, type PlanInput, type ReadResult, type RetryTrigger, type Selection, type StateLocation,
} from '../../../runtime/project-hooks/index.js';
import type { ChangedPath, NormalizedEvent } from './hook-event.js';
import type { Verdict } from './hook-output.js';
const POLICY = 'project';
const CHECK_TIMEOUT_MS = 60000;
const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
function decisionCommand(env: NodeJS.ProcessEnv): string | undefined {
    const root = env.CLAUDE_PLUGIN_ROOT || env.PLUGIN_ROOT;
    return root ? `node ${shellQuote(join(root, 'payload/runtime/project-hooks/decision_cli.js'))} choose configured|without-setup --message-ref <actual-user-message-or-command-ref>` : undefined;
}
/** Root-relative forward-slash path, or undefined when the path lies outside the root. */
export function rootRelative(root: string, file: string): string | undefined {
    let real = file;
    try {
        real = realpathSync(file);
    }
    catch {
        try {
            real = join(realpathSync(dirname(file)), basename(file));
        }
        catch { /* keep the lexical path */ }
    }
    const rel = relative(root, real);
    if (!rel || rel.startsWith('..') || isAbsolute(rel))
        return;
    return rel.split(sep).join('/');
}
/** Convert dispatcher changes to plan changes relative to the project root. */
export function planChanges(root: string, changes: readonly ChangedPath[]): { changes: PlanChange[]; outside: string[] } {
    const out: PlanChange[] = [], outside: string[] = [];
    for (const change of changes) {
        const rel = rootRelative(root, change.path);
        const moveToRelative = change.moveTo ? rootRelative(root, change.moveTo) : undefined;
        if (rel === undefined && moveToRelative === undefined) {
            outside.push(change.relative);
            continue;
        }
        // A move out of or into the project is still a change the project must see.
        if (rel === undefined)
            out.push({ relative: moveToRelative!, op: 'add' });
        else
            out.push({ relative: rel, op: change.op, ...(change.op === 'move' && moveToRelative !== undefined ? { moveToRelative } : {}) });
    }
    return { changes: out, outside };
}
/** Staged changes for a commit, from `git diff --cached --name-status -z`. `-a` adds tracked worktree changes. */
export function stagedChanges(root: string, command: string): { changes: PlanChange[]; uncertain?: string } {
    const git = (args: string[]) => spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 10000, windowsHide: true });
    const lists = [git(['diff', '--cached', '--name-status', '-z', '-M'])];
    if (/\bgit\s+commit\b[^|;&]*\s(?:-a\b|--all\b|-[A-Za-z]*a[A-Za-z]*\b)/.test(command))
        lists.push(git(['diff', '--name-status', '-z', '-M']));
    const changes: PlanChange[] = [];
    for (const result of lists) {
        if (result.status !== 0)
            return { changes, uncertain: 'could not list staged changes with git' };
        const fields = result.stdout.split('\0');
        for (let i = 0; i < fields.length - 1;) {
            const status = fields[i++] ?? '';
            if (/^[RC]/.test(status)) {
                const from = fields[i++] ?? '', to = fields[i++] ?? '';
                changes.push(status.startsWith('R') ? { relative: from, op: 'move', moveToRelative: to } : { relative: to, op: 'add' });
            }
            else {
                const file = fields[i++] ?? '';
                changes.push({ relative: file, op: status === 'D' ? 'delete' : status === 'A' ? 'add' : 'update' });
            }
        }
    }
    return { changes };
}
function pluginVersion(env: NodeJS.ProcessEnv): { version: string; manifest?: string } {
    const root = env.CLAUDE_PLUGIN_ROOT || env.PLUGIN_ROOT;
    if (!root)
        return { version: 'unknown' };
    for (const file of ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json']) {
        try {
            const version = JSON.parse(readFileSync(join(root, file), 'utf8')).version;
            if (typeof version === 'string')
                return { version, manifest: join(root, 'hooks', 'hooks.json') };
        }
        catch { /* try the next manifest */ }
    }
    return { version: 'unknown', manifest: join(root, 'hooks', 'hooks.json') };
}
function runSelection(root: string, action: Selection, env: NodeJS.ProcessEnv): Verdict | undefined {
    const tool = resolveExecutable(action.tool, env);
    if (!tool)
        return { action: 'unknown', policy: POLICY, text: `${action.id}: ${action.tool} is not available; ${action.kind} result is unknown` };
    const [command, ...args] = action.argv;
    const executable = command === action.tool ? tool : command;
    if (!executable)
        return { action: 'unknown', policy: POLICY, text: `${action.id}: empty command` };
    const result = spawnSync(executable, args, { cwd: action.subproject ? join(root, action.subproject) : root, encoding: 'utf8', timeout: CHECK_TIMEOUT_MS, windowsHide: true, env });
    if (result.error)
        return { action: 'unknown', policy: POLICY, text: `${action.id}: ${(result.error as NodeJS.ErrnoException).code === 'ETIMEDOUT' ? 'timed out' : result.error.message}; result is unknown` };
    if (result.status === 0)
        return;
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim().slice(0, 1500);
    return { action: 'deny', policy: POLICY, text: `[FAIL] ${action.id} (${action.argv.join(' ')}) exited ${result.status}\n${output}` };
}
export interface LaneDeps {
    resolveLocation?: (cwd: string) => StateLocation;
    /** Replace checker execution in tests. */
    runAction?: (root: string, action: Selection, env: NodeJS.ProcessEnv) => Verdict | undefined;
}
export async function runProjectLane(event: NormalizedEvent, env: NodeJS.ProcessEnv = process.env, deps: LaneDeps = {}): Promise<Verdict[]> {
    // Decision writers refuse to run under this marker; the hook only reads and asks.
    env[HOOK_CONTEXT_ENV] = '1';
    const location = (deps.resolveLocation ?? resolveStateLocation)(event.cwd);
    const read: ReadResult = readState(location);
    const trigger: RetryTrigger = event.event === 'PreToolUse' ? 'commit' : 'edit';
    let changes: PlanChange[], uncertain = event.uncertain;
    if (trigger === 'commit') {
        const staged = stagedChanges(location.root, event.command ?? '');
        changes = staged.changes;
        uncertain ??= staged.uncertain;
    }
    else
        changes = planChanges(location.root, event.changes).changes;
    const view = fileProjectView(location.root);
    const base: PlanInput = { trigger, state: { decision: read.state.decision, status: read.status, explanation: read.explanation }, changes, uncertain: !!uncertain, view, decisionCommand: decisionCommand(env) };
    let plan: Plan = planActions(base);
    let fingerprint: Fingerprint | undefined;
    if (plan.gate === 'pending-decision') {
        let surface = true;
        try {
            surface = claimPendingPrompt(location, { host: event.host }).claimed;
        }
        catch { /* surfacing twice is better than never asking */ }
        plan = planActions({ ...base, surfacePending: surface });
    }
    else if (plan.gate === 'run' && !plan.oneOff) {
        // Hash only after the plan says checks are due in a configured project.
        const { version, manifest } = pluginVersion(env);
        const selection = selectCheckers(checkablePaths(changes).paths, view);
        fingerprint = computeFingerprint({ root: location.root, host: event.host, jstackVersion: version, hookManifest: manifest, tools: plan.actions.map(a => a.tool), configFiles: relevantConfigPaths(selection, view), env });
        plan = planActions({ ...base, reuse: diagnosticReuse(read.state, fingerprint), retryAllowed: retryAllowed(read.state.diagnostic, trigger, fingerprint) });
    }
    const findings = verdicts(plan, location.root, env, deps);
    // A pass describes completed checks, never mere checker availability. Record only
    // after every selected action has returned; an unknown or a gap is incomplete.
    if (plan.diagnose && fingerprint) {
        const status = findings.some(v => v.action === 'deny') ? 'fail'
            : findings.some(v => v.action === 'unknown' || v.action === 'context') ? 'incomplete' : 'pass';
        try {
            recordDiagnostic(location, { status, fingerprint, summary: `selected checks ${status}`, expectedRevision: read.status === 'ok' ? read.state.revision : 0 });
        }
        catch (error) {
            findings.push({ action: 'unknown', policy: POLICY, text: `project diagnostic could not be recorded (${(error as Error).message})` });
        }
    }
    return findings;
}
function verdicts(plan: Plan, root: string, env: NodeJS.ProcessEnv, deps: LaneDeps): Verdict[] {
    const out: Verdict[] = [];
    if (plan.pendingDecision?.surface)
        out.push({ action: 'context', policy: POLICY, text: plan.pendingDecision.message });
    if (plan.gate === 'run') {
        const run = deps.runAction ?? runSelection;
        for (const action of plan.actions) {
            const verdict = run(root, action, env);
            if (verdict)
                out.push(verdict);
        }
    }
    // A deferred or undecided plan stays quiet unless it has something the model must not mistake for a pass.
    const reportable = plan.gate === 'run' || (plan.gate === 'pending-decision' && !!plan.pendingDecision?.surface) || (plan.gate === 'skip' && plan.unknowns.length > 0);
    if (!reportable)
        return out;
    const offered = new Set(plan.offers.map(offer => offer.message));
    for (const text of plan.unknowns)
        if (!offered.has(text))
            out.push({ action: 'unknown', policy: POLICY, text });
    for (const offer of plan.offers)
        out.push({ action: 'context', policy: POLICY, text: `[UNKNOWN] ${offer.message}. Setup offer: needs separate user authorization; nothing was created.` });
    return out;
}
