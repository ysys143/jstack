/** Reach the routing runtime tests from the package's owning-suite CI entrypoint. */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const tests = ['../../../runtime/routing.test.js', '../../../scripts/routing_eval.test.js', '../../consult/tests/bridges.test.js'].map(path => fileURLToPath(new URL(path, import.meta.url)));
if (tests.some(path => !existsSync(path))) {
  console.error('[FAIL] Routing runtime tests are missing from the package'); process.exitCode = 2;
} else {
  const result = spawnSync(process.execPath, ['--test', ...tests], { encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
  process.stdout.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? '');
  process.exitCode = result.status ?? 2;
}
