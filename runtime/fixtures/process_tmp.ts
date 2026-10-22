import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Cached test resources outlive individual tests, but must not outlive their process. */
export function processTemporaryDirectory(prefix: string, temporaryRoot = tmpdir()): string {
  const dir = realpathSync(mkdtempSync(join(realpathSync(temporaryRoot), prefix)));
  // Node 20.0.0 does not run the global node:test.after hook. A synchronous
  // exit hook also covers an early process exit; it does not force that exit.
  process.once('exit', () => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
