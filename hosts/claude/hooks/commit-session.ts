import { isMain } from '../../../runtime/entry.js';
import { existsSync, appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { runProcess as spawnSync } from '../../../runtime/os.js';
import { fileURLToPath } from 'node:url';
import { gitRoot } from './hook-common.js';
import { DEFAULT_CONVENTIONS, effectiveConventions, type Conventions } from '../../../runtime/conventions.js';
// Preserve explicit opt-in and kill switch. This hook stages all files when enabled.
export function autocommitEnabled(root: string, setting = process.env.JSTACK_SESSION_AUTOCOMMIT ?? ''): boolean { if (['0', 'false', 'off', 'no'].includes(setting))
    return false; if (['1', 'true', 'on', 'yes'].includes(setting))
    return true; return existsSync(join(root, '.claude', 'session-autocommit')); }
/** The prompt follows the effective conventions; an undecided profile conflict keeps the defaults because a hook cannot ask. */
export function prompt(conventions: Conventions = DEFAULT_CONVENTIONS): string {
  const korean = conventions.autocommitLanguage === 'ko', language = korean ? 'Korean' : 'English', types = conventions.commitTypes.join(', ');
  const ending = korean ? (conventions.subjectVerbEnding === 'korean' ? ', ending in an action noun such as 추가, 수정, 변경 or 제거' : '') : ', imperative mood';
  return `You are a commit message generator for an AUTOMATIC session snapshot in a repository that uses Conventional Commits with ${language} descriptions. You are given ONLY a git diff — there is no human-provided intent, so you cannot know WHY the change was made.
Rules:
- First line: '<type>(<scope>): <${language} description>'. type is inferred from the diff and MUST be one of: ${types}. scope = main changed area or plugin name (optional).
- Type inference from the diff: new capability/file = feat; bug fix = fix; restructure without behavior change = refactor; only *.md/docs = docs; deps/version/config/build = chore; tests = test; deletions = remove; formatting only = style. Use the closest allowed type when one of these is not allowed.
- Description: ${language}, MAX ${conventions.subjectMax} chars${ending}, NO trailing period.
- Describe ONLY what the diff literally shows. Do NOT invent motivation, impact, rationale, or ticket numbers — you have no evidence. OMIT the WHY paragraph rather than fabricate it.
- If several unrelated areas changed, use 'chore: update multiple areas' and list them in the body.
- Optional body: a blank line then up to 4 ${language} bullets naming concrete changes (what/how), wrapped at ${conventions.bodyWrap} chars.
- NEVER include 'Generated with Claude Code' or 'Co-Authored-By: Claude'. Never reproduce secrets, tokens, or keys.
- Output ONLY the commit message, nothing else.`;
}
export function commitSession(): void {
    const root = gitRoot() || process.env.CLAUDE_PROJECT_DIR;
    if (!root || !existsSync(root) || !autocommitEnabled(root))
        return;
    const git = (args: string[], input?: string) => spawnSync('git', args, { cwd: root, encoding: 'utf8', input, windowsHide: true });
    const dir = git(['rev-parse', '--git-dir']);
    if (dir.status !== 0 || existsSync(join(resolve(root, dir.stdout.trim()), 'index.lock')))
        return;
    git(['add', '-A']);
    if (git(['diff-index', '--quiet', 'HEAD']).status === 0)
        return;
    const diff = git(['diff', '--cached']).stdout.split('\n').slice(0, 2000).join('\n');
    let conventions: Conventions = DEFAULT_CONVENTIONS;
    try { const effective = effectiveConventions(root); if (!effective.conflict) conventions = effective.values; } catch { /* a broken profile never blocks the snapshot */ }
    const generated = spawnSync('claude', ['-p', prompt(conventions)], { cwd: root, encoding: 'utf8', input: diff + '\n', windowsHide: true });
    let message = generated.status === 0 ? generated.stdout.trimEnd() : '';
    if (!message) {
        const count = git(['diff', '--cached', '--name-only']).stdout.split('\n').filter(Boolean).length;
        message = `chore: snapshot ${count} files automatically`;
    }
    message += '\n\nAuto-Session-Commit: true';
    // The commit uses the repository's own Git identity. The legacy opt-in bypass remains documented.
    // Without a snapshot commit (for example, no Git identity) the changelog would describe a commit that never happened.
    if (git(['commit', '-F', '-', '--no-verify'], message + '\n').status !== 0)
        return;
    const changelog = join(root, 'docs', 'CHANGELOG.md');
    if (!existsSync(changelog))
        return;
    try {
        const text = readFileSync(changelog, 'utf8');
        const now = new Date(), timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        const line = `- ${timestamp}: ${message.split('\n')[0]}`;
        writeFileSync(changelog, text.replace(/^(.*## \[Unreleased\].*)$/gm, '$1\n' + line));
    }
    catch { }
    git(['add', changelog]);
    if (git(['diff-index', '--quiet', 'HEAD']).status !== 0)
        git(['commit', '-m', 'docs: auto-update changelog', '--no-verify']);
}
if (isMain(import.meta.url))
    commitSession();
