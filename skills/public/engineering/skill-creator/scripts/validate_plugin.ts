import { isMain } from '../../../../../runtime/entry.js';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
function file(path: string): boolean { try {
    return statSync(path).isFile();
}
catch {
    return false;
} }
function dir(path: string): boolean { try {
    return statSync(path).isDirectory();
}
catch {
    return false;
} }
function read(path: string): string { return readFileSync(path, 'utf8').replace(/\r\n/g, '\n'); }
export function frontmatter(text: string): [
    Record<string, any> | undefined,
    string | undefined
] { if (!text.startsWith('---\n'))
    return [undefined, 'frontmatter is missing; the first line must be `---`']; const rest = text.slice(4), end = rest.indexOf('\n---'); if (end < 0)
    return [undefined, 'frontmatter is not closed']; let fields: unknown; try {
    fields = parse(rest.slice(0, end), { version: '1.1', uniqueKeys: false });
}
catch (error) {
    return [undefined, 'frontmatter is not valid YAML: ' + String(error).split('\n')[0]];
} if (fields == null)
    return [undefined, 'frontmatter is empty']; if (!object(fields))
    return [undefined, 'frontmatter is not a mapping']; return [fields, undefined]; }
function needText(fields: Record<string, any>, key: string): string | undefined { const value = fields[key]; if (value == null)
    return `${key} is missing`; if (typeof value !== 'string')
    return `${key} is not a string (${Array.isArray(value) ? 'list' : typeof value === 'boolean' ? 'bool' : typeof value === 'number' ? (Number.isInteger(value) ? 'int' : 'float') : 'dict'})`; if (!value.trim())
    return `${key} is empty`; }
function manifest(path: string, name: string): string | undefined { let data: any;
    try { data = JSON.parse(read(path)); } catch (error) { return 'not valid JSON: ' + String(error); } if (!object(data))
    return 'top level is not an object'; for (const key of ['name', 'description', 'version']) {
    const why = needText(data, key);
    if (why)
        return why;
} if (!/^\p{Ll}[\p{Ll}\p{N}-]*$/u.test(data.name))
    return `name is not kebab-case: '${data.name}'`; if (data.name !== name)
    return `name('${data.name}') differs from directory name ('${name}')`; const core = data.version.split('-', 1)[0]; if (!core || /[^0-9.]/.test(core) || core.split('.').length !== 3)
    return `version is not x.y.z: '${data.version}'`; }
function checkFront(path: string, kind: string, expected: string): string | undefined { const [fields, why] = frontmatter(read(path)); if (why)
    return why; const named = needText(fields!, 'name'); if (named)
    return named; if (fields!.name !== expected)
    return `name('${fields!.name}') differs from ${kind === 'agent' ? 'filename' : 'directory name'} ('${expected}')`; return needText(fields!, 'description'); }
const BLANK = /^[ \t\r\n]*$/, FENCE = /^[ \t]*---[ \t]*$/;
function distance(a: string, b: string): number { let row = Array.from({ length: b.length + 1 }, (_, i) => i); for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++)
        next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
} return row[b.length]; }
// A command without a description key costs nothing in the model-facing listing and the `/` menu shows its first body line, so it passes with a notice; a present but empty value, an empty file or a misplaced fence is a mistake.
function checkCommand(path: string, notes: { undescribed: boolean; typos: string[] }): string | undefined { const text = read(path); if (BLANK.test(text))
    return 'command file is empty'; if (!text.startsWith('---\n')) {
    if (FENCE.test(text.split('\n').find(line => !BLANK.test(line)) ?? ''))
        return 'frontmatter fence is malformed; the first line must be exactly `---`';
    notes.undescribed = true;
    return undefined;
} const [fields, why] = frontmatter(text); if (why)
    return why; const present = 'description' in fields!, problem = !present ? undefined : fields!.description == null ? 'description is empty' : needText(fields!, 'description'); if (problem)
    return problem; notes.undescribed = !present; notes.typos = Object.keys(fields!).filter(key => key !== 'description' && distance(key, 'description') <= 2); }
