import { isMain } from '../../../runtime/entry.js';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { dirname, basename, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import type { HookInput } from './hook-common.js';
// Tokenize rather than execute shell input. Substitutions cannot be inspected safely.
export function tokenize(command: string): string[] { const tokens: string[] = []; let token = '', quote = '', active = false; for (let i = 0; i < command.length; i++) {
    const char = command[i];
    if (quote) {
        if (char === quote) {
            quote = '';
            continue;
        }
        if (char === '\\' && quote === '"' && ['"', '\\', '$', '`', '\n'].includes(command[i + 1])) {
            token += command[++i] ?? '';
            continue;
        }
        token += char;
        continue;
    }
    if (char === '"' || char === "'") {
        quote = char;
        active = true;
        continue;
    }
    if (char === '\\') {
        if (i + 1 >= command.length)
            throw Error('Trailing escape');
        token += command[++i];
        active = true;
        continue;
    }
    if (char === '#') {
        while (i < command.length && command[i] !== '\n')
            i++;
        if (active) {
            tokens.push(token);
            token = '';
            active = false;
        }
        continue;
    }
    if (/\s/.test(char)) {
        if (active) {
            tokens.push(token);
            token = '';
            active = false;
        }
        continue;
    }
    if (/[();<>|&]/.test(char)) {
        if (active) {
            tokens.push(token);
            token = '';
            active = false;
        }
        let op = char;
        while (i + 1 < command.length && /[();<>|&]/.test(command[i + 1]))
            op += command[++i];
        tokens.push(op);
        continue;
    }
    token += char;
    active = true;
} if (quote)
    throw Error('Unclosed quote'); if (active)
    tokens.push(token); return tokens; }
export function parsePublishSource(command: string, cwd = process.cwd()): string | undefined { if (['$(', '`', '<(', '>('].some(marker => command.includes(marker)))
    throw Error('Unsafe substitution'); const tokens = tokenize(command), operators = new Set([';', '&&', '||', '|', '&', '>', '>>', '<', '<<']); let logical = cwd; for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === 'cd') {
        if (!tokens[i + 1] || operators.has(tokens[i + 1]))
            throw Error('Missing cd destination');
        logical = resolve(logical, tokens[i + 1]);
    }
    if (!['register_local.sh', 'register_local.js'].includes(basename(token)))
        continue;
    const source = tokens[i + 1];
    if (!source || operators.has(source) || /[\r\n]/.test(source))
        throw Error('Missing plugin source');
    return resolve(logical, source);
} return; }
export function validate(input: HookInput): {
    code: number;
    output: string;
} {
    const command = (input.tool_input?.command ?? '').replace(/\n/g, ' ');
    if (input.tool_name !== 'Bash' || !/register_local\.(?:sh|js)/.test(command))
        return { code: 0, output: '' };
    let source: string | undefined;
    try {
        source = parsePublishSource(command);
    }
    catch {
        return { code: 1, output: `[BLOCK] Could not safely parse the plugin path from the publish/register call\n        command: ${command}\n` };
    }
    if (!source)
        return { code: 0, output: '' };
    try {
        if (!statSync(source).isDirectory())
            throw Error();
    }
    catch {
        return { code: 1, output: `[BLOCK] Plugin directory does not exist: ${source}\n` };
    }
    const here = dirname(fileURLToPath(import.meta.url));
    const validator = [join(here, '../scripts/validate_plugin.js'), join(here, '../skills/author/scripts/validate_plugin.js'), join(here, '../../../skills/author/scripts/validate_plugin.js')].find(p => existsSync(p));
    if (!validator)
        return { code: 1, output: '[BLOCK] Format validator not found; no decision was made\n        Required: skills/author/scripts/validate_plugin.js in this plugin\n' };
    const result = spawnSync(process.execPath, [validator, source], { encoding: 'utf8', windowsHide: true });
    const intro = `[HOOK] Pre-publish format validation: ${source}\n       Validator: ${validator}\n${result.stdout ?? ''}${result.stderr ?? ''}`;
    return result.status === 0 ? { code: 0, output: intro + '[HOOK] Validation passed; continuing publish/register\n' } : { code: 1, output: intro + '[BLOCK] Validation failed; publish/register was blocked\nReproduce manually: node '+JSON.stringify(validator)+' '+JSON.stringify(source)+'\n' };
}
if (isMain(import.meta.url)) {
    try {
        const result = validate(JSON.parse(readFileSync(0, 'utf8')));
        process.stdout.write(result.output);
        process.exitCode = result.code;
    }
    catch {
        process.exitCode = 0;
    }
}
