import { readFileSync } from 'node:fs';
import { runProcess as spawnSync } from '../../../runtime/os.js';
import { pathToFileURL } from 'node:url';
export interface HookInput {
    tool_name?: string;
    cwd?: string;
    tool_input?: {
        command?: string;
        content?: string;
        new_string?: string;
        new_source?: string;
        edits?: {
            new_string?: string;
        }[];
        file_path?: string;
    };
}
export type HookResult = {
    decision?: 'block';
    reason?: string;
    additionalContext?: string;
    systemMessage?: string;
};
export function run(command: string, args: string[], cwd = process.cwd()) { return spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 10000, windowsHide: true }); }
export function gitRoot(cwd = process.cwd()): string | undefined { const result = run('git', ['rev-parse', '--show-toplevel'], cwd); return result.status === 0 ? result.stdout.trim() : undefined; }
export function jsonFile(path: string): any { try {
    return JSON.parse(readFileSync(path, 'utf8'));
}
catch {
    return undefined;
} }
export function main(url: string, handler: (input: HookInput) => HookResult | undefined): void { if (process.argv[1] && pathToFileURL(process.argv[1]).href === url) {
    try {
        const result = handler(JSON.parse(readFileSync(0, 'utf8')));
        if (result)
            process.stdout.write(JSON.stringify(result) + '\n');
    }
    catch {
        process.stdout.write('{}\n');
    }
} }
const ANSI_C: Record<string, string> = { n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', v: '\v', '\\': '\\', "'": "'", '"': '"', '?': '?' };
/** Decodes the body of a bash `$'...'` word that starts at `from`; returns the text and the index of the closing quote. */
function ansiC(command: string, from: number): [string, number] {
    let out = '', i = from;
    for (; i < command.length && command[i] !== "'"; i++) {
        if (command[i] !== '\\' || i + 1 >= command.length) { out += command[i]; continue; }
        const next = command[++i];
        const digits = next === 'x' ? /^[0-9a-fA-F]{1,2}/.exec(command.slice(i + 1, i + 3)) : next === 'u' ? /^[0-9a-fA-F]{1,4}/.exec(command.slice(i + 1, i + 5)) : next === 'U' ? /^[0-9a-fA-F]{1,8}/.exec(command.slice(i + 1, i + 9)) : /^[0-7]{1,3}/.exec(command.slice(i, i + 3));
        if (next in ANSI_C) out += ANSI_C[next];
        else if (digits && (next === 'x' || next === 'u' || next === 'U')) { const code = parseInt(digits[0], 16); out += code <= 0x10ffff ? String.fromCodePoint(code) : ''; i += digits[0].length; }
        else if (digits) { out += String.fromCharCode(parseInt(digits[0], 8)); i += digits[0].length - 1; }
        else out += '\\' + next;
    }
    return [out, i];
}
/** Split a shell command into simple-command word lists, keeping quoted text as data. */
export function shellCommands(command: string): string[][] {
    const commands: string[][] = []; let words: string[] = [], word = '', started = false, quote = '';
    const endWord = () => { if (started) words.push(word); word = ''; started = false; };
    const endCommand = () => { endWord(); if (words.length) commands.push(words); words = []; };
    for (let i = 0; i < command.length; i++) {
        const c = command[i];
        if (quote === "'") { if (c === "'") quote = ''; else word += c; continue; }
        if (quote === '"') {
            if (c === '"') quote = '';
            // Inside double quotes bash drops a backslash only before $ ` " \ or a newline; `\n` stays two characters.
            else if (c === '\\' && i + 1 < command.length) { const next = command[i + 1]; if ('$`"\\'.includes(next)) word += command[++i]; else if (next === '\n') i++; else word += c; }
            else word += c;
            continue;
        }
        if (c === '$' && command[i + 1] === "'") { const [text, end] = ansiC(command, i + 2); word += text; started = true; i = end; }
        else if (c === "'" || c === '"') { quote = c; started = true; }
        else if (c === '\\' && i + 1 < command.length) { word += command[++i]; started = true; }
        else if (c === '\n' || c === ';' || c === '&' || c === '|' || c === '(' || c === ')' || c === '`') endCommand();
        else if (/\s/.test(c)) endWord();
        else if (c === '$' && command[i + 1] === '(') continue;
        else { word += c; started = true; }
    }
    endCommand(); return commands;
}
const WRAPPERS = new Set(['sudo', 'command', 'exec', 'time', 'nohup', 'env']);
const SHELLS = new Set(['bash', 'sh', 'zsh']);
/** Programs a command actually runs, as `[basename, ...arguments]`, after assignments and wrappers and inside `bash -c`. */
export function invocations(command: string, depth = 0): string[][] {
    const found: string[][] = [];
    for (const words of shellCommands(command)) {
        let i = 0;
        while (i < words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]) || WRAPPERS.has(words[i]) || (i > 0 && words[i].startsWith('-') && WRAPPERS.has(words[i - 1])))) i++;
        if (i >= words.length) continue;
        const program = words[i].split('/').pop() ?? '';
        if (SHELLS.has(program)) {
            const flag = words.findIndex((word, j) => j > i && /^-[a-z]+$/.test(word) && word.includes('c'));
            if (depth < 3 && flag > 0 && words[flag + 1] !== undefined) found.push(...invocations(words[flag + 1], depth + 1));
            continue;
        }
        found.push([program, ...words.slice(i + 1)]);
    }
    return found;
}
/** Positional words of an argument list, skipping flags and the values of the named flags. */
export function positionals(args: string[], valued: string[] = []): string[] {
    const out: string[] = [];
    for (let j = 0; j < args.length; j++) {
        if (valued.includes(args[j])) { j++; continue; }
        if (!args[j].startsWith('-')) out.push(args[j]);
    }
    return out;
}
/** The body of the first here-document introduced by `<<DELIMITER` in a raw command. */
export function heredocBody(command: string, delimiter: string): string | undefined {
    const lines = command.split('\n');
    for (let i = 0; i < lines.length; i++) {
        const opener = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/.exec(lines[i]);
        if (!opener || opener[2] !== delimiter) continue;
        const body: string[] = [];
        for (let j = i + 1; j < lines.length && lines[j].trim() !== delimiter; j++) body.push(lines[j]);
        return body.join('\n');
    }
    return undefined;
}
