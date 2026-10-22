import assert from 'node:assert/strict';
import test from 'node:test';
import { bashCases, bashSample } from './_model-versions-cases.js';
import { checkContent } from './check_model_versions.js';

test('Bash model check judges selection, not mention', () => {
    const sample = bashSample();
    assert.ok(sample, 'the database must carry an outdated, blocking provider-prefixed model');
    assert.match(checkContent('x.py', sample, [])!, /OUTDATED/);
    // Every wrong verdict is listed at once, so a failure names all the commands it affects. Each command is judged once.
    const { data, written, selected } = bashCases(sample), verdicts = new Map<string, string>();
    const verdict = (command: string) => {
        if (!verdicts.has(command))
            verdicts.set(command, checkContent('', command, [], true) ?? '');
        return verdicts.get(command)!;
    };
    assert.deepEqual(data.filter(command => verdict(command) !== ''), [], 'data commands must pass');
    assert.deepEqual(written.filter(command => !/^WARN_ONLY:[\s\S]*OUTDATED/.test(verdict(command))), [], 'file writes must warn');
    assert.deepEqual(selected.filter(command => !/OUTDATED/.test(verdict(command)) || verdict(command).startsWith('WARN_ONLY:')), [], 'selections must block');
    // Code handed to an interpreter is judged like code written to a file, where a bare name blocks.
    assert.doesNotMatch(checkContent('', `python -c "print('${sample}')"`, [], true) ?? 'WARN_ONLY:', /^WARN_ONLY:/);
    assert.equal(checkContent('', `python run.py --model "${sample}"`, [sample], true), undefined);
});
