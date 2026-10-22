import assert from 'node:assert/strict';
import test from 'node:test';
import { bashSample } from './_model-versions-cases.js';
import { checkContent } from './check_model_versions.js';

test('Bash parser judges a long command list without failing open', () => {
    const sample = bashSample(), blocks = (command: string) => {
        const verdict = checkContent('', command, [], true) ?? '';
        return /OUTDATED/.test(verdict) && !verdict.startsWith('WARN_ONLY:');
    };
    assert.ok(blocks('(' + `llm -m ${sample};` + ' :;'.repeat(150000) + ')'), 'a subshell with many commands');
});
