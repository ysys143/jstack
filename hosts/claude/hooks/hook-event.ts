// Normalize Claude and Codex hook payloads into one host-neutral event.
// Keep this module import-light: the dispatcher loads it for every matched call.
import { isAbsolute, relative, resolve } from 'node:path';
import { parsePatch, type ChangeOp } from './hook-patch.js';
import type { HookInput } from './hook-common.js';
export type Host = 'claude' | 'codex';
export type EventKind = 'shell' | 'edit' | 'other';
export interface ChangedPath {
    /** Absolute path resolved against the event cwd. */
    path: string;
    /** Path relative to the event cwd, as the tool named it when possible. */
    relative: string;
    op: ChangeOp;
    moveTo?: string;
    /** New content (Write/add) or added lines only (Edit/update). Absent when unknown. */
    text?: string;
}
export interface NormalizedEvent {
    host: Host;
    event: string;
    /** Original tool name, e.g. "apply_patch" or "exec_command". */
    toolName: string;
    kind: EventKind;
    command?: string;
    changes: ChangedPath[];
    /** Why the change set could not be extracted with confidence. Never a pass. */
    uncertain?: string;
    cwd: string;
    raw: unknown;
}
const SHELL_TOOLS = new Set(['Bash', 'exec_command', 'shell', 'local_shell', 'container.exec']);
const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
export function detectHost(payload: any, override?: string, env: NodeJS.ProcessEnv = process.env): Host {
    if (override === 'claude' || override === 'codex')
        return override;
    const tool = payload?.tool_name;
    if (tool === 'apply_patch' || tool === 'exec_command' || tool === 'local_shell')
        return 'codex';
    if (payload?.turn_id !== undefined || (env.PLUGIN_ROOT && !env.CLAUDE_PLUGIN_ROOT) || env.CODEX_HOME && !env.CLAUDE_PROJECT_DIR)
        return 'codex';
    return 'claude';
}
/** Codex shell input may be a string, an argv array, or an exec_command `cmd`. */
export function shellCommand(input: any): string | undefined {
    const value = input?.command ?? input?.cmd;
    if (typeof value === 'string')
        return value;
    if (Array.isArray(value) && value.every(part => typeof part === 'string')) {
        if (value.length >= 3 && /(^|\/)(ba|z|)sh$/.test(value[0]) && /^-l?c$/.test(value[1]))
            return value[2];
        return value.map(part => /^[\w@%+=:,./-]+$/.test(part) ? part : `'${part.replace(/'/g, `'\\''`)}'`).join(' ');
    }
    return;
}
function changed(cwd: string, name: string, op: ChangeOp, text?: string, moveTo?: string): ChangedPath {
    const path = isAbsolute(name) ? name : resolve(cwd, name);
    return { path, relative: isAbsolute(name) ? relative(cwd, name) || name : name, op, text, ...(moveTo ? { moveTo: isAbsolute(moveTo) ? moveTo : resolve(cwd, moveTo) } : {}) };
}
export function normalize(payload: any, event?: string, hostOverride?: string, env: NodeJS.ProcessEnv = process.env): NormalizedEvent {
    const host = detectHost(payload, hostOverride, env);
    const toolName = typeof payload?.tool_name === 'string' ? payload.tool_name : '';
    const cwd = typeof payload?.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd();
    const input = payload?.tool_input ?? {};
    const base = { host, event: event || payload?.hook_event_name || '', toolName, cwd, raw: payload, changes: [] as ChangedPath[] };
    if (SHELL_TOOLS.has(toolName)) {
        const command = shellCommand(input);
        // A shell call that runs apply_patch is an edit as far as policies are concerned.
        if (command !== undefined && /\bapply_patch\b/.test(command) && command.includes('*** Begin Patch'))
            return patchEvent(base, command);
        return command === undefined ? { ...base, kind: 'shell', uncertain: 'shell input has no command string' } : { ...base, kind: 'shell', command };
    }
    if (toolName === 'apply_patch') {
        const command = typeof input === 'string' ? input : typeof input?.command === 'string' ? input.command : typeof input?.patch === 'string' ? input.patch : typeof input?.input === 'string' ? input.input : '';
        return patchEvent(base, command);
    }
    if (EDIT_TOOLS.has(toolName)) {
        const file = toolName === 'NotebookEdit' ? (input.notebook_path || input.file_path) : input.file_path;
        const text = toolName === 'Write' ? input.content : toolName === 'Edit' ? input.new_string : toolName === 'MultiEdit' ? (input.edits ?? []).map((e: any) => e?.new_string ?? '').join('\n') : input.new_source;
        if (typeof file !== 'string' || !file)
            return { ...base, kind: 'edit', uncertain: `${toolName} input has no file path` };
        return { ...base, kind: 'edit', changes: [changed(cwd, file, toolName === 'Write' ? 'add' : 'update', typeof text === 'string' ? text : undefined)] };
    }
    return { ...base, kind: 'other' };
}
function patchEvent(base: Omit<NormalizedEvent, 'kind'>, command: string): NormalizedEvent {
    const parsed = parsePatch(command);
    return { ...base, kind: 'edit', command, changes: parsed.changes.map(c => changed(base.cwd, c.path, c.op, c.op === 'delete' ? undefined : c.text, c.moveTo)), ...(parsed.uncertain ? { uncertain: parsed.uncertain } : {}) };
}
/** Legacy handlers expect Claude-shaped input. Codex edits become one Write-shaped input per file. */
export function legacyInputs(event: NormalizedEvent): HookInput[] {
    if (event.kind === 'shell')
        // Carry the session directory: a handler that resolves a repository needs the
        // directory the command starts from, not the dispatcher's process directory.
        return [{ tool_name: 'Bash', cwd: event.cwd, tool_input: { command: event.command ?? '' } }];
    if (event.kind !== 'edit')
        return [];
    if (EDIT_TOOLS.has(event.toolName))
        return [event.raw as HookInput];
    return event.changes.filter(c => c.op !== 'delete').map(c => ({ tool_name: c.op === 'add' ? 'Write' : 'Edit', tool_input: c.op === 'add' ? { file_path: c.moveTo ?? c.path, content: c.text ?? '' } : { file_path: c.moveTo ?? c.path, new_string: c.text ?? '' } }));
}
