import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, join } from 'node:path';
import { gitRoot, main, run, type HookInput, type HookResult } from './hook-common.js';
function invoke(command: string, args: string[], timeout: number) { return spawnSync(command, args, { encoding: 'utf8', timeout, windowsHide: true }); }
export function config(root: string): {
    enabled: boolean;
    autoFormat: boolean;
    pyright: boolean;
} { let section = ''; try {
    const text = readFileSync(join(root, 'pyproject.toml'), 'utf8'), start = text.indexOf('[tool.claude-hooks]');
    if (start >= 0) {
        const end = text.indexOf('\n[', start + 1);
        section = text.slice(start, end < 0 ? undefined : end);
    }
}
catch { } return { enabled: !section.includes('pre_commit_check = false'), autoFormat: !section.includes('auto_format = false'), pyright: section.includes('pyright_check = true') }; }
export function runRuffFormat(files: string[]): [
    boolean,
    string[],
    string
] { if (!files.length)
    return [true, [], '']; const check = invoke('ruff', ['format', '--check', '--diff', ...files], 60000); if (check.error)
    return [true, [], (check.error as NodeJS.ErrnoException).code === 'ENOENT' ? '' : `[WARN] formatting error: ${check.error.message}`]; if (check.status === 0)
    return [true, [], '']; const format = invoke('ruff', ['format', ...files], 60000); if (format.error)
    return [true, [], `[WARN] formatting error: ${format.error.message}`]; if (format.status !== 0)
    return [false, [], `[WARN] ruff format failed: ${format.stderr}`]; const changed = new Set(check.stdout.split('\n').filter(l => l.startsWith('--- ')).map(l => l.slice(4).trim().replace(/^a\//, ''))); return [true, files, `[OK] ruff format applied to ${changed.size || files.length} files`]; }
export function runRuffCheck(files: string[]): [
    boolean,
    string
] { if (!files.length)
    return [true, '']; const result = invoke('ruff', ['check', '--output-format=grouped', ...files], 60000); if (result.error)
    return [true, (result.error as NodeJS.ErrnoException).code === 'ENOENT' ? '[WARN] ruff is not installed' : (result.error as NodeJS.ErrnoException).code === 'ETIMEDOUT' ? '[WARN] ruff timed out' : `[WARN] ruff error: ${result.error.message}`]; if (result.status === 0)
    return [true, '']; const count = Number(/Found (\d+) error/.exec(result.stdout)?.[1] ?? result.stdout.trim().split('\n').filter(l => l.trim() && !l.startsWith(' ') && l.includes(':')).length); const match = /\[(\*|\d+) fixable/.exec(result.stdout)?.[1]; const fixable = match === '*' ? count : Number(match ?? 0); let filenames = files.slice(0, 3).map(f => basename(f)).join(', '); if (files.length > 3)
    filenames += ` and ${files.length - 3} more`; return [false, `[FAIL] **ruff check failed** - fix before committing\n\n**Error summary:** ${count} total (${fixable} automatically fixable)\n\n\`\`\`\n${result.stdout.slice(0, 1500)}\n\`\`\`\n\n**[HINT] How to fix:**\n• Automatic fix: \`ruff check --fix ${files.length === 1 ? files[0] : '.'}\`\n• Checked files: ${filenames}\n`]; }
export function runPyrightCheck(files: string[]): [
    boolean,
    string
] { if (!files.length)
    return [true, '']; const result = invoke('pyright', files, 120000); if (result.error || result.status === 0)
    return [true, '']; const count = /(\d+) error/.exec(result.stdout)?.[1] ?? 'multiple'; return [false, `\n[FAIL] **pyright type errors** - ${count}\n\n\`\`\`\n${result.stdout.slice(0, 1000)}\n\`\`\`\n`]; }
export function handle(input: HookInput): HookResult { if (input.tool_name !== 'Bash' || !/\bgit\s+commit\b/i.test(input.tool_input?.command ?? ''))
    return {}; const root = gitRoot(); if (!root)
    return {}; const settings = config(root); if (!settings.enabled)
    return {}; const staged = run('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], root); if (staged.status !== 0)
    return {}; const files = staged.stdout.trim().split('\n').filter(f => /\.pyi?$/.test(f)).map(f => join(root, f)); if (!files.length)
    return {}; const messages: string[] = []; if (settings.autoFormat) {
    const [ok, formatted, message] = runRuffFormat(files);
    if (message)
        messages.push(message);
    if (ok && formatted.length)
        invoke('git', ['add', ...formatted], 30000);
} const [checkOK, checkMessage] = runRuffCheck(files); let pyrightOK = true; if (settings.pyright) {
    const [ok, message] = runPyrightCheck(files);
    pyrightOK = ok;
    if (message)
        messages.push(message);
} if (checkOK && pyrightOK)
    return { systemMessage: [...messages, `[OK] Python quality checks passed for ${files.length} files`].join('\n') }; if (checkMessage)
    messages.push(checkMessage); return { decision: 'block', reason: messages.join('\n') }; }
main(import.meta.url, handle);
