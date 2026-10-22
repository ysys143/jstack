// Policy registry for the single dispatcher. Prefilters are pure string tests with no
// imports or I/O; a policy module is loaded only after its prefilter matches.
// Dynamic imports use string literals so packaging can rewrite their targets.
import { legacyInputs, type EventKind, type NormalizedEvent } from './hook-event.js';
import { containsEmoji } from './block_emoji.js';
import type { Verdict } from './hook-output.js';
import type { HookResult } from './hook-common.js';
export interface Policy {
    id: string;
    /** Legacy handler(s) this policy replaces, for the migration map. */
    replaces: string[];
    events: readonly string[];
    kinds: readonly EventKind[];
    /** A guard that must block when it cannot decide (existing fail-closed contract). */
    failClosed: boolean;
    /** Spawns checkers, reads GitHub, or scans many files; skipped once a cheaper guard denied. */
    expensive: boolean;
    prefilter(event: NormalizedEvent, env: NodeJS.ProcessEnv): boolean;
    run(event: NormalizedEvent, env: NodeJS.ProcessEnv): Promise<Verdict[]>;
}
const MODEL_HINT = /model|gpt-|claude-|gemini-|qwen|kimi-k|deepseek-v|glm-|solar-|kanana-|exaone-/i;
const GIT_COMMIT = /\bgit\s+commit\b/i, GIT_PUSH = /\bgit\s+push\b/i;
// The local reader makes the final call; cheap prefilter must also admit wrapped commands.
const GH_PR_CREATE = /\bgh\b|\b(?:bash|sh|zsh)\s+-\w*c\b/;
// Two linear tests rather than one `git|gh ... commit|pr` pattern, which backtracks quadratically on a long command.
const GIT_OR_GH = /\b(?:git|gh)\b/, COMMIT_OR_PR = /\b(?:commit|pr)\b/;
const PUBLISH = /register_local\.(?:sh|js)/;
const PYTHON = /\.pyi?$/;
/** Mirrors the project check selection extensions without loading that module. */
export const PROJECT_EXTENSIONS = /\.(?:pyi?|[cm]?[jt]sx?|go|rs)$/i;
/** Text a content policy should inspect: parsed new text, or raw added lines when parsing was uncertain. */
export function inspectedText(event: NormalizedEvent): string {
    if (event.kind === 'shell')
        return event.command ?? '';
    const parsed = event.changes.map(c => c.text ?? '').join('\n');
    if (event.uncertain && event.changes.length === 0) {
        // A host may omit the target path while still supplying new content.
        // Path-based checks remain unknown, but content guards must see it.
        const input = (event.raw as any)?.tool_input ?? {};
        if (event.toolName === 'Write' && typeof input.content === 'string')
            return input.content;
        if (event.toolName === 'Edit' && typeof input.new_string === 'string')
            return input.new_string;
        if (event.toolName === 'MultiEdit' && Array.isArray(input.edits))
            return input.edits.map((edit: any) => typeof edit?.new_string === 'string' ? edit.new_string : '').join('\n');
        if (event.toolName === 'NotebookEdit' && typeof input.new_source === 'string')
            return input.new_source;
    }
    if (!event.uncertain || !event.command)
        return parsed;
    const added = event.command.split(/\r?\n/).filter(line => line.startsWith('+') && !line.startsWith('+++')).map(line => line.slice(1)).join('\n');
    return parsed + '\n' + added;
}
function fromResult(policy: string, result: HookResult | undefined): Verdict[] {
    if (!result)
        return [];
    const out: Verdict[] = [];
    if (result.decision === 'block')
        out.push({ action: 'deny', policy, text: result.reason ?? `Blocked by ${policy}` });
    if (result.additionalContext)
        out.push({ action: 'context', policy, text: result.additionalContext });
    if (result.systemMessage)
        out.push({ action: 'message', policy, text: result.systemMessage });
    return out;
}
const shellOnly = (event: NormalizedEvent, pattern: RegExp) => event.kind === 'shell' && pattern.test(event.command ?? '');
const truthy = (value: string | undefined) => ['1', 'true', 'on', 'yes'].includes((value ?? '').toLowerCase());
const falsy = (value: string | undefined) => ['0', 'false', 'off', 'no'].includes((value ?? '').toLowerCase());
export const legacyRuffEnabled = (env: NodeJS.ProcessEnv) => truthy(env.JSTACK_HOOK_LEGACY_RUFF);
export const POLICIES: readonly Policy[] = [
    {
        id: 'emoji', replaces: ['hooks/block_emoji.js'], events: ['PreToolUse'], kinds: ['shell', 'edit'], failClosed: false, expensive: false,
        prefilter: event => containsEmoji(inspectedText(event)).length > 0,
        async run(event) {
            const { handle } = await import('./block_emoji.js');
            if (event.kind === 'edit' && event.uncertain)
                return fromResult('emoji', handle({ tool_name: 'Write', tool_input: { file_path: '', content: inspectedText(event) } }));
            return legacyInputs(event).flatMap(input => fromResult('emoji', handle(input)));
        },
    },
    {
        id: 'hwpx', replaces: ['skills/hwpx/hooks/hwpx_guard.js'], events: ['PreToolUse'], kinds: ['shell', 'edit', 'other'], failClosed: false, expensive: false,
        prefilter: event => /\.hwpx/i.test(JSON.stringify((event.raw as any)?.tool_input ?? '')),
        async run(event) {
            const { handle } = await import('../../../skills/public/artifacts/hwpx-document/hooks/hwpx_guard.js');
            return fromResult('hwpx', handle(event.raw as { tool_input?: unknown }));
        },
    },
    {
        id: 'model-versions', replaces: ['hooks/check_model_versions.js'], events: ['PreToolUse'], kinds: ['shell', 'edit'], failClosed: false, expensive: false,
        prefilter: event => MODEL_HINT.test(inspectedText(event)),
        async run(event) {
            const { handle } = await import('./check_model_versions.js');
            return legacyInputs(event).flatMap((input): Verdict[] => {
                const warning = handle(input);
                if (!warning)
                    return [];
                // The legacy stderr + exit 1 path was the documented block, but exit 1 blocks on neither host.
                return warning.startsWith('WARN_ONLY:') ? [{ action: 'context', policy: 'model-versions', text: warning.slice('WARN_ONLY:'.length) }] : [{ action: 'deny', policy: 'model-versions', text: warning }];
            });
        },
    },
    {
        id: 'uv', replaces: ['hooks/validate_uv_usage.js'], events: ['PreToolUse'], kinds: ['shell'], failClosed: false, expensive: false,
        prefilter: event => shellOnly(event, /\bpip|\bpipx\b/i),
        async run(event) {
            const { handle } = await import('./validate_uv_usage.js');
            return legacyInputs(event).flatMap(input => fromResult('uv', handle(input)));
        },
    },
    {
        id: 'publish', replaces: ['hooks/validate_before_publish.js'], events: ['PreToolUse'], kinds: ['shell'], failClosed: true, expensive: false,
        prefilter: event => shellOnly(event, PUBLISH),
        async run(event): Promise<Verdict[]> {
            const { validate } = await import('./validate_before_publish.js');
            const result = validate({ tool_name: 'Bash', tool_input: { command: event.command ?? '' } });
            // The legacy exit-1 block did not block on either host; deny is the intended contract.
            if (result.code !== 0)
                return [{ action: 'deny', policy: 'publish', text: result.output || '[BLOCK] Pre-publish validation failed' }];
            return result.output ? [{ action: 'message', policy: 'publish', text: result.output }] : [];
        },
    },
    {
        id: 'readme-version', replaces: ['hooks/check_readme_version.js'], events: ['PreToolUse'], kinds: ['shell'], failClosed: false, expensive: false,
        prefilter: event => shellOnly(event, GIT_COMMIT),
        async run(event) {
            const { handle } = await import('./check_readme_version.js');
            return legacyInputs(event).flatMap(input => fromResult('readme-version', handle(input)));
        },
    },
    {
        id: 'marketplace-versions', replaces: ['hooks/check_marketplace_versions.js'], events: ['PreToolUse'], kinds: ['shell'], failClosed: false, expensive: false,
        prefilter: event => shellOnly(event, GIT_PUSH),
        async run(event) {
            const { handle } = await import('./check_marketplace_versions.js');
            return legacyInputs(event).flatMap(input => fromResult('marketplace-versions', handle(input)));
        },
    },
    {
        // Looser than GIT_COMMIT/GH_PR_CREATE so `git -C dir commit` and `gh -R repo pr create` are inspected.
        id: 'ai-attribution', replaces: ['hooks/block_ai_attribution.js'], events: ['PreToolUse'], kinds: ['shell'], failClosed: false, expensive: false,
        prefilter: event => shellOnly(event, GIT_OR_GH) && COMMIT_OR_PR.test(event.command ?? ''),
        async run(event) {
            const { handle } = await import('./block_ai_attribution.js');
            return legacyInputs(event).flatMap(input => fromResult('ai-attribution', handle(input)));
        },
    },
    {
        id: 'pr-label', replaces: ['hooks/validate_pr_label.js'], events: ['PreToolUse'], kinds: ['shell'], failClosed: false, expensive: true,
        prefilter: event => shellOnly(event, GH_PR_CREATE),
        async run(event) {
            const { handle } = await import('./validate_pr_label.js');
            return legacyInputs(event).flatMap(input => fromResult('pr-label', handle(input)));
        },
    },
    {
        // Superseded by the project lane; retained only behind an explicit transition switch.
        id: 'legacy-ruff-commit', replaces: ['hooks/ruff_check_before_commit.js'], events: ['PreToolUse'], kinds: ['shell'], failClosed: false, expensive: true,
        prefilter: (event, env) => legacyRuffEnabled(env) && shellOnly(event, GIT_COMMIT),
        async run(event) {
            const { handle } = await import('./ruff_check_before_commit.js');
            return legacyInputs(event).flatMap(input => fromResult('legacy-ruff-commit', handle(input)));
        },
    },
    {
        id: 'legacy-ruff-edit', replaces: ['hooks/ruff_check_after_edit.js'], events: ['PostToolUse'], kinds: ['edit'], failClosed: false, expensive: true,
        prefilter: (event, env) => legacyRuffEnabled(env) && event.changes.some(c => c.op !== 'delete' && PYTHON.test(c.moveTo ?? c.path)),
        async run(event) {
            const { checkAfterEdit } = await import('./ruff_check_after_edit.js');
            return legacyInputs(event).flatMap((input): Verdict[] => {
                const message = checkAfterEdit(input);
                return message ? [{ action: 'diagnostic', policy: 'legacy-ruff-edit', text: message }] : [];
            });
        },
    },
    {
        id: 'project', replaces: [], events: ['PreToolUse', 'PostToolUse'], kinds: ['shell', 'edit'], failClosed: false, expensive: true,
        prefilter: (event, env) => {
            if (falsy(env.JSTACK_PROJECT_HOOKS))
                return false;
            if (event.event === 'PreToolUse')
                return shellOnly(event, GIT_COMMIT);
            return event.event === 'PostToolUse' && event.kind === 'edit' && (!!event.uncertain || event.changes.some(c => PROJECT_EXTENSIONS.test(c.moveTo ?? c.path)));
        },
        async run(event, env) {
            const { runProjectLane } = await import('./hook-project.js');
            return runProjectLane(event, env);
        },
    },
];
export function applicable(event: NormalizedEvent, env: NodeJS.ProcessEnv = process.env): Policy[] {
    return POLICIES.filter(p => p.events.includes(event.event) && p.kinds.includes(event.kind) && p.prefilter(event, env));
}
