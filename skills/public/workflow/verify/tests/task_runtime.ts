/** Exercise the shared task protocol through the owning package suite. */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const test = fileURLToPath(new URL('../../../../../runtime/task_state.test.js', import.meta.url));
if (!existsSync(test)) { console.error('Task runtime tests missing'); process.exitCode = 2; }
else {
  const result = spawnSync(process.execPath, ['--test', test], { encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
  process.stdout.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? ''); process.exitCode = result.status ?? 2;
}
