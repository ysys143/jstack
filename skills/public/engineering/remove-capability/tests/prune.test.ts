import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/prune.js', import.meta.url));
const write = (path: string, value: string) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, value); };
/** The caller's active profile variables would leak a real host home into auto-detection. */
function hermeticEnv(): NodeJS.ProcessEnv { const { CLAUDE_CONFIG_DIR: _claude, CODEX_HOME: _codex, ...rest } = process.env; return rest; }
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
