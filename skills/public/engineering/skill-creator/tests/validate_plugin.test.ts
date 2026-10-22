import { sourcePath } from '../../../../../runtime/skill_catalog.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validatePlugin, frontmatter } from '../scripts/validate_plugin.js';
test('validator distinguishes absent plugin and measures all component contracts', () => { const temp = mkdtempSync(join(tmpdir(), 'jstack-validator-')), root = join(temp, 'example'); mkdirSync(root); try {
    assert.equal(validatePlugin(root).code, 3);
    mkdirSync(join(root, '.claude-plugin'));
    writeFileSync(join(root, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'example', version: '1.2.3', description: 'example' }));
    for (const path of ['skills/hello', 'commands', 'agents', 'hooks'])
        mkdirSync(join(root, path), { recursive: true });
    writeFileSync(join(root, 'skills/hello/SKILL.md'), '---\nname: hello\ndescription: |\n  Multi-line YAML description\n---\n');
    writeFileSync(join(root, 'commands/run.md'), '---\ndescription: Run a command\n---\n');
    writeFileSync(join(root, 'agents/helper.md'), '---\nname: helper\ndescription: Help\n---\n');
    writeFileSync(join(root, 'hooks/script.js'), '');
    writeFileSync(join(root, 'hooks/hooks.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/script.js"' }] }] } }));
    const good = validatePlugin(root);
    assert.equal(good.code, 0, good.output);
    assert.equal(good.checks, 6);
    writeFileSync(join(root, 'skills/hello/SKILL.md'), '---\nname: wrong\ndescription: hi\n---\n');
    assert.equal(validatePlugin(root).code, 1);
    rmSync(join(root, 'hooks/script.js'));
    assert.equal(validatePlugin(root).failures, 2);
    writeFileSync(join(root, 'hooks/hooks.json'), '{bad');
    assert.equal(validatePlugin(root).code, 2);
}
finally {
    rmSync(temp, { recursive: true, force: true });
} });
test('frontmatter uses YAML mapping semantics and rejects missing/empty/nonmapping/invalid forms', () => { for (const source of ['name: hello', '---\n---', '---\n\n---', '---\n- one\n---', '---\nname: [unclosed\n---'])
    assert.ok(frontmatter(source)[1], source); assert.equal(frontmatter('---\nname: hello\ndescription: >\n  folded text\n---')[0]?.description, 'folded text\n'); assert.equal(frontmatter('---\nenabled: yes\n---')[0]?.enabled, true); });
