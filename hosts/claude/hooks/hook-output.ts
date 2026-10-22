// Render policy verdicts into each host's hook output contract.
//
// Claude Code: PreToolUse denies through hookSpecificOutput.permissionDecision "deny"
// with permissionDecisionReason; additionalContext and systemMessage are accepted.
// Codex (checked against the pre-tool-use/post-tool-use command.output schemas embedded
// in codex-cli 0.157.1): PreToolUse accepts permissionDecision "deny" only with a
// non-empty permissionDecisionReason and rejects "allow", "ask", continue:false,
// suppressOutput, stopReason, and updatedInput; hookSpecificOutput has
// additionalProperties:false. PostToolUse accepts decision "block", reason,
// hookSpecificOutput.additionalContext, and systemMessage.
//
// PostToolUse cannot undo an edit already performed, so post-tool findings are
// rendered as diagnostics (additionalContext), never as a block.
import type { Host } from './hook-event.js';
export type VerdictAction = 'deny' | 'diagnostic' | 'context' | 'message' | 'unknown';
export interface Verdict {
    action: VerdictAction;
    policy: string;
    text: string;
}
export interface Rendered {
    stdout: string;
    stderr: string;
    exitCode: number;
}
const joinText = (verdicts: Verdict[]) => verdicts.map(v => v.text.trim()).filter(Boolean).join('\n\n');
// The host is explicit so a future divergence has one place to land; the fields used
// below are accepted identically by both current contracts.
export function render(_host: Host, event: string, verdicts: Verdict[]): Rendered {
    const denies = verdicts.filter(v => v.action === 'deny');
    // Unknown results are model-visible context: a missing check is never presented as a pass.
    const context = joinText(verdicts.filter(v => v.action === 'context' || v.action === 'diagnostic' || v.action === 'unknown').map(v => v.action === 'unknown' ? { ...v, text: `[UNKNOWN] ${v.policy}: ${v.text}` } : v));
    const message = joinText(verdicts.filter(v => v.action === 'message'));
    if (event === 'PreToolUse') {
        const out: Record<string, unknown> = {};
        const specific: Record<string, unknown> = { hookEventName: 'PreToolUse' };
        if (denies.length) {
            specific.permissionDecision = 'deny';
            // Both hosts need a non-empty reason; Codex rejects a deny without one.
            specific.permissionDecisionReason = joinText(denies) || `Blocked by ${denies.map(d => d.policy).join(', ')}`;
        }
        if (context)
            specific.additionalContext = context;
        if (Object.keys(specific).length > 1)
            out.hookSpecificOutput = specific;
        if (message)
            out.systemMessage = message;
        return { stdout: Object.keys(out).length ? JSON.stringify(out) + '\n' : '', stderr: '', exitCode: 0 };
    }
    if (event === 'PostToolUse') {
        // A deny after the tool ran is reported as a diagnostic; the edit already happened.
        const all = joinText([...denies.map(d => ({ ...d, text: `[AFTER EDIT] ${d.text}` })), ...(context ? [{ action: 'context' as const, policy: '', text: context }] : [])]);
        const out: Record<string, unknown> = {};
        if (all)
            out.hookSpecificOutput = { hookEventName: 'PostToolUse', additionalContext: all };
        if (message)
            out.systemMessage = message;
        return { stdout: Object.keys(out).length ? JSON.stringify(out) + '\n' : '', stderr: '', exitCode: 0 };
    }
    // Other events are not dispatched here; report rather than guess a contract.
    const text = joinText(verdicts);
    return { stdout: text ? JSON.stringify({ systemMessage: text }) + '\n' : '', stderr: '', exitCode: 0 };
}
/**
 * Last-resort denial when the dispatcher itself fails before it can build verdicts
 * for an event that includes a fail-closed guard. Exit code 2 with stderr blocks a
 * PreToolUse call on both hosts without depending on JSON parsing.
 */
export function emergencyDeny(reason: string): Rendered {
    return { stdout: '', stderr: `[BLOCK] ${reason}\n`, exitCode: 2 };
}
