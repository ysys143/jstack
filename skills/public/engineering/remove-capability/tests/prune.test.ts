import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/prune.js', import.meta.url));
const oracle = resolve('skills/prune/scripts/prune.py');
const write = (path: string, value: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, value); };
/** The caller's active profile variables would leak a real host home into auto-detection. */
function hermeticEnv(): NodeJS.ProcessEnv { const { CLAUDE_CONFIG_DIR: _claude, CODEX_HOME: _codex, ...rest } = process.env; return rest; }
test('prune JSON and human counts match the Python oracle on isolated defect fixtures', { skip: !process.env.JSTACK_ORACLE }, () => {
  const root = mkdtempSync(join(tmpdir(), 'jstack-prune-'));
  try {
    const config = join(root, '.claude'), codex = join(root, '.codex'), skills = join(config, 'skills');
    const skill = (name: string, frontmatter: string) => write(join(skills, name, 'SKILL.md'), `---\n${frontmatter}\n---\nBody\n`);
    skill('good', 'name: good\ndescription: normal');
    skill('mismatch', 'name: other\ndescription: normal');
    skill('no-description', 'name: no-description');
    skill('unicode', `name: unicode\ndescription: ${'😀'.repeat(1530)}`);
    skill('folded', 'name: folded\ndescription: >\n  first line\n  second line');
    skill('tolerated', 'name: tolerated\ndescription: text: invalid yaml');
    skill('yaml-boolean', 'name: yaml-boolean\ndescription: yes');
    write(join(skills, 'no-frontmatter/SKILL.md'), 'body');
    write(join(skills, 'loose.txt'), 'keep');
    write(join(skills, 'clone/clone/SKILL.md'), 'nested');
    write(join(skills, 'container/inner/SKILL.md'), 'nested');
    mkdirSync(join(skills, 'empty')); mkdirSync(join(skills, '.hidden'));
    if (process.platform !== 'win32') symlinkSync('absent', join(skills, 'broken'));
    write(join(config, 'settings.json'), JSON.stringify({ enabledPlugins: { 'ghost@market': true, 'installed@market': false }, skillOverrides: { absent: {} } }));
    write(join(config, 'plugins/installed_plugins.json'), JSON.stringify({ plugins: { 'installed@market': [{ installPath: join(root, 'missing-install') }] } }));
    mkdirSync(join(codex, 'skills'), { recursive: true });
    write(join(codex, 'config.toml'), `[[skills.config]]\npath = "${join(root, 'absent')}"\nenabled = false\n`);
    const env = { ...hermeticEnv(), HOME: root, USERPROFILE: root, PYTHONDONTWRITEBYTECODE: '1' };
    for (const json of [false, true]) {
      const args = ['--config-dir', config, '--config-dir', codex, ...(json ? ['--json'] : [])];
      const py = spawnSync('python3', [oracle, ...args], { cwd: root, env, encoding: 'utf8' }), js = spawnSync(process.execPath, [script, ...args], { cwd: root, env, encoding: 'utf8' });
      assert.equal(py.status, 1, py.stderr); assert.equal(js.status, py.status, js.stderr);
      if (json) assert.deepEqual(JSON.parse(js.stdout), JSON.parse(py.stdout)); else assert.equal(js.stdout, py.stdout);
    }
    assert.equal(readFileSync(join(skills, 'loose.txt'), 'utf8'), 'keep');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('prune distinguishes clean, defective, unavailable, and malformed CLI inputs', () => {
  const root = mkdtempSync(join(tmpdir(), 'jstack-prune-negative-'));
  try {
    const config = join(root, 'clean'); mkdirSync(join(config, 'skills'), { recursive: true });
    const env = { ...hermeticEnv(), HOME: root, USERPROFILE: root };
    for (const [args, expected] of [[['--config-dir', config, '--json'], 0], [['--config-dir', join(root, 'missing'), '--json'], 1], [['--json'], 2], [['--config-dir'], 2], [['--unknown'], 2]] as const) {
      const result = spawnSync(process.execPath, [script, ...args], { cwd: root, env, encoding: 'utf8' });
      assert.equal(result.status, expected, result.stdout + result.stderr);
    }
    const active = spawnSync(process.execPath, [script, '--json'], { cwd: root, env: { ...env, CLAUDE_CONFIG_DIR: config }, encoding: 'utf8' });
    assert.equal(active.status, 0, active.stdout + active.stderr); assert.deepEqual(Object.keys(JSON.parse(active.stdout).summary.dirs), [config]);
    write(join(config, 'settings.json'), '{malformed');
    const result = spawnSync(process.execPath, [script, '--config-dir', config, '--json'], { cwd: root, env, encoding: 'utf8' });
    assert.equal(result.status, 1); assert.equal(JSON.parse(result.stdout).summary.dirs[config].by_kind['failed to parse settings.json'], 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
