import { readFileSync } from 'node:fs';
import { isMain } from '../../../runtime/entry.js';
import { type HookInput, type HookResult } from './hook-common.js';
// Preserve the legacy contract, including the intentionally broad technical range.
export const EMOJI_PATTERN = /[\u{1f600}-\u{1f64f}\u{1f300}-\u{1f5ff}\u{1f680}-\u{1f6ff}\u{1f700}-\u{1f77f}\u{1f780}-\u{1f7ff}\u{1f800}-\u{1f8ff}\u{1f900}-\u{1f9ff}\u{1fa00}-\u{1fa6f}\u{1fa70}-\u{1faff}\u{1f926}-\u{1f937}\u2600-\u26ff\u2700-\u27bf\u2300-\u23ff\u2b50\u3030\u303d\u3297\u3299]+/gu;
export function containsEmoji(text: string): string[] { return text.match(EMOJI_PATTERN) ?? []; }
export function bashWritesAFile(command: string): boolean { const text = command.replace(/\d*>&\d*|>>?\s*\/dev\/null/g, ' '); return [/>>?\s*[^\s&|]/, /<<-?\s*['"]?\w/, /(?:^|[\s|;&])sed\s+(?:-\S+\s+)*-i/, /(?:^|[\s|;&])tee\b/].some(pattern => pattern.test(text)); }
function unicodeEscape(text: string): string { return [...text].map(c => { const n = c.codePointAt(0)!; return n > 65535 ? '\\U' + n.toString(16).padStart(8, '0') : '\\u' + n.toString(16).padStart(4, '0'); }).join(''); }
export function handle(input: HookInput): HookResult | undefined { const value = input.tool_input ?? {}; const command = value.command ?? ''; const content = input.tool_name === 'Write' ? value.content : input.tool_name === 'Edit' ? value.new_string : input.tool_name === 'MultiEdit' ? (value.edits ?? []).map(edit => edit.new_string ?? '').join('\n') : input.tool_name === 'NotebookEdit' ? value.new_source : input.tool_name === 'Bash' && bashWritesAFile(command) ? command : ''; const found = [...new Set(containsEmoji(content ?? ''))]; if (!found.length)
    return; let list = found.slice(0, 10).map(e => `${e} (${unicodeEscape(e)})`).join(', '); if (found.length > 10)
    list += ` ... and ${found.length - 10} more`; return { decision: 'block', reason: `Emoji detected in content: ${list}. Default: remove all emoji characters and retry with ASCII alternatives like [O], [X], [INFO], [WARN], ->, <- instead. If the user explicitly asked for these emoji, this is a policy exemption: read payload/skills/emoji/SKILL.md in the installed jstack package (section "When the user asked for emoji") and do not retry the same call unchanged.` }; }
// This hook's fail-open wire contract differs from the other hooks: malformed
// JSON is silent, while processing errors are reported only on stderr.
if (isMain(import.meta.url)) {
    let input: HookInput;
    try {
        input = JSON.parse(readFileSync(0, 'utf8'));
    } catch (error) {
        if (!(error instanceof SyntaxError))
            process.stderr.write(`Hook error: ${error instanceof Error ? error.message : String(error)}\n`);
        process.exit(0);
    }
    try {
        const result = handle(input);
        if (result) process.stdout.write(JSON.stringify(result) + '\n');
    } catch (error) {
        process.stderr.write(`Hook error: ${error instanceof Error ? error.message : String(error)}\n`);
    }
}
