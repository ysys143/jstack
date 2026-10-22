import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { bannedPhrases } from '../../../skills/support/git-conventions/scripts/check_commit.js';
import { heredocBody, invocations, main, positionals, run, type HookInput, type HookResult } from './hook-common.js';
// Skill text alone did not stop Claude Code's default attribution trailer, so the
// commit and PR-creation paths are checked here against check_commit's banned list.
const GIT_VALUED = ['-C', '-c', '--git-dir', '--work-tree', '--namespace'];
/** Where a command's relative paths resolve: the hook's cwd, moved by each `cd` earlier in the same chain and by `git -C`. */
interface Context { cwd: string; command: string; unreadable: string[] }
function readMessageFile(path: string, context: Context, heredoc: string | undefined): string {
    if (path === '-') {
        // Stdin that is not a here-document (a pipe or `< file`) cannot be read here: say so instead of passing silently.
        if (heredoc === undefined) context.unreadable.push('(stdin)');
        return heredoc ?? '';
    }
    const full = resolve(context.cwd, path);
    try { if (existsSync(full)) return readFileSync(full, 'utf8'); } catch { /* reported below */ }
    context.unreadable.push(full);
    return '';
}
function heredocOf(args: string[], command: string): string | undefined {
    const opener = args.findIndex(word => word.startsWith('<<'));
    if (opener < 0) return undefined;
    const delimiter = args[opener].replace(/^<<-?/, '') || args[opener + 1] || '';
    return delimiter ? heredocBody(command, delimiter) : undefined;
}
/**
 * Text typed on the command line, plus a copy with `\n` and `\r\n` escapes turned into line breaks. `printf`, `echo -e`
 * and `$'...'` make those breaks from the escape only when the command runs, and git then records the trailer on its own
 * line. A `\n` outside quotes is just `n` in bash, so this copy over-blocks it on purpose.
 */
function typed(text: string): string[] {
    const expanded = text.replace(/\\r\\n|\\n|\\r/g, '\n');
    return expanded === text ? [text] : [text, expanded];
}
/** Git accepts `--trailer token=value` as well as `token: value`; both record a `token: value` line. */
function trailerLine(value: string): string {
    const at = value.search(/[:=]/);
    return at >= 0 && value[at] === '=' ? `${value.slice(0, at).trimEnd()}:${value.slice(at + 1)}` : value;
}
/** Message text a `git commit` invocation will record: -m values, --trailer values, -F files or stdin, and the reused HEAD message on --amend. */
export function commitMessages(args: string[], context: Context): string[] {
    const texts: string[] = [], heredoc = heredocOf(args, context.command);
    let amend = false, sourced = false;
    for (let j = 0; j < args.length; j++) {
        const word = args[j];
        if (word === '--amend') amend = true;
        else if (word === '-m' || word === '--message' || /^-[a-zA-Z]*m$/.test(word)) { texts.push(...typed(args[++j] ?? '')); sourced = true; }
        else if (word.startsWith('--message=')) { texts.push(...typed(word.slice(10))); sourced = true; }
        else if (/^-m./.test(word)) { texts.push(...typed(word.slice(2))); sourced = true; }
        else if (word === '-F' || word === '--file' || /^-[a-zA-Z]*F$/.test(word)) { texts.push(readMessageFile(args[++j] ?? '', context, heredoc)); sourced = true; }
        else if (word.startsWith('--file=')) { texts.push(readMessageFile(word.slice(7), context, heredoc)); sourced = true; }
        else if (word === '--trailer') texts.push(...typed(trailerLine(args[++j] ?? '')));
        else if (word.startsWith('--trailer=')) texts.push(...typed(trailerLine(word.slice(10))));
    }
    if (amend && !sourced) { const head = run('git', ['log', '-1', '--format=%B'], context.cwd); if (head.status === 0) texts.push(head.stdout); }
    return texts;
}
/** Body text a PR-creation invocation will publish: --body values and --body-file files or stdin. */
export function prBodies(args: string[], context: Context): string[] {
    const texts: string[] = [], heredoc = heredocOf(args, context.command);
    for (let j = 0; j < args.length; j++) {
        const word = args[j];
        if (word === '-b' || word === '--body') texts.push(...typed(args[++j] ?? ''));
        else if (word.startsWith('--body=')) texts.push(...typed(word.slice(7)));
        else if (word === '-F' || word === '--body-file') texts.push(readMessageFile(args[++j] ?? '', context, heredoc));
        else if (word.startsWith('--body-file=')) texts.push(readMessageFile(word.slice(12), context, heredoc));
    }
    return texts;
}
/** Banned attribution in what the command would record, plus message files that could not be read and so were not checked. */
export function inspectCommand(command: string, cwd = process.cwd()): { found: { target: 'commit' | 'pr'; phrases: string[] }[]; unreadable: string[] } {
    const found: { target: 'commit' | 'pr'; phrases: string[] }[] = [], unreadable: string[] = [];
    let current = cwd;
    for (const [program, ...args] of invocations(command)) {
        if (program === 'cd') { current = resolve(current, args.find(word => !word.startsWith('-')) ?? homedir()); continue; }
        let target: 'commit' | 'pr' | undefined, rest: string[] = [], base = current;
        if (program === 'git') {
            const at = args.findIndex((word, j) => word === 'commit' && positionals(args.slice(0, j + 1), GIT_VALUED).length === 1);
            if (at >= 0) {
                target = 'commit'; rest = args.slice(at + 1);
                for (let j = 0; j < at; j++) if (args[j] === '-C' && args[j + 1] !== undefined) base = resolve(base, args[++j]);
            }
        } else if (program === 'gh') {
            const words = positionals(args, ['-R', '--repo']);
            if (words[0] === 'pr' && words[1] === 'create') { target = 'pr'; rest = args.slice(args.indexOf('create') + 1); }
        }
        if (!target) continue;
        const context: Context = { cwd: base, command, unreadable };
        const texts = target === 'commit' ? commitMessages(rest, context) : prBodies(rest, context);
        const phrases = [...new Set(texts.flatMap(text => bannedPhrases(text)))];
        if (phrases.length) found.push({ target, phrases });
    }
    return { found, unreadable };
}
export function findAttribution(command: string, cwd = process.cwd()): { target: 'commit' | 'pr'; phrases: string[] }[] { return inspectCommand(command, cwd).found; }
export function handle(input: HookInput): HookResult | undefined {
    if (input.tool_name !== 'Bash') return;
    const { found, unreadable } = inspectCommand(input.tool_input?.command ?? '', input.cwd ?? process.cwd());
    if (found.length) {
        const lines = found.map(({ target, phrases }) => `- ${target === 'commit' ? 'commit message' : 'PR body'}: remove every line containing ${phrases.map(p => JSON.stringify(p)).join(', ')}`);
        return { decision: 'block', reason: ['[AI attribution] jstack forbids AI co-author trailers and generated-with footers in commits and PR bodies, in every repository where it is enabled.', ...lines, 'Rewrite the message without those lines and run the command again. Do not add them back through another flag or file.'].join('\n') };
    }
    // Fail open like the rest of the chain, but say that a message file went unchecked.
    if (unreadable.length) return { systemMessage: `[AI attribution] Unverifiable message file (not found from the resolved directory, or piped on stdin): ${unreadable.join(', ')}. It was not checked for AI co-author trailers or generated-with footers.` };
}
main(import.meta.url, handle);
