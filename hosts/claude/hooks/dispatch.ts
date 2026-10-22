// Single hook entry for PreToolUse and PostToolUse on Claude Code and Codex.
// Usage: node dispatch.js <PreToolUse|PostToolUse> [--host claude|codex]
// Irrelevant events return before any policy module or project file is loaded.
import { readFileSync, statSync } from 'node:fs';
import { isMain } from '../../../runtime/entry.js';
import { normalize, type NormalizedEvent } from './hook-event.js';
import { emergencyDeny, render, type Rendered, type Verdict } from './hook-output.js';
import { applicable, type Policy } from './hook-policies.js';
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
export async function evaluate(event: NormalizedEvent, env: NodeJS.ProcessEnv = process.env, policies: Policy[] = applicable(event, env)): Promise<Verdict[]> {
    const verdicts: Verdict[] = [];
    // Cheap guards first; once one denies, expensive checks add cost without changing the outcome.
    const ordered = [...policies].sort((a, b) => Number(a.expensive) - Number(b.expensive));
    for (const policy of ordered) {
        if (policy.expensive && event.event === 'PreToolUse' && verdicts.some(v => v.action === 'deny'))
            continue;
        try {
            verdicts.push(...await policy.run(event, env));
        }
        catch (error) {
            // A fail-closed guard that cannot decide blocks; any other failure is unknown, never a pass.
            verdicts.push(policy.failClosed && event.event === 'PreToolUse'
                ? { action: 'deny', policy: policy.id, text: `[BLOCK] ${policy.id} guard could not decide (${message(error)}); the call was blocked` }
                : { action: 'unknown', policy: policy.id, text: `check failed to run (${message(error)})` });
        }
    }
    if (event.uncertain && event.kind === 'edit')
        verdicts.push({ action: 'unknown', policy: 'dispatch', text: `changed paths could not be extracted reliably (${event.uncertain}); no check is claimed for them` });
    return verdicts;
}
export async function dispatch(payloadText: string, eventName: string, hostOverride?: string, env: NodeJS.ProcessEnv = process.env): Promise<Rendered> {
    let payload: unknown;
    try {
        payload = JSON.parse(payloadText);
    }
    catch {
        // Legacy hooks pass on malformed stdin; no guard can inspect an unreadable call.
        return { stdout: '', stderr: '', exitCode: 0 };
    }
    const event = normalize(payload, eventName, hostOverride, env);
    if (event.kind === 'other' && !/\.hwpx/i.test(JSON.stringify((payload as any)?.tool_input ?? '')))
        return { stdout: '', stderr: '', exitCode: 0 };
    // Legacy handlers resolve the project from process.cwd(); Codex reports cwd in the payload.
    // Restore it for callers that invoke this module more than once in one process.
    const originalCwd = process.cwd();
    let changedCwd = false;
    try {
        if (event.cwd !== originalCwd && statSync(event.cwd).isDirectory()) {
            process.chdir(event.cwd);
            changedCwd = true;
        }
    }
    catch { /* keep the host cwd */ }
    try {
        const policies = applicable(event, env);
        if (!policies.length && !(event.uncertain && event.kind === 'edit'))
            return { stdout: '', stderr: '', exitCode: 0 };
        return render(event.host, event.event, await evaluate(event, env, policies));
    }
    finally {
        if (changedCwd)
            process.chdir(originalCwd);
    }
}
if (isMain(import.meta.url)) {
    const args = process.argv.slice(2);
    const hostAt = args.indexOf('--host');
    const host = hostAt >= 0 ? args[hostAt + 1] : undefined;
    const eventName = args.filter((arg, index) => !arg.startsWith('--') && !(hostAt >= 0 && index === hostAt + 1))[0] ?? '';
    let stdin = '';
    try {
        stdin = readFileSync(0, 'utf8');
    }
    catch { /* empty input passes like malformed input */ }
    const write = (result: Rendered) => {
        if (result.stdout)
            process.stdout.write(result.stdout);
        if (result.stderr)
            process.stderr.write(result.stderr);
        process.exitCode = result.exitCode;
    };
    dispatch(stdin, eventName, host).then(write, error => {
        // Only reached if normalization or rendering itself throws. Guard an event that
        // names a fail-closed publish/register call; everything else reports and passes.
        if (eventName === 'PreToolUse' && /register_local\.(?:sh|js)/.test(stdin))
            write(emergencyDeny(`hook dispatcher failed (${message(error)}) on a fail-closed guarded call`));
        else
            write({ stdout: JSON.stringify({ systemMessage: `[UNKNOWN] jstack hook dispatcher failed: ${message(error)}` }) + '\n', stderr: '', exitCode: 0 });
    });
}
