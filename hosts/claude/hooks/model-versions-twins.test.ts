import assert from 'node:assert/strict';
import { type SpawnSyncReturns, spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { bashCases, bashSample, parityCases, unprefixedSample } from './_model-versions-cases.js';
import { checkContent } from './check_model_versions.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
// Python on Windows decodes and encodes text-mode stdio with the console code page. cp1252 recreates that on every
// OS, so Python code that reads the UTF-8 input as text sees a non-ASCII command as other characters.
const windowsConsole = { ...process.env, PYTHONIOENCODING: 'cp1252', PYTHONUTF8: '0', PYTHONDONTWRITEBYTECODE: '1' };

// The Bash verdict comes from a command parser in each language, so one Python process compares every Bash case.
test('Bash verdicts agree between the TypeScript and Python twins', t => {
    const sample = bashSample(), commands = [...Object.values(bashCases(sample)).flat(), ...parityCases(sample)];
    const bash = spawnSync('python3', ['-c', `import sys,json,importlib.util
sys.dont_write_bytecode=True
sys.path.insert(0,'scripts')
spec=importlib.util.spec_from_file_location('check_model_versions','hosts/claude/hooks/check_model_versions.py')
hook=importlib.util.module_from_spec(spec);spec.loader.exec_module(hook)
sys.stdout.buffer.write(json.dumps([hook.check_bash_command(command,[]) for command in json.load(sys.stdin.buffer)]).encode())`], { cwd: root, encoding: 'utf8', env: windowsConsole, input: JSON.stringify(commands), maxBuffer: 1 << 26 });
    if ((bash.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
        t.skip('python3 is not installed');
        return;
    }
    assert.equal(bash.status, 0, bash.stderr);
    JSON.parse(bash.stdout).forEach((verdict: string | null, index: number) => assert.equal(checkContent('', commands[index], [], true) ?? null, verdict, JSON.stringify(commands[index]).slice(0, 300)));
});
// Each twin also runs as the hook program, so reading the event and writing the verdict are compared too.
test('the hook programs agree on a non-ASCII command under a Windows console code page', t => {
    // A selected model with a trailing BOM blocks on stderr; a heredoc that writes a model name warns on stdout.
    const commands = [`python run.py model="${unprefixedSample()}\ufeff"`, `cat > notes.md <<'EOF'\nmodel: ${bashSample()} — 기본 모델\nEOF`];
    // Python escapes non-ASCII JSON text that JavaScript writes as is, so stdout is compared as its value and its line end.
    const program = (run: SpawnSyncReturns<string>) => ({ status: run.status, stdout: run.stdout && [JSON.parse(run.stdout), run.stdout.slice(run.stdout.trimEnd().length)], stderr: run.stderr });
    for (const command of commands) {
        const input = JSON.stringify({ tool_name: 'Bash', tool_input: { command } });
        const python = spawnSync('python3', ['hosts/claude/hooks/check_model_versions.py'], { cwd: root, encoding: 'utf8', env: { ...windowsConsole, PYTHONPATH: join(root, 'scripts') }, input });
        if ((python.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
            t.skip('python3 is not installed');
            return;
        }
        const node = spawnSync(process.execPath, [fileURLToPath(new URL('./check_model_versions.js', import.meta.url))], { cwd: root, encoding: 'utf8', input });
        assert.notEqual(node.status === 1 ? node.stderr : node.stdout, '', `the fixture must produce a verdict: ${JSON.stringify(command)}`);
        assert.deepEqual(program(python), program(node), JSON.stringify(command));
    }
});
