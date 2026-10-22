import { isMain } from '../../../runtime/entry.js';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitRoot, run } from './hook-common.js';
export function loadRecentChanges(): { hookSpecificOutput: { hookEventName: 'SessionStart'; additionalContext: string } } | undefined {
    const root = gitRoot() || process.env.CLAUDE_PROJECT_DIR;
    if (!root || !existsSync(root))
        return;
    let context = '';
    const changelog = join(root, 'docs', 'CHANGELOG.md');
    if (existsSync(changelog)) {
        try {
            const recent = readFileSync(changelog, 'utf8').replace(/\n$/, '').split('\n').slice(-20).join('\n');
            if (recent)
                context = `Recent CHANGELOG entries:\n${recent}\n\n`;
        }
        catch { }
    }
    const result = run('git', ['log', '--oneline', '-10'], root);
    const commits = result.status === 0 ? result.stdout.trimEnd() : '';
    if (commits)
        context += `Recent commits:\n${commits}`;
    return context ? { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context + '\n' } } : undefined;
}
if (isMain(import.meta.url)) {
    const result = loadRecentChanges();
    if (result)
        console.log(JSON.stringify(result));
}
