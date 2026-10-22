import { isMain } from '../../../runtime/entry.js';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ModelInfo } from '../../../scripts/models_database.js';
const database = await import('../../../scripts/models_database.js').catch(()=>undefined);
const databaseWarning='[WARN] scripts/models_database.js is unavailable; no decision was made';
function normalizeModelName(value:string):string{if(!database)throw new Error(databaseWarning);return database.normalizeModelName(value);}
function checkModelStatus(value:string){if(!database)throw new Error(databaseWarning);return database.checkModelStatus(value);}
import type { HookInput } from './hook-common.js';
// Bash writes share block_emoji's classifier so the two hooks agree on what writes a file. Without it,
// every command counts as a possible write, as the classifier does when a command is ambiguous.
const emoji = await import('./block_emoji.js').catch(() => undefined);
const extensions = new Set('.py .js .ts .jsx .tsx .md .yaml .yml .json .toml .sh .bash .zsh .fish .go .rs .java .kt .c .cpp .h .hpp .rb .php .swift .ipynb .txt .rst'.split(' '));
// Documents and files outside the project mention models without calling them, so a finding
// there is advisory: warn instead of blocking the write.
const documentExtensions = new Set(['.md', '.txt', '.rst']);
export function advisoryTarget(file: string, root = process.env.CLAUDE_PROJECT_DIR || process.cwd()): boolean {
    if (documentExtensions.has(extname(file).toLowerCase()))
        return true;
    const rel = relative(resolve(root), resolve(root, file));
    return rel === '..' || rel.startsWith('..' + '/') || rel.startsWith('..' + '\\') || isAbsolute(rel);
}
// Whitespace is spelled out so the TypeScript and Python twins agree on every character.
// The d flag records where each name starts and ends, so a name inside a path can be told apart.
const patterns = [/model[ \t\n\r\f\v]*[=:][ \t\n\r\f\v]*["']([^"']+)["']/dgi, /--model[= \t\n\r\f\v]+["']?([^ \t\n\r\f\v"']+)/dgi, /model_name[ \t\n\r\f\v]*[=:][ \t\n\r\f\v]*["']([^"']+)["']/dgi, /llm_model[ \t\n\r\f\v]*[=:][ \t\n\r\f\v]*["']([^"']+)["']/dgi, /(gpt-[0-9a-z.-]+)/dgi, /(claude-[a-z0-9.-]+)/dgi, /(gemini-[a-z0-9.-]+)/dgi, /(qwen[0-9.]*(?:-[a-z]+)?)/dgi, /(kimi-k[0-9.]+)/dgi, /(deepseek-v[0-9.]+)/dgi, /(glm-[0-9.]+)/dgi, /(solar-[a-z0-9-]+)/dgi, /(kanana-[0-9]+)/dgi, /(exaone-[a-z0-9.-]+)/dgi, /(k-exaone-[a-z0-9-]+)/dgi];
// A Bash command selects a model when a command that runs something carries its name: a flag, a setting,
// an API body, interpreter code or a positional argument. Data commands only search, print, record, query
// or manage paths, so their arguments are text, unless their output flows into a command that runs.
const dataCommands = new Set('grep egrep fgrep zgrep rg ag ack ugrep find fd locate echo printf cat bat head tail less more wc sort uniq cut tr column nl fold diff cmp comm xxd od strings tee jq yq awk gawk sed gsed git gh sqlite3 duckdb psql mysql ls cd pwd mkdir rmdir rm cp mv ln touch stat file du chmod realpath readlink basename dirname tar zip unzip rsync scp test [ [[ true false : pytest'.split(' '));
// Wrappers run the command after them; each lists its options that take a separate value.
const wrappers: Record<string, string[]> = {
    sudo: ['-u', '-g', '-C', '-D', '-h', '-p', '-R', '-r', '-t', '-T', '-U', '--user', '--group', '--close-from', '--chdir', '--host', '--prompt', '--chroot', '--role', '--type', '--other-user', '--command-timeout'],
    doas: ['-u', '-C'], env: ['-u', '-C', '-S', '--unset', '--chdir', '--split-string'], nice: ['-n', '--adjustment'], timeout: ['-s', '-k', '--signal', '--kill-after'],
    xargs: ['-I', '-n', '-P', '-d', '-L', '-s', '-E', '-a', '--max-args', '--max-procs', '--delimiter', '--max-lines', '--eof', '--arg-file', '--max-chars', '--process-slot-var'],
    stdbuf: ['-i', '-o', '-e', '--input', '--output', '--error'], nohup: [], command: [], builtin: [], exec: ['-a'], 'python -m': [],
    'uv run': ['--with', '-w', '--python', '-p', '--project', '--directory', '--package', '--extra', '--group', '--env-file'],
    uvx: ['--from', '--with', '-w', '--python', '-p', '--with-requirements', '--index', '--index-url'], 'poetry run': [], 'pipenv run': [], 'pdm run': [], 'hatch run': [],
    time: ['-f', '-o'], ionice: ['-c', '-n', '-p', '-P', '-u'], setsid: [],
};
// Deeper nesting than this is judged as one text, as the hook did before it parsed commands.
const maxDepth = 50;
// Compound commands open and close with these words; keywords only separate their parts.
const openers = new Set(['{', '(', 'if', 'for', 'while', 'until', 'select', 'case']), closers = new Set(['}', ')', 'fi', 'done', 'esac']), keywords = new Set(['!', 'then', 'else', 'elif', 'do', 'time']);
// Builtins that store their arguments or input in a variable instead of running them.
const assigners = new Set(['read', 'mapfile', 'readarray', 'export', 'declare', 'local', 'typeset', 'readonly']);
// Builtins that steer a loop or pause; they are judged but do not make a loop body run something.
const neutralCommands = new Set(['break', 'continue', 'return', 'exit', 'sleep', 'wait', 'shift', 'set', 'unset']);
const assignment = /^[A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]*\])?\+?=/, fdPrefix = /[0-9]+(?=[<>])/y, redirectOperator = /&>>|>>|>\||>&|<>|<&|&>|>|</y;
/** A word keeps its quoting; `bare` replaces command substitutions, which are parsed into `subs`. */
interface ShellWord { raw: string; bare: string; subs: ShellCommand[][] }
/** A simple command; `pipe` sends its output to the next command, heredoc bodies attach to the command that reads them, and `redirects` holds redirection targets. */
interface ShellCommand { words: ShellWord[]; redirects: ShellWord[]; bodies: string[]; pipe: boolean }
/** Splits a command line into simple commands: quotes, `$(...)`, backticks, subshells, heredocs, comments and redirections. Not a full shell grammar. */
class ShellParser {
    private i = 0;
    private depth = 0;
    private pending: { word: string; tabs: boolean; command: ShellCommand }[] = [];
    tooDeep = false;
    constructor(private readonly src: string) { }
    script(closer = ''): ShellCommand[] {
        if (this.depth >= maxDepth) {
            this.tooDeep = true;
            this.i = this.src.length;
            return [];
        }
        this.depth++;
        const src = this.src, script: ShellCommand[] = [];
        let command: ShellCommand = { words: [], redirects: [], bodies: [], pipe: false };
        const finish = (pipe: boolean) => {
            if (command.words.length || command.redirects.length || command.bodies.length) {
                command.pipe = pipe;
                script.push(command);
            }
            else if (pipe && script.length)
                script[script.length - 1].pipe = true;
            command = { words: [], redirects: [], bodies: [], pipe: false };
        };
        while (this.i < src.length) {
            const c = src[this.i], next = src[this.i + 1] ?? '';
            fdPrefix.lastIndex = this.i;
            if (closer && c === closer) {
                this.i++;
                break;
            }
            if (c === '\n') {
                this.i++;
                finish(false);
                this.bodies();
            }
            else if (c === ' ' || c === '\t')
                this.i++;
            else if (c === '\\' && next === '\n')
                this.i += 2;
            else if (c === '#')
                while (this.i < src.length && src[this.i] !== '\n')
                    this.i++;
            else if (c === '|') {
                this.i += next === '|' || next === '&' ? 2 : 1;
                finish(next !== '|');
            }
            else if (c === '&' && next !== '>') {
                this.i += next === '&' ? 2 : 1;
                finish(false);
            }
            else if (c === ';' || c === ')') {
                this.i++;
                finish(false);
            }
            else if (c === '(' && next === '(' && !command.words.length) {
                const start = this.i;
                this.skip('(', ')');
                command.words.push({ raw: src.slice(start, this.i), bare: src.slice(start, this.i), subs: [] });
            }
            else if (c === '(') {
                // A subshell keeps its parentheses as marker commands, so a pipe after it reaches every command inside.
                this.i++;
                if (!command.words.length) {
                    script.push({ words: [{ raw: '(', bare: '(', subs: [] }], redirects: [], bodies: [], pipe: false });
                    for (const inner of this.script(')'))
                        script.push(inner);
                    command.words.push({ raw: ')', bare: ')', subs: [] });
                }
            }
            else if (fdPrefix.test(src))
                this.i = fdPrefix.lastIndex;
            else if ((c === '<' || c === '>' || c === '&') && next !== '(')
                this.redirect(command, closer);
            else {
                const start = this.i, word = this.word(closer);
                if (this.i === start)
                    this.i++;
                else
                    command.words.push(word);
            }
        }
        finish(false);
        this.depth--;
        return script;
    }
    /** A heredoc body waits for the next newline; a here-string is input like a body; a redirection target is kept apart from the words. */
    private redirect(command: ShellCommand, closer: string): void {
        const src = this.src;
        if (src.startsWith('<<<', this.i)) {
            this.i += 3;
            this.blanks();
            const word = this.word(closer);
            command.bodies.push(word.raw);
            command.redirects.push(word);
        }
        else if (src.startsWith('<<', this.i)) {
            this.i += 2;
            const tabs = src[this.i] === '-';
            if (tabs)
                this.i++;
            this.blanks();
            this.pending.push({ word: this.word(closer).raw.replace(/["'\\]/g, ''), tabs, command });
        }
        else {
            redirectOperator.lastIndex = this.i;
            redirectOperator.test(src);
            this.i = redirectOperator.lastIndex;
            this.blanks();
            command.redirects.push(this.word(closer));
        }
    }
    private bodies(): void {
        for (const heredoc of this.pending.splice(0)) {
            const lines: string[] = [];
            while (this.i < this.src.length) {
                const newline = this.src.indexOf('\n', this.i), end = newline < 0 ? this.src.length : newline, line = this.src.slice(this.i, end);
                this.i = end + 1;
                if ((heredoc.tabs ? line.replace(/^\t+/, '') : line) === heredoc.word)
                    break;
                lines.push(line);
            }
            heredoc.command.bodies.push(lines.join('\n'));
        }
    }
    private blanks(): void {
        while (this.src[this.i] === ' ' || this.src[this.i] === '\t' || this.src.startsWith('\\\n', this.i))
            this.i += this.src[this.i] === '\\' ? 2 : 1;
    }
    /** Moves past a balanced `open`...`close` group that starts at the cursor. */
    private skip(open: string, close: string): void {
        let depth = 0;
        while (this.i < this.src.length) {
            const c = this.src[this.i++];
            if (c === open)
                depth++;
            else if (c === close && --depth === 0)
                return;
        }
    }
    /** The inside of a `${...}` expansion after its opening brace; command substitutions in it are parsed into `subs`. */
    private braces(subs: ShellCommand[][]): string {
        const src = this.src;
        let bare = '', depth = 1;
        while (this.i < src.length) {
            const c = src[this.i], next = src[this.i + 1] ?? '';
            if (c === '\\') {
                bare += c + next;
                this.i += 2;
            }
            else if (c === '$' && next === '(' && src[this.i + 2] !== '(') {
                this.i += 2;
                subs.push(this.script(')'));
                bare += '$()';
            }
            else if (c === '`') {
                this.i++;
                subs.push(this.script('`'));
                bare += '``';
            }
            else {
                this.i++;
                if (c === '{')
                    depth++;
                else if (c === '}' && --depth === 0)
                    break;
                bare += c;
            }
        }
        return bare;
    }
    private word(closer: string): ShellWord {
        const src = this.src, start = this.i, subs: ShellCommand[][] = [];
        let bare = '', quote = '';
        while (this.i < src.length) {
            const c = src[this.i], next = src[this.i + 1] ?? '';
            if (quote === "'" || quote === "$'") {
                const escaped = quote === "$'" && c === '\\';
                bare += escaped ? c + next : c;
                this.i += escaped ? 2 : 1;
                if (c === "'" && !escaped)
                    quote = '';
                continue;
            }
            if (c === '\\') {
                bare += next === '\n' ? '' : c + next;
                this.i += 2;
                continue;
            }
            if (c === '`' && closer === '`')
                break;
            if (!quote) {
                if (c === "'" || c === '"') {
                    quote = c;
                    bare += c;
                    this.i++;
                    continue;
                }
                if (c === '$' && next === "'") {
                    quote = "$'";
                    bare += c + next;
                    this.i += 2;
                    continue;
                }
                if ((c === '<' || c === '>') && next === '(' && this.i === start) {
                    this.i += 2;
                    subs.push(this.script(')'));
                    bare += c + '()';
                    continue;
                }
                if (' \t\n;&|()<>'.includes(c))
                    break;
            }
            else if (c === '"') {
                quote = '';
                bare += c;
                this.i++;
                continue;
            }
            if (c === '$' && next === '{') {
                this.i += 2;
                bare += '${' + this.braces(subs) + '}';
                continue;
            }
            if (c === '$' && (next === '(' || next === '[')) {
                const begin = this.i++;
                if (next === '[' || src[this.i + 1] === '(') {
                    this.skip(next, next === '(' ? ')' : ']');
                    bare += src.slice(begin, this.i);
                    continue;
                }
                this.i++;
                subs.push(this.script(')'));
                bare += '$()';
                continue;
            }
            if (c === '`') {
                this.i++;
                subs.push(this.script('`'));
                bare += '``';
                continue;
            }
            bare += c;
            this.i++;
        }
        return { raw: src.slice(start, this.i).replaceAll('\\\n', ''), bare, subs };
    }
}
/** The prefix a command runs under (assignments, reserved words, wrappers and the command word), its name and its arguments. */
function commandParts(words: ShellWord[]): { prefix: ShellWord[]; name: string; args: ShellWord[] } {
    const name = (word?: ShellWord) => {
        if (!word)
            return '';
        const text = /["'\\]/.test(word.raw) ? word.raw.replace(/["'\\]/g, '') : word.raw;
        return text.slice(text.lastIndexOf('/') + 1);
    };
    let k = 0;
    while (k < words.length) {
        const first = name(words[k]), pair = `${/^python[0-9.]*$/.test(first) ? 'python' : first} ${name(words[k + 1])}`;
        const raw = words[k].raw;
        if (openers.has(raw) && raw !== 'for' && raw !== 'select' && raw !== 'case' || closers.has(raw) || keywords.has(raw) && raw !== 'time' || assignment.test(raw)) {
            k++;
            continue;
        }
        const wrapper = Object.hasOwn(wrappers, pair) ? pair : Object.hasOwn(wrappers, first) ? first : '';
        if (!wrapper)
            break;
        k += wrapper.split(' ').length;
        while (k < words.length && (assignment.test(words[k].raw) || words[k].raw.length > 1 && words[k].raw[0] === '-') && words[k].raw !== '--')
            k += wrappers[wrapper].includes(words[k].raw) ? 2 : 1;
        if (words[k]?.raw === '--' || /^[0-9]+(?:\.[0-9]+)?[smhd]?$/.test(words[k]?.raw ?? ''))
            k++;
    }
    return { prefix: words.slice(0, k + 1), name: name(words[k]), args: words.slice(k + 1) };
}
/** An in-place edit writes the file it names, which only its options reveal. */
function editsInPlace(parts: { name: string; args: ShellWord[] }): boolean {
    const raws = parts.args.map(word => word.raw);
    if (parts.name === 'sed' || parts.name === 'gsed' || parts.name === 'perl')
        return raws.some(raw => /^-[a-zA-Z]*i/.test(raw) || /^--in-place(?:=|$)/.test(raw));
    if (parts.name === 'yq')
        return raws.some(raw => /^-[a-zA-Z]*i[a-zA-Z]*$/.test(raw) || /^--inplace(?:=|$)/.test(raw));
    if (parts.name === 'awk' || parts.name === 'gawk')
        return raws.some((raw, j) => raw === '-iinplace' || raw === '--include=inplace' || (raw === '-i' || raw === '--include') && raws[j + 1]?.replace(/["']/g, '') === 'inplace');
    return false;
}
/** What a Bash command can select (`texts`) and whether it edits a file in place (`writes`). */
interface Judgment { texts: string[]; writes: boolean; tooDeep: boolean; nested: number }
/** Where output goes: nowhere that runs (0), into a variable or loop list (1), or into a command that runs (2). */
type Flow = 0 | 1 | 2;
/** Text with its shell quotes removed, enough to read an option value or a command string. */
function shellText(raw: string): string {
    return raw.replace(/'([^']*)'|"((?:[^"\\]|\\[\s\S])*)"/g, (_, single: string | undefined, double: string) => single ?? double.replace(/\\([\s\S])/g, '$1'));
}
/** aws s3 copies files; gh records and queries are data; gh models, workflow run, variable or secret set and a non-GET api call with fields or --input run or dispatch something. */
function dataCommand(parts: { name: string; args: ShellWord[] }): boolean {
    if (parts.name === 'aws')
        return shellText(parts.args[0]?.raw ?? '') === 's3';
    if (parts.name !== 'gh')
        return dataCommands.has(parts.name);
    const sub = parts.args.map(word => shellText(word.raw));
    const fields = sub.some(arg => /^(?:-[fF]|--field|--raw-field|--input)(?:=|$)/.test(arg) || /^-[fF][\s\S]/.test(arg));
    const get = sub.some((arg, j) => /^(?:-X|--method)$/.test(arg) && /^get$/i.test(sub[j + 1] ?? '') || /^(?:-XGET|--method=GET)$/i.test(arg));
    return !(sub[0] === 'models' || sub[0] === 'workflow' && sub[1] === 'run' || (sub[0] === 'variable' || sub[0] === 'secret') && sub[1] === 'set' || sub[0] === 'api' && fields && !get);
}
/** A command string another command runs, such as a git alias or a rebase --exec value. */
function nestedScript(text: string, out: Judgment): void {
    // `nested` counts command strings inside command strings, so siblings do not add up.
    if (out.nested >= maxDepth) {
        out.tooDeep = true;
        return;
    }
    out.nested++;
    const parser = new ShellParser(text);
    selectionText(parser.script(), 0, out);
    out.tooDeep = out.tooDeep || parser.tooDeep;
    out.nested--;
}
/** Words another command runs: one quoted word is a command string, several are a command line. */
function nestedWords(words: ShellWord[], out: Judgment): void {
    if (words.length === 1)
        nestedScript(shellText(words[0].raw), out);
    else if (words.length)
        selectionText([{ words, redirects: [], bodies: [], pipe: false }], 0, out);
}
/** Commands git runs for you: bisect run, rebase --exec, submodule foreach, and -c alias, pager or editor values. */
function gitCommands(args: ShellWord[], out: Judgment): void {
    let j = 0;
    for (; j < args.length; j++) {
        const raw = args[j].raw;
        if (raw === '-c' && j + 1 < args.length) {
            const text = shellText(args[++j].raw), eq = text.indexOf('='), key = text.slice(0, eq), value = text.slice(eq + 1);
            if (eq > 0 && (/^alias\./i.test(key) && value.startsWith('!') || /(?:pager|editor|\.cmd|sshcommand)$/i.test(key)))
                nestedScript(value.replace(/^!/, ''), out);
        }
        else if (raw === '-C' || /^--(?:git-dir|work-tree|namespace|exec-path|super-prefix|config-env)$/.test(raw))
            j++;
        else if (raw[0] !== '-')
            break;
    }
    const sub = shellText(args[j]?.raw ?? ''), rest = args.slice(j + 1);
    if (sub === 'bisect' && rest[0]?.raw === 'run')
        nestedWords(rest.slice(1), out);
    if (sub === 'rebase')
        rest.forEach((word, n) => {
            if ((word.raw === '-x' || word.raw === '--exec') && rest[n + 1])
                nestedScript(shellText(rest[n + 1].raw), out);
            else if (word.raw.startsWith('--exec='))
                nestedScript(shellText(word.raw.slice('--exec='.length)), out);
        });
    const foreach = sub === 'submodule' ? rest.findIndex(word => word.raw === 'foreach') : -1;
    if (foreach >= 0) {
        let command = rest.slice(foreach + 1);
        while (command.length && command[0].raw[0] === '-')
            command = command.slice(1);
        nestedWords(command, out);
    }
}
// pytest options whose value is a test filter or a path, flags that take no value, and short options that take one.
const pytestDataOptions = new Set(['-k', '-m', '-c', '--deselect', '--ignore', '--ignore-glob', '--junitxml', '--junit-xml', '--rootdir', '--confcutdir', '--basetemp', '--log-file', '--html', '--cov-config']);
const pytestFlags = new Set(['--', '--lf', '--last-failed', '--ff', '--failed-first', '--nf', '--new-first', '--sw', '--stepwise', '--pdb', '--co', '--collect-only', '--exitfirst', '--verbose', '--quiet', '--no-header', '--showlocals', '--strict-markers', '--cache-clear', '--runxfail', '--disable-warnings']);
const pytestValueShort = new Set(['-p', '-o', '-n', '-W', '-r']);
/**
 * The pytest words that can select a model. Test paths, node ids, the -k and -m filters and path options are data.
 * Every other option is judged with its value: a short option's value when the option takes one, a long option's
 * value unless it names a test file, node id or directory.
 */
function pytestOptions(args: ShellWord[]): string[] {
    return args.filter((word, j) => {
        const raw = word.raw, previous = args[j - 1]?.raw ?? '';
        if (raw.length > 1 && raw[0] === '-') {
            const name = raw.split('=')[0];
            return !pytestDataOptions.has(name) && !pytestFlags.has(name) && !/^-[km]/.test(raw);
        }
        if (previous.length < 2 || previous[0] !== '-' || previous.includes('=') || pytestDataOptions.has(previous) || pytestFlags.has(previous))
            return false;
        if (previous.startsWith('--'))
            return !/::|\.py(?![A-Za-z0-9_])|\/$/.test(shellText(raw));
        return pytestValueShort.has(previous);
    }).map(word => word.raw);
}
/** echo, printf, cat of a heredoc or here-string, and jq or yq with null input print text from their own command line. */
function emits(parts: { name: string; args: ShellWord[] }, command: ShellCommand): boolean {
    if (parts.name === 'echo' || parts.name === 'printf')
        return true;
    if (parts.name === 'cat')
        return command.bodies.length > 0;
    return (parts.name === 'jq' || parts.name === 'yq') && parts.args.some(word => /^-[a-zA-Z]*n[a-zA-Z]*$/.test(word.raw) || word.raw === '--null-input');
}
function judgeRedirects(command: ShellCommand, flow: Flow, out: Judgment): void {
    for (const word of command.redirects)
        for (const sub of word.subs)
            selectionText(sub, flow, out);
}
/**
 * Collects the text of a parsed script that can select a model.
 * - A command that runs something contributes every word and its input (heredoc bodies, here-strings).
 * - A data command contributes only its prefix, unless its output flows into a command that runs (`feeds` for
 *   a substitution, the next stage for a pipe, the closer's flow for a compound command). An emitter's output
 *   assigned to a variable or loop list counts too.
 * - An assignment contributes its words with substitutions removed. A loop list and the input of a compound
 *   command count only when its values go somewhere: the body runs something, its output reaches a command
 *   that runs, or its output is assigned and the body prints. Substitutions in them count for emitters only.
 * - Every command or process substitution and a command run by `find -exec` or `fd -x` are judged on their own.
 */
function selectionText(script: ShellCommand[], feeds: Flow, out: Judgment): void {
    const parts = script.map(command => commandParts(command.words));
    // A compound command spans its opener to its matching closer.
    const groups: { start: number; end: number; runs: boolean; emits: boolean; output: Flow }[] = [], open: number[] = [], none: number[] = [];
    // Most commands open or close no group, so they share one empty list instead of allocating their own.
    const closed: number[][] = new Array(script.length).fill(none), opened: number[][] = new Array(script.length).fill(none);
    script.forEach((command, k) => {
        for (const word of command.words) {
            if (closers.has(word.raw)) {
                const start = open.pop();
                if (start !== undefined) {
                    if (closed[k] === none)
                        closed[k] = [];
                    if (opened[start] === none)
                        opened[start] = [];
                    closed[k].push(groups.length);
                    opened[start].push(groups.length);
                    groups.push({ start, end: k, runs: false, emits: false, output: 0 });
                }
            }
            else if (openers.has(word.raw))
                open.push(k);
            else if (!keywords.has(word.raw))
                break;
        }
    });
    const kinds = script.map((_, k) => {
        const name = parts[k].name;
        if (closed[k].length && !name)
            return 'closer';
        if (!name || assigners.has(name) || name === 'printf' && parts[k].args[0]?.raw === '-v')
            return 'assign';
        if (name === 'for' || name === 'select')
            return 'loop';
        return dataCommand(parts[k]) ? 'data' : neutralCommands.has(name) ? 'neutral' : 'runs';
    });
    const passes = (g: number) => groups[g].runs || groups[g].output === 2 || groups[g].output === 1 && groups[g].emits;
    // The innermost group around each command; a closer is outside its own group. Without groups every command is outside.
    const inside: number[] = [];
    if (groups.length) {
        // Counts of running and printing commands, so a group's span answers both questions at once.
        const running = [0], printing = [0], stack: number[] = [];
        kinds.forEach((kind, k) => {
            running.push(running[k] + (kind === 'runs' ? 1 : 0));
            printing.push(printing[k] + (kind === 'data' && emits(parts[k], script[k]) ? 1 : 0));
        });
        for (const group of groups) {
            group.runs = running[group.end + 1] > running[group.start];
            group.emits = printing[group.end + 1] > printing[group.start];
        }
        script.forEach((_, k) => {
            while (stack.length && groups[stack[stack.length - 1]].end <= k)
                stack.pop();
            for (let j = opened[k].length - 1; j >= 0; j--)
                stack.push(opened[k][j]);
            inside.push(stack.length ? stack[stack.length - 1] : -1);
        });
    }
    let downstream = feeds;
    for (let k = script.length - 1; k >= 0; k--) {
        const command = script[k], part = parts[k], kind = kinds[k];
        const output: Flow = command.pipe ? downstream : !groups.length || inside[k] < 0 ? feeds : groups[inside[k]].output;
        let input: Flow = 0;
        if (editsInPlace(part))
            out.writes = true;
        if (kind === 'closer') {
            // A closer passes the group's output on; the group reads the closer's heredoc, here-string and redirections.
            for (const g of closed[k])
                groups[g].output = output;
            const passing = closed[k].some(passes);
            if (passing)
                out.texts.push(command.bodies.join('\n'));
            judgeRedirects(command, passing ? 1 : 0, out);
        }
        else if (kind === 'assign') {
            out.texts.push([command.words.map(word => word.bare).join(' '), ...command.bodies].join('\n'));
            for (const word of command.words)
                for (const sub of word.subs)
                    selectionText(sub, 1, out);
            judgeRedirects(command, 1, out);
        }
        else if (kind === 'loop') {
            const own = opened[k][0], passing = own === undefined || passes(own);
            if (passing)
                out.texts.push(command.words.map(word => word.bare).join(' '));
            for (const word of command.words)
                for (const sub of word.subs)
                    selectionText(sub, passing ? 1 : 0, out);
            judgeRedirects(command, 0, out);
        }
        else if (kind === 'runs' || kind === 'neutral' || output === 2 || output === 1 && emits(part, command)) {
            // Bash joins the quoted pieces of a word, so the words are also judged with their quotes removed.
            const raw = command.words.map(word => word.raw).join(' '), plain = command.words.map(word => shellText(word.raw)).join(' ');
            out.texts.push([raw, ...command.bodies].join('\n'));
            if (plain !== raw)
                out.texts.push(plain);
            judgeRedirects(command, 2, out);
            input = 2;
        }
        else {
            out.texts.push(part.prefix.map(word => word.raw).join(' '));
            if (part.name === 'pytest')
                out.texts.push(pytestOptions(part.args).join(' '));
            if (part.name === 'git')
                gitCommands(part.args, out);
            const exec = part.name === 'find' ? /^-(?:exec|execdir|ok|okdir)$/ : part.name === 'fd' ? /^(?:-x|-X|--exec|--exec-batch)$/ : undefined;
            part.args.forEach((word, j) => {
                if (exec?.test(word.raw)) {
                    const end = part.args.findIndex((other, n) => n > j && /^(?:\\;|';'|";"|\+)$/.test(other.raw));
                    selectionText([{ words: part.args.slice(j + 1, end < 0 ? undefined : end), redirects: [], bodies: [], pipe: false }], 0, out);
                }
                for (const sub of word.subs)
                    selectionText(sub, 0, out);
            });
            judgeRedirects(command, 0, out);
            input = output === 1 ? 1 : 0;
        }
        // A command piped into a compound command feeds every command in it, and through them the group's output.
        downstream = opened[k].length ? opened[k].reduce<Flow>((flow, g) => groups[g].runs ? 2 : Math.max(flow, groups[g].output) as Flow, 0) : input;
    }
}
export function loadConfig(): {
    check_model_versions: boolean;
    approved_legacy_models: string[];
} { let current = process.cwd(); while (true) {
    const path = join(current, 'pyproject.toml');
    if (existsSync(path)) {
        try {
            const content = readFileSync(path, 'utf8');
            return { check_model_versions: /check_model_versions\s*=\s*(true|false)/i.exec(content)?.[1].toLowerCase() !== 'false', approved_legacy_models: [...(/approved_legacy_models\s*=\s*\[(.*?)\]/s.exec(content)?.[1] ?? '').matchAll(/["']([^"']+)["']/g)].map(m => m[1]) };
        }
        catch {
            break;
        }
    }
    const parent = dirname(current);
    if (parent === current)
        break;
    current = parent;
} return { check_model_versions: true, approved_legacy_models: [] }; }
// Every character either twin's trim removes, so the model database sees the same name from both twins.
const edgeSpace = /^[\t\n\v\f\r \x1c-\x1f\x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+|[\t\n\v\f\r \x1c-\x1f\x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+$/g;
// Characters that start a path segment before the dot of a dot-directory: a slash, a home tilde, an assignment, a quote or whitespace.
const segmentStart = new Set(['/', '~', '=', '"', "'", ' ', '\t', '\n', '\r', '\f', '\v']);
/**
 * A name at `start`..`end` is part of a path, not a model: a dot-directory or dot-file name (`~/.<name>`,
 * `CLAUDE_CONFIG_DIR=.<name>`) or a directory component followed by `/` (`results/<name>/out.json`). The
 * replacement of an `s/old/<name>/` substitution is text written into a file, so it still counts.
 */
function inPath(content: string, start: number, end: number): boolean {
    if (content[start - 1] === '.' && (start < 2 || segmentStart.has(content[start - 2])))
        return true;
    if (content[end] !== '/')
        return false;
    const second = content.lastIndexOf('/', start - 1), first = second > 0 ? content.lastIndexOf('/', second - 1) : -1;
    return !(first > 0 && content[first - 1] === 's' && !/[A-Za-z_]/.test(content[first - 2] ?? '') && !content.slice(first, start).includes('\n'));
}
export function extractModels(content: string, list: RegExp[] = patterns): [
    string,
    string
][] { const found: [
    string,
    string
][] = []; const seen = new Set<string>(); for (const pattern of list) {
    for (const match of content.matchAll(pattern)) {
        if (inPath(content, ...match.indices![1]))
            continue;
        const model = match[1].replace(edgeSpace, ''), normal = normalizeModelName(model);
        if (seen.has(normal))
            continue;
        seen.add(normal);
        const start = [...content.slice(0, match.index!)].length;
        const end = start + [...match[0]].length;
        found.push([model, [...content].slice(Math.max(0, start - 50), end + 50).join('').replace(/\n/g, ' ').replace(/^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$/g, '')]);
    }
} return found; }
function today(): string { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
interface Finding {
    model: string;
    context: string;
    info: ModelInfo;
    replacement?: ModelInfo;
}
export function checkContent(file: string, content: string, approved: string[], bash = false): string | undefined {
    if (!bash && !extensions.has(extname(file).toLowerCase()))
        return;
    // In Bash, a selection on the command line can block; text the command writes into a file is
    // checked with every pattern, but only as advisory context.
    const judgment: Judgment = { texts: [], writes: false, tooDeep: false, nested: 0 };
    if (bash) {
        const parser = new ShellParser(content);
        selectionText(parser.script(), 0, judgment);
        if (parser.tooDeep || judgment.tooDeep)
            judgment.texts = [content];
    }
    const selections = bash ? extractModels(judgment.texts.join('\n')) : [];
    const selected = new Set(selections.map(([model]) => normalizeModelName(model)));
    const written = !bash || judgment.writes || (emoji?.bashWritesAFile(content) ?? true) ? extractModels(content).filter(([model]) => !selected.has(normalizeModelName(model))) : [];
    const found = [...selections, ...written].filter(([model]) => !approved.includes(normalizeModelName(model)));
    const deprecated: Finding[] = [], migrations: Finding[] = [], unknown: [
        string,
        string
    ][] = [];
    for (const [model, context] of found) {
        const [old, info] = checkModelStatus(model);
        if (old && info)
            deprecated.push({ model, context, info, replacement: info.replacement ? checkModelStatus(info.replacement)[1] : undefined });
        else if (info?.newer_version)
            migrations.push({ model, context, info });
        else if (!info)
            unknown.push([model, context]);
    }
    const target = bash ? 'Bash Command' : `\`${file}\``;
    if (!deprecated.length) {
        if (bash || (!migrations.length && !unknown.length))
            return;
        let text = `WARN_ONLY:\n[INFO] Model check in ${target} (checked: ${today()})\n`;
        for (const f of migrations)
            text += `**[UPGRADE]** \`${f.model}\` (${f.info.provider})\nA newer version is available: \`${f.info.newer_version}\`\n**Context:** \`...${f.context}...\`\n\n`;
        for (const [model, context] of unknown)
            text += `**[UNKNOWN]** \`${model}\` is not in the model database\nThis check could not judge it — it is neither confirmed current nor known to be deprecated.\nIf the model is real, add it to \`models_database.ts\`; if it is a typo, fix the name.\n**Context:** \`...${context}...\`\n\n`;
        return text;
    }
    const blocks = deprecated.filter(f => !f.info.warn_only), warnings = deprecated.filter(f => f.info.warn_only);
    if (!blocks.length) {
        let text = `WARN_ONLY:\n[NOTICE] Sunsetting LLM Model in ${target} (checked: ${today()})\n`;
        for (const f of warnings) {
            text += `**Sunsetting:** \`${f.model}\` (${f.info.provider})\n**Recommended migration:** \`${f.info.replacement ?? 'None'}\`\n`;
            if (f.info.alternative)
                text += `**Note:** ${f.info.alternative}\n`;
        }
        return text;
    }
    const all = [...blocks, ...warnings], hasDeprecated = all.some(f => f.info.status === 'deprecated'), hasOutdated = all.some(f => f.info.status === 'outdated');
    let text = `\n[WARN] ${hasOutdated ? (hasDeprecated ? 'Deprecated/Outdated' : 'Outdated') : 'Deprecated'} LLM Model Detected in ${target} (checked: ${today()})\nThe following model(s) need attention:\n`;
    for (const f of all) {
        const outdated = f.info.status === 'outdated';
        text += `\n**[${outdated ? 'OUTDATED' : 'DEPRECATED'}]** \`${f.model}\` (${f.info.provider})\n${outdated ? 'Still works via API but not competitive — a significantly better option exists in the same tier.' : 'Officially retired by the provider. This model may stop working.'}\n**Recommended:** \`${f.info.replacement ?? 'None'}\`\n`;
        if (f.info.alternative)
            text += `**Alternative:** \`${f.info.alternative}\`\n`;
        if (f.replacement) {
            for (const [label, value] of [['Tier', f.replacement.tier], ['Capabilities', f.replacement.capabilities?.join(', ')], ['Use case', f.replacement.use_case], ['Cost', f.replacement.cost_tier]])
                if (value)
                    text += `  - ${label}: ${value}\n`;
        }
        text += `**Context:** \`${bash ? '' : '...'}${f.context}${bash ? '' : '...'}\`\n`;
    }
    text += '\n**To proceed with this model anyway:**\nAdd to `pyproject.toml`:\n```toml\n[tool.claude-hooks]\napproved_legacy_models = [' + all.map(f => `"${f.model}", `).join('') + ']\n```\n';
    if (!bash)
        text += '\n**To disable this check entirely:**\n```toml\n[tool.claude-hooks]\ncheck_model_versions = false\n```\n';
    if (bash)
        return blocks.some(f => selected.has(normalizeModelName(f.model))) ? text : 'WARN_ONLY:' + text;
    return advisoryTarget(file) ? 'WARN_ONLY:' + text : text;
}
export function handle(input: HookInput & {
    tool?: string;
    params?: any;
}): string | undefined { if(!database)return 'WARN_ONLY:'+databaseWarning; const config = loadConfig(); if (!config.check_model_versions)
    return; const approved = config.approved_legacy_models.map(normalizeModelName), tool = input.tool_name || input.tool, params: any = input.tool_input || input.params || {}; if (tool === 'Bash')
    return checkContent('', params.command ?? '', approved, true); const content = tool === 'Write' ? params.content : tool === 'Edit' ? params.new_string : tool === 'MultiEdit' ? (params.edits ?? []).map((e: any) => e.new_string ?? '').join('\n') : tool === 'NotebookEdit' ? params.new_source : undefined; if (content === undefined)
    return; const file = tool === 'NotebookEdit' ? (params.notebook_path || params.file_path || '') : (params.file_path ?? ''); return checkContent(file, content, approved); }
if (isMain(import.meta.url)) {
    try {
        const warning = handle(JSON.parse(readFileSync(0, 'utf8')));
        if (warning?.startsWith('WARN_ONLY:'))
            console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: warning.slice('WARN_ONLY:'.length) } }));
        else if (warning) {
            console.error(warning);
            process.exitCode = 1;
        }
    }
    catch (error) {
        console.error(`[DEBUG] Model version checker error: ${error}`);
    }
}
