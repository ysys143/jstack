import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { main, type HookInput, type HookResult } from './hook-common.js';
export function projectRoot(cwd = process.cwd()): string { let current = cwd; while (true) {
    if (existsSync(join(current, 'pyproject.toml')) || existsSync(join(current, '.git')))
        return current;
    const parent = dirname(current);
    if (parent === current)
        return cwd;
    current = parent;
} }
export function disabled(key: string, root = projectRoot()): boolean { try {
    const content = readFileSync(join(root, 'pyproject.toml'), 'utf8');
    const start = content.indexOf('[tool.claude-hooks]');
    if (start < 0)
        return false;
    const end = content.indexOf('\n[', start + 1);
    const section = content.slice(start, end < 0 ? undefined : end);
    return section.includes(`${key} = false`) || section.includes(`${key} = "false"`);
}
catch {
    return false;
} }
export function extractExecutableCommands(command: string): string { return command.replace(/<<-?\s*['"]?(\w+)['"]?.*?(?:^|\n)\1(?:\s|$)/gs, ' __HEREDOC__ ').replace(/\$\([^)]*<<[^)]*\)/gs, ' __SUBSHELL__ ').replace(/'[^']*'/g, ' __SQUOTE__ ').replace(/"[^"]*"/g, ' __DQUOTE__ '); }
const alternatives: Record<string, string[]> = { install: ['uv add', 'uv pip install'], uninstall: ['uv remove', 'uv pip uninstall'], list: ['uv pip list'], freeze: ['uv pip freeze'], show: ['uv pip show'], check: ['uv pip check'], download: ['uv pip download'], wheel: ['uv pip wheel'], cache: ['uv cache'], config: ['uv pip config'] };
export interface Detected {
    original: string;
    alternatives: string[];
    type: string;
}
export function findPipCommands(command: string): Detected[] {
    if (command.trim().startsWith('uv '))
        return [];
    const text = extractExecutableCommands(command);
    const found: Detected[] = [];
    const module = /\b(python3?)\s+-m\s+pip\s+(\w+)/i.exec(text);
    if (module) {
        const sub = module[2].toLowerCase();
        found.push({ original: `${module[1]} -m pip ${sub}`, alternatives: alternatives[sub] ?? ['uv pip ' + sub], type: 'python_module' });
    }
    for (const [sub, alts] of Object.entries(alternatives)) {
        for (const match of text.matchAll(new RegExp(`(?<![a-zA-Z])(pip3?)\\s+${sub}\\b`, 'gi'))) {
            if (!text.slice(Math.max(0, match.index! - 4), match.index).toLowerCase().includes('uv '))
                found.push({ original: `${match[1]} ${sub}`, alternatives: alts, type: 'direct_pip' });
        }
    }
    const pipx = /\bpipx\s+(\w+)/i.exec(text);
    if (pipx) {
        const sub = pipx[1].toLowerCase();
        found.push({ original: `pipx ${sub}`, alternatives: [sub === 'run' ? 'uv tool run (or uvx)' : `uv tool ${sub}`], type: 'pipx' });
    }
    const bare = /(?<![a-zA-Z])(pip3?)\s+(--\w+)/i.exec(text);
    if (bare)
        found.push({ original: `${bare[1]} ${bare[2]}`, alternatives: [`uv pip ${bare[2]}`], type: 'bare_pip' });
    return found;
}
export function handle(input: HookInput): HookResult {
    if (input.tool_name !== 'Bash' || disabled('enforce_uv'))
        return {};
    const command = input.tool_input?.command ?? '';
    const detected = findPipCommands(command);
    if (detected.length)
        return { decision: 'block', reason: '[WARN] pip/pip3/pipx are prohibited - use uv\n\nAlternative commands:\n' + detected.map(d => `- ${d.original}: ${d.alternatives.join(' or ')}`).join('\n') + '\n\n[DOC] https://docs.astral.sh/uv/' };
    if (!disabled('enforce_venv_check')) {
        const sub = /\buv\s+pip\s+(\w+)/i.exec(extractExecutableCommands(command))?.[1].toLowerCase();
        let venv = false;
        try {
            venv = statSync(join(projectRoot(), '.venv')).isDirectory();
        }
        catch { }
        if (sub && !['list', 'freeze', 'show', 'check'].includes(sub) && !venv)
            return { decision: 'block', reason: `[WARN] .venv not found - run \`uv venv\` first\n\n\`uv pip ${sub}\` requires a virtual environment.\nCreate it with uv venv, or use uv add / uv sync to create the environment automatically.\nSee: https://docs.astral.sh/uv/pip/environments/` };
    }
    return {};
}
main(import.meta.url, handle);
