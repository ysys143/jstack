#!/usr/bin/env node
/** Seeded defects must fail, and each disabled validation layer must be detected. */
import { existsSync, readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, '../validate_plugin.js');
const FIXTURES = existsSync(join(HERE, 'fixtures')) ? join(HERE, 'fixtures') : resolve(HERE, '../../../../../skills/author/scripts/tests/fixtures');
const results: boolean[] = [];
function check(label: string, ok: boolean, detail = '') {
    results.push(ok);
    console.log(`${ok ? '[ok]  ' : '[FAIL]'} ${label}${!ok && detail ? ` — ${detail}` : ''}`);
}
function run(args: string[], script = SCRIPT): [number | null, string] {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
    return [result.status, result.stdout + result.stderr];
}
function counts(out: string): [number, number] | undefined {
    const fail = /\[FAIL\] (\d+) checks, (\d+) failed/.exec(out);
    if (fail) return [Number(fail[1]), Number(fail[2])];
    const pass = /\[OK\] Passed: (\d+) checks/.exec(out);
    if (pass) return [Number(pass[1]), 0];
}
const NEGATIVE: [string, number, string][] = [
    ['broken-manifest', 1, 'not valid JSON'],
    ['manifest-name-mismatch', 1, 'directory name'],
    ['skill-no-frontmatter', 1, 'frontmatter is missing'],
    ['skill-name-mismatch', 1, 'directory name'],
    ['skill-empty-description', 1, 'description is empty'],
    ['skill-colon-description', 1, 'not valid YAML'],
    ['skills-dir-empty', 1, 'no skills'],
    ['command-empty-description', 1, 'description is empty'],
    ['command-null-description', 1, 'description is empty'],
    ['command-empty-file', 1, 'command file is empty'],
    ['command-fence-not-first', 1, 'frontmatter fence is malformed'],
    ['agent-name-mismatch', 1, 'filename'],
    ['hook-script-missing', 1, 'hook script is missing'],
    ['hooks-dir-no-manifest', 1, 'hooks/hooks.json is missing'],
    ['two-failures', 2, "name('delta')"],
    ['unregistered', 1, 'does not list'],
];
function negativeVerdicts(script = SCRIPT): [string, boolean, string][] {
    return NEGATIVE.map(([name, failures, reason]) => {
        const path = join(FIXTURES, 'negative', name);
        const args = name === 'unregistered' ? ['--marketplace', join(path, 'marketplace.json'), path] : [path];
        const [rc, out] = run(args, script), measured = counts(out);
        return [name, rc === 1 && measured?.[1] === failures && out.includes(reason), `rc=${rc} counts=${JSON.stringify(measured)}\n${out}`];
    });
}
if (!existsSync(SCRIPT)) throw new Error(`validator missing: ${SCRIPT}`);
const verdicts = negativeVerdicts();
for (const [name, ok, detail] of verdicts) check(`reject: ${name}`, ok, detail);
check(`negative fixture count is ${NEGATIVE.length}`, NEGATIVE.length >= 16 && verdicts.length === NEGATIVE.length);
const onDisk = readdirSync(join(FIXTURES, 'negative'), { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
check('negative fixtures on disk match the list', JSON.stringify(onDisk) === JSON.stringify(NEGATIVE.map(entry => entry[0]).sort()));
const good = join(FIXTURES, 'positive/good-plugin');
let [rc, out] = run([good]);
const measured = counts(out);
check('pass: good-plugin returns rc 0', rc === 0, out);
check('pass: summary reports a nonzero measured check count', !!measured && measured[0] >= 6 && measured[1] === 0, out);
check('pass: all four layers were counted', out.includes('skills 1, commands 3, agents 1, hook scripts 1'), out);
check('pass: undescribed commands are named in an INFO notice', out.includes('[INFO] commands without a description are not listed to the model') && out.includes('commands/hint-only.md, commands/menu-only.md') && !out.includes('commands/do-thing.md,'), out);
[rc, out] = run([join(FIXTURES, 'positive/typo-key-plugin')]);
check('pass: a misspelled description key passes with a WARN and the INFO notice', rc === 0 && out.includes("[WARN] commands/typo.md — frontmatter key 'desciption'") && out.includes('first body line: commands/typo.md'), out);
[rc, out] = run([join(FIXTURES, 'edge/no-manifest')]);
check('directory without a manifest returns rc 3, not 0', rc === 3, out);
check('directory without a manifest reports that it measured nothing', out.includes('measured zero checks'), out);
for (const [label, args] of [
    ['unknown flag', ['--nope', good]],
    ['two positional arguments', [good, FIXTURES]],
    ['missing directory', [join(FIXTURES, 'no-such-directory')]],
    ['--marketplace without a value', ['--marketplace']],
] as [string, string[]][]) {
    [rc, out] = run(args);
    check(`${label} returns rc 2`, rc === 2, out);
}
// Mutate compiled code beside the original so normal module resolution is retained.
// No production bypass or environment-controlled disable switch is introduced.
const source = readFileSync(SCRIPT, 'utf8');
const marker = 'const verdict = (label, check) => {';
if (!source.includes(marker)) throw new Error('compiled verdict mutation point missing');
for (const [name, predicate] of [
    ['check_manifest', "label === 'plugin.json schema'"],
    ['check_skills', "label.startsWith('skills/')"],
    ['check_commands', "label.startsWith('commands/')"],
    ['check_agents', "label.startsWith('agents/')"],
    ['check_hooks', "label.startsWith('hooks/') || label.startsWith('hook script') || label.startsWith('hooks.json')"],
    ['check_marketplace', "label.startsWith('marketplace.json')"],
    ['fail', ''],
]) {
    const path = join(dirname(SCRIPT), `validate_plugin_mutant_${process.pid}_${name}.js`);
    const mutant = name === 'fail' ? source.replace('failures++;', '/* failure counter disabled */') : source.replace(marker, `${marker} if (${predicate}) return;`);
    if (mutant === source) throw new Error(`mutation was not applied: ${name}`);
    let caught = false;
    try {
        writeFileSync(path, mutant);
        // A broken mutant import is not evidence of detection by seeded fixtures.
        const [goodRc, goodOut] = run([good], path);
        if (goodRc !== 0 || !counts(goodOut)) throw new Error(`mutant cannot execute: ${name}\n${goodOut}`);
        caught = negativeVerdicts(path).some(([, ok]) => !ok);
    } finally { if (existsSync(path)) unlinkSync(path); }
    check(`mutation detected: ${name} becomes red when replaced by a no-op`, caught);
}
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exitCode = passed === results.length ? 0 : 1;
