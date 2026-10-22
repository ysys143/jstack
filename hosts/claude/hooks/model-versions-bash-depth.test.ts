import assert from 'node:assert/strict';
import test from 'node:test';
import { bashSample } from './_model-versions-cases.js';
import { checkContent } from './check_model_versions.js';

test('Bash parser judges deep nesting and many substitutions without failing open', () => {
    const sample = bashSample(), blocks = (command: string) => {
        const verdict = checkContent('', command, [], true) ?? '';
        return /OUTDATED/.test(verdict) && !verdict.startsWith('WARN_ONLY:');
    };
    assert.ok(blocks('echo ' + '$('.repeat(2000) + `llm -m ${sample}` + ')'.repeat(2000)), 'a command nested past the parser depth is judged whole');
    assert.ok(blocks('echo ' + '$(:)'.repeat(150000) + ` $(llm -m ${sample})`), 'a word with many substitutions');
});
