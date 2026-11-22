import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { catalogRoot } from '../../../runtime/catalog_cli.js';
import { sourcePath } from '../../../runtime/skill_catalog.js';
import { handle as emoji, bashWritesAFile } from './block_emoji.js';
import { findPipCommands, projectRoot } from './validate_uv_usage.js';
import { checkPluginVersion } from './check_readme_version.js';
import { checkVersionConsistency } from './check_marketplace_versions.js';
function node(name: string, payload: unknown, cwd = process.cwd()): any { const result = spawnSync(process.execPath, [resolve('dist/hosts/claude/hooks', name + '.js')], { input: JSON.stringify(payload), encoding: 'utf8', cwd }); assert.equal(result.status, 0, result.stderr); return result.stdout.trim() ? JSON.parse(result.stdout) : {}; }
test('emoji preserves all write-tool decisions and read-only negative controls', () => { for (const payload of [{ tool_name: 'Write', tool_input: { content: '한글 text' } }, { tool_name: 'Write', tool_input: { content: '\u{1f600}' } }, { tool_name: 'Edit', tool_input: { new_string: '\u{1f600}' } }, { tool_name: 'MultiEdit', tool_input: { edits: [{ new_string: '\u{1f600}' }] } }, { tool_name: 'NotebookEdit', tool_input: { new_source: '\u{1f600}' } }, { tool_name: 'Bash', tool_input: { command: 'grep "\u{1f600}" f 2>/dev/null' } }, { tool_name: 'Bash', tool_input: { command: 'echo "\u{1f600}" > f' } }]) {
    assert.equal(emoji(payload)?.decision, JSON.stringify(payload).includes('😀') && payload.tool_input.command?.startsWith('grep') !== true ? 'block' : undefined);
} assert.equal(bashWritesAFile('grep thing f 2>&1'), false); assert.equal(bashWritesAFile('tee out'), true); });
test('emoji block message keeps its prefix and points at the user-request exemption', () => {
    const payload = { tool_name: 'Write', tool_input: { content: 'done \u{1f4a1} and \u{1f4cc}' } };
    const reason = emoji(payload)?.reason ?? '';
    // The interactive hook probe matches the start of this message.
    assert.ok(reason.startsWith('Emoji detected in content: \u{1f4a1} (\\U0001f4a1), \u{1f4cc} (\\U0001f4cc). '), reason);
    const tail = reason.slice(reason.indexOf('. Default:') + 2);
    assert.match(tail, /^Default: remove all emoji characters and retry with ASCII alternatives like \[O\], \[X\], \[INFO\], \[WARN\], ->, <- instead\. /);
    assert.match(tail, /If the user explicitly asked for these emoji, this is a policy exemption\. Read support file: "/);
    // The absolute path takes precedence; the package-relative name is context, not a second instruction.
    assert.match(tail, /\. Use that absolute path first; in the installed jstack package it is payload\/skills\/emoji\/SKILL\.md, and a contributor build may name the same body differently\. /);
    assert.match(tail, /Follow its section "When the user asked for emoji" and do not retry the same call unchanged\.$/);
    const guide = /Read support file: ("(?:\\.|[^"\\])*")\. /.exec(tail);
    assert.ok(guide, reason);
    const file: string = JSON.parse(guide[1]);
    assert.equal(isAbsolute(file), true);
    assert.match(readFileSync(file, 'utf8'), /## When the user asked for emoji/);
    assert.equal(/[^\x00-\x7f]/.test(tail.replace(guide[1], '"PATH"')), false, 'fixed guidance stays ASCII; the path may contain Unicode');
});
test('emoji guidance follows the installed body from unrelated cwd and Unicode paths without weakening a block', () => {
    // Canonical temp path: the hook's import.meta.url is resolved through symlinks such as macOS /var.
    const temp = realpathSync(mkdtempSync(join(tmpdir(), 'jstack-emoji-guide-')));
    const root = catalogRoot(), relocated = join(temp, '설치 경로 with spaces'), cwd = join(temp, 'unrelated');
    const hook = fileURLToPath(new URL('./block_emoji.js', import.meta.url));
    const body = sourcePath(root, 'skills/emoji/SKILL.md');
    const target = (file: string) => join(relocated, relative(root, file));
    try {
        mkdirSync(cwd, { recursive: true });
        for (const file of [hook, fileURLToPath(new URL('./emoji-pattern.js', import.meta.url)), fileURLToPath(new URL('../../../runtime/entry.js', import.meta.url)), fileURLToPath(new URL('../../../runtime/catalog_cli.js', import.meta.url)), fileURLToPath(new URL('../../../runtime/skill_catalog.js', import.meta.url)), join(root, 'contracts/skill-catalog.json'), body]) {
            mkdirSync(dirname(target(file)), { recursive: true }); cpSync(file, target(file));
        }
        if (relative(root, body).split(sep).join('/').startsWith('skills/support/')) mkdirSync(join(relocated, 'skills/public'), { recursive: true });
        writeFileSync(join(relocated, 'package.json'), '{"type":"module"}');
        const payload = JSON.stringify({ tool_name: 'Write', tool_input: { content: String.fromCodePoint(0x1f4a1) } });
        const run = () => {
            const result = spawnSync(process.execPath, [target(hook)], { cwd, input: payload, encoding: 'utf8', timeout: 5000 });
            assert.ifError(result.error); assert.equal(result.status, 0, result.stderr);
            const verdict = JSON.parse(result.stdout); assert.equal(verdict.decision, 'block'); return verdict.reason as string;
        };
        const named = (reason: string) => {
            const quoted = /Read support file: ("(?:\\.|[^"\\])*")\. /.exec(reason);
            assert.ok(quoted, reason); return JSON.parse(quoted[1]) as string;
        };
        const path = named(run());
        assert.equal(path, target(body)); assert.equal(readFileSync(path, 'utf8'), readFileSync(body, 'utf8'));
        // Missing/malformed discovery metadata must not turn a literal emoji write into a pass,
        // and the static fallback must still name the body that exists in this layout.
        writeFileSync(join(relocated, 'contracts/skill-catalog.json'), '{');
        const malformed = run();
        assert.match(malformed, /Emoji detected in content:/);
        assert.equal(named(malformed), target(body)); assert.equal(existsSync(named(malformed)), true);
        rmSync(join(relocated, 'contracts/skill-catalog.json'));
        const missing = run();
        assert.match(missing, /Emoji detected in content:/);
        assert.equal(named(missing), target(body)); assert.equal(existsSync(named(missing)), true);
    } finally { rmSync(temp, { recursive: true, force: true }); }
});
test('uv command detection preserves legacy decisions without ambient project config', () => { const temp = mkdtempSync(join(tmpdir(), 'jstack-hooks-')); try {
    for (const command of ['pip install a', 'python3 -m pip freeze', 'pipx run a', 'echo "pip install a"', 'cat <<EOF\npip install a\nEOF', 'uv pip list', 'uv pip install a', 'uv add a', 'uv pip list && pip install a']) {
        const payload = { tool_name: 'Bash', tool_input: { command } };
        assert.equal(node('validate_uv_usage', payload, temp).decision, ['pip install a', 'python3 -m pip freeze', 'pipx run a', 'uv pip install a'].includes(command) ? 'block' : undefined, command);
    }
    writeFileSync(join(temp, 'pyproject.toml'), '[tool.claude-hooks]\nenforce_uv = false\n');
    assert.deepEqual(node('validate_uv_usage', { tool_name: 'Bash', tool_input: { command: 'pip install a' } }, temp), {});
    assert.equal(projectRoot(temp), temp);
    assert.equal(findPipCommands("echo 'pip install a'").length, 0);
}
finally {
    rmSync(temp, { recursive: true, force: true });
} });
test('uv hook blocks pip flags before the subcommand and venv creation, but not unrelated text', () => { const temp = mkdtempSync(join(tmpdir(), 'jstack-hooks-')); try {
    for (const command of ['./venv/bin/pip -q install a', 'pip -U --quiet install a', 'pip3 --index-url https://example.invalid/simple install a', 'pip --timeout 5 -q install a', 'python -m pip -q install a', 'python3.12 -m pip -q install a', 'python3 -m venv venv', 'python3.12 -m venv .v', 'python -m virtualenv v', 'virtualenv v', 'cd x && virtualenv v', 'cd x && ./venv/bin/pip -q install a 2>&1 | tail -2']) {
        assert.ok(findPipCommands(command).length > 0, command);
    }
    for (const command of ['uv venv', 'uv venv .venv', 'uv tool install virtualenv', 'echo "python3 -m venv v"', 'grep -n pip requirements.txt', 'uv run python script.py']) {
        assert.equal(findPipCommands(command).length, 0, command);
    }
    assert.equal(node('validate_uv_usage', { tool_name: 'Bash', tool_input: { command: './venv/bin/pip -q install a' } }, temp).decision, 'block');
    assert.match(node('validate_uv_usage', { tool_name: 'Bash', tool_input: { command: 'python3 -m venv venv' } }, temp).reason, /uv venv/);
} finally { rmSync(temp, { recursive: true, force: true }); } });
test('README and marketplace checks reject mismatches and accept coherent versions', () => { const temp = mkdtempSync(join(tmpdir(), 'jstack-hooks-')); try {
    mkdirSync(join(temp, 'plugins', 'sample', '.claude-plugin'), { recursive: true });
    mkdirSync(join(temp, '.claude-plugin'));
    writeFileSync(join(temp, 'plugins', 'sample', '.claude-plugin', 'plugin.json'), JSON.stringify({ version: '1.2.3' }));
    writeFileSync(join(temp, '.claude-plugin', 'marketplace.json'), JSON.stringify({ plugins: [{ name: 'sample', version: '1.0.0' }] }));
    assert.equal(checkVersionConsistency(temp).length, 1);
    assert.equal(checkPluginVersion(temp, 'sample').length, 1);
    writeFileSync(join(temp, 'plugins', 'sample', 'README.md'), '## v1.2.3\n');
    writeFileSync(join(temp, 'README.md'), '| sample | 1.2.3 |\n');
    writeFileSync(join(temp, '.claude-plugin', 'marketplace.json'), JSON.stringify({ plugins: [{ name: 'sample', version: '1.2.3' }] }));
    assert.deepEqual(checkVersionConsistency(temp), []);
    assert.deepEqual(checkPluginVersion(temp, 'sample'), []);
    writeFileSync(join(temp, 'README.md'), '| sample | 1.0.0 |\n');
    assert.match(checkPluginVersion(temp, 'sample')[0], /version mismatch/);
}
finally {
    rmSync(temp, { recursive: true, force: true });
} });
test('malformed hook input fails open without executing commands', () => { for (const name of ['block_emoji', 'check_marketplace_versions', 'check_readme_version', 'validate_uv_usage']) {
    const result = spawnSync(process.execPath, [resolve('dist/hosts/claude/hooks', name + '.js')], { input: 'invalid JSON', encoding: 'utf8' });
    assert.equal(result.status, 0);
    if (name === 'block_emoji') { assert.equal(result.stdout, ''); assert.equal(result.stderr, ''); }
    else assert.deepEqual(JSON.parse(result.stdout), {});
} });
test('recent changes matches shell hook context without Python in new runtime', () => { const temp = mkdtempSync(join(tmpdir(), 'jstack-hooks-context-')); try {
    mkdirSync(join(temp, 'docs'));
    writeFileSync(join(temp, 'docs', 'CHANGELOG.md'), Array.from({ length: 25 }, (_, i) => `change ${i}`).join('\n') + '\n');
    const env = { ...process.env, CLAUDE_PROJECT_DIR: temp };
    const current = spawnSync(process.execPath, [resolve('dist/hosts/claude/hooks/load-recent-changes.js')], { cwd: temp, env, encoding: 'utf8' });
    assert.equal(current.status, 0, current.stderr);
    const output = JSON.parse(current.stdout);
    assert.deepEqual(Object.keys(output), ['hookSpecificOutput']);
    assert.deepEqual(Object.keys(output.hookSpecificOutput).sort(), ['additionalContext', 'hookEventName']);
    assert.equal(output.hookSpecificOutput.hookEventName, 'SessionStart');
    assert.equal(output.hookSpecificOutput.additionalContext, 'Recent CHANGELOG entries:\n' + Array.from({ length: 20 }, (_, i) => `change ${i + 5}`).join('\n') + '\n\n\n');
}
finally {
    rmSync(temp, { recursive: true, force: true });
} });
