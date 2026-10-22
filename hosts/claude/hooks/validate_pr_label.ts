import { createHash } from 'node:crypto';
import { existsSync, readFileSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { runProcess as spawnSync } from '../../../runtime/os.js';
import { gitRoot, main, type HookInput, type HookResult } from './hook-common.js';
// Python sorts Unicode scalar values; preserve persisted policy fingerprints.
function unicodeOrder(a: string, b: string): number { const left = [...a], right = [...b]; for (let i = 0; i < Math.min(left.length, right.length); i++) { const delta = left[i].codePointAt(0)! - right[i].codePointAt(0)!; if (delta) return delta; } return left.length - right.length; }
export const POLICY_FILE = '.claude/pr-policy.json';
export const DECLARED_SOURCES = ['.github/PULL_REQUEST_TEMPLATE.md', '.github/pull_request_template.md', '.github/CONTRIBUTING.md', 'CONTRIBUTING.md', 'CLAUDE.md', 'AGENTS.md'];
const hints = /(레이블|라벨|label|필수|required|반드시|must|정책|policy|convention)/i;
export interface Rule {
    group: string;
    requirement: string;
    allowed: string[];
    observed_rate: number;
    declared: boolean;
}
export interface Policy {
    version: number;
    generated_by: string;
    fingerprint: string;
    observed_prs: number;
    declared_sources: string[];
    phantom_labels: string[];
    confidence: number;
    enforced: boolean;
    rules: Rule[];
}
function gh(args: string[]): string | undefined { const result = spawnSync('gh', args, { encoding: 'utf8', timeout: 20000, windowsHide: true }); return result.status === 0 ? result.stdout : undefined; }
export function groupKey(label: string): string { return /^([^0-9A-Za-z]+)/.exec(label)?.[1] ?? /^([0-9A-Za-z][0-9A-Za-z._-]*[:/])/.exec(label)?.[1] ?? '_plain'; }
export function groupLabels(labels: Iterable<string>): Record<string, string[]> { const groups: Record<string, string[]> = Object.create(null); for (const label of labels)
    (groups[groupKey(label)] ??= []).push(label); for (const values of Object.values(groups))
    values.sort(unicodeOrder); return groups; }
export function readDeclared(root: string): [
    Set<string>,
    string[]
] { const declared = new Set<string>(), sources: string[] = []; for (const relative of DECLARED_SOURCES) {
    let text: string;
    try {
        text = readFileSync(join(root, relative), 'utf8');
    }
    catch {
        continue;
    }
    const lines = text.split(/\r?\n/), found = new Set<string>();
    for (let index = 0; index < lines.length; index++) {
        if (!lines.slice(Math.max(0, index - 3), index + 1).some(line => hints.test(line)))
            continue;
        for (const match of lines[index].matchAll(/[`"']([^`"'\s]{2,40})[`"']/g))
            found.add(match[1]);
    }
    if (found.size) {
        for (const value of found)
            declared.add(value);
        sources.push(relative);
    }
} return [declared, sources]; }
export function readDefined(): Set<string> | undefined { const raw = gh(['label', 'list', '--limit', '200', '--json', 'name']); if (raw === undefined)
    return; try {
    return new Set(JSON.parse(raw).map((row: any) => row.name));
}
catch {
    return;
} }
export function observeShape(defined: Set<string>): [
    Record<string, number>,
    number
] { const raw = gh(['pr', 'list', '--state', 'all', '--limit', '50', '--json', 'labels']); if (raw === undefined)
    return [{}, 0]; try {
    const prs = JSON.parse(raw);
    if (!prs.length)
        return [{}, 0];
    const keys = new Set([...defined].map(groupKey)), tally: Record<string, number> = Object.fromEntries([...keys].map(k => [k, 0]));
    for (const pr of prs)
        for (const key of new Set((pr.labels ?? []).map((row: any) => groupKey(row.name))))
            if (keys.has(key as string))
                tally[key as string]++;
    return [Object.fromEntries(Object.entries(tally).map(([k, n]) => [k, n / prs.length])), prs.length];
}
catch {
    return [{}, 0];
} }
const hash = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
export function fingerprint(defined: Set<string>, root: string): string { const parts = [[...defined].sort(unicodeOrder).join('|')]; for (const relative of DECLARED_SOURCES)
    try {
        parts.push(`${relative}:${hash(readFileSync(join(root, relative))).slice(0, 16)}`);
    }
    catch { } return hash(parts.join('\n')).slice(0, 32); }
export function discover(root: string): Policy | undefined { const defined = readDefined(); if (!defined)
    return; const [declared, sources] = readDeclared(root), [rates, observed] = observeShape(defined), groups = groupLabels(defined); const phantom = [...declared].filter(n => !defined.has(n) && groupKey(n) !== '_plain' && Object.hasOwn(groups, groupKey(n))).sort(unicodeOrder); const rules: Rule[] = []; for (const [key, members] of Object.entries(groups).sort(([a], [b]) => unicodeOrder(a, b))) {
    const rate = rates[key] ?? 0, asserted = members.some(n => declared.has(n)) || phantom.some(n => groupKey(n) === key);
    if (rate >= 0.8 || (asserted && rate >= 0.5))
        rules.push({ group: key, requirement: 'at_least_one', allowed: members, observed_rate: Number(rate.toFixed(3)), declared: asserted });
} const confidence = rules.length ? Math.min(...rules.map(r => r.observed_rate)) : 0; return { version: 1, generated_by: 'hooks/validate_pr_label.js', fingerprint: fingerprint(defined, root), observed_prs: observed, declared_sources: sources, phantom_labels: phantom, confidence, enforced: confidence >= 0.6, rules }; }
export function loadPolicy(root: string): [
    string,
    Policy | undefined
] { const path = join(root, POLICY_FILE); try {
    if (!statSync(path).isFile())
        return ['missing', undefined];
}
catch {
    return ['missing', undefined];
} try {
    const raw = readFileSync(path, 'utf8').trim();
    return raw ? ['present', JSON.parse(raw)] : ['empty', undefined];
}
catch {
    return ['broken', undefined];
} }
export function savePolicy(root: string, policy: Policy): boolean { try {
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(join(root, POLICY_FILE), JSON.stringify(policy, null, 2) + '\n', 'utf8');
    return true;
}
catch {
    return false;
} }
type ShellWord = { value: string; dynamic: boolean; literalDollar: boolean; quotedTilde: boolean };
type ShellToken = ShellWord | { operator: string };
type PrCommand = { directory?: string; labels: string[]; repository?: string };

// Read only local, simple commands. Quotes and heredoc bodies are data, not commands.
function shellTokens(command: string): ShellToken[] {
    const tokens: ShellToken[] = [], heredocs: string[] = [];
    let value = '', dynamic = false, literalDollar = false, quotedTilde = false, started = false, index = 0;
    const word = () => { if (started) tokens.push({ value, dynamic, literalDollar, quotedTilde }); value = ''; dynamic = literalDollar = quotedTilde = started = false; };
    const nested = (from: number): number => {
        let depth = 1, quote = '';
        for (let i = from + 2; i < command.length; i++) {
            const c = command[i];
            if (c === '\\') { i++; continue; }
            if (quote) { if (c === quote) quote = ''; continue; }
            if (c === '"' || c === "'") { quote = c; continue; }
            if (c === '(') depth++;
            if (c === ')' && --depth === 0) return i + 1;
        }
        return command.length;
    };
    const heredocDelimiter = (from: number): { value: string; next: number } | undefined => {
        let next = from, value = '', quote = '';
        while (next < command.length) {
            const c = command[next];
            if (!quote && /[\s;&|()<>]/.test(c)) break;
            if (c === '\\' && quote !== "'") {
                const escaped = command[next + 1];
                if (!escaped || escaped === '\n') return;
                if (quote === '"' && !'$`"\\'.includes(escaped)) { value += c; next++; continue; }
                value += escaped; next += 2; continue;
            }
            if (quote && c === quote) { quote = ''; next++; continue; }
            if (!quote && (c === "'" || c === '"')) { quote = c; next++; continue; }
            value += c; next++;
        }
        return value && !quote ? { value, next } : undefined;
    };
    const skipHeredocs = () => {
        for (const delimiter of heredocs.splice(0)) {
            while (index < command.length) {
                const end = command.indexOf('\n', index), next = end < 0 ? command.length : end;
                const line = command.slice(index, next).replace(/\r$/, '');
                index = end < 0 ? command.length : end + 1;
                if ((delimiter.startsWith('\t') ? line.replace(/^\t+/, '') : line) === (delimiter.startsWith('\t') ? delimiter.slice(1) : delimiter)) break;
            }
        }
    };
    while (index < command.length) {
        const c = command[index];
        if (c === '\\') {
            started = true;
            if (command[index + 1] === '\n') { index += 2; continue; }
            if (command[index + 1] === '$') literalDollar = true;
            if ((!value || /^[A-Za-z_]\w*=$/.test(value)) && command[index + 1] === '~') quotedTilde = true;
            value += command[index + 1] ?? ''; index += 2; continue;
        }
        if (c === "'" || c === '"') {
            started = true;
            if ((!value || /^[A-Za-z_]\w*=$/.test(value)) && command[index + 1] === '~') quotedTilde = true;
            const quote = c;
            index++;
            while (index < command.length && command[index] !== quote) {
                if (quote === '"' && command[index] === '\\' && index + 1 < command.length) { if (command[index + 1] === '$') literalDollar = true; value += command[index + 1]; index += 2; continue; }
                if (quote === '"' && command.slice(index, index + 2) === '$(') { const end = nested(index); value += command.slice(index, end); dynamic = true; index = end; continue; }
                if (quote === "'" && command[index] === '$') literalDollar = true;
                value += command[index++];
            }
            if (index < command.length) index++;
            continue;
        }
        if (command.slice(index, index + 2) === '$(') {
            started = dynamic = true;
            const end = nested(index); value += command.slice(index, end); index = end; continue;
        }
        if (c === '`') {
            started = dynamic = true;
            const end = command.indexOf('`', index + 1);
            value += command.slice(index, end < 0 ? command.length : end + 1);
            index = end < 0 ? command.length : end + 1; continue;
        }
        if (c === '#' && !started) { while (index < command.length && command[index] !== '\n') index++; continue; }
        if (/\s/.test(c)) {
            word(); index++;
            if (c === '\n') { tokens.push({ operator: '\n' }); skipHeredocs(); }
            continue;
        }
        if (';&|()<>'.includes(c)) {
            word();
            const pair = command.slice(index, index + 2);
            const operator = command.slice(index, index + 3) === '<<-' ? '<<-' : ['&&', '||', '<<', '>>'].includes(pair) ? pair : c;
            tokens.push({ operator }); index += operator.length;
            if (operator === '<<' || operator === '<<-') {
                while (index < command.length && /[ \t]/.test(command[index])) index++;
                const delimiter = heredocDelimiter(index);
                if (delimiter) { heredocs.push((operator === '<<-' ? '\t' : '') + delimiter.value); index = delimiter.next; }
            }
            continue;
        }
        started = true; value += c; index++;
    }
    word();
    return tokens;
}

function expanded(word: ShellWord, variables: Map<string, string | undefined>): string | undefined {
    if (word.dynamic || word.literalDollar || /\$\(|`/.test(word.value)) return;
    let unknown = false;
    const value = word.value.replace(/\$(?:\{([A-Za-z_]\w*)\}|([A-Za-z_]\w*))/g, (_, braced: string, plain: string) => {
        const found = variables.get(braced ?? plain);
        if (found === undefined) { unknown = true; return ''; }
        return found;
    });
    if (unknown || value.includes('$')) return;
    const home = variables.has('HOME') ? variables.get('HOME') : homedir();
    if (value === '~' || value.startsWith('~/')) {
        if (word.quotedTilde || !word.value.startsWith('~') || !home) return;
        return join(home, value.slice(1));
    }
    return value;
}

function unwrap(words: ShellWord[], variables: Map<string, string | undefined>): ShellWord[] {
    let index = 0;
    for (;;) {
        while (index < words.length) {
            const assignment = /^([A-Za-z_]\w*)=(.*)$/.exec(words[index].value);
            if (!assignment) break;
            variables.set(assignment[1], expanded({ ...words[index], value: assignment[2] }, variables));
            index++;
        }
        const name = words[index]?.value;
        if (name === 'env' || name === 'command' || name === 'exec' || name === 'sudo' || name === 'doas' || name === 'time' || name === 'nohup') { index++; continue; }
        break;
    }
    return words.slice(index);
}

function repositoryOption(words: ShellWord[], index: number): { repository?: string; next: number } | undefined {
    const value = words[index]?.value;
    if (value === '-R' || value === '--repo') return { repository: words[index + 1]?.value, next: index + 2 };
    if (value?.startsWith('--repo=')) return { repository: value.slice('--repo='.length), next: index + 1 };
    if (value?.startsWith('-R') && value.length > 2) return { repository: value.slice(2), next: index + 1 };
}

function prOptions(words: ShellWord[]): Pick<PrCommand, 'labels' | 'repository'> {
    const labels: string[] = [];
    let repository: string | undefined;
    for (let i = 0; i < words.length; i++) {
        const value = words[i].value;
        if (value === '--title' || value === '--body') { i++; continue; }
        const option = repositoryOption(words, i);
        if (option) { repository = option.repository; i = option.next - 1; continue; }
        if (value === '--label' || value === '-l') { if (words[i + 1]) labels.push(words[++i].value); }
        else if (value.startsWith('--label=')) labels.push(value.slice('--label='.length));
    }
    return { labels, repository };
}

function prCommands(command: string, base: string, initial = new Map(Object.entries(process.env)), depth = 0): PrCommand[] {
    if (depth > 2) return [];
    const found: PrCommand[] = [], variables = new Map(initial), tokens = shellTokens(command);
    let directory: string | undefined = base, words: ShellWord[] = [];
    const parents: { directory?: string; variables: Map<string, string | undefined> }[] = [];
    const flush = () => {
        if (!words.length) return;
        const local = new Map(variables), args = unwrap(words, local);
        const name = args[0]?.value;
        if (!name && words.every(w => /^\w+=/.test(w.value))) for (const [key, value] of local) variables.set(key, value);
        if (name === 'cd' || name === 'pushd') {
            const target = args[1]?.value === '--' ? args[2] : args[1];
            const path = target ? expanded(target, variables) : name === 'cd' ? variables.get('HOME') : undefined;
            directory = path && path !== '-' && args.length <= (args[1]?.value === '--' ? 3 : 2) && (directory || isAbsolute(path))
                ? resolve(directory ?? '/', path) : undefined;
        }
        else if (name === 'source' || name === '.' || name === 'eval') directory = undefined;
        else if (name === 'gh') {
            let index = 1, repository: string | undefined;
            while (index < args.length) {
                const option = repositoryOption(args, index);
                if (!option) break;
                repository = option.repository;
                index = option.next;
            }
            if (args[index]?.value === 'pr' && args[index + 1]?.value === 'create') {
                const options = prOptions(args.slice(index + 2));
                found.push({ directory, ...options, repository: options.repository ?? repository });
            }
        }
        else if (['bash', 'sh', 'zsh'].includes(name ?? '') && /^-\w*c$/.test(args[1]?.value ?? '') && args[2] && !args[2].dynamic)
            found.push(...prCommands(args[2].value, directory ?? base, local, depth + 1).map(item => directory ? item : { ...item, directory: undefined }));
        words = [];
    };
    for (const token of tokens) {
        if ('value' in token) { words.push(token); continue; }
        if (token.operator === '(') {
            flush(); parents.push({ directory, variables: new Map(variables) });
        }
        else if (token.operator === ')') {
            flush();
            const parent = parents.pop();
            if (parent) { directory = parent.directory; variables.clear(); for (const [key, value] of parent.variables) variables.set(key, value); }
        }
        else flush();
    }
    flush();
    return found;
}

/** Directory for the first local PR creation; undefined means no safe local target. */
export function commandDirectory(command: string, base: string): string | undefined {
    return prCommands(command, base)[0]?.directory;
}
export function parseLabels(command: string): string[] { return prCommands(command, process.cwd())[0]?.labels ?? []; }
function mainCheckout(root: string): string | undefined {
    const common = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: root, encoding: 'utf8', timeout: 10000 });
    if (common.status !== 0) return;
    const directory = common.stdout.trim();
    if (!isAbsolute(directory) || !existsSync(directory)) return;
    const checkout = resolve(directory, '..');
    if (checkout === root || !existsSync(join(checkout, '.git'))) return;
    return checkout;
}
function namedGitHubRepository(name: string): string | undefined {
    const match = /^(?:github\.com\/)?([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/i.exec(name);
    return match ? `${match[1]}/${match[2]}`.toLowerCase() : undefined;
}
function remoteGitHubRepository(root: string): string | undefined {
    const remote = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8', timeout: 10000 });
    if (remote.status !== 0) return;
    const match = /^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/i.exec(remote.stdout.trim());
    return match ? `${match[1]}/${match[2]}`.toLowerCase() : undefined;
}
export function judge(labels: string[], policy: Policy | undefined): [
    string | undefined,
    string | undefined
] { if (!policy?.rules?.length)
    return [undefined, undefined]; const missing: string[] = []; for (const rule of policy.rules) {
    if (labels.some(label => rule.allowed.includes(label)))
        continue;
    let shown = rule.allowed.slice(0, 12).join(', ');
    if (rule.allowed.length > 12)
        shown += `, ... (${rule.allowed.length} total)`;
    missing.push(`- one label from group '${rule.group}': ${shown}`);
} if (!missing.length)
    return [undefined, undefined]; const detail = missing.join('\n'), evidence = `Evidence: ${policy.observed_prs ?? 0} PRs observed · confidence ${Math.round((policy.confidence ?? 0) * 100)}% · policy ${POLICY_FILE}`; if (!policy.enforced)
    return [undefined, `[PR label] Policy confidence is too low to block.\n${detail}\n${evidence}`]; const example = policy.rules.map(r => `--label "${r.allowed[0]}"`).join(' '); return [`PR labels do not satisfy this repository's policy.\n\n${detail}\n\n${evidence}\n\nExample: gh pr create --title "..." ${example}`, undefined]; }
export function describeDelta(before: Policy | undefined, after: Policy): string { const was = Object.fromEntries((before?.rules ?? []).map(r => [r.group, r.allowed])), now = Object.fromEntries(after.rules.map(r => [r.group, r.allowed])), lines: string[] = []; const display = (values: string[]) => '[' + values.sort(unicodeOrder).map(v => `'${v}'`).join(', ') + ']'; for (const key of [...new Set([...Object.keys(was), ...Object.keys(now)])].sort(unicodeOrder)) {
    if (!Object.hasOwn(was, key))
        lines.push(`  + group '${key}' became required: ${display(now[key])}`);
    else if (!Object.hasOwn(now, key))
        lines.push(`  - group '${key}' is no longer required`);
    else {
        const added = now[key].filter(n => !was[key].includes(n)), removed = was[key].filter(n => !now[key].includes(n));
        if (added.length)
            lines.push(`  + added to '${key}': ${display(added)}`);
        if (removed.length)
            lines.push(`  - removed from '${key}': ${display(removed)}`);
    }
} return lines.join('\n'); }
export function ghState(): 'absent'|'unauthenticated'|'ready' {
    const result=spawnSync('gh',['auth','status'],{timeout:20000});
    return result.status===0?'ready':(result.error as NodeJS.ErrnoException|undefined)?.code==='ENOENT'?'absent':'unauthenticated';
}
export function onboardingMessage(root: string, state: string): string {
    const head=(state==='missing'?`This repository has no registered PR label policy: ${POLICY_FILE}`:`The PR label policy file cannot be read: ${POLICY_FILE}`)+`\nRepository: ${root}`;
    const empty=`node -e "const fs=require('node:fs');fs.mkdirSync('.claude',{recursive:true});fs.writeFileSync('${POLICY_FILE}','')"`;
    const auth=ghState();
    const optOut=`If this repository has no label policy, declare that decision with an empty file:\n${empty}\nAn empty file is a decision; an absent file means policy has not been reviewed.`;
    if(auth!=='ready'){
        const install=process.platform==='darwin'?'brew install gh':process.platform==='linux'?'sudo apt install gh  # Debian/Ubuntu\nsudo dnf install gh  # Fedora/RHEL':'winget install --id GitHub.cli';
        return head+'\n\n'+(auth==='absent'?`GitHub CLI (gh) is not installed. Install it:\n${install}\nThen authenticate: gh auth login`:'GitHub CLI (gh) is not authenticated. Authenticate: gh auth login\nCheck status: gh auth status')+'\n\n'+optOut;
    }
    const suggestion=discover(root);
    const lines=[head,'','Choose a policy before opening a PR.','(1) Review and save the following JSON in '+POLICY_FILE+'.', '```json',JSON.stringify(suggestion??{version:1,rules:[]},null,2),'```'];
    if(suggestion?.phantom_labels.length)lines.push('Labels declared in documents but undefined in the repository: '+suggestion.phantom_labels.join(', '));
    lines.push('','(2) '+optOut);return lines.join('\n');
}
export function handle(input: HookInput): HookResult | undefined {
    if (input.tool_name !== 'Bash') return;
    const commands = prCommands(input.tool_input?.command ?? '', input.cwd ?? process.cwd());
    const notes: string[] = [];
    for (const command of commands) {
        const root = command.directory && existsSync(command.directory) ? gitRoot(command.directory) : undefined;
        if (command.repository) {
            const target = namedGitHubRepository(command.repository);
            if (!root || !target || target !== remoteGitHubRepository(root)) {
                notes.push(`[PR label] Repository target: ${command.repository}. Local policy was not applied; check that repository's PR label policy.`);
                continue;
            }
        }
        if (!command.directory) { notes.push('[PR label] PR command directory could not be resolved; repository policy was not checked.'); continue; }
        if (!root) { notes.push('[PR label] PR command repository could not be resolved; repository policy was not checked.'); continue; }
        const original = process.cwd();
        try {
            process.chdir(root);
            let [state, policy] = loadPolicy(root);
            const inherited = state === 'missing' ? mainCheckout(root) : undefined;
            if (inherited) [state, policy] = loadPolicy(inherited);
            if (state === 'missing' || state === 'broken')
                return { decision: 'block', reason: [...notes, onboardingMessage(root, state)].join('\n') };
            if (state === 'empty') continue;
            if (!inherited) {
                const defined = readDefined();
                if (defined && fingerprint(defined, root) !== policy?.fingerprint) {
                    const fresh = discover(root);
                    if (fresh) {
                        const delta = describeDelta(policy, fresh);
                        savePolicy(root, fresh);
                        policy = fresh;
                        notes.push('[PR label] Policy changed and was refreshed.' + (delta ? '\n' + delta : ' (required groups unchanged)'));
                    }
                }
            }
            const [reason, warning] = judge(command.labels, policy);
            if (warning) notes.push(warning);
            if (reason) return { decision: 'block', reason: [...notes, reason].join('\n') };
        }
        catch (error) {
            notes.push(`[PR label] Hook error: ${error}`);
        }
        finally {
            process.chdir(original);
        }
    }
    if (notes.length) return { systemMessage: notes.join('\n') };
}
main(import.meta.url, handle);
