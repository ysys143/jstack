import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gitRoot, jsonFile, main, run, type HookInput, type HookResult } from './hook-common.js';
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function checkPluginVersion(root: string, name: string): string[] {
    const dir = join(root, 'plugins', name);
    const version = jsonFile(join(dir, '.claude-plugin', 'plugin.json'))?.version;
    if (!version)
        return [];
    const errors: string[] = [];
    const readme = join(dir, 'README.md');
    if (!existsSync(readme))
        errors.push(`${name}: README.md missing (plugin.json v${version})`);
    else {
        try {
            if (!new RegExp(`##\\s*v?${escape(version)}\\b`).test(readFileSync(readme, 'utf8')))
                errors.push(`${name}: plugin.json v${version} changelog not found in README.md`);
        }
        catch { }
    }
    try {
        const content = readFileSync(join(root, 'README.md'), 'utf8');
        if (!new RegExp(`\\|\\s*${escape(name)}\\s*\\|\\s*${escape(version)}\\s*\\|`).test(content)) {
            errors.push(new RegExp(`\\|\\s*${escape(name)}\\s*\\|\\s*[\\d.]+\\s*\\|`).test(content) ? `${name}: root README.md table version mismatch (expected v${version})` : `${name}: not listed in root README.md plugin table`);
        }
    }
    catch { }
    const market = jsonFile(join(root, '.claude-plugin', 'marketplace.json'));
    if (market && !(market.plugins ?? []).some((p: {
        name: string;
    }) => p.name === name))
        errors.push(`${name}: not registered in .claude-plugin/marketplace.json`);
    return errors;
}
export function handle(input: HookInput): HookResult { if (input.tool_name !== 'Bash' || !/\bgit\s+commit\b/i.test(input.tool_input?.command ?? ''))
    return {}; const root = gitRoot(); if (!root)
    return {}; const result = run('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], root); if (result.status !== 0)
    return {}; const plugins = [...new Set(result.stdout.split('\n').map(f => /^plugins\/([^/]+)\//.exec(f)?.[1]).filter((v): v is string => !!v))].sort(); const errors = plugins.flatMap(p => checkPluginVersion(root, p)); return errors.length ? { decision: 'block', reason: '[WARN] README changelog missing:\n' + errors.map(e => '  - ' + e).join('\n') } : {}; }
main(import.meta.url, handle);
