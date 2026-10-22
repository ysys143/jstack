import { join } from 'node:path';
import { gitRoot, jsonFile, main, type HookInput, type HookResult } from './hook-common.js';
export function checkVersionConsistency(root: string): string[] { const data = jsonFile(join(root, '.claude-plugin', 'marketplace.json')); const errors: string[] = []; for (const entry of data?.plugins ?? []) {
    if (!entry.name || !entry.version)
        continue;
    const version = jsonFile(join(root, 'plugins', entry.name, '.claude-plugin', 'plugin.json'))?.version;
    if (version && entry.version !== version)
        errors.push(`${entry.name}: marketplace.json=${entry.version} vs plugin.json=${version}`);
} return errors; }
export function handle(input: HookInput): HookResult { if (input.tool_name !== 'Bash' || !/\bgit\s+push\b/i.test(input.tool_input?.command ?? ''))
    return {}; const root = gitRoot(); if (!root)
    return {}; const errors = checkVersionConsistency(root); return errors.length ? { decision: 'block', reason: '[BLOCK] marketplace.json version mismatch\n\nAlign .claude-plugin/marketplace.json versions before pushing:\n' + errors.map(e => '  - ' + e).join('\n') + '\n\nFix: update each marketplace.json plugin version to match plugin.json' } : {}; }
main(import.meta.url, handle);