test('a command may omit its frontmatter or its description, while a skill or agent may not', () => { const temp = mkdtempSync(join(tmpdir(), 'jstack-validator-')), root = join(temp, 'example'); mkdirSync(join(root, '.claude-plugin'), { recursive: true }); try {
    writeFileSync(join(root, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'example', version: '1.2.3', description: 'example' }));
    for (const path of ['commands', 'agents'])
        mkdirSync(join(root, path));
    writeFileSync(join(root, 'commands/bare.md'), '# /bare \u2014 no frontmatter\n');
    writeFileSync(join(root, 'commands/hint.md'), '---\nargument-hint: "[topic]"\n---\n\n# /hint \u2014 no description\n');
    writeFileSync(join(root, 'agents/helper.md'), '---\nname: helper\ndescription: Help\n---\n');
    const good = validatePlugin(root);
    assert.equal(good.code, 0, good.output);
    assert.ok(good.output.includes('commands 2'), good.output);
    assert.ok(good.output.includes('first body line: commands/bare.md, commands/hint.md'), good.output);
    writeFileSync(join(root, 'commands/empty.md'), '---\ndescription: ""\n---\n');
    const empty = validatePlugin(root);
    assert.equal(empty.code, 1);
    assert.ok(empty.output.includes('description is empty'), empty.output);
    rmSync(join(root, 'commands/empty.md'));
    writeFileSync(join(root, 'agents/helper.md'), '---\nname: helper\n---\n');
    const agent = validatePlugin(root);
    assert.equal(agent.code, 1);
    assert.ok(agent.output.includes('description is missing'), agent.output);
}
finally {
    rmSync(temp, { recursive: true, force: true });
} });
test('a command fails on an empty file, a misplaced fence or a present but empty description, and only a missing key passes with a notice', () => { const temp = mkdtempSync(join(tmpdir(), 'jstack-validator-')), root = join(temp, 'example'); mkdirSync(join(root, '.claude-plugin'), { recursive: true }); mkdirSync(join(root, 'commands')); try {
    writeFileSync(join(root, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'example', version: '1.2.3', description: 'example' }));
    const cases: [string, string, string][] = [
        ['zero-byte file', '', 'command file is empty'],
        ['whitespace-only file', ' \n\n\t\n', 'command file is empty'],
        ['blank line before the fence', '\n---\ndescription: Run\n---\n', 'frontmatter fence is malformed'],
        ['spaces before the fence', '  ---\ndescription: Run\n---\n', 'frontmatter fence is malformed'],
        ['description with no value', '---\ndescription:\n---\n', 'description is empty'],
        ['description null', '---\ndescription: null\n---\n', 'description is empty'],
        ['description empty string', '---\ndescription: ""\n---\n', 'description is empty'],
        ['description a list', '---\ndescription: [a]\n---\n', 'description is not a string'],
    ];
    for (const [label, text, reason] of cases) {
        writeFileSync(join(root, 'commands/c.md'), text);
        const result = validatePlugin(root);
        assert.equal(result.code, 1, label + '\n' + result.output);
        assert.equal(result.failures, 1, label);
        assert.ok(result.output.includes(reason), label + '\n' + result.output);
    }
    writeFileSync(join(root, 'commands/c.md'), '---\nargument-hint: x\n---\n');
    const absent = validatePlugin(root);
    assert.equal(absent.code, 0, absent.output);
    assert.ok(absent.output.includes('[INFO] commands without a description are not listed to the model'), absent.output);
    assert.ok(absent.output.includes('first body line: commands/c.md'), absent.output);
    assert.ok(!absent.output.includes('[WARN]'), absent.output);
    writeFileSync(join(root, 'commands/c.md'), '---\ndescription: Run\n---\n');
    const described = validatePlugin(root);
    assert.equal(described.code, 0, described.output);
    assert.ok(!described.output.includes('without a description') && !described.output.includes('[WARN]'), described.output);
}
finally {
    rmSync(temp, { recursive: true, force: true });
} });
test('a misspelled description key passes with a WARN and shows up in the undescribed list', () => { const temp = mkdtempSync(join(tmpdir(), 'jstack-validator-')), root = join(temp, 'example'); mkdirSync(join(root, '.claude-plugin'), { recursive: true }); mkdirSync(join(root, 'commands')); try {
    writeFileSync(join(root, '.claude-plugin/plugin.json'), JSON.stringify({ name: 'example', version: '1.2.3', description: 'example' }));
    for (const key of ['desciption', 'descripton', 'descriptions', 'Description']) {
        writeFileSync(join(root, 'commands/c.md'), `---\n${key}: Run\n---\n`);
        const result = validatePlugin(root);
        assert.equal(result.code, 0, key + '\n' + result.output);
        assert.ok(result.output.includes(`[WARN] commands/c.md \u2014 frontmatter key '${key}' is within edit distance 2 of 'description'`), key + '\n' + result.output);
        assert.ok(result.output.includes('first body line: commands/c.md'), key + '\n' + result.output);
    }
    for (const key of ['argument-hint', 'allowed-tools', 'model', 'when_to_use'])
        writeFileSync(join(root, 'commands/c.md'), `---\n${key}: x\n---\n`), assert.ok(!validatePlugin(root).output.includes('[WARN]'), key);
}
finally {
    rmSync(temp, { recursive: true, force: true });
} });
test('the command fixtures keep their verdicts: three seeded defects fail and the undescribed forms pass with a notice', () => { const base = sourcePath(process.cwd(), 'skills/author/scripts/tests/fixtures'); for (const [name, reason] of [['command-empty-file', 'command file is empty'], ['command-fence-not-first', 'frontmatter fence is malformed'], ['command-null-description', 'description is empty']]) {
    const result = validatePlugin(join(base, 'negative', name));
    assert.equal(result.code, 1, result.output);
    assert.equal(result.failures, 1, result.output);
    assert.ok(result.output.includes(reason), result.output);
} const good = validatePlugin(join(base, 'positive/good-plugin')); assert.ok(good.output.includes('commands/hint-only.md, commands/menu-only.md'), good.output); const typo = validatePlugin(join(base, 'positive/typo-key-plugin')); assert.equal(typo.code, 0, typo.output); assert.ok(typo.output.includes("[WARN] commands/typo.md"), typo.output); });
test('all 13 inherited negative fixtures retain failure counts and causes',()=>{const base=sourcePath(process.cwd(),'skills/author/scripts/tests/fixtures');const cases:[string,number,string][]=[['broken-manifest',1,'not valid JSON'],['manifest-name-mismatch',1,'directory name'],['skill-no-frontmatter',1,'frontmatter is missing'],['skill-name-mismatch',1,'directory name'],['skill-empty-description',1,'description is empty'],['skill-colon-description',1,'not valid YAML'],['skills-dir-empty',1,'no skills'],['command-empty-description',1,'description is empty'],['agent-name-mismatch',1,'filename'],['hook-script-missing',1,'hook script is missing'],['hooks-dir-no-manifest',1,'hooks/hooks.json is missing'],['two-failures',2,"name('delta')"],['unregistered',1,'does not list']];for(const [name,failures,reason] of cases){const path=join(base,'negative',name),result=validatePlugin(path,name==='unregistered'?join(path,'marketplace.json'):undefined);assert.equal(result.code,1,result.output);assert.equal(result.failures,failures,result.output);assert.ok(result.output.includes(reason),result.output);}const good=validatePlugin(join(base,'positive/good-plugin'));assert.equal(good.code,0,good.output);assert.ok(good.checks>=6);});