function hooksShape(data: any): string | undefined { if (!object(data) || !object(data.hooks))
    return 'top level has no `hooks` object'; if (!Object.keys(data.hooks).length)
    return '`hooks` is empty; it matches no event'; for (const [event, entries] of Object.entries(data.hooks)) {
    if (!Array.isArray(entries) || !entries.length)
        return `${event} is not a nonempty array`;
    for (const entry of entries) {
        if (!object(entry) || !Array.isArray(entry.hooks))
            return `${event} entry has no \`hooks\` array`;
        for (const hook of entry.hooks) {
            if (!object(hook))
                return `${event} hook is not an object`;
            if (hook.type !== 'command')
                return `${event} hook has no type="command"`;
            if (!String(hook.command || '').trim())
                return `${event} hook has no command`;
        }
    }
} }
export function hookScripts(data: unknown): string[] { const out: string[] = []; function walk(node: unknown): void { if (Array.isArray(node)) {
    node.forEach(walk);
    return;
} if (!object(node))
    return; if (typeof node.command === 'string') {
    for (const marker of ['${CLAUDE_PLUGIN_ROOT}/', '$CLAUDE_PLUGIN_ROOT/']) {
        const index = node.command.indexOf(marker);
        if (index < 0)
            continue;
        out.push(node.command.slice(index + marker.length).trimStart().split(/\s/)[0].replace(/^["']+|["']+$/g, ''));
        break;
    }
} Object.values(node).forEach(walk); } walk(data); return out; }
export interface Validation {
    code: number;
    output: string;
    checks: number;
    failures: number;
}
export function validatePlugin(input: string, marketplace?: string): Validation {
    const root = resolve(input), name = basename(root), lines: string[] = [];
    let checks = 0, failures = 0, skills = 0, commands = 0, agents = 0, hooks = 0;
    const outcome = (code: number): Validation => ({ code, output: lines.join('\n') + '\n', checks, failures });
    const verdict = (label: string, check: () => string | undefined) => { let why: string | undefined; try {
        why = check();
    }
    catch (error) {
        why = String(error);
    } checks++; if (why) {
        failures++;
        lines.push(`[FAIL] ${label} — ${why}`);
    }
    else
        lines.push('[PASS] ' + label); };
    if (!dir(root)) {
        lines.push('not a directory: ' + input);
        return outcome(2);
    }
    lines.push('================================', 'Plugin format validation: ' + input, '================================');
    if (!file(join(root, '.claude-plugin/plugin.json'))) {
        lines.push('[SKIP] Not a plugin: .claude-plugin/plugin.json is missing; measured zero checks');
        return outcome(3);
    }
    verdict('plugin.json schema', () => manifest(join(root, '.claude-plugin/plugin.json'), name));
    if (!dir(join(root, 'skills')))
        lines.push('[INFO] no skills/ directory');
    else {
        for (const child of readdirSync(join(root, 'skills')).sort()) {
            const path = join(root, 'skills', child);
            if (/^[._]/.test(child) || !dir(path))
                continue;
            skills++;
            if (!file(join(path, 'SKILL.md')))
                verdict(`skills/${child}: SKILL.md is missing`, () => 'SKILL.md is missing');
            else
                verdict(`skills/${child}: SKILL.md frontmatter`, () => checkFront(join(path, 'SKILL.md'), 'skill', child));
        }
        if (!skills)
            verdict('skills/ exists but contains no skills', () => 'contains no skills');
    }
    for (const kind of ['commands', 'agents'] as const) {
        if (!dir(join(root, kind))) {
            lines.push(`[INFO] no ${kind}/ directory`);
            continue;
        }
        let count = 0;
        const undescribed: string[] = [];
        for (const child of readdirSync(join(root, kind)).sort()) {
            if (child.startsWith('.') || !child.endsWith('.md') || !file(join(root, kind, child)))
                continue;
            count++;
            const stem = child.slice(0, -3);
            if (kind === 'agents') {
                verdict(`agents/${stem}: frontmatter`, () => checkFront(join(root, kind, child), 'agent', stem));
                continue;
            }
            const notes = { undescribed: false, typos: [] as string[] };
            verdict(`commands/${child}: frontmatter`, () => checkCommand(join(root, kind, child), notes));
            if (notes.undescribed)
                undescribed.push(`commands/${child}`);
            for (const key of notes.typos)
                lines.push(`[WARN] commands/${child} — frontmatter key '${key}' is within edit distance 2 of 'description'`);
        }
        if (!count)
            verdict(`${kind}/ exists but contains no ${kind}`, () => `contains no ${kind}`);
        if (undescribed.length)
            lines.push(`[INFO] commands without a description are not listed to the model, and the / menu shows their first body line: ${undescribed.join(', ')}`);
        if (kind === 'commands')
            commands = count;
        else
            agents = count;
    }
    if (!dir(join(root, 'hooks')))
        lines.push('[INFO] no hooks/ directory');
    else if (!file(join(root, 'hooks/hooks.json')))
        verdict('hooks/ exists but hooks/hooks.json is missing; no hook can fire', () => 'hooks.json is missing');
    else {
        verdict('hooks/hooks.json structure', () => hooksShape(JSON.parse(read(join(root, 'hooks/hooks.json')))));
        let scripts: string[];
        try {
            scripts = hookScripts(JSON.parse(read(join(root, 'hooks/hooks.json'))));
        }
        catch (error) {
            lines.push('[STOP] Unexecutable: hook command parsing — ' + String(error));
            return outcome(2);
        }
        for (const relative of scripts) {
            if (!relative)
                continue;
            hooks++;
            verdict(file(join(root, relative)) ? 'hook script exists: ' + relative : `hook script is missing: ${relative} ; this hook cannot fire`, () => file(join(root, relative)) ? undefined : 'script is missing');
        }
        if (!hooks)
            verdict('hooks.json points to no plugin-relative script', () => 'no plugin-relative script');
    }
    if (marketplace) {
        if (!file(marketplace))
            verdict('marketplace.json is missing: ' + marketplace, () => 'file is missing');
        else
            verdict('marketplace.json registration', () => { const data = JSON.parse(read(marketplace)); if (!Array.isArray(data.plugins))
                return 'marketplace.json has no plugins array'; if (!data.plugins.some((e: any) => object(e) && e.name === name))
                return `marketplace.json does not list '${name}'`; });
    }
    lines.push('================================');
    const census = `skills ${skills}, commands ${commands}, agents ${agents}, hook scripts ${hooks}`;
    lines.push(failures ? `[FAIL] ${checks} checks, ${failures} failed (${census})` : `[OK] Passed: ${checks} checks (${census})`);
    return outcome(failures ? 1 : 0);
}
export function main(args = process.argv.slice(2)): number { let plugin: string | undefined, marketplace: string | undefined; for (let i = 0; i < args.length; i++) {
    const value = args[i];
    if (value === '--help' || value === '-h') {
        console.log('validate_plugin.js [--marketplace <marketplace.json>] <plugin-directory>');
        return 0;
    }
    if (value === '--marketplace') {
        if (!args[i + 1]) {
            console.error('--marketplace requires a value');
            return 2;
        }
        marketplace = resolve(args[++i]);
    }
    else if (value.startsWith('-')) {
        console.error('unknown flag: ' + value);
        return 2;
    }
    else if (plugin) {
        console.error(`more than one plugin directory argument: ${plugin}, ${value}`);
        return 2;
    }
    else
        plugin = value;
} if (!plugin) {
    console.error('usage: validate_plugin.js [--marketplace <file>] <plugin-dir>');
    return 2;
} const result = validatePlugin(plugin, marketplace); process.stdout.write(result.output); return result.code; }
if (isMain(import.meta.url))
    process.exitCode = main();
