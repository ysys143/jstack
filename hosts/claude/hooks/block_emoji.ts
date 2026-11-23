import { existsSync, readFileSync } from 'node:fs';
import { sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalogRoot } from '../../../runtime/catalog_cli.js';
import { sourcePath } from '../../../runtime/skill_catalog.js';
import { isMain } from '../../../runtime/entry.js';
import { type HookInput, type HookResult } from './hook-common.js';
import { containsEmoji } from './emoji-pattern.js';
export { EMOJI_PATTERN, containsEmoji } from './emoji-pattern.js';
export function bashWritesAFile(command: string): boolean { const text = command.replace(/\d*>&\d*|>>?\s*\/dev\/null/g, ' '); return [/>>?\s*[^\s&|]/, /<<-?\s*['"]?\w/, /(?:^|[\s|;&])sed\s+(?:-\S+\s+)*-i/, /(?:^|[\s|;&])tee\b/].some(pattern => pattern.test(text)); }
function unicodeEscape(text: string): string { return [...text].map(c => { const n = c.codePointAt(0)!; return n > 65535 ? '\\U' + n.toString(16).padStart(8, '0') : '\\u' + n.toString(16).padStart(4, '0'); }).join(''); }
/** Locate the same support body from contributor dist or installed payload, independently of tool cwd. */
function supportFile(): string {
    try { return sourcePath(catalogRoot(), 'skills/emoji/SKILL.md'); }
    catch {
        // Broken discovery metadata must never turn a literal emoji write into a pass.
        // Static candidates, first existing wins: the package builder rewrites the first URL to
        // payload skills/emoji/SKILL.md beside the installed hook; it points outside contributor
        // dist, where the second URL reaches the source body from dist/hosts/claude/hooks. The
        // second URL is used only from that contributor dist location, so an installed payload
        // never points at a file outside its own plugin root.
        const contributorDist = fileURLToPath(import.meta.url).split(sep).slice(-5, -1).join('/') === 'dist/hosts/claude/hooks';
        const candidates = [new URL('../../../skills/support/emoji-policy/SKILL.md', import.meta.url), ...(contributorDist ? [new URL('../../../../skills/support/emoji-policy/SKILL.md', import.meta.url)] : [])];
        return fileURLToPath(candidates.find(candidate => existsSync(candidate)) ?? candidates[0]);
    }
}
export function handle(input: HookInput): HookResult | undefined { const value = input.tool_input ?? {}; const command = value.command ?? ''; const content = input.tool_name === 'Write' ? value.content : input.tool_name === 'Edit' ? value.new_string : input.tool_name === 'MultiEdit' ? (value.edits ?? []).map(edit => edit.new_string ?? '').join('\n') : input.tool_name === 'NotebookEdit' ? value.new_source : input.tool_name === 'Bash' && bashWritesAFile(command) ? command : ''; const found = [...new Set(containsEmoji(content ?? ''))]; if (!found.length)
    return; let list = found.slice(0, 10).map(e => `${e} (${unicodeEscape(e)})`).join(', '); if (found.length > 10)
    list += ` ... and ${found.length - 10} more`; return { decision: 'block', reason: `Emoji detected in content: ${list}. Default: remove all emoji characters and retry with ASCII alternatives like [O], [X], [INFO], [WARN], ->, <- instead. If the user explicitly asked for these emoji, this is a policy exemption. Read support file: ${JSON.stringify(supportFile())}. Use that absolute path first; in the installed jstack package it is payload/skills/emoji/SKILL.md, and a contributor build may name the same body differently. Follow its section "When the user asked for emoji" and do not retry the same call unchanged.` }; }
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
