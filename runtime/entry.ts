import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** npm bins and platform directory aliases can name the same file differently. */
export function isMain(moduleUrl: string, entry = process.argv[1]): boolean {
  if (!entry) return false;
  try { return realpathSync(entry) === realpathSync(fileURLToPath(moduleUrl)); }
  catch { return false; }
}
