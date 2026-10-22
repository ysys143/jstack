import { isMain } from '../../../runtime/entry.js';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { projectRoot, disabled } from './validate_uv_usage.js';
import type { HookInput } from './hook-common.js';
export interface RuffError {
    location: string;
    code: string;
    message: string;
    full: string;
}
export function parseRuffOutput(output: string): [
    RuffError[],
    RuffError[]
] { const fixable: RuffError[] = []; const manual: RuffError[] = []; for (const line of output.trim().split('\n')) {
    const at = line.indexOf(': ');
    if (at < 0)
        continue;
    const location = line.slice(0, at), rest = line.slice(at + 2), space = rest.indexOf(' '), code = space < 0 ? rest : rest.slice(0, space), message = space < 0 ? rest : rest.slice(space + 1);
    const error = { location, code, message, full: line };
    (['I001', 'I002', 'F401', 'F841', 'E401', 'E701', 'E702', 'E703', 'W291', 'W292', 'W293', 'UP', 'COM812', 'Q'].some(p => code.startsWith(p)) ? fixable : manual).push(error);
} return [fixable, manual]; }
export function runRuffCheck(file: string): [
    boolean,
    string
] { const result = spawnSync('ruff', ['check', '--output-format=concise', file], { encoding: 'utf8', timeout: 30000, windowsHide: true }); if (result.error || result.status === 0)
    return [true, '']; const [fixable, manual] = parseRuffOutput(result.stdout); const parts = ['[SCAN] **ruff check errors found**\n']; for (const [errors, title] of [[fixable, '**[FIX] Automatically fixable (use --fix):**'], [manual, '**[EDIT] Manual changes required:**']] as const) {
    if (!errors.length)
        continue;
    parts.push(title, ...errors.slice(0, 5).map(e => `  • \`${e.code}\` ${e.location}: ${e.message}`));
    if (errors.length > 5)
        parts.push(`  ... and ${errors.length - 5} more`);
    parts.push('');
} parts.push('[HINT] Fix the errors, then try again.'); return [false, parts.join('\n')]; }
export function runPyrightCheck(file: string): [
    boolean,
    string
] { const result = spawnSync('pyright', ['--outputjson', file], { encoding: 'utf8', timeout: 60000, windowsHide: true }); if (result.error || result.status === 0)
    return [true, '']; try {
    const errors = (JSON.parse(result.stdout).generalDiagnostics ?? []).filter((d: any) => d.severity === 1);
    if (!errors.length)
        return [true, ''];
    const parts = ['\n[SCAN] **pyright type errors:**', ...errors.slice(0, 5).map((e: any) => `  • Line ${(e.range?.start?.line ?? 0) + 1}: ${e.message ?? ''}${e.rule ? ' [' + e.rule + ']' : ''}`)];
    if (errors.length > 5)
        parts.push(`  ... and ${errors.length - 5} more errors`);
    return [false, parts.join('\n')];
}
catch {
    return /error/i.test(result.stdout) ? [false, '\n[SCAN] **pyright errors:**\n' + result.stdout.slice(0, 500)] : [true, ''];
} }
export function enabledPyright(root = projectRoot()): boolean { try {
    const content = readFileSync(join(root, 'pyproject.toml'), 'utf8');
    const start = content.indexOf('[tool.claude-hooks]');
    if (start < 0)
        return false;
    const end = content.indexOf('\n[', start + 1);
    const section = content.slice(start, end < 0 ? undefined : end);
    return section.includes('pyright_check = true') || section.includes('pyright_check = "true"');
}
catch {
    return false;
} }
export function checkAfterEdit(input: HookInput): string | undefined { const file = input.tool_input?.file_path; if (!['Write', 'Edit'].includes(input.tool_name ?? '') || !file || !/\.pyi?$/.test(file) || !existsSync(file) || disabled('ruff_check'))
    return; const messages: string[] = []; const [ruffOK, ruffMessage] = runRuffCheck(file); if (!ruffOK)
    messages.push(ruffMessage); if (enabledPyright()) {
    const [ok, message] = runPyrightCheck(file);
    if (!ok)
        messages.push(message);
} return messages.length ? messages.join('\n') : undefined; }
if (isMain(import.meta.url)) {
    try {
        const message = checkAfterEdit(JSON.parse(readFileSync(0, 'utf8')));
        if (message) {
            console.error(message);
            process.exitCode = 2;
        }
        else
            console.log('{}');
    }
    catch {
        console.log('{}');
    }
}
